import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { GuestCheckoutAttemptsService } from './guest-checkout-attempts.service.js';
import type { FlightService } from './flight.service.js';
import { AdminFlightsService } from '../admin/admin-flights.service.js';
import type { FlightTelemetry } from './flight.telemetry.js';

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

describe('guest checkout activity', () => {
  it('records a server-selected fare once for staff without storing ID documents or claiming a PNR or payment', async () => {
    const database = await migrated();
    try {
      const searchId = randomUUID(), offerId = randomUUID(), idempotencyKey = randomUUID();
      const selectedOffer = vi.fn(async () => ({ offer: { offerId, currency: 'MYR', totalAmount: '305.76',
        outbound: { segments: [{ origin: 'KUL', destination: 'PEN' }] }, inbound: null } }));
      const connection = { db: drizzle(database, { schema }) } as unknown as DatabaseConnection;
      const service = new GuestCheckoutAttemptsService(connection, { selectedOffer } as unknown as FlightService);
      const input = { searchId, offerId, idempotencyKey, contactName: 'Jane Example', contactEmail: 'JANE@example.test',
        contactPhone: '+60123456789', passengerNames: ['Jane Example'] };
      const first = await service.submit(input, null);
      const repeated = await service.submit(input, null);
      expect(repeated).toEqual(first);
      expect(selectedOffer).toHaveBeenCalledOnce();
      expect(selectedOffer).toHaveBeenCalledWith(null, searchId, offerId);
      await expect(service.submit({ ...input, contactEmail: 'other@example.test' }, null)).rejects.toThrow('already been used');

      const rows = await database.query<{ route: string; shopping_amount: string; contact_email: string }>(
        'select route,shopping_amount,contact_email from guest_flight_checkout_attempts');
      expect(rows.rows).toEqual([{ route: 'KUL → PEN', shopping_amount: '305.76', contact_email: 'jane@example.test' }]);
      const columns = await database.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'guest_flight_checkout_attempts'");
      expect(columns.rows.map((row) => row.column_name)).not.toContain('id_number');
      expect(columns.rows.map((row) => row.column_name)).not.toContain('passport_number');

      const staff = new AdminFlightsService({} as FlightTelemetry, connection, undefined);
      const activity = await staff.checkoutAttempts({ page: 1, limit: 20 });
      expect(activity.items[0]).toMatchObject({ contactName: 'Jane Example', route: 'KUL → PEN',
        status: 'DETAILS_SUBMITTED', pnr: null, paymentStatus: 'NOT_STARTED', ticketStatus: 'NOT_VERIFIED' });
      expect(JSON.stringify(activity)).not.toContain('idNumber');
    } finally { await database.close(); }
  }, 30_000);
});
