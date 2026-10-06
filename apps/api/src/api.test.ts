import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { resolveRequestId } from './request-context.js';

describe('API foundation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    process.env.APP_ENV = 'test';
    const config = parseConfig(process.env);
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app, config, createLogger('test'));
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('returns a health response with a generated request ID', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data.status).toBe('ok');
    expect(result.body.requestId).toBe(result.headers['x-request-id']);
    expect(resolveRequestId(result.body.requestId)).toBe(result.body.requestId);
  });

  it('propagates a valid incoming request ID', async () => {
    const id = 'aef8b4d2-8ab1-41f6-94c3-b31289fb5b84';
    const result = await request(app.getHttpServer()).get('/api/v1/health').set('X-Request-ID', id).expect(200);
    expect(result.body.requestId).toBe(id);
  });

  it('rejects invalid request IDs and generates a new one', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/health').set('X-Request-ID', 'unsafe').expect(200);
    expect(result.body.requestId).not.toBe('unsafe');
  });

  it('standardizes 404 and validation errors', async () => {
    const missing = await request(app.getHttpServer()).get('/api/v1/missing').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(missing.body.error.requestId).toBe(missing.headers['x-request-id']);
    const invalid = await request(app.getHttpServer()).get('/api/v1/health?details=maybe').expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports unconfigured optional dependencies without revealing connection details', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(result.body.data.services).toEqual({ database: 'unconfigured', redis: 'unconfigured' });
  });

  it('validates public flight searches while protecting booking intents', async () => {
    const invalid = await request(app.getHttpServer()).post('/api/v1/flights/search').send({}).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    const privateResult = await request(app.getHttpServer()).post('/api/v1/flights/booking-intents').send({}).expect(401);
    expect(privateResult.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
