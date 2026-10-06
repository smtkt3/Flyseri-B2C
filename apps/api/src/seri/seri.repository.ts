import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { aiConversations, aiMessages, aiPendingActions, aiToolCalls, aiUsageEvents, crmSyncEvents, type DatabaseConnection } from '@flyseri/database';
import type { SeriConversationSummary, SeriMessage } from '@flyseri/types';

const conversationDto = (row: typeof aiConversations.$inferSelect): SeriConversationSummary => ({
  id: row.id, tripId: row.tripId, title: null, createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(), lastMessageAt: row.lastMessageAt.toISOString(),
});
const messageDto = (row: typeof aiMessages.$inferSelect): SeriMessage => ({
  id: row.id, role: row.role as SeriMessage['role'], content: row.content,
  messageType: row.messageType as SeriMessage['messageType'], payload: row.payload,
  createdAt: row.createdAt.toISOString(),
});

export class SeriRepository {
  constructor(private readonly connection: DatabaseConnection | undefined) {}
  private db() { if (!this.connection) throw new Error('AI conversation storage unavailable'); return this.connection.db; }
  async createConversation(customerId: string, tripId: string | null) {
    const [row] = await this.db().insert(aiConversations).values({ customerId, tripId }).returning();
    return conversationDto(row!);
  }
  async listConversations(customerId: string) {
    return (await this.db().select().from(aiConversations).where(eq(aiConversations.customerId, customerId)).orderBy(desc(aiConversations.lastMessageAt)).limit(30)).map(conversationDto);
  }
  async getConversation(customerId: string, id: string) {
    const [row] = await this.db().select().from(aiConversations).where(and(eq(aiConversations.customerId, customerId), eq(aiConversations.id, id))).limit(1);
    return row ? conversationDto(row) : null;
  }
  async messages(customerId: string, conversationId: string, limit = 40) {
    if (!await this.getConversation(customerId, conversationId)) return null;
    const rows = await this.db().select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(desc(aiMessages.createdAt)).limit(limit);
    return rows.reverse().map(messageDto);
  }
  async addMessage(conversationId: string, input: { role: 'USER' | 'ASSISTANT'; content: string; messageType?: string; payload?: Record<string, unknown> | null }) {
    const [row] = await this.db().transaction(async (tx) => {
      const [message] = await tx.insert(aiMessages).values({ conversationId, role: input.role, content: input.content,
        messageType: input.messageType ?? 'TEXT', payload: input.payload ?? null }).returning();
      await tx.update(aiConversations).set({ updatedAt: new Date(), lastMessageAt: new Date() }).where(eq(aiConversations.id, conversationId));
      return [message!];
    });
    return messageDto(row!);
  }
  async recordToolCall(conversationId: string, toolName: string, status: 'SUCCEEDED' | 'FAILED', durationMs: number, requestId: string) {
    await this.db().insert(aiToolCalls).values({ conversationId, toolName, riskLevel: 'READ_ONLY', status, durationMs, requestId });
  }
  async recordUsage(input: { customerId: string; conversationId: string; requestId: string; provider: string | null; providerTier?: 'PRIMARY' | 'FALLBACK' | null; model: string | null; kind: 'DETERMINISTIC' | 'LLM'; inputTokens?: number | null; outputTokens?: number | null; latencyMs: number; success: boolean; promptVersion: string }) {
    await this.db().insert(aiUsageEvents).values({ customerId: input.customerId, conversationId: input.conversationId, requestId: input.requestId,
      provider: input.provider, providerTier: input.providerTier ?? null, model: input.model, requestKind: input.kind, inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null, latencyMs: input.latencyMs, success: input.success, promptVersion: input.promptVersion });
  }
  async metrics(now = new Date()) {
    const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
    const [todayRows, usage, calls, handoffs] = await Promise.all([
      this.db().select().from(aiConversations).where(gt(aiConversations.createdAt, today)),
      this.db().select().from(aiUsageEvents).where(gt(aiUsageEvents.createdAt, today)),
      this.db().select().from(aiToolCalls).where(gt(aiToolCalls.createdAt, today)),
      this.db().select().from(aiToolCalls).where(and(gt(aiToolCalls.createdAt, today), eq(aiToolCalls.toolName, 'requestHumanSupport'))),
    ]);
    const sum = (items: typeof usage, field: 'inputTokens' | 'outputTokens') => items.reduce((n, row) => n + (row[field] ?? 0), 0);
    const tokensKnown = usage.some((row) => row.inputTokens !== null || row.outputTokens !== null);
    return { conversationsToday: todayRows.length, requests: usage.length,
      deterministicResponses: usage.filter((row) => row.requestKind === 'DETERMINISTIC').length,
      llmRequests: usage.filter((row) => row.requestKind === 'LLM').length,
      primaryRequests: usage.filter((row) => row.requestKind === 'LLM').length,
      fallbackRequests: 0, toolCalls: calls.length,
      toolFailures: calls.filter((row) => row.status === 'FAILED').length,
      averageLatencyMs: usage.length ? Math.round(usage.reduce((n, row) => n + row.latencyMs, 0) / usage.length) : 0,
      inputTokens: tokensKnown ? sum(usage, 'inputTokens') : null, outputTokens: tokensKnown ? sum(usage, 'outputTokens') : null,
      supportHandoffs: handoffs.length };
  }
  async createPendingAction(input: { customerId: string; conversationId: string; tripId: string | null; toolName: string; args: Record<string, unknown>; riskLevel: string; expiresAt: Date }) {
    const [row] = await this.db().insert(aiPendingActions).values({ ...input, validatedArguments: input.args }).returning();
    return row!;
  }
  async confirmPendingAction(customerId: string, conversationId: string, actionId: string) {
    return this.db().transaction(async (tx) => {
      const [row] = await tx.update(aiPendingActions).set({ status: 'EXECUTED', confirmedAt: new Date() })
        .where(and(eq(aiPendingActions.id, actionId), eq(aiPendingActions.customerId, customerId), eq(aiPendingActions.conversationId, conversationId), eq(aiPendingActions.toolName, 'requestHumanSupport'), eq(aiPendingActions.status, 'PENDING'), gt(aiPendingActions.expiresAt, new Date())))
        .returning();
      if (!row) return null;
      await tx.insert(crmSyncEvents).values({ eventType: 'ai.support_handoff', customerId, resourceId: conversationId });
      return row;
    });
  }
  async cancelPendingAction(customerId: string, conversationId: string, actionId: string) {
    const rows = await this.db().update(aiPendingActions).set({ status: 'CANCELLED' })
      .where(and(eq(aiPendingActions.id, actionId), eq(aiPendingActions.customerId, customerId), eq(aiPendingActions.conversationId, conversationId), inArray(aiPendingActions.status, ['PENDING', 'CONFIRMED'])))
      .returning();
    return rows[0] ?? null;
  }
}
