CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" varchar(180) NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"file_size" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"version_number" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"upload_state" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"security_scan_status" varchar(12) DEFAULT 'UNAVAILABLE' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_number_valid" CHECK ("document_versions"."version_number" > 0),
	CONSTRAINT "document_versions_size_valid" CHECK ("document_versions"."file_size" > 0),
	CONSTRAINT "document_versions_upload_valid" CHECK ("document_versions"."upload_state" in ('PENDING', 'UPLOADED', 'FAILED')),
	CONSTRAINT "document_versions_scan_valid" CHECK ("document_versions"."security_scan_status" in ('PENDING', 'CLEAN', 'FAILED', 'UNAVAILABLE'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"traveller_id" uuid,
	"document_type" varchar(32) NOT NULL,
	"display_name" varchar(160),
	"status" varchar(20) DEFAULT 'UPLOADED' NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"issuing_country_code" varchar(2),
	"next_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "documents_next_version_valid" CHECK ("documents"."next_version" > 0),
	CONSTRAINT "documents_dates_valid" CHECK ("documents"."issued_on" is null or "documents"."expires_on" is null or "documents"."expires_on" >= "documents"."issued_on"),
	CONSTRAINT "documents_status_valid" CHECK ("documents"."status" in ('UPLOADED', 'PROCESSING', 'READY', 'REVIEW_REQUIRED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "visa_application_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"source_requirement_id" uuid,
	"requirement_code" varchar(64) NOT NULL,
	"name_snapshot" varchar(160) NOT NULL,
	"description_snapshot" text,
	"required_snapshot" boolean NOT NULL,
	"document_type_snapshot" varchar(32),
	"display_order" integer NOT NULL,
	"status" varchar(20) DEFAULT 'MISSING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visa_application_requirements_status_valid" CHECK ("visa_application_requirements"."status" in ('MISSING', 'UPLOADED', 'REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED', 'NOT_APPLICABLE'))
);
--> statement-breakpoint
CREATE TABLE "visa_application_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visa_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"visa_type_id" uuid NOT NULL,
	"destination_country_code" varchar(2) NOT NULL,
	"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "visa_applications_status_valid" CHECK ("visa_applications"."status" in ('DRAFT', 'INCOMPLETE', 'DOCUMENTS_SUBMITTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "visa_requirement_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_requirement_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visa_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visa_type_id" uuid NOT NULL,
	"requirement_code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"document_type_required" varchar(32),
	"required" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"nationality_country_code" varchar(2),
	"residence_country_code" varchar(2),
	"min_age" integer,
	"max_age" integer,
	"effective_from" date,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visa_requirements_age_valid" CHECK ("visa_requirements"."min_age" is null or "visa_requirements"."max_age" is null or "visa_requirements"."max_age" >= "visa_requirements"."min_age"),
	CONSTRAINT "visa_requirements_effective_valid" CHECK ("visa_requirements"."effective_from" is null or "visa_requirements"."effective_until" is null or "visa_requirements"."effective_until" >= "visa_requirements"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "visa_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" varchar(24),
	"to_status" varchar(24) NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_customer_id" uuid,
	"reason_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visa_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_country_code" varchar(2) NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "visa_application_id" uuid;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD CONSTRAINT "visa_application_requirements_application_id_visa_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD CONSTRAINT "visa_application_requirements_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD CONSTRAINT "visa_application_requirements_source_requirement_id_visa_requirements_id_fk" FOREIGN KEY ("source_requirement_id") REFERENCES "public"."visa_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_application_travellers" ADD CONSTRAINT "visa_application_travellers_application_id_visa_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_application_travellers" ADD CONSTRAINT "visa_application_travellers_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_visa_type_id_visa_types_id_fk" FOREIGN KEY ("visa_type_id") REFERENCES "public"."visa_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_requirement_documents" ADD CONSTRAINT "visa_requirement_documents_application_requirement_id_visa_application_requirements_id_fk" FOREIGN KEY ("application_requirement_id") REFERENCES "public"."visa_application_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_requirement_documents" ADD CONSTRAINT "visa_requirement_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_requirement_documents" ADD CONSTRAINT "visa_requirement_documents_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_requirements" ADD CONSTRAINT "visa_requirements_visa_type_id_visa_types_id_fk" FOREIGN KEY ("visa_type_id") REFERENCES "public"."visa_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_status_history" ADD CONSTRAINT "visa_status_history_application_id_visa_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_status_history" ADD CONSTRAINT "visa_status_history_actor_customer_id_customers_id_fk" FOREIGN KEY ("actor_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_number_unique" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_idempotency_unique" ON "document_versions" USING btree ("document_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_path_unique" ON "document_versions" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_customer_idx" ON "documents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "documents_customer_traveller_idx" ON "documents" USING btree ("customer_id","traveller_id");--> statement-breakpoint
CREATE INDEX "documents_customer_type_idx" ON "documents" USING btree ("customer_id","document_type");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_application_requirements_unique" ON "visa_application_requirements" USING btree ("application_id","traveller_id","requirement_code");--> statement-breakpoint
CREATE INDEX "visa_application_requirements_app_idx" ON "visa_application_requirements" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_application_travellers_unique" ON "visa_application_travellers" USING btree ("application_id","traveller_id");--> statement-breakpoint
CREATE INDEX "visa_applications_customer_idx" ON "visa_applications" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "visa_applications_trip_idx" ON "visa_applications" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_requirement_documents_unique" ON "visa_requirement_documents" USING btree ("application_requirement_id","document_version_id");--> statement-breakpoint
CREATE INDEX "visa_requirement_documents_requirement_idx" ON "visa_requirement_documents" USING btree ("application_requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_requirements_type_code_unique" ON "visa_requirements" USING btree ("visa_type_id","requirement_code");--> statement-breakpoint
CREATE INDEX "visa_requirements_type_active_idx" ON "visa_requirements" USING btree ("visa_type_id","active");--> statement-breakpoint
CREATE INDEX "visa_status_history_app_idx" ON "visa_status_history" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_types_country_code_unique" ON "visa_types" USING btree ("destination_country_code","code");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_visa_application_id_visa_applications_id_fk" FOREIGN KEY ("visa_application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;