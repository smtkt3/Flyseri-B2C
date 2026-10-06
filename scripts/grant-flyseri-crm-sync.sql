-- Run as database owner after 0012. Flyseri's server-only role receives no DELETE or DDL rights.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON public.crm_customer_links TO flyseri_api;
GRANT SELECT, UPDATE ON public.crm_sync_events TO flyseri_api;
CREATE POLICY flyseri_api_server_access ON public.crm_customer_links FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.crm_sync_events FOR SELECT TO flyseri_api USING (true);
CREATE POLICY flyseri_api_server_update ON public.crm_sync_events FOR UPDATE TO flyseri_api USING (true) WITH CHECK (true);
COMMIT;
