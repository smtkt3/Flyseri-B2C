import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { FlightOffer, FlightSearchRequest, FlightSearchResponse, PopularCachedFlightFare } from '@flyseri/types';
import type { RedisStore } from '@flyseri/redis';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, FLIGHT_PROVIDER, FLIGHT_TELEMETRY, REDIS_STORE, TRIP_STORE } from '../tokens.js';
import type { TripStore } from '../trip/trip.repository.js';
import { flightSearchHash, normalizeFlightSearch, type NormalizedFlightSearch } from './flight-search.js';
import type { FlightTelemetry } from './flight.telemetry.js';
import { parseFlightOffers } from './flight-response.js';

export interface FlightProvider {
  search(input: NormalizedFlightSearch, requestId: string, onProgress?: (offers: FlightOffer[]) => Promise<void>): Promise<FlightOffer[] | { offers: FlightOffer[]; incomplete?: boolean }>;
}
interface CachedSearch { offers: FlightOffer[]; searchedAt: string; incomplete?: boolean }
const progressRevision = (value: CachedSearch) => `${value.searchedAt}:${value.offers.length}:${value.offers.at(-1)?.offerId ?? ''}`;
const POPULAR_FARE_DESTINATIONS = ['LHR','ICN','NRT','DXB','BKK','CGK','DPS','SYD','SIN','SGN','KIX','TPE','MNL','DAC','CGP','KTM','CMB','KHI','CCU','MAA','PEN','LGK','BKI','KCH','JHB','HKT','CNX','HAN','DAD','PNH','SAI','VTE','RGN','DEL','BOM','BLR','HYD','MLE','HKG','PEK','PVG','CAN','HND','DOH','AUH','JED','RUH','IST','CDG','AMS','FRA','FCO','MAD','ZRH','ATH','CAI','JNB','CPT','NBO','MEL','PER','AKL','JFK','LAX','SFO','YVR','YYZ','GRU','SCL','MEX','HNL','NAN'] as const;
interface SearchSession { customerId: string | null; tripId: string | null; search: NormalizedFlightSearch; offers: FlightOffer[]; expiresAt: string }
export interface SelectedFlightOffer { searchId: string; tripId: string | null; search: NormalizedFlightSearch; offer: FlightOffer }
const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable. Please try again.', 503);
const busy = () => new ApiException('RATE_LIMITED', 'Flight search is busy. Please try again shortly.', 429);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const validCache = (value: unknown): value is CachedSearch => {
  if (!value || typeof value !== 'object' || !('offers' in value) || !('searchedAt' in value)) return false;
  const row = value as CachedSearch;
  return parseFlightOffers(row.offers) !== null &&
    typeof row.searchedAt === 'string' && Number.isFinite(Date.parse(row.searchedAt));
};

@Injectable()
export class FlightService {
  private readonly localInflight = new Map<string, Promise<CachedSearch>>();
  private readonly localCache = new Map<string, { value: CachedSearch; expiresAt: number }>();
  private readonly localFailures = new Map<string, number>();
  private readonly localSessions = new Map<string, SearchSession>();
  private readonly localPopularFares = new Map<string, PopularCachedFlightFare>();
  private readonly progressListeners = new Map<string, Set<(result: CachedSearch) => Promise<void>>>();
  private readonly pendingResults = new Map<string, CachedSearch>();
  private readonly recentSearches=new Map<string,{search:NormalizedFlightSearch;lastSeen:number;count:number;cachedAt:number;attemptedAt:number}>();
  private lastLocalWarmup=0;
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
    @Inject(TRIP_STORE) private readonly trips: TripStore | undefined,
    @Inject(FLIGHT_PROVIDER) private readonly provider: FlightProvider | undefined,
    @Inject(FLIGHT_TELEMETRY) private readonly telemetry: FlightTelemetry,
  ) {}

  async search(customerId: string | null, requestId: string, input: FlightSearchRequest, onProgress?: (result: FlightSearchResponse) => Promise<void>): Promise<FlightSearchResponse> {
    const search = normalizeFlightSearch(input);
    if (search.children || search.infants) throw new ApiException('VALIDATION_ERROR', 'Live child and infant fares need each passenger\'s age. Adult flight searches are available now.', 400);
    if (input.tripId && (!customerId || !this.trips || !await this.trips.detail(customerId, input.tripId))) {
      throw new ApiException('NOT_FOUND', 'The requested trip was not found.', 404);
    }
    if (!this.provider) throw unavailable();
    const hash = flightSearchHash(search, this.config);
    const start = performance.now();
    let cacheStatus: 'hit' | 'miss' | 'coalesced' | 'degraded' = 'miss';
    let firstResultRecorded=false;
    const recordFirst=(response:FlightSearchResponse)=>{
      if(!firstResultRecorded&&response.offers.length){firstResultRecorded=true;this.telemetry.firstResult({requestId,searchHash:hash,durationMs:Math.round(performance.now()-start),offerCount:response.offers.length,cacheStatus});}
    };
    let searchId: string | undefined;
    let delivery = Promise.resolve();
    let lastProgress = '';
    const publish = (value: CachedSearch) => {
      const marker = progressRevision(value);
      if (marker === lastProgress) return delivery;
      lastProgress = marker;
      delivery = delivery.then(async () => {
        const response = await this.present(customerId, input.tripId ?? null, search, value, searchId);
        searchId = response.searchId;
        recordFirst(response);
        await onProgress?.(response);
      });
      return delivery;
    };
    if (onProgress) {
      const listeners = this.progressListeners.get(hash) ?? new Set();
      listeners.add(publish); this.progressListeners.set(hash, listeners);
    }
    this.telemetry.increment('customer_flight_search_total');
    let success = false;
    try {
      const cached = await this.readCache(hash);
      if (cached) {
        cacheStatus = 'hit'; this.telemetry.increment('bfm_cache_hit_total');
        const response = await this.present(customerId, input.tripId ?? null, search, cached, searchId);
        recordFirst(response);
        await onProgress?.(response);
        await this.capturePopularFare(search, cached);
        this.logSearchResults(requestId, search, response);
        success = true;
        if(!cached.incomplete)this.observeSearch(hash,search,cached.searchedAt);
        return response;
      }
      this.telemetry.increment('bfm_cache_miss_total');
      // A brief shared cooldown prevents repeated retries during a supplier outage.
      const failure = this.redis ? await this.redis.readJson<{ failed: boolean }>(`flight:bfm:v5:fare-details3:failed:${hash}`) : undefined;
      if (failure?.state === 'hit' && failure.value?.failed) throw unavailable();
      const pending = this.pendingResults.get(hash);
      if (onProgress && pending) await publish(pending);
      let result: CachedSearch;
      if (!this.redis) {
        if (this.config.APP_ENV === 'production') throw unavailable();
        cacheStatus = 'degraded';
        result = await this.localSearch(hash, search, requestId);
      } else {
        const owner = randomUUID();
        const lockKey = `flight:bfm:v5:fare-details3:${hash}`;
        const lock = await this.redis.tryLock(lockKey, owner, this.config.SABRE_REQUEST_TIMEOUT_MS * 3 + 5000);
        if (lock === 'unavailable') {
          this.telemetry.increment('bfm_cache_error_total');
          if (this.config.APP_ENV === 'production') throw unavailable();
          cacheStatus = 'degraded';
          result = await this.localSearch(hash, search, requestId);
        } else if (lock === 'acquired') {
          try {
            await this.redis.delete(`flight:bfm:v5:fare-details3:failed:${hash}`);
            const winner = await this.readCache(hash);
            result = winner ?? await this.callProvider(search, requestId);
            if (!winner && !await this.redis.setJson(`flight:bfm:v5:fare-details3:result:${hash}`, result, result.incomplete ? 5 : this.config.SABRE_BFM_CACHE_TTL_SECONDS)) this.telemetry.increment('bfm_cache_error_total');
          } catch (error) {
            if (!(error instanceof ApiException && error.code === 'VALIDATION_ERROR')) await this.redis.setJson(`flight:bfm:v5:fare-details3:failed:${hash}`, { failed: true }, 5);
            throw error;
          } finally { await this.redis.releaseLock(lockKey, owner); }
        } else {
          cacheStatus = 'coalesced';
          this.telemetry.increment('bfm_coalesced_request_total');
          result = await this.waitForLeader(hash, this.config.SABRE_REQUEST_TIMEOUT_MS * 3 + 4000, onProgress ? publish : undefined);
        }
      }
      await this.capturePopularFare(search, result);
      const response = await this.present(customerId, input.tripId ?? null, search, result, searchId);
      recordFirst(response);
      this.logSearchResults(requestId, search, response);
      success = true;
      if(!result.incomplete)this.observeSearch(hash,search,result.searchedAt);
      return response;
    } finally {
      const listeners = this.progressListeners.get(hash);
      listeners?.delete(publish);
      if (!listeners?.size) this.progressListeners.delete(hash);
      this.telemetry.search({ requestId, searchHash: hash, cacheStatus, durationMs: Math.round(performance.now() - start), success });
    }
  }

  private observeSearch(hash:string,search:NormalizedFlightSearch,searchedAt:string){
    if(!this.config.SABRE_CACHE_WARMUP_ENABLED)return;
    const previous=this.recentSearches.get(hash);
    this.recentSearches.delete(hash);
    this.recentSearches.set(hash,{search,lastSeen:Date.now(),count:(previous?.count??0)+1,cachedAt:Date.parse(searchedAt),attemptedAt:previous?.attemptedAt??0});
    while(this.recentSearches.size>this.config.SABRE_CACHE_WARMUP_MAX_ROUTES)this.recentSearches.delete(this.recentSearches.keys().next().value!);
  }

  async warmRecentSearch(redisAvailable=!!this.redis):Promise<void>{
    if(!this.config.SABRE_CACHE_WARMUP_ENABLED||this.config.SABRE_ENV!=='CERT'||this.config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com'||!this.provider)return;
    const now=Date.now();
    for(const [hash,value] of this.recentSearches)if(value.lastSeen<now-15*60000)this.recentSearches.delete(hash);
    // Leave time for a complete supplier response and the next worker tick.
    // Refreshing does not extend the lifetime of the previous quote.
    const refreshAfterMs=Math.max(0,this.config.SABRE_BFM_CACHE_TTL_SECONDS*1000-this.config.SABRE_REQUEST_TIMEOUT_MS-10000);
    const candidate=[...this.recentSearches].filter(([,value])=>value.count>=2&&now-value.cachedAt>=refreshAfterMs&&now-value.attemptedAt>=60000)
      .sort((a,b)=>b[1].count-a[1].count||b[1].lastSeen-a[1].lastSeen)[0];
    if(!candidate)return;
    const [hash,value]=candidate;value.attemptedAt=now;
    const requestId=randomUUID();const owner=randomUUID();const lockKey=`flight:bfm:v5:fare-details3:${hash}`;
    if(this.redis&&redisAvailable){
      if(await this.redis.consumeRateLimit('sabre:bfm:cache-warmup',this.config.SABRE_CACHE_WARMUP_SEARCHES_PER_MINUTE,60)!=='allowed')return;
      if(await this.redis.tryLock(lockKey,owner,this.config.SABRE_REQUEST_TIMEOUT_MS*3+5000)!=='acquired')return;
      try{
        this.telemetry.increment('bfm_cache_warmup_total');
        const result=await this.callProvider(value.search,requestId);
        // A failed/incomplete refresh must not displace the last complete quote.
        if(!result.incomplete){await this.redis.setJson(`flight:bfm:v5:fare-details3:result:${hash}`,result,this.config.SABRE_BFM_CACHE_TTL_SECONDS);value.cachedAt=Date.parse(result.searchedAt);this.rememberSearchLocally(hash,result);}
      }catch{this.telemetry.increment('bfm_cache_warmup_error_total');}
      finally{await this.redis.releaseLock(lockKey,owner);}
    }else if(this.config.APP_ENV!=='production'&&!this.localInflight.size&&now-this.lastLocalWarmup>=60000/this.config.SABRE_CACHE_WARMUP_SEARCHES_PER_MINUTE){
      this.lastLocalWarmup=now;
      this.telemetry.increment('bfm_cache_warmup_total');
      const task=this.callProvider(value.search,requestId,false);this.localInflight.set(hash,task);
      try{const result=await task;if(!result.incomplete){this.rememberSearchLocally(hash,result);value.cachedAt=Date.parse(result.searchedAt);}}
      catch{this.telemetry.increment('bfm_cache_warmup_error_total');}
      finally{this.localInflight.delete(hash);}
    }
  }

  async popularCachedFares(): Promise<PopularCachedFlightFare[]> {
    const now = Date.now();
    const fares = await Promise.all(POPULAR_FARE_DESTINATIONS.map(async (destination) => {
      let fare: PopularCachedFlightFare | undefined;
      if (this.redis) {
        const read = await this.redis.readJson<PopularCachedFlightFare>(`flight:popular-fare:v1:${destination}`);
        if (read.state === 'hit' && read.value?.destination === destination && Number.isFinite(Number(read.value.price)) && read.value.currency === 'MYR') fare = read.value;
      } else if (this.config.APP_ENV !== 'production') fare = this.localPopularFares.get(destination);
      return fare && Date.parse(fare.expiresAt) > now && Date.parse(`${fare.departureDate}T23:59:59+08:00`) > now ? fare : undefined;
    }));
    return fares.filter((fare): fare is PopularCachedFlightFare => !!fare).sort((a, b) => Number(a.price) - Number(b.price));
  }

  private async capturePopularFare(search: NormalizedFlightSearch, result: CachedSearch): Promise<void> {
    if (search.origin !== 'KUL' || search.tripType !== 'ONE_WAY' || search.adults !== 1 || search.children !== 0 || search.infants !== 0 || search.cabin !== 'ECONOMY' || search.currency !== 'MYR' ||
        !POPULAR_FARE_DESTINATIONS.includes(search.destination as typeof POPULAR_FARE_DESTINATIONS[number]) || Date.parse(`${search.departureDate}T23:59:59+08:00`) <= Date.now()) return;
    const cheapest = result.offers.filter((offer) => offer.currency === 'MYR' && Number.isFinite(Number(offer.totalAmount)) && Number(offer.totalAmount) > 0)
      .reduce<FlightOffer | undefined>((low, offer) => !low || Number(offer.totalAmount) < Number(low.totalAmount) ? offer : low, undefined);
    if (!cheapest) return;
    const key = `flight:popular-fare:v1:${search.destination}`;
    const previous = this.redis ? await this.redis.getJson<PopularCachedFlightFare>(key) : this.localPopularFares.get(search.destination);
    const previousStillUsable = previous && Date.parse(previous.expiresAt) > Date.now() && Date.parse(`${previous.departureDate}T23:59:59+08:00`) > Date.now();
    if (previousStillUsable && Number(previous.price) <= Number(cheapest.totalAmount)) return;
    const now = Date.now();
    const expiresAtMs = Date.parse(result.searchedAt) + this.config.SABRE_BFM_CACHE_TTL_SECONDS * 1000;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return;
    const fare: PopularCachedFlightFare = { destination: search.destination, departureDate: search.departureDate, price: cheapest.totalAmount, currency: 'MYR', searchedAt: result.searchedAt,
      expiresAt: new Date(expiresAtMs).toISOString() };
    if (this.redis) await this.redis.setJson(key, fare, Math.max(1, Math.ceil((expiresAtMs - now) / 1000)));
    else if (this.config.APP_ENV !== 'production') this.localPopularFares.set(search.destination, fare);
  }

  private logSearchResults(requestId: string, search: NormalizedFlightSearch, response: FlightSearchResponse): void {
    if (this.config.APP_ENV !== 'production') this.telemetry.results({ requestId, search, ...response },this.config.SABRE_VERBOSE_SEARCH_LOGGING);
  }

  private async readCache(hash: string): Promise<CachedSearch | undefined> {
    if (!this.redis) return this.readLocalCache(hash);
    const key = `flight:bfm:v5:fare-details3:result:${hash}`;
    const read = await this.redis.readJson<CachedSearch>(key);
    if (read.state === 'hit' && validCache(read.value)) {
      if (this.cacheExpiresAt(read.value) > Date.now()) return { offers: parseFlightOffers(read.value.offers)!, searchedAt: read.value.searchedAt, incomplete: read.value.incomplete };
      await this.redis.delete(key);
      return undefined;
    }
    if (read.state === 'malformed' || read.state === 'hit') { this.telemetry.increment('bfm_cache_error_total'); await this.redis.delete(key); }
    if (read.state === 'unavailable') { this.telemetry.increment('bfm_cache_error_total'); return this.readLocalCache(hash); }
    return undefined;
  }

  private readLocalCache(hash: string): CachedSearch | undefined {
    if (this.config.APP_ENV === 'production') return undefined;
    const entry = this.localCache.get(hash);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.localCache.delete(hash); return undefined; }
    // Retain frequently used routes when the bounded cache fills up.
    this.localCache.delete(hash); this.localCache.set(hash, entry);
    return entry.value;
  }

  private rememberSearchLocally(hash: string, value: CachedSearch): void {
    if (this.config.APP_ENV === 'production') return;
    for (const [key, entry] of this.localCache) if (entry.expiresAt <= Date.now()) this.localCache.delete(key);
    this.localCache.delete(hash);
    this.localCache.set(hash, { value, expiresAt: this.cacheExpiresAt(value) });
    while (this.localCache.size > 50) this.localCache.delete(this.localCache.keys().next().value!);
  }

  private cacheExpiresAt(value: CachedSearch): number {
    return Date.parse(value.searchedAt) + (value.incomplete ? 5 : this.config.SABRE_BFM_CACHE_TTL_SECONDS) * 1000;
  }

  private async waitForLeader(hash: string, timeoutMs: number, onProgress?: (result: CachedSearch) => Promise<void>): Promise<CachedSearch> {
    const deadline = Date.now() + timeoutMs;
    let lastPartial = '';
    while (Date.now() < deadline) {
      await delay(60 + Math.floor(Math.random() * 60));
      const cached = await this.readCache(hash);
      if (cached) return cached;
      if (onProgress) {
        // Poll a small revision record; fetch the full fare payload only when it changes.
        const version = await this.redis!.readJson<{ revision: string }>(`flight:bfm:v5:fare-details3:partial-version:${hash}`);
        if (version.state === 'hit' && typeof version.value?.revision === 'string' && version.value.revision !== lastPartial) {
          const partial = await this.redis!.readJson<CachedSearch>(`flight:bfm:v5:fare-details3:partial:${hash}`);
          if (partial.state === 'hit' && validCache(partial.value) && partial.value.offers.length) {
            lastPartial = progressRevision(partial.value);
            await onProgress(partial.value);
          }
        }
      }
      const failure = await this.redis!.readJson<{ failed: boolean }>(`flight:bfm:v5:fare-details3:failed:${hash}`);
      if (failure.state === 'hit' && failure.value?.failed) throw unavailable();
      if (failure.state === 'unavailable') throw unavailable();
    }
    throw unavailable();
  }

  private async localSearch(hash: string, search: NormalizedFlightSearch, requestId: string): Promise<CachedSearch> {
    const existing = this.localInflight.get(hash);
    if (existing) { this.telemetry.increment('bfm_coalesced_request_total'); return existing; }
    if ((this.localFailures.get(hash) ?? 0) > Date.now()) throw unavailable();
    this.localFailures.delete(hash);
    if (this.localInflight.size >= 2) throw busy();
    const task = this.callProvider(search, requestId, false);
    this.localInflight.set(hash, task);
    try { const result = await task; this.rememberSearchLocally(hash, result); return result; }
    catch (error) {
      this.localFailures.set(hash, Date.now() + 5000);
      while (this.localFailures.size > 50) this.localFailures.delete(this.localFailures.keys().next().value!);
      throw error;
    }
    finally { this.localInflight.delete(hash); }
  }

  private async callProvider(search: NormalizedFlightSearch, requestId: string, useRedis = true): Promise<CachedSearch> {
    const owner = randomUUID();
    if (this.redis && useRedis) {
      const rate = await this.redis.consumeRateLimit('sabre:bfm:v5:provider', this.config.SABRE_PROVIDER_RATE_LIMIT_PER_MINUTE, 60);
      if (rate === 'limited') { this.telemetry.increment('rate_limited_search_total'); throw busy(); }
      if (rate === 'unavailable') throw unavailable();
      const slot = await this.redis.trySemaphore('sabre:bfm:v5:provider', owner, this.config.SABRE_PROVIDER_MAX_CONCURRENT, this.config.SABRE_REQUEST_TIMEOUT_MS * 3 + 3000);
      if (slot === 'busy') { this.telemetry.increment('rate_limited_search_total'); throw busy(); }
      if (slot === 'unavailable') throw unavailable();
    }
    try {
      const hash = flightSearchHash(search, this.config);
      const identifiers = new Map<string, string>();
      const map = (offers: FlightOffer[], incomplete?: boolean): CachedSearch => {
        const mapped = parseFlightOffers(offers);
        if (!mapped) throw new Error('Invalid supplier mapping');
        return { offers: mapped.map((offer) => {
          const { offerId, itineraryKey, ...fare } = offer;
          const key = JSON.stringify(fare);
          const id = identifiers.get(key) ?? randomUUID(); identifiers.set(key, id);
          return { ...offer, offerId: id };
        }), searchedAt: new Date().toISOString(), ...(incomplete && { incomplete }) };
      };
      try {
        const result = await this.provider!.search(search, requestId, async (offers) => {
          const value = map(offers);
          this.pendingResults.set(hash, value);
          await Promise.allSettled([
            ...[...(this.progressListeners.get(hash) ?? [])].map(listener=>listener(value)),
            ...(this.redis && useRedis ? [(async () => {
              const ttl = Math.ceil(this.config.SABRE_REQUEST_TIMEOUT_MS * 3 / 1000) + 5;
              if (await this.redis!.setJson(`flight:bfm:v5:fare-details3:partial:${hash}`, value, ttl)) {
                await this.redis!.setJson(`flight:bfm:v5:fare-details3:partial-version:${hash}`, {revision:progressRevision(value)}, ttl);
              }
            })()] : []),
          ]);
        });
        return Array.isArray(result) ? map(result) : map(result.offers, result.incomplete);
      } finally {
        this.pendingResults.delete(hash);
        if (this.redis && useRedis) await Promise.allSettled([
          this.redis.delete(`flight:bfm:v5:fare-details3:partial-version:${hash}`),
          this.redis.delete(`flight:bfm:v5:fare-details3:partial:${hash}`),
        ]);
      }
    } catch (error) {
      if (error instanceof ApiException && error.code === 'VALIDATION_ERROR') throw error;
      this.telemetry.increment('bfm_sabre_error_total');
      throw unavailable();
    } finally {
      if (this.redis && useRedis) await this.redis.releaseSemaphore('sabre:bfm:v5:provider', owner);
    }
  }

  private async present(customerId: string | null, tripId: string | null, search: NormalizedFlightSearch, result: CachedSearch, existingId?: string): Promise<FlightSearchResponse> {
    const searchId = existingId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.config.SABRE_SEARCH_SESSION_TTL_SECONDS * 1000).toISOString();
    const session: SearchSession = { customerId, tripId, search, offers: result.offers, expiresAt };
    if (this.redis) {
      const saved = await this.redis.setJson(`flight:search-session:${searchId}`, session, this.config.SABRE_SEARCH_SESSION_TTL_SECONDS);
      if (!saved) {
        this.telemetry.increment('bfm_cache_error_total');
        if (this.config.APP_ENV === 'production') throw unavailable();
        this.rememberLocally(searchId, session);
      }
    } else if (this.config.APP_ENV !== 'production') {
      this.rememberLocally(searchId, session);
    } else throw unavailable();
    return { searchId, offers: result.offers, source: 'sabre', searchedAt: result.searchedAt,
      expiresAt, ...(result.incomplete && { incomplete: true }) };
  }

  async selectedOffer(customerId: string | null, searchId: string, offerId: string): Promise<SelectedFlightOffer> {
    const read = this.redis ? await this.redis.readJson<SearchSession>(`flight:search-session:${searchId}`) : undefined;
    if (read?.state === 'unavailable' && this.config.APP_ENV === 'production') throw unavailable();
    const session = read?.state === 'hit' ? read.value : this.localSessions.get(searchId);
    if (!session) throw new ApiException('OFFER_EXPIRED', 'This flight search has expired. Please refresh the latest fares.', 410);
    if (session.customerId !== customerId) throw new ApiException('NOT_FOUND', 'Flight search not found.', 404);
    if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new ApiException('OFFER_EXPIRED', 'This flight search has expired. Please refresh the latest fares.', 410);
    const offers = parseFlightOffers(session.offers);
    const offer = offers?.find((item) => item.offerId === offerId);
    if (!offer || !session.search) throw new ApiException('NOT_FOUND', 'Flight option not found.', 404);
    return { searchId, tripId: session.tripId, search: session.search, offer };
  }

  private rememberLocally(searchId: string, session: SearchSession): void {
    for (const [key, value] of this.localSessions) if (Date.parse(value.expiresAt) <= Date.now()) this.localSessions.delete(key);
    if (this.localSessions.size >= 100) this.localSessions.delete(this.localSessions.keys().next().value!);
    this.localSessions.set(searchId, session);
  }
}
