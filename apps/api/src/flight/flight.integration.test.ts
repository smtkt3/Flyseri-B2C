import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { APP_CONFIG, CUSTOMER_STORE, FLIGHT_PROVIDER, REDIS_STORE, TOKEN_VERIFIER, TRIP_STORE } from '../tokens.js';
import { FlightRateGuard } from './flight-rate.guard.js';

const userId = 'aef8b4d2-8ab1-41f6-94c3-b31289fb5b84';
const customerId = '1d2e40c6-e035-4ca4-aa71-9b1b8d215a4b';
const secondUserId = 'be290108-4666-47e0-9bed-03fe10a2e17f';
const secondCustomerId = '06c10ed5-bddd-4afc-970f-f1ab11904e36';
const tripId = '2180bb11-0867-41b7-a6e3-e078db38851e';
const body = { origin: 'KUL', destination: 'NRT', departureDate: '2026-12-10', returnDate: '2026-12-20', tripType: 'ROUND_TRIP', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };

describe('flight search API contract', () => {
  let app: INestApplication;
  const search = vi.fn(async (..._args: unknown[]) => []);
  const detail = vi.fn(async () => null);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(parseConfig({ APP_ENV: 'test', SABRE_SEARCH_RATE_LIMIT_PER_MINUTE: 100 }))
      .overrideProvider(REDIS_STORE).useValue(undefined)
      .overrideProvider(TOKEN_VERIFIER).useValue({ verify: async (token: string) => token === 'valid' ? { authUserId: userId } : token === 'valid-second' ? { authUserId: secondUserId } : null })
      .overrideProvider(CUSTOMER_STORE).useValue({ bootstrap: async (authUserId: string) => ({ id: authUserId === secondUserId ? secondCustomerId : customerId, status: 'ACTIVE', profile: { displayName: null, phoneCountryCode: null, phoneNumber: null, preferredLanguage: null, preferredCurrency: null } }) })
      .overrideProvider(TRIP_STORE).useValue({ detail })
      .overrideProvider(FLIGHT_PROVIDER).useValue({ search })
      .overrideProvider(FlightRateGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app, parseConfig({ APP_ENV: 'test' }), createLogger('test'));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('accepts guest search, rejects invalid sessions and raw supplier fields', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/flights/search').send(body).expect(200);
    expect(guest.body.data).toMatchObject({ source: 'sabre', offers: [] });
    await request(app.getHttpServer()).post('/api/v1/flights/search').set('Authorization', 'Bearer invalid').send(body).expect(401);
    const unknown = await request(app.getHttpServer()).post('/api/v1/flights/search').set('Authorization', 'Bearer valid').send({ ...body, SabrePCC: 'ATTACK' }).expect(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect(search).toHaveBeenCalledOnce();
  });
  it('keeps trip searches and booking intents protected for guests', async () => {
    const trip = await request(app.getHttpServer()).post('/api/v1/flights/search').send({ ...body, tripId }).expect(401);
    expect(trip.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    await request(app.getHttpServer()).post('/api/v1/flights/booking-intents').send({}).expect(401);
    await request(app.getHttpServer()).get('/api/v1/flights/booking-intents').expect(401);
    expect(detail).not.toHaveBeenCalled();
  });
  it('accepts guest checkout details only through the validated server endpoint', async () => {
    const input = { searchId: '3f725b22-e74a-4c0c-a81b-7ea0377747dd', offerId: 'ed434e73-47b4-4b44-9084-ae190576ea68',
      idempotencyKey: 'fbda9c85-9358-4e99-9dfe-c34a65e08757', contactName: 'Jane Example',
      contactEmail: 'jane@example.test', contactPhone: '+60123456789', passengerNames: ['Jane Example'] };
    await request(app.getHttpServer()).post('/api/v1/flights/checkout-attempts')
      .send({ ...input, idNumber: 'must-not-be-stored' }).expect(400);
    const unavailable = await request(app.getHttpServer()).post('/api/v1/flights/checkout-attempts').send(input).expect(503);
    expect(unavailable.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
  it('rejects foreign trips before the provider', async () => {
    const foreign = await request(app.getHttpServer()).post('/api/v1/flights/search').set('Authorization', 'Bearer valid').send({ ...body, tripId }).expect(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');
    expect(detail).toHaveBeenCalledWith(customerId, tripId);
    expect(search).toHaveBeenCalledOnce();
  });
  it('returns a customer-safe successful empty result without supplier internals', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/flights/search').set('Authorization', 'Bearer valid').send(body).expect(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toMatchObject({ source: 'sabre', offers: [] });
    expect(result.body.data.searchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(search).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.body)).not.toContain('SabrePCC');
  });
  it('accepts ordered multi-city legs and rejects discontinuous or extra-leg searches', async () => {
    search.mockClear();
    const legs = [
      { origin: 'KUL', destination: 'NRT', departureDate: '2026-12-10' },
      { origin: 'NRT', destination: 'KIX', departureDate: '2026-12-14' },
      { origin: 'KIX', destination: 'KUL', departureDate: '2026-12-18' },
    ];
    await request(app.getHttpServer()).post('/api/v1/flights/search').set('Authorization', 'Bearer valid-second')
      .send({ ...body, origin: 'KUL', destination: 'KUL', departureDate: legs[0]!.departureDate, returnDate: undefined, tripType: 'MULTI_CITY', legs }).expect(200);
    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0]).toMatchObject({ tripType: 'MULTI_CITY', legs });
    await request(app.getHttpServer()).post('/api/v1/flights/search').set('Authorization', 'Bearer valid-second')
      .send({ ...body, origin: 'KUL', destination: 'KUL', departureDate: legs[0]!.departureDate, returnDate: undefined, tripType: 'MULTI_CITY', legs: [legs[0], { ...legs[1]!, origin: 'BKK' }] }).expect(400);
    expect(search).toHaveBeenCalledOnce();
  });
});
