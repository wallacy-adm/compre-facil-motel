-- Tabela para armazenar subscriptions de push de cada dispositivo
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  subscription jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_push_subscriptions"
  ON public.push_subscriptions FOR ALL
  USING (true) WITH CHECK (true);

-- Trigger que chama a Edge Function quando um pedido é criado ou atualizado
CREATE OR REPLACE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
    'https://xakercaneezgyqdekmvj.supabase.co/functions/v1/send-push',
    'POST',
    '{"Content-Type":"application/json","x-webhook-secret":"comprafacil-push-2025"}',
    '{}',
    '5000'
  );
