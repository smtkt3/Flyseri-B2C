CREATE TABLE "flight_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_intent_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"trip_id" uuid,
	"status" varchar(28) DEFAULT 'BOOKING_PENDING' NOT NULL,
	"pnr_locator" varchar(16),
	"sabre_booking_id" varchar(80),
	"last_sabre_refresh_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flight_bookings_status_valid" CHECK ("flight_bookings"."status" in ('BOOKING_PENDING', 'BOOKING_IN_PROGRESS', 'BOOKING_UNKNOWN', 'PNR_CREATED', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'AWAITING_STAFF_TICKETING', 'TICKETING_IN_PROGRESS', 'TICKETED', 'BOOKING_FAILED', 'PNR_EXPIRED', 'FARE_CHANGED', 'PAYMENT_FAILED', 'MANUAL_REVIEW_REQUIRED', 'TICKETING_FAILED', 'CANCELLED', 'REFUND_REQUIRED'))
);
--> statement-breakpoint
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_booking_intent_id_flight_booking_intents_id_fk" FOREIGN KEY ("booking_intent_id") REFERENCES "public"."flight_booking_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flight_bookings_intent_unique" ON "flight_bookings" USING btree ("booking_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_bookings_pnr_unique" ON "flight_bookings" USING btree ("pnr_locator") WHERE "flight_bookings"."pnr_locator" is not null;--> statement-breakpoint
CREATE INDEX "flight_bookings_customer_created_idx" ON "flight_bookings" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "flight_bookings_status_updated_idx" ON "flight_bookings" USING btree ("status","updated_at");
--> statement-breakpoint
ALTER TABLE "flight_bookings" ENABLE ROW LEVEL SECURITY;
