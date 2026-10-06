import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import type { Pool } from 'pg';
import { parseConfig } from '@flyseri/config';
import type { FlyseriLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { CUSTOMER_STORE, TOKEN_VERIFIER, TRIP_STORE } from '../tokens.js';
import { DrizzleCustomerStore } from '../customer/customer.repository.js';
import { DrizzleTripStore } from './trip.repository.js';

const aliceId = randomUUID();
const bobId = randomUUID();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('trip ownership and workspace API', () => {
  let app: INestApplication;
  let database: ReturnType<typeof newDb>;
  let aliceTraveller: string;
  let bobTraveller: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.APP_ENV = 'test'; delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
    database = newDb();
    database.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true });
    for (const filename of ['0000_mean_ultimates.sql', '0001_nasty_thor.sql', '0003_famous_stranger.sql', '0005_mighty_blob.sql', '0007_kind_lady_bullseye.sql']) {
      const migration = readFileSync(resolve(process.cwd(), '../../packages/database/drizzle', filename), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) database.public.none(statement);
    }
    const adapter = database.adapters.createPg();
    for (const prototype of [adapter.Pool.prototype, adapter.Client.prototype]) {
      const original = prototype.query as unknown as (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      Object.defineProperty(prototype, 'query', { value: async function (query: unknown, ...args: unknown[]) {
        if (typeof query === 'object' && query !== null && ('types' in query || 'rowMode' in query)) {
          const { types: _types, rowMode, ...withoutOptions } = query as Record<string, unknown>;
          const result = await original.call(this, withoutOptions, ...args);
          return rowMode === 'array' ? { ...result, rows: result.rows.map((row) => Object.values(row)) } : result;
        }
        return original.call(this, query, ...args);
      } });
    }
    const db = drizzle(new adapter.Pool() as unknown as Pool, { schema });
    const connection = { db } as unknown as DatabaseConnection;
    const verifier = { verify: vi.fn(async (token: string) => token === 'alice' ? { authUserId: aliceId } : token === 'bob' ? { authUserId: bobId } : null) };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_STORE).useValue(new DrizzleCustomerStore(connection))
      .overrideProvider(TRIP_STORE).useValue(new DrizzleTripStore(connection))
      .overrideProvider(TOKEN_VERIFIER).useValue(verifier).compile();
    app = module.createNestApplication();
    configureApp(app, parseConfig(process.env), { info: vi.fn(), error: vi.fn() } as unknown as FlyseriLogger);
    await app.init();
    const alice = await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer('alice')).send({ legalFirstName: 'Ain', legalLastName: 'Rahman', relationshipType: 'SELF' }).expect(201);
    const bob = await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer('bob')).send({ legalFirstName: 'Bob', legalLastName: 'Lee', relationshipType: 'SELF' }).expect(201);
    aliceTraveller = alice.body.data.id as string;
    bobTraveller = bob.body.data.id as string;
  });
  afterAll(async () => { await app?.close(); });

  it('requires authentication and validates request IDs', async () => {
    const unauthorized = await request(app.getHttpServer()).get('/api/v1/trips').expect(401);
    expect(unauthorized.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    await request(app.getHttpServer()).get('/api/v1/trips/not-a-uuid').set(bearer('alice')).expect(400);
  });

  it('rejects a foreign traveller before creating any trip', async () => {
    const count = database.public.many('select id from trips').length;
    const result = await request(app.getHttpServer()).post('/api/v1/trips').set(bearer('alice'))
      .send({ title: 'Foreign traveller', travellerIds: [bobTraveller], destinations: [{ countryCode: 'JP' }] }).expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(database.public.many('select id from trips')).toHaveLength(count);
    expect(database.public.many('select id from trip_travellers')).toHaveLength(0);
  });

  it('creates a planning trip with nullable dates, ordered destinations and an owned traveller', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/trips').set(bearer('alice'))
      .send({ title: 'Japan family holiday', destinations: [{ countryCode: 'JP', cityName: 'Tokyo' }, { countryCode: 'JP', cityName: 'Kyoto' }], travellerIds: [aliceTraveller] }).expect(201);
    tripId = created.body.data.id as string;
    expect(created.body.data.startDate).toBeNull();
    expect(created.body.data.destinations.map((item: { cityName: string }) => item.cityName)).toEqual(['Tokyo', 'Kyoto']);
    expect(created.body.data.travellers[0].legalFirstName).toBe('Ain');
    const dbTrip = database.public.one(`select customer_id from trips where id = '${tripId}'`);
    const alice = database.public.one(`select id from customers where auth_user_id = '${aliceId}'`);
    expect(dbTrip.customer_id).toBe(alice.id);
    expect(database.public.many(`select id from trip_travellers where trip_id = '${tripId}'`)).toHaveLength(1);
  });

  it('lists only the signed-in customer’s trips', async () => {
    const alice = await request(app.getHttpServer()).get('/api/v1/trips').set(bearer('alice')).expect(200);
    const bob = await request(app.getHttpServer()).get('/api/v1/trips').set(bearer('bob')).expect(200);
    expect(alice.body.data).toHaveLength(1);
    expect(bob.body.data).toHaveLength(0);
    expect(alice.body.data[0].travellerCount).toBe(1);
  });

  it('blocks trip and nested traveller IDOR operations', async () => {
    await request(app.getHttpServer()).get(`/api/v1/trips/${tripId}`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).patch(`/api/v1/trips/${tripId}`).set(bearer('bob')).send({ title: 'Stolen' }).expect(404);
    await request(app.getHttpServer()).delete(`/api/v1/trips/${tripId}`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/trips/${tripId}/travellers`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/travellers`).set(bearer('bob')).send({ travellerId: bobTraveller }).expect(404);
    await request(app.getHttpServer()).delete(`/api/v1/trips/${tripId}/travellers/${aliceTraveller}`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/destinations`).set(bearer('bob')).send({ countryCode: 'BD' }).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/trips/${tripId}/destinations`).set(bearer('bob')).expect(404);
    const stop = database.public.one(`select id from trip_destinations where trip_id = '${tripId}' order by sequence limit 1`);
    await request(app.getHttpServer()).patch(`/api/v1/trips/${tripId}/destinations/${stop.id}`).set(bearer('bob')).send({ cityName: 'Changed' }).expect(404);
    await request(app.getHttpServer()).delete(`/api/v1/trips/${tripId}/destinations/${stop.id}`).set(bearer('bob')).expect(404);
    const own = await request(app.getHttpServer()).get(`/api/v1/trips/${tripId}`).set(bearer('alice')).expect(200);
    expect(own.body.data.title).toBe('Japan family holiday');
  });

  it('rejects invalid dates, duplicate travellers and unknown fields', async () => {
    await request(app.getHttpServer()).patch(`/api/v1/trips/${tripId}`).set(bearer('alice'))
      .send({ startDate: '2026-12-10', endDate: '2026-12-01' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/trips').set(bearer('alice'))
      .send({ startDate: '2026-02-30' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/trips').set(bearer('alice'))
      .send({ customerId: bobId }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/travellers`).set(bearer('alice'))
      .send({ travellerId: aliceTraveller }).expect(409);
    await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/travellers`).set(bearer('alice'))
      .send({ travellerId: bobTraveller }).expect(400);
    expect(database.public.many(`select id from trip_travellers where trip_id = '${tripId}'`)).toHaveLength(1);
  });

  it('updates trip data and manages destinations and travellers', async () => {
    const updated = await request(app.getHttpServer()).patch(`/api/v1/trips/${tripId}`).set(bearer('alice'))
      .send({ title: 'Japan in winter', startDate: '2026-12-10', endDate: '2026-12-20' }).expect(200);
    expect(updated.body.data.title).toBe('Japan in winter');
    expect(updated.body.data.startDate).toBe('2026-12-10');
    const added = await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/destinations`).set(bearer('alice'))
      .send({ countryCode: 'JP', cityName: 'Osaka' }).expect(201);
    const destinationId = added.body.data.destinations[2].id as string;
    await request(app.getHttpServer()).patch(`/api/v1/trips/${tripId}/destinations/${destinationId}`).set(bearer('alice'))
      .send({ cityName: 'Nara' }).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/trips/${tripId}/destinations/${destinationId}`).set(bearer('alice')).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/trips/${tripId}/travellers/${aliceTraveller}`).set(bearer('alice')).expect(200);
    const readded = await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/travellers`).set(bearer('alice'))
      .send({ travellerId: aliceTraveller }).expect(201);
    expect(readded.body.data.travellers).toHaveLength(1);
  });

  it('archives a trip without deleting history', async () => {
    await request(app.getHttpServer()).delete(`/api/v1/trips/${tripId}`).set(bearer('alice')).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/trips/${tripId}`).set(bearer('alice')).expect(404);
    const active = await request(app.getHttpServer()).get('/api/v1/trips').set(bearer('alice')).expect(200);
    const archived = await request(app.getHttpServer()).get('/api/v1/trips?archived=true').set(bearer('alice')).expect(200);
    expect(active.body.data).toHaveLength(0);
    expect(archived.body.data).toHaveLength(1);
    expect(database.public.many(`select id from trips where id = '${tripId}'`)).toHaveLength(1);
  });
});
