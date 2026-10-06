import { randomUUID } from 'node:crypto';
import type { AppConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import type { FlightBookingIntent, FlightLeg } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import type { FlightOfferValidationOutcome, FlightOfferValidationProvider } from './flight-offer-validation.service.js';
import type { SabreAuthService } from './sabre-auth.service.js';
import { buildSabreRevalidateV5Request, mapSabreV5Offers } from './sabre-v5.contract.js';
import type { FlightTelemetry } from './flight.telemetry.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'The latest flight fare cannot be confirmed yet. Please try again later.', 503);
const sameLeg = (a: FlightLeg | null, b: FlightLeg | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.segments.length === b.segments.length && a.segments.every((segment, index) => {
    const other = b.segments[index]!;
    return segment.origin === other.origin && segment.destination === other.destination &&
      segment.departureAt === other.departureAt && segment.arrivalAt === other.arrivalAt &&
      segment.marketingCarrier === other.marketingCarrier && segment.operatingCarrier === other.operatingCarrier &&
      segment.flightNumber === other.flightNumber &&
      segment.bookingClass === other.bookingClass;
  });
};

/** Revalidate Itinerary v5 supports conventional Sabre fares; BFM mapper excludes NDC. */
export class SabreRevalidateClient implements FlightOfferValidationProvider {
  constructor(private readonly config: AppConfig, private readonly auth: SabreAuthService,
    private readonly http: typeof fetch = fetch, private readonly telemetry?: FlightTelemetry,
    private readonly redis?: RedisStore) {}

  async validate(intent: FlightBookingIntent, requestId: string): Promise<FlightOfferValidationOutcome> {
    if (this.config.SABRE_ENV !== 'CERT' || this.config.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com' ||
      !this.config.SABRE_PCC || !intent.searchRequest) throw unavailable();
    let body: string;
    try { body = JSON.stringify(buildSabreRevalidateV5Request(intent.selectedOffer, intent.searchRequest, this.config.SABRE_PCC)); }
    catch { throw unavailable(); }
    const owner = randomUUID();
    if (this.redis) {
      const rate = await this.redis.consumeRateLimit('sabre:revalidate:v5:provider', this.config.SABRE_PROVIDER_RATE_LIMIT_PER_MINUTE, 60);
      if (rate === 'limited') throw new ApiException('RATE_LIMITED', 'Fare checks are busy. Please try again shortly.', 429);
      if (rate === 'unavailable') throw unavailable();
      const slot = await this.redis.trySemaphore('sabre:revalidate:v5:provider', owner, this.config.SABRE_PROVIDER_MAX_CONCURRENT,
        this.config.SABRE_REQUEST_TIMEOUT_MS * 3 + 3000);
      if (slot === 'busy') throw new ApiException('RATE_LIMITED', 'Fare checks are busy. Please try again shortly.', 429);
      if (slot === 'unavailable') throw unavailable();
    } else if (this.config.APP_ENV === 'production') throw unavailable();
    try { return await this.call(intent, requestId, body); }
    finally { if (this.redis) await this.redis.releaseSemaphore('sabre:revalidate:v5:provider', owner); }
  }

  private async call(intent: FlightBookingIntent, requestId: string, body: string): Promise<FlightOfferValidationOutcome> {
    const endpoint = 'https://api.cert.platform.sabre.com/v5/shop/flights/revalidate';
    let token = await this.auth.token();
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = performance.now();
      let response: Response;
      try {
        response = await this.http(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.SABRE_REQUEST_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body });
      } catch {
        this.telemetry?.provider({ requestId, durationMs: Math.round(performance.now() - start), statusCategory: 'network_or_timeout', success: false, retryCount: attempt });
        throw unavailable();
      }
      this.telemetry?.provider({ requestId, durationMs: Math.round(performance.now() - start), statusCategory: `${Math.floor(response.status / 100)}xx`, success: response.ok, retryCount: attempt });
      if (response.status === 401 && attempt === 0) { await this.auth.invalidate(token); token = await this.auth.token(); continue; }
      if (!response.ok) throw unavailable();
      let offers;
      try { offers = mapSabreV5Offers(await response.json(), 300, intent.searchRequest?.tripType === 'MULTI_CITY'); } catch { throw unavailable(); }
      const validatedAt = new Date().toISOString();
      if (!offers.length) return { result: 'UNAVAILABLE', validatedAt };
      const sameItinerary = (offer: typeof offers[number]) => {
        const expected = intent.selectedOffer.multiCityLegs, actual = offer.multiCityLegs;
        return expected && actual ? expected.length === actual.length && expected.every((leg, index) => sameLeg(leg, actual[index]!))
          : !expected && !actual && sameLeg(offer.outbound, intent.selectedOffer.outbound) && sameLeg(offer.inbound, intent.selectedOffer.inbound);
      };
      const match = offers.find((offer) => sameItinerary(offer) &&
        (!intent.selectedOffer.cabin || offer.cabin === intent.selectedOffer.cabin) &&
        (!intent.selectedOffer.fareBrandCode || offer.fareBrandCode === intent.selectedOffer.fareBrandCode));
      if (!match) return { result: 'ITINERARY_CHANGED', validatedAt };
      return { result: 'AVAILABLE', currentTotalAmount: match.totalAmount, currency: match.currency,
        itinerary: { outbound: match.outbound, inbound: match.inbound, ...(match.multiCityLegs ? { multiCityLegs: match.multiCityLegs } : {}) }, validatedAt };
    }
    throw unavailable();
  }
}
