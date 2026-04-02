-- ================================================================
-- MIGRATION DEFINITIVA: Fix Push Notifications Trigger
-- Elimina conflitos de migrations anteriores (4 versões conflitantes).
-- Usa net.http_post() — schema correto do pg_net no Supabase.
-- body enviado como text (cast ::text necessário para a função).
-- EXCEPTION handler garante que falha no push não bloqueia INSERT/UPDATE.
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

-- Cria trigger limpo e funcional
CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_order();

-- Confirmação
DO $$
BEGIN
  RAISE NOTICE 'Trigger orders_push_notify criado com sucesso usando net.http_post()';
END;
$$;
