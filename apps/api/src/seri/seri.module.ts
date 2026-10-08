import { Module } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { DatabaseConnection } from '@flyseri/database';
import { APP_CONFIG, AI_PROVIDER, AI_STORE, DATABASE_CONNECTION } from '../tokens.js';
import { CustomerModule } from '../customer/customer.module.js';
import { TripModule } from '../trip/trip.module.js';
import { VisaModule } from '../visa/visa.module.js';
import { DocumentModule } from '../document/document.module.js';
import { FlightModule } from '../flight/flight.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { createAiProvider } from './ai-provider.js';
import { SeriController, GuestSeriController } from './seri.controller.js';
import { GuestSeriService } from './guest-seri.service.js';
import { SeriRepository } from './seri.repository.js';
import { SeriOrchestratorService } from './seri.service.js';
import { SabreMcpService } from './sabre-mcp.service.js';

@Module({
  imports: [CustomerModule, TripModule, VisaModule, DocumentModule, FlightModule, CommerceModule],
  controllers: [SeriController, GuestSeriController],
  providers: [
    SabreMcpService,
    SeriOrchestratorService,
    GuestSeriService,
    { provide: AI_PROVIDER, useFactory: (config: AppConfig) => createAiProvider(config), inject: [APP_CONFIG] },
    { provide: AI_STORE, useFactory: (database: DatabaseConnection | undefined) => new SeriRepository(database), inject: [DATABASE_CONNECTION] },
  ],
})
export class SeriModule {}
