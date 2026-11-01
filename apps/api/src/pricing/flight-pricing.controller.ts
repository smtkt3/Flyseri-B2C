import {Body,Controller,Get,Inject,Post,Req,UseGuards} from '@nestjs/common';
import {AdminAuthGuard,CurrentStaff,RequireAdminPermission,type AdminIdentity} from '../admin/admin-auth.js';
import type {ContextRequest} from '../request-context.js';
import {FlightPricingService} from './flight-pricing.service.js';
@Controller('admin/flights/pricing')
@UseGuards(AdminAuthGuard)
@RequireAdminPermission('flight_pricing')
export class FlightPricingController{
 constructor(@Inject(FlightPricingService) private readonly pricing:FlightPricingService){}
 @Get() async get(@Req() req:ContextRequest){return {success:true,data:await this.pricing.policy(),requestId:req.requestId};}
 @Post() async save(@Body() body:{revision:number;rules:unknown},@CurrentStaff() staff:AdminIdentity,@Req() req:ContextRequest){return {success:true,data:await this.pricing.save(body?.revision,body?.rules,staff,req.requestId),requestId:req.requestId};}
 @Post('preview') preview(@Body() body:unknown,@Req() req:ContextRequest){return {success:true,data:this.pricing.preview(body),requestId:req.requestId};}
}
