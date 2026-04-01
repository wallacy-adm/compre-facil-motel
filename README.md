# CompraFácil — Sistema de Compras Carpe Diem Motel

Sistema interno de gestão de pedidos de compras do **Carpe Diem Motel**, desenvolvido como Progressive Web App (PWA) com notificações push em tempo real para iOS, Android e desktop.

---

## Visão Geral

O CompraFácil permite que setores do motel registrem pedidos de compra, que são roteados para aprovação ou diretamente para o comprador. Notificações push são disparadas automaticamente quando pedidos são criados ou aprovados.

### Papéis de usuário

| Papel | Descrição |
|-------|-----------|
| `admin` | Acesso total — aprova pedidos, visualiza todos os setores |
| `chefia` | Aprovação de pedidos do seu setor |
| `comprador` | Recebe pedidos aprovados para efetuar a compra |

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS + Radix UI |
| Backend | Supabase (PostgreSQL + Edge Functions + Realtime) |
| Notificações | Web Push API + VAPID + Service Worker |
| PWA | manifest.json + sw.js (standalone mode) |
| Deploy | Lovable Cloud |

---

## Arquitetura de Notificações Push

```
Usuário cria/atualiza pedido
        ↓
 Tabela orders (Supabase)
        ↓
  Trigger PostgreSQL
  orders_push_notify
        ↓
  net.http_post() via pg_net
        ↓
  Edge Function: send-push
        ↓
  Busca assinantes na tabela
  push_subscriptions por role
        ↓
  web-push → FCM / APNs
        ↓
  Notificação no dispositivo
```

### Banco de dados

| Tabela | Descrição |
|--------|-----------|
| `orders` | Pedidos de compra com status, setor e destino |
| `push_subscriptions` | Assinaturas Web Push por usuário e dispositivo |
| `users` | Usuários com campo `roles[]` (admin, chefia, comprador) |

### Trigger SQL

```sql
-- Dispara em INSERT e UPDATE na tabela orders
-- Usa pg_net (net.http_post) para chamar a Edge Function
CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_order();
```

### Edge Function `send-push`

Lógica de roteamento de notificações:

| Evento | Destino | Notificação |
|--------|---------|-------------|
| `INSERT` + `status=pendente` + `destino=comprador` | comprador | "🛒 Pedido para Compra" |
| `INSERT` + `status=pendente` | admin + chefia | "📋 Novo Pedido" |
| `UPDATE` + `status=aprovado` + `destino=comprador` | comprador | "✅ Pedido Aprovado" |
| `UPDATE` + `status=aprovado` + `destino=chefia` | chefia | "✅ Pedido para Chefia" |

---

## Instalação e Desenvolvimento

### Pré-requisitos

- Node.js 18+ ou Bun
- Conta no [Supabase](https://supabase.com) (ou usar o projeto conectado)

### Setup local

```bash
# Clonar o repositório
git clone https://github.com/wallacy-adm/compre-facil-motel.git
cd compre-facil-motel

# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm run dev
```

A aplicação abre em `http://localhost:5173`.

### Variáveis de ambiente

Crie um arquivo `.env` na raiz (ou use o já existente conectado ao Supabase):

```env
VITE_SUPABASE_URL=https://xakercaneezgyqdekmvj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua_anon_key_aqui
VITE_SUPABASE_PROJECT_ID=xakercaneezgyqdekmvj
```

---

## Push Notifications — Guia de Configuração

### Como funciona por plataforma

| Plataforma | Suporte | Requisito |
|------------|---------|-----------|
| **iOS Safari** | ✅ iOS 16.4+ | App instalado na Tela Inicial (modo standalone) |
| **Android Chrome** | ✅ | Pode funcionar no browser ou instalado |
| **Desktop Chrome/Edge** | ✅ | Funciona direto no browser |
| **iOS Safari (browser)** | ❌ | Push não funciona fora do modo standalone no iOS |

### Instalando no iPhone (obrigatório para receber push)

1. Abra o app no **Safari** (não Chrome/Firefox)
2. Toque no botão **Compartilhar** (ícone de seta para cima)
3. Role e toque em **"Adicionar à Tela Início"**
4. Confirme com **"Adicionar"**
5. Abra o app pelo ícone na tela inicial
6. O banner **"Ativar notificações"** aparecerá — toque em **Permitir**

### Chaves VAPID

As chaves VAPID estão configuradas na Edge Function `send-push`. Para substituí-las por secrets seguros:

```bash
# Gerar novas chaves VAPID
npx web-push generate-vapid-keys
```

Adicione no painel Lovable → Cloud → Secrets:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL` (ex: `mailto:admin@carpediemmotel.com`)

---

## Correções Aplicadas (v2 — Abril 2026)

Quatro bugs críticos que impediam notificações push no iOS foram corrigidos no commit [`b0178e2`](https://github.com/wallacy-adm/compre-facil-motel/commit/b0178e2):

### 1. Trigger SQL — schema errado no `pg_net`

**Problema:** Migrações anteriores conflitantes usavam `extensions.http_post()` em vez de `net.http_post()`, causando erro silencioso ao tentar chamar a Edge Function.

**Correção (`supabase/migrations/20260401...sql`):**
```sql
-- Recriou a função com search_path correto
CREATE OR REPLACE FUNCTION public.notify_push_on_order()
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(...);  -- net. não extensions.
  ...
END;
$$;
```

### 2. Service Worker — opções incompatíveis com iOS WebKit

**Problema:** O iOS WebKit cancela silenciosamente `showNotification()` quando as opções `requireInteraction` ou `vibrate` estão presentes.

**Correção (`public/sw.js`):**
```diff
- requireInteraction: true,
- vibrate: [300, 100, 300, 100, 300],
```

### 3. App.tsx — banner aparecia fora do modo standalone

**Problema:** O banner "Ativar notificações" era exibido no Safari normal, onde o push não funciona no iOS. O usuário ativava, mas as notificações nunca chegavam.

**Correção (`src/App.tsx`):**
```typescript
function isRunningStandalone(): boolean {
  if ((navigator as any).standalone === true) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

// Banner só aparece se for PWA instalada
const showNotifBanner = notifStatus === 'default'
  && 'PushManager' in window
  && isRunningStandalone();
```

### 4. Edge Function — validação de variáveis na inicialização

**Problema:** A função `send-push` não detectava configuração ausente e falhava silenciosamente.

**Correção (`supabase/functions/send-push/index.ts`):**
```typescript
const startupErrors: string[] = [];
if (!SUPABASE_URL) startupErrors.push("SUPABASE_URL não configurada");
if (!SERVICE_KEY)  startupErrors.push("SUPABASE_SERVICE_ROLE_KEY não configurada");

if (startupErrors.length > 0) {
  console.error("[send-push] ⚠️ CONFIGURAÇÃO INVÁLIDA:", startupErrors.join(" | "));
}
```

---

## Scripts

```bash
npm run dev        # Servidor de desenvolvimento
npm run build      # Build de produção
npm run preview    # Preview do build
npm run lint       # Lint com ESLint
npm run test       # Testes com Vitest
```

---

## Estrutura do Projeto

```
compre-facil-motel/
├── public/
│   ├── sw.js              # Service Worker (PWA + push notifications)
│   ├── manifest.json      # Configuração PWA
│   └── icon-*.png         # Ícones do app
├── src/
│   ├── App.tsx            # Componente raiz + detecção standalone
│   ├── pages/
│   │   └── Index.tsx      # Página principal
│   ├── components/        # Componentes UI (shadcn/ui)
│   ├── hooks/             # Custom hooks React
│   └── integrations/
│       └── supabase/      # Cliente Supabase gerado
├── supabase/
│   ├── functions/
│   │   └── send-push/
│   │       └── index.ts   # Edge Function de notificações
│   └── migrations/        # Histórico de migrações SQL
└── package.json
```

---

## Segurança

- RLS (Row Level Security) habilitado nas tabelas do Supabase
- Webhook protegido por `x-webhook-secret` entre trigger e Edge Function
- Subscriptions push associadas a `user_id` autenticado
- Subscriptions inválidas (404/410) são removidas automaticamente

---

## Desenvolvido com

- [Lovable](https://lovable.dev) — plataforma de desenvolvimento com IA
- [Supabase](https://supabase.com) — backend as a service
- [shadcn/ui](https://ui.shadcn.com) — componentes UI
- [web-push](https://github.com/web-push-libs/web-push) — biblioteca VAPID/WebPush
