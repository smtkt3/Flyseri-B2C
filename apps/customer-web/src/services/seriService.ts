import type { FlightSearchRequest, SeriConversationSummary, SeriMessage, SeriTurnResponse } from '@flyseri/types';
import { preferredLanguage } from '../travel/language';
import { apiClient } from '../lib/api/client';
import { flightService } from './flightService';

export const seriService = {
  async guestSend(message: string, history: { role: 'USER' | 'ASSISTANT'; content: string }[], currency: string): Promise<{ message: SeriMessage }> {
    const reply = (await apiClient.post<{ message: SeriMessage }>('/seri/guest/messages', { message, history: history.slice(-12), currency, language: preferredLanguage() }, { anonymous: true, timeoutMs: 60000 })).data;
    const request = reply.message.payload?.flightSearchRequest as FlightSearchRequest | undefined;
    if (!request) return reply;
    // Use the public, rate-limited search endpoint. The AI never supplies fares.
    try {
      const result = await flightService.search(request);
      return { message: { ...reply.message, content: `${request.origin} → ${request.destination} · ${request.departureDate}${request.returnDate ? ` · Return ${request.returnDate}` : ''}. ${result.offers.length ? 'Here are your flight options.' : 'No flights found. Try another date or airport.'}`, payload: { ...result, searchRequest: request } } };
    } catch {
      return { message: { ...reply.message, content: 'I could not check airline availability just now. You can retry this search below.', payload: { searchId: 'unavailable', offers: [], expiresAt: new Date(0).toISOString(), searchRequest: request, searchFailed: true } } };
    }
  },
  async prepareSupport(input: { reason: string; bookingId?: string; conversationId?: string }): Promise<{conversationId: string; actionId: string; summary: string; expiresAt: string}> {
    return (await apiClient.post<{conversationId: string; actionId: string; summary: string; expiresAt: string}>('/seri/support-requests/prepare', input)).data;
  },
  async conversations(): Promise<SeriConversationSummary[]> { return (await apiClient.get<SeriConversationSummary[]>('/seri/conversations')).data; },
  async createConversation(tripId?: string): Promise<SeriConversationSummary> { return (await apiClient.post<SeriConversationSummary>('/seri/conversations', tripId ? { tripId } : {})).data; },
  async messages(id: string): Promise<SeriMessage[]> { return (await apiClient.get<SeriMessage[]>(`/seri/conversations/${encodeURIComponent(id)}/messages`)).data; },
  async send(id: string, message: string): Promise<SeriTurnResponse> { return (await apiClient.post<SeriTurnResponse>(`/seri/conversations/${encodeURIComponent(id)}/messages`, { message, language: preferredLanguage() }, { timeoutMs: 60000 })).data; },
  async confirm(id: string, actionId: string): Promise<SeriMessage> { return (await apiClient.post<SeriMessage>(`/seri/conversations/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/confirm`, {})).data; },
  async cancel(id: string, actionId: string): Promise<SeriMessage> { return (await apiClient.delete<SeriMessage>(`/seri/conversations/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}`)).data; },
};
