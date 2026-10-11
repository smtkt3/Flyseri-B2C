-- Run in the Supabase SQL Editor as the project administrator after creating
-- a login role named flyseri_api. The Flyseri API authenticates customers via
-- Supabase Auth and enforces customer ownership before querying these tables.
-- This role receives no access to auth, storage, or unrelated public tables.
-- Re-run after adding a new Flyseri table to the application schema.

DO $$
DECLARE
  app_table text;
  app_tables text[] := ARRAY[
    'customers', 'travellers', 'customer_travellers', 'trips',
    'trip_destinations', 'trip_travellers', 'documents', 'document_versions',
    'visa_types', 'visa_requirements', 'visa_applications',
    'visa_application_travellers', 'visa_application_requirements',
    'visa_requirement_documents', 'visa_status_history', 'visa_service_versions',
    'visa_review_requests', 'visa_application_notes', 'audit_events',
    'admin_audit_events', 'flight_booking_intents', 'flight_bookings',
    'guest_flight_checkout_attempts',
    'flight_booking_intent_travellers', 'orders', 'order_items',
    'payments', 'payment_attempts', 'payment_events', 'refunds',
    'commerce_outbox', 'commerce_audit_events', 'crm_customer_links',
    'crm_sync_events', 'ai_conversations', 'ai_messages',
    'ai_tool_calls', 'ai_pending_actions', 'ai_usage_events', 'holiday_packages', 'holiday_bookings',
    'fare_watches', 'travel_support_requests'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'flyseri_api'
      AND rolcanlogin
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolbypassrls
      AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'Expected a non-admin flyseri_api login role';
  END IF;

  GRANT USAGE ON SCHEMA public TO flyseri_api;

  FOREACH app_table IN ARRAY app_tables LOOP
    IF to_regclass(format('public.%I', app_table)) IS NULL THEN
      RAISE EXCEPTION 'Flyseri table public.% is missing', app_table;
    END IF;

    IF app_table = 'travel_support_requests' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO flyseri_api', app_table);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO flyseri_api', app_table);
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = app_table AND c.relrowsecurity
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = app_table
        AND policyname = 'flyseri_api_server_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY flyseri_api_server_access ON public.%I FOR ALL TO flyseri_api USING (true) WITH CHECK (true)',
        app_table
      );
    END IF;
  END LOOP;
END;
$$;
