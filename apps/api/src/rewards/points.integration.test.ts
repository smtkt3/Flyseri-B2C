import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { APP_CONFIG, CUSTOMER_STORE, TOKEN_VERIFIER } from '../tokens.js';
import { PointsService } from './points.service.js';
const customer=randomUUID(),foreign=randomUUID(),order=randomUUID(),staff=randomUUID(),secret='points-test-shared-secret-32-characters';
function token(role:string){const now=Math.floor(Date.now()/1000),payload=Buffer.from(JSON.stringify({iss:'seri-mechan-crm',aud:'flyseri-admin',sub:staff,role,iat:now,exp:now+45})).toString('base64url');return `v1.${payload}.${createHmac('sha256',secret).update(`v1.${payload}`).digest('base64url')}`;}
describe('points API authorization and validation',()=>{
  let app:INestApplication;
  const service={wallet:vi.fn(async(id:string,page:number)=>({owner:id,page})),quote:vi.fn(async(id:string,booking:string)=>({owner:id,orderId:booking})),apply:vi.fn(async()=>({applied:100})),verify:vi.fn(),refund:vi.fn(),adjust:vi.fn()};
  beforeAll(async()=>{
    const config=parseConfig({APP_ENV:'test',B2C_ADMIN_SHARED_SECRET:secret});
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config)
      .overrideProvider(TOKEN_VERIFIER).useValue({verify:async(t:string)=>t==='customer'?{authUserId:randomUUID()}:null})
      .overrideProvider(CUSTOMER_STORE).useValue({bootstrap:async()=>({id:customer,status:'ACTIVE',profile:{}})})
      .overrideProvider(PointsService).useValue(service).compile();
    app=module.createNestApplication({logger:false});configureApp(app,config,createLogger('test'));await app.init();
  });
  afterAll(async()=>{await app?.close();});
  it('requires authentication and derives ownership from the signed-in user',async()=>{
    await request(app.getHttpServer()).get('/api/v1/points').expect(401);
    const own=await request(app.getHttpServer()).get('/api/v1/points?page=2').set('Authorization','Bearer customer').expect(200);
    expect(own.body.data).toEqual({owner:customer,page:2});
    await request(app.getHttpServer()).get(`/api/v1/points?customerId=${foreign}`).set('Authorization','Bearer customer').expect(400);
    await request(app.getHttpServer()).get('/api/v1/points?page=-1').set('Authorization','Bearer customer').expect(400);
  });
  it('rejects fractional, negative, client-priced and invalid order requests',async()=>{
    for(const body of [{points:1.5},{points:-1},{points:100,amount:'1.00'},{points:100,customerId:foreign}])await request(app.getHttpServer()).post(`/api/v1/points/orders/${order}`).set('Authorization','Bearer customer').send(body).expect(400);
    await request(app.getHttpServer()).get('/api/v1/points/orders/invalid').set('Authorization','Bearer customer').expect(400);
    const response=await request(app.getHttpServer()).get(`/api/v1/points/orders/${order}`).set('Authorization','Bearer customer').expect(200);
    expect(response.body.data.owner).toBe(customer);
  });
  it('restricts adjustments and journey/refund verification to owners with required evidence',async()=>{
    const path=`/api/v1/admin/points/customers/${customer}/adjust`,body={points:100,idempotencyKey:randomUUID(),evidence:'Approved adjustment reference'};
    await request(app.getHttpServer()).post(path).set('Authorization','Bearer customer').send(body).expect(401);
    await request(app.getHttpServer()).post(path).set('Authorization',`Bearer ${token('payment_staff')}`).send(body).expect(403);
    await request(app.getHttpServer()).post(path).set('Authorization',`Bearer ${token('owner')}`).send({...body,evidence:''}).expect(400);
    await request(app.getHttpServer()).post(path).set('Authorization',`Bearer ${token('owner')}`).send(body).expect(201);
    expect(service.adjust).toHaveBeenCalledWith(customer,100,body.idempotencyKey,staff,body.evidence);
    await request(app.getHttpServer()).post(`/api/v1/admin/points/customers/${customer}/orders/${order}/refund`).set('Authorization',`Bearer ${token('owner')}`).send({cumulativeEligibleRefund:'25000.00',evidence:'Verified provider refund reference'}).expect(201);
    expect(service.refund).toHaveBeenCalledWith(customer,order,'25000.00',staff,'Verified provider refund reference');
  });
});
