ALTER TABLE public.flight_booking_intents
  ADD COLUMN IF NOT EXISTS service_requests jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE public.flight_booking_intents
SET service_requests = search_request_snapshot -> 'checkoutServiceRequests'
WHERE service_requests = '[]'::jsonb
  AND jsonb_typeof(search_request_snapshot -> 'checkoutServiceRequests') = 'array';
--> statement-breakpoint
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
