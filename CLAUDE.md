# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Perfil do Usuario

O dono deste projeto **NAO tem conhecimento tecnico** em programacao. Todas as tarefas devem ser executadas de forma **100% autonoma**, sem pedir ao usuario para rodar comandos, editar arquivos ou acessar paineis. Se algo requer acesso externo (Supabase Dashboard, Lovable, etc.), o Claude deve tentar resolver por APIs, CLI ou workflows automatizados antes de pedir qualquer acao manual. Quando for inevitavel pedir algo, dar instrucoes visuais passo-a-passo extremamente simples.

## Modo Hibrido de Modelos (OBRIGATORIO)

Sempre usar o modelo mais adequado para cada tarefa:
- **Opus** → tarefas complexas (arquitetura, debugging, analise de causa raiz, planejamento)
- **Sonnet** → tarefas normais (implementacao de features, code review, refactoring)
- **Haiku** → tarefas simples (buscas, leitura de arquivos, formatacao, perguntas rapidas)

Isso e padrao do projeto para economia de tokens. **Nunca esquecer.**

## Commands

```bash
npm run dev        # local dev server (Vite, port 5173)
npm run build      # production build
npm run lint       # ESLint
npm run test       # Vitest (run once)
npm run test:watch # Vitest (watch mode)
```

## Architecture

### Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives)
- **Backend**: Supabase (PostgreSQL + Edge Functions + Realtime)
- **Hosting**: Lovable (auto-deploys on push to `main`)

### Authentication
The app uses **custom auth** — NOT Supabase Auth. Users are stored in `public.users` table with plain-text username/password. Session is persisted in `localStorage` via the `LS` helper object in `App.tsx`. `supabase.auth.getSession()` always returns null — never use it. The Supabase client uses the anon key (`VITE_SUPABASE_PUBLISHABLE_KEY`).

**Critical**: The Supabase gateway blocks Edge Function calls from the anon key (`role: anon`) because it requires `role: authenticated`. Workaround: avoid calling Edge Functions from the frontend when possible; write directly to the DB via `supabase.from(...)`.

### All-in-one App.tsx
The entire application lives in `src/App.tsx` (~2000+ lines, `// @ts-nocheck`). It contains:
- `ErrorBoundary` class component (global crash handler)
- `LS` object — safe `localStorage` wrapper
- `CarpeDiemLogo` — inline SVG component (Cinzel font from Google Fonts)
- `isRunningStandalone()` — detects PWA standalone mode (needed for iOS push card)
- `playAlertSound()` — Web Audio API in-app alert beep
- All business logic: login, orders, sectors, roles, real-time subscriptions

`src/pages/Index.tsx` just re-exports from `App.tsx`. `src/components/NavLink.tsx` is the only extracted UI component besides `NtfySetupCard.tsx`.

### Database (Supabase PostgreSQL via Lovable Cloud)
**IMPORTANTE**: O banco de dados e gerenciado **exclusivamente pelo Lovable Cloud**, NAO pelo Supabase Dashboard. O usuario NAO tem acesso ao Supabase Dashboard e NUNCA deve ser direcionado para la. Toda interacao com o banco deve ser feita pelo Lovable.

Tables managed via `supabase/migrations/`:
- `users` — custom auth, roles (JSONB), ntfy_topic (TEXT), ntfy_token (TEXT)
- `orders` — all fields TEXT/JSONB; `status`: `pendente → aprovado → concluido`; `destino`: `chefia | comprador`
- `push_subscriptions` — Web Push VAPID subscriptions per user

**Schema changes**: Aplicar via **Lovable Cloud SQL Editor** em https://lovable.dev/projects/1922eec0-a903-4396-bae6-888408f5ec7a (aba Supabase > SQL Editor). O folder `supabase/migrations/` serve como documentacao e fonte para referencia. **NUNCA pedir ao usuario para acessar o Supabase Dashboard** — ele usa apenas o Lovable.

### Push Notifications (dual-channel)
1. **Web Push (VAPID)** — `supabase/functions/send-push/index.ts` sends via `web-push` npm package. Subscriptions stored in `push_subscriptions`. Works on Android Chrome. Does NOT work on iOS Safari PWA.
2. **ntfy.sh** — `src/components/NtfySetupCard.tsx` configures the iOS channel. Generates a topic locally (`cf-{userId8}-{random5}`), saves to `users.ntfy_topic`, then opens deep link `ntfys://ntfy.sh/{topic}` so the user subscribes in the ntfy iOS app. `send-push` publishes to `https://ntfy.sh/{topic}` (public server, no auth needed).

The database trigger `orders_push_notify` (in `20260406000000_fix_trigger_auth_header.sql`) fires on INSERT/UPDATE of `orders` and calls `send-push` via `net.http_post()` (pg_net extension). **O trigger DEVE incluir o header `Authorization: Bearer <anon_key>`** senao o gateway do Supabase retorna 401 silenciosamente.

**NtfySetupCard visibility**: shown only when `session && (isRunningStandalone() || isIOS)` — not shown on desktop or browser (non-standalone) to avoid confusion.

### Edge Functions
Located in `supabase/functions/`. Deployed automaticamente pelo **Lovable** on push to `main`. O workflow `deploy.yml` do GitHub Actions e um fallback, mas o Lovable e o mecanismo principal de deploy.
- `send-push` — receives webhook from DB trigger, sends Web Push + ntfy notifications. Skips Web Push when VAPID keys are not configured (logs warning instead of failing silently).
- `generate-ntfy-token` — legacy; not actively used.

Env vars needed in Supabase secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`. `NTFY_BASE_URL` defaults to `https://ntfy.sh`, `NTFY_PUBLISHER_TOKEN` is optional.

**IMPORTANTE**: Nunca usar fallbacks hardcoded para chaves VAPID. Se as env vars nao estiverem configuradas, a funcao deve logar erro e pular o canal Web Push.

### Realtime
`supabase_realtime` publication includes `orders` table. The frontend subscribes via `supabase.channel(...)` to receive live order updates without polling.

### Lovable Integration
This project is connected to [Lovable](https://lovable.dev/projects/1922eec0-a903-4396-bae6-888408f5ec7a). Lovable auto-deploys on push to `main` and may push commits directly. Always pull before working to avoid merge conflicts. The `lovable-tagger` dev dependency tags components for the Lovable visual editor.

### iOS PWA Notes
- `ntfys://` deep link scheme = ntfy over HTTPS (use `ntfys://`, NOT `ntfy://`)
- `navigator.standalone === true` detects iOS standalone mode
- `apple-touch-icon.png` is used as the home screen icon (Carpe Diem Motel branding, 180x180)
- Web Push does not work in iOS Safari — ntfy is the only reliable notification channel for iOS

## GitHub Actions

### Workflows
- `deploy.yml` — Deploys Edge Functions via `supabase functions deploy` on push to `supabase/functions/**`
- `apply-migration.yml` — Aplica migracoes SQL via `supabase db query` on push to `supabase/migrations/**` ou manual dispatch

### Required GitHub Secrets
- `SUPABASE_PROJECT_REF` — Project ID (`xakercaneezgyqdekmvj`)
- `SUPABASE_ACCESS_TOKEN` — Token pessoal do Supabase (gerar em https://supabase.com/dashboard/account/tokens)

**STATUS**: Estes secrets precisam ser configurados para os workflows funcionarem. Sem eles, tanto o deploy de Edge Functions quanto a aplicacao de migracoes falham.

## Supabase Connection Info (via Lovable Cloud)
- **Project ID**: `xakercaneezgyqdekmvj`
- **URL**: `https://xakercaneezgyqdekmvj.supabase.co`
- **Anon Key**: disponivel em `.env` (`VITE_SUPABASE_PUBLISHABLE_KEY`)
- **Lovable Project**: https://lovable.dev/projects/1922eec0-a903-4396-bae6-888408f5ec7a
- **NUNCA** direcionar o usuario ao Supabase Dashboard — ele usa **somente o Lovable Cloud**

## Problemas Conhecidos e Licoes Aprendidas

1. **Trigger sem Authorization header** — O gateway do Supabase (Kong) exige JWT no header Authorization para chamar Edge Functions. Triggers que usam `net.http_post()` DEVEM incluir `Authorization: Bearer <anon_key>`. Sem isso, retorna 401 silencioso e o `EXCEPTION WHEN OTHERS` engole o erro.

2. **GitHub push 403** — O Claude Code web/desktop precisa do GitHub App "Claude" instalado com permissao de escrita. Instalar em https://github.com/apps/claude.

3. **DNS bloqueado para psql** — O servidor do Claude Code nao resolve `db.*.supabase.co` (porta 5432). Conexoes diretas PostgreSQL nao funcionam. Usar a REST API ou o CLI via GitHub Actions.

4. **Chaves VAPID** — NUNCA hardcodar fallbacks. Devem vir exclusivamente de Supabase Secrets.

## Comunicacao

- Falar em **portugues** com o usuario
- Ser **direto e autonomo** — fazer, nao perguntar
- Quando precisar do usuario, dar instrucoes **visuais e simples** (link + "clica aqui" + "cola isso")
- Usar agentes especializados para tarefas paralelas
- Seguir o modo hibrido de modelos (Opus/Sonnet/Haiku) para economia de tokens
