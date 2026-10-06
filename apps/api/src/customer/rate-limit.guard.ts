import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import { RedisStore } from '@flyseri/redis';
import { APP_CONFIG, REDIS_STORE } from '../tokens.js';
import type { ContextRequest } from '../request-context.js';
import { ApiException } from '../api-exception.js';

@Injectable()
export class CustomerRateLimitGuard implements CanActivate {
  private readonly local = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const customerId = request.identity?.customerId;
    if (!customerId) throw new ApiException('AUTHENTICATION_REQUIRED', 'Please sign in to continue.', 401);
    const key = `customer-mutation:${customerId}`;
    if (this.redis) {
      const result = await this.redis.consumeRateLimit(key, 30, 60);
      if (result === 'limited') throw new ApiException('RATE_LIMITED', 'Please try again later.', 429);
      if (result === 'unavailable') throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Please try again shortly.', 503);
      return true;
    }
    if (this.config.APP_ENV === 'production') throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Please try again shortly.', 503);
    const now = Date.now();
    const entry = this.local.get(key);
    const next = !entry || entry.until <= now ? { count: 1, until: now + 60_000 } : { count: entry.count + 1, until: entry.until };
    this.local.set(key, next);
    if (next.count > 30) throw new ApiException('RATE_LIMITED', 'Please try again later.', 429);
    return true;
  }
}
