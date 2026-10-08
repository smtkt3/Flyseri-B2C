import { FlightAncillaryPurchaseService } from './flight-ancillary-purchase.service.js';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiSuccess, FlightBookingIntent, FlightBookingIntentInput, FlightSearchResponse, FlightSearchEvent } from '@flyseri/types';
import { CurrentUser, CustomerAuthGuard, OptionalCustomerAuthGuard } from '../customer/auth.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { ApiException } from '../api-exception.js';
import { FlightSearchDto } from './flight-search.js';
import { FlightRateGuard } from './flight-rate.guard.js';
import { FlightService } from './flight.service.js';
import { BookingIntentService } from './booking-intent.service.js';
import { GuestCheckoutAttemptsService, type GuestCheckoutAttemptInput } from './guest-checkout-attempts.service.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { FlightAncillariesService } from './flight-ancillaries.service.js';
import { FlightTicketingService } from './flight-ticketing.service.js';

class AncillaryPassengerDto {
  @IsString() @MaxLength(120) givenName!: string;
  @IsString() @MaxLength(120) surname!: string;
}
class AncillaryLookupDto {
  @IsUUID() searchId!: string;
  @IsUUID() offerId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => AncillaryPassengerDto) passengers!: AncillaryPassengerDto[];
}
class AncillaryReviewDto { @IsOptional() @IsBoolean() refresh?: boolean }
class AncillaryPurchaseConfirmationDto { @IsUUID('4') reviewId!: string }
class AncillarySelectionDto {
  @IsUUID('4') quoteId!: string;
  @IsInt() @Min(0) @Max(999) serviceIndex!: number;
}
class AncillarySelectionsDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => AncillarySelectionDto) selections!: AncillarySelectionDto[];
}
const validatedAncillaryLookup = new ValidationPipe({ expectedType: AncillaryLookupDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Check the selected flight and passenger names.') });

class ReservationAddressDto {
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(240) street!: string;
  @IsString() @Matches(/\S/) @MaxLength(120) city!: string;
  @IsString() @Matches(/\S/) @MaxLength(120) stateProvince!: string;
  @IsString() @Matches(/\S/) @MaxLength(24) postalCode!: string;
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
}
class ReservationPassportDto {
  @IsUUID('4') travellerId!: string;
  @IsOptional() @IsIn(['PASSPORT','NATIONAL_ID_CARD','VISA','ALIEN_RESIDENT','BORDER_CROSSING_CARD','REFUGEE_REENTRY_PERMIT']) documentType?: 'PASSPORT'|'NATIONAL_ID_CARD'|'VISA'|'ALIEN_RESIDENT'|'BORDER_CROSSING_CARD'|'REFUGEE_REENTRY_PERMIT';
  @IsString() @Matches(/^[A-Z0-9]{3,30}$/) documentNumber!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expiryDate!: string;
  @IsString() @Matches(/^[A-Z]{2}$/) issuingCountryCode!: string;
}
class ReservationDto {
  @IsEmail() @MaxLength(254) contactEmail!: string;
  @IsString() @Matches(/^\+?[0-9]{7,20}$/) contactPhone!: string;
  @IsBoolean() namesConfirmed!: boolean;
  @IsDefined() @ValidateNested() @Type(() => ReservationAddressDto) billingAddress!: ReservationAddressDto;
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => ReservationPassportDto) passports?: ReservationPassportDto[];
}
class CancelReservationDto { @IsString() @Matches(/^[A-Z0-9]{5,16}$/) confirmedPnr!: string; }
const validateCancellation = new ValidationPipe({ expectedType: CancelReservationDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Confirm the PNR you want to cancel.') });
const validateTicketing = new ValidationPipe({ expectedType: CancelReservationDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Confirm the PNR you want to ticket.') });
const validateReservation = new ValidationPipe({ expectedType: ReservationDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Check the booking contact and billing address.') });

const validated = new ValidationPipe({ expectedType: FlightSearchDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Check your flight search and try again.') });
class FlightServiceRequestDto {
  @IsUUID('4') travellerId!: string;
  @IsIn(['NONE', 'VEGETARIAN', 'VEGAN', 'HALAL', 'GLUTEN_FREE']) meal!: 'NONE' | 'VEGETARIAN' | 'VEGAN' | 'HALAL' | 'GLUTEN_FREE';
  @IsIn(['NONE', 'EXTRA_CHECKED']) baggage!: 'NONE' | 'EXTRA_CHECKED';
  @IsIn(['NONE', 'AIRPORT', 'STAIRS', 'TO_SEAT']) wheelchair!: 'NONE' | 'AIRPORT' | 'STAIRS' | 'TO_SEAT';
  @IsIn(['NONE', 'HEARING', 'VISION']) assistance!: 'NONE' | 'HEARING' | 'VISION';
  @IsString() @MaxLength(300) note!: string;
}
class BookingIntentDto implements FlightBookingIntentInput {
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => AncillarySelectionDto) ancillarySelections?: AncillarySelectionDto[];
  @IsUUID() searchId!: string;
  @IsUUID() offerId!: string;
  @IsOptional() @IsUUID() tripId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) @ArrayUnique() @IsUUID('4', { each: true }) travellerIds!: string[];
  @IsUUID() idempotencyKey!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => FlightServiceRequestDto) serviceRequests?: FlightServiceRequestDto[];
}
const validatedIntent = new ValidationPipe({ expectedType: BookingIntentDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Check the selected flight and travellers, then try again.') });
class GuestCheckoutAttemptDto implements GuestCheckoutAttemptInput {
  @IsUUID() searchId!: string;
  @IsUUID() offerId!: string;
  @IsUUID() idempotencyKey!: string;
  @IsString() @MaxLength(120) contactName!: string;
  @IsEmail() @MaxLength(254) contactEmail!: string;
  @IsString() @Matches(/^\+?[0-9]{7,20}$/) contactPhone!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) @IsString({ each: true }) @MaxLength(120, { each: true }) passengerNames!: string[];
}
const validatedGuestAttempt = new ValidationPipe({ expectedType: GuestCheckoutAttemptDto, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('Check the flight, passenger names, and contact details before continuing.') });

@Controller('flights')
export class PublicFlightController {
  constructor(@Inject(FlightService) private readonly service: FlightService,
    @Inject(GuestCheckoutAttemptsService) private readonly attempts: GuestCheckoutAttemptsService,
    @Inject(FlightAncillariesService) private readonly ancillaries: FlightAncillariesService,
    @Inject(FlightAncillaryPurchaseService) private readonly extras: FlightAncillaryPurchaseService) {}
  @Get('popular-cached-fares') @Header('Cache-Control', 'public, max-age=30')
  async popularCachedFares(@Req() request: ContextRequest, @Query('origin') origin = 'DAC', @Query('currency') currency = 'BDT') {
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Choose a valid departure airport and currency.');
    return { success: true, data: await this.service.popularCachedFares(origin, currency), requestId: request.requestId };
  }
  @Post('ancillaries') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @UseGuards(OptionalCustomerAuthGuard, FlightRateGuard)
  async additionalServices(@Body(validatedAncillaryLookup) body: AncillaryLookupDto, @Req() request: ContextRequest) {
    return { success: true, data: await this.ancillaries.lookup(request.identity?.customerId ?? null, body), requestId: request.requestId };
  }
  @Post('search')
  @UseGuards(OptionalCustomerAuthGuard, FlightRateGuard)
  @HttpCode(200)
  async search(@Body(validated) body: FlightSearchDto, @Req() request: ContextRequest): Promise<ApiSuccess<FlightSearchResponse>> {
    if (body.tripId && !request.identity) throw new ApiException('AUTHENTICATION_REQUIRED', 'Please sign in to search flights for a trip.', 401);
    return { success: true, data: await this.service.search(request.identity?.customerId ?? null, request.requestId, body), requestId: request.requestId };
  }
  @Post('search/stream') @HttpCode(200)
  @UseGuards(OptionalCustomerAuthGuard, FlightRateGuard)
  async streamSearch(@Body(validated) body: FlightSearchDto, @Req() request: ContextRequest, @Res() response: Response): Promise<void> {
    if (body.tripId && !request.identity) throw new ApiException('AUTHENTICATION_REQUIRED', 'Please sign in to search flights for a trip.', 401);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const deltas=request.headers['x-flight-stream-format']==='delta-v1';
    let currentSearchId='';
    const sent=new Map<string,string>();
    const send = (event: FlightSearchEvent) => {
      if (!response.destroyed && !response.writableEnded) response.write(JSON.stringify(event) + '\n');
    };
    send({ type: 'started' });
    const sendResults=(result:FlightSearchResponse,complete:boolean)=>{
      if(!deltas){send({type:'results',result,complete});return;}
      if(currentSearchId!==result.searchId){sent.clear();currentSearchId=result.searchId;}
      const ids=new Set(result.offers.map(offer=>offer.offerId));
      const removedOfferIds=[...sent.keys()].filter(id=>!ids.has(id));
      removedOfferIds.forEach(id=>sent.delete(id));
      const offers=result.offers.filter(offer=>{
        const fingerprint=JSON.stringify(offer);
        if(sent.get(offer.offerId)===fingerprint)return false;
        sent.set(offer.offerId,fingerprint);return true;
      });
      if(offers.length||removedOfferIds.length||complete)send({type:'delta',result:{...result,offers},removedOfferIds,complete});
    };
    try {
      const result = await this.service.search(request.identity?.customerId ?? null, request.requestId, body,
        async (result) => { if (result.offers.length) sendResults(result,false); });
      sendResults(result,true);
    } catch (error) {
      send({ type: 'error', code: error instanceof ApiException ? error.code : 'DEPENDENCY_UNAVAILABLE',
        message: 'Flight search could not finish. Please try again shortly.', requestId: request.requestId });
    } finally { response.end(); }
  }
  @Post('checkout-attempts')
  @UseGuards(OptionalCustomerAuthGuard, FlightRateGuard)
  @HttpCode(201)
  async submitCheckout(@Body(validatedGuestAttempt) body: GuestCheckoutAttemptDto, @Req() request: ContextRequest) {
    return { success: true, data: await this.attempts.submit(body, request.identity?.customerId ?? null), requestId: request.requestId };
  }
}

@Controller('flights')
@UseGuards(CustomerAuthGuard)
export class FlightController {
  constructor(@Inject(BookingIntentService) private readonly intents: BookingIntentService,
    @Inject(FlightBookingsService) private readonly bookings: FlightBookingsService,
    @Inject(FlightTicketingService) private readonly ticketing: FlightTicketingService,
    @Inject(FlightAncillariesService) private readonly ancillaries: FlightAncillariesService,
    @Inject(FlightAncillaryPurchaseService) private readonly extras: FlightAncillaryPurchaseService) {}

  @Post('bookings/:id/extras/review') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(CustomerRateLimitGuard)
  async reviewExtras(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({expectedType: AncillaryReviewDto, transform: true, whitelist: true, forbidNonWhitelisted: true})) body: AncillaryReviewDto | undefined, @Req() request: ContextRequest) {
    return { success: true, data: await this.extras.prepare(user.customerId, id, body?.refresh === true), requestId: request.requestId };
  }
  @Post('bookings/:id/refresh-checkout') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(CustomerRateLimitGuard)
  async refreshCheckout(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) {
    return {success:true,data:await this.bookings.refreshCheckout(user.customerId,id),requestId:request.requestId};
  }
  @Post('bookings/:id/extras/confirm') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(CustomerRateLimitGuard)
  async confirmExtras(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ expectedType: AncillaryPurchaseConfirmationDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: AncillaryPurchaseConfirmationDto, @Req() request: ContextRequest) {
    return { success: true, data: await this.extras.confirm(user.customerId, id, body.reviewId), requestId: request.requestId };
  }
  @Post('bookings/:id/extras/skip') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(CustomerRateLimitGuard)
  async skipExtras(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) {
    return { success: true, data: await this.extras.skip(user.customerId, id), requestId: request.requestId };
  }
  @Post('bookings/:id/extras/reconcile') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(CustomerRateLimitGuard)
  async reconcileExtras(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) {
    return { success: true, data: await this.extras.reconcile(user.customerId, id), requestId: request.requestId };
  }
  @Get('bookings/capabilities')
  async bookingCapabilities(@Req() request: ContextRequest) { return { success: true, data: { ...this.bookings.capabilities(), ...await this.ticketing.capabilities() }, requestId: request.requestId }; }
  @Post('bookings/:id/issue-tickets') @HttpCode(200) @UseGuards(CustomerRateLimitGuard)
  async issueTickets(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Body(validateTicketing) body: CancelReservationDto, @Req() request: ContextRequest) {
    return { success: true, data: await this.ticketing.issue(user.customerId, id, body.confirmedPnr), requestId: request.requestId };
  }
  @Get('bookings') @Header('Cache-Control', 'no-store')
  async bookingsList(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest) { return { success: true, data: await this.bookings.list(user.customerId), requestId: request.requestId }; }
  @Get('bookings/:id') @Header('Cache-Control', 'no-store')
  async bookingDetail(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) { return { success: true, data: await this.bookings.detail(user.customerId, id), requestId: request.requestId }; }
  @Post('bookings/:id/refresh') @HttpCode(200) @UseGuards(CustomerRateLimitGuard)
  async refreshBooking(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) { return { success: true, data: await this.bookings.refresh(user.customerId, id), requestId: request.requestId }; }
  @Post('bookings/:id/cancel') @HttpCode(200) @UseGuards(CustomerRateLimitGuard)
  async cancelBooking(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Body(validateCancellation) body: CancelReservationDto, @Req() request: ContextRequest) { return { success: true, data: await this.bookings.cancelUnticketed(user.customerId,id,body.confirmedPnr), requestId: request.requestId }; }
  @Post('booking-intents/:id/reserve') @HttpCode(200) @UseGuards(CustomerRateLimitGuard)
  async reserve(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Body(validateReservation) input: ReservationDto, @Req() request: ContextRequest) { return { success: true, data: await this.bookings.reserve(user.customerId, id, input), requestId: request.requestId }; }

  @Get('booking-intents/:id/booking') @Header('Cache-Control', 'no-store')
  async intentBooking(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) {
    return { success: true, data: await this.bookings.forIntent(user.customerId, id), requestId: request.requestId };
  }
  @Post('booking-intents/:id/ancillaries') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(FlightRateGuard)
  async intentAncillaries(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) {
    return { success: true, data: await this.ancillaries.lookupIntent(user.customerId, id), requestId: request.requestId };
  }
  @Post('booking-intents/:id/ancillary-selections') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(CustomerRateLimitGuard)
  async saveAncillarySelections(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ expectedType: AncillarySelectionsDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: AncillarySelectionsDto, @Req() request: ContextRequest) {
    const extras = this.ancillaries.resolveSelections(user.customerId, { intentId: id }, body.selections);
    return { success: true, data: await this.intents.saveAncillaryRequests(user.customerId, id, extras), requestId: request.requestId };
  }

  @Post('booking-intents') @HttpCode(201)
  async createIntent(@CurrentUser() user: AuthenticatedUserContext, @Body(validatedIntent) body: BookingIntentDto, @Req() request: ContextRequest): Promise<ApiSuccess<FlightBookingIntent>> {
    const extras = this.ancillaries.resolveSelections(user.customerId, { searchId: body.searchId, offerId: body.offerId }, body.ancillarySelections ?? []);
    return { success: true, data: await this.intents.create(user.customerId, body, extras), requestId: request.requestId };
  }
  @Get('booking-intents')
  async listIntents(@CurrentUser() user: AuthenticatedUserContext, @Query('tripId', ParseUUIDPipe) tripId: string, @Req() request: ContextRequest): Promise<ApiSuccess<FlightBookingIntent[]>> {
    return { success: true, data: await this.intents.list(user.customerId, tripId), requestId: request.requestId };
  }
  @Get('booking-intents/:id')
  async intent(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<FlightBookingIntent>> {
    return { success: true, data: await this.intents.detail(user.customerId, id), requestId: request.requestId };
  }
  @Post('booking-intents/:id/validate') @HttpCode(200)
  async validateIntent(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<FlightBookingIntent>> {
    return { success: true, data: await this.intents.validate(user.customerId, id, request.requestId), requestId: request.requestId };
  }
  @Post('booking-intents/:id/confirm-price') @HttpCode(200)
  async confirmPrice(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<FlightBookingIntent>> {
    return { success: true, data: await this.intents.confirmPrice(user.customerId, id), requestId: request.requestId };
  }
  @Delete('booking-intents/:id')
  async cancelIntent(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<FlightBookingIntent>> {
    return { success: true, data: await this.intents.cancel(user.customerId, id), requestId: request.requestId };
  }
}
