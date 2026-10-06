CREATE TABLE "visa_application_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"visibility" varchar(12) DEFAULT 'INTERNAL' NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visa_application_notes_visibility_valid" CHECK ("visa_application_notes"."visibility" in ('INTERNAL', 'CUSTOMER'))
);
--> statement-breakpoint
CREATE TABLE "visa_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"application_requirement_id" uuid,
	"traveller_id" uuid,
	"field_key" varchar(120),
	"request_type" varchar(24) NOT NULL,
	"reason" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" varchar(12) DEFAULT 'OPEN' NOT NULL,
	"requested_by_staff_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visa_review_requests_type_valid" CHECK ("visa_review_requests"."request_type" in ('DOCUMENT', 'ANSWER', 'ADDITIONAL_INFO')),
	CONSTRAINT "visa_review_requests_status_valid" CHECK ("visa_review_requests"."status" in ('OPEN', 'RESOLVED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "visa_service_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visa_type_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"nationality_eligibility" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"processing_time_text" varchar(240),
	"government_fee_amount" numeric(12, 2),
	"service_fee_amount" numeric(12, 2),
	"other_fee_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" varchar(3),
	"validity_text" varchar(240),
	"entry_type" varchar(24),
	"notes" text,
	"disclaimers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_definition" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"effective_from" date,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visa_service_versions_version_valid" CHECK ("visa_service_versions"."version" > 0),
	CONSTRAINT "visa_service_versions_currency_valid" CHECK ("visa_service_versions"."currency" is null or "visa_service_versions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "visa_service_versions_fees_nonnegative" CHECK (("visa_service_versions"."government_fee_amount" is null or "visa_service_versions"."government_fee_amount" >= 0) and ("visa_service_versions"."service_fee_amount" is null or "visa_service_versions"."service_fee_amount" >= 0)),
	CONSTRAINT "visa_service_versions_dates_valid" CHECK ("visa_service_versions"."effective_from" is null or "visa_service_versions"."effective_until" is null or "visa_service_versions"."effective_until" >= "visa_service_versions"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "visa_application_requirements" DROP CONSTRAINT "visa_application_requirements_status_valid";--> statement-breakpoint
ALTER TABLE "visa_applications" DROP CONSTRAINT "visa_applications_status_valid";--> statement-breakpoint
ALTER TABLE "visa_applications" ALTER COLUMN "status" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "visa_applications" ALTER COLUMN "status" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "visa_application_id" uuid;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "application_reference" varchar(24) DEFAULT 'FSV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) NOT NULL;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "service_version_id" uuid;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "service_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "form_snapshot" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "answers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "fee_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "declaration_version" varchar(32);--> statement-breakpoint
ALTER TABLE "visa_applications" ADD COLUMN "declaration_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visa_requirements" ADD COLUMN "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "visa_status_history" ADD COLUMN "actor_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "visa_status_history" ADD COLUMN "customer_message" text;--> statement-breakpoint
ALTER TABLE "visa_status_history" ADD COLUMN "internal_note" text;--> statement-breakpoint
ALTER TABLE "visa_application_notes" ADD CONSTRAINT "visa_application_notes_application_id_visa_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_review_requests" ADD CONSTRAINT "visa_review_requests_application_id_visa_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_review_requests" ADD CONSTRAINT "visa_review_requests_application_requirement_id_visa_application_requirements_id_fk" FOREIGN KEY ("application_requirement_id") REFERENCES "public"."visa_application_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_review_requests" ADD CONSTRAINT "visa_review_requests_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_service_versions" ADD CONSTRAINT "visa_service_versions_visa_type_id_visa_types_id_fk" FOREIGN KEY ("visa_type_id") REFERENCES "public"."visa_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visa_application_notes_app_idx" ON "visa_application_notes" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "visa_review_requests_app_idx" ON "visa_review_requests" USING btree ("application_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_service_versions_type_version_unique" ON "visa_service_versions" USING btree ("visa_type_id","version");--> statement-breakpoint
CREATE INDEX "visa_service_versions_active_idx" ON "visa_service_versions" USING btree ("visa_type_id","active");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_visa_application_id_visa_applications_id_fk" FOREIGN KEY ("visa_application_id") REFERENCES "public"."visa_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_service_version_id_visa_service_versions_id_fk" FOREIGN KEY ("service_version_id") REFERENCES "public"."visa_service_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_visa_application_unique" ON "orders" USING btree ("visa_application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visa_applications_reference_unique" ON "visa_applications" USING btree ("application_reference");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_valid" CHECK ("orders"."booking_intent_id" is null or "orders"."visa_application_id" is null);--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD CONSTRAINT "visa_application_requirements_status_valid" CHECK ("visa_application_requirements"."status" in ('MISSING', 'UPLOADED', 'UNDER_REVIEW', 'REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED', 'REPLACEMENT_REQUIRED', 'NOT_APPLICABLE'));--> statement-breakpoint
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_status_valid" CHECK ("visa_applications"."status" in ('DRAFT', 'INCOMPLETE', 'READY_TO_SUBMIT', 'SUBMITTED', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMING', 'PAYMENT_FAILED', 'PAID', 'DOCUMENT_REVIEW', 'ADDITIONAL_DOCUMENTS_REQUIRED', 'APPLICATION_PREPARATION', 'READY_FOR_SUBMISSION_TO_AUTHORITY', 'SUBMITTED_TO_EMBASSY_OR_AUTHORITY', 'UNDER_PROCESSING', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'VISA_ISSUED', 'REJECTED', 'COMPLETED', 'DOCUMENTS_SUBMITTED', 'CANCELLED'));
--> statement-breakpoint
ALTER TABLE "visa_service_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_review_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_application_notes" ENABLE ROW LEVEL SECURITY;
