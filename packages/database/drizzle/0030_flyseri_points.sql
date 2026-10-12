CREATE TABLE points_accounts (
  customer_id uuid PRIMARY KEY REFERENCES customers(id),
  adjustment_due integer NOT NULL DEFAULT 0 CHECK (adjustment_due >= 0)
);
CREATE TABLE points_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES points_accounts(customer_id),
  order_id uuid UNIQUE REFERENCES orders(id),
  eligible_minor bigint NOT NULL DEFAULT 0 CHECK (eligible_minor >= 0),
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0 AND refunded_minor <= eligible_minor),
  points integer NOT NULL CHECK (points >= 0),
  remaining integer NOT NULL DEFAULT 0 CHECK (remaining >= 0 AND remaining <= points),
  expired_points integer NOT NULL DEFAULT 0 CHECK (expired_points >= 0 AND expired_points <= points),
  state varchar(16) NOT NULL CHECK (state IN ('PENDING','AVAILABLE','REVERSED')),
  rules_version varchar(32) NOT NULL,
  completed_at timestamptz,
  available_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX points_lots_wallet_idx ON points_lots(customer_id, state, expires_at);
CREATE TABLE points_redemptions (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  customer_id uuid NOT NULL REFERENCES points_accounts(customer_id),
  points integer NOT NULL CHECK (points > 0),
  restored integer NOT NULL DEFAULT 0 CHECK (restored >= 0 AND restored <= points),
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  state varchar(16) NOT NULL CHECK (state IN ('RESERVED','CAPTURED','RELEASED')),
  allocations jsonb NOT NULL CHECK (jsonb_typeof(allocations) = 'array'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX points_redemptions_wallet_idx ON points_redemptions(customer_id, state);
CREATE TABLE points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES points_accounts(customer_id),
  order_id uuid REFERENCES orders(id),
  event_key varchar(180) NOT NULL UNIQUE,
  kind varchar(24) NOT NULL CHECK (kind IN ('PENDING','EARNED','RESERVED','RELEASED','REDEEMED','EXPIRED','REFUND','ADJUSTMENT')),
  points integer NOT NULL,
  description varchar(300) NOT NULL,
  staff_id uuid,
  evidence varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX points_ledger_customer_idx ON points_ledger(customer_id, created_at DESC, id DESC);
ALTER TABLE points_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flyseri_api') THEN
    CREATE POLICY flyseri_api_server_access ON points_accounts FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    CREATE POLICY flyseri_api_server_access ON points_lots FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    CREATE POLICY flyseri_api_server_access ON points_redemptions FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    CREATE POLICY flyseri_api_server_access ON points_ledger FOR SELECT TO flyseri_api USING (true);
    CREATE POLICY flyseri_api_ledger_insert ON points_ledger FOR INSERT TO flyseri_api WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE ON points_accounts, points_lots, points_redemptions TO flyseri_api;
    GRANT SELECT, INSERT ON points_ledger TO flyseri_api;
  END IF;
END $$;
