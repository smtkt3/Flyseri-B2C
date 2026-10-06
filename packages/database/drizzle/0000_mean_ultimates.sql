CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_customer_id" uuid NOT NULL,
	"traveller_id" uuid,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"relationship_type" varchar(12) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_travellers_relationship_valid" CHECK ("customer_travellers"."relationship_type" in ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'RELATIVE', 'FRIEND', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"display_name" varchar(120),
	"phone_country_code" varchar(8),
	"phone_number" varchar(24),
	"preferred_language" varchar(12),
	"preferred_currency" varchar(3),
	"status" varchar(12) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_status_valid" CHECK ("customers"."status" in ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_first_name" varchar(100) NOT NULL,
	"legal_middle_name" varchar(100),
	"legal_last_name" varchar(100) NOT NULL,
	"date_of_birth" date,
	"gender" varchar(16),
	"nationality_country_code" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "travellers_gender_valid" CHECK ("travellers"."gender" is null or "travellers"."gender" in ('FEMALE', 'MALE', 'X', 'UNDISCLOSED'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_customer_id_customers_id_fk" FOREIGN KEY ("actor_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_travellers" ADD CONSTRAINT "customer_travellers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_travellers" ADD CONSTRAINT "customer_travellers_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_travellers_unique" ON "customer_travellers" USING btree ("customer_id","traveller_id");--> statement-breakpoint
CREATE INDEX "customer_travellers_customer_idx" ON "customer_travellers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_travellers_traveller_idx" ON "customer_travellers" USING btree ("traveller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_auth_user_id_unique" ON "customers" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "travellers_archived_at_idx" ON "travellers" USING btree ("archived_at");