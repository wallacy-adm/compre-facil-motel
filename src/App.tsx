// @ts-nocheck
import { useState, useCallback, memo, useRef, useEffect, useMemo, Component } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

// ── CAMADA 1: ERROR BOUNDARY GLOBAL ──────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("[CompraFácil] Erro capturado:", error, info); }
  handleReset() { this.setState({ hasError: false, error: null }); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"#050709",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
          <div style={{fontSize:"48px",marginBottom:"16px"}}>⚠️</div>
          <div style={{color:"#E2E8F0",fontSize:"18px",fontWeight:"700",marginBottom:"8px",textAlign:"center"}}>Algo deu errado</div>
          <div style={{color:"#4B5563",fontSize:"13px",marginBottom:"28px",textAlign:"center",maxWidth:"320px"}}>
            O app encontrou um erro inesperado. Seus dados estão seguros.
          </div>
          <div onClick={()=>this.handleReset()} style={{background:"linear-gradient(135deg,#0891B2,#0ABFCA)",borderRadius:"12px",padding:"13px 28px",color:"#fff",fontWeight:"700",fontSize:"14px",cursor:"pointer",boxShadow:"0 4px 20px #0ABFCA33"}}>
            Tentar novamente
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── DETECÇÃO PWA STANDALONE (necessário para push no iOS) ────────────────
function isRunningStandalone(): boolean {
  if ((navigator as any).standalone === true) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

// ── CAMADA 2: LOCALSTORAGE BLINDADO ──────────────────────────────────────
const LS = {
  get:(k,d)=>{ try{ const v=localStorage.getItem(k); if(v===null) return d; const p=JSON.parse(v); return p??d; }catch{ return d; } },
  set:(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ console.warn("[LS] Falha ao salvar",k,e); return false; } },
  remove:(k)=>{ try{ localStorage.removeItem(k); }catch{} },
};

// ── LOGO INLINE SVG (zero bytes de arquivo — fonte via Google Fonts) ──────
const CarpeDiemLogo = memo(({ width = 190, height = undefined }: { width?: number; height?: number }) => {
  const VW = 300, VH = 148;
  const h = height ?? Math.round(width * VH / VW);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`-20 0 ${VW + 40} ${VH}`} width={width} height={h} style={{display:"block", overflow:"visible"}}>
      {/* Transparent background — no black rect */}
      {/* CARPE — right-anchored to gap center */}
      <text x="140" y="82" fontFamily="Cinzel,Georgia,serif" fontSize="56" fill="#f1f5f9" textAnchor="end">CARPE</text>
      {/* DIEM — left-anchored from gap center */}
      <text x="162" y="82" fontFamily="Cinzel,Georgia,serif" fontSize="56" fill="#f1f5f9" textAnchor="start">DIEM</text>
      {/* Diamond accent above heart */}
      <polygon points="151,34 155,42 151,48 147,42" fill="#0ABFCA"/>
      {/* Heart ornament — small, near top of cap-height, between the words */}
      <path d="M151,60 C151,60 141,54 138,47 C135,40 139,34 145,35 C147.8,36 149.8,39 151,42 C152.2,39 154.2,36 157,35 C163,34 167,40 164,47 C161,54 151,60 151,60Z" fill="#0ABFCA"/>
      {/* Thin teal rule below text */}
      <line x1="14" y1="93" x2="286" y2="93" stroke="#0ABFCA" strokeWidth="1.5" strokeOpacity="0.7"/>
      {/* MOTEL — small tracked type */}
      <text x="246" y="112" fontFamily="Cinzel,Georgia,serif" fontSize="19" fill="#94a3b8" letterSpacing="3" textAnchor="middle">MOTEL</text>
    </svg>
  );
});

// ── ALERTA SONORO IN-APP (funciona em qualquer browser sem permissão) ───────
function playAlertSound() {
  try {
    const AC = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    const ctx = new AC();
    [[880,0],[1046,0.18],[1318,0.36]].forEach(([freq,delay])=>{
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.start(t); osc.stop(t + 0.45);
    });
  } catch(_) {}
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = "BLUGwL3JIYZxi08-Pc7ULoJv2zo2SUjWKpHbypCFzK6wEhxOveo86kl0yLoDfanhL8N-65C2_RE5PY3YzmN2Jlo";
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function subscribePush(reg: ServiceWorkerRegistration, userId: string) {
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await supabase.from('push_subscriptions').upsert(
      { user_id: userId, endpoint: sub.endpoint, subscription: sub.toJSON() },
      { onConflict: 'endpoint' }
    );
  } catch(e) { console.warn('[Push subscribe]', e); }
}

// ── BANNERS PWA ────────────────────────────────────────────────────────────
import { NtfySetupCard } from "@/components/NtfySetupCard";

function NotifBanner({ onEnable, onDismiss }: { onEnable: ()=>void; onDismiss: ()=>void }) {
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:9999,background:"#0ABFCA",color:"#050709",padding:"10px 16px",display:"flex",alignItems:"center",gap:"10px",fontSize:"13px",fontWeight:600}}>
      <span style={{flex:1}}>🔔 Ative as notificações para receber alertas de pedidos</span>
      <button onClick={onEnable} style={{background:"#050709",color:"#0ABFCA",border:"none",borderRadius:"8px",padding:"6px 14px",fontWeight:700,cursor:"pointer",fontSize:"13px"}}>Ativar</button>
      <button onClick={onDismiss} style={{background:"transparent",color:"#050709",border:"none",fontSize:"18px",cursor:"pointer",lineHeight:1}}>✕</button>
    </div>
  );
}
function IOSInstallBanner({ onDismiss }: { onDismiss: ()=>void }) {
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:9999,background:"#1A1A2E",color:"#E2E8F0",padding:"16px",borderRadius:"16px 16px 0 0",boxShadow:"0 -4px 24px #0006",fontSize:"13px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
        <strong>Instalar CompraFácil no iPhone</strong>
        <button onClick={onDismiss} style={{background:"transparent",color:"#6B7280",border:"none",fontSize:"18px",cursor:"pointer"}}>✕</button>
      </div>
      <p style={{margin:"0 0 8px",color:"#9CA3AF"}}>Para receber notificações no iPhone, instale o app:</p>
      <ol style={{margin:0,paddingLeft:"18px",color:"#E2E8F0",lineHeight:"1.8"}}>
        <li>Abra este site no <strong>Safari</strong></li>
        <li>Toque em <strong>Compartilhar</strong> <span style={{fontSize:"16px"}}>⎋</span></li>
        <li>Role e toque em <strong>"Adicionar à Tela de Início"</strong></li>
        <li>Abra o app instalado e ative as notificações</li>
      </ol>
      <p style={{margin:"8px 0 0",color:"#6B7280",fontSize:"11px"}}>Requer iOS 16.4 ou superior</p>
    </div>
  );
}
function AndroidInstallBanner({
  onInstall,
  onDismiss,
}: { onInstall: ()=>void; onDismiss: ()=>void }) {
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:9999,background:"#0B1220",color:"#E2E8F0",padding:"14px 16px",borderRadius:"16px 16px 0 0",boxShadow:"0 -4px 24px #0006",fontSize:"13px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
        <strong>Instalar app no Android</strong>
        <button onClick={onDismiss} style={{background:"transparent",color:"#6B7280",border:"none",fontSize:"18px",cursor:"pointer"}}>✕</button>
      </div>
      <p style={{margin:"0 0 10px",color:"#94A3B8"}}>
        Para receber notificações mesmo com o navegador fechado, instale o app no celular.
      </p>
      <button onClick={onInstall} style={{background:"#0ABFCA",color:"#050709",border:"none",borderRadius:"8px",padding:"8px 14px",fontWeight:700,cursor:"pointer",fontSize:"13px"}}>
        📲 Instalar CompraFácil
      </button>
    </div>
  );
}

// ── CONSTANTES ────────────────────────────────────────────────────────────
const ROLES = {
  admin:      { label: "Administrador", icon: "👑", color: "#A78BFA" },
  chefia:     { label: "Chefia",        icon: "🏢", color: "#F59E0B" },
  estoque:    { label: "Estoque",       icon: "📦", color: "#0ABFCA" },
  cozinha:    { label: "Cozinha",       icon: "🍽️",  color: "#0ABFCA" },
  manutencao:  { label: "Manutenção",   icon: "🔧", color: "#0ABFCA" },
  construcao:  { label: "Construção",   icon: "🏗️",  color: "#0ABFCA" },
  comprador:  { label: "Comprador",     icon: "🛒", color: "#34D399" },
};

const PRIORITY = {
  urgente: { label: "Urgente", color: "#FF4C4C", bg: "#2A0A0A" },
  normal:  { label: "Normal",  color: "#0ABFCA", bg: "#051A1C" },
};

const ORDER_STATUS = {
  pendente:  { label: "Aguardando aprovação", color: "#F59E0B", bg: "#1C1407" },
  aprovado:  { label: "Aprovado",             color: "#34D399", bg: "#052016" },
  recusado:  { label: "Recusado",             color: "#FF4C4C", bg: "#2A0A0A" },
  concluido: { label: "Concluído",            color: "#6B7280", bg: "#111827" },
};

// destino: "comprador" | "chefia"
const DESTINOS = {
  comprador: { label: "Comprador", icon: "🛒", color: "#34D399" },
  chefia:    { label: "Chefia",    icon: "🏢", color: "#F59E0B" },
};

const SINGLE_ROLES  = ["admin", "comprador", "chefia"];
const isSector      = (r) => ["estoque","cozinha","manutencao","construcao"].includes(r);
const getRoles      = (u) => Array.isArray(u?.roles) ? u.roles : (u?.role ? [u.role] : []);
const isAdmin       = (u) => getRoles(u).includes("admin");
const isChefia      = (u) => getRoles(u).includes("chefia");
const isComprador   = (u) => getRoles(u).includes("comprador");
const isSectorUser  = (u) => getRoles(u).some(isSector);

const DEFAULT_USERS = [
  { id:"1", name:"Administrador", username:"admin",    password:"admin123",  role:"admin",    roles:["admin"],    active:true },
  { id:"2", name:"Comprador",     username:"comprador",password:"compra123", role:"comprador",roles:["comprador"],active:true },
  { id:"3", name:"Chefia",        username:"chefia",   password:"chefia123", role:"chefia",   roles:["chefia"],   active:true },
];

const parsePriority = (raw) => String(raw||"").toUpperCase().trim()==="URGENTE"?"urgente":"normal";

// ── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{background:#050709;}
  input,textarea,select{font-family:'DM Sans',sans-serif;}
  ::-webkit-scrollbar{width:3px;}
  ::-webkit-scrollbar-thumb{background:#0ABFCA33;border-radius:4px;}
  @keyframes fadeUp   {from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes glow     {0%,100%{box-shadow:0 0 18px #0ABFCA22}50%{box-shadow:0 0 36px #0ABFCA55}}
  @keyframes spin     {from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes borderPulse {0%,100%{box-shadow:0 0 0 0 #F59E0B33}50%{box-shadow:0 0 0 4px #F59E0B22}}
  .pending-card { animation: borderPulse 2s infinite; }
  @keyframes slideDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
  .btn{transition:transform .15s;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .btn:active{transform:scale(.96);}
  .tl{height:1px;background:linear-gradient(90deg,transparent,#0ABFCA,transparent);}
  .lb{position:fixed;inset:0;background:rgba(0,0,0,.93);display:flex;align-items:center;justify-content:center;z-index:999;animation:fadeUp .2s ease;}
  .inp{background:#0D1117;border:1px solid #1E2A30;border-radius:10px;padding:10px 12px;font-size:14px;color:#E2E8F0;outline:none;font-family:'DM Sans',sans-serif;width:100%;}
  .inp:focus{border-color:#0ABFCA55;}
  .inp-err{border-color:#FF4C4C55!important;}
  .card{background:#0D1117;border-radius:16px;border:1px solid #1E2A30;}
  .card-hover{transition:border-color .2s,transform .2s;cursor:pointer;}
  .card-hover:hover{border-color:#0ABFCA33;transform:translateY(-1px);}
  .card-hover:active{transform:scale(.98);}
  .tag{border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;}
  .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:500;padding:20px;animation:fadeUp .2s;}
  .modal{background:#0D1117;border-radius:20px;border:1px solid #1E2A30;padding:24px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;}
`;

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────
const ToastEl = memo(({ toast }) => toast ? (
  <div style={{position:"fixed",top:"16px",left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?"#7F1D1D":"#064E3B",border:`1px solid ${toast.type==="error"?"#FF4C4C":"#0ABFCA"}`,color:"#fff",padding:"11px 20px",borderRadius:"12px",fontSize:"13px",fontWeight:"600",zIndex:300,boxShadow:"0 4px 24px rgba(0,0,0,.5)",animation:"slideDown .25s ease",whiteSpace:"nowrap"}}>
    {toast.msg}
  </div>
) : null);

const LightboxEl = memo(({ src, onClose }) => src ? (
  <div className="lb" onClick={onClose}>
    <div style={{position:"relative"}}>
      <img src={src} alt="" onClick={e=>e.stopPropagation()} style={{maxWidth:"90vw",maxHeight:"85vh",borderRadius:"14px",boxShadow:"0 0 60px #0ABFCA44"}} />
      <div onClick={onClose} style={{position:"absolute",top:"-14px",right:"-14px",width:"30px",height:"30px",borderRadius:"50%",background:"#0ABFCA",color:"#000",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",fontWeight:"700",cursor:"pointer"}}>✕</div>
    </div>
  </div>
) : null);

const PriorityPicker = memo(({ value, onChange }) => (
  <div className="card" style={{padding:"14px",marginBottom:"12px"}}>
    <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"1.2px"}}>Prioridade</div>
    <div style={{display:"flex",gap:"8px"}}>
      {Object.entries(PRIORITY).map(([k,v])=>(
        <div key={k} onClick={()=>onChange(k)} className="btn"
          style={{flex:1,textAlign:"center",padding:"10px 4px",borderRadius:"10px",border:`1.5px solid ${value===k?v.color:"#1E2A30"}`,background:value===k?v.bg:"#050709",color:value===k?v.color:"#4B5563",fontSize:"13px",fontWeight:"700"}}>
          {v.label}
        </div>
      ))}
    </div>
  </div>
));

const EmptyState = memo(({ icon, text, sub }) => (
  <div style={{textAlign:"center",padding:"80px 20px"}}>
    <div style={{fontSize:"40px",opacity:.35,marginBottom:"12px"}}>{icon}</div>
    <div style={{color:"#4B5563",fontWeight:"600",marginBottom:sub?"6px":"0"}}>{text}</div>
    {sub&&<div style={{color:"#374151",fontSize:"12px"}}>{sub}</div>}
  </div>
));

const ConfirmModal = memo(({ title, msg, onConfirm, onClose }) => (
  <div className="modal-bg" onClick={onClose}>
    <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:"320px"}}>
      <div style={{fontSize:"16px",fontWeight:"700",color:"#E2E8F0",marginBottom:"8px"}}>{title}</div>
      <div style={{fontSize:"13px",color:"#4B5563",marginBottom:"20px"}}>{msg}</div>
      <div style={{display:"flex",gap:"8px"}}>
        <div onClick={onClose}   className="btn" style={{flex:1,background:"#1E2A30",borderRadius:"12px",padding:"12px",textAlign:"center",color:"#4B5563",fontWeight:"700"}}>Cancelar</div>
        <div onClick={onConfirm} className="btn" style={{flex:1,background:"#7F1D1D",border:"1px solid #FF4C4C33",borderRadius:"12px",padding:"12px",textAlign:"center",color:"#FF4C4C",fontWeight:"700"}}>Confirmar</div>
      </div>
    </div>
  </div>
));

const AddedItem = memo(({ item, idx, onEdit, onDelete, onLightbox }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({name:item.name,qty:item.qty,obs:item.obs,img:item.img});
  const photoRef = useRef(null);
  const handlePhoto = e => {
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>setDraft(d=>({...d,img:ev.target.result})); r.readAsDataURL(f);
  };
  const save   = () => { onEdit(idx,draft); setEditing(false); };
  const cancel = () => { setDraft({name:item.name,qty:item.qty,obs:item.obs,img:item.img}); setEditing(false); };
  return (
    <div className="card" style={{marginBottom:"8px",border:`1px solid ${editing?"#0ABFCA44":"#1E2A30"}`,borderRadius:"12px",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"8px 12px",borderBottom:"1px solid #1A2025"}}>
        <div style={{width:"20px",height:"20px",borderRadius:"5px",background:"#0ABFCA14",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#0ABFCA",fontWeight:"700",flexShrink:0}}>{idx+1}</div>
        <div style={{flex:1,fontSize:"13px",fontWeight:"600",color:"#CBD5E1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name||<span style={{color:"#374151",fontStyle:"italic"}}>sem nome</span>}</div>
        <div style={{display:"flex",gap:"4px"}}>
          {editing?(
            <><div onClick={save}   className="btn" style={{fontSize:"11px",color:"#0ABFCA",padding:"4px 9px",background:"#0ABFCA14",border:"1px solid #0ABFCA33",borderRadius:"6px"}}>✓ Salvar</div>
              <div onClick={cancel} className="btn" style={{fontSize:"11px",color:"#4B5563",padding:"4px 9px",background:"#1E2A30",border:"1px solid #2A3540",borderRadius:"6px"}}>✕</div></>
          ):(
            <><div onClick={()=>setEditing(true)} className="btn" style={{fontSize:"11px",color:"#0ABFCA",padding:"4px 9px",background:"#0ABFCA14",border:"1px solid #0ABFCA33",borderRadius:"6px"}}>✏️ Editar</div>
              <div onClick={()=>onDelete(idx)}    className="btn" style={{fontSize:"11px",color:"#FF4C4C",padding:"4px 9px",background:"#FF4C4C14",border:"1px solid #FF4C4C33",borderRadius:"6px"}}>🗑️</div></>
          )}
        </div>
      </div>
      <div style={{padding:"10px 12px"}}>
        {editing?(
          <>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <input value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} placeholder="Nome *" className="inp" style={{flex:1}}/>
              <input value={draft.qty}  onChange={e=>setDraft(d=>({...d,qty:e.target.value}))}  placeholder="Qtd" className="inp" style={{width:"82px"}}/>
            </div>
            <input value={draft.obs} onChange={e=>setDraft(d=>({...d,obs:e.target.value}))} placeholder="Observação..." className="inp" style={{marginBottom:"10px"}}/>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <label style={{display:"flex",alignItems:"center",gap:"6px",background:"#0ABFCA14",color:"#0ABFCA",border:"1px solid #0ABFCA33",borderRadius:"8px",padding:"7px 12px",fontSize:"12px",fontWeight:"600",cursor:"pointer"}}>
                📷 {draft.img?"Trocar":"Foto"}
                <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{display:"none"}}/>
              </label>
              {draft.img&&<>
                <img src={draft.img} alt="" onClick={()=>onLightbox(draft.img)} style={{width:"42px",height:"42px",borderRadius:"8px",objectFit:"cover",border:"1.5px solid #0ABFCA44",cursor:"pointer"}}/>
                <div onClick={()=>{setDraft(d=>({...d,img:null}));if(photoRef.current)photoRef.current.value="";}} className="btn" style={{fontSize:"11px",color:"#FF4C4C",padding:"4px 8px",background:"#FF4C4C14",border:"1px solid #FF4C4C33",borderRadius:"6px"}}>remover</div>
              </>}
            </div>
          </>
        ):(
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <div style={{flex:1,fontSize:"12px",color:"#4B5563"}}>{item.qty||"—"}{item.obs?` • ${item.obs}`:""}</div>
            {item.img&&<img src={item.img} alt="" onClick={()=>onLightbox(item.img)} style={{width:"42px",height:"42px",borderRadius:"8px",objectFit:"cover",border:"1px solid #0ABFCA33",cursor:"pointer"}}/>}
          </div>
        )}
      </div>
    </div>
  );
});

const Topbar = memo(({ user, onLogout, children }) => (
  <div style={{background:"#050709",borderBottom:"1px solid #0ABFCA1A",padding:"12px 18px",display:"flex",alignItems:"center",gap:"12px",flexShrink:0,position:"sticky",top:0,zIndex:10}}>
    <CarpeDiemLogo height={28}/>
    <div style={{borderLeft:"1px solid #0ABFCA22",paddingLeft:"12px",flex:1}}>
      <div style={{color:"#E2E8F0",fontWeight:"600",fontSize:"14px"}}>{ROLES[getRoles(user)[0]]?.icon} {user.name}</div>
      <div style={{color:"#0ABFCA55",fontSize:"11px"}}>{getRoles(user).map(r=>ROLES[r]?.label).join(", ")}</div>
    </div>
    {children}
    <div onClick={onLogout} className="btn" style={{color:"#4B5563",fontSize:"12px",padding:"6px 11px",background:"#1E2A30",border:"1px solid #2A3540",borderRadius:"8px",whiteSpace:"nowrap"}}>Sair</div>
  </div>
));

const TabBar = memo(({ tabs, active, onSelect, stickyTop="54px" }) => (
  <div style={{display:"flex",background:"#070B0D",borderBottom:"1px solid #0ABFCA1A",padding:"0 16px",flexShrink:0,overflowX:"auto",position:"sticky",top:stickyTop,zIndex:9}}>
    {tabs.map(t=>{
      const isActive = active===t.key;
      const isHighlight = !isActive && t.highlight;
      return (
        <div key={t.key} className="btn" onClick={()=>onSelect(t.key)}
          style={{padding:"11px 14px",fontSize:"12px",fontWeight:"600",whiteSpace:"nowrap",
            color: isActive?"#0ABFCA": isHighlight?"#F59E0B":"#4B5563",
            borderBottom: isActive?"2px solid #0ABFCA": isHighlight?"2px solid #F59E0B":"2px solid transparent",
            marginBottom:"-1px",
            animation: isHighlight?"pulse 2s infinite":undefined}}>
          {t.label}
        </div>
      );
    })}
  </div>
));

// ── APPROVAL PANEL — item por item ────────────────────────────────────────
// Componente reutilizado por Admin e Chefia
const ApprovalPanel = memo(({ orders, onApprove, onReject, onDelete, userRole }) => {
  const [openOrder, setOpenOrder] = useState(null);
  // itemDecisions: { [orderId]: { [itemId]: true=aprovado | false=recusado } }
  const [decisions, setDecisions] = useState({});

  const pendingOrders = useMemo(() =>
    orders.filter(o => o.status === "pendente"),
  [orders]);

  const initDecisions = useCallback((order) => {
    if (decisions[order.id]) return;
    const d = {};
    (order.items||[]).forEach(it => { d[it.id] = it.itemStatus !== "recusado"; });
    setDecisions(p => ({...p, [order.id]: d}));
  }, [decisions]);

  const toggleDecision = (orderId, itemId) => {
    setDecisions(p => ({
      ...p,
      [orderId]: { ...p[orderId], [itemId]: !p[orderId]?.[itemId] }
    }));
  };

  const confirmApproval = (order) => {
    const d = decisions[order.id] || {};
    const approvedItems = order.items.map(it => ({
      ...it,
      itemStatus: d[it.id] === false ? "recusado" : "aprovado",
    }));
    const allRecused = approvedItems.every(i => i.itemStatus === "recusado");
    onApprove(order.id, approvedItems, allRecused ? "recusado" : "aprovado");
    setDecisions(p => { const n={...p}; delete n[order.id]; return n; });
    setOpenOrder(null);
  };

  if (pendingOrders.length === 0) return <EmptyState icon="✅" text="Nenhum pedido aguardando aprovação" />;

  return (
    <>
      {pendingOrders.map(o => {
        const pr = PRIORITY[o.priority]||PRIORITY.normal;
        const st = ORDER_STATUS[o.status]||ORDER_STATUS.pendente;
        const roleInfo = ROLES[o.userRole]||ROLES.estoque;
        const isOpen = openOrder === o.id;
        const d = decisions[o.id] || {};
        const approvedCount = o.items.filter(it => d[it.id] !== false && it.itemStatus !== "recusado").length;

        return (
          <div key={o.id} className="card" style={{marginBottom:"10px",overflow:"hidden"}}>
            <div className="btn" onClick={()=>{ if(!isOpen) initDecisions(o); setOpenOrder(isOpen?null:o.id); }} style={{padding:"14px 16px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <div style={{width:"36px",height:"36px",borderRadius:"10px",background:"#0ABFCA12",border:"1px solid #0ABFCA2A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px"}}>{roleInfo.icon}</div>
                  <div>
                    <div style={{fontWeight:"700",fontSize:"14px",color:"#E2E8F0"}}>{o.sectorLabel}</div>
                    <div style={{color:"#4B5563",fontSize:"11px"}}>{o.userName} • {o.createdAt}{o.destino==="chefia"?" • 🏢 Chefia":""}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:"5px",alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
                  <span className="tag" style={{background:pr.bg,color:pr.color}}>{pr.label}</span>
                  <span className="tag" style={{background:st.bg,color:st.color}}>{st.label}</span>
                  <div style={{color:"#2A3540",fontSize:"11px"}}>{isOpen?"▲":"▼"}</div>
                </div>
              </div>
              <div style={{fontSize:"11px",color:"#4B5563"}}>{o.items.length} itens</div>
            </div>

            {isOpen && (
              <div style={{borderTop:"1px solid #1A2025",padding:"12px 16px 16px"}}>
                <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"1px"}}>
                  Selecione os itens a aprovar — todos marcados por padrão
                </div>
                {o.items.map(it => {
                  const approved = d[it.id] !== false;
                  const wasRejected = it.itemStatus === "recusado";
                  return (
                    <div key={it.id} onClick={()=>toggleDecision(o.id,it.id)} className="btn"
                      style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px 0",borderBottom:"1px solid #1A2025"}}>
                      <div style={{width:"24px",height:"24px",borderRadius:"7px",border:`2px solid ${approved?"#34D399":"#FF4C4C"}`,background:approved?"#34D399":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",color:"#000",flexShrink:0,transition:"all .2s"}}>
                        {approved?"✓":"✕"}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:"14px",fontWeight:"600",color:approved?"#CBD5E1":"#4B5563",textDecoration:approved?"none":"line-through"}}>{it.name}</div>
                        <div style={{fontSize:"12px",color:"#374151"}}>{it.qty}{it.obs?` • ${it.obs}`:""}{wasRejected?" • ⚠️ recusado anteriormente":""}</div>
                      </div>
                      {it.img&&<img src={it.img} alt="" onClick={e=>{e.stopPropagation();}} style={{width:"40px",height:"40px",borderRadius:"8px",objectFit:"cover",border:"1px solid #0ABFCA33"}}/>}
                    </div>
                  );
                })}

                <div style={{marginTop:"14px",background:"#050709",borderRadius:"10px",padding:"10px 12px",fontSize:"12px",color:"#4B5563",marginBottom:"12px"}}>
                  ✅ {approvedCount} aprovados &nbsp;•&nbsp; ❌ {o.items.length - approvedCount} recusados
                </div>

                <div style={{display:"flex",gap:"8px"}}>
                  <div onClick={()=>confirmApproval(o)} className="btn"
                    style={{flex:1,background:"linear-gradient(135deg,#065F46,#059669)",borderRadius:"10px",padding:"11px",textAlign:"center",color:"#fff",fontWeight:"700",fontSize:"13px"}}>
                    ✅ Confirmar aprovação
                  </div>
                  <div onClick={()=>{ onReject(o.id); setOpenOrder(null); }} className="btn"
                    style={{flex:1,background:"#2A0A0A",border:"1px solid #FF4C4C33",borderRadius:"10px",padding:"11px",textAlign:"center",color:"#FF4C4C",fontWeight:"700",fontSize:"13px"}}>
                    ✕ Recusar tudo
                  </div>
                </div>
                {o.status==="recusado"&&onDelete&&(
                  <div onClick={()=>{ onDelete(o.id); setOpenOrder(null); }} className="btn"
                    style={{marginTop:"8px",background:"#1A0505",border:"1px solid #FF4C4C22",borderRadius:"10px",padding:"9px",textAlign:"center",color:"#6B1010",fontWeight:"700",fontSize:"12px"}}>
                    🗑️ Excluir pedido recusado permanentemente
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});

// ── RELATÓRIO ─────────────────────────────────────────────────────────────
const RelatorioTab = memo(({ orders, users }) => {
  const [filterSetor, setFilterSetor] = useState("todos");
  const [rankPeriod,  setRankPeriod]  = useState("30");
  const [compMesA,    setCompMesA]    = useState("");
  const [compMesB,    setCompMesB]    = useState("");

  // ── Helpers ──────────────────────────────────────────────────────────
  const parseDate = d => { if(!d) return null; const [dd,mm,yy]=d.split("/").map(Number); return new Date(yy,mm-1,dd); };
  const getMesKey = d => { if(!d) return null; const [,mm,yy]=d.split("/"); return `${mm}/${yy}`; };
  const getMesLabel = k => { if(!k) return ""; const [mm,yy]=k.split("/"); const names=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]; return `${names[parseInt(mm)-1]} ${yy}`; };

  // ── Setores disponíveis ───────────────────────────────────────────────
  const setores = useMemo(()=>{
    const s=new Set(); orders.forEach(o=>{ if(o.sectorLabel) s.add(o.sectorLabel); }); return [...s].sort();
  },[orders]);

  // ── Meses disponíveis (para comparação) ──────────────────────────────
  const meses = useMemo(()=>{
    const s=new Set(); orders.forEach(o=>{ const k=getMesKey(o.createdDate); if(k) s.add(k); });
    return [...s].sort((a,b)=>{ const [ma,ya]=a.split("/").map(Number); const [mb,yb]=b.split("/").map(Number); return ya!==yb?ya-yb:ma-mb; });
  },[orders]);

  // ── Inicializa meses de comparação quando disponíveis ────────────────
  const mesAFinal = compMesA||(meses.length>=2?meses[meses.length-2]:"");
  const mesBFinal = compMesB||(meses.length>=1?meses[meses.length-1]:"");

  // ── Filtro base por setor ─────────────────────────────────────────────
  const ordersSetor = useMemo(()=>
    filterSetor==="todos" ? orders : orders.filter(o=>o.sectorLabel===filterSetor)
  ,[orders,filterSetor]);

  // ── Pipeline ─────────────────────────────────────────────────────────
  const pipeline = useMemo(()=>({
    total:     orders.length,
    pendentes: orders.filter(o=>o.status==="pendente").length,
    aprovados: orders.filter(o=>o.status==="aprovado").length,
    concluidos:orders.filter(o=>o.status==="concluido").length,
    recusados: orders.filter(o=>o.status==="recusado").length,
    urgentes:  orders.filter(o=>o.priority==="urgente").length,
    usuarios:  users.filter(u=>u.active).length,
    bySetor:(()=>{ const m={}; orders.forEach(o=>{ m[o.sectorLabel]=(m[o.sectorLabel]||0)+1; }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); })(),
  }),[orders,users]);

  // ── Ranking ───────────────────────────────────────────────────────────
  const ranking = useMemo(()=>{
    const hoje=new Date(); const dias=rankPeriod==="todos"?99999:parseInt(rankPeriod);
    const base=ordersSetor.filter(o=>{ if(rankPeriod==="todos") return true; const dt=parseDate(o.createdDate); return dt&&(hoje-dt)/(1000*60*60*24)<=dias; });
    const m={};
    base.forEach(o=>(o.items||[]).forEach(it=>{ const k=it.name.trim().toLowerCase(); if(!m[k]) m[k]={name:it.name.trim(),count:0}; m[k].count++; }));
    return Object.values(m).sort((a,b)=>b.count-a.count).slice(0,8);
  },[ordersSetor,rankPeriod]);

  // ── Comparação ────────────────────────────────────────────────────────
  const compData = useMemo(()=>{
    if(!mesAFinal||!mesBFinal) return [];
    const contarItens=(mesKey)=>{ const m={}; ordersSetor.filter(o=>getMesKey(o.createdDate)===mesKey).forEach(o=>(o.items||[]).forEach(it=>{ const k=it.name.trim().toLowerCase(); if(!m[k]) m[k]={name:it.name.trim(),count:0}; m[k].count++; })); return m; };
    const mA=contarItens(mesAFinal); const mB=contarItens(mesBFinal);
    const keys=new Set([...Object.keys(mA),...Object.keys(mB)]);
    return [...keys].map(k=>({ name:(mA[k]||mB[k]).name, a:mA[k]?.count||0, b:mB[k]?.count||0 }))
      .sort((x,y)=>(y.a+y.b)-(x.a+x.b)).slice(0,8);
  },[ordersSetor,mesAFinal,mesBFinal]);

  const maxComp = useMemo(()=>Math.max(...compData.map(d=>Math.max(d.a,d.b)),1),[compData]);

  const stat=(label,value,color="#0ABFCA")=>(
    <div className="card" style={{padding:"14px",textAlign:"center"}}>
      <div style={{fontSize:"26px",fontWeight:"800",color}}>{value}</div>
      <div style={{fontSize:"10px",color:"#4B5563",marginTop:"3px",fontWeight:"600",textTransform:"uppercase",letterSpacing:".8px"}}>{label}</div>
    </div>
  );

  const chipStyle=(active)=>({ display:"inline-block",padding:"5px 11px",borderRadius:"20px",fontSize:"11px",fontWeight:"600",cursor:"pointer",border:`1px solid ${active?"#0ABFCA44":"#1A2025"}`,background:active?"#0ABFCA14":"#050709",color:active?"#0ABFCA":"#4B5563",marginRight:"6px",marginBottom:"6px",whiteSpace:"nowrap" });

  return (
    <>
      {/* Pipeline */}
      <div style={{fontSize:"11px",fontWeight:"700",color:"#4B5563",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:"10px"}}>📊 Visão do Pipeline</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"8px"}}>
        {stat("Total",pipeline.total)}
        {stat("Pendentes",pipeline.pendentes,"#F59E0B")}
        {stat("Aprovados",pipeline.aprovados,"#34D399")}
        {stat("Concluídos",pipeline.concluidos,"#0ABFCA")}
        {stat("Recusados",pipeline.recusados,"#FF4C4C")}
        {stat("Urgentes",pipeline.urgentes,"#F97316")}
        {stat("Usuários Ativos",pipeline.usuarios,"#A78BFA")}
      </div>
      <div className="card" style={{padding:"14px",marginBottom:"20px"}}>
        <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"1px"}}>Pedidos por Setor</div>
        {pipeline.bySetor.length===0
          ? <div style={{fontSize:"12px",color:"#374151"}}>Nenhum pedido ainda</div>
          : pipeline.bySetor.map(([setor,count])=>{
              const pct=pipeline.total?Math.round(count/pipeline.total*100):0;
              return (
                <div key={setor} style={{marginBottom:"10px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",color:"#CBD5E1",marginBottom:"4px"}}>
                    <span>{setor}</span><span style={{color:"#4B5563"}}>{count} pedido{count>1?"s":""}</span>
                  </div>
                  <div style={{background:"#050709",borderRadius:"4px",height:"4px"}}>
                    <div style={{background:"#0ABFCA",width:`${pct}%`,height:"100%",borderRadius:"4px"}}/>
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* Filtro Global de Setor */}
      <div style={{fontSize:"11px",fontWeight:"700",color:"#4B5563",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:"8px"}}>🏷️ Filtrar por Setor</div>
      <div style={{marginBottom:"20px",lineHeight:"2"}}>
        <span onClick={()=>setFilterSetor("todos")} style={chipStyle(filterSetor==="todos")}>Todos</span>
        {setores.map(s=><span key={s} onClick={()=>setFilterSetor(s)} style={chipStyle(filterSetor===s)}>{s}</span>)}
      </div>

      {/* Ranking */}
      <div style={{fontSize:"11px",fontWeight:"700",color:"#4B5563",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:"8px"}}>🏆 Ranking — Itens Mais Pedidos</div>
      <div className="card" style={{padding:"14px",marginBottom:"20px"}}>
        <div style={{display:"flex",gap:"6px",marginBottom:"12px",flexWrap:"wrap"}}>
          {[["7","7 dias"],["30","30 dias"],["90","3 meses"],["todos","Tudo"]].map(([v,l])=>(
            <span key={v} onClick={()=>setRankPeriod(v)} style={chipStyle(rankPeriod===v)}>{l}</span>
          ))}
        </div>
        {ranking.length===0
          ? <div style={{fontSize:"12px",color:"#374151"}}>Nenhum item no período</div>
          : ranking.map((it,i)=>{
              const pct=Math.round(it.count/ranking[0].count*100);
              return (
                <div key={it.name} style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 0",borderBottom:i<ranking.length-1?"1px solid #1A2025":"none"}}>
                  <div style={{width:"20px",height:"20px",borderRadius:"6px",background:"#0ABFCA14",border:"1px solid #0ABFCA22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:"700",color:"#0ABFCA",flexShrink:0}}>{i+1}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"12px",fontWeight:"600",color:"#CBD5E1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                    <div style={{background:"#050709",borderRadius:"2px",height:"3px",marginTop:"5px"}}>
                      <div style={{background:"#0ABFCA",width:`${pct}%`,height:"100%",borderRadius:"2px"}}/>
                    </div>
                  </div>
                  <div style={{background:"#0ABFCA14",border:"1px solid #0ABFCA22",borderRadius:"8px",padding:"2px 9px",fontSize:"11px",fontWeight:"700",color:"#0ABFCA",flexShrink:0}}>×{it.count}</div>
                </div>
              );
            })
        }
      </div>

      {/* Comparação de Períodos */}
      <div style={{fontSize:"11px",fontWeight:"700",color:"#4B5563",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:"8px"}}>📊 Comparação de Períodos</div>
      <div className="card" style={{padding:"14px",marginBottom:"16px"}}>
        {meses.length<2
          ? <div style={{fontSize:"12px",color:"#374151"}}>São necessários pedidos em pelo menos 2 meses diferentes</div>
          : <>
              <div style={{display:"flex",gap:"8px",marginBottom:"14px",alignItems:"flex-end"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:"10px",color:"#4B5563",marginBottom:"5px",textTransform:"uppercase",letterSpacing:".8px"}}>Período A</div>
                  <select value={mesAFinal} onChange={e=>setCompMesA(e.target.value)}
                    style={{width:"100%",background:"#050709",border:"1px solid #1A2025",borderRadius:"8px",padding:"7px 10px",fontSize:"12px",color:"#CBD5E1",outline:"none"}}>
                    {meses.map(m=><option key={m} value={m}>{getMesLabel(m)}</option>)}
                  </select>
                </div>
                <div style={{color:"#374151",fontSize:"12px",paddingBottom:"8px",flexShrink:0}}>vs</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"10px",color:"#4B5563",marginBottom:"5px",textTransform:"uppercase",letterSpacing:".8px"}}>Período B</div>
                  <select value={mesBFinal} onChange={e=>setCompMesB(e.target.value)}
                    style={{width:"100%",background:"#050709",border:"1px solid #1A2025",borderRadius:"8px",padding:"7px 10px",fontSize:"12px",color:"#CBD5E1",outline:"none"}}>
                    {meses.map(m=><option key={m} value={m}>{getMesLabel(m)}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:"flex",gap:"12px",marginBottom:"10px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"5px"}}><div style={{width:"8px",height:"8px",borderRadius:"50%",background:"#0ABFCA",flexShrink:0}}/><span style={{fontSize:"10px",color:"#4B5563"}}>{getMesLabel(mesAFinal)}</span></div>
                <div style={{display:"flex",alignItems:"center",gap:"5px"}}><div style={{width:"8px",height:"8px",borderRadius:"50%",background:"#F59E0B",flexShrink:0}}/><span style={{fontSize:"10px",color:"#4B5563"}}>{getMesLabel(mesBFinal)}</span></div>
              </div>
              {compData.length===0
                ? <div style={{fontSize:"12px",color:"#374151"}}>Nenhum item nos períodos selecionados</div>
                : compData.map((it,i)=>{
                    const diff=it.a===0&&it.b===0?null:it.a===0?"novo":it.b===0?"zerou":Math.round(((it.b-it.a)/it.a)*100);
                    const badge=diff===null?null:diff==="novo"?{label:"novo",bg:"#0ABFCA14",color:"#0ABFCA"}:diff==="zerou"?{label:"zerou",bg:"#FF4C4C14",color:"#FF4C4C"}:diff>0?{label:`+${diff}%`,bg:"#34D39914",color:"#34D399"}:diff<0?{label:`${diff}%`,bg:"#FF4C4C14",color:"#FF4C4C"}:{label:"igual",bg:"#1A2025",color:"#4B5563"};
                    return (
                      <div key={it.name} style={{padding:"9px 0",borderBottom:i<compData.length-1?"1px solid #1A2025":"none"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"5px"}}>
                          <div style={{fontSize:"12px",fontWeight:"600",color:"#CBD5E1",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginRight:"8px"}}>{it.name}</div>
                          {badge&&<div style={{background:badge.bg,color:badge.color,borderRadius:"6px",padding:"2px 7px",fontSize:"10px",fontWeight:"700",flexShrink:0}}>{badge.label}</div>}
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
                          <div style={{background:"#050709",borderRadius:"2px",height:"4px"}}>
                            <div style={{background:"#0ABFCA",width:`${Math.round(it.a/maxComp*100)}%`,height:"100%",borderRadius:"2px"}}/>
                          </div>
                          <div style={{background:"#050709",borderRadius:"2px",height:"4px"}}>
                            <div style={{background:"#F59E0B",width:`${Math.round(it.b/maxComp*100)}%`,height:"100%",borderRadius:"2px"}}/>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:"12px",marginTop:"4px"}}>
                          <span style={{fontSize:"10px",color:"#0ABFCA"}}>×{it.a}</span>
                          <span style={{fontSize:"10px",color:"#F59E0B"}}>×{it.b}</span>
                        </div>
                      </div>
                    );
                  })
              }
            </>
        }
      </div>
    </>
  );
});

// ── MODAL USUÁRIO ────────────────────────────────────────────────────────
const UserModal = memo(({ mode, userData, users, onSave, onClose }) => {
  const [name,     setName]     = useState(userData?.name||"");
  const [username, setUsername] = useState(userData?.username||"");
  const [password, setPassword] = useState(userData?.password||"");
  const [roles,    setRoles]    = useState(()=>getRoles(userData).length?getRoles(userData):["estoque"]);
  const [active,   setActive]   = useState(userData?.active??true);
  const [showPass, setShowPass] = useState(false);
  const [err,      setErr]      = useState("");

  const toggleRole = (k) => {
    if (SINGLE_ROLES.includes(k)) { setRoles([k]); }
    else {
      setRoles(prev=>{
        const filtered=prev.filter(r=>isSector(r));
        return filtered.includes(k)?(filtered.length>1?filtered.filter(r=>r!==k):filtered):[...filtered,k];
      });
    }
  };

  const save = () => {
    setErr("");
    if (!name.trim())     { setErr("Informe o nome.");    return; }
    if (!username.trim()) { setErr("Informe o usuário.");  return; }
    if (!password.trim()) { setErr("Informe a senha.");    return; }
    if (!roles.length)    { setErr("Selecione um perfil."); return; }
    if (mode==="new" && users.find(u=>u.username===username.trim())) { setErr("Usuário já existe."); return; }
    onSave({...(userData||{}), name:name.trim(), username:username.trim(), password:password.trim(), role:roles[0], roles, active});
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:"16px",fontWeight:"700",color:"#E2E8F0",marginBottom:"4px"}}>{mode==="new"?"Novo Usuário":"Editar Usuário"}</div>
        <div style={{fontSize:"12px",color:"#4B5563",marginBottom:"20px"}}>{mode==="new"?"Crie um acesso para um colaborador":"Altere as informações do colaborador"}</div>

        {[["Nome completo",name,setName,"text","Ex: João Silva"],["Usuário (login)",username,setUsername,"text","Ex: joao.silva"]].map(([label,val,setter,type,ph])=>(
          <div key={label} style={{marginBottom:"12px"}}>
            <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"6px",textTransform:"uppercase",letterSpacing:"1px"}}>{label}</div>
            <input value={val} onChange={e=>{setter(e.target.value);setErr("");}} type={type} placeholder={ph} className="inp" autoCapitalize="none"/>
          </div>
        ))}

        <div style={{marginBottom:"12px"}}>
          <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"6px",textTransform:"uppercase",letterSpacing:"1px"}}>Senha</div>
          <div style={{position:"relative"}}>
            <input value={password} onChange={e=>{setPassword(e.target.value);setErr("");}} type={showPass?"text":"password"} placeholder="Mínimo 6 caracteres" className="inp"/>
            <div onClick={()=>setShowPass(p=>!p)} style={{position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",color:"#4B5563",cursor:"pointer"}}>{showPass?"🙈":"👁️"}</div>
          </div>
        </div>

        <div style={{marginBottom:"16px"}}>
          <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"4px",textTransform:"uppercase",letterSpacing:"1px"}}>Setor / Perfil</div>
          <div style={{fontSize:"11px",color:"#374151",marginBottom:"8px"}}>Setores aceitam múltipla seleção. Admin, Chefia e Comprador são exclusivos.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
            {Object.entries(ROLES).map(([k,v])=>{
              const sel=roles.includes(k);
              return (
                <div key={k} onClick={()=>toggleRole(k)} className="btn"
                  style={{padding:"10px",borderRadius:"10px",border:`1.5px solid ${sel?v.color:"#1E2A30"}`,background:sel?`${v.color}14`:"#050709",display:"flex",alignItems:"center",gap:"8px"}}>
                  <span style={{fontSize:"16px"}}>{v.icon}</span>
                  <span style={{fontSize:"12px",fontWeight:"600",color:sel?v.color:"#4B5563",flex:1}}>{v.label}</span>
                  {sel&&<div style={{width:"8px",height:"8px",borderRadius:"50%",background:v.color,flexShrink:0}}/>}
                </div>
              );
            })}
          </div>
          {roles.length>1&&<div style={{marginTop:"8px",padding:"8px 12px",background:"#0ABFCA12",border:"1px solid #0ABFCA22",borderRadius:"8px",fontSize:"11px",color:"#0ABFCA"}}>✓ Acesso a: {roles.map(r=>ROLES[r]?.label).join(", ")}</div>}
        </div>

        {mode==="edit"&&(
          <div style={{marginBottom:"16px",display:"flex",alignItems:"center",gap:"10px"}}>
            <div onClick={()=>setActive(p=>!p)} className="btn"
              style={{width:"44px",height:"24px",borderRadius:"12px",background:active?"#0ABFCA":"#1E2A30",position:"relative",flexShrink:0,border:`1px solid ${active?"#0ABFCA":"#2A3540"}`,transition:"background .2s"}}>
              <div style={{position:"absolute",top:"3px",left:active?"22px":"3px",width:"16px",height:"16px",borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
            </div>
            <span style={{fontSize:"13px",color:active?"#34D399":"#6B7280",fontWeight:"600"}}>Usuário {active?"ativo":"inativo"}</span>
          </div>
        )}

        {err&&<div style={{background:"#FF4C4C14",border:"1px solid #FF4C4C33",borderRadius:"8px",padding:"8px 12px",fontSize:"12px",color:"#FF4C4C",marginBottom:"12px"}}>{err}</div>}

        <div style={{display:"flex",gap:"8px"}}>
          <div onClick={onClose} className="btn" style={{flex:1,background:"#1E2A30",borderRadius:"12px",padding:"13px",textAlign:"center",color:"#4B5563",fontWeight:"700",fontSize:"14px"}}>Cancelar</div>
          <div onClick={save}    className="btn" style={{flex:2,background:"linear-gradient(135deg,#0891B2,#0ABFCA)",borderRadius:"12px",padding:"13px",textAlign:"center",color:"#fff",fontWeight:"700",fontSize:"14px",boxShadow:"0 4px 16px #0ABFCA33"}}>
            {mode==="new"?"Criar Usuário":"Salvar Alterações"}
          </div>
        </div>
      </div>
    </div>
  );
});

// ── PENDENTES TAB ─────────────────────────────────────────────────────────
const PendentesTab = memo(({ orders }) => {
  const itensPendentes = useMemo(()=>{
    const list=[];
    orders.forEach(o=>{
      if(o.status!=="aprovado") return;
      (o.items||[]).forEach(it=>{
        if(!it.done && it.itemStatus!=="recusado"){
          list.push({...it, orderId:o.id, sectorLabel:o.sectorLabel, createdAt:o.createdAt, priority:o.priority, destino:o.destino});
        }
      });
    });
    return list;
  },[orders]);

  if(itensPendentes.length===0) return <EmptyState icon="✅" text="Nenhum item pendente de compra" sub="Todos os itens aprovados já foram comprados"/>;

  return (
    <>
      <div className="card" style={{padding:"10px 14px",marginBottom:"12px",fontSize:"12px",color:"#0ABFCA88"}}>
        👁️ Visão somente leitura — {itensPendentes.length} {itensPendentes.length===1?"item aguardando":"itens aguardando"} compra
      </div>
      {itensPendentes.map((it,i)=>{
        const pr=PRIORITY[it.priority]||PRIORITY.normal;
        const isChefiaDestino=it.destino==="chefia";
        return (
          <div key={`${it.orderId}-${it.id}-${i}`} className="card" style={{marginBottom:"8px",padding:"12px 16px",display:"flex",alignItems:"center",gap:"12px"}}>
            <div style={{width:"10px",height:"10px",borderRadius:"50%",background:"#0ABFCA",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:"14px",fontWeight:"700",color:"#CBD5E1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
              <div style={{fontSize:"11px",color:"#374151",marginTop:"2px"}}>{it.qty||"—"}{it.obs?` • ${it.obs}`:""}</div>
              <div style={{fontSize:"11px",color:"#2A3540",marginTop:"3px"}}>{it.sectorLabel} • {it.createdAt} • {isChefiaDestino?"🏢 Chefia":"🛒 Comprador"}</div>
            </div>
            <span className="tag" style={{background:pr.bg,color:pr.color,flexShrink:0}}>{pr.label}</span>
          </div>
        );
      })}
    </>
  );
});

// ── RECUSADOS TAB ─────────────────────────────────────────────────────────
const RecusadosTab = memo(({ orders, onApproveItem, onDeleteItem }) => {
  const itensRecusados = useMemo(()=>{
    const list=[];
    orders.forEach(o=>{
      (o.items||[]).forEach(it=>{
        if(it.itemStatus==="recusado"){
          list.push({...it, orderId:o.id, sectorLabel:o.sectorLabel, createdAt:o.createdAt, priority:o.priority});
        }
      });
    });
    return list;
  },[orders]);

  if(itensRecusados.length===0) return <EmptyState icon="🚫" text="Nenhum item recusado" sub="Itens recusados aparecerão aqui"/>;

  return (
    <>
      {itensRecusados.map(it=>{
        const pr=PRIORITY[it.priority]||PRIORITY.normal;
        return (
          <div key={it.id} className="card" style={{marginBottom:"8px",padding:"12px 16px",border:"1px solid #FF4C4C22"}}>
            <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
              <div style={{width:"10px",height:"10px",borderRadius:"50%",background:"#FF4C4C",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:"14px",fontWeight:"700",color:"#6B7280",textDecoration:"line-through",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                <div style={{fontSize:"11px",color:"#374151",marginTop:"2px"}}>{it.qty||"—"}{it.obs?` • ${it.obs}`:""}</div>
                <div style={{fontSize:"11px",color:"#2A3540",marginTop:"3px"}}>{it.sectorLabel} • {it.createdAt}</div>
              </div>
              <span className="tag" style={{background:pr.bg,color:pr.color,flexShrink:0}}>{pr.label}</span>
            </div>
            <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
              <div onClick={()=>onApproveItem(it.orderId,it.id)} className="btn"
                style={{flex:1,background:"#052016",border:"1px solid #34D39933",borderRadius:"8px",padding:"8px",textAlign:"center",color:"#34D399",fontWeight:"700",fontSize:"12px"}}>
                ✅ Aprovar
              </div>
              <div onClick={()=>onDeleteItem(it.orderId,it.id)} className="btn"
                style={{flex:1,background:"#1A0505",border:"1px solid #FF4C4C33",borderRadius:"8px",padding:"8px",textAlign:"center",color:"#FF4C4C",fontWeight:"700",fontSize:"12px"}}>
                🗑️ Excluir
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});

// ── MAIN APP ──────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner/>
    </ErrorBoundary>
  );
}

function AppInner() {
  const [session,  setSession]  = useState(()=>LS.get("cf_session",null));
  const [users,    setUsers]    = useState([]);
  const [userNtfyTopic, setUserNtfyTopic] = useState<string | null>(null);
  const [orders,   setOrders]   = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [toast,    setToast]    = useState(null);
  const originalTitleRef = useRef(typeof document !== "undefined" ? document.title : "CompraFácil");
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as {MSStream?:unknown}).MSStream;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as {standalone?:boolean}).standalone === true;
  const [showIOSInstall, setShowIOSInstall] = useState(isIOS && !isStandalone);
  const [showAndroidInstall, setShowAndroidInstall] = useState(false);
  const deferredInstallPromptRef = useRef<any>(null);

  // Session persists in localStorage only
  useEffect(()=>{ LS.set("cf_session",session);},[session]);

  // Derivar ntfy_topic do estado 'users' quando session ou users mudar
  useEffect(() => {
    if (!session?.id || !users.length) return;
    const currentUser = (users as Array<Record<string, unknown>>)
      .find(u => u.id === session.id);
    setUserNtfyTopic((currentUser?.ntfy_topic as string) ?? null);
  }, [session?.id, users]);

  // ── PUSH/PWA: estado e refs ────────────────────────────────────────────────
  const [notifStatus, setNotifStatus] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const swRegRef = useRef<ServiceWorkerRegistration|null>(null);

  // Registra SW sempre (necessário para instalabilidade do PWA no Android)
  useEffect(()=>{
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(async (reg)=>{
      swRegRef.current = reg;
      await navigator.serviceWorker.ready;
      if (typeof Notification !== "undefined") {
        setNotifStatus(Notification.permission);
      }
    }).catch(e=>console.warn('[SW]', e));
  }, []);

  // Assina push automaticamente quando já há permissão e usuário logado
  useEffect(()=>{
    if (!session?.id || !swRegRef.current || !('PushManager' in window)) return;
    if (notifStatus === 'granted') {
      subscribePush(swRegRef.current, session.id).catch(e => console.warn('[Push subscribe auto]', e));
    }
  }, [session?.id, notifStatus]);

  // Captura evento de instalação no Android (beforeinstallprompt)
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredInstallPromptRef.current = e;
      if (isAndroid && !isStandalone) setShowAndroidInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [isAndroid, isStandalone]);

  // Função chamada APENAS por gesto do usuário (botão) — obrigatório no iOS
  const enableNotifications = useCallback(async ()=>{
    if (!session?.id || !('Notification' in window)) return;
    let reg = swRegRef.current;
    if (!reg && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.register('/sw.js');
      swRegRef.current = reg;
    }
    if (!reg) return;
    const perm = await Notification.requestPermission();
    setNotifStatus(perm);
    if (perm === 'granted') await subscribePush(reg, session.id);
  }, [session?.id]);

  const installAndroidApp = useCallback(async () => {
    const deferredPrompt = deferredInstallPromptRef.current;
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    if (choiceResult?.outcome === 'accepted') {
      setShowAndroidInstall(false);
      deferredInstallPromptRef.current = null;
    }
  }, []);

  // ── BOOT: load users + orders from Supabase ──────────────────────────────
  useEffect(()=>{
    async function boot(){
      // Load users
      const { data: usersData, error: usersErr } = await supabase
        .from("users").select("*").eq("deleted", false);
      if (usersErr) { console.error("[Supabase] boot users:", usersErr); return; }
      if (!usersData || usersData.length === 0) {
        // Seed default users on first run
        const { error: seedErr } = await supabase.from("users").upsert(DEFAULT_USERS);
        if (seedErr) console.error("[Supabase] seed users:", seedErr);
        else setUsers(DEFAULT_USERS);
      } else {
        setUsers(usersData);
      }
      // Load orders
      const { data: ordersData, error: ordersErr } = await supabase
        .from("orders").select("*").order("inserted_at", { ascending: true });
      if (ordersErr) { console.error("[Supabase] boot orders:", ordersErr); return; }
      setOrders(ordersData || []);
    }
    boot();
  },[]);

  const sessionRef   = useRef<typeof session>(null as unknown as typeof session);
  const usersRef     = useRef<typeof users>([]);
  const showToastRef = useRef<typeof showToast>(()=>{});

  // ── REALTIME: keep orders in sync + alertas sonoros ──────────────────────
  useEffect(()=>{
    const channel = supabase
      .channel("orders-realtime")
      .on("postgres_changes",{ event:"*", schema:"public", table:"orders" },(payload)=>{
        if (payload.eventType==="INSERT") {
          setOrders(p=>p.some(o=>o.id===payload.new.id) ? p : [...p, payload.new]);
          // Alerta para novo pedido pendente
          const s = sessionRef.current; const u = usersRef.current;
          if (!s) return;
          const me = u.find(v=>v.id===s.id)||s;
          const o = payload.new;
          const shouldAlert =
            ((isAdmin(me)||isChefia(me)) && o.status==="pendente") ||
            (isComprador(me) && o.status==="pendente" && o.destino==="comprador");
          if (shouldAlert) {
            playAlertSound();
            navigator.vibrate?.([300,100,300,100,300]);
            showToastRef.current(`📋 Novo pedido — ${o.sectorLabel||o.sector_label||"setor"}`, "success");
          }
        } else if (payload.eventType==="UPDATE") {
          setOrders(p=>p.map(o=>o.id===payload.new.id ? payload.new : o));
          // Alerta para pedido aprovado
          const s = sessionRef.current; const u = usersRef.current;
          if (!s) return;
          const me = u.find(v=>v.id===s.id)||s;
          const o = payload.new; const old = payload.old;
          if (o.status==="aprovado" && old?.status !== "aprovado") {
            if (isComprador(me) && o.destino==="comprador") {
              playAlertSound();
              navigator.vibrate?.([300,100,300,100,300]);
              showToastRef.current("✅ Pedido aprovado — pronto para compra", "success");
            } else if (isChefia(me) && o.destino==="chefia") {
              playAlertSound();
              navigator.vibrate?.([300,100,300]);
              showToastRef.current("✅ Pedido aprovado aguarda sua compra", "success");
            }
          }
        } else if (payload.eventType==="DELETE") {
          setOrders(p=>p.filter(o=>o.id!==payload.old.id));
        }
      })
      .subscribe();
    return ()=>{ supabase.removeChannel(channel); };
  },[]);

  // ── DB WRAPPERS: optimistic local update + Supabase persist ──────────────
  const dbSetOrders = useCallback((updaterOrValue)=>{
    setOrders(prev=>{
      const next = typeof updaterOrValue==="function" ? updaterOrValue(prev) : updaterOrValue;
      // Detect deleted orders
      const nextIds = new Set(next.map(o=>o.id));
      const deleted = prev.filter(o=>!nextIds.has(o.id));
      // Detect added/changed orders
      const prevMap = Object.fromEntries(prev.map(o=>[o.id,o]));
      const changed = next.filter(o=>{ const p=prevMap[o.id]; return !p||JSON.stringify(p)!==JSON.stringify(o); });
      if (deleted.length>0) {
        deleted.forEach(o=>{
          supabase.from("orders").delete().eq("id",o.id)
            .then(({error})=>{ if(error) console.error("[Supabase] delete order:",error); });
        });
      }
      if (changed.length>0) {
        supabase.from("orders").upsert(changed)
          .then(({error})=>{ if(error) console.error("[Supabase] upsert orders:",error); });
      }
      return next;
    });
  },[]);

  const dbSetUsers = useCallback((updaterOrValue)=>{
    setUsers(prev=>{
      const next = typeof updaterOrValue==="function" ? updaterOrValue(prev) : updaterOrValue;
      const prevMap = Object.fromEntries(prev.map(u=>[u.id,u]));
      const changed = next.filter(u=>{ const p=prevMap[u.id]; return !p||JSON.stringify(p)!==JSON.stringify(u); });
      if (changed.length>0) {
        supabase.from("users").upsert(changed)
          .then(({error})=>{ if(error) console.error("[Supabase] upsert users:",error); });
      }
      return next;
    });
  },[]);

  const showToast = useCallback((msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),2800); },[]);
  const logout    = useCallback(()=>setSession(null),[]);

  useEffect(()=>{ sessionRef.current = session; },[session]);
  useEffect(()=>{ usersRef.current = users; },[users]);
  useEffect(()=>{ showToastRef.current = showToast; },[showToast]);

  const pendingApproval = useMemo(()=>orders.filter(o=>o.status==="pendente").length,[orders]);
  const pendingBuy = useMemo(()=>orders.filter(o=>o.status==="aprovado"&&(o.destino===session?.id||o.destino==="comprador")&&(o.items||[]).some(i=>!i.done&&i.itemStatus!=="recusado")).length,[orders,session]);
  const pendingChefia   = useMemo(()=>orders.filter(o=>o.status==="aprovado"&&o.destino==="chefia"&&(o.items||[]).some(i=>!i.done&&i.itemStatus!=="recusado")).length,[orders]);

  // ── APP BADGE API + fallback de título na aba ────────────────────────────
  useEffect(()=>{
    if(!session){
      if ("setAppBadge" in navigator) navigator.clearAppBadge?.().catch?.(()=>{});
      if (typeof document !== "undefined") document.title = originalTitleRef.current;
      return;
    }
    const u = users.find(v=>v.id===session.id)||session;
    let count = 0;
    if(isAdmin(u))          count = pendingApproval;
    else if(isChefia(u))    count = pendingApproval + pendingChefia;
    else if(isComprador(u)) count = pendingBuy;
    if ("setAppBadge" in navigator) {
      if(count > 0) navigator.setAppBadge(count).catch(()=>{});
      else navigator.clearAppBadge?.().catch?.(()=>{});
    }
    if (typeof document !== "undefined") {
      document.title = count > 0
        ? `(${count}) ${originalTitleRef.current}`
        : originalTitleRef.current;
    }
  },[session, users, pendingApproval, pendingBuy, pendingChefia]);

  if (!session) return <LoginScreen users={users} onLogin={setSession} showToast={showToast} toast={toast}/>;

  const user = users.find(u=>u.id===session.id)||session;
  const props = { user, users, setUsers:dbSetUsers, orders, setOrders:dbSetOrders, onLogout:logout, showToast, toast, lightbox, setLightbox };
  const showNotifBanner = notifStatus === 'default'
    && 'PushManager' in window
    && (!isIOS || isRunningStandalone());

  let screen;
  if (isAdmin(user))         screen = <AdminScreen    {...props} pendingApproval={pendingApproval}/>;
  else if (isChefia(user))   screen = <ChefiaScreen   {...props} users={users} pendingApproval={pendingApproval} pendingChefia={pendingChefia}/>;
  else if (isComprador(user))screen = <CompradorScreen {...props} pendingBuy={pendingBuy}/>;
  else                       screen = <SectorScreen {...props} users={users}/>;

  return (
    <>
      {showNotifBanner && <NotifBanner onEnable={enableNotifications} onDismiss={()=>setNotifStatus('denied')}/>}
      {showIOSInstall  && <IOSInstallBanner onDismiss={()=>setShowIOSInstall(false)}/>}
      {showAndroidInstall && (
        <AndroidInstallBanner
          onInstall={installAndroidApp}
          onDismiss={() => setShowAndroidInstall(false)}
        />
      )}
      {session && (isRunningStandalone() || isIOS) && (
        <NtfySetupCard
          userId={session.id}
          currentNtfyTopic={userNtfyTopic}
          onConfigured={() => {
            supabase.from("users").select("*").eq("deleted", false)
              .then(({ data }) => { if (data) setUsers(data); });
          }}
          onRevoked={() => {
            setUserNtfyTopic(null);
            supabase.from("users").select("*").eq("deleted", false)
              .then(({ data }) => { if (data) setUsers(data); });
          }}
        />
      )}
      {screen}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin, showToast, toast }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState("");
  const [attempts, setAttempts] = useState(0);
  const BLOCKED = attempts >= 5;

  const handleLogin = () => {
    if (BLOCKED) { setErr("Muitas tentativas. Aguarde 30 segundos."); return; }
    setErr("");
    if (!username.trim()||!password.trim()) { setErr("Preencha usuário e senha."); return; }
    setLoading(true);
    setTimeout(()=>{
      const u=users.find(u=>u.username===username.trim()&&u.password===password&&u.active&&!u.deleted);
      if(u){ onLogin(u); }
      else {
        const next = attempts + 1;
        setAttempts(next);
        if (next >= 5) {
          setErr("Acesso bloqueado por 30 segundos.");
          setTimeout(()=>{ setAttempts(0); setErr(""); }, 30000);
        } else {
          setErr(`Usuário ou senha incorretos. (${next}/5)`);
        }
        setLoading(false);
      }
    },600);
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100dvh",background:"#030608",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 16px",position:"relative",overflow:"hidden"}}>
      <style>{CSS}</style>

      {/* Ambient glow blobs */}
      <div style={{position:"absolute",top:"10%",left:"50%",transform:"translateX(-50%)",width:"500px",height:"340px",background:"radial-gradient(ellipse at 50% 40%, rgba(10,191,202,0.10) 0%, transparent 65%)",pointerEvents:"none",zIndex:0}}/>
      <div style={{position:"absolute",bottom:"8%",right:"10%",width:"260px",height:"260px",background:"radial-gradient(ellipse, rgba(10,191,202,0.05) 0%, transparent 70%)",pointerEvents:"none",zIndex:0}}/>

      <ToastEl toast={toast}/>

      {/* ── Logo section ── */}
      <div style={{textAlign:"center",marginBottom:"36px",maxWidth:"390px",width:"100%",animation:"fadeUp .65s ease both",position:"relative",zIndex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
          <div className="tl" style={{flex:1,opacity:.5}}/>
          <span style={{color:"#0ABFCA",fontSize:"9px",letterSpacing:"0.42em",whiteSpace:"nowrap",fontWeight:"600",opacity:.8,textTransform:"uppercase"}}>Sistema de Compras</span>
          <div className="tl" style={{flex:1,opacity:.5}}/>
        </div>

        {/* Logo — transparent, no box */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:"28px"}}>
          <CarpeDiemLogo width={200}/>
        </div>

        <div><div className="tl" style={{opacity:.6}}/></div>
      </div>

      {/* ── Login card ── */}
      <div style={{width:"100%",maxWidth:"390px",animation:"fadeUp .65s .2s ease both",opacity:0,animationFillMode:"both",position:"relative",zIndex:1}}>
        <div style={{padding:"32px 28px 28px",background:"linear-gradient(160deg,rgba(7,16,30,.97),rgba(4,11,22,.98))",border:"1px solid rgba(10,191,202,.18)",borderRadius:"20px",boxShadow:"0 24px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(10,191,202,.04), inset 0 1px 0 rgba(10,191,202,.07)"}}>

          <div style={{fontSize:"38px",fontWeight:"700",lineHeight:1.05,color:"#f0f4fa",marginBottom:"6px",letterSpacing:"-0.02em"}}>Entrar</div>
          <div style={{fontSize:"13px",color:"#3d5166",marginBottom:"28px",fontWeight:"400"}}>Acesso restrito a colaboradores</div>

          {/* Usuário */}
          <div style={{marginBottom:"16px"}}>
            <label htmlFor="lg-user" style={{display:"block",fontSize:"10px",fontWeight:"600",color:"#4d6478",marginBottom:"8px",textTransform:"uppercase",letterSpacing:"0.22em"}}>Usuário</label>
            <input id="lg-user" value={username} onChange={e=>{setUsername(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="seu.usuario" className={`inp${err?" inp-err":""}`} autoCapitalize="none" autoComplete="username" style={{height:"46px",fontSize:"14px",padding:"0 14px"}}/>
          </div>

          {/* Senha */}
          <div style={{marginBottom:"6px"}}>
            <label htmlFor="lg-pass" style={{display:"block",fontSize:"10px",fontWeight:"600",color:"#4d6478",marginBottom:"8px",textTransform:"uppercase",letterSpacing:"0.22em"}}>Senha</label>
            <div style={{position:"relative"}}>
              <input id="lg-pass" value={password} onChange={e=>{setPassword(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} type={showPass?"text":"password"} placeholder="••••••••" className={`inp${err?" inp-err":""}`} autoComplete="current-password" style={{height:"46px",fontSize:"14px",padding:"0 46px 0 14px"}}/>
              <button type="button" onClick={()=>setShowPass(p=>!p)} aria-label={showPass?"Ocultar senha":"Mostrar senha"} style={{position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:"#4d6478",cursor:"pointer",padding:"4px",display:"flex",alignItems:"center",justifyContent:"center",transition:"color .2s"}}
                onMouseEnter={e=>(e.currentTarget.style.color="#0ABFCA")} onMouseLeave={e=>(e.currentTarget.style.color="#4d6478")}>
                {showPass
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          {/* Error */}
          {err && (
            <div style={{fontSize:"12px",color:"#fc6b6b",marginTop:"10px",marginBottom:"4px",padding:"10px 14px",background:"rgba(255,76,76,0.07)",border:"1px solid rgba(255,76,76,0.22)",borderRadius:"10px",display:"flex",alignItems:"center",gap:"8px"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {err}
            </div>
          )}

          {/* Botão */}
          <button type="button" onClick={handleLogin} disabled={loading||BLOCKED}
            style={{width:"100%",background:loading||BLOCKED?"rgba(20,32,44,.7)":"linear-gradient(135deg,#0ABFCA 0%,#07a8b6 100%)",borderRadius:"12px",padding:"0",height:"50px",textAlign:"center",color:loading||BLOCKED?"#2e4455":"#fff",fontWeight:"700",fontSize:"16px",lineHeight:1,marginTop:"18px",boxShadow:loading||BLOCKED?"none":"0 8px 28px rgba(10,191,202,.3), 0 2px 6px rgba(10,191,202,.15)",border:"none",cursor:loading||BLOCKED?"not-allowed":"pointer",transition:"all .2s ease",fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.02em",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}
            onMouseEnter={e=>{ if(!loading&&!BLOCKED)(e.currentTarget as HTMLButtonElement).style.boxShadow="0 12px 36px rgba(10,191,202,.45), 0 2px 8px rgba(10,191,202,.2)"; }}
            onMouseLeave={e=>{ if(!loading&&!BLOCKED)(e.currentTarget as HTMLButtonElement).style.boxShadow="0 8px 28px rgba(10,191,202,.3), 0 2px 6px rgba(10,191,202,.15)"; }}>
            {loading
              ? <><svg style={{animation:"spin 0.9s linear infinite"}} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Entrando...</>
              : "Entrar"}
          </button>
        </div>
        <div style={{marginTop:"24px",textAlign:"center",color:"#6a7686",fontSize:"11px",opacity:.35}}>CompraFácil © {new Date().getFullYear()}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN SCREEN
// ─────────────────────────────────────────────────────────────────────────
function AdminScreen({ user, users, setUsers, orders, setOrders, onLogout, showToast, toast, lightbox, setLightbox, pendingApproval }) {
  const [tab, setTab]           = useState("pedidos");
  const [userModal, setUserModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const recusadosCount = useMemo(()=>{
    let count=0;
    orders.forEach(o=>(o.items||[]).forEach(it=>{ if(it.itemStatus==="recusado") count++; }));
    return count;
  },[orders]);

  const pendentesCount = useMemo(()=>{
    let count=0;
    orders.forEach(o=>{ if(o.status==="aprovado") (o.items||[]).forEach(it=>{ if(!it.done&&it.itemStatus!=="recusado") count++; }); });
    return count;
  },[orders]);

  const tabs = [
    {key:"pedidos",   label:`Pedidos${pendingApproval>0?` (${pendingApproval})`:""}`},
    {key:"pendentes", label:`Em Compra${pendentesCount>0?` (${pendentesCount})`:""}`},
    {key:"recusados", label:`Recusados${recusadosCount>0?` (${recusadosCount})`:""}`},
    {key:"usuarios",  label:"Usuários"},
    {key:"relatorio", label:"Relatório"},
  ];

  const handleApprove = useCallback((orderId, updatedItems, newStatus) => {
    setOrders(p=>p.map(o=>o.id===orderId?{...o,status:newStatus,items:updatedItems}:o));
    if (newStatus==="aprovado") {
      showToast("Pedido aprovado! ✅");
    } else {
      showToast("Todos os itens foram recusados.","error");
      setTimeout(()=>setTab("recusados"), 400);
    }
  },[setOrders,showToast]);

  const handleApproveItem = useCallback((orderId, itemId)=>{
    setOrders(p=>p.map(o=>{
      if(o.id!==orderId) return o;
      const items=o.items.map(it=>it.id===itemId?{...it,itemStatus:"aprovado",done:false}:it);
      const allRecused=items.every(it=>it.itemStatus==="recusado");
      return {...o, items, status:allRecused?"recusado":"aprovado"};
    }));
    showToast("Item aprovado e disponível para compra! ✅");
  },[setOrders,showToast]);

  const handleDeleteItem = useCallback((orderId, itemId)=>{
    setOrders(p=>p.map(o=>{
      if(o.id!==orderId) return o;
      const items=o.items.filter(it=>it.id!==itemId);
      if(items.length===0) return null;
      const allRecused=items.every(it=>it.itemStatus==="recusado");
      return {...o, items, status:allRecused?"recusado":"aprovado"};
    }).filter(Boolean));
    showToast("Item excluído.");
  },[setOrders,showToast]);

  const handleReject = useCallback((orderId) => {
    setOrders(p=>p.map(o=>o.id===orderId?{...o,status:"recusado"}:o));
    showToast("Pedido recusado — ficou pendente para reanálise.","error");
  },[setOrders,showToast]);

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"#070B0D",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <LightboxEl src={lightbox} onClose={()=>setLightbox(null)}/>
      <ToastEl toast={toast}/>
      {userModal!==null&&(
        <UserModal mode={userModal==="new"?"new":"edit"} userData={userModal==="new"?null:userModal} users={users}
          onSave={data=>{
            if(userModal==="new"){setUsers(p=>[...p,{...data,id:Date.now().toString(),active:true}]);showToast("Usuário criado! ✅");}
            else{setUsers(p=>p.map(u=>u.id===data.id?data:u));showToast("Usuário atualizado! ✅");}
            setUserModal(null);
          }}
          onClose={()=>setUserModal(null)}/>
      )}
      {confirmModal&&<ConfirmModal {...confirmModal} onClose={()=>setConfirmModal(null)}/>}

      <Topbar user={user} onLogout={onLogout}>
        {pendingApproval>0&&<div style={{background:"#FF4C4C",color:"#fff",borderRadius:"20px",padding:"3px 10px",fontSize:"11px",fontWeight:"700",animation:"pulse 2s infinite"}}>{pendingApproval} pend.</div>}
      </Topbar>
      <TabBar tabs={tabs} active={tab} onSelect={setTab}/>

      <div style={{flex:1,overflowY:"auto",padding:"16px",maxWidth:"640px",width:"100%",margin:"0 auto"}}>
        {tab==="pedidos"&&<ApprovalPanel orders={orders} onApprove={handleApprove} onReject={handleReject} onDelete={id=>{ setOrders(p=>p.filter(o=>o.id!==id)); showToast("Pedido excluído."); }} userRole="admin"/>}
        {tab==="pendentes"&&<PendentesTab orders={orders}/>}
        {tab==="recusados"&&<RecusadosTab orders={orders} onApproveItem={handleApproveItem} onDeleteItem={handleDeleteItem}/>}
        {tab==="usuarios"&&(
          <>
            <div onClick={()=>setUserModal("new")} className="btn"
              style={{background:"linear-gradient(135deg,#0891B2,#0ABFCA)",borderRadius:"14px",padding:"14px",textAlign:"center",color:"#fff",fontWeight:"700",fontSize:"14px",marginBottom:"16px",boxShadow:"0 4px 20px #0ABFCA33"}}>
              + Novo Usuário
            </div>
            {users.filter(u=>!u.deleted).map(u=>{
              const userRoles=getRoles(u); const pr=ROLES[userRoles[0]]||ROLES.estoque;
              return (
                <div key={u.id} className="card" style={{padding:"14px 16px",marginBottom:"8px",display:"flex",alignItems:"center",gap:"12px"}}>
                  <div onClick={()=>setUserModal(u)} style={{width:"40px",height:"40px",borderRadius:"12px",background:`${pr.color}14`,border:`1px solid ${pr.color}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",flexShrink:0,cursor:"pointer"}}>{pr.icon}</div>
                  <div onClick={()=>setUserModal(u)} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                    <div style={{fontWeight:"700",color:"#E2E8F0",fontSize:"14px"}}>{u.name}</div>
                    <div style={{color:"#4B5563",fontSize:"12px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>@{u.username} • {userRoles.map(r=>ROLES[r]?.label||r).join(", ")}</div>
                  </div>
                  <span className="tag" style={{background:u.active?"#052016":"#1A1A1A",color:u.active?"#34D399":"#6B7280",flexShrink:0}}>{u.active?"Ativo":"Inativo"}</span>
                  <div onClick={e=>{
                    e.stopPropagation();
                    if(u.id===user.id){showToast("Você não pode excluir seu próprio acesso.","error");return;}
                    if(window.confirm(`Excluir "${u.name}"? O histórico de pedidos será preservado.`)){
                      setUsers(p=>p.map(x=>x.id===u.id?{...x,deleted:true,active:false}:x));
                      showToast(`${u.name} foi removido. ✅`);
                    }
                  }} className="btn" style={{color:"#FF4C4C",fontSize:"13px",padding:"6px 10px",borderRadius:"8px",border:"1px solid #FF4C4C22",background:"#FF4C4C0A",flexShrink:0}}>
                    🗑
                  </div>
                </div>
              );
            })}
          </>
        )}
        {tab==="relatorio"&&<RelatorioTab orders={orders} users={users}/>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CHEFIA SCREEN
// ─────────────────────────────────────────────────────────────────────────
function ChefiaScreen({ user, users, orders, setOrders, onLogout, showToast, toast, lightbox, setLightbox, pendingApproval, pendingChefia }) {
  const [tab, setTab] = useState("aprovacao");

  const [openOrder, setOpenOrder] = useState(null);
  const togglingRef               = useRef(new Set());

  const recusadosCount = useMemo(()=>{
    let count=0;
    orders.forEach(o=>(o.items||[]).forEach(it=>{ if(it.itemStatus==="recusado") count++; }));
    return count;
  },[orders]);

  const pendentesCount = useMemo(()=>{
    let count=0;
    orders.forEach(o=>{ if(o.status==="aprovado") (o.items||[]).forEach(it=>{ if(!it.done&&it.itemStatus!=="recusado") count++; }); });
    return count;
  },[orders]);

  const tabs = [
    {key:"aprovacao", label:`Aprovação${pendingApproval>0?` (${pendingApproval})`:""}`},
    {key:"compras",   label:`Compras${pendingChefia>0?` (${pendingChefia})`:""}`  , highlight:pendingChefia>0},
    {key:"pendentes", label:`Em Compra${pendentesCount>0?` (${pendentesCount})`:""}`},
    {key:"recusados", label:`Recusados${recusadosCount>0?` (${recusadosCount})`:""}`},
    {key:"relatorio", label:"Relatório"},
  ];

  const handleApprove = useCallback((orderId, updatedItems, newStatus) => {
    setOrders(p=>p.map(o=>o.id===orderId?{...o,status:newStatus,items:updatedItems}:o));
    if (newStatus==="aprovado") {
      showToast("Pedido aprovado! ✅");
      setTimeout(()=>setTab("compras"), 400);
    } else {
      showToast("Todos os itens foram recusados.","error");
      setTimeout(()=>setTab("recusados"), 400);
    }
  },[setOrders,showToast]);

  const handleReject = useCallback((orderId) => {
    setOrders(p=>p.map(o=>o.id===orderId?{...o,status:"recusado"}:o));
    showToast("Pedido recusado.","error");
    setTimeout(()=>setTab("recusados"), 400);
  },[setOrders,showToast]);

  const handleApproveItem = useCallback((orderId, itemId)=>{
    setOrders(p=>p.map(o=>{
      if(o.id!==orderId) return o;
      const items=o.items.map(it=>it.id===itemId?{...it,itemStatus:"aprovado",done:false}:it);
      const allRecused=items.every(it=>it.itemStatus==="recusado");
      return {...o, items, status:allRecused?"recusado":"aprovado"};
    }));
    showToast("Item aprovado e disponível para compra! ✅");
  },[setOrders,showToast]);

  const handleDeleteItem = useCallback((orderId, itemId)=>{
    setOrders(p=>p.map(o=>{
      if(o.id!==orderId) return o;
      const items=o.items.filter(it=>it.id!==itemId);
      if(items.length===0) return null;
      const allRecused=items.every(it=>it.itemStatus==="recusado");
      return {...o, items, status:allRecused?"recusado":"aprovado"};
    }).filter(Boolean));
    showToast("Item excluído.");
  },[setOrders,showToast]);

  const toggleItem = useCallback((oid,iid)=>{
    const key=`${oid}-${iid}`;
    if(togglingRef.current.has(key)) return;
    togglingRef.current.add(key);
    setTimeout(()=>togglingRef.current.delete(key), 400);
    setOrders(p=>p.map(o=>{
      if(o.id!==oid) return o;
      const items=o.items.map(it=>it.id===iid?{...it,done:!it.done}:it);
      const allDone=items.filter(i=>i.itemStatus!=="recusado").every(i=>i.done);
      if(allDone) setTimeout(()=>setOpenOrder(null),300);
      return {...o,items,status:allDone?"concluido":"aprovado"};
    }));
  },[setOrders]);

  // Pedidos aprovados destinados à chefia
  const chefiaOrders = useMemo(()=>orders.filter(o=>o.status==="aprovado"&&o.destino==="chefia"),[orders]);

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"#070B0D",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <LightboxEl src={lightbox} onClose={()=>setLightbox(null)}/>
      <ToastEl toast={toast}/>
      <Topbar user={user} onLogout={onLogout}>
        {(pendingApproval>0||pendingChefia>0)&&<div style={{background:"#FF4C4C",color:"#fff",borderRadius:"20px",padding:"3px 10px",fontSize:"11px",fontWeight:"700",animation:"pulse 2s infinite"}}>{pendingApproval+pendingChefia}</div>}
      </Topbar>
      <TabBar tabs={tabs} active={tab} onSelect={setTab}/>

      <div style={{flex:1,overflowY:"auto",padding:"16px",maxWidth:"640px",width:"100%",margin:"0 auto"}}>
        {tab==="aprovacao"&&<ApprovalPanel orders={orders} onApprove={handleApprove} onReject={handleReject} onDelete={id=>{ setOrders(p=>p.filter(o=>o.id!==id)); showToast("Pedido excluído."); }} userRole="chefia"/>}

        {tab==="pendentes"&&<PendentesTab orders={orders}/>}

        {tab==="recusados"&&<RecusadosTab orders={orders} onApproveItem={handleApproveItem} onDeleteItem={handleDeleteItem}/>}

        {tab==="compras"&&(
          chefiaOrders.length===0
            ? <EmptyState icon="🏢" text="Nenhum pedido para Chefia no momento"/>
            : chefiaOrders.map(o=>{
                const done=o.items.filter(i=>i.done&&i.itemStatus!=="recusado").length;
                const total=o.items.filter(i=>i.itemStatus!=="recusado").length;
                const pct=total?Math.round(done/total*100):0;
                const pr=PRIORITY[o.priority]||PRIORITY.normal;
                const roleInfo=ROLES[o.userRole]||ROLES.estoque;
                const isOpen=openOrder===o.id;
                const allDone=pct===100;
                return (
                  <div key={o.id} className="card" style={{marginBottom:"10px",overflow:"hidden",border:`1px solid ${allDone?"#1E2A30":"#F59E0B44"}`,background:allDone?"#0D1117":"#110E00"}}>
                    <div style={{background:"#F59E0B",padding:"6px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontSize:"11px",fontWeight:"700",color:"#000",letterSpacing:".8px",textTransform:"uppercase"}}>🏢 Em Compra — Chefia</span>
                      <span className="tag" style={{background:"#00000022",color:"#000",fontSize:"10px"}}>{pr.label}</span>
                    </div>
                    <div className="btn" onClick={()=>setOpenOrder(isOpen?null:o.id)} style={{padding:"14px 16px 12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <div style={{width:"34px",height:"34px",borderRadius:"10px",background:"#F59E0B12",border:"1px solid #F59E0B44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"17px"}}>{roleInfo.icon}</div>
                          <div>
                            <div style={{fontWeight:"700",fontSize:"14px",color:"#E2E8F0"}}>{o.sectorLabel}</div>
                            <div style={{color:"#4B5563",fontSize:"11px"}}>{o.userName} • {o.createdAt}</div>
                          </div>
                        </div>
                        <div style={{color:"#2A3540",fontSize:"11px"}}>{isOpen?"▲":"▼"}</div>
                      </div>
                      <div style={{background:"#050709",borderRadius:"4px",height:"4px"}}>
                        <div style={{background:allDone?"#34D399":"#F59E0B",width:`${pct}%`,height:"100%",borderRadius:"4px",transition:"width .5s",boxShadow:allDone?"0 0 6px #34D39955":"0 0 6px #F59E0B55"}}/>
                      </div>
                      <div style={{fontSize:"11px",color:"#4B5563",marginTop:"5px"}}>{done}/{total} comprados {allDone?"✅":""}</div>
                    </div>
                    {isOpen&&(
                      <div style={{borderTop:"1px solid #F59E0B22",padding:"8px 16px 14px"}}>
                        {o.items.filter(i=>i.itemStatus!=="recusado").map(it=>(
                          <div key={it.id} className="btn" onClick={()=>toggleItem(o.id,it.id)}
                            style={{display:"flex",alignItems:"center",gap:"12px",padding:"11px 0",borderBottom:"1px solid #1A2025"}}>
                            <div style={{width:"22px",height:"22px",borderRadius:"6px",border:`2px solid ${it.done?"#34D399":"#F59E0B"}`,background:it.done?"#34D399":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",color:"#000",flexShrink:0,boxShadow:it.done?"0 0 8px #34D39955":"0 0 6px #F59E0B55",transition:"all .2s"}}>
                              {it.done?"✓":""}
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:"14px",fontWeight:"600",color:it.done?"#374151":"#CBD5E1",textDecoration:it.done?"line-through":"none"}}>{it.name}</div>
                              <div style={{fontSize:"12px",color:"#374151"}}>{it.qty}{it.obs?` • ${it.obs}`:""}</div>
                            </div>
                            {it.img&&<img src={it.img} alt="" onClick={e=>{e.stopPropagation();setLightbox(it.img);}} style={{width:"44px",height:"44px",borderRadius:"8px",objectFit:"cover",border:"1px solid #F59E0B33",cursor:"pointer"}}/>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
        )}

        {tab==="relatorio"&&<RelatorioTab orders={orders} users={users}/>}
      </div>
    </div>
  );
}

// ── DESTINO SELECTOR ─────────────────────────────────────────────────────
const DestinoSelector = memo(({ isEstoque, compradores, destino, setDestino }) => {
  if (!isEstoque) return null;
  return (
    <div className="card" style={{padding:"14px",marginBottom:"12px"}}>
      <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"1.2px"}}>Destino do Pedido</div>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {compradores.map(c=>(
          <div key={c.id} onClick={()=>setDestino(c.id)} className="btn"
            style={{padding:"10px 14px",borderRadius:"10px",border:`1.5px solid ${destino===c.id?"#34D399":"#1E2A30"}`,background:destino===c.id?"#34D39914":"#050709",color:destino===c.id?"#34D399":"#4B5563",fontSize:"13px",fontWeight:"700",display:"flex",alignItems:"center",gap:"8px"}}>
            🛒 {c.name}
            <span style={{fontSize:"11px",fontWeight:"400",opacity:.6}}>(Comprador)</span>
            {destino===c.id&&<div style={{marginLeft:"auto",width:"8px",height:"8px",borderRadius:"50%",background:"#34D399"}}/>}
          </div>
        ))}
        <div onClick={()=>setDestino("chefia")} className="btn"
          style={{padding:"10px 14px",borderRadius:"10px",border:`1.5px solid ${destino==="chefia"?"#F59E0B":"#1E2A30"}`,background:destino==="chefia"?"#F59E0B14":"#050709",color:destino==="chefia"?"#F59E0B":"#4B5563",fontSize:"13px",fontWeight:"700",display:"flex",alignItems:"center",gap:"8px"}}>
          🏢 Chefia
          {destino==="chefia"&&<div style={{marginLeft:"auto",width:"8px",height:"8px",borderRadius:"50%",background:"#F59E0B"}}/>}
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────
// SECTOR SCREEN
// ─────────────────────────────────────────────────────────────────────────
function SectorScreen({ user, users, orders, setOrders, onLogout, showToast, toast, lightbox, setLightbox }) {
  const userSectorRoles = useMemo(()=>getRoles(user).filter(isSector),[user]);
  const [activeSector, setActiveSector] = useState(userSectorRoles[0]||"estoque");
  const currentRole = ROLES[activeSector]||ROLES.estoque;
  const isEstoque = activeSector==="estoque";

  const compradores = useMemo(()=>users.filter(u=>isComprador(u)&&u.active),[users]);
  const firstCompradorId = useMemo(()=>compradores[0]?.id||"comprador",[compradores]);

  const [tab,        setTab]        = useState("novo");
  const [priority,   setPriority]   = useState("normal");
  const [destino,    setDestino]    = useState(()=>compradores[0]?.id||"comprador");
  const [newName,    setNewName]    = useState("");
  const [newQty,     setNewQty]     = useState("");
  const [newObs,     setNewObs]     = useState("");
  const [newImg,     setNewImg]     = useState(null);
  const [addedItems, setAddedItems] = useState([]);
  const [excelItems, setExcelItems] = useState([]);
  const [excelFile,  setExcelFile]  = useState("");
  const [excelPri,   setExcelPri]   = useState("normal");
  const fileRef  = useRef(null);
  const photoRef = useRef(null);

  const myOrders = useMemo(()=>orders.filter(o=>o.userId===user.id),[orders,user.id]);

  const hasConstrucaoActive = useMemo(()=>
    activeSector==="construcao" && myOrders.some(o=>o.status==="pendente"||o.status==="aprovado")
  ,[activeSector, myOrders]);

  const tabs = [
    {key:"novo",  label:"Novo Pedido"},
    ...(isEstoque?[{key:"excel",label:"📊 Excel"}]:[]),
    {key:"hist",  label:"Meus Pedidos", highlight:hasConstrucaoActive},
  ];

  const handleSectorChange = (s) => {
    setActiveSector(s); setAddedItems([]); setNewName(""); setNewQty(""); setNewObs(""); setNewImg(null);
    setExcelItems([]); setExcelFile(""); setTab("novo"); setDestino(firstCompradorId);
  };

  const handlePhoto = e => {
    const f=e.target.files[0]; if(!f) return;
    if(!f.type.startsWith("image/")){ showToast("Selecione uma imagem válida.","error"); return; }
    if(f.size>5*1024*1024){ showToast("Imagem muito grande. Máximo 5MB.","error"); return; }
    const r=new FileReader(); r.onload=ev=>setNewImg(ev.target.result); r.readAsDataURL(f);
  };

  const handleAdd = () => {
    if(!newName.trim()){showToast("Digite o nome do item!","error");return;}
    setAddedItems(p=>[...p,{id:Date.now(),name:newName.trim(),qty:newQty.trim(),obs:newObs.trim(),img:newImg,done:false,itemStatus:"aprovado"}]);
    setNewName(""); setNewQty(""); setNewObs(""); setNewImg(null);
    if(photoRef.current) photoRef.current.value="";
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitOrder = () => {
    if(isSubmitting) return;
    if(!addedItems.length){showToast("Adicione ao menos um item!","error");return;}
    setIsSubmitting(true);
    setOrders(p=>[...p,{
      id:Date.now(), userId:user.id, userName:user.name,
      sector:activeSector, sectorLabel:currentRole.label, userRole:activeSector,
      createdAt:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
      createdDate:new Date().toLocaleDateString("pt-BR"),
      priority, status: (isEstoque&&destino==="chefia") ? "aprovado" : "pendente",
      destino: activeSector==="construcao" ? "chefia" : (isEstoque ? destino : "comprador"),
      items:addedItems.map((it,i)=>({...it,id:i+1})),
    }]);
    setAddedItems([]); setNewName(""); setNewQty(""); setNewObs(""); setNewImg(null); setPriority("normal"); setDestino(firstCompradorId);
    showToast("Pedido enviado! ✅");
    setTimeout(()=>setIsSubmitting(false), 1500);
  };

  const handleExcelImport = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";

    const validExt = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
    if (!validExt) { showToast("Use um arquivo .xlsx ou .xls","error"); return; }

    setExcelFile(file.name);
    setExcelItems([]);

    // Garante q o módulo está carregado ANTES de iniciar o FileReader
    const reader = new FileReader();
    reader.onerror = () => { showToast("Erro ao ler o arquivo. Tente novamente.","error"); setExcelFile(""); };

    // onload agora é síncrono — XLSX já está em memória
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) throw new Error("Arquivo vazio ou ilegível");

        const wb = XLSX.read(new Uint8Array(data), { type:"array" });
        if (!wb?.SheetNames?.length) throw new Error("Planilha sem abas");

        const sn = wb.SheetNames.includes("Pedido_Estoque") ? "Pedido_Estoque" : wb.SheetNames[0];
        const sheet = wb.Sheets[sn];
        if (!sheet) throw new Error("Aba não encontrada");

        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:"" });
        if (!rows?.length) throw new Error("Planilha vazia");

        let hi = rows.findIndex(r => r.some(c => String(c).toLowerCase().includes("nome do item")));
        if (hi === -1) hi = 2;

        const parsed = rows.slice(hi+2)
          .filter(r => String(r[0] ?? "").trim())
          .map((r, i) => ({
            id: i+1,
            name: String(r[0] ?? "").trim(),
            qty:  String(r[1] ?? "").trim(),
            obs:  [r[2], r[4]].filter(v => String(v ?? "").trim()).join(" • "),
            img: null, done: false, itemStatus: "aprovado",
            _pri: parsePriority(r[3]),
          }));

        if (!parsed.length) { showToast("Nenhum item encontrado na planilha.","error"); setExcelFile(""); return; }

        const pris = [...new Set(parsed.map(p => p._pri))];
        setExcelPri(pris.length === 1 ? pris[0] : "normal");
        setExcelItems(parsed);
        showToast(`${parsed.length} ${parsed.length===1?"item importado":"itens importados"}! ✅`);
      } catch (err) {
        console.error("[XLSX]", err);
        showToast(`Erro ao processar: ${err.message||"formato inválido"}`, "error");
        setExcelFile(""); setExcelItems([]);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const submitExcel = () => {
    if(isSubmitting) return;
    if(!excelItems.length){showToast("Importe um arquivo!","error");return;}
    setIsSubmitting(true);
    const its=excelItems.map(({_pri,...rest})=>rest);
    setOrders(p=>[...p,{
      id:Date.now(),userId:user.id,userName:user.name,
      sector:activeSector,sectorLabel:currentRole.label,userRole:activeSector,
      createdAt:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
      createdDate:new Date().toLocaleDateString("pt-BR"),
      priority:excelPri, status: (isEstoque&&destino==="chefia") ? "aprovado" : "pendente",
      destino: activeSector==="construcao" ? "chefia" : (isEstoque ? destino : "comprador"),
      items:its,
    }]);
    const n=excelItems.length; setExcelItems([]); setExcelFile("");
    showToast(`${n} itens enviados! ✅`);
    setTimeout(()=>setIsSubmitting(false), 1500);
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"#070B0D",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <LightboxEl src={lightbox} onClose={()=>setLightbox(null)}/>
      <ToastEl toast={toast}/>
      <Topbar user={user} onLogout={onLogout}/>

      {userSectorRoles.length>1&&(
        <div style={{background:"#050709",borderBottom:"1px solid #0ABFCA1A",padding:"10px 16px",display:"flex",gap:"8px",overflowX:"auto",flexShrink:0}}>
          {userSectorRoles.map(s=>{
            const r=ROLES[s]; const sel=activeSector===s;
            return (
              <div key={s} onClick={()=>handleSectorChange(s)} className="btn"
                style={{padding:"7px 14px",borderRadius:"10px",border:`1.5px solid ${sel?r.color:"#1E2A30"}`,background:sel?`${r.color}14`:"transparent",color:sel?r.color:"#4B5563",fontSize:"12px",fontWeight:"700",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"6px"}}>
                {r.icon} {r.label}
              </div>
            );
          })}
        </div>
      )}

      <TabBar tabs={tabs} active={tab} onSelect={setTab} stickyTop={userSectorRoles.length>1?"102px":"54px"}/>

      <div style={{flex:1,overflowY:"auto",padding:"16px",maxWidth:"560px",width:"100%",margin:"0 auto"}}>

        {/* HISTÓRICO */}
        {tab==="hist"&&(myOrders.length===0
          ? <EmptyState icon="📋" text="Nenhum pedido enviado ainda"/>
          : myOrders.slice().reverse().map(o=>{
              const st=ORDER_STATUS[o.status]||ORDER_STATUS.pendente;
              const pr=PRIORITY[o.priority]||PRIORITY.normal;
              const canDelete = o.status==="pendente";
              return (
                <div key={o.id} className="card" style={{padding:"16px",marginBottom:"12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"10px",flexWrap:"wrap",gap:"6px"}}>
                    <div style={{fontSize:"12px",color:"#4B5563"}}>{o.createdDate} • {o.createdAt}</div>
                    <div style={{display:"flex",gap:"5px",flexWrap:"wrap",alignItems:"center"}}>
                      <span className="tag" style={{background:pr.bg,color:pr.color}}>{pr.label}</span>
                      <span className="tag" style={{background:st.bg,color:st.color}}>{st.label}</span>
                      {o.destino==="chefia"&&<span className="tag" style={{background:"#F59E0B14",color:"#F59E0B"}}>🏢 Chefia</span>}
                      {canDelete&&(
                        <div onClick={()=>setOrders(p=>p.filter(x=>x.id!==o.id))} className="btn"
                          style={{fontSize:"11px",color:"#FF4C4C",padding:"3px 8px",background:"#FF4C4C14",border:"1px solid #FF4C4C33",borderRadius:"6px"}}>
                          🗑️ Excluir
                        </div>
                      )}
                    </div>
                  </div>
                  {o.status==="recusado"&&<div style={{background:"#2A0A0A",border:"1px solid #FF4C4C33",borderRadius:"8px",padding:"8px 12px",fontSize:"12px",color:"#FF4C4C",marginBottom:"10px"}}>⚠️ Pedido pendente de reanálise.</div>}
                  {o.items.map(it=>(
                    <div key={it.id} style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"6px"}}>
                      <div style={{width:"8px",height:"8px",borderRadius:"50%",background:it.itemStatus==="recusado"?"#FF4C4C":it.done?"#0ABFCA":"#F59E0B",flexShrink:0}}/>
                      <span style={{fontSize:"13px",color:it.done?"#374151":"#CBD5E1",textDecoration:it.done?"line-through":"none"}}>{it.name}{it.qty?` — ${it.qty}`:""}{it.itemStatus==="recusado"?" ❌":""}</span>
                    </div>
                  ))}
                </div>
              );
            })
        )}

        {/* EXCEL */}
        {tab==="excel"&&(
          <>
            <PriorityPicker value={excelPri} onChange={setExcelPri}/>
            <DestinoSelector isEstoque={isEstoque} compradores={compradores} destino={destino} setDestino={setDestino}/>
            <label className="btn" style={{display:"block",background:excelFile?"#091A0D":"#0D1117",border:`2px dashed ${excelFile?"#0ABFCA55":"#1E2A30"}`,borderRadius:"14px",padding:"22px",textAlign:"center",cursor:"pointer",marginBottom:"14px"}}>
              <div style={{fontSize:"28px",marginBottom:"8px"}}>📊</div>
              <div style={{fontWeight:"700",color:excelFile?"#0ABFCA":"#4B5563",fontSize:"13px",wordBreak:"break-all"}}>{excelFile||"Toque para selecionar o arquivo .xlsx"}</div>
              {excelItems.length>0&&<div style={{color:"#0ABFCA88",fontSize:"11px",marginTop:"4px"}}>{excelItems.length} itens carregados ✓</div>}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleExcelImport} style={{display:"none"}}/>
            </label>
            {excelItems.length>0&&(
              <>
                <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"1px"}}>Revisar — {excelItems.length} itens</div>
                {excelItems.map((it,i)=>(
                  <AddedItem key={it.id} item={it} idx={i}
                    onEdit={(idx,patch)=>setExcelItems(p=>{const u=[...p];u[idx]={...u[idx],...patch};return u;})}
                    onDelete={idx=>setExcelItems(p=>p.filter((_,i)=>i!==idx))}
                    onLightbox={setLightbox}/>
                ))}
              </>
            )}
            <div onClick={submitExcel} className="btn"
              style={{background:excelItems.length?"linear-gradient(135deg,#0891B2,#0ABFCA)":"#1E2A30",borderRadius:"14px",padding:"15px",textAlign:"center",color:excelItems.length?"#fff":"#374151",fontWeight:"700",fontSize:"15px",marginTop:"8px",opacity:excelItems.length?1:.5}}>
              {excelItems.length?`Enviar ${excelItems.length} itens 🚀`:"Importe um arquivo para continuar"}
            </div>
          </>
        )}

        {/* NOVO PEDIDO */}
        {tab==="novo"&&(
          <>
            <PriorityPicker value={priority} onChange={setPriority}/>
            <DestinoSelector isEstoque={isEstoque} compradores={compradores} destino={destino} setDestino={setDestino}/>
            <div className="card" style={{padding:"16px",marginBottom:"12px"}}>
              <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"12px",textTransform:"uppercase",letterSpacing:"1.2px"}}>Adicionar Item</div>
              <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
                <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="Nome do item *" className="inp" style={{flex:1}}/>
                <input value={newQty}  onChange={e=>setNewQty(e.target.value)}  placeholder="Qtd" className="inp" style={{width:"82px"}}/>
              </div>
              <input value={newObs} onChange={e=>setNewObs(e.target.value)} placeholder="Observação (marca, tamanho...)" className="inp" style={{marginBottom:"10px"}}/>
              <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                <label style={{display:"flex",alignItems:"center",gap:"6px",background:"#0ABFCA14",color:"#0ABFCA",border:"1px solid #0ABFCA33",borderRadius:"8px",padding:"7px 12px",fontSize:"12px",fontWeight:"600",cursor:"pointer",flexShrink:0}}>
                  📷 {newImg?"Trocar":"Foto"}
                  <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{display:"none"}}/>
                </label>
                {newImg&&<img src={newImg} alt="" onClick={()=>setLightbox(newImg)} style={{width:"40px",height:"40px",borderRadius:"8px",objectFit:"cover",border:"1.5px solid #0ABFCA44",cursor:"pointer"}}/>}
                <div onClick={handleAdd} className="btn"
                  style={{marginLeft:"auto",background:"linear-gradient(135deg,#0891B2,#0ABFCA)",borderRadius:"10px",padding:"9px 18px",color:"#fff",fontWeight:"700",fontSize:"13px",boxShadow:"0 2px 12px #0ABFCA33",whiteSpace:"nowrap"}}>
                  + Adicionar
                </div>
              </div>
            </div>
            {addedItems.length>0&&(
              <div style={{marginBottom:"12px"}}>
                <div style={{fontSize:"11px",fontWeight:"600",color:"#4B5563",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"1px"}}>
                  {addedItems.length} {addedItems.length===1?"item":"itens"} adicionados
                </div>
                {addedItems.map((it,i)=>(
                  <AddedItem key={it.id} item={it} idx={i}
                    onEdit={(idx,patch)=>setAddedItems(p=>{const u=[...p];u[idx]={...u[idx],...patch};return u;})}
                    onDelete={idx=>setAddedItems(p=>p.filter((_,i)=>i!==idx))}
                    onLightbox={setLightbox}/>
                ))}
              </div>
            )}
            <div onClick={submitOrder} className="btn"
              style={{background:addedItems.length?"linear-gradient(135deg,#0891B2,#0ABFCA)":"#1E2A30",borderRadius:"14px",padding:"15px",textAlign:"center",color:addedItems.length?"#fff":"#374151",fontWeight:"700",fontSize:"15px",opacity:addedItems.length?1:.5}}>
              {addedItems.length?`Enviar Pedido (${addedItems.length} ${addedItems.length===1?"item":"itens"}) 🚀`:"Adicione itens para enviar"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// COMPRADOR SCREEN
// ─────────────────────────────────────────────────────────────────────────
function CompradorScreen({ user, orders, setOrders, onLogout, showToast, toast, lightbox, setLightbox, pendingBuy }) {
  const [tab, setTab]             = useState("pedidos");
  const [openOrder, setOpenOrder] = useState(null);
  const togglingRef               = useRef(new Set());

  // Comprador vê aprovados (interativos) E pendentes (bloqueados) — destino específico ou genérico (retrocompat)
  const myOrders = useMemo(()=>orders.filter(o=>(o.status==="aprovado"||o.status==="pendente")&&(o.destino===user.id||o.destino==="comprador")),[orders,user.id]);

  const toggleItem = useCallback((oid,iid)=>{
    const key=`${oid}-${iid}`;
    if(togglingRef.current.has(key)) return;
    togglingRef.current.add(key);
    setTimeout(()=>togglingRef.current.delete(key), 400);
    setOrders(p=>p.map(o=>{
      if(o.id!==oid) return o;
      const items=o.items.map(it=>it.id===iid?{...it,done:!it.done}:it);
      const allDone=items.filter(i=>i.itemStatus!=="recusado").every(i=>i.done);
      if(allDone) setTimeout(()=>setOpenOrder(null),300);
      return {...o,items,status:allDone?"concluido":"aprovado"};
    }));
  },[setOrders]);

  const grouped = useMemo(()=>{
    const g={};
    myOrders.flatMap(o=>o.items.filter(i=>!i.done&&i.itemStatus!=="recusado").map(it=>({...it,sectorLabel:o.sectorLabel}))).forEach(it=>{
      const k=it.name.toLowerCase().trim();
      if(!g[k]) g[k]={name:it.name,sectors:[it.sectorLabel],img:it.img};
      else g[k].sectors=[...new Set([...g[k].sectors,it.sectorLabel])];
    });
    return g;
  },[myOrders]);

  const tabs=[{key:"pedidos",label:`Pedidos${pendingBuy>0?` (${pendingBuy})`:""}`},{key:"agrupado",label:"Agrupado"},{key:"concluidos",label:"Concluídos"}];

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"#070B0D",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <LightboxEl src={lightbox} onClose={()=>setLightbox(null)}/>
      <ToastEl toast={toast}/>
      <Topbar user={user} onLogout={onLogout}>
        {pendingBuy>0&&<div style={{background:"#FF4C4C",color:"#fff",borderRadius:"20px",padding:"3px 10px",fontSize:"11px",fontWeight:"700",animation:"pulse 2s infinite"}}>{pendingBuy}</div>}
      </Topbar>
      <TabBar tabs={tabs} active={tab} onSelect={setTab}/>

      <div style={{flex:1,overflowY:"auto",padding:"16px",maxWidth:"600px",width:"100%",margin:"0 auto"}}>
        {tab==="agrupado"&&(Object.keys(grouped).length===0
          ? <EmptyState icon="🛒" text="Nenhum item pendente"/>
          : <>
              <div className="card" style={{padding:"11px 14px",marginBottom:"14px",fontSize:"12px",color:"#0ABFCA88"}}>💡 Itens iguais de setores diferentes agrupados automaticamente.</div>
              {Object.values(grouped).map((g,i)=>(
                <div key={i} className="card" style={{padding:"12px 14px",marginBottom:"8px",display:"flex",alignItems:"center",gap:"10px"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:"700",fontSize:"13px",color:"#CBD5E1"}}>{g.name}</div>
                    <div style={{marginTop:"4px"}}>{g.sectors.map(s=><span key={s} style={{background:"#0ABFCA12",border:"1px solid #0ABFCA1A",borderRadius:"6px",padding:"2px 7px",marginRight:"4px",fontSize:"10px",color:"#0ABFCA88"}}>{s}</span>)}</div>
                  </div>
                  {g.img&&<img src={g.img} alt="" onClick={()=>setLightbox(g.img)} style={{width:"44px",height:"44px",borderRadius:"8px",objectFit:"cover",cursor:"pointer",border:"1px solid #0ABFCA33"}}/>}
                </div>
              ))}
            </>
        )}

        {tab==="concluidos"&&(orders.filter(o=>o.status==="concluido"&&(o.destino===user.id||o.destino==="comprador")).length===0
          ? <EmptyState icon="✅" text="Nenhum pedido concluído ainda"/>
          : orders.filter(o=>o.status==="concluido"&&(o.destino===user.id||o.destino==="comprador")).slice().reverse().map(o=>{
              const isOpen=openOrder===o.id;
              const pr=PRIORITY[o.priority]||PRIORITY.normal;
              const roleInfo=ROLES[o.userRole]||ROLES.estoque;
              return (
                <div key={o.id} className="card" style={{marginBottom:"8px",overflow:"hidden",opacity:.85,border:"1px solid #0ABFCA1A"}}>
                  <div className="btn" onClick={()=>setOpenOrder(isOpen?null:o.id)} style={{padding:"13px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                      <div style={{width:"32px",height:"32px",borderRadius:"10px",background:"#0ABFCA12",border:"1px solid #0ABFCA2A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"15px",flexShrink:0}}>{roleInfo.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:"700",fontSize:"13px",color:"#CBD5E1"}}>{o.sectorLabel} — {o.userName}</div>
                        <div style={{fontSize:"11px",color:"#374151",marginTop:"2px"}}>{o.createdDate} • {o.items.length} iten{o.items.length>1?"s":""}</div>
                      </div>
                      <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                        <span className="tag" style={{background:"#052016",color:"#34D399"}}>✅ Concluído</span>
                        <span className="tag" style={{background:pr.bg,color:pr.color}}>{pr.label}</span>
                        <div style={{color:"#2A3540",fontSize:"11px"}}>{isOpen?"▲":"▼"}</div>
                      </div>
                    </div>
                  </div>
                  {isOpen&&(
                    <div style={{borderTop:"1px solid #1A2025",padding:"8px 16px 12px"}}>
                      {o.items.map(it=>(
                        <div key={it.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 0",borderBottom:"1px solid #0D1117"}}>
                          <div style={{width:"18px",height:"18px",borderRadius:"5px",background:"#0ABFCA",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"#000",flexShrink:0}}>✓</div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:"13px",fontWeight:"600",color:"#4B5563",textDecoration:"line-through"}}>{it.name}</div>
                            {(it.qty||it.obs)&&<div style={{fontSize:"11px",color:"#2A3540"}}>{it.qty}{it.obs?` • ${it.obs}`:""}</div>}
                          </div>
                          {it.img&&<img src={it.img} alt="" onClick={()=>setLightbox(it.img)} style={{width:"36px",height:"36px",borderRadius:"6px",objectFit:"cover",border:"1px solid #0ABFCA22",cursor:"pointer"}}/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
        )}

        {tab==="pedidos"&&(myOrders.length===0
          ? <EmptyState icon="📭" text="Nenhum pedido no momento" sub="Aguardando aprovação"/>
          : myOrders.slice().reverse().map(o=>{
              const isPendente = o.status==="pendente";
              const done=o.items.filter(i=>i.done&&i.itemStatus!=="recusado").length;
              const total=o.items.filter(i=>i.itemStatus!=="recusado").length;
              const pct=total?Math.round(done/total*100):0;
              const pr=PRIORITY[o.priority]||PRIORITY.normal;
              const roleInfo=ROLES[o.userRole]||ROLES.estoque;
              const isOpen=openOrder===o.id;
              return (
                <div key={o.id} className={`card${isPendente?" pending-card":""}`} style={{marginBottom:"10px",overflow:"hidden",opacity:isPendente?.85:1,border:isPendente?"1px solid #F59E0B44":"1px solid #1E2A30"}}>
                  <div className={isPendente?"":"btn"} onClick={()=>!isPendente&&setOpenOrder(isOpen?null:o.id)} style={{padding:"14px 16px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                        <div style={{width:"34px",height:"34px",borderRadius:"10px",background:"#0ABFCA12",border:"1px solid #0ABFCA2A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"17px"}}>{roleInfo.icon}</div>
                        <div>
                          <div style={{fontWeight:"700",fontSize:"14px",color:"#E2E8F0"}}>{o.sectorLabel}</div>
                          <div style={{color:"#4B5563",fontSize:"11px"}}>{o.userName} • {o.createdAt}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                        <span className="tag" style={{background:pr.bg,color:pr.color}}>{pr.label}</span>
                        {isPendente
                          ? <span className="tag" style={{background:"#1C1407",color:"#F59E0B"}}>⏳ Aguardando</span>
                          : <div style={{color:"#2A3540",fontSize:"11px"}}>{isOpen?"▲":"▼"}</div>
                        }
                      </div>
                    </div>
                    {isPendente
                      ? <div style={{background:"#1C1407",border:"1px solid #F59E0B33",borderRadius:"8px",padding:"10px 12px",fontSize:"12px",color:"#F59E0B",textAlign:"center"}}>
                          🔒 Aguardando aprovação do administrador — acesso bloqueado
                        </div>
                      : <>
                          <div style={{background:"#0D1117",borderRadius:"4px",height:"5px",border:"1px solid #1E2A30"}}>
                            <div style={{background:pct===100?"#0ABFCA":pct>0?"#F59E0B":"#FF4C4C",width:`${pct>0?pct:100}%`,height:"100%",borderRadius:"4px",transition:"width .5s",boxShadow:pct===100?"0 0 6px #0ABFCA55":pct>0?"0 0 6px #F59E0B88":"0 0 6px #FF4C4C88",opacity:pct>0?1:.35}}/>
                          </div>
                          <div style={{fontSize:"11px",color:pct===100?"#34D399":pct>0?"#F59E0B":"#FF4C4C",marginTop:"5px",fontWeight:"600"}}>{pct===100?"✅ Todos comprados!":`${done}/${total} comprados — ${total-done} pendente${total-done>1?"s":""}`}</div>
                        </>
                    }
                  </div>
                  {!isPendente&&isOpen&&(
                    <div style={{borderTop:"1px solid #1A2025",padding:"8px 16px 14px"}}>
                      {o.items.filter(i=>i.itemStatus!=="recusado").map(it=>(
                        <div key={it.id} className="btn" onClick={()=>toggleItem(o.id,it.id)}
                          style={{display:"flex",alignItems:"center",gap:"12px",padding:"11px 0",borderBottom:"1px solid #1A2025"}}>
                          <div style={{width:"22px",height:"22px",borderRadius:"6px",border:`2px solid ${it.done?"#0ABFCA":"#FF4C4C"}`,background:it.done?"#0ABFCA":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",color:"#000",flexShrink:0,boxShadow:it.done?"0 0 8px #0ABFCA55":"0 0 6px #FF4C4C33",transition:"all .2s"}}>
                            {it.done?"✓":""}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:"14px",fontWeight:"600",color:it.done?"#374151":"#CBD5E1",textDecoration:it.done?"line-through":"none"}}>{it.name}</div>
                            <div style={{fontSize:"12px",color:"#374151"}}>{it.qty}{it.obs?` • ${it.obs}`:""}</div>
                          </div>
                          {it.img&&<img src={it.img} alt="" onClick={e=>{e.stopPropagation();setLightbox(it.img);}} style={{width:"44px",height:"44px",borderRadius:"8px",objectFit:"cover",border:"1px solid #0ABFCA33",cursor:"pointer"}}/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
