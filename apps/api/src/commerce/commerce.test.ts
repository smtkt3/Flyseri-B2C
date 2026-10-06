import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { CommerceRepository } from './commerce.repository.js';
import { CommerceService } from './commerce.service.js';
import { PaymentEngineService } from './payment-engine.service.js';

async function migrated() {
  const database = new PGlite();
  await database.exec('CREATE ROLE flyseri_api');
  const journal = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/database/drizzle/meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const migration = readFileSync(resolve(process.cwd(), `../../packages/database/drizzle/${entry.tag}.sql`), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) await database.exec(statement);
  }
  return database;
}

describe('commerce order foundation', () => {
  it('copies the validated amount once, isolates customers, denies stale fares and keeps payment disabled', async () => {
    const database = await migrated();
    try {
      const rls = await database.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relname in ('flight_bookings','orders','order_items','payments','payment_attempts','payment_events','refunds','commerce_audit_events','commerce_outbox')");
      expect(rls.rows).toHaveLength(9);
      expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
      const a = randomUUID(), b = randomUUID(), intentId = randomUUID(), staleId = randomUUID();
      await database.query('insert into customers (id,auth_user_id) values ($1,$2),($3,$4)', [a, randomUUID(), b, randomUUID()]);
      const snapshot = { origin: 'KUL', destination: 'NRT' };
      await database.query(`insert into flight_booking_intents
        (id,customer_id,search_id,selected_offer_id,idempotency_key,status,currency,search_total_amount,validated_total_amount,
         selected_offer_snapshot,search_request_snapshot,expires_at)
        values ($1,$2,$3,$4,$5,'READY_FOR_PAYMENT','MYR','1180.00','1280.50',$6,$7,now()+interval '10 minutes'),
               ($8,$2,$9,$10,$11,'READY_FOR_PAYMENT','MYR','1180.00','1280.50',$6,$7,now()-interval '1 minute')`,
      [intentId, a, randomUUID(), randomUUID(), randomUUID(), JSON.stringify(snapshot), JSON.stringify(snapshot), staleId, randomUUID(), randomUUID(), randomUUID()]);
      const repository = new CommerceRepository({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection);
      const service = new CommerceService(repository);
      await expect(service.createFlightOrder(b, intentId, 'foreign')).rejects.toMatchObject({ status: 404 });
      await expect(service.createFlightOrder(a, staleId, 'stale')).rejects.toMatchObject({ status: 409 });
      await expect(service.createFlightOrder(a, intentId, 'no-pnr')).rejects.toMatchObject({ status: 409 });
      await database.query("insert into flight_bookings (booking_intent_id,customer_id,status,pnr_locator) values ($1,$2,'PNR_CREATED','TEST01')", [intentId, a]);
      const first = await service.createFlightOrder(a, intentId, 'first');
      expect(first).toMatchObject({ currency: 'MYR', totalAmount: '1280.50', status: 'PENDING_PAYMENT', payment: null });
      expect(first.items).toMatchObject([{ description: 'Flight KUL to NRT', totalAmount: '1280.50' }]);
      const same = await service.createFlightOrder(a, intentId, 'repeat');
      expect(same.id).toBe(first.id);
      expect(await service.list(b)).toEqual([]);
      await expect(service.detail(b, first.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.receipt(a, first.id)).rejects.toMatchObject({ status: 409 });
      expect((await database.query('select id from orders')).rows).toHaveLength(1);
      expect((await database.query('select id from order_items')).rows).toHaveLength(1);
      expect((await database.query('select id from commerce_outbox')).rows).toHaveLength(1);
      expect((await database.query('select id from payments')).rows).toHaveLength(0);
      const provider = { id: 'TEST_VERIFIED_ADAPTER', createCheckout: vi.fn(async () => ({
        providerPaymentId: 'provider-1', redirectUrl: 'https://provider.invalid/checkout/test' })),
        isAllowedCheckoutUrl: (url: URL) => url.hostname === 'provider.invalid',
        verifyWebhook: vi.fn(), getStatus: vi.fn() };
      const engine = new PaymentEngineService(repository, provider);
      await database.query("update flight_bookings set status = 'BOOKING_UNKNOWN' where booking_intent_id = $1", [intentId]);
      await expect(engine.start(a, first.id, randomUUID())).rejects.toMatchObject({ status: 409 });
      expect(provider.createCheckout).not.toHaveBeenCalled();
      await database.query("update flight_bookings set status = 'PNR_CREATED' where booking_intent_id = $1", [intentId]);
      const attempts = await Promise.all(Array.from({ length: 10 }, () => engine.start(a, first.id, randomUUID())));
      expect(provider.createCheckout).toHaveBeenCalledOnce();
      expect(new Set(attempts.map((attempt) => attempt.payment.id)).size).toBe(1);
      expect((await database.query('select id from payment_attempts')).rows).toHaveLength(1);
      expect((await database.query('select id from payments')).rows).toHaveLength(1);
      const paymentId = attempts[0]!.payment.id;
      expect(await repository.reconciliationCandidateIds('TEST_VERIFIED_ADAPTER')).toContain(paymentId);
      await repository.reconciliationChecked(paymentId);
      const event = { providerEventId: 'event-1', providerPaymentId: 'provider-1', status: 'SUCCEEDED' as const,
        amount: '1280.50', currency: 'MYR' };
      await expect(repository.applyVerifiedEvent('TEST_VERIFIED_ADAPTER', paymentId,
        { ...event, amount: '0.01' }, 'tampered')).rejects.toThrow();
      expect((await service.detail(a, first.id)).status).toBe('PAYMENT_PROCESSING');
      await database.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [first.id]);
      const success = await repository.applyVerifiedEvent('TEST_VERIFIED_ADAPTER', paymentId, event, 'verified');
      expect(success.status).toBe('SUCCEEDED');
      expect(await repository.reconciliationCandidateIds('TEST_VERIFIED_ADAPTER')).not.toContain(paymentId);
      await repository.applyVerifiedEvent('TEST_VERIFIED_ADAPTER', paymentId, event, 'duplicate');
      await repository.applyVerifiedEvent('TEST_VERIFIED_ADAPTER', paymentId,
        { ...event, providerEventId: 'event-late-failure', status: 'FAILED' }, 'late');
      expect(await service.detail(a, first.id)).toMatchObject({ status: 'PAID', fulfillmentStatus: 'REVALIDATION_REQUIRED' });
      expect((await service.receipt(a, first.id)).documentKind).toBe('PAYMENT_RECEIPT');
      expect((await database.query('select id from commerce_outbox')).rows).toHaveLength(2);
      expect((await database.query('select id from payment_events')).rows).toHaveLength(2);
      const ambiguousIntentId = randomUUID();
      await database.query(`insert into flight_booking_intents
        (id,customer_id,search_id,selected_offer_id,idempotency_key,status,currency,search_total_amount,validated_total_amount,
         selected_offer_snapshot,search_request_snapshot,expires_at)
        values ($1,$2,$3,$4,$5,'READY_FOR_PAYMENT','MYR','90.00','90.00',$6,$7,now()+interval '10 minutes')`,
      [ambiguousIntentId, a, randomUUID(), randomUUID(), randomUUID(), JSON.stringify(snapshot), JSON.stringify(snapshot)]);
      await database.query("insert into flight_bookings (booking_intent_id,customer_id,status,pnr_locator) values ($1,$2,'PNR_CREATED','TEST02')", [ambiguousIntentId, a]);
      const ambiguousOrder = await service.createFlightOrder(a, ambiguousIntentId, 'ambiguous');
      const uncertainProvider = { ...provider, createCheckout: vi.fn(async () => { throw new Error('timeout'); }) };
      const uncertainEngine = new PaymentEngineService(repository, uncertainProvider);
      await expect(uncertainEngine.start(a, ambiguousOrder.id, randomUUID())).rejects.toMatchObject({ status: 503 });
      const retry = await uncertainEngine.start(a, ambiguousOrder.id, randomUUID());
      expect(retry.payment).toMatchObject({ status: 'UNKNOWN', reconciliationState: 'REQUIRED' });
      expect(retry.redirectUrl).toBeNull();
      expect(uncertainProvider.createCheckout).toHaveBeenCalledOnce();
      expect(await uncertainEngine.reconcile(retry.payment.id)).toBe('STILL_PENDING');
      expect(uncertainProvider.getStatus).not.toHaveBeenCalled();
    } finally { await database.close(); }
  }, 30_000);

  it('creates a visa order from the immutable fee snapshot and marks it paid only after a verified payment event', async () => {
    const database = await migrated();
    try {
      const customerId = randomUUID();
      const tripId = randomUUID();
      const visaTypeId = randomUUID();
      const applicationId = randomUUID();
      await database.query('insert into customers (id, auth_user_id) values ($1, $2)', [customerId, randomUUID()]);
      await database.query('insert into trips (id, customer_id) values ($1, $2)', [tripId, customerId]);
      await database.query("insert into visa_types (id, destination_country_code, code, name, active) values ($1, 'JP', 'TOURIST', 'Japan visitor visa', true)", [visaTypeId]);
      await database.query(`insert into visa_applications
        (id, application_reference, customer_id, trip_id, visa_type_id, destination_country_code, status,
         submitted_at, declaration_version, declaration_accepted_at, fee_snapshot)
        values ($1, 'FSV-PAYMENTTEST', $2, $3, $4, 'JP', 'SUBMITTED', now(), 'FLYSERI_VISA_DECLARATION_V1', now(), $5)`,
      [applicationId, customerId, tripId, visaTypeId, JSON.stringify([
        { code: 'GOVERNMENT_FEE', label: 'Government fee', amount: '120.00', currency: 'MYR' },
        { code: 'SERVICE_FEE', label: 'Flyseri service fee', amount: '35.00', currency: 'MYR' },
      ])]);

      const repository = new CommerceRepository({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection);
      const order = await repository.createVisaOrder(customerId, applicationId, 'visa-order-test');
      expect(order).toMatchObject({ status: 'PENDING_PAYMENT', currency: 'MYR', totalAmount: '155.00', payment: null });
      expect(order.items.map((item) => item.totalAmount)).toEqual(['120.00', '35.00']);
      expect((await repository.createVisaOrder(customerId, applicationId, 'visa-order-repeat')).id).toBe(order.id);
      await expect(repository.createVisaOrder(randomUUID(), applicationId, 'foreign-owner')).rejects.toThrow();
      expect((await database.query<{ status: string }>('select status from visa_applications where id = $1', [applicationId])).rows[0]?.status).toBe('AWAITING_PAYMENT');

      const provider = { id: 'TEST_VERIFIED_ADAPTER', createCheckout: vi.fn(async () => ({
        providerPaymentId: 'visa-provider-payment', redirectUrl: 'https://provider.invalid/checkout/visa' })),
        isAllowedCheckoutUrl: (url: URL) => url.hostname === 'provider.invalid', verifyWebhook: vi.fn(), getStatus: vi.fn() };
      const engine = new PaymentEngineService(repository, provider);
      const checkout = await engine.start(customerId, order.id, randomUUID());
      expect(checkout.actionRequired).toBe(true);
      expect(checkout.payment.status).toBe('PENDING');
      expect(checkout.redirectUrl).toBe('https://provider.invalid/checkout/visa');
      expect((await database.query<{ status: string }>('select status from visa_applications where id = $1', [applicationId])).rows[0]?.status).toBe('PAYMENT_CONFIRMING');

      const paymentId = checkout.payment.id;
      const paymentEvent = { providerEventId: 'visa-event-verified', providerPaymentId: 'visa-provider-payment',
        status: 'SUCCEEDED' as const, amount: '155.00', currency: 'MYR' };
      await expect(repository.applyVerifiedEvent(provider.id, paymentId, { ...paymentEvent, amount: '154.99' }, 'tampered-visa-payment')).rejects.toThrow();
      expect((await database.query<{ status: string }>('select status from visa_applications where id = $1', [applicationId])).rows[0]?.status).toBe('PAYMENT_CONFIRMING');
      await repository.applyVerifiedEvent(provider.id, paymentId, paymentEvent, 'verified-visa-payment');
      expect((await database.query<{ status: string }>('select status from visa_applications where id = $1', [applicationId])).rows[0]?.status).toBe('PAID');
      expect((await repository.detail(customerId, order.id))?.status).toBe('PAID');
    } finally { await database.close(); }
  }, 30_000);
});
