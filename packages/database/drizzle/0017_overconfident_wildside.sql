CREATE TABLE "guest_flight_checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"search_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"contact_name" varchar(120) NOT NULL,
	"contact_email" varchar(254) NOT NULL,
	"contact_phone" varchar(24) NOT NULL,
	"passenger_names" jsonb NOT NULL,
	"route" varchar(320) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"shopping_amount" numeric(18, 2) NOT NULL,
	"status" varchar(24) DEFAULT 'DETAILS_SUBMITTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_flight_checkout_attempts_status_valid" CHECK ("guest_flight_checkout_attempts"."status" in ('DETAILS_SUBMITTED')),
	CONSTRAINT "guest_flight_checkout_attempts_currency_valid" CHECK ("guest_flight_checkout_attempts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "guest_flight_checkout_attempts_amount_valid" CHECK ("guest_flight_checkout_attempts"."shopping_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_flight_checkout_attempts_key_unique" ON "guest_flight_checkout_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "guest_flight_checkout_attempts_created_idx" ON "guest_flight_checkout_attempts" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "guest_flight_checkout_attempts" ENABLE ROW LEVEL SECURITY;
