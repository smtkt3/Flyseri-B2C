CREATE TABLE IF NOT EXISTS flight_servicing_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES flight_bookings(id),
  kind varchar(16) NOT NULL CHECK (kind IN ('ISSUE','CANCEL','VOID','REFUND','EXCHANGE')),
  status varchar(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','QUOTED','APPROVED','EXECUTING','COMPLETED','FAILED','OUTCOME_UNKNOWN','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), reason text NOT NULL,
  quote jsonb, approval jsonb, result jsonb, created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flight_servicing_booking_idx ON flight_servicing_cases(booking_id,created_at);
CREATE INDEX IF NOT EXISTS flight_servicing_queue_idx ON flight_servicing_cases(status,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS flight_servicing_active_kind_unique ON flight_servicing_cases(booking_id,kind) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE TABLE IF NOT EXISTS flight_servicing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES flight_servicing_cases(id),
  staff_user_id uuid NOT NULL, event varchar(40) NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flight_servicing_events_case_idx ON flight_servicing_events(case_id,created_at);
ALTER TABLE flight_servicing_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_servicing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON flight_servicing_cases,flight_servicing_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON flight_servicing_cases TO flyseri_api;
GRANT SELECT,INSERT ON flight_servicing_events TO flyseri_api;
CREATE POLICY flight_servicing_cases_server ON flight_servicing_cases FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flight_servicing_events_server ON flight_servicing_events FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
