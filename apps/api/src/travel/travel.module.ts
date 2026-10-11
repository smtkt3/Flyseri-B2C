import { BadRequestException, Body, Controller, Delete, Get, Inject, Module, Param, ParseUUIDPipe, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDefined, IsISO8601, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { SupportStage } from '@flyseri/types';
import { CustomerModule } from '../customer/customer.module.js';
import { CustomerAuthGuard, CurrentUser } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { FlightModule } from '../flight/flight.module.js';
import { FlightSearchDto } from '../flight/flight-search.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { AdminAuthGuard, CurrentStaff, RequireAdminPermission, type AdminIdentity } from '../admin/admin-auth.js';
import { TravelService } from './travel.service.js';
class WatchDto {
  @IsDefined() @ValidateNested() @Type(() => FlightSearchDto) search!: FlightSearchDto;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(999999999) targetAmount!: number;
}
class ApprovalDto { @IsInt() @Min(1) expectedVersion!: number }
class QuoteDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999999) amount!: number;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsString() @MinLength(1) @MaxLength(1000) description!: string;
  @IsISO8601() expiresAt!: string;
}
class SupportProgressDto extends ApprovalDto {
  @IsIn(['QUEUED','REVIEWING','QUOTE_READY','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED']) stage!: SupportStage;
  @IsString() @MinLength(1) @MaxLength(2000) message!: string;
  @IsOptional() @ValidateNested() @Type(() => QuoteDto) quote?: QuoteDto;
}
const validate = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('Please check the request details.') });
const response = <T>(req: ContextRequest, data: T) => ({ success: true, data, requestId: req.requestId });
@Controller('travel') @UseGuards(CustomerAuthGuard)
class TravelController {
  constructor(@Inject(TravelService) private readonly service: TravelService) {}
  @Get('fare-watches') async watches(@CurrentUser() user: AuthenticatedUserContext, @Req() req: ContextRequest) { return response(req, await this.service.watches(user.customerId)); }
  @Post('fare-watches') @UseGuards(CustomerRateLimitGuard)
  async watch(@CurrentUser() user: AuthenticatedUserContext, @Body(validate(WatchDto)) body: WatchDto, @Req() req: ContextRequest) { return response(req, await this.service.watch(user.customerId, body)); }
  @Delete('fare-watches/:id') async remove(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: ContextRequest) { return response(req, await this.service.removeWatch(user.customerId, id)); }
  @Get('support-requests') async requests(@CurrentUser() user: AuthenticatedUserContext, @Req() req: ContextRequest) { return response(req, await this.service.requests(user.customerId)); }
  @Post('support-requests/:id/approve') @UseGuards(CustomerRateLimitGuard)
  async approve(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Body(validate(ApprovalDto)) body: ApprovalDto, @Req() req: ContextRequest) { return response(req, await this.service.approve(user.customerId, id, body.expectedVersion)); }
}
@Controller('admin/travel/support-requests') @UseGuards(AdminAuthGuard) @RequireAdminPermission('support')
class AdminTravelController {
  constructor(@Inject(TravelService) private readonly service: TravelService) {}
  @Get() async requests(@Req() req: ContextRequest) { return response(req, await this.service.requests()); }
  @Get(':id') async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: ContextRequest) { return response(req, await this.service.supportDetail(id)); }
  @Post(':id') async update(@Param('id', ParseUUIDPipe) id: string, @Body(validate(SupportProgressDto)) body: SupportProgressDto, @CurrentStaff() staff: AdminIdentity, @Req() req: ContextRequest) { return response(req, await this.service.updateRequest(id, body, staff, req.requestId)); }
}
@Module({ imports: [CustomerModule, FlightModule], controllers: [TravelController, AdminTravelController], providers: [TravelService, AdminAuthGuard] })
export class TravelModule {}
