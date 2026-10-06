CREATE TABLE "flight_booking_intent_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_intent_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_booking_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"trip_id" uuid,
	"search_id" uuid NOT NULL,
	"selected_offer_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'CREATED' NOT NULL,
	"supplier" varchar(16) DEFAULT 'SABRE' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"search_total_amount" varchar(24) NOT NULL,
	"validated_total_amount" varchar(24),
	"price_changed" boolean DEFAULT false NOT NULL,
	"selected_offer_snapshot" jsonb NOT NULL,
	"search_request_snapshot" jsonb NOT NULL,
	"validated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "flight_booking_intents_status_valid" CHECK ("flight_booking_intents"."status" in ('CREATED', 'VALIDATING', 'VALIDATED', 'PRICE_CHANGED', 'EXPIRED', 'READY_FOR_PAYMENT', 'FAILED', 'CANCELLED')),
	CONSTRAINT "flight_booking_intents_supplier_valid" CHECK ("flight_booking_intents"."supplier" = 'SABRE'),
	CONSTRAINT "flight_booking_intents_currency_valid" CHECK ("flight_booking_intents"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "flight_booking_intents_amount_valid" CHECK ("flight_booking_intents"."search_total_amount" ~ '^[0-9]+(\.[0-9]{1,2})?$' and ("flight_booking_intents"."validated_total_amount" is null or "flight_booking_intents"."validated_total_amount" ~ '^[0-9]+(\.[0-9]{1,2})?$'))
);
--> statement-breakpoint
ALTER TABLE "flight_booking_intent_travellers" ADD CONSTRAINT "flight_booking_intent_travellers_booking_intent_id_flight_booking_intents_id_fk" FOREIGN KEY ("booking_intent_id") REFERENCES "public"."flight_booking_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_booking_intent_travellers" ADD CONSTRAINT "flight_booking_intent_travellers_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_booking_intents" ADD CONSTRAINT "flight_booking_intents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_booking_intents" ADD CONSTRAINT "flight_booking_intents_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flight_booking_intent_travellers_unique" ON "flight_booking_intent_travellers" USING btree ("booking_intent_id","traveller_id");--> statement-breakpoint
CREATE INDEX "flight_booking_intent_travellers_traveller_idx" ON "flight_booking_intent_travellers" USING btree ("traveller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_booking_intents_customer_idempotency_unique" ON "flight_booking_intents" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "flight_booking_intents_customer_created_idx" ON "flight_booking_intents" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "flight_booking_intents_trip_idx" ON "flight_booking_intents" USING btree ("trip_id");
--> statement-breakpoint
ALTER TABLE "flight_booking_intents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "flight_booking_intent_travellers" ENABLE ROW LEVEL SECURITY;
