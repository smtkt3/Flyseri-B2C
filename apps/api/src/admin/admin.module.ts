import { Module } from '@nestjs/common';
import { FlightModule } from '../flight/flight.module.js';
import { AdminAuthGuard } from './admin-auth.js';
import { AdminController } from './admin.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminRecordsService } from './admin-records.service.js';
import { AdminDocumentsService } from './admin-documents.service.js';
import { AdminFlightsService } from './admin-flights.service.js';
import { AdminCommerceService } from './admin-commerce.service.js';
import { AdminCrmService } from './admin-crm.service.js';
import { AdminVisaService } from './admin-visa.service.js';

@Module({ imports: [FlightModule], controllers: [AdminController],
  providers: [AdminAuthGuard, AdminDashboardService, AdminRecordsService, AdminDocumentsService, AdminFlightsService, AdminCommerceService, AdminCrmService, AdminVisaService] })
export class AdminModule {}
