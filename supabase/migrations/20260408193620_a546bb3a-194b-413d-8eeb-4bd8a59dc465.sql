CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DROP TRIGGER IF EXISTS orders_push_notify ON public.orders;

DROP FUNCTION IF EXISTS public.notify_push_on_order() CASCADE;

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
      'Authorization',    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhha2VyY2FuZWV6Z3lxZGVrbXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjEyNTgsImV4cCI6MjA5MDM5NzI1OH0.2Gq12ZWzNt-p-3mOVG92UGe1B6UqyNWJtTgE6aeDZfk',
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
  RAISE WARNING '[notify_push_on_order] Erro ao chamar send-push: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_order();