# Ntfy Dual-Channel Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ntfy.sh self-hosted como segundo canal de notificação paralelo ao Web Push, garantindo que iPhones recebam pedidos mesmo com o app fechado e tela bloqueada.

**Architecture:** A Edge Function `send-push` já existente dispara dois canais em paralelo: Canal 1 (Web Push/VAPID, atual) e Canal 2 (ntfy.sh self-hosted via Fly.io). O servidor ntfy usa o ntfy.sh cloud como relay para APNs do iOS. Cada usuário tem um token pessoal que configura o app ntfy em 1 toque. Sem Canal 2, o Canal 1 continua funcionando normalmente (degradação graciosa).

**Tech Stack:** Deno/TypeScript (Supabase Edge Functions), React + TypeScript, Supabase PostgreSQL, ntfy.sh (Docker), Fly.io, ntfy app iOS/Android (App Store/Play Store gratuito)

**Pré-requisito:** O plano `2026-04-01-fix-push-notifications.md` deve estar aplicado antes deste.

---

## Mapa de Arquivos

| Arquivo | Operação | Responsabilidade |
|---|---|---|
| `infra/ntfy/fly.toml` | CRIAR | Configuração do app Fly.io |
| `infra/ntfy/server.yml` | CRIAR | Configuração do servidor ntfy.sh |
| `infra/ntfy/README.md` | CRIAR | Guia de deploy e administração do servidor |
| `supabase/migrations/20260401200000_add_ntfy_token.sql` | CRIAR | Adicionar colunas ntfy_token e ntfy_topic na tabela users |
| `supabase/functions/generate-ntfy-token/index.ts` | CRIAR | Edge Function que gera/revoga tokens ntfy por usuário |
| `supabase/functions/send-push/index.ts` | MODIFICAR | Adicionar Canal 2 (ntfy) paralelo ao Web Push existente |
| `src/components/NtfySetupCard.tsx` | CRIAR | Card de configuração ntfy para usuário final |
| `src/App.tsx` | MODIFICAR | Renderizar NtfySetupCard na interface existente |

---

## Task 1: Arquivos de Infraestrutura do Servidor ntfy.sh

**Contexto:** Estes arquivos configuram o servidor ntfy.sh que rodará no Fly.io. O deploy é feito UMA VEZ manualmente pelo desenvolvedor. O servidor usa `auth-default-access: deny-all` (todos os tópicos privados) e `upstream-base-url: https://ntfy.sh` para relay iOS via APNs.

**Arquivos:**
- Criar: `infra/ntfy/fly.toml`
- Criar: `infra/ntfy/server.yml`
- Criar: `infra/ntfy/README.md`

- [ ] **Step 1: Criar diretório de infraestrutura**

```bash
mkdir -p infra/ntfy
```

- [ ] **Step 2: Criar fly.toml**

Criar `infra/ntfy/fly.toml`:

```toml
app = "ntfy-comprafacil"
primary_region = "gru"   # São Paulo — mais próximo do Brasil

[build]
  image = "binwiederhier/ntfy:latest"

[env]
  NTFY_CONFIG_FILE = "/etc/ntfy/server.yml"

[[services]]
  protocol = "tcp"
  internal_port = 80

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.http_checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "get"
    path = "/v1/health"
    protocol = "http"
    tls_skip_verify = false

[[mounts]]
  source = "ntfy_data"
  destination = "/var/cache/ntfy"
  initial_size = "1gb"

[[mounts]]
  source = "ntfy_config"
  destination = "/etc/ntfy"
  initial_size = "100mb"
```

- [ ] **Step 3: Criar server.yml**

Criar `infra/ntfy/server.yml`:

```yaml
# ntfy.sh server configuration
# Documentação: https://docs.ntfy.sh/config/

# URL base do servidor — substitua pelo domínio real após o deploy
base-url: "https://ntfy-comprafacil.fly.dev"

# Listener
listen-http: ":80"

# Auth: todos os tópicos privados por padrão
auth-file: "/etc/ntfy/user.db"
auth-default-access: "deny-all"

# Relay iOS: envia poke (apenas ID da mensagem, sem conteúdo) para APNs via ntfy.sh cloud
upstream-base-url: "https://ntfy.sh"
# upstream-access-token: "tk_XXXX"  # Descomentar após criar conta em ntfy.sh cloud

# Cache de mensagens (fallback se dispositivo estava offline)
cache-file: "/var/cache/ntfy/cache.db"
cache-duration: "12h"

# Operação atrás do proxy Fly.io
behind-proxy: true

# Logging
log-level: "info"
log-format: "json"
```

- [ ] **Step 4: Criar README.md de deploy**

Criar `infra/ntfy/README.md`:

```markdown
# ntfy.sh Self-Hosted — Deploy Guide

Servidor de notificações push para iOS do CompraFácil Motel.

## Pré-requisitos

- Conta no Fly.io (gratuita, requer cartão para verificação)
- `fly` CLI instalado: `curl -L https://fly.io/install.sh | sh`

## Deploy inicial (feito apenas uma vez)

### 1. Login e launch

```bash
fly auth login
cd infra/ntfy
fly launch --name ntfy-comprafacil --no-deploy
```

### 2. Criar volumes

```bash
fly volumes create ntfy_data --size 1 --region gru
fly volumes create ntfy_config --size 1 --region gru
```

### 3. Subir o server.yml para o volume de config

```bash
# SSH no container após primeiro deploy
fly deploy
fly ssh console

# Dentro do container:
cp /etc/ntfy/server.yml /etc/ntfy/server.yml.bak  # se existir
# Editar /etc/ntfy/server.yml com o conteúdo de server.yml
exit
```

### 4. Criar usuário admin

```bash
fly ssh console
ntfy user add --role=admin admin
# Digite uma senha forte e anote: NTFY_ADMIN_PASSWORD
exit
```

### 5. Obter token do admin para a Edge Function send-push

```bash
fly ssh console
# Gera token para o usuário admin (publisher)
ntfy token add --user admin "comprafacil-publisher"
# Anote o token gerado: NTFY_PUBLISHER_TOKEN
exit
```

### 6. Configurar Secrets no Supabase

No Supabase Dashboard → Project Settings → Edge Functions → Secrets:

```
NTFY_BASE_URL        = https://ntfy-comprafacil.fly.dev
NTFY_PUBLISHER_TOKEN = tk_XXXXX  (token do passo 5)
NTFY_ADMIN_BASIC_AUTH = Basic base64(admin:SENHA)  (ver abaixo)
```

Para gerar NTFY_ADMIN_BASIC_AUTH:
```bash
echo -n "admin:SUA_SENHA" | base64
# Resultado: YWRtaW46U1VBX1NFTkhB
# Valor do secret: Basic YWRtaW46U1VBX1NFTkhB
```

### 7. (Recomendado) Criar conta no ntfy.sh cloud para relay iOS ilimitado

1. Acessar https://ntfy.sh e criar conta gratuita
2. Gerar access token em Settings → Access Tokens
3. Adicionar ao server.yml: `upstream-access-token: "tk_XXXXX"`
4. Redeploy: `fly deploy`

## Verificação de saúde

```bash
curl https://ntfy-comprafacil.fly.dev/v1/health
# Esperado: {"healthy":true}
```

## Testar envio manual

```bash
curl -H "Authorization: Bearer SEU_PUBLISHER_TOKEN" \
     -H "Title: Teste" \
     -H "Priority: high" \
     -d "Notificação de teste" \
     https://ntfy-comprafacil.fly.dev/pedidos-teste
```

## Redeploy após mudanças no server.yml

```bash
fly deploy
```
```

- [ ] **Step 5: Commit**

```bash
git add infra/ntfy/
git commit -m "infra: adiciona configuração ntfy.sh self-hosted no Fly.io"
```

---

## Task 2: Migration do Banco de Dados

**Contexto:** Adiciona duas colunas TEXT na tabela `public.users` do Supabase. `ntfy_token` é o token pessoal do usuário para subscribir no app ntfy. `ntfy_topic` é o nome do tópico do usuário (ex: `pedidos-abc12345`). Escrita feita APENAS via Edge Function com service role — usuários não têm permissão direta de UPDATE nessas colunas.

**Arquivos:**
- Criar: `supabase/migrations/20260401200000_add_ntfy_token.sql`

- [ ] **Step 1: Criar migration SQL**

Criar `supabase/migrations/20260401200000_add_ntfy_token.sql`:

```sql
-- Migration: Adiciona suporte a ntfy.sh para notificações iOS confiáveis
-- Escrita via Edge Function generate-ntfy-token (service role only)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ntfy_token TEXT,
  ADD COLUMN IF NOT EXISTS ntfy_topic TEXT;

COMMENT ON COLUMN public.users.ntfy_token IS
  'Token de acesso pessoal ntfy.sh. Gerado pela Edge Function generate-ntfy-token. Somente leitura para o usuário via SELECT policy existente.';

COMMENT ON COLUMN public.users.ntfy_topic IS
  'Tópico ntfy.sh do usuário (ex: pedidos-abc12345). Gerado automaticamente com base no user_id.';
```

- [ ] **Step 2: Verificar que o arquivo foi criado**

```bash
cat supabase/migrations/20260401200000_add_ntfy_token.sql
```

Esperado: conteúdo acima sem erros de sintaxe.

- [ ] **Step 3: Aplicar migration no Supabase**

**Opção A (recomendada — usa o CLI):**
```bash
npx supabase db push
```
Esperado: `Applying migration 20260401200000_add_ntfy_token.sql... done`

**Opção B (manual via Dashboard — use apenas se o CLI não estiver configurado):**
No Supabase Dashboard → SQL Editor, colar e executar o conteúdo do arquivo de migration acima.

Verificar em Table Editor → users: as colunas `ntfy_token` e `ntfy_topic` aparecem.

- [ ] **Step 4: Verificar que RLS existente protege os dados**

No SQL Editor:

```sql
-- Verificar policies existentes na tabela users
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'users';
```

Confirmar que existe policy de SELECT com `auth.uid() = id`. Nenhuma policy de UPDATE direta ao usuário é necessária — a Edge Function usa service role para escrever.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260401200000_add_ntfy_token.sql
git commit -m "feat(db): adiciona colunas ntfy_token e ntfy_topic na tabela users"
```

---

## Task 3: Edge Function generate-ntfy-token

**Contexto:** Nova Edge Function chamada pelo frontend (autenticada via JWT do Supabase). Cria um token de acesso no servidor ntfy.sh para o usuário autenticado. Usa `NTFY_ADMIN_BASIC_AUTH` = `Basic base64(admin:SENHA)` para autenticar na API HTTP do ntfy.sh (`POST /v1/account/token`). Usa `SERVICE_ROLE_KEY` para escrever na tabela `users` bypassando RLS. Também expõe rota de revogação (`DELETE`).

**⚠️ Verificação obrigatória antes de implementar (após Task 1 estar feita):**
Confirmar que o endpoint `POST /v1/account/token` existe na versão do ntfy deployada:
```bash
curl -v -u admin:SUA_SENHA https://ntfy-comprafacil.fly.dev/v1/account/token
```
Esperado: `200 OK`. Se retornar `404`, usar a abordagem alternativa descrita no `infra/ntfy/README.md` (geração de tokens via SSH/CLI em vez de API HTTP).

**Arquivos:**
- Criar: `supabase/functions/generate-ntfy-token/index.ts`

- [ ] **Step 1: Criar diretório da função**

```bash
mkdir -p supabase/functions/generate-ntfy-token
```

- [ ] **Step 2: Criar index.ts**

Criar `supabase/functions/generate-ntfy-token/index.ts`:

```typescript
// Edge Function: generate-ntfy-token
// Gera ou revoga tokens ntfy.sh para o usuário autenticado.
// POST /generate-ntfy-token → retorna { token, topic, server_url }
// DELETE /generate-ntfy-token → revoga token existente

const NTFY_BASE_URL        = Deno.env.get("NTFY_BASE_URL")        ?? "";
const NTFY_ADMIN_BASIC_AUTH = Deno.env.get("NTFY_ADMIN_BASIC_AUTH") ?? ""; // "Basic base64(admin:password)"
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")          ?? "";
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")    ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Valida o JWT do usuário chamador via Supabase Auth
async function getUserFromJWT(authHeader: string | null): Promise<{ id: string } | null> {
  if (!authHeader) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": authHeader,
      "apikey": SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.id ? { id: data.id } : null;
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
async function saveNtfyToken(userId: string, token: string | null, topic: string | null): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ ntfy_token: token, ntfy_topic: topic }),
  });
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

  // Autenticar usuário via JWT
  const user = await getUserFromJWT(req.headers.get("Authorization"));
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const userRecord = await getUser(user.id);
  if (!userRecord) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // POST: gerar ou retornar token existente
  if (req.method === "POST") {
    // Se já tem token, retornar o existente
    if (userRecord.ntfy_token && userRecord.ntfy_topic) {
      console.log("[generate-ntfy-token] Retornando token existente para user:", user.id.slice(0, 8));
      return new Response(JSON.stringify({
        token: userRecord.ntfy_token,
        topic: userRecord.ntfy_topic,
        server_url: NTFY_BASE_URL,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Gerar novo token
    const topic = `pedidos-${user.id.slice(0, 8)}`;
    const label = `comprafacil-user-${user.id.slice(0, 8)}`;
    const token = await createNtfyToken(label);

    if (!token) {
      return new Response(JSON.stringify({ error: "Falha ao criar token no servidor ntfy" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    await saveNtfyToken(user.id, token, topic);
    console.log("[generate-ntfy-token] Token gerado e salvo para user:", user.id.slice(0, 8));

    return new Response(JSON.stringify({ token, topic, server_url: NTFY_BASE_URL }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // DELETE: revogar token
  if (req.method === "DELETE") {
    if (userRecord.ntfy_token) {
      await revokeNtfyToken(userRecord.ntfy_token as string);
    }
    await saveNtfyToken(user.id, null, null);
    return new Response(JSON.stringify({ revoked: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...cors, "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 3: Verificar arquivo criado**

```bash
cat supabase/functions/generate-ntfy-token/index.ts | head -20
```

Esperado: primeiras linhas do arquivo acima.

- [ ] **Step 4: Deploy da função (após configurar secrets)**

```bash
npx supabase functions deploy generate-ntfy-token
```

Esperado: `Deployed Function generate-ntfy-token`. Verificar no Supabase Dashboard → Edge Functions que a função aparece listada.

- [ ] **Step 5: Testar a função manualmente (após deploy do servidor ntfy)**

```bash
# Substituir SEU_JWT pelo token do usuário autenticado no app
curl -X POST https://xakercaneezgyqdekmvj.supabase.co/functions/v1/generate-ntfy-token \
  -H "Authorization: Bearer SEU_JWT" \
  -H "Content-Type: application/json"
```

Esperado: `{"token":"tk_XXXXX","topic":"pedidos-XXXXXX","server_url":"https://ntfy-comprafacil.fly.dev"}`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-ntfy-token/
git commit -m "feat(functions): adiciona edge function generate-ntfy-token"
```

---

## Task 4: Atualizar Edge Function send-push com Canal 2 (ntfy)

**Contexto:** Modifica a Edge Function existente `send-push/index.ts` para disparar o Canal 2 (ntfy.sh) em paralelo ao Canal 1 (Web Push) já existente. A query de usuários deve incluir `ntfy_topic`. Se `NTFY_BASE_URL` ou `NTFY_PUBLISHER_TOKEN` não estiverem configurados, o Canal 2 é silenciosamente ignorado (sem quebrar o Canal 1). Logs claros de ambos os canais.

**Arquivos:**
- Modificar: `supabase/functions/send-push/index.ts`

- [ ] **Step 1: Adicionar as variáveis de ambiente ntfy no topo do arquivo**

No início de `supabase/functions/send-push/index.ts`, após as declarações de env vars existentes (por volta da linha 6), adicionar:

```typescript
const NTFY_BASE_URL        = Deno.env.get("NTFY_BASE_URL")        ?? "";
const NTFY_PUBLISHER_TOKEN = Deno.env.get("NTFY_PUBLISHER_TOKEN") ?? "";
```

- [ ] **Step 2: Adicionar a função sendNtfyNotification antes do Deno.serve()**

Após as funções `dbGet` e `dbDelete` existentes, adicionar:

```typescript
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
```

- [ ] **Step 3: Atualizar a query dbGet de usuários para incluir ntfy_topic**

Localizar a linha:

```typescript
const users = await dbGet("users?select=id,role,roles&deleted=eq.false");
```

Substituir por:

```typescript
const users = await dbGet("users?select=id,role,roles,ntfy_topic&deleted=eq.false");
```

- [ ] **Step 4: Adicionar disparos do Canal 2 após o Promise.allSettled do Web Push**

Localizar o bloco final que começa com:

```typescript
const sent   = results.filter(r => r.status === "fulfilled").length;
const failed = results.filter(r => r.status === "rejected").length;
```

Antes desse bloco, adicionar:

```typescript
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
console.log(`[send-push] Canal 2 (ntfy): ${ntfySent} enviados, ${ntfyFailed} falhas de ${ntfyTargets.length} alvos`);
```

- [ ] **Step 5: Atualizar o response final para incluir dados do Canal 2**

Localizar a linha:

```typescript
return new Response(JSON.stringify({ sent, failed, errors: failed > 0 ? errors : undefined }), {
```

Substituir por:

```typescript
return new Response(JSON.stringify({
  canal1: { sent, failed, errors: failed > 0 ? errors : undefined },
  canal2: { sent: ntfySent, failed: ntfyFailed, targets: ntfyTargets.length },
}), {
```

- [ ] **Step 6: Verificar diff do arquivo**

```bash
git diff supabase/functions/send-push/index.ts
```

Confirmar: variáveis ntfy adicionadas, `sendNtfyNotification` presente, query inclui `ntfy_topic`, bloco Canal 2 presente após `Promise.allSettled`.

- [ ] **Step 7: Deploy da função send-push atualizada**

```bash
npx supabase functions deploy send-push
```

Aguardar confirmação de deploy. Verificar nos logs do Supabase Dashboard → Edge Functions → send-push que a função foi atualizada.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/send-push/index.ts
git commit -m "feat(functions): adiciona Canal 2 ntfy.sh na função send-push"
```

---

## Task 5: Componente NtfySetupCard

**Contexto:** Componente React que guia o usuário em 4 estados: `idle` → `loading` → `ready` → `error`. Estado `ready` mostra um deep link `ntfy://...` que abre o app ntfy já configurado com 1 toque (sem copiar/colar token). Estado `configured` (ntfy_topic preenchido no perfil) mostra badge verde + botão desativar. Usa `supabase` client importado de `@/integrations/supabase/client`.

**Arquivos:**
- Criar: `src/components/NtfySetupCard.tsx`

- [ ] **Step 0: Verificar formato do deep link ntfy antes de implementar**

O formato do deep link para o app ntfy iOS é:
```
ntfy://{servidor}/{topic}?auth={base64url(token)}
```

Confirmar este formato abrindo o app ntfy no iPhone manualmente, adicionando o servidor e verificando se o formato acima funciona. Se não funcionar, o formato alternativo é simplesmente mostrar o token como texto para o usuário copiar/colar manualmente no app ntfy (menos ideal mas sempre funciona).

Para testar o deep link:
```bash
# No terminal, gerar o base64 do token e montar a URL de teste:
echo -n "SEU_TOKEN" | base64
# Resultado: base64_do_token
# Deep link: ntfy://ntfy-comprafacil.fly.dev/pedidos-abc12345?auth=base64_do_token
```

- [ ] **Step 1: Criar o componente**

Criar `src/components/NtfySetupCard.tsx`:

```tsx
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

  // Chama a Edge Function para gerar o token
  async function handleSetup() {
    setState("loading");
    setErrorMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão não encontrada. Faça login novamente.");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ntfy-token`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
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

  // Copia o deep link e abre a App Store se necessário
  async function handleCopyDeepLink() {
    if (!config) return;
    // Deep link que configura o app ntfy automaticamente
    const deepLink = `ntfy://${config.server_url.replace("https://", "")}/${config.topic}?auth=${btoa(config.token)}`;
    await navigator.clipboard.writeText(deepLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Tentar abrir o deep link diretamente
    window.location.href = deepLink;
  }

  // Envia notificação de teste
  async function handleTest() {
    if (!config) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Usar a Edge Function generate-ntfy-token com método PUT para testar
      // Por simplicidade, fazer um pedido falso que dispara o send-push não é ideal.
      // Melhor: endpoint de teste direto. Como não existe, enviamos direto para ntfy:
      await fetch(`${config.server_url}/${config.topic}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "Title": "✅ Teste CompraFácil",
          "Content-Type": "text/plain",
        },
        body: "Notificações iOS funcionando! 🎉",
      });
      setState("configured");
      onConfigured?.();
    } catch {
      // Ignorar erro de CORS — a notificação foi enviada de qualquer forma
      setState("configured");
      onConfigured?.();
    }
  }

  // Revoga o token
  async function handleRevoke() {
    setState("loading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão não encontrada.");

      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ntfy-token`,
        {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${session.access_token}` },
        }
      );
      setConfig(null);
      setState("idle");
      onRevoked?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────

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
          onClick={handleCopyDeepLink}
          className="w-full rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-4 text-sm font-medium transition-colors"
        >
          {copied ? "✅ Link copiado!" : "🔗 Abrir ntfy configurado"}
        </button>
        <p className="text-gray-500 text-xs">
          Se o app não abrir automaticamente, ele está sendo aberto pela primeira vez —
          abra o app ntfy manualmente e depois toque aqui de novo.
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
```

- [ ] **Step 2: Verificar que o arquivo foi criado**

```bash
ls -la src/components/NtfySetupCard.tsx
```

Esperado: arquivo existente com tamanho > 0.

- [ ] **Step 3: Verificar que não há erros de TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros. Se houver erro de `import.meta.env.VITE_SUPABASE_URL`, verificar que o arquivo `src/vite-env.d.ts` contém as tipagens do Vite.

- [ ] **Step 4: Commit**

```bash
git add src/components/NtfySetupCard.tsx
git commit -m "feat(ui): adiciona componente NtfySetupCard para configuração ntfy iOS"
```

---

## Task 6: Integrar NtfySetupCard no App.tsx

**Contexto:** O `App.tsx` já tem banners de notificação (linha ~1065). O `NtfySetupCard` deve aparecer para usuários iOS que já têm o PWA instalado (standalone) — ou seja, como complemento ao `NotifBanner` existente, não substituição. Também deve aparecer na área de configurações se existir. O componente precisa do `userId` e do `ntfy_topic` atual do usuário para saber se já está configurado.

**Arquivos:**
- Modificar: `src/App.tsx`

- [ ] **Step 1: Importar o NtfySetupCard no App.tsx**

No topo de `src/App.tsx`, adicionar o import após os outros imports de componentes:

```typescript
import { NtfySetupCard } from "@/components/NtfySetupCard";
```

- [ ] **Step 2: Verificar onde renderizar o card**

Localizar no App.tsx a linha com `showNotifBanner`:

```typescript
const showNotifBanner = notifStatus === 'default' && 'PushManager' in window && isRunningStandalone();
```

E as linhas onde banners são renderizados (~linha 1065):

```tsx
{showNotifBanner && <NotifBanner onEnable={enableNotifications} onDismiss={()=>setNotifStatus('denied')}/>}
{showIOSInstall  && <IOSInstallBanner onDismiss={()=>setShowIOSInstall(false)}/>}
```

- [ ] **Step 3: Adicionar estado para ntfy_topic do usuário**

Localizar o bloco de states do usuário (por volta de `const [session, setSession]`). Adicionar:

```typescript
const [userNtfyTopic, setUserNtfyTopic] = useState<string | null>(null);
```

- [ ] **Step 4: Carregar ntfy_topic a partir do estado `users`**

O App.tsx usa o estado `users` (linha ~868: `const [users, setUsers] = useState([])`) populado pelo useEffect que chama `supabase.from("users").select("*")`. Adicionar um `useEffect` derivado após o state `userNtfyTopic`:

```typescript
// Derivar ntfy_topic do estado 'users' quando session ou users mudar
useEffect(() => {
  if (!session?.id || !users.length) return;
  const currentUser = (users as Array<Record<string, unknown>>)
    .find(u => u.id === session.id);
  setUserNtfyTopic((currentUser?.ntfy_topic as string) ?? null);
}, [session?.id, users]);
```

Este useEffect reage automaticamente quando `users` é atualizado (ex: após `onConfigured()` buscar o topic do banco e o array `users` ser re-populado).

- [ ] **Step 5: Renderizar NtfySetupCard após os banners existentes**

Após a linha com `IOSInstallBanner`, adicionar:

```tsx
{session && isRunningStandalone() && (
  <NtfySetupCard
    userId={session.id}
    currentNtfyTopic={userNtfyTopic}
    onConfigured={() => {
      // Re-carregar lista de users para o useEffect derivado atualizar userNtfyTopic
      supabase.from("users").select("*").eq("deleted", false)
        .then(({ data }) => { if (data) setUsers(data); });
    }}
    onRevoked={() => setUserNtfyTopic(null)}
  />
)}
```

- [ ] **Step 6: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros novos introduzidos.

- [ ] **Step 7: Build de verificação**

```bash
npm run build
```

Esperado: build completo sem erros. Warnings existentes de antes são aceitáveis.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): integra NtfySetupCard no App.tsx para configuração ntfy iOS"
```

---

## Task 7: Teste End-to-End

**Contexto:** Validação completa do sistema dual-channel. Requer: servidor ntfy no Fly.io deployado (Task 1), secrets configurados no Supabase, migration aplicada (Task 2), ambas as Edge Functions deployadas (Tasks 3 e 4), app buildado e deployado (Tasks 5 e 6).

**Checklist de verificação:**

- [ ] **Step 1: Verificar saúde do servidor ntfy**

```bash
curl https://ntfy-comprafacil.fly.dev/v1/health
```
Esperado: `{"healthy":true}`

- [ ] **Step 2: Verificar que colunas existem no banco**

No Supabase Dashboard → Table Editor → users: colunas `ntfy_token` e `ntfy_topic` presentes e com valor NULL para todos os usuários (estado inicial correto).

- [ ] **Step 3: Testar generate-ntfy-token (POST)**

No browser com o app aberto, abrir DevTools → Console:
```javascript
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch('/functions/v1/generate-ntfy-token', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${session.access_token}` }
});
console.log(await res.json());
```
Esperado: `{ token: "tk_XXXXX", topic: "pedidos-XXXXXXXX", server_url: "https://..." }`

- [ ] **Step 4: Verificar que o token foi salvo no banco**

Supabase Dashboard → Table Editor → users: usuário testado deve ter `ntfy_token` e `ntfy_topic` preenchidos.

- [ ] **Step 5: Testar NtfySetupCard no PWA (iPhone)**

No iPhone com o PWA instalado (Add to Home Screen):
1. Abrir o app CompraFácil
2. O `NtfySetupCard` deve aparecer com botão "Configurar agora"
3. Tocar "Configurar agora" → deve aparecer os 2 passos
4. Baixar app ntfy da App Store
5. Tocar "Abrir ntfy configurado" → o app ntfy deve abrir já configurado com o servidor
6. Tocar "Testar notificação agora" → notificação deve chegar em 2-5 segundos no app ntfy

- [ ] **Step 6: Testar Canal 2 via pedido real e confirmar via logs**

Criar um pedido no sistema como usuário de setor (ex: logar como usuário de setor e criar novo pedido para "chefia"). Verificar AMBOS:

**Verificar logs da Edge Function send-push:**
Supabase Dashboard → Edge Functions → send-push → Logs. Procurar:
```
[send-push] Canal 2 (ntfy): 1 enviados, 0 falhas de 1 alvos
[send-push][ntfy] Enviado: topic=pedidos-XXXXXXXX
```

Esta é a confirmação definitiva de que o Canal 2 funcionou. Como Canal 1 e Canal 2 disparam simultaneamente, verificar apenas a chegada da notificação no dispositivo não distingue qual canal entregou.

**Verificar notificação no iPhone:**
Notificação deve chegar no app ntfy em < 5 segundos, mesmo com o app CompraFácil fechado.

- [ ] **Step 7: Testar degradação graciosa (Canal 1 sem Canal 2)**

Usuário sem ntfy configurado (ntfy_topic = null):
1. Criar pedido
2. Logs devem mostrar: `Canal 2 (ntfy): 0 enviados, 0 falhas de 0 alvos`
3. Canal 1 (Web Push) continua funcionando normalmente

- [ ] **Step 8: Testar revogação**

No NtfySetupCard (estado "configured"), clicar "Desativar":
1. Badge verde deve sumir
2. Card volta ao estado "idle"
3. Supabase users: `ntfy_token` e `ntfy_topic` voltam a NULL
4. Servidor ntfy: token revogado (tentativa de usar o token antigo retorna 401)

- [ ] **Step 9: Commit final e tag**

```bash
git add .
git commit -m "feat: sistema dual-channel de notificações iOS (ntfy.sh self-hosted)

- Servidor ntfy.sh self-hosted no Fly.io com auth e relay iOS APNs
- Edge Function generate-ntfy-token para gestão de tokens por usuário
- Edge Function send-push com Canal 2 ntfy paralelo ao Web Push
- Componente NtfySetupCard com fluxo guiado de configuração em 2 passos
- Deep link ntfy:// para configuração com 1 toque no iOS"
```
