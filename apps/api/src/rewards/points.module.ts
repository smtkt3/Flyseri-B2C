import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { AdminAuthGuard } from '../admin/admin-auth.js';
import { PointsController, AdminPointsController } from './points.controller.js';
import { PointsService } from './points.service.js';
@Module({imports:[CustomerModule],controllers:[PointsController,AdminPointsController],providers:[PointsService,AdminAuthGuard],exports:[PointsService]})
export class PointsModule {}
