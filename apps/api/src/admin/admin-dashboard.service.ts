import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNotNull, isNull, desc, or, sql } from 'drizzle-orm';
import { auditEvents, customers, documents, orders, payments, crmSyncEvents, trips, visaApplications, aiConversations, aiPendingActions, aiToolCalls, aiUsageEvents, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { DATABASE_CONNECTION } from '../tokens.js';
import { REDIS_STORE } from '../tokens.js';
import type { RedisStore } from '@flyseri/redis';

@Injectable()
export class AdminDashboardService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Optional() @Inject(REDIS_STORE) private readonly redis?: RedisStore) {}
  async summary() {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503);
    const db = this.connection.db;
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const [customerCount, newCustomers, activeTrips, visaAction, visaStatusRows, visaSubmitted, documentReview, recent,
      ordersToday, pendingPayments, successfulPayments, reconciliationRequired, failedSync] = await Promise.all([
      db.select({ count: count() }).from(customers).where(eq(customers.status, 'ACTIVE')),
      db.select({ count: count() }).from(customers).where(gte(customers.createdAt, last24Hours)),
      db.select({ count: count() }).from(trips).where(and(eq(trips.status, 'ACTIVE'), isNull(trips.archivedAt))),
      db.select({ count: count() }).from(visaApplications).where(and(
        inArray(visaApplications.status, ['DOCUMENTS_SUBMITTED', 'PAID', 'DOCUMENT_REVIEW', 'ADDITIONAL_DOCUMENTS_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED']),
        isNull(visaApplications.archivedAt))),
      db.select({ status: visaApplications.status, count: count() }).from(visaApplications)
        .where(isNull(visaApplications.archivedAt)).groupBy(visaApplications.status),
      db.select({ count: count() }).from(visaApplications).where(and(isNull(visaApplications.archivedAt),
        or(isNotNull(visaApplications.submittedAt), eq(visaApplications.status, 'DOCUMENTS_SUBMITTED')))),
      db.select({ count: count() }).from(documents).where(and(eq(documents.status, 'REVIEW_REQUIRED'), isNull(documents.archivedAt))),
      db.select({ event: auditEvents.event, createdAt: auditEvents.createdAt }).from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(8),
      db.select({ count: count() }).from(orders).where(gte(orders.createdAt, today)),
      db.select({ count: count() }).from(payments).where(sql`${payments.status} in ('CREATED','PENDING','PROCESSING','UNKNOWN')`),
      db.select({ count: count() }).from(payments).where(eq(payments.status, 'SUCCEEDED')),
      db.select({ count: count() }).from(payments).where(eq(payments.reconciliationState, 'REQUIRED')),
      db.select({ count: count() }).from(crmSyncEvents).where(eq(crmSyncEvents.status, 'DEAD')),
    ]);
    const visaCounts = Object.fromEntries(visaStatusRows.map((item) => [item.status, item.count])) as Record<string, number>;
    const visaCount = (...statuses: string[]) => statuses.reduce((total, status) => total + (visaCounts[status] ?? 0), 0);
    return {
      metrics: {
        customers: customerCount[0]?.count ?? 0,
        newCustomersLast24Hours: newCustomers[0]?.count ?? 0,
        activeTrips: activeTrips[0]?.count ?? 0,
        visaApplicationsSubmitted: visaSubmitted[0]?.count ?? visaCount('DOCUMENTS_SUBMITTED'),
        visa: {
          awaitingPayment: visaCount('AWAITING_PAYMENT', 'PAYMENT_CONFIRMING', 'PAYMENT_FAILED'),
          paid: visaCount('PAID'),
          documentReview: visaCount('DOCUMENT_REVIEW'),
          actionRequired: visaCount('ADDITIONAL_DOCUMENTS_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED'),
          submittedForProcessing: visaCount('SUBMITTED_TO_EMBASSY_OR_AUTHORITY', 'UNDER_PROCESSING'),
          approvedOrIssued: visaCount('APPROVED', 'VISA_ISSUED'),
          rejected: visaCount('REJECTED'),
          completed: visaCount('COMPLETED'),
        },
        documentsRequiringReview: documentReview[0]?.count ?? 0,
        ordersToday: ordersToday[0]?.count ?? 0,
        pendingPayments: pendingPayments[0]?.count ?? 0,
        successfulPayments: successfulPayments[0]?.count ?? 0,
        paymentReconciliationRequired: reconciliationRequired[0]?.count ?? 0,
        failedCrmSync: failedSync[0]?.count ?? 0,
      },
      needsAttention: [
        { key: 'visa', count: visaAction[0]?.count ?? 0, label: 'Visa applications awaiting staff processing', href: '/b2c-admin/visa' },
        { key: 'documents', count: documentReview[0]?.count ?? 0, label: 'Documents marked for review', href: '/b2c-admin/documents' },
      ].filter((item) => item.count > 0),
      recentActivity: recent.map((row) => ({ event: row.event, createdAt: row.createdAt.toISOString() })),
    };
  }

  async aiMetrics() {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const db = this.connection.db;
    const [conversationRows, usage, tools, pendingActions, rateLimitedRequests] = await Promise.all([
      db.select({ count: count() }).from(aiConversations).where(gte(aiConversations.createdAt, today)),
      db.select().from(aiUsageEvents).where(gte(aiUsageEvents.createdAt, today)),
      db.select().from(aiToolCalls).where(gte(aiToolCalls.createdAt, today)),
      db.select().from(aiPendingActions).where(gte(aiPendingActions.createdAt, today)),
      this.redis?.readCounter('metrics:ai_rate_limited_total') ?? Promise.resolve(null),
    ]);
    const total = usage.length;
    return {
      conversationsToday: conversationRows[0]?.count ?? 0, requests: total,
      deterministicResponses: usage.filter((item) => item.requestKind === 'DETERMINISTIC').length,
      llmRequests: usage.filter((item) => item.requestKind === 'LLM').length,
      primaryRequests: usage.filter((item) => item.providerTier === 'PRIMARY').length,
      fallbackRequests: usage.filter((item) => item.providerTier === 'FALLBACK').length,
      toolCalls: tools.length, toolFailures: tools.filter((item) => item.status === 'FAILED').length,
      averageLatencyMs: total ? Math.round(usage.reduce((sum, item) => sum + item.latencyMs, 0) / total) : 0,
      inputTokens: usage.some((item) => item.inputTokens !== null) ? usage.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0) : null,
      outputTokens: usage.some((item) => item.outputTokens !== null) ? usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0) : null,
      confirmationsCreated: pendingActions.length,
      confirmationsExecuted: pendingActions.filter((item) => item.status === 'EXECUTED').length,
      supportHandoffs: tools.filter((item) => item.toolName === 'requestHumanSupport').length,
      rateLimitedRequests,
      privateMessageContentIncluded: false, pricingConfigured: false,
    };
  }
}
