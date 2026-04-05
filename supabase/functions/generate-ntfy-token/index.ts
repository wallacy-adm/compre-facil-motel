// Edge Function: generate-ntfy-token
// Gera ou revoga tokens ntfy.sh para o usuário autenticado.
// POST /generate-ntfy-token → retorna { token, topic, server_url }
// DELETE /generate-ntfy-token → revoga token existente

const NTFY_BASE_URL        = Deno.env.get("NTFY_BASE_URL")        ?? "";
const NTFY_ADMIN_BASIC_AUTH = Deno.env.get("NTFY_ADMIN_BASIC_AUTH") ?? ""; // "Basic base64(admin:password)"
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")          ?? "";
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Validate required environment variables at startup
const missingVars = [
  !NTFY_BASE_URL && "NTFY_BASE_URL",
  !NTFY_ADMIN_BASIC_AUTH && "NTFY_ADMIN_BASIC_AUTH",
  !SUPABASE_URL && "SUPABASE_URL",
  !SERVICE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
].filter(Boolean);

if (missingVars.length > 0) {
  console.error("[generate-ntfy-token] Missing required env vars:", (missingVars as string[]).join(", "));
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Valida que o user_id existe na tabela users (auth customizada do app)
async function validateUserId(userId: string): Promise<boolean> {
  if (!userId || typeof userId !== "string") return false;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id&deleted=eq.false`,
    {
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

// Busca dados do usuário na tabela users (service role)
async function getUser(userId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,ntfy_token,ntfy_topic`,
    {
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// Atualiza ntfy_token e ntfy_topic na tabela users (service role, bypassa RLS)
async function saveNtfyToken(userId: string, token: string | null, topic: string | null): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ ntfy_token: token, ntfy_topic: topic }),
  });
  if (!res.ok) {
    console.error("[generate-ntfy-token] Falha ao salvar token no DB:", res.status, await res.text());
    return false;
  }
  return true;
}

// Cria um token no servidor ntfy.sh autenticando como admin
// O token retornado é usado pelo usuário para subscribir no app ntfy
async function createNtfyToken(label: string): Promise<string | null> {
  if (!NTFY_BASE_URL || !NTFY_ADMIN_BASIC_AUTH) {
    console.error("[generate-ntfy-token] NTFY_BASE_URL ou NTFY_ADMIN_BASIC_AUTH não configurados");
    return null;
  }
  const res = await fetch(`${NTFY_BASE_URL}/v1/account/token`, {
    method: "POST",
    headers: {
      "Authorization": NTFY_ADMIN_BASIC_AUTH,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ label, expires: 0 }), // 0 = não expira
  });
  if (!res.ok) {
    console.error("[generate-ntfy-token] Falha ao criar token ntfy:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  console.log("[generate-ntfy-token] Token criado:", data?.token?.slice(0, 10) + "...");
  return data?.token ?? null;
}

// Revoga um token no servidor ntfy.sh
async function revokeNtfyToken(token: string): Promise<void> {
  if (!NTFY_BASE_URL || !NTFY_ADMIN_BASIC_AUTH) return;
  const res = await fetch(`${NTFY_BASE_URL}/v1/account/token/${token}`, {
    method: "DELETE",
    headers: { "Authorization": NTFY_ADMIN_BASIC_AUTH },
  });
  if (!res.ok) {
    console.warn("[generate-ntfy-token] Falha ao revogar token:", res.status);
  } else {
    console.log("[generate-ntfy-token] Token revogado com sucesso");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Ler user_id do body (app usa auth customizada, não Supabase Auth)
  let userId: string | null = null;
  try {
    const body = await req.json();
    userId = body?.user_id ?? null;
  } catch {
    // body vazio ou inválido
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id obrigatório" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Validar que o user existe na tabela users
  const exists = await validateUserId(userId);
  if (!exists) {
    return new Response(JSON.stringify({ error: "Usuário não encontrado" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const userRecord = await getUser(userId);
  if (!userRecord) {
    return new Response(JSON.stringify({ error: "Erro ao carregar usuário" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // POST: gerar ou retornar token existente
  if (req.method === "POST") {
    // Se já tem token, retornar o existente
    if (userRecord.ntfy_token && userRecord.ntfy_topic) {
      console.log("[generate-ntfy-token] Retornando token existente para user:", userId.slice(0, 8));
      return new Response(JSON.stringify({
        token: userRecord.ntfy_token,
        topic: userRecord.ntfy_topic,
        server_url: NTFY_BASE_URL,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Gerar novo token
    const topic = `pedidos-${userId.slice(0, 8)}`;
    const label = `comprafacil-user-${userId.slice(0, 8)}`;
    const token = await createNtfyToken(label);

    if (!token) {
      return new Response(JSON.stringify({ error: "Falha ao criar token no servidor ntfy" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const saved = await saveNtfyToken(userId, token, topic);
    if (saved) {
      console.log("[generate-ntfy-token] Token gerado e salvo para user:", userId.slice(0, 8));
    } else {
      console.warn("[generate-ntfy-token] Token criado no ntfy mas não persistido no DB para user:", userId.slice(0, 8));
    }

    return new Response(JSON.stringify({ token, topic, server_url: NTFY_BASE_URL }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // DELETE: revogar token
  if (req.method === "DELETE") {
    if (userRecord.ntfy_token) {
      await revokeNtfyToken(userRecord.ntfy_token as string);
    }
    const cleared = await saveNtfyToken(userId, null, null);
    if (!cleared) {
      console.warn("[generate-ntfy-token] Falha ao limpar token do DB para user:", userId.slice(0, 8));
    }
    return new Response(JSON.stringify({ revoked: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...cors, "Content-Type": "application/json" },
  });
});
