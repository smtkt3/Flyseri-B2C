import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { APP_CONFIG, DATABASE_CONNECTION } from '../tokens.js';
import { TravelService } from './travel.service.js';
const secret = 'travel-test-secret-that-is-longer-than-thirty-two';
const id = '2180bb11-0867-41b7-a6e3-e078db38851e';
function token(role: string) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ iss:'seri-mechan-crm',aud:'flyseri-admin',sub:id,role,iat:now,exp:now+60 })).toString('base64url');
  return `v1.${body}.${createHmac('sha256',secret).update(`v1.${body}`).digest('base64url')}`;
}
describe('travel assistance API boundary', () => {
  let app: INestApplication;
  const update = vi.fn(async () => ({ id }));
  beforeAll(async () => {
    const config = parseConfig({ APP_ENV:'test',B2C_ADMIN_SHARED_SECRET:secret });
    const module = await Test.createTestingModule({ imports:[AppModule] })
      .overrideProvider(APP_CONFIG).useValue(config).overrideProvider(DATABASE_CONNECTION).useValue(undefined)
      .overrideProvider(TravelService).useValue({ requests:async()=>[], supportDetail:async()=>({ id }), updateRequest:update }).compile();
    app = module.createNestApplication({ logger:false }); configureApp(app,config,createLogger('test')); await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('requires customer authentication for watches and approvals', async () => {
    await request(app.getHttpServer()).get('/api/v1/travel/fare-watches').expect(401);
    await request(app.getHttpServer()).post('/api/v1/travel/fare-watches').send({}).expect(401);
    await request(app.getHttpServer()).post(`/api/v1/travel/support-requests/${id}/approve`).send({expectedVersion:1}).expect(401);
  });
  it('restricts the staff queue to authorized support roles', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/travel/support-requests').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/travel/support-requests').set('Authorization',`Bearer ${token('payment_staff')}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/travel/support-requests').set('Authorization',`Bearer ${token('support_staff')}`).expect(200);
  });
  it('rejects malformed quotes and browser-controlled approval fields before storage', async () => {
    const path = `/api/v1/admin/travel/support-requests/${id}`;
    const headers = { Authorization:`Bearer ${token('support_staff')}` };
    await request(app.getHttpServer()).post(path).set(headers).send({expectedVersion:1,stage:'QUOTE_READY',message:'A quote',quote:{amount:-2,currency:'BDT',description:'Fee',expiresAt:'not-date'}}).expect(400);
    await request(app.getHttpServer()).post(path).set(headers).send({expectedVersion:1,stage:'REVIEWING',message:'Checking',customerId:id}).expect(400);
    expect(update).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(path).set(headers).send({expectedVersion:1,stage:'REVIEWING',message:'Checking'}).expect(201);
    expect(update).toHaveBeenCalledWith(id,{expectedVersion:1,stage:'REVIEWING',message:'Checking'},{staffUserId:id,role:'support_staff'},expect.any(String));
  });
});
