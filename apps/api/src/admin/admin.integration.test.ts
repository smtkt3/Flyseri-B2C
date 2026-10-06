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
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminRecordsService } from './admin-records.service.js';
import { AdminDocumentsService } from './admin-documents.service.js';
import { AdminCommerceService } from './admin-commerce.service.js';
import { AdminFlightsService } from './admin-flights.service.js';
import { verifyAdminToken, type AdminRole } from './admin-auth.js';

const secret = 'a-local-test-secret-that-is-at-least-32-characters-long';
const staffId = 'aef8b4d2-8ab1-41f6-94c3-b31289fb5b84';
const resourceId = '2180bb11-0867-41b7-a6e3-e078db38851e';
const versionId = '2d0cb121-0e9f-4ec0-9a70-aa23f4d3097f';
function sign(role: AdminRole, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'seri-mechan-crm', aud: 'flyseri-admin', sub: staffId, role, iat: now, exp: now + 60, ...overrides })).toString('base64url');
  const unsigned = `v1.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

describe('Flyseri staff admin boundary', () => {
  let app: INestApplication;
  const data = { items: [], total: 0, page: 1, limit: 20 };
  const access = vi.fn(async () => ({ url: 'https://example.invalid/short-lived', expiresInSeconds: 60 }));
  const refreshBooking = vi.fn(async () => ({ id: resourceId, pnr: null, ticketStatus: 'NOT_VERIFIED' }));
  const visaList = vi.fn(async () => data);
  beforeAll(async () => {
    const config = parseConfig({ APP_ENV: 'test', B2C_ADMIN_SHARED_SECRET: secret });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(config)
      .overrideProvider(DATABASE_CONNECTION).useValue(undefined)
      .overrideProvider(AdminDashboardService).useValue({ summary: async () => ({ metrics: { customers: 0 }, needsAttention: [], recentActivity: [] }),
        aiMetrics: async () => ({ conversationsToday: 1, requests: 2, deterministicResponses: 1, llmRequests: 1, primaryRequests: 1,
          fallbackRequests: 0, toolCalls: 1, toolFailures: 0, averageLatencyMs: 18, inputTokens: 8, outputTokens: 3,
          confirmationsCreated: 0, confirmationsExecuted: 0, supportHandoffs: 0, rateLimitedRequests: 4,
          privateMessageContentIncluded: false, pricingConfigured: false }) })
      .overrideProvider(AdminRecordsService).useValue({ customers: async () => data, customer: async () => ({ id: resourceId }),
        travellers: async () => data, traveller: async () => ({ id: resourceId }), trips: async () => data, trip: async () => ({ id: resourceId }),
        visas: visaList, visa: async () => ({ id: resourceId }), audit: async () => data })
      .overrideProvider(AdminDocumentsService).useValue({ list: async () => data, detail: async () => ({ id: resourceId, versions: [] }), access })
      .overrideProvider(AdminCommerceService).useValue({ orders: async () => data, order: async () => ({ id: resourceId }),
        payments: async () => data, payment: async () => ({ id: resourceId }) })
      .overrideProvider(AdminFlightsService).useValue({ summary: () => ({ customerSearches: 0, sabreCalls: 0, activityHistoryAvailable: false }),
        checkoutAttempts: async () => data, checkoutAttempt: async () => ({ id: resourceId, pnr: null, paymentStatus: 'NOT_STARTED' }),
        bookings: async () => data, booking: async () => ({ id: resourceId, pnr: null, ticketStatus: 'NOT_VERIFIED' }), refresh: refreshBooking })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app, config, createLogger('test'));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('rejects unauthenticated, customer, forged, expired and wrong-audience tokens', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/customers').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/customers').set('Authorization', 'Bearer customer-token').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/customers').set('Authorization', `Bearer ${sign('owner')}x`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/customers').set('Authorization', `Bearer ${sign('owner', { exp: 1 })}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/customers').set('Authorization', `Bearer ${sign('owner', { aud: 'customer-web' })}`).expect(401);
    expect(verifyAdminToken(sign('owner'), secret)).toEqual({ staffUserId: staffId, role: 'owner' });
  });
  it('enforces staff permissions server-side and separates document metadata from content', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/customers').set('Authorization', `Bearer ${sign('support_staff')}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/documents').set('Authorization', `Bearer ${sign('support_staff')}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/visa').set('Authorization', `Bearer ${sign('support_staff')}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/admin/visa/${resourceId}/processing`).set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    await request(app.getHttpServer()).post('/api/v1/admin/visa/services').set('Authorization', `Bearer ${sign('support_staff')}`).send({}).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/visa').set('Authorization', `Bearer ${sign('payment_staff')}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/audit').set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/documents/${resourceId}/versions/${versionId}/access`)
      .set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    expect(access).not.toHaveBeenCalled();
    const granted = await request(app.getHttpServer()).get(`/api/v1/admin/documents/${resourceId}/versions/${versionId}/access`)
      .set('Authorization', `Bearer ${sign('owner')}`).expect(200);
    expect(granted.body.data).toEqual({ url: 'https://example.invalid/short-lived', expiresInSeconds: 60 });
    expect(JSON.stringify(granted.body)).not.toContain(secret);
    expect(access).toHaveBeenCalledWith(resourceId, versionId, { staffUserId: staffId, role: 'owner' }, expect.any(String), false);
  });
  it('restricts assisted visa fee edits to pricing administrators', async () => {
    for (const role of ['support_staff', 'payment_staff', 'ticketing_staff'] as AdminRole[]) {
      await request(app.getHttpServer()).get('/api/v1/admin/visa/assistance-fee').set('Authorization', `Bearer ${sign(role)}`).expect(403);
      await request(app.getHttpServer()).post('/api/v1/admin/visa/assistance-fee').set('Authorization', `Bearer ${sign(role)}`).send({amount:'50.00',currency:'MYR',basis:'APPLICATION',active:true}).expect(403);
    }
    await request(app.getHttpServer()).post('/api/v1/admin/visa/assistance-fee').set('Authorization', `Bearer ${sign('owner')}`).send({amount:'-1',currency:'MYR',basis:'APPLICATION',active:true}).expect(400);
  });
  it('does not publish a customer visa service without a payable configured fee', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/visa/services').set('Authorization', `Bearer ${sign('owner')}`).send({
      destinationCountryCode: 'JP', code: 'JP-TOURIST', name: 'Tourist visa', processingTimeText: '5 business days', published: true,
      formDefinition: { sections: [{ key: 'applicant', label: 'Applicant', fields: [{ key: 'given_name', label: 'Given name', type: 'TEXT', required: true }] }] },
    }).expect(400);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');
  });
  it('validates and forwards visa operational queue filters with a real boolean action flag', async () => {
    const authorization = `Bearer ${sign('support_staff')}`;
    visaList.mockClear();
    await request(app.getHttpServer()).get('/api/v1/admin/visa?paymentStatus=SUCCEEDED&createdFrom=2026-09-01&createdTo=2026-09-30&actionRequired=true&status=PAID')
      .set('Authorization', authorization).expect(200);
    expect(visaList).toHaveBeenLastCalledWith({ page: 1, limit: 20, paymentStatus: 'SUCCEEDED', createdFrom: '2026-09-01',
      createdTo: '2026-09-30', actionRequired: true, status: 'PAID' });
    await request(app.getHttpServer()).get('/api/v1/admin/visa?actionRequired=false').set('Authorization', authorization).expect(200);
    expect(visaList).toHaveBeenLastCalledWith({ page: 1, limit: 20, actionRequired: false });
    await request(app.getHttpServer()).get('/api/v1/admin/visa?paymentStatus=EXPIRED').set('Authorization', authorization).expect(200);
    expect(visaList).toHaveBeenLastCalledWith({ page: 1, limit: 20, paymentStatus: 'EXPIRED' });
    await request(app.getHttpServer()).get('/api/v1/admin/visa?paymentStatus=PAID').set('Authorization', authorization).expect(400);
  });
  it('returns safe validation errors and does not call Sabre for admin metrics', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/customers/not-a-uuid').set('Authorization', `Bearer ${sign('owner')}`).expect(400);
    const metrics = await request(app.getHttpServer()).get('/api/v1/admin/flights/search-activity').set('Authorization', `Bearer ${sign('owner')}`).expect(200);
    expect(metrics.body.data).toMatchObject({ customerSearches: 0, sabreCalls: 0, activityHistoryAvailable: false });
  });
  it('limits the booking queue to flight staff and returns no raw Sabre payload', async () => {
    const staff = `Bearer ${sign('ticketing_staff')}`;
    await request(app.getHttpServer()).get('/api/v1/admin/flights/bookings').set('Authorization', staff).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/flights/checkout-attempts').set('Authorization', staff).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/admin/flights/checkout-attempts/${resourceId}`).set('Authorization', staff).expect(200);
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/flights/bookings/${resourceId}`).set('Authorization', staff).expect(200);
    expect(detail.body.data).toEqual({ id: resourceId, pnr: null, ticketStatus: 'NOT_VERIFIED' });
    await request(app.getHttpServer()).get('/api/v1/admin/flights/bookings').set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/flights/checkout-attempts').set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/flights/bookings').expect(401);
    await request(app.getHttpServer()).post(`/api/v1/admin/flights/bookings/${resourceId}/refresh`)
      .set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    expect(refreshBooking).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(`/api/v1/admin/flights/bookings/${resourceId}/refresh`)
      .set('Authorization', staff).expect(201);
    expect(refreshBooking).toHaveBeenCalledWith(resourceId, { staffUserId: staffId, role: 'ticketing_staff' }, expect.any(String));
  });
  it('restricts Seri AI aggregates to owner and manager staff roles', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/ai/metrics').set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    const owner = await request(app.getHttpServer()).get('/api/v1/admin/ai/metrics').set('Authorization', `Bearer ${sign('owner')}`).expect(200);
    expect(owner.body.data).toMatchObject({ deterministicResponses: 1, llmRequests: 1, rateLimitedRequests: 4, privateMessageContentIncluded: false });
    expect(owner.body.data).not.toHaveProperty('messages');
    expect(owner.body.data).not.toHaveProperty('messageContent');
    expect(owner.body.data).not.toHaveProperty('conversationIds');
    await request(app.getHttpServer()).get('/api/v1/admin/ai/metrics').set('Authorization', `Bearer ${sign('manager')}`).expect(200);
  });
  it('allows payment staff to view commerce records but not unrelated customer data', async () => {
    const paymentStaff = `Bearer ${sign('payment_staff')}`;
    await request(app.getHttpServer()).get('/api/v1/admin/orders').set('Authorization', paymentStaff).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/payments').set('Authorization', paymentStaff).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/customers').set('Authorization', paymentStaff).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin/payments').set('Authorization', `Bearer ${sign('support_staff')}`).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/orders/${resourceId}`).set('Authorization', paymentStaff).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/orders/not-a-uuid').set('Authorization', paymentStaff).expect(400);
  });
});
