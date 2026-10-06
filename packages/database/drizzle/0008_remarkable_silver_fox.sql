CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"staff_role" varchar(24) NOT NULL,
	"event" varchar(80) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" uuid NOT NULL,
	"request_id" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_idx" ON "admin_audit_events" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ENABLE ROW LEVEL SECURITY;
