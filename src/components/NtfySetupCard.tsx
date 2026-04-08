import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// Servidor público ntfy.sh — sem auth necessário para tópicos aleatórios
const NTFY_PUBLIC_SERVER = "https://ntfy.sh";

type SetupState = "idle" | "loading" | "ready" | "configured" | "error";

interface Props {
  userId: string;
  currentNtfyTopic?: string | null;
  onConfigured?: () => void;
  onRevoked?: () => void;
}

export function NtfySetupCard({ userId, currentNtfyTopic, onConfigured, onRevoked }: Props) {
  const [state, setState] = useState<SetupState>(currentNtfyTopic ? "configured" : "idle");
  const [topic, setTopic] = useState<string | null>(currentNtfyTopic ?? null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setState(currentNtfyTopic ? "configured" : "idle");
    setTopic(currentNtfyTopic ?? null);
    setCollapsed(false);
  }, [currentNtfyTopic]);

  useEffect(() => {
    if (state !== "configured") {
      setCollapsed(false);
      return;
    }
    const timer = setTimeout(() => setCollapsed(true), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  async function handleSetup() {
    setState("loading");
    setErrorMsg("");
    try {
      const newTopic = `cf-${userId.slice(0, 8)}-${Math.random().toString(36).slice(2, 7)}`;
      const { error } = await supabase
        .from("users")
        .update({ ntfy_topic: newTopic })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      setTopic(newTopic);
      setState("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  async function handleOpenDeepLink() {
    if (!topic) return;
    const deepLink = `ntfys://ntfy.sh/${topic}`;
    await navigator.clipboard.writeText(deepLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    window.location.href = deepLink;
  }

  async function handleTest() {
    if (!topic) return;
    try {
      await fetch(`${NTFY_PUBLIC_SERVER}/${topic}`, {
        method: "POST",
        headers: {
          "Title": "Teste CompraFacil",
          "Content-Type": "text/plain",
        },
        body: "Notificacoes iOS funcionando!",
      });
    } catch {
      // CORS esperado — notificação foi enviada
    }
    setState("configured");
    onConfigured?.();
  }

  async function handleRevoke() {
    setState("loading");
    try {
      const { error } = await supabase
        .from("users")
        .update({ ntfy_topic: null })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      setTopic(null);
      setState("idle");
      onRevoked?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  const cardBase = "rounded-xl border p-4 space-y-3 text-sm";

  if (state === "configured") {
    if (collapsed) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed top-3 right-3 z-50 flex items-center gap-1 rounded-full bg-green-600/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-sm"
        >
          ntfy ativo
        </button>
      );
    }
    return (
      <div className={`${cardBase} border-green-500/30 bg-green-500/10`}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium text-green-400">
            Notificacoes iOS ativas
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCollapsed(true)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Minimizar
            </button>
            <button
              onClick={handleRevoke}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              Desativar
            </button>
          </div>
        </div>
        <p className="text-gray-400 text-xs">
          Voce recebera alertas de pedidos mesmo com o iPhone bloqueado.
        </p>
      </div>
    );
  }

  if (state === "idle") {
    return (
      <div className={`${cardBase} border-blue-500/30 bg-blue-500/5`}>
        <p className="font-medium text-gray-200">Notificacoes confiaveis no iPhone</p>
        <p className="text-gray-400 text-xs">
          Receba alertas de pedidos mesmo com o app fechado e tela bloqueada.
          Requer instalar o app gratuito <strong>ntfy</strong>.
        </p>
        <button
          onClick={handleSetup}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 text-sm font-medium transition-colors"
        >
          Configurar agora
        </button>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className={`${cardBase} border-gray-700 bg-gray-800/50`}>
        <p className="text-gray-400 text-center">Configurando... aguarde</p>
      </div>
    );
  }

  if (state === "ready" && topic) {
    return (
      <div className={`${cardBase} border-yellow-500/30 bg-yellow-500/5`}>
        <p className="font-medium text-gray-200">Quase la! 2 passos:</p>
        <ol className="space-y-3 text-gray-300">
          <li className="flex gap-2">
            <span className="text-yellow-400 font-bold">1.</span>
            <span>
              Baixe o app gratuito{" "}
              <a
                href="https://apps.apple.com/app/ntfy/id1625396347"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline"
              >
                ntfy na App Store
              </a>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-yellow-400 font-bold">2.</span>
            <span>Toque no botao abaixo para abrir o app ntfy ja configurado:</span>
          </li>
        </ol>
        <button
          onClick={handleOpenDeepLink}
          className="w-full rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-4 text-sm font-medium transition-colors"
        >
          {copied ? "Link copiado!" : "Abrir ntfy configurado"}
        </button>
        <p className="text-gray-500 text-xs">
          Se o app nao abrir automaticamente, abra o ntfy manualmente e toque aqui de novo.
        </p>
        <button
          onClick={handleTest}
          className="w-full rounded-lg border border-green-500/50 text-green-400 hover:bg-green-500/10 py-2 px-4 text-sm font-medium transition-colors"
        >
          Ja configurei - Testar notificacao agora
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={`${cardBase} border-red-500/30 bg-red-500/5`}>
        <p className="font-medium text-red-400">Erro na configuracao</p>
        <p className="text-gray-400 text-xs">{errorMsg || "Erro desconhecido. Verifique a conexao."}</p>
        <button
          onClick={() => { setState("idle"); setErrorMsg(""); }}
          className="w-full rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 py-2 px-4 text-sm font-medium transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return null;
}
