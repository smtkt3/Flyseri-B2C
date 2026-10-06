import type { SeriConversationSummary, SeriMessage, SeriTurnResponse } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const seriService = {
  async prepareSupport(input: { reason: string; bookingId?: string }): Promise<{conversationId: string; actionId: string; summary: string; expiresAt: string}> {
    return (await apiClient.post<{conversationId: string; actionId: string; summary: string; expiresAt: string}>('/seri/support-requests/prepare', input)).data;
  },
  async conversations(): Promise<SeriConversationSummary[]> { return (await apiClient.get<SeriConversationSummary[]>('/seri/conversations')).data; },
  async createConversation(tripId?: string): Promise<SeriConversationSummary> { return (await apiClient.post<SeriConversationSummary>('/seri/conversations', tripId ? { tripId } : {})).data; },
  async messages(id: string): Promise<SeriMessage[]> { return (await apiClient.get<SeriMessage[]>(`/seri/conversations/${encodeURIComponent(id)}/messages`)).data; },
  async send(id: string, message: string): Promise<SeriTurnResponse> { return (await apiClient.post<SeriTurnResponse>(`/seri/conversations/${encodeURIComponent(id)}/messages`, { message }, { timeoutMs: 60000 })).data; },
  async confirm(id: string, actionId: string): Promise<SeriMessage> { return (await apiClient.post<SeriMessage>(`/seri/conversations/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/confirm`, {})).data; },
  async cancel(id: string, actionId: string): Promise<SeriMessage> { return (await apiClient.delete<SeriMessage>(`/seri/conversations/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}`)).data; },
};
