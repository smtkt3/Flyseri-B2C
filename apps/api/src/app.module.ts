import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { InfrastructureModule } from './infrastructure.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TripModule } from './trip/trip.module.js';
import { DocumentModule } from './document/document.module.js';
import { VisaModule } from './visa/visa.module.js';
import { FlightModule } from './flight/flight.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CommerceModule } from './commerce/commerce.module.js';
import { SeriModule } from './seri/seri.module.js';

@Module({ imports: [InfrastructureModule, HealthModule, CustomerModule, TripModule, DocumentModule, VisaModule, FlightModule, CommerceModule, AdminModule, SeriModule] })
export class AppModule {}
