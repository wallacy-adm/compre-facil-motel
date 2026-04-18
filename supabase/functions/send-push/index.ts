// v4.0 — concluido→criador + fix comprador INSERT+aprovado + auto-roles chefia/admin
import webpush from "https://esm.sh/web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_EMAIL = Deno.env.get("VAPID_EMAIL") || "mailto:admin@carpediemmotel.com";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "comprafacil-push-2025";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NTFY_BASE_URL = Deno.env.get("NTFY_BASE_URL") || "https://ntfy.sh";
const NTFY_PUBLISHER_TOKEN = Deno.env.get("NTFY_PUBLISHER_TOKEN") ?? "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "";

const startupErrors: string[] = [];
if (!SUPABASE_URL) startupErrors.push("SUPABASE_URL não configurada");
if (!SERVICE_KEY) startupErrors.push("SUPABASE_SERVICE_ROLE_KEY não configurada");
if (!VAPID_PUBLIC_KEY) startupErrors.push("VAPID_PUBLIC_KEY não configurada");
if (!VAPID_PRIVATE_KEY) startupErrors.push("VAPID_PRIVATE_KEY não configurada");
if (startupErrors.length > 0) {
  console.error("[send-push] CONFIGURAÇÃO INVÁLIDA:", startupErrors.join(" | "));
} else {
  console.log("[send-push] v4.0 — iniciando com configuração válida");
}

const hasVapidConfig = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (hasVapidConfig) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const dbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

function hasDbConfig(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function resolveClickUrl(pathOrUrl: string, req: Request): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const requestBase = new URL(req.url).origin;
  const appBase = APP_BASE_URL || requestBase;
  return new URL(pathOrUrl || "/", appBase).toString();
}

function normalizeRoles(user: Record<string, unknown>): string[] {
  const roleFromArray = Array.isArray(user.roles)
    ? user.roles.filter((role): role is string => typeof role === "string")
    : [];
  const roleLegacy = typeof user.role === "string" ? [user.role] : [];
  return [...new Set([...roleFromArray, ...roleLegacy])];
}

async function dbGet(path: string) {
  if (!hasDbConfig()) {
    console.error("[send-push] dbGet abortado: configuração de banco ausente", path);
    return [];
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, { headers: dbHeaders });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[send-push] dbGet falhou: status=${res.status} path=${path} err=${errText}`);
    return [];
  }
  return res.json();
}

async function dbDelete(path: string) {
  if (!hasDbConfig()) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: dbHeaders,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[send-push] dbDelete falhou: status=${res.status} path=${path} err=${errText}`);
  }
}

// ── Ntfy: POST JSON com timeout de 10 segundos ────────────────────────────
async function sendNtfyNotification(
  topic: string,
  title: string,
  body: string,
  clickUrl: string,
): Promise<void> {
  const sanitizedTopic = topic.trim();
  if (!sanitizedTopic) throw new Error("topic vazio para ntfy");

  const payload: Record<string, unknown> = {
    topic: sanitizedTopic,
    title,
    message: body,
    priority: 4,
    tags: ["bell"],
    click: clickUrl,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (NTFY_PUBLISHER_TOKEN) headers.Authorization = `Bearer ${NTFY_PUBLISHER_TOKEN}`;

  const baseUrl = NTFY_BASE_URL.endsWith("/") ? NTFY_BASE_URL : `${NTFY_BASE_URL}/`;
  console.log(`[send-push][ntfy] POST ${baseUrl} topic=${sanitizedTopic}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  let res: Response;
  try {
    res = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (fetchErr) {
    const isTimeout = (fetchErr as Error)?.name === "AbortError";
    const msg = isTimeout
      ? `[send-push][ntfy] Timeout (10s) topic=${sanitizedTopic}`
      : `[send-push][ntfy] fetch erro topic=${sanitizedTopic} err=${String(fetchErr)}`;
    console.error(msg);
    throw new Error(msg);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`[send-push][ntfy] HTTP ${res.status} topic=${sanitizedTopic} err=${errText}`);
  }

  await res.text().catch(() => "");
  console.log(`[send-push][ntfy] ✅ Enviado: topic=${sanitizedTopic}`);
}

// ── WebPush com retry em erros 5xx ────────────────────────────────────────
async function sendWebPushWithRetry(
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
  maxRetries = 2,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await webpush.sendNotification(subscription, payload, options);
      return;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) throw err;
      if (status && status >= 500 && attempt < maxRetries) {
        const delay = (attempt + 1) * 1000;
        console.warn(`[send-push][webpush] HTTP ${status} — retry ${attempt + 1}/${maxRetries} em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const reqId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      console.warn(`[send-push][${reqId}] Webhook secret inválido`);
      return new Response("Unauthorized", { status: 401 });
    }

    if (!hasDbConfig()) {
      return new Response(JSON.stringify({ error: "Edge function sem configuração de banco" }), {
        status: 503,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const type = body.type as string;
    const order = body.record as Record<string, unknown>;
    const oldRec = body.old_record as Record<string, unknown> | null;

    if (!order) {
      return new Response(JSON.stringify({ skipped: "no record" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    console.log(`[send-push][${reqId}] type=${type} id=${order.id} status=${order.status} destino=${order.destino}`);

    // Resolve destino: pode ser role string ou user ID numérico
    const knownRoles = ["comprador", "chefia", "admin", "estoque", "construcao", "manutencao"];
    let destinoRole = order.destino as string;
    if (!knownRoles.includes(destinoRole)) {
      const allUsers = await dbGet("users?select=id,role,roles&deleted=eq.false");
      const targetUser = (Array.isArray(allUsers) ? allUsers : []).find(
        (u: Record<string, unknown>) => String(u.id) === String(order.destino)
      );
      if (targetUser) {
        const roles = normalizeRoles(targetUser);
        destinoRole = roles.includes("comprador") ? "comprador" :
                      roles.includes("chefia") ? "chefia" :
                      roles[0] || "unknown";
        console.log(`[send-push][${reqId}] destino resolvido: ID ${order.destino} -> ${destinoRole}`);
      }
    }

    const setor = (order.sectorLabel || order.sector_label || order.sector || "Setor") as string;

    // ── Determina quem notificar ────────────────────────────────────────────
    let notifyRoles: string[] = [];
    let notifyUserId: string | null = null; // para notificar criador específico
    let notification: { title: string; body: string; tag: string; url: string } | null = null;

    if (type === "INSERT" && order.status === "pendente") {
      // Novo pedido → chefia/admin para aprovação
      notifyRoles = ["admin", "chefia"];
      notification = {
        title: "\u{1F4CB} Novo Pedido",
        body: `Pedido de ${setor} aguardando aprovação`,
        tag: `order-new-${order.id}`,
        url: "/",
      };

    } else if (
      (type === "UPDATE" && order.status === "aprovado" && oldRec?.status !== "aprovado") ||
      (type === "INSERT"  && order.status === "aprovado")
    ) {
      // Chefia/admin aprovou → notifica destinatário final
      if (destinoRole === "comprador") {
        notifyRoles = ["comprador"];
        notification = {
          title: "\u2705 Pedido Aprovado",
          body: `Itens de ${setor} aprovados — pronto para compra`,
          tag: `order-buy-${order.id}`,
          url: "/",
        };
      } else if (destinoRole === "chefia") {
        notifyRoles = ["chefia"];
        notification = {
          title: "\u{1F6D2} Novo Pedido de Compra",
          body: `Pedido de ${setor} pronto para compra`,
          tag: `order-buy-${order.id}`,
          url: "/",
        };
      }

    } else if (type === "UPDATE" && order.status === "concluido" && oldRec?.status !== "concluido") {
      // Pedido concluído → notifica o setor que criou
      const creatorId = String(order.userId || order.user_id || "");
      if (creatorId && creatorId !== "undefined" && creatorId !== "") {
        notifyUserId = creatorId;
        notification = {
          title: "\u{1F3AF} Pedido Concluído",
          body: `Seu pedido de ${setor} foi concluído!`,
          tag: `order-done-${order.id}`,
          url: "/",
        };
        console.log(`[send-push][${reqId}] concluido → notifica criador userId=${creatorId}`);
      }
    }

    if (!notification || (notifyRoles.length === 0 && !notifyUserId)) {
      console.log(`[send-push][${reqId}] skipped: nenhuma condição matched`);
      return new Response(JSON.stringify({ skipped: "no matching condition" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── Busca usuários alvo ─────────────────────────────────────────────────
    let targetUsers: Record<string, unknown>[] = [];

    if (notifyUserId) {
      // Usuário específico pelo ID (criador do pedido)
      const found = await dbGet(`users?select=id,role,roles,ntfy_topic&id=eq.${notifyUserId}&deleted=eq.false`);
      targetUsers = Array.isArray(found) ? found : [];
    } else {
      // Por role
      const users = await dbGet("users?select=id,role,roles,ntfy_topic&deleted=eq.false");
      targetUsers = (Array.isArray(users) ? users : []).filter((user: Record<string, unknown>) => {
        const roles = normalizeRoles(user);
        return notifyRoles.some((role) => roles.includes(role));
      });
    }

    const targetIds = targetUsers.map((user) => user.id as string);
    console.log(`[send-push][${reqId}] notifyRoles=${notifyRoles.join(",") || "(userId)"} targets=${targetIds.join(",")} title="${notification.title}"`);

    if (targetIds.length === 0) {
      console.log(`[send-push][${reqId}] skipped: nenhum usuário alvo encontrado`);
      return new Response(JSON.stringify({ skipped: "no target users" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const idsParam = targetIds.map((id) => `"${id}"`).join(",");
    const subs = await dbGet(`push_subscriptions?user_id=in.(${idsParam})&select=id,endpoint,subscription`);

    if (!Array.isArray(subs)) {
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const pushPayload = JSON.stringify(notification);
    const pushOptions = { TTL: 86400, urgency: "high" as const };

    let sent = 0;
    let failed = 0;

    if (!hasVapidConfig) {
      console.warn(`[send-push][${reqId}] Canal1 WebPush IGNORADO: VAPID não configurado`);
    } else {
      const results = await Promise.allSettled(
        subs.map(async (row: Record<string, unknown>) => {
          try {
            await sendWebPushWithRetry(row.subscription as webpush.PushSubscription, pushPayload, pushOptions);
          } catch (err: unknown) {
            const status = (err as { statusCode?: number })?.statusCode;
            if (status === 404 || status === 410) {
              const id = row.id as string;
              console.log(`[send-push][${reqId}] Removendo subscription morta (${status}): ${id}`);
              await dbDelete(`push_subscriptions?id=eq.${id}`);
            }
            throw err;
          }
        }),
      );

      sent = results.filter((r) => r.status === "fulfilled").length;
      failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) console.warn(`[send-push][${reqId}] WebPush: ${failed} falhou(aram) de ${subs.length}`);
    }

    const clickUrl = resolveClickUrl(notification.url, req);
    const ntfyTargets = targetUsers.filter((user: Record<string, unknown>) =>
      typeof user.ntfy_topic === "string" && user.ntfy_topic.trim().length > 0
    );

    const ntfyResults = await Promise.allSettled(
      ntfyTargets.map((user: Record<string, unknown>) =>
        sendNtfyNotification(user.ntfy_topic as string, notification!.title, notification!.body, clickUrl)
      ),
    );

    const ntfySent = ntfyResults.filter((r) => r.status === "fulfilled").length;
    const ntfyFailed = ntfyResults.filter((r) => r.status === "rejected").length;

    console.log(
      `[send-push][${reqId}] ✅ Canal1 WebPush=${sent}/${subs.length} | Canal2 ntfy=${ntfySent}/${ntfyTargets.length} | order=${order.id}`,
    );

    return new Response(
      JSON.stringify({
        reqId,
        sent: sent + ntfySent,
        failed: failed + ntfyFailed,
        canal1: { sent, failed, total: subs.length },
        canal2: { sent: ntfySent, failed: ntfyFailed, targets: ntfyTargets.length },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(`[send-push][${reqId}] Erro não tratado:`, e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
