CREATE TABLE "commerce_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" varchar(12) NOT NULL,
	"actor_customer_id" uuid,
	"order_id" uuid,
	"payment_id" uuid,
	"event" varchar(80) NOT NULL,
	"request_id" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_audit_actor_valid" CHECK ("commerce_audit_events"."actor_type" in ('CUSTOMER', 'PROVIDER', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "commerce_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_type" varchar(24) NOT NULL,
	"reference_id" uuid,
	"description_snapshot" varchar(240) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount" numeric(18, 2) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_type_valid" CHECK ("order_items"."item_type" in ('FLIGHT', 'VISA_SERVICE', 'SERVICE_FEE')),
	CONSTRAINT "order_items_amount_valid" CHECK ("order_items"."quantity" > 0 and "order_items"."unit_amount" >= 0 and "order_items"."total_amount" = "order_items"."quantity" * "order_items"."unit_amount"),
	CONSTRAINT "order_items_currency_valid" CHECK ("order_items"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"trip_id" uuid,
	"booking_intent_id" uuid,
	"order_number" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"fulfillment_status" varchar(32) DEFAULT 'NOT_STARTED' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"subtotal_amount" numeric(18, 2) NOT NULL,
	"fees_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "orders_fulfillment_valid" CHECK ("orders"."fulfillment_status" in ('NOT_STARTED', 'REVALIDATION_REQUIRED')),
	CONSTRAINT "orders_currency_valid" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_amounts_valid" CHECK ("orders"."subtotal_amount" >= 0 and "orders"."fees_amount" >= 0 and "orders"."discount_amount" >= 0 and "orders"."tax_amount" >= 0 and "orders"."total_amount" >= 0 and "orders"."total_amount" = "orders"."subtotal_amount" + "orders"."fees_amount" + "orders"."tax_amount" - "orders"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_attempt_reference" varchar(160),
	"status" varchar(24) DEFAULT 'CREATED' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"failure_category" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_status_valid" CHECK ("payment_attempts"."status" in ('CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
	CONSTRAINT "payment_attempts_amount_valid" CHECK ("payment_attempts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(160) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"verified" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'CREATED' NOT NULL,
	"reconciliation_state" varchar(12) DEFAULT 'NONE' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider_payment_id" varchar(160),
	"provider_reference" varchar(160),
	"authorized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_valid" CHECK ("payments"."status" in ('CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
	CONSTRAINT "payments_reconciliation_valid" CHECK ("payments"."reconciliation_state" in ('NONE', 'REQUIRED', 'RESOLVED')),
	CONSTRAINT "payments_amount_valid" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_currency_valid" CHECK ("payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(16) DEFAULT 'REQUESTED' NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"provider_refund_id" varchar(160),
	"requested_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "refunds_amount_valid" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_status_valid" CHECK ("refunds"."status" in ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "commerce_audit_events" ADD CONSTRAINT "commerce_audit_events_actor_customer_id_customers_id_fk" FOREIGN KEY ("actor_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_audit_events" ADD CONSTRAINT "commerce_audit_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_audit_events" ADD CONSTRAINT "commerce_audit_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_outbox" ADD CONSTRAINT "commerce_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_outbox" ADD CONSTRAINT "commerce_outbox_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_booking_intent_id_flight_booking_intents_id_fk" FOREIGN KEY ("booking_intent_id") REFERENCES "public"."flight_booking_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_audit_order_created_idx" ON "commerce_audit_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_outbox_unprocessed_idx" ON "commerce_outbox" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_booking_intent_unique" ON "orders" USING btree ("booking_intent_id");--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_trip_idx" ON "orders" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_key_unique" ON "payment_attempts" USING btree ("payment_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_active" ON "payment_attempts" USING btree ("payment_id") WHERE "payment_attempts"."status" in ('CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN');--> statement-breakpoint
CREATE INDEX "payment_attempts_payment_created_idx" ON "payment_attempts" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_unique" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_payment_received_idx" ON "payment_events" USING btree ("payment_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_unique" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_unique" ON "payments" USING btree ("provider","provider_payment_id") WHERE "payments"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_customer_created_idx" ON "payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_reconciliation_idx" ON "payments" USING btree ("reconciliation_state","updated_at");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce_audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce_outbox" ENABLE ROW LEVEL SECURITY;
