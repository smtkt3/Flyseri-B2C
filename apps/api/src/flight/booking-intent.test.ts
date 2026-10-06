import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { parseConfig } from '@flyseri/config';
import type { FlightOffer } from '@flyseri/types';
import { DrizzleBookingIntentStore } from './booking-intent.repository.js';
import { BookingIntentService } from './booking-intent.service.js';
import { FlightService } from './flight.service.js';
import { FlightTelemetry } from './flight.telemetry.js';
import { FlightOfferValidationService } from './flight-offer-validation.service.js';

const offer: FlightOffer = { offerId: randomUUID(), totalAmount: '1280.50', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { durationMinutes: 420, stops: 0, segments: [{ origin: 'KUL', destination: 'NRT', departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T16:00:00+09:00', marketingCarrier: 'MH', flightNumber: '70', durationMinutes: 420 }] }, inbound: null };
const search = { origin: 'KUL', destination: 'NRT', departureDate: '2026-12-10', tripType: 'ONE_WAY' as const,
  adults: 2, children: 0, infants: 0, cabin: 'ECONOMY' as const, currency: 'MYR' };

describe('flight booking intent foundation', () => {
  it('uses owned trips and travellers, idempotency, RLS and a disabled validation boundary', async () => {
    const database = new PGlite();
  await database.exec('CREATE ROLE flyseri_api');
    try {
      const journal = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/database/drizzle/meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        const migration = readFileSync(resolve(process.cwd(), `../../packages/database/drizzle/${entry.tag}.sql`), 'utf8');
        for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) await database.exec(statement);
      }
      const rls = await database.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname in ('flight_booking_intents', 'flight_booking_intent_travellers') order by relname");
      expect(rls.rows).toEqual([{ relname: 'flight_booking_intent_travellers', relrowsecurity: true }, { relname: 'flight_booking_intents', relrowsecurity: true }]);
      const customerA = randomUUID(), customerB = randomUUID(), tripA = randomUUID();
      const travellerA1 = randomUUID(), travellerA2 = randomUUID(), travellerB = randomUUID();
      await database.query('insert into customers (id, auth_user_id) values ($1,$2),($3,$4)', [customerA, randomUUID(), customerB, randomUUID()]);
      await database.query("insert into travellers (id, legal_first_name, legal_last_name, date_of_birth) values ($1,'Ain','Rahman','1990-01-01'),($2,'Ali','Rahman','1991-01-01'),($3,'Other','Person','1992-01-01')", [travellerA1, travellerA2, travellerB]);
      await database.query("insert into customer_travellers (customer_id, traveller_id, relationship_type) values ($1,$2,'SELF'),($1,$3,'SPOUSE'),($4,$5,'SELF')", [customerA, travellerA1, travellerA2, customerB, travellerB]);
      await database.query('insert into trips (id, customer_id) values ($1,$2)', [tripA, customerA]);
      await database.query('insert into trip_travellers (trip_id, traveller_id) values ($1,$2),($1,$3)', [tripA, travellerA1, travellerA2]);
      const store = new DrizzleBookingIntentStore({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection);
      const selectedOffer = vi.fn(async () => ({ searchId: randomUUID(), tripId: tripA, search, offer }));
      const flight = { selectedOffer } as unknown as FlightService;
      const telemetry = new FlightTelemetry({ info: vi.fn() } as never);
      const service = new BookingIntentService(parseConfig({ APP_ENV: 'test' }), store, undefined, flight, telemetry, new FlightOfferValidationService(undefined));
      const input = { searchId: randomUUID(), offerId: offer.offerId, tripId: tripA, travellerIds: [travellerA1, travellerA2], idempotencyKey: randomUUID(),
        serviceRequests: [{ travellerId: travellerA1, meal: 'VEGETARIAN' as const, baggage: 'EXTRA_CHECKED' as const,
          wheelchair: 'AIRPORT' as const, assistance: 'NONE' as const, note: 'Please confirm baggage options.' }] };
      await expect(service.create(customerA, { ...input, serviceRequests: [{ ...input.serviceRequests[0]!, travellerId: travellerB }] })).rejects.toMatchObject({ status: 400 });
      await expect(service.create(customerA, { ...input, serviceRequests: [input.serviceRequests[0]!, input.serviceRequests[0]!] })).rejects.toMatchObject({ status: 400 });
      await expect(service.create(customerA, { ...input, travellerIds: [travellerA1, travellerB] })).rejects.toMatchObject({ status: 404 });
      expect((await database.query('select id from flight_booking_intents')).rows).toHaveLength(0);
      await expect(service.create(customerA, { ...input, travellerIds: [travellerA1] })).rejects.toMatchObject({ status: 400 });
      await expect(service.create(customerA, { ...input, tripId: randomUUID() })).rejects.toMatchObject({ status: 400 });
      const created = await service.create(customerA, input);
      expect(created.serviceRequests).toEqual(input.serviceRequests);
      expect((await database.query<{ service_requests: unknown }>('select service_requests from flight_booking_intents where id=$1', [created.id])).rows[0]?.service_requests).toEqual(input.serviceRequests);
      // Simulate an older writer, then reapply the migration to verify safe backfill and repeatability.
      await database.query("update flight_booking_intents set service_requests='[]'::jsonb where id=$1", [created.id]);
      await database.exec(readFileSync(resolve(process.cwd(), '../../packages/database/drizzle/0027_flight_service_requests.sql'), 'utf8'));
      expect((await database.query<{ service_requests: unknown }>('select service_requests from flight_booking_intents where id=$1', [created.id])).rows[0]?.service_requests).toEqual(input.serviceRequests);
      await expect(service.create(customerA, { ...input, serviceRequests: [] })).rejects.toMatchObject({ status: 409 });
      expect(created).toMatchObject({ status: 'CREATED', searchTotalAmount: '1280.50', validatedTotalAmount: null, travellerIds: input.travellerIds });
      const retries = await Promise.all(Array.from({ length: 10 }, () => service.create(customerA, input)));
      expect(retries.every((retry) => retry.id === created.id)).toBe(true);
      expect((await database.query('select id from flight_booking_intents')).rows).toHaveLength(1);
      expect((await database.query('select id from flight_booking_intent_travellers')).rows).toHaveLength(2);
      expect((await database.query<{ passenger_type: string }>('select passenger_type from flight_booking_intent_travellers')).rows.every((person) => person.passenger_type === 'ADT')).toBe(true);
      expect(await store.list(customerA, tripA)).toHaveLength(1);
      expect(await store.list(customerB, tripA)).toHaveLength(0);
      await expect(service.create(customerA, { ...input, offerId: randomUUID() })).rejects.toMatchObject({ status: 409 });
      await expect(service.detail(customerB, created.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.validate(customerB, created.id, 'test')).rejects.toMatchObject({ status: 404 });
      await expect(service.cancel(customerB, created.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.validate(customerA, created.id, 'test')).rejects.toMatchObject({ status: 503 });
      expect((await service.detail(customerA, created.id)).status).toBe('CREATED');
      const repriced = await store.saveValidation(customerA, created.id, { result: 'AVAILABLE', currentTotalAmount: '1300.00', currency: 'MYR',
        itinerary: { outbound: offer.outbound, inbound: null }, validatedAt: new Date().toISOString() }, 180);
      expect(repriced).toMatchObject({ status: 'PRICE_CHANGED', validatedTotalAmount: '1300.00', priceChanged: true });
      expect(await store.saveValidation(customerB, created.id, { result: 'UNAVAILABLE', validatedAt: new Date().toISOString() }, 180)).toBeNull();
      expect(await store.confirmPrice(customerB, created.id)).toBeNull();
      expect((await store.confirmPrice(customerA, created.id))?.status).toBe('READY_FOR_PAYMENT');
      await expect(store.confirmPrice(customerA, created.id)).rejects.toThrow();
      const unchanged = await store.saveValidation(customerA, created.id, { result: 'AVAILABLE', currentTotalAmount: '1280.5', currency: 'MYR',
        itinerary: { outbound: offer.outbound, inbound: null }, validatedAt: new Date().toISOString() }, 180);
      expect(unchanged).toMatchObject({ status: 'READY_FOR_PAYMENT', priceChanged: false });
      const decreased = await store.saveValidation(customerA, created.id, { result: 'AVAILABLE', currentTotalAmount: '1200.00', currency: 'MYR',
        itinerary: { outbound: offer.outbound, inbound: null }, validatedAt: new Date().toISOString() }, 180);
      expect(decreased).toMatchObject({ status: 'PRICE_CHANGED', validatedTotalAmount: '1200.00', priceChanged: true });
      await store.saveValidation(customerA, created.id, { result: 'UNAVAILABLE', validatedAt: new Date().toISOString() }, 180);
      expect((await store.detail(customerA, created.id))?.status).toBe('FAILED');
      await store.saveValidation(customerA, created.id, { result: 'AVAILABLE', currentTotalAmount: '1280.50', currency: 'MYR',
        itinerary: { outbound: offer.outbound, inbound: null }, validatedAt: new Date(Date.now() - 120000).toISOString() }, 30);
      expect((await service.detail(customerA, created.id)).status).toBe('EXPIRED');
      const validateSupplier = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { result: 'AVAILABLE' as const, currentTotalAmount: '1280.50', currency: 'MYR',
          itinerary: { outbound: offer.outbound, inbound: null }, validatedAt: new Date().toISOString() };
      });
      const readyService = new BookingIntentService(parseConfig({ APP_ENV: 'test' }), store, undefined, flight, telemetry,
        new FlightOfferValidationService({ validate: validateSupplier }));
      const concurrent = await Promise.allSettled([readyService.validate(customerA, created.id, 'one'), readyService.validate(customerA, created.id, 'two')]);
      expect(validateSupplier).toHaveBeenCalledOnce();
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await readyService.detail(customerA, created.id)).status).toBe('READY_FOR_PAYMENT');
      const cancelled = await service.cancel(customerA, created.id);
      expect(cancelled.status).toBe('CANCELLED');
      expect((await service.cancel(customerA, created.id)).id).toBe(created.id);
      const events = await database.query<{ event: string }>("select event from audit_events where event like 'flight.%' order by created_at");
      expect(events.rows.map((item) => item.event)).toEqual(['flight.booking_intent.created', 'flight.booking_intent.price_changed',
        'flight.booking_intent.price_accepted', 'flight.booking_intent.validated', 'flight.booking_intent.price_changed',
        'flight.booking_intent.validation_failed', 'flight.booking_intent.validated', 'flight.booking_intent.validated', 'flight.booking_intent.cancelled']);
    } finally { await database.close(); }
  }, 30_000);
});
