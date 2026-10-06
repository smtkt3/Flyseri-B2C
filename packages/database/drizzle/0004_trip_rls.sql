-- Trip data is read and written only by the Flyseri backend database role.
-- Supabase browser roles have no row policies on these tables.
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trip_destinations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trip_travellers" ENABLE ROW LEVEL SECURITY;
