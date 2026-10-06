CREATE TABLE "trip_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"city_name" varchar(120),
	"sequence" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_destinations_sequence_valid" CHECK ("trip_destinations"."sequence" > 0),
	CONSTRAINT "trip_destinations_dates_valid" CHECK ("trip_destinations"."start_date" is null or "trip_destinations"."end_date" is null or "trip_destinations"."end_date" >= "trip_destinations"."start_date")
);
--> statement-breakpoint
CREATE TABLE "trip_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"title" varchar(160),
	"status" varchar(12) DEFAULT 'PLANNING' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "trips_status_valid" CHECK ("trips"."status" in ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "trips_dates_valid" CHECK ("trips"."start_date" is null or "trips"."end_date" is null or "trips"."end_date" >= "trips"."start_date")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_destinations" ADD CONSTRAINT "trip_destinations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travellers" ADD CONSTRAINT "trip_travellers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travellers" ADD CONSTRAINT "trip_travellers_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_destinations_trip_sequence_unique" ON "trip_destinations" USING btree ("trip_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_travellers_unique" ON "trip_travellers" USING btree ("trip_id","traveller_id");--> statement-breakpoint
CREATE INDEX "trip_travellers_traveller_idx" ON "trip_travellers" USING btree ("traveller_id");--> statement-breakpoint
CREATE INDEX "trips_customer_status_idx" ON "trips" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "trips_customer_start_idx" ON "trips" USING btree ("customer_id","start_date");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;