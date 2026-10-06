ALTER TABLE "visa_assistance_request_travellers" ADD COLUMN "applicant_details" jsonb;--> statement-breakpoint
ALTER TABLE "visa_assistance_requests" ADD COLUMN "expected_return_date" date;--> statement-breakpoint
ALTER TABLE "visa_assistance_requests" ADD COLUMN "accommodation_or_host" varchar(240);--> statement-breakpoint
ALTER TABLE "visa_assistance_requests" ADD CONSTRAINT "visa_assistance_requests_return_date_valid" CHECK ("visa_assistance_requests"."expected_return_date" is null or "visa_assistance_requests"."expected_return_date" >= "visa_assistance_requests"."expected_travel_date");