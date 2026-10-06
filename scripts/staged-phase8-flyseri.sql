BEGIN;
CREATE TABLE "crm_customer_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"crm_contact_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'LINKED' NOT NULL,
	"link_method" varchar(24) DEFAULT 'STAFF_CONFIRMED' NOT NULL,
	"linked_by_staff_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	CONSTRAINT "crm_customer_links_status_valid" CHECK ("crm_customer_links"."status" in ('LINKED', 'UNLINKED'))
);
--> statement-breakpoint
CREATE TABLE "crm_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"customer_id" uuid,
	"resource_id" uuid,
	"source_audit_id" uuid,
	"source_commerce_id" uuid,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error_category" varchar(32),
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_sync_status_valid" CHECK ("crm_sync_events"."status" in ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD')),
	CONSTRAINT "crm_sync_attempts_valid" CHECK ("crm_sync_events"."attempts" >= 0 and "crm_sync_events"."attempts" <= 5)
);
--> statement-breakpoint
ALTER TABLE "crm_customer_links" ADD CONSTRAINT "crm_customer_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sync_events" ADD CONSTRAINT "crm_sync_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_customer_links_active_customer" ON "crm_customer_links" USING btree ("customer_id") WHERE "crm_customer_links"."status" = 'LINKED';--> statement-breakpoint
CREATE UNIQUE INDEX "crm_customer_links_active_contact" ON "crm_customer_links" USING btree ("crm_contact_id") WHERE "crm_customer_links"."status" = 'LINKED';--> statement-breakpoint
CREATE INDEX "crm_customer_links_customer_idx" ON "crm_customer_links" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sync_source_audit_unique" ON "crm_sync_events" USING btree ("source_audit_id") WHERE "crm_sync_events"."source_audit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sync_source_commerce_unique" ON "crm_sync_events" USING btree ("source_commerce_id") WHERE "crm_sync_events"."source_commerce_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_sync_due_idx" ON "crm_sync_events" USING btree ("status","next_attempt_at");
--> statement-breakpoint
ALTER TABLE "crm_customer_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_sync_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION flyseri_queue_customer_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_events(actor_customer_id, event) VALUES (NEW.id, 'customer.created');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER flyseri_customer_created AFTER INSERT ON customers FOR EACH ROW EXECUTE FUNCTION flyseri_queue_customer_created();
--> statement-breakpoint
CREATE FUNCTION flyseri_queue_audit_for_crm() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.event IN ('customer.created', 'customer.profile.updated', 'traveller.created', 'traveller.updated',
    'trip.created', 'trip.updated', 'trip.archived', 'visa.application.created', 'visa.status.changed',
    'document.version.uploaded', 'flight.booking_intent.created', 'flight.booking_intent.validated') THEN
    INSERT INTO crm_sync_events(event_type, customer_id, resource_id, source_audit_id)
      VALUES (NEW.event, NEW.actor_customer_id,
        COALESCE(NEW.visa_application_id, NEW.document_id, NEW.trip_id, NEW.traveller_id, NEW.actor_customer_id), NEW.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER flyseri_audit_crm_sync AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION flyseri_queue_audit_for_crm();
--> statement-breakpoint
CREATE FUNCTION flyseri_queue_commerce_for_crm() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner_id uuid;
BEGIN
  IF NEW.event_type IN ('order.created', 'payment.succeeded', 'payment.failed', 'payment.reconciliation_required') THEN
    SELECT customer_id INTO owner_id FROM orders WHERE id = NEW.order_id;
    IF owner_id IS NOT NULL THEN
      INSERT INTO crm_sync_events(event_type, customer_id, resource_id, source_commerce_id)
        VALUES (NEW.event_type, owner_id, COALESCE(NEW.payment_id, NEW.order_id), NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER flyseri_commerce_crm_sync AFTER INSERT ON commerce_outbox FOR EACH ROW EXECUTE FUNCTION flyseri_queue_commerce_for_crm();

INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ('e4d8082b7f639b412fb962cbb3294b6dfce8e2515936d0caabbd89348b0fa99d', 1790476861438);
-- Run as database owner after 0012. Flyseri's server-only role receives no DELETE or DDL rights.

GRANT SELECT, INSERT, UPDATE ON public.crm_customer_links TO flyseri_api;
GRANT SELECT, UPDATE ON public.crm_sync_events TO flyseri_api;
CREATE POLICY flyseri_api_server_access ON public.crm_customer_links FOR ALL TO flyseri_api USING (true) WITH CHECK (true);
CREATE POLICY flyseri_api_server_access ON public.crm_sync_events FOR SELECT TO flyseri_api USING (true);
CREATE POLICY flyseri_api_server_update ON public.crm_sync_events FOR UPDATE TO flyseri_api USING (true) WITH CHECK (true);

COMMIT;
