ALTER TABLE "visa_application_requirements" ADD COLUMN "condition_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD COLUMN "reviewed_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ADD COLUMN "reviewed_at" timestamp with time zone;