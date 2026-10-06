import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { BookingReservationRepository } from './booking-reservation.repository.js';
import { DrizzleBookingIntentStore } from './booking-intent.repository.js';
import { AdminFlightsService } from '../admin/admin-flights.service.js';
import type { FlightTelemetry } from './flight.telemetry.js';
import type { SabreBookingManagementClient } from './sabre-booking-management.client.js';

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

describe('Sabre reservation claim', () => {
  it('claims a fresh validated intent once and preserves an unknown result for reconciliation', async () => {
    const database = await migrated();
    try {
      const customerId = randomUUID(), other = randomUUID(), intentId = randomUUID(), expired = randomUUID();
      await database.query('insert into customers (id,auth_user_id) values ($1,$2),($3,$4)', [customerId, randomUUID(), other, randomUUID()]);
      await database.query(`insert into flight_booking_intents
        (id,customer_id,search_id,selected_offer_id,idempotency_key,status,currency,search_total_amount,validated_total_amount,
         selected_offer_snapshot,search_request_snapshot,expires_at)
        values ($1,$2,$3,$4,$5,'READY_FOR_PAYMENT','MYR','100.00','100.00','{}','{}',now()+interval '10 minutes'),
               ($6,$2,$7,$8,$9,'READY_FOR_PAYMENT','MYR','100.00','100.00','{}','{}',now()-interval '1 minute')`,
      [intentId, customerId, randomUUID(), randomUUID(), randomUUID(), expired, randomUUID(), randomUUID(), randomUUID()]);
      const repository = new BookingReservationRepository({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection);
      await expect(repository.claim(other, intentId)).rejects.toThrow();
      await expect(repository.claim(customerId, expired)).rejects.toThrow('fare must be validated');
      const id = await repository.claim(customerId, intentId);
      await expect(repository.claim(customerId, intentId)).rejects.toThrow('already has a booking attempt');
      await repository.unknown(id);
      await expect(repository.created(id, 'ABC123', 'booking-1')).rejects.toThrow('cannot be applied');
      await expect(repository.claim(customerId, intentId)).rejects.toThrow('already has a booking attempt');
      const rows = await database.query<{ status: string; pnr_locator: string | null }>('select status,pnr_locator from flight_bookings');
      expect(rows.rows).toEqual([{ status: 'BOOKING_UNKNOWN', pnr_locator: null }]);
    } finally { await database.close(); }
  }, 30_000);

  it('records a PNR only once after a claimed attempt', async () => {
    const database = await migrated();
    try {
      const customerId = randomUUID(), intentId = randomUUID();
      await database.query('insert into customers (id,auth_user_id) values ($1,$2)', [customerId, randomUUID()]);
      await database.query(`insert into flight_booking_intents
        (id,customer_id,search_id,selected_offer_id,idempotency_key,status,currency,search_total_amount,validated_total_amount,
         selected_offer_snapshot,search_request_snapshot,expires_at)
        values ($1,$2,$3,$4,$5,'READY_FOR_PAYMENT','MYR','100.00','100.00','{}','{}',now()+interval '10 minutes')`,
      [intentId, customerId, randomUUID(), randomUUID(), randomUUID()]);
      const repository = new BookingReservationRepository({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection);
      const id = await repository.claim(customerId, intentId);
      const intents = new DrizzleBookingIntentStore({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection);
      await expect(intents.cancel(customerId, intentId)).rejects.toThrow();
      await expect(intents.confirmPrice(customerId, intentId)).rejects.toThrow();
      await repository.created(id, 'ABC123', 'booking-1');
      await expect(repository.created(id, 'DEF456', 'booking-2')).rejects.toThrow('cannot be applied');
      await expect(repository.unknown(id)).rejects.toThrow('cannot be applied');
      const getBookingView = vi.fn(async (locator: string) => {
        expect(locator).toBe('ABC123');
        return { bookingId: 'booking-1', view: { retrievedAt: new Date().toISOString(), flights: [], tickets: [], travellers: [], cancellationCheckComplete: false } };
      });
      const staff = new AdminFlightsService({ increment: vi.fn() } as unknown as FlightTelemetry,
        { db: drizzle(database, { schema }) } as unknown as DatabaseConnection,
        { getBookingView } as unknown as SabreBookingManagementClient);
      const refreshed = await staff.refresh(id, { staffUserId: randomUUID(), role: 'ticketing_staff' }, 'test-request');
      expect(refreshed).toMatchObject({ pnr: 'ABC123', status: 'PNR_CREATED', ticketStatus: 'NOT_VERIFIED' });
      expect(refreshed.lastSabreRefreshAt).toBeTruthy();
      expect(getBookingView).toHaveBeenCalledOnce();
      const rows = await database.query<{ status: string; pnr_locator: string }>('select status,pnr_locator from flight_bookings');
      expect(rows.rows).toEqual([{ status: 'PNR_CREATED', pnr_locator: 'ABC123' }]);
    } finally { await database.close(); }
  }, 30_000);
});
