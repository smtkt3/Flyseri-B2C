import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { APP_CONFIG, COMMERCE_REPOSITORY, CUSTOMER_STORE, TOKEN_VERIFIER } from '../tokens.js';

const customerA = randomUUID(), customerB = randomUUID(), authA = randomUUID(), authB = randomUUID();
const intentId = randomUUID(), orderId = randomUUID();
const order = { id: orderId, orderNumber: 'SMO-TEST', status: 'PENDING_PAYMENT', totalAmount: '1280.50', currency: 'MYR',
  items: [], payment: null };

describe('commerce API ownership', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const config = parseConfig({ APP_ENV: 'test' });
    const repository = { createFlightOrder: async (customerId: string, id: string) => customerId === customerA && id === intentId ? order : null,
      detail: async (customerId: string, id: string) => customerId === customerA && id === orderId ? order : null,
      list: async (customerId: string) => customerId === customerA ? [order] : [],
      payments: async () => [], payment: async () => null };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(config)
      .overrideProvider(TOKEN_VERIFIER).useValue({ verify: async (token: string) => token === 'a' ? { authUserId: authA } : token === 'b' ? { authUserId: authB } : null })
      .overrideProvider(CUSTOMER_STORE).useValue({ bootstrap: async (authUserId: string) => ({ id: authUserId === authA ? customerA : customerB, status: 'ACTIVE', profile: {} }) })
      .overrideProvider(COMMERCE_REPOSITORY).useValue(repository)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app, config, createLogger('test'));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('requires authentication, rejects price injection, and validates IDs', async () => {
    await request(app.getHttpServer()).get('/api/v1/orders').expect(401);
    await request(app.getHttpServer()).post('/api/v1/orders/flight').set('Authorization', 'Bearer a')
      .send({ bookingIntentId: intentId, totalAmount: '0.01' }).expect(400);
    await request(app.getHttpServer()).get('/api/v1/orders/not-a-uuid').set('Authorization', 'Bearer a').expect(400);
  });
  it('isolates order reads and leaves checkout unavailable', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/orders/flight').set('Authorization', 'Bearer a')
      .send({ bookingIntentId: intentId }).expect(201);
    expect(created.body.data.id).toBe(orderId);
    const ownList = await request(app.getHttpServer()).get('/api/v1/orders').set('Authorization', 'Bearer a').expect(200);
    expect(ownList.body.data).toHaveLength(1);
    const foreignList = await request(app.getHttpServer()).get('/api/v1/orders').set('Authorization', 'Bearer b').expect(200);
    expect(foreignList.body.data).toEqual([]);
    await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}`).set('Authorization', 'Bearer b').expect(404);
    await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}/receipt`).set('Authorization', 'Bearer b').expect(404);
    await request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/payments`).set('Authorization', 'Bearer b')
      .send({ idempotencyKey: randomUUID() }).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/payments`).set('Authorization', 'Bearer a')
      .send({ idempotencyKey: randomUUID() }).expect(503);
    await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}/receipt`).set('Authorization', 'Bearer a').expect(409);
  });
});
