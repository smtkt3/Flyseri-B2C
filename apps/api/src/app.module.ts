import { CouponModule } from './coupons/coupon.module.js';
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
import { HolidayModule } from './holiday/holiday.module.js';
import { TravelModule } from './travel/travel.module.js';
import { PointsModule } from './rewards/points.module.js';
import { WeatherModule } from './weather/weather.module.js';

@Module({ imports: [InfrastructureModule, HealthModule, CustomerModule, TripModule, DocumentModule, VisaModule, FlightModule, CommerceModule, AdminModule, SeriModule, HolidayModule, TravelModule, PointsModule, WeatherModule, CouponModule] })
export class AppModule {}
