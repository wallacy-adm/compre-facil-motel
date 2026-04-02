# Design Spec: Sistema Dual-Channel de Notificações (Web Push + ntfy.sh Self-Hosted)

**Data:** 2026-04-01
**Status:** Aprovado pelo usuário
**Contexto:** CompraFácil Motel — sistema interno de gestão de pedidos para equipe de 2-10 funcionários com mix de iPhone e Android.

---

## 1. Problema

O Web Push via Service Worker é instável no iOS quando o app está fechado ou o dispositivo bloqueado. O iOS restringe agressivamente processos em segundo plano, mesmo em PWAs instalados. Isso significa que funcionários com iPhone podem perder notificações críticas de pedidos (ex: comprador não recebe alerta às 2h da manhã).

O plano `2026-04-01-fix-push-notifications.md` já corrige 5 bugs no pipeline Web Push existente, mas não resolve a limitação fundamental do iOS: mesmo com o pipeline correto, a Apple pode dormir o Service Worker.

Este spec define a camada complementar: **ntfy.sh self-hosted como segundo canal de entrega**, paralelo ao Web Push, que usa o APNs nativo da Apple (via relay) para chegar ao iPhone mesmo com app fechado.

---

## 2. Solução: Dual-Channel

Dois canais disparados em paralelo pelo mesmo evento de pedido:

```
Novo Pedido no BD
       │
       ▼
  Trigger SQL (pg_net)
       │
       ▼
Edge Function: send-push
   ├──► Canal 1: Web Push (VAPID)    → Android/iOS via FCM/APNs
   └──► Canal 2: ntfy.sh self-hosted → App ntfy iOS/Android (APNs nativo)
```

- Se um canal falhar, o outro entrega.
- No Android, o Canal 1 (Web Push com `urgency: high`) já é confiável. O Canal 2 é backup.
- No iOS, o Canal 2 é o canal principal confiável. O Canal 1 continua ativo como complemento.

---

## 3. Arquitetura do ntfy.sh Self-Hosted

### 3.1 Infraestrutura

- **Plataforma:** Fly.io (plano gratuito — requer cartão de crédito para verificação, sem cobrança para uso leve)
- **Imagem:** `binwiederhier/ntfy:latest` (Docker oficial)
- **HTTPS:** Automático via Fly.io (certificado Let's Encrypt)
- **Domínio:** `ntfy-comprafacil.fly.dev` (ou domínio customizado se disponível)
- **Armazenamento:** Volume Fly.io 1GB para cache de mensagens e configuração
- **Risco e mitigação:** Fly.io pode alterar termos do plano gratuito. Mitigação: o servidor ntfy é stateless além do cache (mensagens expiram em 12h). Se o Fly.io falhar, o Canal 1 (Web Push) continua funcionando. Em caso de mudança de planos, migrar para Railway.app ou Render.com é trivial (mesma imagem Docker).
- **Health check:** Configurar monitoramento em `https://ntfy-comprafacil.fly.dev/v1/health` — retorna `{"healthy":true}` quando operacional.

### 3.2 Configuração ntfy.sh

```yaml
# server.yml
base-url: "https://ntfy-comprafacil.fly.dev"
auth-file: "/etc/ntfy/user.db"
auth-default-access: "deny-all"          # Tópicos privados por padrão
upstream-base-url: "https://ntfy.sh"     # Relay iOS APNs
cache-file: "/var/cache/ntfy/cache.db"
cache-duration: "12h"
behind-proxy: true
```

### 3.3 Modelo de Acesso

- Cada usuário do CompraFácil recebe um **access token** único gerado pelo ntfy.sh
- O token é armazenado na tabela `users` do Supabase (coluna `ntfy_token`)
- Cada usuário assina seu próprio tópico: `pedidos-{user_id_curto}`
- A Edge Function `send-push` usa um token de **publisher** (admin) para enviar
- Os usuários usam seus tokens pessoais apenas para **subscribir** (read-only)

### 3.4 Limite do Relay iOS e Monitoramento de Quota

- O relay gratuito do `ntfy.sh` cloud: **250 pokes/dia** (não mensagens completas — apenas um ping de ~50 bytes)
- **Cálculo real:** cada pedido dispara 1 poke por usuário com ntfy configurado. Com 5 usuários iOS e 40 pedidos/dia = 200 pokes/dia (próximo do limite)
- **Mitigação:** A Edge Function `send-push` deve logar um warning quando `ntfy_relay_count > 200` no dia. Implementar contador diário simples via Supabase (tabela `ntfy_relay_stats` com data e count).
- **Se limite atingido:** Criar conta gratuita em `ntfy.sh` e obter `upstream-access-token` — aumenta o limite substancialmente sem custo.
- **Degradação graciosa:** Se o relay falhar (quota ou erro), o Canal 1 (Web Push) continua funcionando. O usuário pode não receber no ntfy mas o Web Push ainda tenta. Nenhum erro fatal.
- **Ação recomendada no deploy:** Criar conta em ntfy.sh cloud e configurar `upstream-access-token` desde o início para evitar problemas.

---

## 4. Componentes a Implementar

### 4.1 Infraestrutura: Deploy ntfy.sh no Fly.io

**Arquivos novos:**
- `infra/ntfy/fly.toml` — configuração do app Fly.io
- `infra/ntfy/server.yml` — configuração do servidor ntfy
- `infra/ntfy/README.md` — instruções de deploy e administração

**Processo de deploy (único, feito pelo dev):**
1. `fly launch` com a imagem ntfy
2. Criar volume para persistência
3. Configurar `auth-file` e criar usuário publisher
4. Adicionar secret `NTFY_PUBLISHER_TOKEN` e `NTFY_BASE_URL` no Supabase

### 4.2 Banco de Dados: Migration

**Arquivo:** `supabase/migrations/20260401200000_add_ntfy_token.sql`

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ntfy_token TEXT,
  ADD COLUMN IF NOT EXISTS ntfy_topic TEXT;

COMMENT ON COLUMN public.users.ntfy_token IS
  'Token de acesso pessoal ntfy.sh para receber notificações push confiáveis';
COMMENT ON COLUMN public.users.ntfy_topic IS
  'Tópico ntfy.sh do usuário (ex: pedidos-abc123)';
```

**RLS:** As colunas `ntfy_token` e `ntfy_topic` devem ser visíveis apenas para o próprio usuário. A policy existente de SELECT cobre isso. Para UPDATE (escrita do token pelo backend), a função `generate-ntfy-token` deve usar o `SERVICE_ROLE_KEY` (que bypassa RLS). Não dar permissão de UPDATE direto ao usuário autenticado para essas colunas — apenas o backend pode escrever tokens.

```sql
-- Verificar que a policy existente cobre SELECT para próprio usuário
-- A escrita de ntfy_token/ntfy_topic é feita APENAS via Edge Function com service role
-- Não é necessária uma policy de UPDATE para o usuário
```

### 4.3 Edge Function: send-push Atualizada

**Arquivo:** `supabase/functions/send-push/index.ts`

Adicionar após o bloco de Web Push existente:

```typescript
// ── CANAL 2: ntfy.sh ──────────────────────────────────────────────────────
const NTFY_BASE_URL       = Deno.env.get("NTFY_BASE_URL") ?? "";
const NTFY_PUBLISHER_TOKEN = Deno.env.get("NTFY_PUBLISHER_TOKEN") ?? "";

async function sendNtfyNotification(
  topic: string,
  title: string,
  body: string,
  url: string
): Promise<void> {
  if (!NTFY_BASE_URL || !NTFY_PUBLISHER_TOKEN) return;
  const res = await fetch(`${NTFY_BASE_URL}/${topic}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NTFY_PUBLISHER_TOKEN}`,
      "Title":         title,
      "Priority":      "high",
      "Tags":          "bell",
      "Click":         url,
      "Content-Type":  "text/plain",
    },
    body: body,
  });
  if (!res.ok) {
    console.error("[send-push][ntfy] Falha:", res.status, topic);
  } else {
    console.log("[send-push][ntfy] Enviado:", topic);
  }
}
```

**Lógica de envio:** Após o `Promise.allSettled` do Web Push, disparar em paralelo `sendNtfyNotification` para cada usuário-alvo que tiver `ntfy_topic` preenchido.

A query `dbGet("users?...")` deve incluir `ntfy_topic` no select.

### 4.4 Frontend: Componente `NtfySetupCard`

**Arquivo:** `src/components/NtfySetupCard.tsx`

Componente exibido na tela de configurações do usuário (ou em modal dedicado), com:

- **Estado 1 (não configurado):** Card explicativo + botão "Configurar notificações para iPhone"
- **Estado 2 (em progresso):** Instruções passo a passo:
  1. Baixar app ntfy na App Store (link direto)
  2. Tocar "Copiar link de configuração" — copia uma URL de deep link no formato `ntfy://subscribe/{server}/{topic}?auth={token}` que configura o app ntfy automaticamente (sem copiar/colar token manualmente)
  3. Abrir o link no iOS → abre o app ntfy já configurado
  4. Botão "Testar — me envie uma notificação agora"
- **Estado 3 (configurado):** Badge verde "Notificações iOS ativas" + botão "Desativar" (revoga token no servidor ntfy + limpa banco)
- **Estado 4 (erro):** Se `generate-ntfy-token` falhar, exibir mensagem de erro + botão "Tentar novamente". Se offline, armazenar intenção e retomar quando reconectar.
- **Validação de token:** Antes de mostrar o deep link, validar que `ntfy_token` foi salvo corretamente (GET no endpoint do servidor ntfy com o token para confirmar).

**Geração de token:** Quando o usuário abre o card pela primeira vez, o app chama a Edge Function `generate-ntfy-token` (nova, ver 4.5) que cria o token no servidor ntfy e salva em `users.ntfy_token`.

### 4.5 Edge Function: generate-ntfy-token (nova)

**Arquivo:** `supabase/functions/generate-ntfy-token/index.ts`

Chamada pelo frontend (autenticada via Supabase JWT). Usa `SERVICE_ROLE_KEY` para escrever na tabela `users` (bypass RLS necessário para escrita de server-side).

**Como ntfy.sh gerencia tokens (esclarecimento importante):**
O ntfy.sh self-hosted não tem API de "criar usuário". O modelo real é:
- O **publisher token** (`NTFY_PUBLISHER_TOKEN`) é um token único do servidor, criado uma vez no deploy via `ntfy token add publisher`. É usado pelo backend para enviar mensagens.
- Os **subscriber tokens** por usuário são gerados com `ntfy token add {username}` via CLI no servidor. Cada usuário recebe um token read-only para o seu tópico.
- Tópicos são criados implicitamente no primeiro `POST` — não há API de criação.

**Na prática para esta função:**
1. Verificar se o usuário já tem `ntfy_token` — se sim, retornar o existente
2. Se não: gerar um token único com `crypto.randomUUID()` e registrá-lo no servidor ntfy via API admin (`POST /v1/account/token` com `NTFY_ADMIN_TOKEN`)
3. Definir o tópico: `pedidos-{user_id.slice(0, 8)}`
4. Salvar `ntfy_token` e `ntfy_topic` na tabela `users` via `SERVICE_ROLE_KEY`
5. Retornar `{ token, topic, server_url }` para o frontend

**Nota sobre revogação:** Se o usuário desativar as notificações, a função deve chamar `DELETE /v1/account/token/{token}` no servidor ntfy para revogar. O frontend deve ter botão "Desativar notificações iOS" que aciona esse cleanup.

### 4.6 Secrets Supabase (novos)

| Secret | Valor |
|---|---|
| `NTFY_BASE_URL` | `https://ntfy-comprafacil.fly.dev` |
| `NTFY_PUBLISHER_TOKEN` | Token do usuário publisher (gerado no deploy) |
| `NTFY_ADMIN_TOKEN` | Token admin para criar usuários via API |

---

## 5. Fluxo Completo do Usuário (iPhone)

```
1. Usuário abre CompraFácil no iPhone (Safari ou PWA)
2. Vê card "Configure notificações no seu iPhone"
3. Toca "Configurar" → app gera token automático (invisível)
4. Tela mostra: "Baixe o app ntfy" [botão App Store]
5. Usuário baixa ntfy (30 segundos)
6. Volta ao CompraFácil → toca "Copiar código de configuração"
7. No app ntfy: + → colar URL do servidor → colar token → salvar
8. Toca "Testar agora" → notificação chega em 2-3 segundos
9. Pronto. iPhone recebe pedidos mesmo bloqueado.
```

---

## 6. Fluxo do Android

O Android **não precisa do ntfy.sh** para funcionar. O Web Push com `urgency: high` já bypassa o Doze Mode via FCM. O ntfy funciona como backup opcional.

Se o usuário Android quiser a camada extra de confiabilidade:
- Pode seguir o mesmo fluxo acima (app ntfy existe para Android também)
- Mas para a maioria dos casos, o Canal 1 (Web Push) é suficiente

---

## 7. Considerações de Segurança

- **Tópicos privados:** `auth-default-access: deny-all` no servidor ntfy. Sem token, não acessa.
- **Conteúdo mínimo no relay:** O relay do ntfy.sh cloud vê apenas o `topic_hash` (SHA256), nunca o conteúdo da notificação.
- **Token por usuário:** Cada funcionário tem seu próprio token. Revogar acesso = deletar token no servidor ntfy.
- **VAPID keys:** Devem estar APENAS em Supabase Secrets, nunca hardcoded. O plan 2026-04-01 já aborda isso.

---

## 8. O que NÃO está no escopo

- App nativo (APK/iOS) via Capacitor — descartado (custo Apple Developer)
- Push para clientes do motel — sistema é apenas para funcionários internos
- Notificações por e-mail como fallback — fora do escopo atual

---

## 9. Dependências e Pré-requisitos

1. Plano `2026-04-01-fix-push-notifications.md` deve estar aplicado primeiro (fix dos 5 bugs)
2. Conta no Fly.io (gratuita, requer cartão de crédito para verificação)
3. `fly` CLI instalado localmente para o deploy inicial
4. Acesso ao Supabase Dashboard para adicionar Secrets

---

## 10. Critérios de Sucesso

- [ ] iPhone com app ntfy instalado recebe notificação em < 5 segundos com app CompraFácil fechado e tela bloqueada
- [ ] Android continua recebendo notificações normalmente via Web Push
- [ ] Usuário sem ntfy configurado continua recebendo via Web Push (sem regressão)
- [ ] Logs da Edge Function mostram "Canal 1: X enviados, Canal 2: Y enviados" por pedido
- [ ] Servidor ntfy no Fly.io responde com uptime > 99% (monitoramento básico)
