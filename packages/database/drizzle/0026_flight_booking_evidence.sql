ALTER TABLE flight_bookings ADD COLUMN IF NOT EXISTS booked_passenger_names jsonb;
ALTER TABLE flight_bookings ADD COLUMN IF NOT EXISTS provider_view_snapshot jsonb;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_fulfillment_valid;
ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_valid CHECK (fulfillment_status IN ('NOT_STARTED', 'REVALIDATION_REQUIRED', 'COMPLETED'));
