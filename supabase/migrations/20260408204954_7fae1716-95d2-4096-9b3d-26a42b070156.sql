DROP TRIGGER IF EXISTS orders_push_notify ON public.orders;

CREATE TRIGGER orders_push_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_order();