# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Database (Supabase PostgreSQL)
Tables managed via `supabase/migrations/`:
- `users` — custom auth, roles (JSONB), ntfy_topic (TEXT), ntfy_token (TEXT)
- `orders` — all fields TEXT/JSONB; `status`: `pendente → aprovado → concluido`; `destino`: `chefia | comprador`
- `push_subscriptions` — Web Push VAPID subscriptions per user

**Schema changes must be applied via Lovable ☁️ Cloud SQL Editor** (not `supabase db push`), since the Supabase project is managed by Lovable. The local migrations folder is documentation only — it does NOT auto-apply.

### Push Notifications (dual-channel)
1. **Web Push (VAPID)** — `supabase/functions/send-push/index.ts` sends via `web-push` npm package. Subscriptions stored in `push_subscriptions`. Works on Android Chrome. Does NOT work on iOS Safari PWA.
2. **ntfy.sh** — `src/components/NtfySetupCard.tsx` configures the iOS channel. Generates a topic locally (`cf-{userId8}-{random5}`), saves to `users.ntfy_topic`, then opens deep link `ntfys://ntfy.sh/{topic}` so the user subscribes in the ntfy iOS app. `send-push` publishes to `https://ntfy.sh/{topic}` (public server, no auth needed).

The database trigger `orders_push_notify` (in `20260401000000_fix_push_trigger_final.sql`) fires on INSERT/UPDATE of `orders` and calls `send-push` via `net.http_post()` (pg_net extension).

**NtfySetupCard visibility**: shown only when `session && (isRunningStandalone() || isIOS)` — not shown on desktop or browser (non-standalone) to avoid confusion.

### Edge Functions
Located in `supabase/functions/`. Deployed via Supabase dashboard.
- `send-push` — receives webhook from DB trigger, sends Web Push + ntfy notifications
- `generate-ntfy-token` — legacy; generates ntfy token via admin API (not actively used; frontend now generates topics directly)

Env vars needed in Supabase secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`. `NTFY_BASE_URL` defaults to `https://ntfy.sh`, `NTFY_PUBLISHER_TOKEN` is optional.

### Realtime
`supabase_realtime` publication includes `orders` table. The frontend subscribes via `supabase.channel(...)` to receive live order updates without polling.

### Lovable Integration
This project is connected to [Lovable](https://lovable.dev/projects/1922eec0-a903-4396-bae6-888408f5ec7a). Lovable auto-deploys on push to `main` and may push commits directly. Always pull before working to avoid merge conflicts. The `lovable-tagger` dev dependency tags components for the Lovable visual editor.

### iOS PWA Notes
- `ntfys://` deep link scheme = ntfy over HTTPS (use `ntfys://`, NOT `ntfy://`)
- `navigator.standalone === true` detects iOS standalone mode
- `apple-touch-icon.png` is used as the home screen icon (must be a real PNG, not a placeholder)
- Web Push does not work in iOS Safari — ntfy is the only reliable notification channel for iOS
