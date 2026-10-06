import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import { CustomerRateLimitGuard } from './rate-limit.guard.js';

const context = { switchToHttp: () => ({ getRequest: () => ({ identity: { customerId: 'customer-1' } }) }) } as unknown as ExecutionContext;

describe('customer mutation rate limit', () => {
  it('uses Redis and rejects requests after the limit', async () => {
    const consumeRateLimit = vi.fn().mockResolvedValueOnce('allowed').mockResolvedValueOnce('limited');
    const guard = new CustomerRateLimitGuard({ consumeRateLimit } as unknown as RedisStore, { APP_ENV: 'production' } as AppConfig);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(consumeRateLimit).toHaveBeenCalledWith('customer-mutation:customer-1', 30, 60);
  });

  it('fails closed when Redis is unavailable', async () => {
    const guard = new CustomerRateLimitGuard({ consumeRateLimit: vi.fn().mockResolvedValue('unavailable') } as unknown as RedisStore, { APP_ENV: 'production' } as AppConfig);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
  });
});
