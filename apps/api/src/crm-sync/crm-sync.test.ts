import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { parseConfig } from '@flyseri/config';
import { AdminCrmService } from '../admin/admin-crm.service.js';
import { AdminRecordsService } from '../admin/admin-records.service.js';
import { CrmSyncWorker, retryDelaySeconds } from './worker.js';

async function migrated() {
  const database = new PGlite();
  await database.exec('CREATE ROLE flyseri_api');
  const directory = resolve(process.cwd(), '../../packages/database/drizzle');
  const journal = JSON.parse(readFileSync(resolve(directory, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const source = readFileSync(resolve(directory, `${entry.tag}.sql`), 'utf8');
    for (const statement of source.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) await database.exec(statement);
  }
  return database;
}

describe('CRM sync durable boundary', () => {
  it('enqueues safe references in the customer transaction, delivers once, retries outages and dead-letters', async () => {
    const database = await migrated();
    try {
      const rls = await database.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('crm_sync_events','crm_customer_links')");
      expect(rls.rows).toHaveLength(2);
      expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
      const customerId = randomUUID();
      await database.query('insert into customers(id,auth_user_id) values($1,$2)', [customerId, randomUUID()]);
      const queued = await database.query<{ event_type: string; customer_id: string }>('select event_type,customer_id from crm_sync_events');
      expect(queued.rows).toMatchObject([{ event_type: 'customer.created', customer_id: customerId }]);
      await database.query('insert into audit_events(actor_customer_id,event) values($1,$2)', [customerId, 'trip.traveller_added']);
      const activity = await new AdminRecordsService({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection)
        .customerActivity(customerId);
      expect(activity.map((row) => row.event)).toContain('trip.traveller_added');
      const send = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }));
      const worker = new CrmSyncWorker({ pool: database } as unknown as DatabaseConnection,
        'https://crm.example.invalid/api/internal/flyseri-events', 'test-secret-with-at-least-32-characters', send);
      expect(await worker.runOne()).toBe('DELIVERED');
      expect(await worker.runOne()).toBe('IDLE');
      expect(send).toHaveBeenCalledOnce();
      const body = JSON.parse(String(send.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
      expect(body).toEqual({ eventId: expect.any(String), eventType: 'customer.created',
        customerId, resourceId: customerId, crmContactId: null });
      expect(JSON.stringify(send.mock.calls[0])).not.toMatch(/password|passport|bank/i);
      const tripId = randomUUID();
      await database.exec('BEGIN');
      await database.query('insert into trips(id,customer_id,title) values($1,$2,$3)', [tripId, customerId, 'Japan trip']);
      await database.query('insert into audit_events(actor_customer_id,trip_id,event) values($1,$2,$3)',
        [customerId, tripId, 'trip.created']);
      await database.exec('COMMIT');
      const pending = await database.query<{ id: string }>(
        "select id from crm_sync_events where event_type='trip.created' and resource_id=$1", [tripId]);
      expect(pending.rows).toHaveLength(1);
      const failureId = pending.rows[0]!.id;
      const offline = new CrmSyncWorker({ pool: database } as unknown as DatabaseConnection,
        'https://crm.example.invalid/api/internal/flyseri-events', 'test-secret-with-at-least-32-characters',
        vi.fn(async () => { throw new Error('offline'); }));
      for (let attempt = 1; attempt <= 5; attempt++) {
        expect(await offline.runOne()).toBe(attempt === 5 ? 'DEAD' : 'RETRY');
        await database.query("update crm_sync_events set next_attempt_at=now()-interval '1 second' where id=$1", [failureId]);
      }
      const dead = await database.query<{ status: string; attempts: number }>('select status,attempts from crm_sync_events where id=$1', [failureId]);
      expect(dead.rows[0]).toEqual({ status: 'DEAD', attempts: 5 });
      expect((await database.query('select id from trips where id=$1', [tripId])).rows).toHaveLength(1);
      expect(retryDelaySeconds(1)).toBe(60);
      expect(retryDelaySeconds(4)).toBe(3600);
    } finally { await database.close(); }
  }, 40_000);

  it('requires verified CRM contact proof, prevents duplicate links and audits unlink without deleting customers', async () => {
    const database = await migrated();
    try {
      const customerId = randomUUID(), contactId = randomUUID(), otherId = randomUUID();
      await database.query('insert into customers(id,auth_user_id) values($1,$2),($3,$4)',
        [customerId, randomUUID(), otherId, randomUUID()]);
      const secret = 'test-secret-with-at-least-32-characters';
      const service = new AdminCrmService({ db: drizzle(database, { schema }) } as unknown as DatabaseConnection,
        parseConfig({ APP_ENV: 'test', B2C_ADMIN_SHARED_SECRET: secret }));
      const staff = { staffUserId: randomUUID(), role: 'owner' as const };
      const timestamp = String(Math.floor(Date.now() / 1000));
      const proof = `${timestamp}.${createHmac('sha256', secret).update(`crm-contact.${customerId}.${contactId}.${timestamp}`).digest('hex')}`;
      await expect(service.link(customerId, contactId, 'invalid', staff, 'bad')).rejects.toMatchObject({ status: 403 });
      expect(await service.link(customerId, contactId, proof, staff, 'first')).toEqual({ crmContactId: contactId });
      expect(await service.link(customerId, contactId, proof, staff, 'repeat')).toEqual({ crmContactId: contactId });
      expect(await service.linkForContact(contactId)).toEqual({ customerId });
      const otherProof = `${timestamp}.${createHmac('sha256', secret).update(`crm-contact.${otherId}.${contactId}.${timestamp}`).digest('hex')}`;
      await expect(service.link(otherId, contactId, otherProof, staff, 'conflict')).rejects.toMatchObject({ status: 409 });
      expect(await service.unlink(customerId, staff, 'unlink')).toEqual({ unlinked: true });
      expect(await service.linkForContact(contactId)).toBeNull();
      expect((await database.query('select id from customers')).rows).toHaveLength(2);
      expect((await database.query("select event from admin_audit_events where event like 'crm.%'")).rows).toHaveLength(2);
    } finally { await database.close(); }
  }, 40_000);
});
