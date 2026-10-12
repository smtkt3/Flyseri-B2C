import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { IsInt, IsISO8601, IsString, IsUUID, NotEquals, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import { AdminAuthGuard, CurrentStaff, RequireAdminPermission, type AdminIdentity } from '../admin/admin-auth.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { PointsService } from './points.service.js';
class Page { @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1; }
class ApplyPoints { @IsInt() @Min(0) @Max(100000000) points!:number; }
class VerifyJourney { @IsISO8601({strict:true}) completedAt!:string; @IsString() @MinLength(10) @MaxLength(500) evidence!:string; }
class RefundPoints { @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/) cumulativeEligibleRefund!:string; @IsString() @MinLength(10) @MaxLength(500) evidence!:string; }
class AdjustPoints { @IsInt() @Min(-100000) @Max(100000) @NotEquals(0) points!:number; @IsUUID() idempotencyKey!:string; @IsString() @MinLength(10) @MaxLength(500) evidence!:string; }
const validate=(expectedType: new()=>unknown)=>new ValidationPipe({expectedType,transform:true,whitelist:true,forbidNonWhitelisted:true});
const response=<T>(req:ContextRequest,data:T)=>({success:true as const,data,requestId:req.requestId});
@Controller('points') @UseGuards(CustomerAuthGuard)
export class PointsController {
  constructor(@Inject(PointsService) private readonly service:PointsService) {}
  @Get() async wallet(@CurrentUser() user:AuthenticatedUserContext,@Query(validate(Page)) query:Page,@Req() req:ContextRequest) {
    return response(req,await this.service.wallet(user.customerId,query.page));
  }
  @Get('orders/:id') async quote(@CurrentUser() user:AuthenticatedUserContext,@Param('id',ParseUUIDPipe) id:string,@Req() req:ContextRequest) {
    return response(req,await this.service.quote(user.customerId,id));
  }
  @Post('orders/:id') async apply(@CurrentUser() user:AuthenticatedUserContext,@Param('id',ParseUUIDPipe) id:string,@Body(validate(ApplyPoints)) body:ApplyPoints,@Req() req:ContextRequest) {
    return response(req,await this.service.apply(user.customerId,id,body.points));
  }
}
@Controller('admin/points') @UseGuards(AdminAuthGuard)
export class AdminPointsController {
  constructor(@Inject(PointsService) private readonly service:PointsService) {}
  @Get('customers/:customerId') @RequireAdminPermission('orders')
  async wallet(@Param('customerId',ParseUUIDPipe) id:string,@Query(validate(Page)) query:Page,@Req() req:ContextRequest) {return response(req,await this.service.wallet(id,query.page));}
  @Post('customers/:customerId/adjust') @RequireAdminPermission('settings')
  async adjust(@Param('customerId',ParseUUIDPipe) id:string,@Body(validate(AdjustPoints)) body:AdjustPoints,@CurrentStaff() staff:AdminIdentity,@Req() req:ContextRequest) {
    await this.service.adjust(id,body.points,body.idempotencyKey,staff.staffUserId,body.evidence);return response(req,{adjusted:true});
  }
  @Post('customers/:customerId/orders/:id/verify-journey') @RequireAdminPermission('settings')
  async verify(@Param('customerId',ParseUUIDPipe) customerId:string,@Param('id',ParseUUIDPipe) id:string,@Body(validate(VerifyJourney)) body:VerifyJourney,@CurrentStaff() staff:AdminIdentity,@Req() req:ContextRequest) {
    await this.service.verify(customerId,id,body.completedAt,staff.staffUserId,body.evidence);return response(req,{verified:true});
  }
  @Post('customers/:customerId/orders/:id/refund') @RequireAdminPermission('settings')
  async refund(@Param('customerId',ParseUUIDPipe) customerId:string,@Param('id',ParseUUIDPipe) id:string,@Body(validate(RefundPoints)) body:RefundPoints,@CurrentStaff() staff:AdminIdentity,@Req() req:ContextRequest) {
    await this.service.refund(customerId,id,body.cumulativeEligibleRefund,staff.staffUserId,body.evidence);return response(req,{adjusted:true});
  }
}
