-- Separate immutable additional-collection orders from the original ticket order.
ALTER TABLE orders ADD COLUMN flight_servicing_case_id uuid REFERENCES flight_servicing_cases(id);
CREATE UNIQUE INDEX orders_flight_servicing_case_unique ON orders(flight_servicing_case_id);
ALTER TABLE orders DROP CONSTRAINT orders_source_valid;
ALTER TABLE orders ADD CONSTRAINT orders_source_valid CHECK
  (num_nonnulls(booking_intent_id,visa_application_id,flight_servicing_case_id) <= 1);
