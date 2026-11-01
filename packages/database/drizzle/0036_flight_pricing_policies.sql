-- Versioned server-owned pricing. No customer, booking or payment rows are changed.
CREATE TABLE flight_pricing_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision integer NOT NULL UNIQUE CHECK (revision > 0),
 rules jsonb NOT NULL CHECK (jsonb_typeof(rules)='array' AND jsonb_array_length(rules)<=200),
 created_by_staff_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE flight_pricing_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON flight_pricing_policies FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON flight_pricing_policies TO flyseri_api;
CREATE POLICY flight_pricing_policies_server ON flight_pricing_policies FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
