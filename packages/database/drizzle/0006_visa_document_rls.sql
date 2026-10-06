-- Customer document and visa data is accessed through the Flyseri backend only.
-- Browser anon/authenticated roles have no policies on these tables.
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_requirements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_application_travellers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_application_requirements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_requirement_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visa_status_history" ENABLE ROW LEVEL SECURITY;
