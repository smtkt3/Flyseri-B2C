-- Apply only to the trusted Flyseri API server role after migration 0011.
-- This role is never used in the browser. It receives no DELETE privilege.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON public.orders TO flyseri_api;
GRANT SELECT, INSERT ON public.order_items TO flyseri_api;
GRANT SELECT, INSERT, UPDATE ON public.payments TO flyseri_api;
GRANT SELECT, INSERT, UPDATE ON public.payment_attempts TO flyseri_api;
GRANT SELECT, INSERT ON public.payment_events TO flyseri_api;
GRANT SELECT, INSERT ON public.commerce_audit_events TO flyseri_api;
GRANT SELECT, INSERT, UPDATE ON public.commerce_outbox TO flyseri_api;

CREATE POLICY flyseri_api_server_access ON public.orders FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.order_items FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.payments FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.payment_attempts FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.payment_events FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.commerce_audit_events FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.commerce_outbox FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
COMMIT;
