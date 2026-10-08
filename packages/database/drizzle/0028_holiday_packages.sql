CREATE TABLE holiday_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE holiday_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference varchar(32) NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  package_id uuid NOT NULL REFERENCES holiday_packages(id),
  package_snapshot jsonb NOT NULL,
  request jsonb NOT NULL,
  idempotency_key uuid NOT NULL,
  total_minor numeric(16,0) NOT NULL CHECK (total_minor > 0),
  status varchar(24) NOT NULL DEFAULT 'PENDING_CONFIRMATION' CHECK (status IN ('PENDING_CONFIRMATION','CONFIRMED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX holiday_bookings_customer_idx ON holiday_bookings(customer_id, created_at);
CREATE INDEX holiday_packages_published_idx ON holiday_packages(published);
ALTER TABLE holiday_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_bookings ENABLE ROW LEVEL SECURITY;
