import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@flyseri/config';
import { parseConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import type { FlightOffer, FlightSearchRequest } from '@flyseri/types';
import { FlightService, type FlightProvider } from './flight.service.js';
import { FlightTelemetry } from './flight.telemetry.js';
import { flightSearchHash, normalizeFlightSearch } from './flight-search.js';
import { SabreAuthService, type SabreTokenFetcher } from './sabre-auth.service.js';
import { SabreOAuthV3Fetcher } from './sabre-oauth-v3.fetcher.js';
import { SabreBfmClient } from './sabre-bfm.client.js';
import { parseFlightOffers } from './flight-response.js';

const base: FlightSearchRequest = { origin: 'KUL', destination: 'NRT', departureDate: '2026-12-10', returnDate: '2026-12-20',
  tripType: 'ROUND_TRIP', adults: 2, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };
const offer: FlightOffer = { offerId: 'opaque-offer', totalAmount: '1000.00', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { durationMinutes: 420, stops: 0, segments: [{ origin: 'KUL', destination: 'NRT', departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T16:00:00+09:00', marketingCarrier: 'MH', flightNumber: '70', bookingClass: 'K', aircraftTypeCode: '738', durationMinutes: 420 }] }, inbound: null };
const config: AppConfig = { ...parseConfig({ APP_ENV: 'test' }), SABRE_PCC: 'TEST' };
const telemetry = () => new FlightTelemetry({ info: vi.fn() } as never);

class MemoryRedis {
  values = new Map<string, { value: unknown; expires: number }>();
  locks = new Map<string, { owner: string; expires: number }>();
  active = new Set<string>();
  outage = false;
  rate = new Map<string, number>();
  async readJson<T>(key: string): Promise<{ state: 'hit'; value: T } | { state: 'miss' | 'malformed' | 'unavailable' }> {
    if (this.outage) return { state: 'unavailable' };
    const row = this.values.get(key);
    if (!row || row.expires <= Date.now()) return { state: 'miss' };
    return { state: 'hit', value: row.value as T };
  }
  async setJson(key: string, value: unknown, ttl: number) { if (this.outage) return false; this.values.set(key, { value, expires: Date.now() + ttl * 1000 }); return true; }
  async delete(key: string) { this.values.delete(key); return true; }
  async tryLock(key: string, owner: string, ttl: number) {
    if (this.outage) return 'unavailable' as const;
    const lock = this.locks.get(key);
    if (lock && lock.expires > Date.now()) return 'busy' as const;
    this.locks.set(key, { owner, expires: Date.now() + ttl }); return 'acquired' as const;
  }
  async releaseLock(key: string, owner: string) { if (this.locks.get(key)?.owner !== owner) return false; this.locks.delete(key); return true; }
  async trySemaphore(_key: string, owner: string, limit: number) { if (this.outage) return 'unavailable' as const; if (this.active.size >= limit) return 'busy' as const; this.active.add(owner); return 'acquired' as const; }
  async releaseSemaphore(_key: string, owner: string) { return this.active.delete(owner); }
  async consumeRateLimit(key: string, limit: number) { if (this.outage) return 'unavailable' as const; const n = (this.rate.get(key) ?? 0) + 1; this.rate.set(key, n); return n > limit ? 'limited' as const : 'allowed' as const; }
  async deleteJsonIfFingerprint(key: string, fingerprint: string) { const row = this.values.get(key); if ((row?.value as { fingerprint?: string })?.fingerprint !== fingerprint) return false; this.values.delete(key); return true; }
  redis(): RedisStore { return this as unknown as RedisStore; }
}

describe('flight cache identity and coalescing', () => {
  it.each(['LHR', 'AKL'])('exposes a recent real-search quote for expanded map destination %s', async (destination) => {
    const departureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const searchInput: FlightSearchRequest = { ...base, destination, departureDate, returnDate: undefined, tripType: 'ONE_WAY', adults: 1 };
    const searchedOffer: FlightOffer = { ...offer, outbound: { ...offer.outbound, segments: offer.outbound.segments.map(segment => ({ ...segment, destination })) } };
    const search = vi.fn(async () => [searchedOffer]);
    const service = new FlightService(config, undefined, undefined, { search }, telemetry());
    expect(await service.popularCachedFares()).toEqual([]);
    await service.search(null, 'map-search', searchInput);
    expect(await service.popularCachedFares()).toEqual([expect.objectContaining({ destination, departureDate, price: searchedOffer.totalAmount, currency: 'MYR' })]);
    expect(search).toHaveBeenCalledOnce();
  });

  it('shares five-minute quotes across customers without sharing their search sessions', async () => {
    const clock = vi.spyOn(Date, 'now'); const now = Date.now(); clock.mockReturnValue(now);
    try {
      const search = vi.fn(async () => [offer]);
      const service = new FlightService({ ...config, SABRE_BFM_CACHE_TTL_SECONDS: 300 }, undefined, undefined, { search }, telemetry());
      const first = await service.search('customer-a', 'first', base);
      clock.mockReturnValue(now + 299000);
      const second = await service.search('customer-b', 'second', base);
      expect(search).toHaveBeenCalledTimes(1);
      expect(first.searchId).not.toBe(second.searchId);
      expect(second.searchedAt).toBe(first.searchedAt);
      await expect(service.selectedOffer('customer-a', second.searchId, second.offers[0]!.offerId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      clock.mockReturnValue(now + 301000);
      await service.search('customer-b', 'expired', base);
      expect(search).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('rejects an old quote even if Redis gives it a later storage expiry', async () => {
    const redis = new MemoryRedis(); const search = vi.fn(async () => [offer]);
    const hash = flightSearchHash(normalizeFlightSearch(base), config);
    redis.values.set(`flight:bfm:v5:fare-details3:result:${hash}`, { value: { offers: [offer], searchedAt: new Date(Date.now() - 61000).toISOString() }, expires: Date.now() + 60000 });
    const service = new FlightService(config, redis.redis(), undefined, { search }, telemetry());
    await service.search('c', 'refresh', base);
    expect(search).toHaveBeenCalledOnce();
  });

  it.each([false, true])('suppresses repeat failed searches for five seconds (Redis: %s)', async (shared) => {
    const clock = vi.spyOn(Date, 'now'); const now = Date.now(); clock.mockReturnValue(now);
    try {
      const redis = new MemoryRedis(); const search = vi.fn().mockRejectedValue(new Error('Supplier unavailable'));
      const service = new FlightService(config, shared ? redis.redis() : undefined, undefined, { search }, telemetry());
      for (let i = 0; i < 10; i++) await expect(service.search('c', String(i), base)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      expect(search).toHaveBeenCalledOnce();
      clock.mockReturnValue(now + 5001);
      search.mockResolvedValue([offer]);
      await expect(service.search('c', 'recovered', base)).resolves.toMatchObject({ source: 'sabre' });
      expect(search).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('does not shop speculatively when demand-driven caching disables warming', async () => {
    const search = vi.fn(async () => [offer]);
    const service = new FlightService({ ...config, SABRE_CACHE_WARMUP_ENABLED: false }, undefined, undefined, { search }, telemetry());
    await service.search('c', 'one', base); await service.search('c', 'two', base);
    await service.warmRecentSearch(false);
    expect(search).toHaveBeenCalledOnce();
  });
  it('allows an anonymous Sabre search but never lets an account claim its offer directly', async () => {
    const service = new FlightService(config, undefined, undefined, { search: vi.fn(async () => [offer]) }, telemetry());
    const guest = await service.search(null, 'guest-request', base);
    expect(guest.offers).toHaveLength(1);
    await expect(service.selectedOffer('customer-a', guest.searchId, guest.offers[0]!.offerId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('strips unexpected supplier fields from the customer response', () => {
    const safe = parseFlightOffers([{ ...offer, rawSabrePayload: { private: 'hidden' }, outbound: { ...offer.outbound, supplierReference: 'internal' } }]);
    expect(safe).toHaveLength(1);
    expect(safe?.[0]?.outbound.segments[0]?.aircraftTypeCode).toBe('738');
    expect(JSON.stringify(safe)).not.toContain('rawSabrePayload');
    expect(JSON.stringify(safe)).not.toContain('supplierReference');
    expect(parseFlightOffers([{ ...offer, totalAmount: 'NaN' }])).toBeNull();
  });
  it('normalizes equivalent searches and separates every meaningful pricing input and agency', () => {
    const hash = (input: FlightSearchRequest, overrides: Partial<AppConfig> = {}) => flightSearchHash(normalizeFlightSearch(input), { ...config, ...overrides });
    expect(hash(base)).toBe(hash({ ...base, origin: ' kul ', destination: ' nrt ', currency: ' myr ' }));
    for (const changed of [{ departureDate: '2026-12-11' }, { adults: 3 }, { cabin: 'BUSINESS' as const }, { currency: 'USD' }, { returnDate: '2026-12-21' }]) expect(hash({ ...base, ...changed })).not.toBe(hash(base));
    expect(hash(base, { SABRE_PCC: 'OTHER' })).not.toBe(hash(base));
    expect(hash(base, { SABRE_SHOPPING_POLICY_VERSION: '3' })).not.toBe(hash(base));
    expect(() => normalizeFlightSearch({ ...base, origin: 'NRT', destination: 'NRT' })).toThrow();
    expect(() => normalizeFlightSearch({ ...base, infants: 3 })).toThrow();
  });
  it('does not send age-sensitive family fares to Sabre without child age inputs', async () => {
    const provider = { search: vi.fn(async () => [offer]) };
    const service = new FlightService(config, undefined, undefined, provider, telemetry());
    await expect(service.search('customer-a', 'request', { ...base, children: 1 })).rejects.toMatchObject({ status: 400 });
    expect(provider.search).not.toHaveBeenCalled();
  });
  it('uses one mocked Sabre call for ten sequential and fifty concurrent identical searches', async () => {
    const redis = new MemoryRedis();
    const search = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); return [offer]; });
    const service = new FlightService(config, redis.redis(), undefined, { search } as FlightProvider, telemetry());
    const first = await service.search('customer-a', 'request-1', base);
    const sequential = await Promise.all(Array.from({ length: 9 }, (_, n) => service.search('customer-a', `request-${n + 2}`, base)));
    expect(search).toHaveBeenCalledTimes(1);
    expect(sequential.every((item) => item.offers[0]?.offerId === first.offers[0]?.offerId)).toBe(true);
    redis.values.clear();
    const concurrent = await Promise.all(Array.from({ length: 50 }, (_, n) => service.search('customer-a', `parallel-${n}`, base)));
    expect(search).toHaveBeenCalledTimes(2);
    expect(concurrent).toHaveLength(50);
    expect(new Set(concurrent.map((item) => item.searchId)).size).toBe(50);
    expect(redis.locks.size).toBe(0);
    expect(redis.active.size).toBe(0);
    await service.search('customer-a', 'different-date', { ...base, departureDate: '2026-12-11' });
    await service.search('customer-a', 'different-passengers', { ...base, adults: 3 });
    await service.search('customer-a', 'different-cabin', { ...base, cabin: 'BUSINESS' });
    expect(search).toHaveBeenCalledTimes(5);
  });
  it('reuses a bounded local result during development when Redis is not configured', async () => {
    const search = vi.fn(async () => [offer]);
    const service = new FlightService(config, undefined, undefined, { search }, telemetry());
    const first = await service.search('c', '1', base);
    const second = await service.search('c', '2', base);
    expect(first.searchId).not.toBe(second.searchId);
    expect(search).toHaveBeenCalledTimes(1);
    await service.search('c', '3', { ...base, cabin: 'BUSINESS' });
    expect(search).toHaveBeenCalledTimes(2);
  });
  it('refreshes expired cache and replaces malformed cache', async () => {
    const redis = new MemoryRedis(); const search = vi.fn(async () => [offer]);
    const service = new FlightService(config, redis.redis(), undefined, { search }, telemetry());
    await service.search('c', '1', base);
    const key = `flight:bfm:v5:fare-details3:result:${flightSearchHash(normalizeFlightSearch(base), config)}`;
    redis.values.set(key, { value: { garbage: true }, expires: Date.now() + 1000 });
    await service.search('c', '2', base);
    expect(search).toHaveBeenCalledTimes(2);
    redis.values.set(key, { value: { offers: [offer], searchedAt: new Date().toISOString() }, expires: Date.now() - 1 });
    await service.search('c', '3', base);
    expect(search).toHaveBeenCalledTimes(3);
  });
  it('resolves only the owner\'s unexpired offer from a server search session', async () => {
    const redis = new MemoryRedis();
    const service = new FlightService(config, redis.redis(), undefined, { search: async () => [offer] }, telemetry());
    const result = await service.search('customer-a', 'search', base);
    const selectedId = result.offers[0]!.offerId;
    const selected = await service.selectedOffer('customer-a', result.searchId, selectedId);
    expect(selected.offer).toEqual(result.offers[0]);
    expect(selected.search).toMatchObject({ origin: 'KUL', destination: 'NRT', adults: 2 });
    await expect(service.selectedOffer('customer-b', result.searchId, selectedId)).rejects.toMatchObject({ status: 404 });
    await expect(service.selectedOffer('customer-a', result.searchId, 'not-an-offer')).rejects.toMatchObject({ status: 404 });
    const key = `flight:search-session:${result.searchId}`;
    const row = redis.values.get(key);
    expect(row).toBeDefined();
    row!.expires = Date.now() - 1;
    await expect(service.selectedOffer('customer-a', result.searchId, selectedId)).rejects.toMatchObject({ code: 'OFFER_EXPIRED', status: 410 });
  });
  it('uses a bounded local fallback only outside production during Redis outage', async () => {
    const redis = new MemoryRedis(); redis.outage = true;
    const search = vi.fn(async () => [offer]);
    const service = new FlightService(config, redis.redis(), undefined, { search }, telemetry());
    await service.search('c', '1', base);
    expect(search).toHaveBeenCalledTimes(1);
    const production = new FlightService({ ...config, APP_ENV: 'production' }, redis.redis(), undefined, { search }, telemetry());
    await expect(production.search('c', '2', base)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('fails waiting callers promptly when a leader fails, without leaving a lock', async () => {
    const redis = new MemoryRedis(); const search = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); throw new Error('supplier'); });
    const service = new FlightService(config, redis.redis(), undefined, { search }, telemetry());
    const results = await Promise.allSettled(Array.from({ length: 15 }, (_, n) => service.search('c', `r${n}`, base)));
    expect(results.every((row) => row.status === 'rejected')).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
    expect(redis.locks.size).toBe(0);
  });
});

describe('Sabre token coordination', () => {
  it('derives TTL from expires_in, reuses token and coalesces concurrent refresh', async () => {
    const redis = new MemoryRedis();
    const fetchToken = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); return { accessToken: 'private-token', expiresInSeconds: 120 }; });
    const auth = new SabreAuthService(config, redis.redis(), { fetchToken }, telemetry());
    const values = await Promise.all(Array.from({ length: 25 }, () => auth.token()));
    expect(values.every((value) => value === 'private-token')).toBe(true);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    const stored = redis.values.values().next().value;
    expect(stored).toBeDefined();
    expect(stored!.expires - Date.now()).toBeGreaterThan(50_000);
    expect(stored!.expires - Date.now()).toBeLessThanOrEqual(60_000);
    await auth.token(); expect(fetchToken).toHaveBeenCalledTimes(1);
    await auth.invalidate('private-token');
    await auth.token(); expect(fetchToken).toHaveBeenCalledTimes(2);
  });
  it('refreshes an expired token and rejects a token shorter than the safety window', async () => {
    const redis = new MemoryRedis();
    const fetchToken = vi.fn().mockResolvedValueOnce({ accessToken: 'one', expiresInSeconds: 120 }).mockResolvedValueOnce({ accessToken: 'two', expiresInSeconds: 120 });
    const auth = new SabreAuthService(config, redis.redis(), { fetchToken } as SabreTokenFetcher, telemetry());
    expect(await auth.token()).toBe('one');
    for (const row of redis.values.values()) row.expires = Date.now() - 1;
    expect(await auth.token()).toBe('two');
    const short = new SabreAuthService(config, new MemoryRedis().redis(), { fetchToken: async () => ({ accessToken: 'bad', expiresInSeconds: 10 }) }, telemetry());
    await expect(short.token()).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});

describe('documented Sabre CERT REST OAuth v3 exchange', () => {
  const authConfig: AppConfig = { ...config, SABRE_AUTH_URL: 'https://api.cert.platform.sabre.com/v3/auth/token',
    SABRE_CLIENT_ID: 'example-client', SABRE_CLIENT_SECRET: 'example-secret', SABRE_USERNAME: 'example-epr-pcc-domain', SABRE_PASSWORD: 'example-password' };
  it('posts the password grant with server-only Basic auth and parses a bearer token', async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ access_token: 'test-token', token_type: 'bearer', expires_in: 3600 }), { status: 200 }));
    const fetcher = new SabreOAuthV3Fetcher(authConfig, request as typeof fetch);
    expect(await fetcher.fetchToken()).toEqual({ accessToken: 'test-token', expiresInSeconds: 3600 });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe(authConfig.SABRE_AUTH_URL);
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('example-client:example-secret').toString('base64')}`);
    expect((init?.body as URLSearchParams).toString()).toBe('grant_type=password&username=example-epr-pcc-domain&password=example-password');
  });
  it('fails closed on another host, production mode, a provider error, or an invalid response', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ access_token: 'test-token', token_type: 'bearer', expires_in: 3600 }), { status: 200 }));
    await expect(new SabreOAuthV3Fetcher({ ...authConfig, SABRE_ENV: 'PROD' }, request as typeof fetch).fetchToken()).rejects.toMatchObject({ status: 503 });
    await expect(new SabreOAuthV3Fetcher({ ...authConfig, SABRE_AUTH_URL: 'https://other.example/v3/auth/token' }, request as typeof fetch).fetchToken()).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
    const errorFetch = vi.fn(async () => new Response('', { status: 401 }));
    await expect(new SabreOAuthV3Fetcher(authConfig, errorFetch as typeof fetch).fetchToken()).rejects.toMatchObject({ status: 503 });
    const malformed = vi.fn(async () => new Response(JSON.stringify({ access_token: 'test-token', token_type: 'bearer', expires_in: 'bad' }), { status: 200 }));
    await expect(new SabreOAuthV3Fetcher(authConfig, malformed as typeof fetch).fetchToken()).rejects.toMatchObject({ status: 503 });
  });
});

describe('BFM transport boundary', () => {
  it('invalidates a 401 token and retries at most once', async () => {
    const auth = { token: vi.fn().mockResolvedValueOnce('old').mockResolvedValue('new'), invalidate: vi.fn().mockResolvedValue(undefined) };
    const http = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const contract = { buildRequest: vi.fn().mockReturnValue({}), mapResponse: vi.fn().mockReturnValue([offer]) };
    const info = vi.fn();
    const metrics = new FlightTelemetry({ info } as never);
    const client = new SabreBfmClient({ ...config, SABRE_BASE_URL: 'https://api.cert.platform.sabre.com' }, auth as unknown as SabreAuthService, contract, http, metrics);
    expect(await client.search(normalizeFlightSearch(base), 'request-id')).toEqual({ offers: [offer], incomplete: false });
    expect(http).toHaveBeenCalledTimes(3);
    expect(auth.invalidate).toHaveBeenCalledWith('old');
    expect(http.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer old');
    expect(http.mock.calls[1]?.[1]?.headers.Authorization).toBe('Bearer new');
    expect(contract.buildRequest).toHaveBeenNthCalledWith(1, normalizeFlightSearch(base), 'branded');
    expect(contract.buildRequest).toHaveBeenNthCalledWith(2, normalizeFlightSearch(base), 'cabins');
    expect(contract.mapResponse).toHaveBeenCalledTimes(2);
    expect(metrics.snapshot().bfm_sabre_call_total).toBe(3);
    expect(JSON.stringify(info.mock.calls)).not.toContain('Bearer old');
    expect(JSON.stringify(info.mock.calls)).not.toContain('Bearer new');
  });
  it('merges cabin alternatives while keeping distinct fare conditions and removing duplicate quotes', async () => {
    const auth = { token: vi.fn().mockResolvedValue('token'), invalidate: vi.fn() };
    const http = vi.fn(async () => new Response('{}', { status: 200 }));
    const business = { ...offer, offerId: 'business', cabin: 'BUSINESS' as const, totalAmount: '900.00' };
    const flexible = { ...offer, offerId: 'flex', fareBrand: 'Flex', totalAmount: offer.totalAmount };
    const contract = { buildRequest: vi.fn().mockReturnValue({}), mapResponse: vi.fn()
      .mockReturnValueOnce([offer, flexible]).mockReturnValueOnce([{ ...offer, offerId: 'duplicate', itineraryKey: '1:2' }, business]) };
    const client = new SabreBfmClient({ ...config, SABRE_BASE_URL: 'https://api.cert.platform.sabre.com' }, auth as unknown as SabreAuthService, contract, http);
    await expect(client.search(normalizeFlightSearch(base), 'request')).resolves.toEqual({ offers: [offer, flexible, business], incomplete: false });
  });
  it('does not retry a persistent 401 or a normal provider failure', async () => {
    const auth = { token: vi.fn().mockResolvedValue('token'), invalidate: vi.fn().mockResolvedValue(undefined) };
    const http = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const client = new SabreBfmClient({ ...config, SABRE_BASE_URL: 'https://api.cert.platform.sabre.com' }, auth as unknown as SabreAuthService,
      { buildRequest: () => ({}), mapResponse: () => [] }, http);
    await expect(client.search(normalizeFlightSearch(base), 'r')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(http).toHaveBeenCalledTimes(4);
    http.mockClear().mockResolvedValue(new Response('', { status: 400 }));
    await expect(client.search(normalizeFlightSearch(base), 'r')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(http).toHaveBeenCalledTimes(2);
  });
});
