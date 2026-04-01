CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DROP TRIGGER IF EXISTS orders_push_notify ON public.orders;

DROP FUNCTION IF EXISTS public.notify_push_on_order() CASCADE;

CREATE OR REPLACE FUNCTION public.notify_push_on_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://xakercaneezgyqdekmvj.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret','comprafacil-push-2025'),
    body    := jsonb_build_object('type',TG_OP,'table',TG_TABLE_NAME,'schema',TG_TABLE_SCHEMA,'record',row_to_json(NEW)::jsonb,'old_record',CASE WHEN TG_OP='UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END)::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_push_on_order] Erro: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_order();