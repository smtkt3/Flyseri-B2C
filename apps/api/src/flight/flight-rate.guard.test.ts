import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import { parseConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import { FlightRateGuard } from './flight-rate.guard.js';
import { FlightTelemetry } from './flight.telemetry.js';

const context = (id?: string, address = '192.0.2.1', forwarded?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ identity: id ? { customerId: id } : undefined, socket: { remoteAddress: address }, headers: { 'x-forwarded-for': forwarded } }) }) }) as unknown as ExecutionContext;
const telemetry = new FlightTelemetry({ info: vi.fn() } as never);
const config = { ...parseConfig({ APP_ENV: 'test' }), SABRE_SEARCH_RATE_LIMIT_PER_MINUTE: 2 } as AppConfig;
describe('flight customer rate limit', () => {
  it('limits an abusive customer without sharing another customer quota', async () => {
    const counts = new Map<string, number>();
    const consumeRateLimit = vi.fn(async (key: string, limit: number) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n > limit ? 'limited' : 'allowed'; });
    const guard = new FlightRateGuard(config, { consumeRateLimit } as unknown as RedisStore, telemetry);
    await expect(guard.canActivate(context('a'))).resolves.toBe(true);
    await expect(guard.canActivate(context('a'))).resolves.toBe(true);
    await expect(guard.canActivate(context('a'))).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(guard.canActivate(context('b'))).resolves.toBe(true);
    expect(consumeRateLimit).toHaveBeenCalledWith('flight-search:customer:a', 2, 60);
  });
  it('limits guests by connection address and ignores spoofed forwarding headers', async () => {
    const counts = new Map<string, number>();
    const consumeRateLimit = vi.fn(async (key: string, limit: number) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n > limit ? 'limited' as const : 'allowed' as const; });
    const guard = new FlightRateGuard(config, { consumeRateLimit } as unknown as RedisStore, telemetry);
    await expect(guard.canActivate(context(undefined, '192.0.2.1', '1.1.1.1'))).resolves.toBe(true);
    await expect(guard.canActivate(context(undefined, '192.0.2.1', '2.2.2.2'))).resolves.toBe(true);
    await expect(guard.canActivate(context(undefined, '192.0.2.1', '3.3.3.3'))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(guard.canActivate(context(undefined, '192.0.2.2'))).resolves.toBe(true);
    expect([...counts.keys()].every((key) => key.startsWith('flight-search:guest:') && !key.includes('192.0.2'))).toBe(true);
  });
  it('fails closed in production on Redis outage for both guests and customers', async () => {
    const guard = new FlightRateGuard({ ...config, APP_ENV: 'production' }, { consumeRateLimit: vi.fn().mockResolvedValue('unavailable') } as unknown as RedisStore, telemetry);
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
    await expect(guard.canActivate(context('a'))).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
  });
});
