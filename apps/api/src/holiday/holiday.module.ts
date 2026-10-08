import { BadRequestException, Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { CustomerAuthGuard, CurrentUser } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { AdminAuthGuard, CurrentStaff, RequireAdminPermission, type AdminIdentity } from '../admin/admin-auth.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { HolidayBookingDto, HolidayBookingStatusDto, HolidayPackageDto } from './holiday.dto.js';
import { HolidayService } from './holiday.service.js';
const validate = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('Please check the holiday package details.') });
const response = <T>(req: ContextRequest, data: T) => ({ success: true, data, requestId: req.requestId });
@Controller('holidays')
class HolidayController {
  constructor(@Inject(HolidayService) private readonly service: HolidayService) {}
  @Get() async list(@Req() req: ContextRequest) { return response(req, await this.service.list()); }
  @Get('bookings') @UseGuards(CustomerAuthGuard)
  async bookings(@CurrentUser() user: AuthenticatedUserContext, @Req() req: ContextRequest) { return response(req, await this.service.bookings(user.customerId)); }
  @Post('bookings') @UseGuards(CustomerAuthGuard, CustomerRateLimitGuard)
  async book(@CurrentUser() user: AuthenticatedUserContext, @Body(validate(HolidayBookingDto)) body: HolidayBookingDto, @Req() req: ContextRequest) { return response(req, await this.service.book(user.customerId, body)); }
  @Get(':id') async detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: ContextRequest) { return response(req, await this.service.detail(id)); }
}
@Controller('admin/holidays') @UseGuards(AdminAuthGuard) @RequireAdminPermission('holidays')
class AdminHolidayController {
  constructor(@Inject(HolidayService) private readonly service: HolidayService) {}
  @Get() async list(@Req() req: ContextRequest) { return response(req, await this.service.list(true)); }
  @Post() async create(@Body(validate(HolidayPackageDto)) body: HolidayPackageDto, @CurrentStaff() staff: AdminIdentity, @Req() req: ContextRequest) { return response(req, await this.service.save(undefined, body, staff, req.requestId)); }
  @Post(':id') async update(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(HolidayPackageDto)) body: HolidayPackageDto, @CurrentStaff() staff: AdminIdentity, @Req() req: ContextRequest) { return response(req, await this.service.save(id, body, staff, req.requestId)); }
  @Get('bookings') async bookings(@Req() req: ContextRequest) { return response(req, await this.service.bookings()); }
  @Post('bookings/:id/status') async status(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(HolidayBookingStatusDto)) body: HolidayBookingStatusDto, @CurrentStaff() staff: AdminIdentity, @Req() req: ContextRequest) { return response(req, await this.service.status(id, body.status, staff, req.requestId)); }
}
@Module({ imports: [CustomerModule], controllers: [HolidayController, AdminHolidayController], providers: [HolidayService, AdminAuthGuard] })
export class HolidayModule {}
