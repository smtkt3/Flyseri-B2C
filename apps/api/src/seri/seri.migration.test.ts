import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { SeriRepository } from './seri.repository.js';

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

describe('Seri persistence and confirmed handoff', () => {
  it('keeps customer conversations private and queues one CRM event only after a current confirmation', async () => {
    const database = await migrated();
    try {
      const customerA = randomUUID(), customerB = randomUUID();
      await database.query('insert into customers(id,auth_user_id) values($1,$2),($3,$4)', [customerA, randomUUID(), customerB, randomUUID()]);
      const connection = { db: drizzle(database, { schema }) } as unknown as DatabaseConnection;
      const repo = new SeriRepository(connection);
      const conversation = await repo.createConversation(customerA, null);
      await repo.addMessage(conversation.id, { role: 'USER', content: 'I would like a person to help with my trip.' });
      expect(await repo.messages(customerB, conversation.id)).toBeNull();
      const pending = await repo.createPendingAction({ customerId: customerA, conversationId: conversation.id, tripId: null,
        toolName: 'requestHumanSupport', args: { reason: 'Asked for a human travel advisor' }, riskLevel: 'CONFIRMATION_REQUIRED', expiresAt: new Date(Date.now() + 60_000) });
      expect(await repo.confirmPendingAction(customerB, conversation.id, pending.id)).toBeNull();
      expect(await repo.cancelPendingAction(customerB, conversation.id, pending.id)).toBeNull();
      expect(await repo.confirmPendingAction(customerA, randomUUID(), pending.id)).toBeNull();
      const executed = await repo.confirmPendingAction(customerA, conversation.id, pending.id);
      expect(executed?.status).toBe('EXECUTED');
      expect(await repo.confirmPendingAction(customerA, conversation.id, pending.id)).toBeNull();
      const events = await database.query<{ event_type: string; customer_id: string; resource_id: string }>("select event_type,customer_id,resource_id from crm_sync_events where event_type='ai.support_handoff'");
      expect(events.rows).toEqual([{ event_type: 'ai.support_handoff', customer_id: customerA, resource_id: conversation.id }]);
      const expired = await repo.createPendingAction({ customerId: customerA, conversationId: conversation.id, tripId: null,
        toolName: 'requestHumanSupport', args: { reason: 'Help' }, riskLevel: 'CONFIRMATION_REQUIRED', expiresAt: new Date(Date.now() - 1000) });
      expect(await repo.confirmPendingAction(customerA, conversation.id, expired.id)).toBeNull();
      const status = await database.query<{ status: string }>('select status from ai_pending_actions where id=$1', [expired.id]);
      expect(status.rows[0]?.status).toBe('PENDING');
      const cancelled = await repo.createPendingAction({ customerId: customerA, conversationId: conversation.id, tripId: null,
        toolName: 'requestHumanSupport', args: { reason: 'Help' }, riskLevel: 'CONFIRMATION_REQUIRED', expiresAt: new Date(Date.now() + 60_000) });
      expect((await repo.cancelPendingAction(customerA, conversation.id, cancelled.id))?.status).toBe('CANCELLED');
      expect(await repo.confirmPendingAction(customerA, conversation.id, cancelled.id)).toBeNull();
      const concurrent = await repo.createPendingAction({ customerId: customerA, conversationId: conversation.id, tripId: null,
        toolName: 'requestHumanSupport', args: { reason: 'Help' }, riskLevel: 'CONFIRMATION_REQUIRED', expiresAt: new Date(Date.now() + 60_000) });
      const confirmations = await Promise.all([
        repo.confirmPendingAction(customerA, conversation.id, concurrent.id),
        repo.confirmPendingAction(customerA, conversation.id, concurrent.id),
      ]);
      expect(confirmations.filter(Boolean)).toHaveLength(1);
      const count = await database.query<{ count: number }>("select count(*)::int as count from crm_sync_events where event_type='ai.support_handoff'");
      expect(count.rows[0]?.count).toBe(2);
    } finally { await database.close(); }
  }, 30_000);
});
