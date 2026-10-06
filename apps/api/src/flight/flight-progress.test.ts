import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@flyseri/config';
import type { FlightOffer, FlightSearchRequest, FlightSearchResponse } from '@flyseri/types';
import { FlightService } from './flight.service.js';
import { FlightTelemetry } from './flight.telemetry.js';
import { SabreBfmClient } from './sabre-bfm.client.js';
import type { SabreAuthService } from './sabre-auth.service.js';
import { normalizeFlightSearch } from './flight-search.js';

const config = { ...parseConfig({ APP_ENV: 'test' }), SABRE_BASE_URL: 'https://api.cert.platform.sabre.com' };
const input: FlightSearchRequest = { origin: 'KUL', destination: 'PEN', departureDate: '2026-12-10', tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };
const offer: FlightOffer = { offerId: 'supplier-id', totalAmount: '300.00', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { durationMinutes: 60, stops: 0, segments: [{ origin: 'KUL', destination: 'PEN', departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T10:00:00+08:00', marketingCarrier: 'MH', flightNumber: '1148', bookingClass: 'Q', durationMinutes: 60 }] }, inbound: null };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('progressive Sabre flight search', () => {
  it('reports a failed search rather than a false empty result when a shopping branch fails and no fares arrived', async () => {
    const http = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('', { status: 503 }));
    const auth = { token: vi.fn().mockResolvedValue('test-token'), invalidate: vi.fn() };
    const client = new SabreBfmClient(config, auth as unknown as SabreAuthService, { buildRequest: () => ({}), mapResponse: () => [] }, http);
    await expect(client.search(normalizeFlightSearch(input), 'request')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
  it('runs both shopping modes together and keeps the first valid fares when the second fails', async () => {
    const second = deferred<Response>();
    const http = vi.fn().mockResolvedValueOnce(new Response('{}')).mockImplementationOnce(() => second.promise);
    const auth = { token: vi.fn().mockResolvedValue('test-token'), invalidate: vi.fn() };
    const client = new SabreBfmClient(config, auth as unknown as SabreAuthService, { buildRequest: () => ({}), mapResponse: () => [offer] }, http);
    const publish = vi.fn(async () => undefined);
    const result = client.search(normalizeFlightSearch(input), 'request', publish);
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith([offer]));
    expect(http).toHaveBeenCalledTimes(2);
    second.resolve(new Response('', { status: 503 }));
    await expect(result).resolves.toEqual({ offers: [offer], incomplete: true });
  });

  it('makes a partial fare selectable immediately and preserves its owned session and ID as more results arrive', async () => {
    const finish = deferred<void>();
    const service = new FlightService(config, undefined, undefined, { search: async (_input, _requestId, publish) => {
      await publish?.([offer]); await finish.promise;
      const all = [offer, { ...offer, offerId: 'supplier-next', totalAmount: '400.00', cabin: 'BUSINESS' as const }];
      await publish?.(all); return all;
    } }, new FlightTelemetry({ info: vi.fn() } as never));
    const updates: FlightSearchResponse[] = [];
    const done = service.search('owner', 'request', input, async (result) => { updates.push(result); });
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    const first = updates[0]!;
    expect((await service.selectedOffer('owner', first.searchId, first.offers[0]!.offerId)).offer.totalAmount).toBe('300.00');
    await expect(service.selectedOffer('foreign', first.searchId, first.offers[0]!.offerId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    finish.resolve();
    const final = await done;
    expect(final.searchId).toBe(first.searchId);
    expect(final.offers[0]!.offerId).toBe(first.offers[0]!.offerId);
    expect(final.offers).toHaveLength(2);
    const cached = await service.search('owner', 'cached-request', input);
    expect(cached.offers.map(fare => fare.offerId)).toEqual(final.offers.map(fare => fare.offerId));
  });
});
