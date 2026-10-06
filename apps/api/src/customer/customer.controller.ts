import { BadRequestException, Body, Controller, Delete, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type { ApiSuccess, CustomerProfile, TravellerProfile } from '@flyseri/types';
import type { ContextRequest, AuthenticatedUserContext } from '../request-context.js';
import { CurrentUser, CustomerAuthGuard } from './auth.js';
import { CustomerRateLimitGuard } from './rate-limit.guard.js';
import { CustomerService } from './customer.service.js';
import { CreateTravellerDto, UpdateMeDto, UpdateTravellerDto, SavePassportDto } from './dto.js';
import {PassportVaultService} from './passport-vault.service.js';

function response<T>(request: ContextRequest, data: T): ApiSuccess<T> { return { success: true, data, requestId: request.requestId }; }
const bodyValidation = (type: new () => object) => new ValidationPipe({
  expectedType: type, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('The request is invalid.'),
});

@Controller()
@UseGuards(CustomerAuthGuard)
export class CustomerController {
  constructor(@Inject(CustomerService) private readonly service: CustomerService,@Inject(PassportVaultService) private readonly passports:PassportVaultService) {}
  @Get('travellers/:travellerId/passport') @Header('Cache-Control','no-store')
  async passport(@CurrentUser() user:AuthenticatedUserContext,@Param('travellerId',new ParseUUIDPipe()) id:string,@Req() request:ContextRequest){return response(request,await this.passports.get(user.customerId,id));}
  @Post('travellers/:travellerId/passport') @UseGuards(CustomerRateLimitGuard)
  async savePassport(@CurrentUser() user:AuthenticatedUserContext,@Param('travellerId',new ParseUUIDPipe()) id:string,@Body(bodyValidation(SavePassportDto)) body:SavePassportDto,@Req() request:ContextRequest){return response(request,await this.passports.save(user.customerId,id,{documentNumber:body.documentNumber,expiryDate:body.expiryDate,issuingCountryCode:body.issuingCountryCode}));}
  @Delete('travellers/:travellerId/passport') @UseGuards(CustomerRateLimitGuard)
  async removePassport(@CurrentUser() user:AuthenticatedUserContext,@Param('travellerId',new ParseUUIDPipe()) id:string,@Req() request:ContextRequest){return response(request,await this.passports.remove(user.customerId,id));}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest): ApiSuccess<CustomerProfile> {
    return response(request, user.profile);
  }

  @Patch('me')
  @UseGuards(CustomerRateLimitGuard)
  async updateMe(@CurrentUser() user: AuthenticatedUserContext, @Body(bodyValidation(UpdateMeDto)) body: UpdateMeDto, @Req() request: ContextRequest): Promise<ApiSuccess<CustomerProfile>> {
    return response(request, await this.service.updateProfile(user.customerId, body));
  }

  @Get('travellers')
  async listTravellers(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest): Promise<ApiSuccess<TravellerProfile[]>> {
    return response(request, await this.service.listTravellers(user.customerId));
  }

  @Post('travellers')
  @UseGuards(CustomerRateLimitGuard)
  async createTraveller(@CurrentUser() user: AuthenticatedUserContext, @Body(bodyValidation(CreateTravellerDto)) body: CreateTravellerDto, @Req() request: ContextRequest): Promise<ApiSuccess<TravellerProfile>> {
    return response(request, await this.service.createTraveller(user.customerId, body));
  }

  @Get('travellers/:travellerId')
  async getTraveller(@CurrentUser() user: AuthenticatedUserContext, @Param('travellerId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<TravellerProfile>> {
    return response(request, await this.service.getTraveller(user.customerId, id));
  }

  @Patch('travellers/:travellerId')
  @UseGuards(CustomerRateLimitGuard)
  async updateTraveller(@CurrentUser() user: AuthenticatedUserContext, @Param('travellerId', new ParseUUIDPipe()) id: string, @Body(bodyValidation(UpdateTravellerDto)) body: UpdateTravellerDto, @Req() request: ContextRequest): Promise<ApiSuccess<TravellerProfile>> {
    return response(request, await this.service.updateTraveller(user.customerId, id, body));
  }

  @Delete('travellers/:travellerId')
  @UseGuards(CustomerRateLimitGuard)
  async archiveTraveller(@CurrentUser() user: AuthenticatedUserContext, @Param('travellerId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<{ archived: true }>> {
    await this.passports.removeOnArchive(user.customerId,id);
    return response(request, await this.service.archiveTraveller(user.customerId, id));
  }
}
