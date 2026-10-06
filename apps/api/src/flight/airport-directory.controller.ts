import {Controller,Get,Header,Inject,Query,Req} from '@nestjs/common';
import type {ContextRequest} from '../request-context.js';
import {ApiException} from '../api-exception.js';
import {AirportDirectoryService} from './airport-directory.service.js';
@Controller('airports')
export class AirportDirectoryController {
  constructor(@Inject(AirportDirectoryService)private readonly directory:AirportDirectoryService){}
  @Get('suggestions') @Header('Cache-Control','public, max-age=3600')
  async suggestions(@Query('q')query:unknown,@Req()request:ContextRequest){
    if(query!==undefined&&(typeof query!=='string'||query.length>120))throw new ApiException('VALIDATION_ERROR','Enter a shorter airport search.',400);
    return {success:true,data:await this.directory.suggestions(typeof query==='string'?query:''),requestId:request.requestId};
  }
  @Get('details') @Header('Cache-Control','public, max-age=3600')
  async details(@Query('codes')codes:unknown,@Req()request:ContextRequest){
    if(typeof codes!=='string'||!codes.length||codes.length>239||!codes.split(',').every(code=>/^[A-Z]{3}$/.test(code)))throw new ApiException('VALIDATION_ERROR','Provide airport codes.',400);
    return {success:true,data:await this.directory.details(codes.split(',')),requestId:request.requestId};
  }
}
