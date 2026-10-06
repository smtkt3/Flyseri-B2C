import { createHmac } from 'node:crypto';
import type { AppConfig } from '@flyseri/config';
import type { DatabaseConnection } from '@flyseri/database';

export interface CrmSyncEvent { id: string; event_type: string; customer_id: string | null; resource_id: string | null; attempts: number }
export const retryDelaySeconds = (attempts: number): number => [60, 300, 900, 3600][Math.min(Math.max(attempts - 1, 0), 3)]!;

/** PostgreSQL is the queue authority. Redis availability never decides whether an event exists. */
export class CrmSyncWorker {
  constructor(private readonly database: DatabaseConnection, private readonly endpoint: string,
    private readonly secret: string, private readonly send: typeof fetch = fetch) {}

  async runOne(): Promise<'IDLE' | 'DELIVERED' | 'RETRY' | 'DEAD'> {
    await this.database.pool.query(`update crm_sync_events set status='DEAD', lease_until=null,
      last_error_category='WORKER_LEASE_EXPIRED', updated_at=now()
      where status='PROCESSING' and lease_until < now() and attempts >= 5`);
    const claim = await this.database.pool.query<CrmSyncEvent>(`update crm_sync_events set status='PROCESSING',
      attempts=attempts+1, lease_until=now()+interval '60 seconds', updated_at=now()
      where id=(select id from crm_sync_events where
        (status='PENDING' and next_attempt_at <= now()) or
        (status='PROCESSING' and lease_until < now() and attempts < 5)
        order by next_attempt_at, created_at for update skip locked limit 1)
      returning id,event_type,customer_id,resource_id,attempts`);
    const event = claim.rows[0];
    if (!event) return 'IDLE';
    const linked = event.customer_id ? await this.database.pool.query<{ crm_contact_id: string }>(
      `select crm_contact_id from crm_customer_links where customer_id=$1 and status='LINKED' limit 1`, [event.customer_id]) : null;
    const body = JSON.stringify({ eventId: event.id, eventType: event.event_type,
      customerId: event.customer_id, resourceId: event.resource_id,
      crmContactId: linked?.rows[0]?.crm_contact_id ?? null });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex');
    let errorCategory = 'NETWORK';
    try {
      const response = await this.send(this.endpoint, { method: 'POST', body,
        headers: { 'Content-Type': 'application/json', 'X-Flyseri-Timestamp': timestamp,
          'X-Flyseri-Signature': signature }, signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        await this.database.pool.query(`update crm_sync_events set status='DELIVERED', delivered_at=now(),
          lease_until=null, last_error_category=null, updated_at=now() where id=$1 and status='PROCESSING'`, [event.id]);
        return 'DELIVERED';
      }
      errorCategory = response.status >= 500 ? 'CRM_SERVER' : response.status === 401 || response.status === 403 ? 'AUTH' : 'CRM_REJECTED';
    } catch { /* The customer transaction committed before this worker began. */ }
    const dead = event.attempts >= 5;
    await this.database.pool.query(`update crm_sync_events set status=$2, lease_until=null,
      next_attempt_at=now()+($3::integer * interval '1 second'), last_error_category=$4, updated_at=now()
      where id=$1 and status='PROCESSING'`, [event.id, dead ? 'DEAD' : 'PENDING',
      retryDelaySeconds(event.attempts), errorCategory]);
    return dead ? 'DEAD' : 'RETRY';
  }
}

export function crmSyncConfigured(config: AppConfig): config is AppConfig & { CRM_SYNC_URL: string; CRM_SYNC_SHARED_SECRET: string } {
  return Boolean(config.CRM_SYNC_URL && config.CRM_SYNC_SHARED_SECRET);
}
