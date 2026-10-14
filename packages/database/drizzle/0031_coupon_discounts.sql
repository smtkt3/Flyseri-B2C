CREATE TABLE discount_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  discount_type varchar(12) NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
  discount_value numeric(18,2) NOT NULL CHECK (discount_value > 0 AND (discount_type <> 'PERCENT' OR discount_value <= 100)),
  currency varchar(3) NOT NULL CHECK (currency IN ('BDT','MYR','USD','SGD','EUR','GBP','AUD')),
  minimum_spend numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_spend >= 0),
  maximum_discount numeric(18,2) CHECK (maximum_discount > 0),
  starts_at timestamptz, expires_at timestamptz,
  usage_limit integer CHECK (usage_limit > 0),
  per_customer_limit integer NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  applies_to varchar(16) NOT NULL DEFAULT 'FLIGHT' CHECK (applies_to IN ('FLIGHT','VISA','ALL')),
  active boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_staff_id uuid NOT NULL, updated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)
);
CREATE TABLE coupon_redemptions (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  coupon_id uuid NOT NULL REFERENCES discount_coupons(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  code varchar(40) NOT NULL, currency varchar(3) NOT NULL,
  discount_amount numeric(18,2) NOT NULL CHECK (discount_amount > 0),
  state varchar(16) NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED','CAPTURED','RELEASED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_redemptions_coupon_customer_idx ON coupon_redemptions(coupon_id,customer_id);
ALTER TABLE discount_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discount_coupons,coupon_redemptions FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON discount_coupons,coupon_redemptions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON discount_coupons,coupon_redemptions FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flyseri_api') THEN
    CREATE POLICY flyseri_api_server_access ON discount_coupons FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    CREATE POLICY flyseri_api_server_access ON coupon_redemptions FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
    GRANT SELECT,INSERT,UPDATE ON discount_coupons,coupon_redemptions TO flyseri_api;
  END IF;
END $$;
