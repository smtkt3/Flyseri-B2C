-- Customer data is accessed through the Flyseri API using a dedicated database role.
-- Browser Supabase anon/authenticated roles receive no direct row policies.
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "travellers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_travellers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
