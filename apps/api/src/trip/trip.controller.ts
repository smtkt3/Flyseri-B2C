import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type { ApiSuccess, TripDestination, TripDetail, TripSummary, TripTraveller } from '@flyseri/types';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { AddTripTravellerDto, CreateTripDto, DestinationDto, TripListQueryDto, UpdateDestinationDto, UpdateTripDto } from './dto.js';
import { TripService } from './trip.service.js';

const validated = (type: new () => object) => new ValidationPipe({ expectedType: type, transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('The request is invalid.') });
const response = <T>(request: ContextRequest, data: T): ApiSuccess<T> => ({ success: true, data, requestId: request.requestId });

@Controller('trips')
@UseGuards(CustomerAuthGuard)
export class TripController {
  constructor(@Inject(TripService) private readonly service: TripService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUserContext, @Query(validated(TripListQueryDto)) query: TripListQueryDto, @Req() request: ContextRequest): Promise<ApiSuccess<TripSummary[]>> {
    return response(request, await this.service.list(user.customerId, { status: query.status, period: query.period, archived: query.archived === 'true' }));
  }
  @Post()
  @UseGuards(CustomerRateLimitGuard)
  async create(@CurrentUser() user: AuthenticatedUserContext, @Body(validated(CreateTripDto)) body: CreateTripDto, @Req() request: ContextRequest): Promise<ApiSuccess<TripDetail>> {
    return response(request, await this.service.create(user.customerId, body));
  }
  @Get(':tripId')
  async detail(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Req() request: ContextRequest): Promise<ApiSuccess<TripDetail>> {
    return response(request, await this.service.detail(user.customerId, tripId));
  }
  @Patch(':tripId')
  @UseGuards(CustomerRateLimitGuard)
  async update(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Body(validated(UpdateTripDto)) body: UpdateTripDto, @Req() request: ContextRequest): Promise<ApiSuccess<TripDetail>> {
    return response(request, await this.service.update(user.customerId, tripId, body));
  }
  @Delete(':tripId')
  @UseGuards(CustomerRateLimitGuard)
  async archive(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Req() request: ContextRequest): Promise<ApiSuccess<{ archived: true }>> {
    return response(request, await this.service.archive(user.customerId, tripId));
  }
  @Get(':tripId/travellers')
  async travellers(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Req() request: ContextRequest): Promise<ApiSuccess<TripTraveller[]>> {
    return response(request, (await this.service.detail(user.customerId, tripId)).travellers);
  }
  @Post(':tripId/travellers')
  @UseGuards(CustomerRateLimitGuard)
  async addTraveller(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Body(validated(AddTripTravellerDto)) body: AddTripTravellerDto, @Req() request: ContextRequest): Promise<ApiSuccess<TripDetail>> {
    return response(request, await this.service.addTraveller(user.customerId, tripId, body.travellerId));
  }
  @Delete(':tripId/travellers/:travellerId')
  @UseGuards(CustomerRateLimitGuard)
  async removeTraveller(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Param('travellerId', new ParseUUIDPipe()) travellerId: string, @Req() request: ContextRequest): Promise<ApiSuccess<{ removed: true }>> {
    return response(request, await this.service.removeTraveller(user.customerId, tripId, travellerId));
  }
  @Get(':tripId/destinations')
  async destinations(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Req() request: ContextRequest): Promise<ApiSuccess<TripDestination[]>> {
    return response(request, (await this.service.detail(user.customerId, tripId)).destinations);
  }
  @Post(':tripId/destinations')
  @UseGuards(CustomerRateLimitGuard)
  async addDestination(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Body(validated(DestinationDto)) body: DestinationDto, @Req() request: ContextRequest): Promise<ApiSuccess<TripDetail>> {
    return response(request, await this.service.addDestination(user.customerId, tripId, body));
  }
  @Patch(':tripId/destinations/:destinationId')
  @UseGuards(CustomerRateLimitGuard)
  async updateDestination(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Param('destinationId', new ParseUUIDPipe()) destinationId: string, @Body(validated(UpdateDestinationDto)) body: UpdateDestinationDto, @Req() request: ContextRequest): Promise<ApiSuccess<TripDetail>> {
    return response(request, await this.service.updateDestination(user.customerId, tripId, destinationId, body));
  }
  @Delete(':tripId/destinations/:destinationId')
  @UseGuards(CustomerRateLimitGuard)
  async removeDestination(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Param('destinationId', new ParseUUIDPipe()) destinationId: string, @Req() request: ContextRequest): Promise<ApiSuccess<{ removed: true }>> {
    return response(request, await this.service.removeDestination(user.customerId, tripId, destinationId));
  }
}
