import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { APP_CONFIG, BOOKING_INTENT_STORE, CUSTOMER_STORE, REDIS_STORE, TOKEN_VERIFIER } from '../tokens.js';
import { FlightService } from './flight.service.js';
import { ApiException } from '../api-exception.js';
import { BookingIntentConflictError } from './booking-intent.repository.js';

const authA = randomUUID(), authB = randomUUID(), customerA = randomUUID(), customerB = randomUUID();
const searchId = randomUUID(), offerId = randomUUID(), travellerId = randomUUID(), intentId = randomUUID();
const offer = { offerId, totalAmount: '1280.50', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { durationMinutes: 420, stops: 0, segments: [{ origin: 'KUL', destination: 'NRT', departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T16:00:00+09:00', marketingCarrier: 'MH', flightNumber: '70', durationMinutes: 420 }] }, inbound: null };
const intent = { id: intentId, tripId: null, status: 'CREATED', selectedOffer: offer, travellerIds: [travellerId], currency: 'MYR', searchTotalAmount: '1280.50', validatedTotalAmount: null, priceChanged: false, validatedAt: null, expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const body = { searchId, offerId, travellerIds: [travellerId], idempotencyKey: randomUUID() };

describe('flight booking intent API', () => {
  let app: INestApplication;
  const create = vi.fn(async (_input: unknown) => ({ intent, created: true }));
  const detail = vi.fn(async (customerId: string) => customerId === customerA ? intent : null);
  const list = vi.fn(async (customerId: string) => customerId === customerA ? [intent] : []);
  const cancel = vi.fn(async (customerId: string) => customerId === customerA ? { ...intent, status: 'CANCELLED' } : null);
  const confirmPrice = vi.fn(async (customerId: string) => {
    if (customerId !== customerA) return null;
    throw new BookingIntentConflictError();
  });
  const selectedOffer = vi.fn(async (customerId: string) => {
    if (customerId !== customerA) throw new ApiException('NOT_FOUND', 'Flight search not found.', 404);
    return { searchId, tripId: null, offer, search: { origin: 'KUL', destination: 'NRT', departureDate: '2026-12-10', tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' } };
  });
  beforeAll(async () => {
    const config = parseConfig({ APP_ENV: 'test' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(config)
      .overrideProvider(REDIS_STORE).useValue(undefined)
      .overrideProvider(TOKEN_VERIFIER).useValue({ verify: async (token: string) => token === 'a' ? { authUserId: authA } : token === 'b' ? { authUserId: authB } : null })
      .overrideProvider(CUSTOMER_STORE).useValue({ bootstrap: async (authUserId: string) => ({ id: authUserId === authA ? customerA : customerB, status: 'ACTIVE', profile: {} }) })
      .overrideProvider(BOOKING_INTENT_STORE).useValue({ create, detail, list, cancel, confirmPrice })
      .overrideProvider(FlightService).useValue({ selectedOffer })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app, config, createLogger('test'));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('requires authentication and rejects a browser price field', async () => {
    await request(app.getHttpServer()).post('/api/v1/flights/booking-intents').send(body).expect(401);
    await request(app.getHttpServer()).post('/api/v1/flights/booking-intents').set('Authorization', 'Bearer a').send({ ...body, totalAmount: '0.01' }).expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('creates from an owned server-side offer and protects every intent endpoint', async () => {
    const made = await request(app.getHttpServer()).post('/api/v1/flights/booking-intents').set('Authorization', 'Bearer a').send(body).expect(201);
    expect(made.body.data.id).toBe(intentId);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({ customerId: customerA, searchId, offerId, offer });
    await request(app.getHttpServer()).post('/api/v1/flights/booking-intents').set('Authorization', 'Bearer b').send(body).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/flights/booking-intents/${intentId}`).set('Authorization', 'Bearer b').expect(404);
    const foreignList = await request(app.getHttpServer()).get(`/api/v1/flights/booking-intents?tripId=${randomUUID()}`).set('Authorization', 'Bearer b').expect(200);
    expect(foreignList.body.data).toEqual([]);
    await request(app.getHttpServer()).post(`/api/v1/flights/booking-intents/${intentId}/validate`).set('Authorization', 'Bearer b').expect(404);
    await request(app.getHttpServer()).post(`/api/v1/flights/booking-intents/${intentId}/confirm-price`).set('Authorization', 'Bearer b').expect(404);
    await request(app.getHttpServer()).post(`/api/v1/flights/booking-intents/${intentId}/confirm-price`).set('Authorization', 'Bearer a').expect(409);
    await request(app.getHttpServer()).delete(`/api/v1/flights/booking-intents/${intentId}`).set('Authorization', 'Bearer b').expect(404);
    await request(app.getHttpServer()).post(`/api/v1/flights/booking-intents/${intentId}/validate`).set('Authorization', 'Bearer a').expect(503);
    await request(app.getHttpServer()).get(`/api/v1/flights/booking-intents/${intentId}`).set('Authorization', 'Bearer a').expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/flights/booking-intents/${intentId}`).set('Authorization', 'Bearer a').expect(200);
    await request(app.getHttpServer()).get('/api/v1/flights/booking-intents/not-a-uuid').set('Authorization', 'Bearer a').expect(400);
  });
  it('validates optional traveller service requests and forwards them without a price', async () => {
    const service = { travellerId, meal: 'HALAL', baggage: 'EXTRA_CHECKED', wheelchair: 'TO_SEAT', assistance: 'HEARING', note: 'Please confirm these requests.' };
    const send = (serviceRequests: unknown[]) => request(app.getHttpServer()).post('/api/v1/flights/booking-intents')
      .set('Authorization', 'Bearer a').send({ ...body, idempotencyKey: randomUUID(), serviceRequests });
    await send([{ ...service, meal: 'INVALID' }]).expect(400);
    await send([{ ...service, note: 'x'.repeat(301) }]).expect(400);
    await send([{ ...service, amount: '0' }]).expect(400);
    await send([{ ...service, travellerId: randomUUID() }]).expect(400);
    await send([service, service]).expect(400);
    await send([service]).expect(201);
    expect(create.mock.calls.at(-1)?.[0]).toMatchObject({ serviceRequests: [service] });
  });
});
