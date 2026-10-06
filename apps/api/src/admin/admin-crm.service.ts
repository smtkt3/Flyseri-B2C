import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { adminAuditEvents, crmCustomerLinks, crmSyncEvents, customers, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DATABASE_CONNECTION } from '../tokens.js';
import type { AdminIdentity } from './admin-auth.js';

@Injectable()
export class AdminCrmService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  private get db() {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503);
    return this.connection.db;
  }
  async linkForCustomer(customerId: string) {
    const [row] = await this.db.select({ crmContactId: crmCustomerLinks.crmContactId, linkedAt: crmCustomerLinks.linkedAt })
      .from(crmCustomerLinks).where(and(eq(crmCustomerLinks.customerId, customerId), eq(crmCustomerLinks.status, 'LINKED'))).limit(1);
    return row ? { crmContactId: row.crmContactId, linkedAt: row.linkedAt.toISOString() } : null;
  }
  async linkForContact(contactId: string) {
    const [row] = await this.db.select({ customerId: crmCustomerLinks.customerId }).from(crmCustomerLinks)
      .where(and(eq(crmCustomerLinks.crmContactId, contactId), eq(crmCustomerLinks.status, 'LINKED'))).limit(1);
    return row ?? null;
  }
  async link(customerId: string, contactId: string, contactProof: string, staff: AdminIdentity, requestId: string) {
    const secret = this.config.B2C_ADMIN_SHARED_SECRET;
    const [timestamp, signature] = contactProof.split('.');
    if (!secret || !timestamp || !signature || !/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature) ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 60) {
      throw new ApiException('FORBIDDEN', 'CRM contact verification is required.', 403);
    }
    const expected = createHmac('sha256', secret).update(`crm-contact.${customerId}.${contactId}.${timestamp}`).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      throw new ApiException('FORBIDDEN', 'CRM contact verification is required.', 403);
    }
    return this.db.transaction(async (tx) => {
      const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for('update').limit(1);
      if (!customer) throw new ApiException('NOT_FOUND', 'Customer not found.', 404);
      const existing = await tx.select({ customerId: crmCustomerLinks.customerId, crmContactId: crmCustomerLinks.crmContactId })
        .from(crmCustomerLinks).where(and(eq(crmCustomerLinks.status, 'LINKED'),
          sql`(${crmCustomerLinks.customerId} = ${customerId} or ${crmCustomerLinks.crmContactId} = ${contactId})`));
      if (existing.length) {
        if (existing.length === 1 && existing[0]!.customerId === customerId && existing[0]!.crmContactId === contactId) return { crmContactId: contactId };
        throw new ApiException('CONFLICT', 'This customer or CRM contact is already linked.', 409);
      }
      await tx.insert(crmCustomerLinks).values({ customerId, crmContactId: contactId, linkedByStaffId: staff.staffUserId });
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
        event: 'crm.customer.linked', resourceType: 'CUSTOMER', resourceId: customerId, requestId });
      return { crmContactId: contactId };
    });
  }
  async unlink(customerId: string, staff: AdminIdentity, requestId: string) {
    return this.db.transaction(async (tx) => {
      const [changed] = await tx.update(crmCustomerLinks).set({ status: 'UNLINKED', unlinkedAt: new Date() })
        .where(and(eq(crmCustomerLinks.customerId, customerId), eq(crmCustomerLinks.status, 'LINKED'))).returning({ id: crmCustomerLinks.id });
      if (!changed) throw new ApiException('NOT_FOUND', 'No CRM link exists.', 404);
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
        event: 'crm.customer.unlinked', resourceType: 'CUSTOMER', resourceId: customerId, requestId });
      return { unlinked: true };
    });
  }
  async status() {
    const [counts, latest] = await Promise.all([
      this.db.select({ status: crmSyncEvents.status, total: count() }).from(crmSyncEvents).groupBy(crmSyncEvents.status),
      this.db.select({ deliveredAt: crmSyncEvents.deliveredAt }).from(crmSyncEvents)
        .where(eq(crmSyncEvents.status, 'DELIVERED')).orderBy(desc(crmSyncEvents.deliveredAt)).limit(1),
    ]);
    const byStatus = Object.fromEntries(counts.map((item) => [item.status, item.total]));
    return { pending: (byStatus.PENDING ?? 0) + (byStatus.PROCESSING ?? 0), failed: byStatus.DEAD ?? 0,
      delivered: byStatus.DELIVERED ?? 0, lastSuccessfulSync: latest[0]?.deliveredAt?.toISOString() ?? null };
  }
  async failures() {
    const rows = await this.db.select({ id: crmSyncEvents.id, eventType: crmSyncEvents.eventType,
      resourceId: crmSyncEvents.resourceId, attempts: crmSyncEvents.attempts,
      lastErrorCategory: crmSyncEvents.lastErrorCategory, updatedAt: crmSyncEvents.updatedAt })
      .from(crmSyncEvents).where(eq(crmSyncEvents.status, 'DEAD')).orderBy(desc(crmSyncEvents.updatedAt)).limit(50);
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  }
  async retry(id: string, staff: AdminIdentity, requestId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(crmSyncEvents).set({ status: 'PENDING', attempts: 0,
        nextAttemptAt: new Date(), leaseUntil: null, lastErrorCategory: null, updatedAt: new Date() })
        .where(and(eq(crmSyncEvents.id, id), eq(crmSyncEvents.status, 'DEAD'))).returning({ id: crmSyncEvents.id });
      if (!row) throw new ApiException('CONFLICT', 'This event is not awaiting retry.', 409);
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
        event: 'crm.sync.retry', resourceType: 'CRM_SYNC_EVENT', resourceId: id, requestId });
      return { queued: true };
    });
  }
}
