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
import { APP_CONFIG, COMMERCE_REPOSITORY, PAYMENT_PROVIDER } from '../tokens.js';
import { StripeTestPaymentProvider } from './stripe-test-payment.provider.js';

const config = parseConfig({ APP_ENV: 'test', PAYMENT_PROVIDER: 'STRIPE_TEST', PAYMENT_CHECKOUT_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example' });
const paymentId = '8a693359-090c-4ceb-9647-b0427acc082d';
const repository = { paymentIdByProviderReference: vi.fn(async () => paymentId), applyVerifiedEvent: vi.fn(async () => ({})) };

describe('Stripe webhook ingress', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(config)
      .overrideProvider(COMMERCE_REPOSITORY).useValue(repository)
      .overrideProvider(PAYMENT_PROVIDER).useValue(new StripeTestPaymentProvider(config))
      .compile();
    app = module.createNestApplication({ logger: false, rawBody: true });
    configureApp(app, config, createLogger('test'));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('accepts only a signed raw Stripe event and forwards its verified amount', async () => {
    const body = JSON.stringify({ id: 'evt_example', livemode: false, type: 'checkout.session.completed', data: { object: {
      id: 'cs_test_example', object: 'checkout.session', livemode: false, mode: 'payment', amount_total: 128050,
      currency: 'myr', status: 'complete', payment_status: 'paid' } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', config.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${body}`).digest('hex');
    await request(app.getHttpServer()).post('/api/v1/payments/webhooks/stripe').set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${timestamp},v1=${signature}`).send(body).expect(200);
    expect(repository.applyVerifiedEvent).toHaveBeenCalledWith('STRIPE_TEST', paymentId,
      expect.objectContaining({ providerPaymentId: 'cs_test_example', status: 'SUCCEEDED', amount: '1280.50', currency: 'MYR' }),
      expect.any(String));
    repository.applyVerifiedEvent.mockClear();
    await request(app.getHttpServer()).post('/api/v1/payments/webhooks/stripe').set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${timestamp},v1=${signature}`).send(body.replace('128050', '1')).expect(400);
    expect(repository.applyVerifiedEvent).not.toHaveBeenCalled();
  });
});
