-- Migration: Adiciona suporte a ntfy.sh para notificações iOS confiáveis
-- Escrita via Edge Function generate-ntfy-token (service role only)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ntfy_token TEXT,
  ADD COLUMN IF NOT EXISTS ntfy_topic TEXT;

COMMENT ON COLUMN public.users.ntfy_token IS
  'Token de acesso pessoal ntfy.sh. Gerado pela Edge Function generate-ntfy-token. Somente leitura para o usuário via SELECT policy existente.';

COMMENT ON COLUMN public.users.ntfy_topic IS
  'Tópico ntfy.sh do usuário (ex: pedidos-abc12345). Gerado automaticamente com base no user_id.';
