import {Controller,Get,Param,ParseUUIDPipe,Req,UseGuards} from '@nestjs/common';
import {AdminAuthGuard,RequireAdminPermission} from '../admin/admin-auth.js';
import type {ContextRequest} from '../request-context.js';
import {apiTraces} from './api-trace.js';
import {ApiException} from '../api-exception.js';
@Controller('admin/developer')
@UseGuards(AdminAuthGuard)
export class DeveloperController{
 @Get('traces') @RequireAdminPermission('developer')
 traces(@Req() request:ContextRequest){return {success:true,data:apiTraces.snapshot(),requestId:request.requestId};}
 @Get('traces/:id') @RequireAdminPermission('developer')
 detail(@Param('id',new ParseUUIDPipe()) id:string,@Req() request:ContextRequest){const data=apiTraces.detail(id);if(!data)throw new ApiException('NOT_FOUND','This trace expired from the buffer or belongs to an earlier API session. Select a recent call; no restart is required.',404);return {success:true,data,requestId:request.requestId};}
}
