BEGIN;
ALTER TABLE public.flight_booking_intents
  ADD COLUMN IF NOT EXISTS service_requests jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.flight_booking_intents
SET service_requests = search_request_snapshot -> 'checkoutServiceRequests'
WHERE service_requests = '[]'::jsonb
  AND jsonb_typeof(search_request_snapshot -> 'checkoutServiceRequests') = 'array';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.flight_booking_intents'::regclass
      AND conname = 'flight_booking_intents_service_requests_valid'
  ) THEN
    ALTER TABLE public.flight_booking_intents
      ADD CONSTRAINT flight_booking_intents_service_requests_valid
      CHECK (CASE WHEN jsonb_typeof(service_requests) = 'array'
        THEN jsonb_array_length(service_requests) <= 9 ELSE false END);
  END IF;
END $$;

INSERT INTO drizzle.__drizzle_migrations (hash,created_at) SELECT '07f6048fa274036c687028d54292de652a9133469905c627980ac67a7d3f4226',1791082000000 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash='07f6048fa274036c687028d54292de652a9133469905c627980ac67a7d3f4226');
COMMIT;
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='flight_booking_intents' AND column_name='service_requests';
