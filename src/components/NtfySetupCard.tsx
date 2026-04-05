import { useState, useEffect } from "react";

type SetupState = "idle" | "loading" | "ready" | "configured" | "error";

interface NtfyConfig {
  token: string;
  topic: string;
  server_url: string;
}

interface Props {
  userId: string;
  currentNtfyTopic?: string | null;
  onConfigured?: () => void;
  onRevoked?: () => void;
}

export function NtfySetupCard({ userId, currentNtfyTopic, onConfigured, onRevoked }: Props) {
  const [state, setState] = useState<SetupState>(currentNtfyTopic ? "configured" : "idle");
  const [config, setConfig] = useState<NtfyConfig | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Sincronizar estado quando currentNtfyTopic mudar externamente
  useEffect(() => {
    setState(currentNtfyTopic ? "configured" : "idle");
  }, [currentNtfyTopic]);

  async function handleSetup() {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ntfy-token`,
        {
          method: "POST",
          headers: {
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: userId }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error ?? `Erro HTTP ${res.status}`);
      }

      const data: NtfyConfig = await res.json();
      setConfig(data);
      setState("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  async function handleOpenDeepLink() {
    if (!config) return;
    const serverHost = config.server_url.replace(/^https?:\/\//, "");
    const scheme = config.server_url.startsWith("https") ? "ntfys" : "ntfy";
    const deepLink = `${scheme}://${serverHost}/${config.topic}?auth=${btoa(`:${config.token}`)}`;

    await navigator.clipboard.writeText(deepLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    window.location.href = deepLink;
  }

  async function handleTest() {
    if (!config) return;
    try {
      await fetch(`${config.server_url}/${config.topic}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "Title": "✅ Teste CompraFácil",
          "Content-Type": "text/plain",
        },
        body: "Notificações iOS funcionando! 🎉",
      });
    } catch {
      // Ignorar erro de CORS — a notificação foi enviada de qualquer forma
    }
    setState("configured");
    onConfigured?.();
  }

  async function handleRevoke() {
    setState("loading");
    try {
      const revokeRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ntfy-token`,
        {
          method: "DELETE",
          headers: {
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: userId }),
        }
      );
      if (!revokeRes.ok) {
        const errData = await revokeRes.json().catch(() => ({}));
        throw new Error(errData?.error ?? `Erro HTTP ${revokeRes.status}`);
      }
      setConfig(null);
      setState("idle");
      onRevoked?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  const cardBase = "rounded-xl border p-4 space-y-3 text-sm";

  if (state === "configured") {
    return (
      <div className={`${cardBase} border-green-500/30 bg-green-500/10`}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium text-green-400">
            <span>✅</span> Notificações iOS ativas
          </span>
          <button
            onClick={handleRevoke}
            className="text-xs text-gray-400 hover:text-red-400 transition-colors"
          >
            Desativar
          </button>
        </div>
        <p className="text-gray-400 text-xs">
          Você receberá alertas de pedidos mesmo com o iPhone bloqueado.
        </p>
      </div>
    );
  }

  if (state === "idle") {
    return (
      <div className={`${cardBase} border-blue-500/30 bg-blue-500/5`}>
        <p className="font-medium text-gray-200">📱 Notificações confiáveis no iPhone</p>
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
        <p className="text-gray-400 text-center">Configurando… aguarde</p>
      </div>
    );
  }

  if (state === "ready" && config) {
    return (
      <div className={`${cardBase} border-yellow-500/30 bg-yellow-500/5`}>
        <p className="font-medium text-gray-200">📲 Quase lá! 2 passos:</p>
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
            <span>Toque no botão abaixo para abrir o app ntfy já configurado:</span>
          </li>
        </ol>
        <button
          onClick={handleOpenDeepLink}
          className="w-full rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-4 text-sm font-medium transition-colors"
        >
          {copied ? "✅ Link copiado!" : "🔗 Abrir ntfy configurado"}
        </button>
        <p className="text-gray-500 text-xs">
          Se o app não abrir automaticamente, abra o app ntfy manualmente e depois toque aqui de novo.
        </p>
        <button
          onClick={handleTest}
          className="w-full rounded-lg border border-green-500/50 text-green-400 hover:bg-green-500/10 py-2 px-4 text-sm font-medium transition-colors"
        >
          ✅ Já configurei — Testar notificação agora
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={`${cardBase} border-red-500/30 bg-red-500/5`}>
        <p className="font-medium text-red-400">⚠️ Erro na configuração</p>
        <p className="text-gray-400 text-xs">{errorMsg || "Erro desconhecido. Verifique a conexão."}</p>
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
