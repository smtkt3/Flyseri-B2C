import type { AppConfig } from '@flyseri/config';
import type { FlightOffer } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import type { NormalizedFlightSearch } from './flight-search.js';
import type { FlightProvider } from './flight.service.js';
import type { SabreAuthService } from './sabre-auth.service.js';
import type { FlightTelemetry } from './flight.telemetry.js';

/** Request and GIR response mappings are supplied only from the account's verified BFM v5 contract. */
export interface SabreBfmContract {
  buildRequest(search: NormalizedFlightSearch, mode?: 'branded' | 'cabins'): unknown;
  mapResponse(response: unknown, search?: NormalizedFlightSearch): FlightOffer[];
}
type HttpFetch = typeof fetch;
const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable. Please try again.', 503);

export class SabreBfmClient implements FlightProvider {
  constructor(private readonly config: AppConfig, private readonly auth: SabreAuthService,
    private readonly contract: SabreBfmContract, private readonly http: HttpFetch = fetch,
    private readonly telemetry?: FlightTelemetry) {}
  async search(input: NormalizedFlightSearch, requestId: string, onProgress?: (offers: FlightOffer[]) => Promise<void>): Promise<{ offers: FlightOffer[]; incomplete: boolean }> {
    // CERT rejects combining MultipleBrandedFares and FlexibleFares in one request.
    const unique = new Map<string, FlightOffer>();
    let delivery = Promise.resolve();
    const outcomes = await Promise.allSettled((['branded', 'cabins'] as const).map(async (mode) => {
      const offers = await this.shop(input, requestId, mode);
      // Each completed supplier response is immediately usable. Serialize delivery
      // so a slower callback cannot replace a newer set of results.
      delivery = delivery.then(async () => {
        for (const offer of offers) {
          const { offerId, itineraryKey, ...fare } = offer;
          const key = JSON.stringify(fare);
          if (!unique.has(key)) unique.set(key, offer);
        }
        await onProgress?.([...unique.values()]);
      });
      await delivery;
    }));
    const incomplete = outcomes.some((outcome) => outcome.status === 'rejected');
    const invalidDate = outcomes.find((outcome) => outcome.status === 'rejected' && outcome.reason instanceof ApiException && outcome.reason.code === 'VALIDATION_ERROR');
    if (!unique.size && invalidDate?.status === 'rejected') throw invalidDate.reason;
    if (outcomes.every((outcome) => outcome.status === 'rejected') || (incomplete && !unique.size)) throw unavailable();
    return { offers: [...unique.values()], incomplete };
  }
  private async shop(input: NormalizedFlightSearch, requestId: string, mode: 'branded' | 'cabins'): Promise<FlightOffer[]> {
    if (this.config.SABRE_ENV !== 'CERT' || this.config.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com') throw unavailable();
    const body = JSON.stringify(this.contract.buildRequest(input, mode));
    const endpoint = new URL('/v5/offers/shop', this.config.SABRE_BASE_URL).toString();
    let token = await this.auth.token();
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      const start = performance.now();
      try {
        response = await this.http(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.SABRE_REQUEST_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body });
      } catch {
        this.telemetry?.provider({ requestId, mode, durationMs: Math.round(performance.now() - start), statusCategory: 'network_or_timeout', success: false, retryCount: attempt });
        throw unavailable();
      }
      this.telemetry?.provider({ requestId, mode, durationMs: Math.round(performance.now() - start), statusCategory: `${Math.floor(response.status / 100)}xx`, success: response.ok, retryCount: attempt });
      if (response.status === 401 && attempt === 0) { await this.auth.invalidate(token); token = await this.auth.token(); continue; }
      if (!response.ok) throw unavailable();
      let parsed: unknown;
      try { parsed = await response.json(); } catch { throw unavailable(); }
      // BFM can return HTTP 200 with a date rejection instead of itinerary descriptors.
      const grouped = (parsed as { groupedItineraryResponse?: { messages?: unknown[] } } | null)?.groupedItineraryResponse;
      if (Array.isArray(grouped?.messages) && grouped.messages.some((message) => {
        if (!message || typeof message !== 'object') return false;
        const item = message as Record<string, unknown>;
        return item.severity === 'Error' && item.type === 'SCHEDULES' && item.code === 'PROCESS' &&
          typeof item.text === 'string' && /^DSF server returned an error: Invalid requested date: \d{4}-\d{2}-\d{2}$/.test(item.text);
      })) throw new ApiException('VALIDATION_ERROR', 'The airline search cannot accept these travel dates yet. Please choose another date or check closer to departure.', 400);
      try { return this.contract.mapResponse(parsed, input); } catch { throw unavailable(); }
    }
    throw unavailable();
  }
}
