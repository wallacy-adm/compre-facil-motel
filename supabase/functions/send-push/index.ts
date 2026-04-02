import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")  || "BLUGwL3JIYZxi08-Pc7ULoJv2zo2SUjWKpHbypCFzK6wEhxOveo86kl0yLoDfanhL8N-65C2_RE5PY3YzmN2Jlo";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "1ERdsBRyjju0Y1Ept2Fb8BewMJ0e2HVJMEfZTdkecjg";
const VAPID_EMAIL       = Deno.env.get("VAPID_EMAIL")       || "mailto:admin@carpediemmotel.com";
const WEBHOOK_SECRET    = Deno.env.get("WEBHOOK_SECRET") ?? "comprafacil-push-2025";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NTFY_BASE_URL        = Deno.env.get("NTFY_BASE_URL")        ?? "";
const NTFY_PUBLISHER_TOKEN = Deno.env.get("NTFY_PUBLISHER_TOKEN") ?? "";

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const dbHeaders = {
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function dbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders });
  return res.json();
}

async function dbDelete(path: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "DELETE", headers: dbHeaders });
}

// ── CANAL 2: ntfy.sh ──────────────────────────────────────────────────────────
async function sendNtfyNotification(
  topic: string,
  title: string,
  body: string,
  clickUrl: string,
): Promise<void> {
  if (!NTFY_BASE_URL || !NTFY_PUBLISHER_TOKEN) {
    console.log("[send-push][ntfy] Canal 2 desabilitado (env vars não configuradas)");
    return;
  }
  const res = await fetch(`${NTFY_BASE_URL}/${topic}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NTFY_PUBLISHER_TOKEN}`,
      "Title":         title,
      "Priority":      "high",
      "Tags":          "bell",
      "Click":         clickUrl,
      "Content-Type":  "text/plain",
    },
    body: body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[send-push][ntfy] Falha: HTTP ${res.status} topic=${topic} err=${errText}`);
  } else {
    console.log(`[send-push][ntfy] Enviado: topic=${topic}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const type   = body.type   as string;
    const order  = body.record as Record<string, unknown>;
    const oldRec = body.old_record as Record<string, unknown> | null;

    if (!order) return new Response(JSON.stringify({ skipped: "no record" }), { headers: { ...cors, "Content-Type": "application/json" } });

    let notifyRoles: string[] = [];
    let notification: { title: string; body: string; tag: string; url: string } | null = null;

    if (type === "INSERT" && order.status === "pendente") {
      const setor = (order.sectorLabel || order.sector_label || "setor") as string;
      if (order.destino === "comprador") {
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
      if (order.destino === "comprador") {
        notifyRoles = ["comprador"];
        notification = { title: "✅ Pedido Aprovado", body: "Itens aprovados aguardando compra", tag: `order-buy-${order.id}`, url: "/" };
      } else if (order.destino === "chefia") {
        notifyRoles = ["chefia"];
        notification = { title: "✅ Pedido para Chefia", body: "Pedido aprovado aguardando compra", tag: `order-chefia-${order.id}`, url: "/" };
      }
    }

    if (!notification || notifyRoles.length === 0) {
      return new Response(JSON.stringify({ skipped: "no matching condition" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const users = await dbGet("users?select=id,role,roles,ntfy_topic&deleted=eq.false");
    const targetIds: string[] = (Array.isArray(users) ? users : [])
      .filter((u: Record<string, unknown>) => {
        const roles = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : []);
        return notifyRoles.some(r => (roles as string[]).includes(r));
      })
      .map((u: Record<string, unknown>) => u.id as string);

    if (targetIds.length === 0) {
      return new Response(JSON.stringify({ skipped: "no target users" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const idsParam = targetIds.map(id => `"${id}"`).join(",");
    const subs = await dbGet(`push_subscriptions?user_id=in.(${idsParam})&select=id,endpoint,subscription`);

    if (!Array.isArray(subs)) {
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const payload = JSON.stringify(notification);
    const pushOptions = { TTL: 86400, urgency: "high" as const };

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
      })
    );

    const sent   = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    // ── CANAL 2: Disparar ntfy para usuários com ntfy_topic configurado ────────────
    const ntfyTargets = (Array.isArray(users) ? users : []).filter((u: Record<string, unknown>) => {
      return targetIds.includes(u.id as string) && typeof u.ntfy_topic === "string" && u.ntfy_topic.length > 0;
    });

    const ntfyResults = await Promise.allSettled(
      ntfyTargets.map((u: Record<string, unknown>) =>
        sendNtfyNotification(
          u.ntfy_topic as string,
          notification.title,
          notification.body,
          notification.url,
        )
      )
    );

    const ntfySent   = ntfyResults.filter(r => r.status === "fulfilled").length;
    const ntfyFailed = ntfyResults.filter(r => r.status === "rejected").length;
    console.log(`[send-push] Canal 1 (WebPush): ${sent}/${(Array.isArray(subs) ? subs.length : 0)}, Canal 2 (ntfy): ${ntfySent}/${ntfyTargets.length} enviados`);

    return new Response(JSON.stringify({
      canal1: { sent, failed },
      canal2: { sent: ntfySent, failed: ntfyFailed, targets: ntfyTargets.length },
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[send-push] Erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
