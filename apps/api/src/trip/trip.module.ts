import { Module } from '@nestjs/common';
import { CustomerAuthGuard } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { TripController } from './trip.controller.js';
import { TripService } from './trip.service.js';

@Module({ controllers: [TripController], providers: [TripService, CustomerAuthGuard, CustomerRateLimitGuard], exports: [TripService] })
export class TripModule {}
