import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { AdminAuthGuard } from '../admin/admin-auth.js';
import { CouponController, AdminCouponController } from './coupon.controller.js';
import { CouponService } from './coupon.service.js';
@Module({imports:[CustomerModule],controllers:[CouponController,AdminCouponController],providers:[CouponService,AdminAuthGuard]})
export class CouponModule {}
