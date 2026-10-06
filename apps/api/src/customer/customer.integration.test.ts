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
import { customers, customerTravellers, travellers, auditEvents, type DatabaseConnection } from '@flyseri/database';
import type { Pool } from 'pg';
import { parseConfig } from '@flyseri/config';
import type { FlyseriLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { CUSTOMER_STORE, TOKEN_VERIFIER } from '../tokens.js';
import { DrizzleCustomerStore } from './customer.repository.js';

const aliceId = randomUUID();
const bobId = randomUUID();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('customer identity and ownership', () => {
  let app: INestApplication;
  let store: DrizzleCustomerStore;
  let database: ReturnType<typeof newDb>;
  const logs = vi.fn();
  const errors = vi.fn();

  beforeAll(async () => {
    process.env.APP_ENV = 'test';
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    database = newDb();
    database.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true });
    for (const filename of ['0000_mean_ultimates.sql', '0001_nasty_thor.sql', '0003_famous_stranger.sql', '0005_mighty_blob.sql', '0007_kind_lady_bullseye.sql']) {
      const migration = readFileSync(resolve(process.cwd(), '../../packages/database/drizzle', filename), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) database.public.none(statement);
    }
    const adapter = database.adapters.createPg();
    for (const prototype of [adapter.Pool.prototype, adapter.Client.prototype]) {
      const original = (prototype.query as unknown as (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>);
      Object.defineProperty(prototype, 'query', { value: async function (query: unknown, ...args: unknown[]) {
        if (typeof query === 'object' && query !== null && ('types' in query || 'rowMode' in query)) {
          const { types: _types, rowMode, ...withoutOptions } = query as Record<string, unknown>;
          const result = await original.call(this, withoutOptions, ...args);
          return rowMode === 'array' ? { ...result, rows: result.rows.map((row) => Object.values(row)) } : result;
        }
        return original.call(this, query, ...args);
      } });
    }
    const pool = new adapter.Pool() as unknown as Pool;
    const db = drizzle(pool, { schema: { customers, customerTravellers, travellers, auditEvents } });
    store = new DrizzleCustomerStore({ db } as unknown as DatabaseConnection);
    const verifier = { verify: vi.fn(async (token: string) => token === 'alice' ? { authUserId: aliceId } : token === 'bob' ? { authUserId: bobId } : null) };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_STORE).useValue(store)
      .overrideProvider(TOKEN_VERIFIER).useValue(verifier)
      .compile();
    app = module.createNestApplication();
    configureApp(app, parseConfig(process.env), { info: logs, error: errors } as unknown as FlyseriLogger);
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('requires authentication and returns a request ID', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(result.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(result.body.error.requestId).toBe(result.headers['x-request-id']);
  });

  it('bootstraps one customer across concurrent first requests', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app.getHttpServer()).get('/api/v1/me').set(bearer('alice')).expect(200)));
    expect(results.every((result) => result.body.data.displayName === null)).toBe(true);
    expect(database.public.many(`select * from customers where auth_user_id = '${aliceId}'`)).toHaveLength(1);
    await request(app.getHttpServer()).get('/api/v1/me').set(bearer('alice')).expect(200);
    expect(database.public.many(`select * from customers where auth_user_id = '${aliceId}'`)).toHaveLength(1);
  });

  it('keeps profile updates owned and rejects unknown fields', async () => {
    await request(app.getHttpServer()).patch('/api/v1/me').set(bearer('alice')).send({ displayName: 'Alice' }).expect(200);
    const own = await request(app.getHttpServer()).get('/api/v1/me').set(bearer('alice')).expect(200);
    const other = await request(app.getHttpServer()).get('/api/v1/me').set(bearer('bob')).expect(200);
    expect(own.body.data.displayName).toBe('Alice');
    expect(other.body.data.displayName).toBeNull();
    const invalid = await request(app.getHttpServer()).patch('/api/v1/me').set(bearer('alice')).send({ authUserId: bobId }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a traveller and relationship together', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer('alice'))
      .send({ legalFirstName: 'Aisha', legalLastName: 'Rahman', relationshipType: 'SELF', dateOfBirth: '2000-01-01', nationalityCountryCode: 'MY' }).expect(201);
    expect(result.body.data.dateOfBirth).toBe('2000-01-01');
    const id = result.body.data.id as string;
    expect(database.public.many(`select * from travellers where id = '${id}'`)).toHaveLength(1);
    expect(database.public.many(`select * from customer_travellers where traveller_id = '${id}'`)).toHaveLength(1);
  });

  it('rejects a conflicting primary relationship without an orphan traveller', async () => {
    const before = database.public.many('select id from travellers').length;
    const result = await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer('alice'))
      .send({ legalFirstName: 'Second', legalLastName: 'Self', relationshipType: 'SELF' }).expect(409);
    expect(result.body.error.code).toBe('CONFLICT');
    expect(database.public.many('select id from travellers')).toHaveLength(before);
  });

  it('blocks cross-customer GET, PATCH, and DELETE by returning 404', async () => {
    const own = await request(app.getHttpServer()).get('/api/v1/travellers').set(bearer('alice')).expect(200);
    const id = own.body.data[0].id as string;
    await request(app.getHttpServer()).get(`/api/v1/travellers/${id}`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).patch(`/api/v1/travellers/${id}`).set(bearer('bob')).send({ legalFirstName: 'Changed' }).expect(404);
    await request(app.getHttpServer()).delete(`/api/v1/travellers/${id}`).set(bearer('bob')).expect(404);
    const unchanged = await request(app.getHttpServer()).get(`/api/v1/travellers/${id}`).set(bearer('alice')).expect(200);
    expect(unchanged.body.data.legalFirstName).toBe('Aisha');
  });

  it('rejects invalid DOB, country codes, and unknown fields', async () => {
    const base = { legalFirstName: 'Sam', legalLastName: 'Lee', relationshipType: 'FRIEND' };
    for (const patch of [{ dateOfBirth: '2999-01-01' }, { dateOfBirth: '2000-02-30' }, { nationalityCountryCode: 'ZZZ' }, { customerId: randomUUID() }]) {
      const result = await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer('alice')).send({ ...base, ...patch }).expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('archives an owned traveller and omits it from the list', async () => {
    const own = await request(app.getHttpServer()).get('/api/v1/travellers').set(bearer('alice')).expect(200);
    const id = own.body.data[0].id as string;
    await request(app.getHttpServer()).delete(`/api/v1/travellers/${id}`).set(bearer('alice')).expect(200);
    const after = await request(app.getHttpServer()).get('/api/v1/travellers').set(bearer('alice')).expect(200);
    expect(after.body.data).toHaveLength(0);
  });

  it('never logs tokens or traveller PII in request logs', () => {
    const entries = JSON.stringify(logs.mock.calls);
    expect(entries).not.toContain('alice');
    expect(entries).not.toContain('Aisha');
    expect(entries).not.toContain('2000-01-01');
  });
});
