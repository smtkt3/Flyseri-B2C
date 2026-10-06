import type { FlyseriLogger } from '@flyseri/logging';
import type { FlightOffer } from '@flyseri/types';
import type { NormalizedFlightSearch } from './flight-search.js';

export type FlightMetric = 'customer_flight_search_total' | 'bfm_cache_hit_total' | 'bfm_cache_miss_total' | 'bfm_cache_warmup_total' | 'bfm_cache_warmup_error_total' |
  'bfm_cache_error_total' | 'bfm_coalesced_request_total' | 'bfm_sabre_call_total' |
  'bfm_sabre_error_total' | 'sabre_oauth_token_cache_hit' | 'sabre_oauth_token_refresh' |
  'rate_limited_search_total' | 'rate_limited_checkout_total' | 'rate_limited_ancillary_total' | 'booking_intent_created_total' | 'validation_request_total' | 'validation_error_total' |
  'booking_create_attempt_total' | 'booking_create_success_total' | 'booking_create_failure_total' |
  'booking_unknown_total' | 'booking_reconciliation_total' | 'booking_get_total' |
  'booking_modify_total' | 'booking_duplicate_prevented_total';

export class FlightTelemetry {
  private readonly counters = new Map<FlightMetric, number>();
  private readonly latencySamples = new Map<string, number[]>();
  readonly startedAt = new Date().toISOString();
  constructor(private readonly logger: Pick<FlyseriLogger, 'info'>) {}
  increment(metric: FlightMetric): void { this.counters.set(metric, (this.counters.get(metric) ?? 0) + 1); }
  snapshot(): Record<string, number> { return Object.fromEntries(this.counters); }
  private sample(name: string, milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const samples = this.latencySamples.get(name) ?? [];
    samples.push(milliseconds); if (samples.length > 200) samples.shift();
    this.latencySamples.set(name, samples);
  }
  performanceSnapshot() {
    const counters = this.snapshot();
    const latencies = Object.fromEntries([...this.latencySamples].map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [name, { samples: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] }];
    }));
    const searches = counters.customer_flight_search_total ?? 0;
    return { startedAt: this.startedAt, scope: 'current_api_process', counters,
      cacheHitPercent: searches ? Math.round((counters.bfm_cache_hit_total ?? 0) / searches * 1000) / 10 : null,
      latencies, latencyWindow: 'last_200_samples_per_metric' };
  }
  search(event: { requestId: string; searchHash: string; cacheStatus: string; durationMs: number; success: boolean }): void {
    this.sample('search', event.durationMs);
    this.logger.info({ ...event, provider: 'sabre', operation: 'bfm_v5_shop', metric: 'flight_search' }, 'Flight search completed');
  }
  firstResult(event:{requestId:string;searchHash:string;durationMs:number;offerCount:number;cacheStatus:string}){
    this.sample('first_result', event.durationMs);
    this.logger.info({...event,provider:'sabre',metric:'flight_first_result'},'First flight results ready');
  }
  results(event: { requestId: string; search: NormalizedFlightSearch; searchId: string; searchedAt: string; offers: FlightOffer[] },verbose=false): void {
    const { requestId, search, searchId, searchedAt, offers } = event;
    this.logger.info({ requestId, searchId, searchedAt, search, offerCount: offers.length }, 'Full flight search results');
    if(!verbose)return;
    offers.forEach((offer, index) => {
      const legs = (offer.multiCityLegs ?? [offer.outbound, offer.inbound].filter((leg) => leg !== null)).map((leg) =>
        leg!.segments.map((segment) => `${segment.origin} ${segment.departureAt} → ${segment.destination} ${segment.arrivalAt} (${segment.marketingCarrier}${segment.flightNumber}${segment.operatingCarrier !== segment.marketingCarrier ? `, operated by ${segment.operatingCarrier}` : ''}, class ${segment.bookingClass})`).join(' | '));
      this.logger.info({ requestId, index: index + 1, total: offers.length, offer },
        `[${index + 1}/${offers.length}] ${offer.airlineCodes.join('/')} · ${offer.cabin ?? 'Cabin unavailable'}${offer.fareBrand ? ` · ${offer.fareBrand}` : ''} · ${offer.currency} ${offer.totalAmount} | ${legs.join(' || ')}${offer.baggageSummary ? ` | Baggage: ${offer.baggageSummary}` : ''}${offer.baggageCharge ? ` | Extra baggage listed: ${offer.baggageCharge.currency} ${offer.baggageCharge.amount}` : ''}${offer.amenities?.length ? ` | Features: ${offer.amenities.map((item) => `${item.name} ${item.availability}`).join(', ')}` : ''}`);
    });
  }
  provider(event: { requestId: string; mode?: 'branded'|'cabins'; durationMs: number; statusCategory: string; success: boolean; retryCount: number }): void {
    this.sample('sabre_response', event.durationMs);
    this.increment('bfm_sabre_call_total');
    this.logger.info({ ...event, provider: 'sabre', operation: 'bfm_v5_shop', metric: 'bfm_latency' }, 'Sabre BFM request completed');
  }
}
