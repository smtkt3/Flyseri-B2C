import { describe, expect, it } from 'vitest';
import { parseConfig } from './index.js';

describe('parseConfig', () => {
  it('uses safe local defaults', () => {
    expect(parseConfig({})).toMatchObject({ APP_ENV: 'development', API_PORT: 3001, WEB_ORIGIN: 'http://localhost:8443' });
  });
  it('rejects malformed ports and origins', () => {
    expect(() => parseConfig({ API_PORT: '0' })).toThrow('API_PORT');
    expect(() => parseConfig({ WEB_ORIGIN: 'javascript:alert(1)' })).toThrow('WEB_ORIGIN');
  });
  it('requires an explicit production origin', () => {
    expect(() => parseConfig({ APP_ENV: 'production' })).toThrow('WEB_ORIGIN');
  });
  it('keeps Sabre settings server-side, rejects partial setup and bounds supplier traffic controls', () => {
    expect(() => parseConfig({ SABRE_CLIENT_SECRET: 'secret' })).toThrow('incomplete Sabre configuration');
    expect(() => parseConfig({ SABRE_REQUEST_TIMEOUT_MS: 60000 })).toThrow('SABRE_REQUEST_TIMEOUT_MS');
    expect(parseConfig({})).toMatchObject({ SABRE_ENV: 'CERT', SABRE_BFM_CACHE_TTL_SECONDS: 60, SABRE_PROVIDER_MAX_CONCURRENT: 12 });
  });
  it('requires a Stripe test secret before enabling checkout and rejects production mode', () => {
    expect(parseConfig({})).toMatchObject({ PAYMENT_PROVIDER: 'NONE', PAYMENT_CHECKOUT_ENABLED: 'false' });
    expect(() => parseConfig({ PAYMENT_CHECKOUT_ENABLED: 'true' })).toThrow('Stripe test checkout');
    expect(() => parseConfig({ PAYMENT_PROVIDER: 'UNVERIFIED' })).toThrow('PAYMENT_PROVIDER');
    expect(() => parseConfig({ PAYMENT_PROVIDER: 'STRIPE_TEST', PAYMENT_CHECKOUT_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123456789', STRIPE_WEBHOOK_SECRET: 'whsec_123456789', APP_ENV: 'production',
      WEB_ORIGIN: 'https://example.com', DATABASE_URL: 'postgresql://localhost:5432/flyseri', REDIS_URL: 'redis://localhost:6379',
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'a'.repeat(20),
      SUPABASE_STORAGE_SECRET_KEY: 'b'.repeat(20) })).toThrow('Stripe test checkout');
    expect(parseConfig({ PAYMENT_PROVIDER: 'STRIPE_TEST', PAYMENT_CHECKOUT_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123456789' }))
      .toMatchObject({ PAYMENT_PROVIDER: 'STRIPE_TEST', PAYMENT_CHECKOUT_ENABLED: 'true' });
  });
});
