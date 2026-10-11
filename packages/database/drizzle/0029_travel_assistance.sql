CREATE TABLE fare_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  search jsonb NOT NULL,
  target_amount numeric(14,2) NOT NULL CHECK (target_amount > 0),
  currency varchar(3) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_amount numeric(14,2),
  checked_at timestamptz,
  matched_at timestamptz,
  check_error boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fare_watches_customer_idx ON fare_watches(customer_id, created_at);
CREATE INDEX fare_watches_due_idx ON fare_watches(active, checked_at);
ALTER TABLE fare_watches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE travel_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id),
  action_id uuid NOT NULL UNIQUE REFERENCES ai_pending_actions(id),
  reason text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  stage varchar(24) NOT NULL DEFAULT 'QUEUED' CHECK (stage IN ('QUEUED','REVIEWING','QUOTE_READY','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED')),
  quote jsonb,
  updates jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX travel_support_customer_idx ON travel_support_requests(customer_id, created_at);
ALTER TABLE travel_support_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='flyseri_api') THEN
    CREATE POLICY flyseri_api_server_access ON fare_watches FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    CREATE POLICY flyseri_api_server_access ON travel_support_requests FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON fare_watches TO flyseri_api;
    GRANT SELECT, INSERT, UPDATE ON travel_support_requests TO flyseri_api;
  END IF;
END $$;
