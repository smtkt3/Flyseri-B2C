import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import { ApiException } from '../api-exception.js';
import type { ContextRequest } from '../request-context.js';
import { APP_CONFIG, FLIGHT_TELEMETRY, REDIS_STORE } from '../tokens.js';
import type { FlightTelemetry } from './flight.telemetry.js';

@Injectable()
export class FlightRateGuard implements CanActivate {
  private readonly local = new Map<string, { count: number; until: number }>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
    @Inject(FLIGHT_TELEMETRY) private readonly telemetry: FlightTelemetry) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const checkout = request.path?.endsWith('/checkout-attempts') ?? false;
    const ancillary = request.path?.endsWith('/ancillaries') ?? false;
    const metric = ancillary ? 'rate_limited_ancillary_total' : checkout ? 'rate_limited_checkout_total' : 'rate_limited_search_total';
    const message = ancillary ? 'Airline extras have been checked too often. Please wait before refreshing them.' : checkout ? 'Too many checkout submissions. Please try again shortly.' : 'Too many searches. Please try again shortly.';
    const customerId = request.identity?.customerId;
    // Use the connection address, not a caller-supplied forwarded header.
    const address = request.socket?.remoteAddress ?? request.ip ?? 'unknown';
    const guest = createHash('sha256').update(address).digest('hex');
    const prefix = ancillary ? 'flight-ancillary' : checkout ? 'flight-checkout' : 'flight-search';
    const key = customerId ? `${prefix}:customer:${customerId}` : `${prefix}:guest:${guest}`;
    const limit = ancillary ? Math.min(6, this.config.SABRE_SEARCH_RATE_LIMIT_PER_MINUTE) : this.config.SABRE_SEARCH_RATE_LIMIT_PER_MINUTE;
    const reject = (seconds: number): never => {
      context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>().setHeader('Retry-After', String(Math.max(1, Math.ceil(seconds))));
      this.telemetry.increment(metric);
      throw new ApiException('RATE_LIMITED', message, 429);
    };
    if (this.redis) {
      const state = await this.redis.consumeRateLimit(key, limit, 60);
      if (state === 'allowed') return true;
      if (state === 'limited') return reject(60);
      if (this.config.APP_ENV === 'production') throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable.', 503);
    } else if (this.config.APP_ENV === 'production') throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable.', 503);
    const now = Date.now();
    for (const [id, entry] of this.local) if (entry.until <= now) this.local.delete(id);
    if (!this.local.has(key) && this.local.size >= 2000) this.local.delete(this.local.keys().next().value!);
    const previous = this.local.get(key);
    const next = previous && previous.until > now ? { ...previous, count: previous.count + 1 } : { count: 1, until: now + 60_000 };
    this.local.set(key, next);
    if (next.count > (ancillary ? limit : Math.min(3, limit))) return reject((next.until - now) / 1000);
    return true;
  }
}
