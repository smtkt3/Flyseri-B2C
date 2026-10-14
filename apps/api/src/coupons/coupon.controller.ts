import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, Matches, Max, Min } from 'class-validator';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import { AdminAuthGuard, CurrentStaff, RequireAdminPermission, type AdminIdentity } from '../admin/admin-auth.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { CouponService, type CouponInput } from './coupon.service.js';
const money=/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;
class ApplyCoupon {
  @IsOptional() @Transform(({value}: {value:unknown})=>typeof value==='string'?value.trim().toUpperCase():value)
  @Matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/) code!:string|null;
}
class SaveCoupon implements CouponInput {
  @Transform(({value}: {value:unknown})=>typeof value==='string'?value.trim().toUpperCase():value) @Matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/) code!:string;
  @IsIn(['PERCENT','FIXED']) discountType!:'PERCENT'|'FIXED';
  @Matches(money) discountValue!:string;
  @IsIn(['BDT','MYR','USD','SGD','EUR','GBP','AUD']) currency!:string;
  @Matches(money) minimumSpend!:string;
  @IsOptional() @Matches(money) maximumDiscount?:string|null;
  @IsOptional() @IsISO8601({strict:true}) startsAt?:string|null;
  @IsOptional() @IsISO8601({strict:true}) expiresAt?:string|null;
  @IsOptional() @IsInt() @Min(1) @Max(100000000) usageLimit?:number|null;
  @IsInt() @Min(1) @Max(100000000) perCustomerLimit!:number;
  @IsIn(['FLIGHT','VISA','ALL']) appliesTo!:'FLIGHT'|'VISA'|'ALL';
  @IsBoolean() active!:boolean;
  @IsOptional() @IsInt() @Min(1) @Max(2147483646) version?:number;
}
class Page {@Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;}
const validate=(expectedType:new()=>unknown)=>new ValidationPipe({expectedType,transform:true,whitelist:true,forbidNonWhitelisted:true});
const response=<T>(req:ContextRequest,data:T)=>({success:true as const,data,requestId:req.requestId});
@Controller('orders') @UseGuards(CustomerAuthGuard)
export class CouponController {
  constructor(@Inject(CouponService) private readonly service:CouponService){}
  @Post(':id/coupon') async apply(@CurrentUser() user:AuthenticatedUserContext,@Param('id',ParseUUIDPipe) id:string,@Body(validate(ApplyCoupon)) body:ApplyCoupon,@Req() req:ContextRequest){
    return response(req,await this.service.apply(user.customerId,id,body.code??null,req.requestId));
  }
}
@Controller('admin/coupons') @UseGuards(AdminAuthGuard) @RequireAdminPermission('coupons')
export class AdminCouponController {
  constructor(@Inject(CouponService) private readonly service:CouponService){}
  @Get() async list(@Query(validate(Page)) page:Page,@Req() req:ContextRequest){return response(req,await this.service.list(page.page));}
  @Post() async create(@Body(validate(SaveCoupon)) body:SaveCoupon,@CurrentStaff() staff:AdminIdentity,@Req() req:ContextRequest){return response(req,await this.service.save(body,staff.staffUserId,staff.role,req.requestId));}
  @Post(':id') async update(@Param('id',ParseUUIDPipe) id:string,@Body(validate(SaveCoupon)) body:SaveCoupon,@CurrentStaff() staff:AdminIdentity,@Req() req:ContextRequest){return response(req,await this.service.save(body,staff.staffUserId,staff.role,req.requestId,id));}
}
