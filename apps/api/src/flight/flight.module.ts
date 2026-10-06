import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { createLogger } from '@flyseri/logging';
import type { AppConfig } from '@flyseri/config';
import { APP_CONFIG, BOOKING_INTENT_STORE, DATABASE_CONNECTION, FLIGHT_PROVIDER, FLIGHT_TELEMETRY, OFFER_VALIDATION_PROVIDER, REDIS_STORE, SABRE_BOOKING_CLIENT } from '../tokens.js';
import type { DatabaseConnection } from '@flyseri/database';
import type { RedisStore } from '@flyseri/redis';
import { DrizzleBookingIntentStore } from './booking-intent.repository.js';
import { BookingIntentService } from './booking-intent.service.js';
import { BookingFlightValidationProvider, FlightOfferValidationService } from './flight-offer-validation.service.js';
import { FlightController, PublicFlightController } from './flight.controller.js';
import { FlightRateGuard } from './flight-rate.guard.js';
import { FlightService } from './flight.service.js';
import { FlightTelemetry } from './flight.telemetry.js';
import { SabreAuthService } from './sabre-auth.service.js';
import { SabreOAuthV3Fetcher } from './sabre-oauth-v3.fetcher.js';
import { SabreBfmClient } from './sabre-bfm.client.js';
import { buildSabreBfmV5Request, mapSabreV5Offers } from './sabre-v5.contract.js';
import { SabreRevalidateClient } from './sabre-revalidate.client.js';
import { SabreBookingManagementClient } from './sabre-booking-management.client.js';
import { GuestCheckoutAttemptsService } from './guest-checkout-attempts.service.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { FlightAncillariesService } from './flight-ancillaries.service.js';
import { FlightTicketingService } from './flight-ticketing.service.js';
import { FlightFulfillmentPoller } from './flight-fulfillment.poller.js';
import { FlightAncillaryPurchaseService } from './flight-ancillary-purchase.service.js';
import { SabreAtpcoAncillariesClient } from './sabre-atpco-ancillaries.client.js';
import {AirportDirectoryService} from './airport-directory.service.js';
import {AirportDirectoryController} from './airport-directory.controller.js';
import {FlightWarmupService} from './flight-warmup.service.js';
import { FlightDisplayCurrencyService } from './flight-display-currency.service.js';
import { FlightDisplayCurrencyController } from './flight-display-currency.controller.js';

const configured = (config: AppConfig) => config.SABRE_ENV === 'CERT' &&
  config.SABRE_BASE_URL === 'https://api.cert.platform.sabre.com' &&
  config.SABRE_AUTH_URL === 'https://api.cert.platform.sabre.com/v3/auth/token' &&
  Boolean(config.SABRE_CLIENT_ID && config.SABRE_CLIENT_SECRET && config.SABRE_USERNAME && config.SABRE_PASSWORD && config.SABRE_PCC);

@Module({
  imports: [CustomerModule],
  controllers: [PublicFlightController, FlightController,AirportDirectoryController, FlightDisplayCurrencyController],
  providers: [
    AirportDirectoryService,FlightWarmupService, FlightDisplayCurrencyService,
    FlightService, FlightRateGuard, BookingIntentService, FlightOfferValidationService, GuestCheckoutAttemptsService, FlightBookingsService, FlightAncillariesService, FlightTicketingService, FlightAncillaryPurchaseService, FlightFulfillmentPoller,
    { provide: SabreAtpcoAncillariesClient, useFactory: (config: AppConfig, auth: SabreAuthService | undefined) =>
      configured(config) && auth ? new SabreAtpcoAncillariesClient(config, auth) : undefined, inject: [APP_CONFIG, SabreAuthService] },
    { provide: BOOKING_INTENT_STORE, useFactory: (db: DatabaseConnection | undefined) => db ? new DrizzleBookingIntentStore(db) : undefined, inject: [DATABASE_CONNECTION] },
    { provide: FLIGHT_TELEMETRY, useFactory: (config: AppConfig) => new FlightTelemetry(createLogger(config.APP_ENV)), inject: [APP_CONFIG] },
    { provide: SabreAuthService, useFactory: (config: AppConfig, redis: RedisStore | undefined, telemetry: FlightTelemetry) =>
      configured(config) ? new SabreAuthService(config, redis, new SabreOAuthV3Fetcher(config), telemetry) : undefined,
      inject: [APP_CONFIG, REDIS_STORE, FLIGHT_TELEMETRY] },
    { provide: FLIGHT_PROVIDER, useFactory: (config: AppConfig, auth: SabreAuthService | undefined, telemetry: FlightTelemetry) =>
      configured(config) && auth ? new SabreBfmClient(config, auth, {
        buildRequest: (search, mode) => buildSabreBfmV5Request(search, config, mode), mapResponse: (response, search) => mapSabreV5Offers(response, 1000, search?.tripType === 'MULTI_CITY'),
      }, fetch, telemetry) : undefined,
      inject: [APP_CONFIG, SabreAuthService, FLIGHT_TELEMETRY] },
    { provide: OFFER_VALIDATION_PROVIDER, useFactory: (config: AppConfig, auth: SabreAuthService | undefined, telemetry: FlightTelemetry, redis: RedisStore | undefined) =>
      configured(config) && auth ? new BookingFlightValidationProvider(new SabreRevalidateClient(config, auth, fetch, telemetry, redis), new SabreBookingManagementClient(config, auth), config) : undefined,
      inject: [APP_CONFIG, SabreAuthService, FLIGHT_TELEMETRY, REDIS_STORE] },
    { provide: SABRE_BOOKING_CLIENT, useFactory: (config: AppConfig, auth: SabreAuthService | undefined) =>
      configured(config) && auth ? new SabreBookingManagementClient(config, auth) : undefined,
      inject: [APP_CONFIG, SabreAuthService] },
  ],
  exports: [FLIGHT_TELEMETRY, SABRE_BOOKING_CLIENT, FlightService, BookingIntentService, FlightBookingsService],
})
export class FlightModule {}
