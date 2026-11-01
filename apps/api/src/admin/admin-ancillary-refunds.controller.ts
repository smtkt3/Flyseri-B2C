import {Body,Controller,Inject,Param,ParseUUIDPipe,Post,Req,UseGuards,ValidationPipe} from '@nestjs/common';
import {IsIn,IsInt,IsOptional,IsString,IsUUID,MaxLength,Min} from 'class-validator';
import {AdminAuthGuard,CurrentStaff,RequireAdminPermission,type AdminIdentity} from './admin-auth.js';
import {AdminAncillaryRefundsService} from './admin-ancillary-refunds.service.js';
import type {ContextRequest} from '../request-context.js';
class PrepareExtraRefund{@IsUUID('4') bookingId!:string;@IsString() @MaxLength(200) requestId!:string;}
class ExtraDocuments{@IsUUID('4') bookingId!:string;@IsString() @MaxLength(16) confirmedPnr!:string;@IsOptional() @IsIn(['BOOKING_MANAGEMENT','ENHANCED_AIR_TICKET']) ticketingApi?:'BOOKING_MANAGEMENT'|'ENHANCED_AIR_TICKET';}
class ExtraRefundAction{@IsIn(['EXECUTE','SETTLE','RECONCILE','CANCEL']) action!:string;@IsInt() @Min(1) version!:number;@IsString() @MaxLength(16) confirmedPnr!:string;}
@Controller('admin/flights/ancillary-refunds')
@UseGuards(AdminAuthGuard)
@RequireAdminPermission('flight_pricing')
export class AdminAncillaryRefundsController{
 constructor(@Inject(AdminAncillaryRefundsService)private readonly service:AdminAncillaryRefundsService){}
 @Post('fulfill-documents')async documents(@Body(new ValidationPipe({expectedType:ExtraDocuments,whitelist:true,forbidNonWhitelisted:true}))body:ExtraDocuments,@CurrentStaff()staff:AdminIdentity,@Req()req:ContextRequest){return {success:true,data:await this.service.documents(body.bookingId,body.confirmedPnr,staff,req.requestId,false,body.ticketingApi),requestId:req.requestId};}
 @Post('check-documents')async checkDocuments(@Body(new ValidationPipe({expectedType:ExtraDocuments,whitelist:true,forbidNonWhitelisted:true}))body:ExtraDocuments,@CurrentStaff()staff:AdminIdentity,@Req()req:ContextRequest){return {success:true,data:await this.service.documents(body.bookingId,body.confirmedPnr,staff,req.requestId,true),requestId:req.requestId};}
 @Post('prepare')async prepare(@Body(new ValidationPipe({expectedType:PrepareExtraRefund,whitelist:true,forbidNonWhitelisted:true}))body:PrepareExtraRefund,@CurrentStaff()staff:AdminIdentity,@Req()req:ContextRequest){return {success:true,data:await this.service.prepare(body.bookingId,body.requestId,staff,req.requestId),requestId:req.requestId};}
 @Post(':id/actions')async action(@Param('id',ParseUUIDPipe)id:string,@Body(new ValidationPipe({expectedType:ExtraRefundAction,whitelist:true,forbidNonWhitelisted:true}))body:ExtraRefundAction,@CurrentStaff()staff:AdminIdentity,@Req()req:ContextRequest){await this.service.action(id,body.action,body.version,body.confirmedPnr,staff,req.requestId);return {success:true,data:{updated:true},requestId:req.requestId};}
}
