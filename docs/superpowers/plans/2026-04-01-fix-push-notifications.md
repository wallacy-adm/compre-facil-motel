# Fix Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 5 bugs críticos do pipeline de push notifications do CompraFácil para que notificações funcionem em iOS (PWA instalado) e Android.

**Architecture:** O pipeline tem 4 camadas — DB Trigger → Edge Function (Deno) → Web Push Protocol (VAPID) → Service Worker no browser. Cada tarefa neste plano ataca uma camada específica, de baixo (banco) para cima (browser). Nenhuma tarefa depende da anterior para ser testada.

**Tech Stack:** PostgreSQL (pg_net extension), Deno/Supabase Edge Functions, web-push@3.6.7, Web Push API (VAPID), Service Worker API, React + TypeScript (App.tsx)

---

## Mapa de Arquivos

| Arquivo | Operação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260401000000_fix_push_trigger_final.sql` | CRIAR | Migration definitiva: dropa conflitos, cria trigger correto |
| `supabase/functions/send-push/index.ts` | MODIFICAR | Adicionar validação de env vars, logging detalhado por camada |
| `public/sw.js` | MODIFICAR | Remover requireInteraction (iOS), melhorar error handling |
| `src/App.tsx` | MODIFICAR | Condicionar banner para standalone mode; melhorar iOS UX |

---

## Task 1: Migration Definitiva do Trigger

**Problema:** 4 migrations conflitantes reescrevem a mesma função com schemas diferentes (`net.http_post` vs `extensions.http_post`). A migration original enviava body `'{}'` vazio.

**Arquivos:**
- Criar: `supabase/migrations/20260401000000_fix_push_trigger_final.sql`

- [ ] **Step 1: Criar migration definitiva**

Criar o arquivo `supabase/migrations/20260401000000_fix_push_trigger_final.sql` com o conteúdo abaixo. Esta migration é idempotente e elimina todos os conflitos anteriores:

```sql
-- ================================================================
-- MIGRATION DEFINITIVA: Fix Push Notifications Trigger
-- Elimina conflitos de migrations anteriores.
-- Usa net.http_post() — schema correto do pg_net no Supabase.
-- ================================================================

-- Garante que pg_net está habilitado (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Remove trigger e função de QUALQUER versão anterior
DROP TRIGGER IF EXISTS orders_push_notify ON public.orders;
DROP FUNCTION IF EXISTS public.notify_push_on_order() CASCADE;

-- Recria a função com schema correto e body completo
CREATE OR REPLACE FUNCTION public.notify_push_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://xakercaneezgyqdekmvj.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', 'comprafacil-push-2025'
    ),
    body    := jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     row_to_json(NEW)::jsonb,
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END
    )::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear a operação principal por falha no push
  RAISE WARNING '[notify_push_on_order] Erro ao chamar send-push: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Cria trigger limpo
CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_order();

-- Verificação: exibe a definição ativa da função
DO $$
BEGIN
  RAISE NOTICE 'Trigger orders_push_notify criado com sucesso usando net.http_post()';
END;
$$;
```

- [ ] **Step 2: Verificar que o arquivo foi criado corretamente**

```bash
cat "supabase/migrations/20260401000000_fix_push_trigger_final.sql"
```
Esperado: conteúdo completo da migration acima.

- [ ] **Step 3: Validar no Supabase (manual — requer acesso ao dashboard)**

No Supabase Dashboard → SQL Editor, execute:
```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'notify_push_on_order';
```
Esperado: a função deve usar `net.http_post()` e conter `row_to_json(NEW)::jsonb`.

Se a função ainda mostrar a versão errada, executar a migration manualmente no SQL Editor.

- [ ] **Step 4: Testar trigger com INSERT manual**

No Supabase SQL Editor:
```sql
INSERT INTO public.orders (id, user_id, status, destino, sector_label, priority, items, created_at)
VALUES ('test-push-001', 'test-user', 'pendente', 'chefia', 'Recepção', 'normal', '[]', now()::text);
```
Verificar em Edge Functions → send-push → Logs se o log `[send-push]` aparece.

- [ ] **Step 5: Limpar registro de teste**

```sql
DELETE FROM public.orders WHERE id = 'test-push-001';
```

---

## Task 2: Edge Function — Validação de Env Vars e Logging Cirúrgico

**Problema:** `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` têm fallback para string vazia, causando falha silenciosa quando não configuradas. Não há logging suficiente para identificar em qual camada o pipeline quebra.

**Arquivos:**
- Modificar: `supabase/functions/send-push/index.ts`

- [ ] **Step 1: Substituir conteúdo do index.ts com versão com validação e logging**

Substituir o arquivo `supabase/functions/send-push/index.ts` completo por:

```typescript
import webpush from "npm:web-push@3.6.7";

// ── ENV VARS ────────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")  ?? "BLUGwL3JIYZxi08-Pc7ULoJv2zo2SUjWKpHbypCFzK6wEhxOveo86kl0yLoDfanhL8N-65C2_RE5PY3YzmN2Jlo";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "1ERdsBRyjju0Y1Ept2Fb8BewMJ0e2HVJMEfZTdkecjg";
const VAPID_EMAIL       = Deno.env.get("VAPID_EMAIL")       ?? "mailto:admin@carpediemmotel.com";
const WEBHOOK_SECRET    = Deno.env.get("WEBHOOK_SECRET")    ?? "comprafacil-push-2025";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")      ?? "";
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── STARTUP VALIDATION ──────────────────────────────────────────────────────
const startupErrors: string[] = [];
if (!SUPABASE_URL)  startupErrors.push("SUPABASE_URL não configurada");
if (!SERVICE_KEY)   startupErrors.push("SUPABASE_SERVICE_ROLE_KEY não configurada");
if (startupErrors.length > 0) {
  console.error("[send-push] CONFIGURAÇÃO INVÁLIDA:", startupErrors.join(" | "));
} else {
  console.log("[send-push] Iniciando. SUPABASE_URL:", SUPABASE_URL.substring(0, 40) + "...");
}

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
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[send-push] dbGet abortado: env vars vazias. Path:", path);
    return [];
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  console.log("[send-push] dbGet:", url.substring(0, 80));
  const res = await fetch(url, { headers: dbHeaders });
  if (!res.ok) {
    console.error("[send-push] dbGet falhou. Status:", res.status, "Path:", path);
    return [];
  }
  return res.json();
}

async function dbDelete(path: string) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "DELETE", headers: dbHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── CAMADA 1: Auth ─────────────────────────────────────────────────────
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      console.warn("[send-push] Webhook secret inválido");
      return new Response("Unauthorized", { status: 401 });
    }

    // ── CAMADA 2: Parse do body ────────────────────────────────────────────
    const body = await req.json();
    const type   = body.type   as string;
    const order  = body.record as Record<string, unknown>;
    const oldRec = body.old_record as Record<string, unknown> | null;

    console.log("[send-push] Recebido. type:", type, "order.id:", order?.id, "status:", order?.status);

    if (!order) {
      console.warn("[send-push] Body sem 'record'. Body recebido:", JSON.stringify(body).substring(0, 200));
      return new Response(JSON.stringify({ skipped: "no record" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── CAMADA 3: Lógica de negócio ────────────────────────────────────────
    let notifyRoles: string[] = [];
    let notification: { title: string; body: string; tag: string; url: string } | null = null;

    if (type === "INSERT" && order.status === "pendente") {
      const setor = (order.sectorLabel || order.sector_label || "setor") as string;
      if (order.destino === "comprador") {
        notifyRoles = ["comprador"];
        notification = { title: "🛒 Pedido para Compra", body: `Pedido de ${setor} direto para compra`, tag: `order-buy-${order.id}`, url: "/" };
      } else {
        notifyRoles = ["admin", "chefia"];
        notification = { title: "📋 Novo Pedido", body: `Pedido de ${setor} aguardando aprovação`, tag: `order-new-${order.id}`, url: "/" };
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

    console.log("[send-push] notifyRoles:", notifyRoles, "| notification:", notification?.title ?? "null");

    if (!notification || notifyRoles.length === 0) {
      return new Response(JSON.stringify({ skipped: "no matching condition", type, status: order.status, destino: order.destino }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── CAMADA 4: Busca de usuários ────────────────────────────────────────
    const users = await dbGet("users?select=id,role,roles&deleted=eq.false");
    console.log("[send-push] Usuários encontrados:", Array.isArray(users) ? users.length : "ERRO");

    const targetIds: string[] = (Array.isArray(users) ? users : [])
      .filter((u: Record<string, unknown>) => {
        const roles = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : []);
        return notifyRoles.some(r => (roles as string[]).includes(r));
      })
      .map((u: Record<string, unknown>) => u.id as string);

    console.log("[send-push] Target user IDs:", targetIds);

    if (targetIds.length === 0) {
      return new Response(JSON.stringify({ skipped: "no target users", notifyRoles }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── CAMADA 5: Busca de subscriptions ──────────────────────────────────
    const idsParam = targetIds.map(id => `"${id}"`).join(",");
    const subs = await dbGet(`push_subscriptions?user_id=in.(${idsParam})&select=id,endpoint,subscription`);
    console.log("[send-push] Subscriptions encontradas:", Array.isArray(subs) ? subs.length : "ERRO");

    if (!Array.isArray(subs) || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions for target users", targetIds }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── CAMADA 6: Envio via web-push ───────────────────────────────────────
    const payload = JSON.stringify(notification);
    const pushOptions = { TTL: 86400, urgency: "high" as const };

    const results = await Promise.allSettled(
      subs.map(async (row: Record<string, unknown>) => {
        try {
          await webpush.sendNotification(row.subscription as webpush.PushSubscription, payload, pushOptions);
          console.log("[send-push] Enviado para endpoint:", String(row.endpoint).substring(0, 50));
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          console.error("[send-push] Falha no envio. StatusCode:", status, "EndpointID:", row.id);
          if (status === 404 || status === 410) {
            console.log("[send-push] Removendo subscription morta:", row.id);
            await dbDelete(`push_subscriptions?id=eq.${row.id}`);
          }
          throw err;
        }
      })
    );

    const sent   = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;
    const errors = results.filter(r => r.status === "rejected").map(r => (r as PromiseRejectedResult).reason?.message ?? String((r as PromiseRejectedResult).reason));

    console.log(`[send-push] RESULTADO: ${sent} enviados, ${failed} falhas.`, failed > 0 ? "Erros:" : "", errors);

    return new Response(JSON.stringify({ sent, failed, errors: failed > 0 ? errors : undefined }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[send-push] Erro não tratado:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Verificar diff do arquivo**

```bash
git diff supabase/functions/send-push/index.ts
```
Confirmar que os logs por camada estão presentes e que os fallbacks de env vars foram mantidos (backward-compatible).

- [ ] **Step 3: Configurar Secrets no Supabase (manual)**

No Supabase Dashboard → Edge Functions → send-push → Secrets, confirmar que estão configurados:
- `SUPABASE_URL` = URL do projeto (ex: `https://xakercaneezgyqdekmvj.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` = service_role key do projeto
- `VAPID_PUBLIC_KEY` = chave pública VAPID
- `VAPID_PRIVATE_KEY` = chave privada VAPID
- `VAPID_EMAIL` = `mailto:admin@carpediemmotel.com`
- `WEBHOOK_SECRET` = `comprafacil-push-2025`

---

## Task 3: Service Worker — Compatibilidade iOS

**Problema:** `requireInteraction: true` não é suportado em WebKit e pode causar falha silenciosa no `showNotification()` no iOS. O `vibrate` também não é suportado.

**Arquivos:**
- Modificar: `public/sw.js`

- [ ] **Step 1: Atualizar public/sw.js**

Substituir o conteúdo de `public/sw.js` por:

```javascript
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'CompraFácil', body: event.data.text() };
  }

  const url = data.url || '/';

  // setAppBadge: suportado em alguns browsers/PWAs
  if ('setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(1).catch(() => {});
  }

  // iOS Safari não suporta requireInteraction nem vibrate
  // Remover essas opções garante compatibilidade sem quebrar outros browsers
  const notifOptions = {
    body: data.body || '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: data.tag || 'comprafacil',
    renotify: true,
    data: { url },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'CompraFácil', notifOptions)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          c.postMessage({ type: 'NAVIGATE', url });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Verificar diff**

```bash
git diff public/sw.js
```
Confirmar: `requireInteraction` removido, `vibrate` removido, restante idêntico.

---

## Task 4: App.tsx — Banner Apenas no Modo Standalone (PWA)

**Problema:** O `NotifBanner` aparece para usuários iOS que acessam pelo Safari normal, onde `PushManager` pode existir como stub mas push não funciona sem ser PWA instalado. Isso cria confusão: o usuário clica "Ativar" e nada acontece.

**Arquivos:**
- Modificar: `src/App.tsx` (linhas ~881 e ~1048)

- [ ] **Step 1: Adicionar helper isStandalone logo após a função subscribePush**

Localizar no App.tsx o bloco `// ── BANNERS PWA` (em torno da linha 104) e adicionar antes dele:

```typescript
// Detecta se o app está rodando como PWA instalada (standalone)
function isRunningStandalone(): boolean {
  // iOS Safari
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  // Outros browsers (Android Chrome, Desktop)
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}
```

- [ ] **Step 2: Atualizar condição do showNotifBanner (linha ~1048)**

Localizar:
```typescript
const showNotifBanner = notifStatus === 'default' && 'PushManager' in window;
```

Substituir por:
```typescript
const showNotifBanner = notifStatus === 'default' && 'PushManager' in window && isRunningStandalone();
```

- [ ] **Step 3: Verificar diff**

```bash
git diff src/App.tsx
```
Confirmar: a nova função `isRunningStandalone` foi adicionada e a condição `showNotifBanner` inclui `isRunningStandalone()`.

- [ ] **Step 4: Verificar que o NotifBanner segue aparecendo em PWA**

No iPhone com o PWA instalado (Add to Home Screen), abrir o app. O banner deve aparecer. No Safari normal (não instalado), o banner NÃO deve aparecer — o IOSInstallBanner deve aparecer no lugar.

---

## Task 5: Build + Verificação Final

**Problema:** `dist/sw.js` está desatualizado em relação a `public/sw.js`. O deploy usa o output do build.

- [ ] **Step 1: Fazer build de produção**

```bash
npm run build
# ou: bun run build
```
Esperado: saída sem erros, `dist/` atualizado.

- [ ] **Step 2: Confirmar que dist/sw.js foi atualizado**

```bash
diff public/sw.js dist/sw.js
```
Esperado: sem diferenças (Vite copia `public/*` para `dist/` automaticamente).

- [ ] **Step 3: Commit de todas as alterações**

```bash
git add \
  supabase/migrations/20260401000000_fix_push_trigger_final.sql \
  supabase/functions/send-push/index.ts \
  public/sw.js \
  src/App.tsx
git commit -m "fix: corrige pipeline de push notifications (5 bugs críticos)

- Migration definitiva: elimina conflito de schemas pg_net
- Edge Function: validação de env vars + logging por camada
- Service Worker: remove requireInteraction/vibrate (compat iOS)
- App.tsx: NotifBanner só aparece em modo standalone (PWA)"
```

---

## Task 6: Teste End-to-End no iPhone

- [ ] **Step 1: No iPhone, abrir o Safari e acessar o site**

Confirmar que aparece `IOSInstallBanner` (não o `NotifBanner`).

- [ ] **Step 2: Instalar como PWA**

Safari → Share → "Adicionar à Tela de Início" → Confirmar.

- [ ] **Step 3: Abrir o app pela Home Screen**

O banner "🔔 Ative as notificações" deve aparecer.

- [ ] **Step 4: Clicar "Ativar" e conceder permissão**

O iOS vai exibir o diálogo nativo de permissão. Confirmar "Allow".

- [ ] **Step 5: Verificar subscription no banco**

No Supabase → Table Editor → `push_subscriptions`. Deve aparecer 1 linha com o endpoint do iPhone.

- [ ] **Step 6: Criar um pedido por outro usuário**

Logar como um usuário de setor, criar um pedido com destino "chefia" ou "admin".

- [ ] **Step 7: Confirmar notificação no iPhone**

A notificação push deve aparecer em ~2-5 segundos. Verificar também os logs da Edge Function no dashboard.

---

## Observação Final

Se após todas as correções a notificação ainda não chegar no iPhone, o próximo passo é verificar nos logs da Edge Function qual camada está falhando. Com os logs por camada adicionados na Task 2, será possível identificar exatamente onde para: trigger → edge function → usuarios → subscriptions → web-push.
