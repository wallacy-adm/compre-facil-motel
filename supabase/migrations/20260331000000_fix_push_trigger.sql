-- ============================================================
-- FIX: Recria o trigger de push notifications corretamente
-- O trigger anterior enviava body '{}' vazio para a edge function
-- causando skip em 100% dos pedidos. Esta migration corrige isso.
-- ============================================================

-- Remove trigger e função antigos (de qualquer versão anterior)
DROP TRIGGER IF EXISTS orders_push_notify ON public.orders;
DROP FUNCTION IF EXISTS public.notify_push_on_order() CASCADE;

-- Garante que pg_net está instalado
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Função usando net.http_post com corpo JSON correto
CREATE OR REPLACE FUNCTION public.notify_push_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://xakercaneezgyqdekmvj.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-webhook-secret','comprafacil-push-2025'
    ),
    body    := jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     row_to_json(NEW),
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE NULL END
    )
  );
  RETURN NEW;
END;
$$;

-- Trigger limpo e funcional
CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_order();
