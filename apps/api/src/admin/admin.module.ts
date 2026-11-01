import { Module } from '@nestjs/common';
import {AdminAncillaryRefundsController} from './admin-ancillary-refunds.controller.js';
import {AdminAncillaryRefundsService} from './admin-ancillary-refunds.service.js';
import { FlightModule } from '../flight/flight.module.js';
import { AdminAuthGuard } from './admin-auth.js';
import {DeveloperController} from '../developer/developer.controller.js';
import { AdminController } from './admin.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminRecordsService } from './admin-records.service.js';
import { AdminDocumentsService } from './admin-documents.service.js';
import { AdminFlightsService } from './admin-flights.service.js';
import { AdminFlightOperationsService } from './admin-flight-operations.service.js';
import { AdminFlightRefundsService } from './admin-flight-refunds.service.js';
import {AdminFlightExchangesService} from './admin-flight-exchanges.service.js';
import { AdminCommerceService } from './admin-commerce.service.js';
import { AdminCrmService } from './admin-crm.service.js';
import { AdminVisaService } from './admin-visa.service.js';
import {FlightPricingController} from '../pricing/flight-pricing.controller.js';

@Module({ imports: [FlightModule], controllers: [AdminController,DeveloperController,FlightPricingController,AdminAncillaryRefundsController],
  providers: [AdminAuthGuard, AdminDashboardService, AdminRecordsService, AdminDocumentsService, AdminFlightsService, AdminFlightOperationsService, AdminFlightRefundsService, AdminFlightExchangesService, AdminCommerceService, AdminCrmService, AdminVisaService,AdminAncillaryRefundsService] })
export class AdminModule {}
