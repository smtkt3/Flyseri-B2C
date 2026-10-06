CREATE TABLE "visa_assistance_request_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visa_assistance_request_documents" ADD CONSTRAINT "visa_assistance_request_documents_request_id_visa_assistance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."visa_assistance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_request_documents" ADD CONSTRAINT "visa_assistance_request_documents_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_request_documents" ADD CONSTRAINT "visa_assistance_request_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_request_documents" ADD CONSTRAINT "visa_assistance_request_documents_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visa_assistance_request_documents" ADD CONSTRAINT "visa_assistance_documents_applicant_fk" FOREIGN KEY ("request_id","traveller_id") REFERENCES "public"."visa_assistance_request_travellers"("request_id","traveller_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visa_assistance_documents_version_unique" ON "visa_assistance_request_documents" USING btree ("request_id","document_version_id");--> statement-breakpoint
CREATE INDEX "visa_assistance_documents_request_idx" ON "visa_assistance_request_documents" USING btree ("request_id");
--> statement-breakpoint
ALTER TABLE "visa_assistance_request_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "flyseri_api_server_access" ON "visa_assistance_request_documents" FOR ALL TO flyseri_api USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "visa_assistance_request_documents" TO flyseri_api;--> statement-breakpoint
GRANT UPDATE (status, updated_at) ON "visa_assistance_requests" TO flyseri_api;
