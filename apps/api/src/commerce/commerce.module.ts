import { Module } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { DatabaseConnection } from '@flyseri/database';
import { APP_CONFIG, COMMERCE_REPOSITORY, DATABASE_CONNECTION, PAYMENT_PROVIDER } from '../tokens.js';
import { CommerceController, PaymentWebhookController } from './commerce.controller.js';
import { CommerceRepository } from './commerce.repository.js';
import { CommerceService } from './commerce.service.js';
import { PaymentEngineService } from './payment-engine.service.js';
import { PaymentReconciliationPoller } from './payment-reconciliation.poller.js';
import { StripeTestPaymentProvider } from './stripe-test-payment.provider.js';

@Module({ controllers: [CommerceController, PaymentWebhookController], providers: [CommerceService, PaymentEngineService, PaymentReconciliationPoller,
  { provide: PAYMENT_PROVIDER, useFactory: (config: AppConfig) => config.PAYMENT_CHECKOUT_ENABLED === 'true' &&
    config.PAYMENT_PROVIDER === 'STRIPE_TEST' ? new StripeTestPaymentProvider(config) : undefined, inject: [APP_CONFIG] },
  { provide: COMMERCE_REPOSITORY, useFactory: (db: DatabaseConnection | undefined) => db ? new CommerceRepository(db) : undefined,
    inject: [DATABASE_CONNECTION] }], exports: [CommerceService, COMMERCE_REPOSITORY] })
export class CommerceModule {}
