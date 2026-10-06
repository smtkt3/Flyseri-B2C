import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import { ApiException } from '../api-exception.js';
import type { FlightTelemetry } from './flight.telemetry.js';

export interface SabreTokenFetcher {
  fetchToken(): Promise<{ accessToken: string; expiresInSeconds: number }>;
}
interface CachedToken { accessToken: string; fingerprint: string; expiresAt: number }
const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable.', 503);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The HTTP token contract is supplied by a separate adapter after account documentation is verified. */
export class SabreAuthService {
  private readonly key: string;
  private local: CachedToken | undefined;
  private localInflight: Promise<string> | undefined;
  constructor(private readonly config: AppConfig, private readonly redis: RedisStore | undefined,
    private readonly fetcher: SabreTokenFetcher, private readonly telemetry: FlightTelemetry) {
    const identity = JSON.stringify([config.SABRE_ENV, config.SABRE_CLIENT_ID, config.SABRE_PCC, config.SABRE_AUTH_URL]);
    this.key = `sabre:token:${createHash('sha256').update(identity).digest('hex')}`;
  }
  private valid(value: unknown): value is CachedToken {
    if (!value || typeof value !== 'object') return false;
    const row = value as CachedToken;
    return typeof row.accessToken === 'string' && row.accessToken.length > 0 && typeof row.fingerprint === 'string' &&
      Number.isFinite(row.expiresAt) && row.expiresAt > Date.now() + 1000;
  }
  async token(): Promise<string> {
    if (this.redis) {
      const read = await this.redis.readJson<CachedToken>(this.key);
      if (read.state === 'hit' && this.valid(read.value)) { this.telemetry.increment('sabre_oauth_token_cache_hit'); return read.value.accessToken; }
      if (read.state === 'unavailable' && this.config.APP_ENV === 'production') throw unavailable();
      const owner = randomUUID();
      const lock = await this.redis.tryLock(`${this.key}:refresh`, owner, this.config.SABRE_REQUEST_TIMEOUT_MS + 3000);
      if (lock === 'acquired') {
        try {
          const winner = await this.redis.readJson<CachedToken>(this.key);
          if (winner.state === 'hit' && this.valid(winner.value)) return winner.value.accessToken;
          const fresh = await this.fetcher.fetchToken();
          if (!fresh.accessToken || !Number.isFinite(fresh.expiresInSeconds)) throw unavailable();
          const ttl = Math.floor(fresh.expiresInSeconds - this.config.SABRE_TOKEN_EXPIRY_SKEW_SECONDS);
          if (ttl < 1) throw unavailable();
          const token: CachedToken = { accessToken: fresh.accessToken, expiresAt: Date.now() + ttl * 1000,
            fingerprint: createHash('sha256').update(fresh.accessToken).digest('hex') };
          if (!await this.redis.setJson(this.key, token, ttl)) throw unavailable();
          this.telemetry.increment('sabre_oauth_token_refresh');
          return fresh.accessToken;
        } finally { await this.redis.releaseLock(`${this.key}:refresh`, owner); }
      }
      if (lock === 'busy') {
        const deadline = Date.now() + this.config.SABRE_REQUEST_TIMEOUT_MS + 2000;
        while (Date.now() < deadline) {
          await wait(75 + Math.floor(Math.random() * 50));
          const next = await this.redis.readJson<CachedToken>(this.key);
          if (next.state === 'hit' && this.valid(next.value)) { this.telemetry.increment('sabre_oauth_token_cache_hit'); return next.value.accessToken; }
          if (next.state === 'unavailable') break;
        }
        throw unavailable();
      }
      if (this.config.APP_ENV === 'production') throw unavailable();
    } else if (this.config.APP_ENV === 'production') throw unavailable();
    if (this.local && this.valid(this.local)) return this.local.accessToken;
    if (this.localInflight) return this.localInflight;
    this.localInflight = (async () => {
      const fresh = await this.fetcher.fetchToken();
      const ttl = Math.floor(fresh.expiresInSeconds - this.config.SABRE_TOKEN_EXPIRY_SKEW_SECONDS);
      if (!fresh.accessToken || ttl < 1) throw unavailable();
      this.local = { accessToken: fresh.accessToken, expiresAt: Date.now() + ttl * 1000,
        fingerprint: createHash('sha256').update(fresh.accessToken).digest('hex') };
      this.telemetry.increment('sabre_oauth_token_refresh');
      return fresh.accessToken;
    })();
    try { return await this.localInflight; } finally { this.localInflight = undefined; }
  }
  async invalidate(accessToken: string): Promise<void> {
    const fingerprint = createHash('sha256').update(accessToken).digest('hex');
    if (this.local?.fingerprint === fingerprint) this.local = undefined;
    if (this.redis) await this.redis.deleteJsonIfFingerprint(this.key, fingerprint);
  }
}
