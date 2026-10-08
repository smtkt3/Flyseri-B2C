import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@flyseri/config';
import { GuestSeriService } from './guest-seri.service.js';

function setup() {
  const provider = { name: 'GEMINI' as const, generate: vi.fn().mockResolvedValue({ text: 'Where would you like to travel?', calls: [], inputTokens: 10, outputTokens: 10 }) };
  const redis = { consumeRateLimit: vi.fn().mockResolvedValue('allowed') };
  const config = parseConfig({ APP_ENV: 'test', SERI_AI_ENABLED: 'true' });
  return { provider, redis, config, service: new GuestSeriService(config, provider, redis as never) };
}
describe('guest Seri', () => {
  it('replies without a customer record and provides no account tools to the model', async () => {
    const { service, provider, redis } = setup();
    const result = await service.send({ message: 'November', history: [{ role: 'USER', content: 'Plan a trip from Dhaka' }, { role: 'ASSISTANT', content: 'What month?' }], currency: 'BDT' }, '127.0.0.1');
    expect(result.message.role).toBe('ASSISTANT');
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ name: 'prepareFlightSearch' })], contents: expect.arrayContaining([expect.objectContaining({ role: 'user', parts: [{ text: 'November' }] })]) }));
    expect(redis.consumeRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^seri:guest:[a-f0-9]{64}$/), 12, 60);
  });
  it('rejects rate-limited guests before calling the model', async () => {
    const { service, provider, redis } = setup(); redis.consumeRateLimit.mockResolvedValue('limited');
    await expect(service.send({ message: 'Hello', history: [] }, '127.0.0.1')).rejects.toMatchObject({ status: 429 });
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('does not permit guest function calls and returns a safe provider error', async () => {
    const { service, provider } = setup(); provider.generate.mockResolvedValue({ text: 'Done', calls: [{ name: 'getMyOrders', args: {} }] });
    await expect(service.send({ message: 'My orders', history: [] }, '127.0.0.1')).rejects.toMatchObject({ status: 503 });
  });
  it('keeps production closed if shared rate limiting is unavailable', async () => {
    const { config, provider } = setup();
    const service = new GuestSeriService({ ...config, APP_ENV: 'production' }, provider, undefined);
    await expect(service.send({ message: 'Hello', history: [] }, '127.0.0.1')).rejects.toMatchObject({ status: 503 });
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('prepares only a validated public flight request, without inventing fares', async () => {
    const { service, provider } = setup();
    const request = { origin: 'DAC', destination: 'BKK', departureDate: '2027-01-22', tripType: 'ONE_WAY', adults: 2, children: 1, infants: 0, cabin: 'ECONOMY', currency: 'BDT' };
    provider.generate.mockResolvedValue({ text: 'Made up fare 100', calls: [{ name: 'prepareFlightSearch', args: request }] });
    const result = await service.send({ message: 'Find flights', history: [] }, '127.0.0.1');
    expect(result.message.payload).toEqual({ flightSearchRequest: request });
    expect(result.message.content).not.toContain('100');
  });
  it('asks for corrected details when return dates or passenger counts are invalid', async () => {
    const { service, provider } = setup();
    provider.generate.mockResolvedValue({ text: '', calls: [{ name: 'prepareFlightSearch', args: { origin: 'DAC', destination: 'BKK', departureDate: '2027-01-22', tripType: 'ROUND_TRIP', adults: 1, children: 0, infants: 2, cabin: 'ECONOMY', currency: 'BDT' } }] });
    const result = await service.send({ message: 'Find flights', history: [] }, '127.0.0.1');
    expect(result.message.payload).toBeNull();
    expect(result.message.content).toContain('Please confirm');
  });
  it('rejects extra account identifiers on the public preparation tool', async () => {
    const { service, provider } = setup();
    provider.generate.mockResolvedValue({ text: '', calls: [{ name: 'prepareFlightSearch', args: { customerId: 'someone-else' } }] });
    await expect(service.send({ message: 'Search', history: [] }, '127.0.0.1')).rejects.toMatchObject({ status: 503 });
  });
});
