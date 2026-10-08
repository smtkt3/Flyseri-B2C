import { afterEach, describe, expect, it, vi } from 'vitest';
import { seriService } from './seriService';
const api = vi.hoisted(() => ({ post: vi.fn(), search: vi.fn() }));
vi.mock('../lib/api/client', () => ({ apiClient: { post: api.post } }));
vi.mock('./flightService', () => ({ flightService: { search: api.search } }));
afterEach(() => vi.clearAllMocks());
const request = { origin: 'DAC', destination: 'BKK', departureDate: '2027-01-22', tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'BDT' };
describe('guest chat flight search', () => {
  it('gets prices only from the existing flight API and attaches the exact request', async () => {
    api.post.mockResolvedValue({ data: { message: { id: 'm1', role: 'ASSISTANT', content: 'Untrusted price 123', messageType: 'FLIGHT_RESULTS', payload: { flightSearchRequest: request } } } });
    api.search.mockResolvedValue({ searchId: 'real-search', offers: [{ offerId: 'real-offer' }], expiresAt: '2027-01-01T00:00:00Z' });
    const reply = await seriService.guestSend('Find flights', [], 'BDT');
    expect(api.post).toHaveBeenCalledWith('/seri/guest/messages', expect.any(Object), expect.objectContaining({ anonymous: true }));
    expect(api.search).toHaveBeenCalledOnce();
    expect(api.search).toHaveBeenCalledWith(request);
    expect(reply.message.payload).toMatchObject({ searchId: 'real-search', offers: [{ offerId: 'real-offer' }], searchRequest: request });
    expect(reply.message.content).not.toContain('123');
  });
  it('keeps a retryable request in the chat when the supplier search fails', async () => {
    api.post.mockResolvedValue({ data: { message: { id: 'm2', content: 'Checking', payload: { flightSearchRequest: request } } } });
    api.search.mockRejectedValue(new Error('Supplier unavailable'));
    const reply = await seriService.guestSend('Find flights', [], 'BDT');
    expect(reply.message.payload).toMatchObject({ searchFailed: true, offers: [], searchRequest: request });
    expect(reply.message.content).toContain('retry');
  });
  it('does not search when Seri is still asking for missing details', async () => {
    api.post.mockResolvedValue({ data: { message: { content: 'Which date?', payload: null } } });
    await seriService.guestSend('Bangkok', [], 'BDT');
    expect(api.search).not.toHaveBeenCalled();
  });
});
