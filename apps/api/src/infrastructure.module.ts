import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { parseConfig, type AppConfig } from '@flyseri/config';
import { DatabaseConnection } from '@flyseri/database';
import { RedisStore, createRedisStore } from '@flyseri/redis';
import { APP_CONFIG, DATABASE_CONNECTION, REDIS_STORE, CUSTOMER_STORE, TOKEN_VERIFIER, TRIP_STORE, DOCUMENT_STORE, DOCUMENT_STORAGE, VISA_STORE } from './tokens.js';
import { DrizzleCustomerStore } from './customer/customer.repository.js';
import { createSupabaseVerifier } from './customer/auth.js';
import { DrizzleTripStore } from './trip/trip.repository.js';
import { DrizzleDocumentStore } from './document/document.repository.js';
import { createDocumentStorage } from './document/storage.js';
import { DrizzleVisaStore } from './visa/visa.repository.js';

@Injectable()
class InfrastructureLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly database: DatabaseConnection | undefined,
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.database?.close(), this.redis?.close()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => parseConfig(process.env) },
    {
      provide: DATABASE_CONNECTION,
      useFactory: (config: AppConfig): DatabaseConnection | undefined =>
        config.DATABASE_URL ? new DatabaseConnection(config.DATABASE_URL) : undefined,
      inject: [APP_CONFIG],
    },
    {
      provide: REDIS_STORE,
      useFactory: (config: AppConfig): RedisStore | undefined =>
        config.REDIS_URL ? createRedisStore(config.REDIS_URL, config.APP_ENV) : undefined,
      inject: [APP_CONFIG],
    },
    { provide: CUSTOMER_STORE, useFactory: (database: DatabaseConnection | undefined) => database ? new DrizzleCustomerStore(database) : undefined, inject: [DATABASE_CONNECTION] },
    { provide: TRIP_STORE, useFactory: (database: DatabaseConnection | undefined) => database ? new DrizzleTripStore(database) : undefined, inject: [DATABASE_CONNECTION] },
    { provide: DOCUMENT_STORE, useFactory: (database: DatabaseConnection | undefined) => database ? new DrizzleDocumentStore(database) : undefined, inject: [DATABASE_CONNECTION] },
    { provide: DOCUMENT_STORAGE, useFactory: createDocumentStorage, inject: [APP_CONFIG] },
    { provide: VISA_STORE, useFactory: (database: DatabaseConnection | undefined) => database ? new DrizzleVisaStore(database) : undefined, inject: [DATABASE_CONNECTION] },
    { provide: TOKEN_VERIFIER, useFactory: createSupabaseVerifier, inject: [APP_CONFIG] },
    InfrastructureLifecycle,
  ],
  exports: [APP_CONFIG, DATABASE_CONNECTION, REDIS_STORE, CUSTOMER_STORE, TOKEN_VERIFIER, TRIP_STORE, DOCUMENT_STORE, DOCUMENT_STORAGE, VISA_STORE],
})
export class InfrastructureModule {}
