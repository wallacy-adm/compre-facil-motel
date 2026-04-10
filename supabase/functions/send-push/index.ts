// v2.5 — destino ID→role resolution + canal1/canal2 response
import webpush from "npm:web-push@3.6.7";

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
  console.log("[send-push] Iniciando com configuração válida");
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

async function sendNtfyNotification(
  topic: string,
  title: string,
  body: string,
  clickUrl: string,
): Promise<void> {
  const sanitizedTopic = topic.trim();
  if (!sanitizedTopic) throw new Error("topic vazio para ntfy");

  const headers: Record<string, string> = {
    Title: title,
    Priority: "high",
    Tags: "bell",
    Click: clickUrl,
    "Content-Type": "text/plain",
  };

  if (NTFY_PUBLISHER_TOKEN) {
    headers.Authorization = `Bearer ${NTFY_PUBLISHER_TOKEN}`;
  }

  const res = await fetch(`${NTFY_BASE_URL}/${sanitizedTopic}`, {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const msg = `[send-push][ntfy] Falha: HTTP ${res.status} topic=${sanitizedTopic} err=${errText}`;
    console.error(msg);
    throw new Error(msg);
  }

  console.log(`[send-push][ntfy] Enviado: topic=${sanitizedTopic}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      console.warn("[send-push] Webhook secret inválido");
      return new Response("Unauthorized", { status: 401 });
    }

    if (!hasDbConfig()) {
      return new Response(JSON.stringify({ error: "Edge function sem configuração de banco (SUPABASE_URL/SERVICE_KEY)" }), {
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

    console.log(`[send-push] Evento recebido: type=${type} order.id=${order.id} status=${order.status} destino=${order.destino}`);

    // Resolve destino: pode ser role string ("comprador","chefia") ou user ID ("2")
    const knownRoles = ["comprador", "chefia", "admin", "estoque", "construcao", "manutencao"];
    let destinoRole = order.destino as string;
    if (!knownRoles.includes(destinoRole)) {
      // destino é um user ID — buscar role do usuario
      const allUsers = await dbGet("users?select=id,role,roles&deleted=eq.false");
      const targetUser = (Array.isArray(allUsers) ? allUsers : []).find(
        (u: Record<string, unknown>) => String(u.id) === String(order.destino)
      );
      if (targetUser) {
        const roles = normalizeRoles(targetUser);
        destinoRole = roles.includes("comprador") ? "comprador" :
                      roles.includes("chefia") ? "chefia" :
                      roles[0] || "unknown";
        console.log(`[send-push] destino resolvido: ID ${order.destino} -> role ${destinoRole}`);
      }
    }

    let notifyRoles: string[] = [];
    let notification: { title: string; body: string; tag: string; url: string } | null = null;

    if (type === "INSERT" && order.status === "pendente") {
      const setor = (order.sectorLabel || order.sector_label || "setor") as string;
      if (destinoRole === "comprador") {
        notifyRoles = ["comprador"];
        notification = {
          title: "🛒 Pedido para Compra",
          body: `Pedido de ${setor} direto para compra`,
          tag: `order-buy-${order.id}`,
          url: "/",
        };
      } else {
        notifyRoles = ["admin", "chefia"];
        notification = {
          title: "📋 Novo Pedido",
          body: `Pedido de ${setor} aguardando aprovação`,
          tag: `order-new-${order.id}`,
          url: "/",
        };
      }
    } else if (type === "UPDATE" && order.status === "aprovado" && oldRec?.status !== "aprovado") {
      if (destinoRole === "comprador") {
        notifyRoles = ["comprador"];
        notification = {
          title: "✅ Pedido Aprovado",
          body: "Itens aprovados aguardando compra",
          tag: `order-buy-${order.id}`,
          url: "/",
        };
      } else if (destinoRole === "chefia") {
        notifyRoles = ["chefia"];
        notification = {
          title: "✅ Pedido para Chefia",
          body: "Pedido aprovado aguardando compra",
          tag: `order-chefia-${order.id}`,
          url: "/",
        };
      }
    }

    if (!notification || notifyRoles.length === 0) {
      return new Response(JSON.stringify({ skipped: "no matching condition" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const users = await dbGet("users?select=id,role,roles,ntfy_topic&deleted=eq.false");
    const targetUsers = (Array.isArray(users) ? users : []).filter((user: Record<string, unknown>) => {
      const roles = normalizeRoles(user);
      return notifyRoles.some((role) => roles.includes(role));
    });
    const targetIds = targetUsers.map((user: Record<string, unknown>) => user.id as string);

    if (targetIds.length === 0) {
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

    const payload = JSON.stringify(notification);
    const pushOptions = { TTL: 86400, urgency: "high" as const };

    let sent = 0;
    let failed = 0;

    if (!hasVapidConfig) {
      console.warn("[send-push] Canal1 WebPush IGNORADO: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas");
    } else {
      const results = await Promise.allSettled(
        subs.map(async (row: Record<string, unknown>) => {
          try {
            await webpush.sendNotification(row.subscription as webpush.PushSubscription, payload, pushOptions);
          } catch (err: unknown) {
            const status = (err as { statusCode?: number })?.statusCode;
            if (status === 404 || status === 410) {
              const id = row.id as string;
              console.log(`[send-push] Removendo subscription morta (${status}): ${id}`);
              await dbDelete(`push_subscriptions?id=eq.${id}`);
            }
            throw err;
          }
        }),
      );

      sent = results.filter((r) => r.status === "fulfilled").length;
      failed = results.filter((r) => r.status === "rejected").length;
    }

    const clickUrl = resolveClickUrl(notification.url, req);
    const ntfyTargets = targetUsers.filter((user: Record<string, unknown>) => {
      return typeof user.ntfy_topic === "string" && user.ntfy_topic.trim().length > 0;
    });

    const ntfyResults = await Promise.allSettled(
      ntfyTargets.map((user: Record<string, unknown>) =>
        sendNtfyNotification(user.ntfy_topic as string, notification.title, notification.body, clickUrl),
      ),
    );

    const ntfySent = ntfyResults.filter((r) => r.status === "fulfilled").length;
    const ntfyFailed = ntfyResults.filter((r) => r.status === "rejected").length;

    console.log(
      `[send-push] Canal1 WebPush=${sent}/${subs.length} | Canal2 ntfy=${ntfySent}/${ntfyTargets.length} | order=${order.id}`,
    );

    return new Response(
      JSON.stringify({
        sent: sent + ntfySent,
        failed: failed + ntfyFailed,
        canal1: { sent, failed },
        canal2: { sent: ntfySent, failed: ntfyFailed, targets: ntfyTargets.length },
      }),
      {
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[send-push] Erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
