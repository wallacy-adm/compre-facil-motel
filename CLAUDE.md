# CLAUDE.md — CompraFácil Motel

> Guidance file for any AI assistant working in this repository.

---

## 🚨 REGRA #1 — ABSOLUTA, SEM EXCEÇÃO

> **JAMAIS usar `supabase.com` ou qualquer ferramenta do Supabase diretamente.**
>
> O banco de dados, Edge Functions e deploy deste projeto são gerenciados **exclusivamente pelo Lovable Cloud**.
> O usuário **NÃO tem conta Supabase separada** e **NUNCA deve ser direcionado para `supabase.com`**.

### ❌ PROIBIDO — nunca fazer:
- Acessar `supabase.com/dashboard` ou `api.supabase.com`
- Usar Supabase CLI: `supabase functions deploy`, `supabase db push`, `supabase db query`, etc.
- Configurar `SUPABASE_ACCESS_TOKEN` em GitHub Secrets para CLI
- Tentar fazer deploy de Edge Functions por qualquer meio que não seja o Lovable
- Pedir ao usuário para acessar o painel do Supabase

### ✅ OBRIGATÓRIO — sempre fazer:
| Tarefa | Como fazer |
|--------|-----------|
| Deploy de Edge Functions | Chat do Lovable → https://lovable.dev/projects/1922eec0-a903-4396-bae6-888408f5ec7a |
| Alterações de schema/SQL | Lovable Cloud SQL Editor (aba Supabase > SQL Editor no link acima) |
| Alterações de código | Commit no git local + push para GitHub → Lovable auto-deploya |
| Sem acesso ao terminal para push | GitHub web editor (já autenticado no browser) |

> **Por quê?** Lovable Cloud é um wrapper gerenciado do Supabase. Toda a infraestrutura (banco, Edge Functions, secrets, deploy) é controlada pelo Lovable. O usuário opera SOMENTE pelo Lovable — nunca diretamente pelo Supabase.

### ⚠️ Lovable Chat — uso com cautela

O chat do Lovable tem **limite diário de créditos**. Regras de uso:
- Usar o chat do Lovable **apenas quando não houver alternativa** (ex: deploy de Edge Functions, mudanças de schema SQL)
- **NUNCA** usar o chat do Lovable para alterações de código frontend — para isso usar GitHub diretamente
- Monitorar uso de créditos para não estourar o limite diário
- Commits de código vão direto para o GitHub via editor web ou terminal — o Lovable auto-deploya sem precisar do chat

---

## 👤 Perfil do Usuário

O dono deste projeto **NÃO tem conhecimento técnico** em programação. Isso significa:

- **NUNCA** pedir para o usuário rodar comandos no terminal
- **NUNCA** pedir tokens, PATs, chaves SSH, credenciais ou qualquer coisa técnica
- **NUNCA** pedir para acessar painéis, dashboards ou configurações de desenvolvedor
- **NUNCA** usar linguagem técnica sem necessidade
- **NUNCA** pedir para o usuário "abrir o arquivo X e editar a linha Y"
- Executar tarefas de forma **100% autônoma** — resolver os problemas sem transferir o trabalho para o usuário
- Falar sempre em **português**

---

## 🤖 Como o Assistente Deve Trabalhar — Regras de Abordagem

### 1. Hierarquia de ferramentas (do mais eficiente ao menos eficiente)

Sempre tentar nesta ordem — nunca pular para o browser sem tentar as opções mais simples antes:

| Prioridade | Ferramenta | Quando usar |
|-----------|-----------|------------|
| 1️⃣ | **Terminal / Bash** | Git, arquivos, scripts, qualquer operação local |
| 2️⃣ | **Git CLI** | Push, commit, diff, clone |
| 3️⃣ | **GitHub API (curl)** | Quando git push precisa de auth e há token disponível |
| 4️⃣ | **Agents (subagentes)** | Tarefas paralelas ou independentes — rodar em paralelo |
| 5️⃣ | **Skills** | Quando há uma skill específica para o problema |
| 6️⃣ | **Browser (Claude in Chrome)** | Último recurso — só quando não há NENHUMA outra forma |

> ⚠️ O browser é lento, consome muitos tokens e pode congelar. Usar APENAS quando for a única opção possível.

### 2. Modelo híbrido — uso eficiente de tokens

Usar o modelo certo para cada tipo de tarefa:

| Modelo | Quando usar |
|--------|------------|
| **Haiku** | Tarefas simples: ler arquivo, checar status, bash básico, buscas |
| **Sonnet** | Tarefas normais: editar código, análise, commits, debugging padrão |
| **Opus** | Problemas complexos: arquitetura, bugs difíceis, decisões críticas |

### 3. Nunca pedir ao usuário o que pode ser resolvido autonomamente

Exemplos de situações e como resolver SEM pedir ao usuário:

- **Precisa de token GitHub**: Tentar extrair da sessão do browser via JavaScript, ou usar Lovable chat, ou commitar pelo editor web do GitHub (que já está autenticado)
- **Git bloqueado por index.lock**: Clonar fresh copy fora do diretório problemático
- **Arquivo não pode ser editado**: Criar em diretório temporário e copiar
- **Sem credenciais**: Usar a sessão do browser que já está logada

### 4. Usar agentes e skills

- Para tarefas independentes: dispatchar múltiplos subagentes em paralelo
- Verificar skills disponíveis antes de implementar do zero
- Não reinventar a roda

---

## 🗣️ Comunicação

- Falar em **português** com o usuário
- Ser **direto e autônomo** — fazer, não perguntar
- Reportar progresso em frases curtas, não em listas técnicas longas
- Quando for absolutamente inevitável pedir algo ao usuário: dar instruções **visuais, simples, com link direto e print mental** ("Clica aqui → aparece X → clica no botão verde")

---

## 🏗️ Arquitetura

### Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Supabase PostgreSQL + Edge Functions + Realtime (gerenciado via **Lovable Cloud**)
- **Hosting/Deploy**: Lovable (auto-deploya no push para `main` no GitHub)

### Autenticação
Auth customizada — NÃO usa Supabase Auth. Usuários ficam na tabela `public.users` com username/senha em texto plano. Sessão persistida em `localStorage` via o objeto `LS` no `App.tsx`. `supabase.auth.getSession()` sempre retorna null — nunca usar.

O cliente Supabase usa a anon key (`VITE_SUPABASE_PUBLISHABLE_KEY`).

### App.tsx — arquivo único (~2120 linhas)
Toda a lógica vive em `src/App.tsx` (`// @ts-nocheck`). Contém:
- `ErrorBoundary` — crash handler global
- `LS` — wrapper seguro de `localStorage`
- `CarpeDiemLogo` — SVG inline (fonte Cinzel via Google Fonts)
- `isRunningStandalone()` — detecta modo PWA standalone (push no iOS)
- `playAlertSound()` — alerta sonoro via Web Audio API
- Toda lógica de negócio: login, pedidos, setores, roles, realtime

`src/pages/Index.tsx` só re-exporta do `App.tsx`.

### Database (via Lovable Cloud)

> **NUNCA** acessar o Supabase Dashboard — usar o **Lovable Cloud SQL Editor**

Tabelas principais:
- `users` — auth customizada, roles (JSONB), `ntfy_topic` (TEXT), `ntfy_token` (TEXT)
- `orders` — status: `pendente → aprovado → concluido`; destino: `chefia | comprador`
- `push_subscriptions` — subscriptions WebPush por usuário

**Schema das colunas de `orders`:** camelCase no banco real — `userId`, `userName`, `sectorLabel`, `userRole`, `createdAt`, `createdDate` (confirmado em `src/integrations/supabase/types.ts`). O arquivo de migração inicial usa snake_case mas é apenas documentação — o banco real usa camelCase.

Alterações de schema → **Lovable Cloud SQL Editor**. O diretório `supabase/migrations/` serve como **documentação de referência**, não para execução direta.

### Push Notifications (dual-channel)

1. **Web Push (VAPID)** — `supabase/functions/send-push/index.ts`, envia via `web-push`. Funciona no Android Chrome. **NÃO** funciona no iOS Safari PWA.
2. **ntfy.sh** — `src/components/NtfySetupCard.tsx`, canal iOS. Gera topic local (`cf-{userId8}-{random5}`), salva em `users.ntfy_topic`, abre deep link `ntfys://ntfy.sh/{topic}`.

**Regra crítica:** URL do ntfy SEMPRE com `/` no final — sem isso, Deno retorna redirect 308 e não segue o redirect em POST com body.

### Edge Functions

Ficam em `supabase/functions/`. Deploy **exclusivamente via Lovable chat**.
- `send-push` (v3.8) — recebe webhook do trigger DB, envia WebPush + ntfy
- `generate-ntfy-token` — legado, não ativo

**Secrets necessários** (configurados no Lovable, não no Supabase Dashboard):
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`, `NTFY_BASE_URL` (com `/`), `NTFY_PUBLISHER_TOKEN` (opcional), `APP_BASE_URL`

### Trigger do banco

```sql
-- Arquivo: supabase/migrations/20260406000000_fix_trigger_auth_header.sql
-- Dispara em INSERT OR UPDATE na tabela orders
-- OBRIGATÓRIO: header Authorization: Bearer <anon_key>
-- Sem ele, Kong retorna 401 silencioso e EXCEPTION WHEN OTHERS engole o erro
```

Fix aplicado em 20260413: body como JSONB (sem `::text` cast) — também já aplicado ao banco.

### Realtime

A publicação `supabase_realtime` inclui a tabela `orders`. O frontend assina via `supabase.channel(...)` para receber updates ao vivo sem polling.

### iOS PWA
- Deep link ntfy: `ntfys://` (HTTPS), não `ntfy://`
- `navigator.standalone === true` detecta modo standalone no iOS
- Web Push não funciona no iOS Safari — ntfy é o único canal confiável

---

## 🔌 Informações de Conexão

| Item | Valor |
|------|-------|
| Lovable Project | https://lovable.dev/projects/1922eec0-a903-4396-bae6-888408f5ec7a |
| GitHub Repo | `wallacy-adm/compre-facil-motel` (branch `main`) |
| Supabase Project ID | `xakercaneezgyqdekmvj` |
| Supabase URL | `https://xakercaneezgyqdekmvj.supabase.co` (interno — não acessar pelo painel) |
| Anon Key | disponível em `.env` (`VITE_SUPABASE_PUBLISHABLE_KEY`) |

---

## ⚠️ Lições Aprendidas

1. **Trigger sem Authorization header** — O gateway Kong exige JWT no header `Authorization`. Triggers com `net.http_post()` DEVEM incluir `Authorization: Bearer <anon_key>`. Sem isso: 401 silencioso.

2. **body jsonb sem `::text`** — A versão atual do `pg_net` exige `body` como JSONB. O cast `::text` causa exceção de tipo capturada silenciosamente pelo `EXCEPTION WHEN OTHERS` → notificações nunca chegam.

3. **ntfy URL sem `/`** — Deno fetch não segue redirect 308 em POST com body. SEMPRE garantir `/` no final de `NTFY_BASE_URL`.

4. **Chaves VAPID** — NUNCA hardcodar fallbacks. Devem vir exclusivamente dos Supabase Secrets (gerenciados pelo Lovable).

5. **GitHub Actions de deploy** — Os workflows `deploy.yml` e `apply-migration.yml` foram substituídos por validação apenas. O Lovable é o único mecanismo de deploy. Não tentar ressuscitar esses workflows.

6. **`supabase.auth`** — Sempre retorna null. Auth é customizada via tabela `public.users`.

---

## 🛠️ Comandos (desenvolvimento local)

```bash
npm run dev        # servidor local (Vite, porta 5173)
npm run build      # build de produção
npm run lint       # ESLint
npm run test       # Vitest (uma vez)
npm run test:watch # Vitest (watch)
```
