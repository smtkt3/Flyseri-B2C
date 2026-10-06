CREATE TABLE "visa_assistance_request_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visa_assistance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_reference" varchar(24) DEFAULT 'FVA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) NOT NULL,
	"customer_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"destination_country_code" varchar(2) NOT NULL,
	"expected_travel_date" date NOT NULL,
	"purpose" varchar(80) NOT NULL,
	"contact_name" varchar(120) NOT NULL,
	"contact_email" varchar(254) NOT NULL,
	"contact_phone" varchar(32),
	"customer_message" text,
	"status" varchar(20) DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visa_assistance_requests_country_valid" CHECK ("visa_assistance_requests"."destination_country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "visa_assistance_requests_status_valid" CHECK ("visa_assistance_requests"."status" in ('NEW', 'IN_REVIEW', 'CONTACTED', 'CONVERTED', 'CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "visa_assistance_request_travellers" ADD CONSTRAINT "visa_assistance_request_travellers_request_id_visa_assistance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."visa_assistance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_request_travellers" ADD CONSTRAINT "visa_assistance_request_travellers_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_requests" ADD CONSTRAINT "visa_assistance_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_requests" ADD CONSTRAINT "visa_assistance_requests_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visa_assistance_request_travellers_unique" ON "visa_assistance_request_travellers" USING btree ("request_id","traveller_id");--> statement-breakpoint
CREATE INDEX "visa_assistance_request_travellers_traveller_idx" ON "visa_assistance_request_travellers" USING btree ("traveller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_assistance_requests_reference_unique" ON "visa_assistance_requests" USING btree ("request_reference");--> statement-breakpoint
CREATE INDEX "visa_assistance_requests_customer_created_idx" ON "visa_assistance_requests" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "visa_assistance_requests_status_created_idx" ON "visa_assistance_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "visa_assistance_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visa_assistance_request_travellers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "flyseri_api_server_access" ON "visa_assistance_requests" FOR ALL TO flyseri_api USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "flyseri_api_server_access" ON "visa_assistance_request_travellers" FOR ALL TO flyseri_api USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT ON "visa_assistance_requests" TO flyseri_api;--> statement-breakpoint
GRANT SELECT, INSERT ON "visa_assistance_request_travellers" TO flyseri_api;
