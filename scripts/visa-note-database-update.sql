BEGIN;
GRANT UPDATE (customer_message) ON public.visa_assistance_requests TO flyseri_api;
INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ('e09d7faa7a4adb479805ae3e1cc5cce1552fc8e5ef2bd59cabae1a1ce525a62f',1790839794328);
COMMIT;
