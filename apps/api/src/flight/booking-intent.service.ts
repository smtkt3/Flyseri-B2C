import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import type { FlightBookingIntent, FlightBookingIntentInput, FlightAncillaryRequest } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, BOOKING_INTENT_STORE, FLIGHT_TELEMETRY, REDIS_STORE } from '../tokens.js';
import { BookingIntentConflictError, BookingIntentTravellerError, BookingIntentPassengerError, type BookingIntentStore } from './booking-intent.repository.js';
import { FlightService } from './flight.service.js';
import type { FlightTelemetry } from './flight.telemetry.js';
import { FlightOfferValidationService } from './flight-offer-validation.service.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'The latest flight fare cannot be confirmed yet. Please try again later.', 503);
const missing = () => new ApiException('NOT_FOUND', 'Flight selection not found.', 404);

@Injectable()
export class BookingIntentService {
  private readonly localValidations = new Set<string>();
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BOOKING_INTENT_STORE) private readonly store: BookingIntentStore | undefined,
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
    @Inject(FlightService) private readonly flights: FlightService,
    @Inject(FLIGHT_TELEMETRY) private readonly telemetry: FlightTelemetry,
    @Inject(FlightOfferValidationService) private readonly validation: FlightOfferValidationService,
  ) {}

  async create(customerId: string, input: FlightBookingIntentInput, ancillaryRequests: FlightAncillaryRequest[] = []): Promise<FlightBookingIntent> {
    if (!this.store) throw unavailable();
    const selection = await this.flights.selectedOffer(customerId, input.searchId, input.offerId);
    if ((input.tripId ?? null) !== selection.tripId) throw new ApiException('VALIDATION_ERROR', 'This flight search does not match the selected trip.', 400);
    const count = selection.search.adults + selection.search.children + selection.search.infants;
    if (input.travellerIds.length !== count || new Set(input.travellerIds).size !== count) {
      throw new ApiException('VALIDATION_ERROR', 'Choose one different traveller for each passenger.', 400);
    }
    if (ancillaryRequests.some(extra => !extra.passengerIndexes.length || extra.passengerIndexes.some(index => index < 0 || index >= input.travellerIds.length))) throw new ApiException('VALIDATION_ERROR', 'Review the travelers assigned to these extras.', 400);
    const serviceRequests = input.serviceRequests ?? [];
    if (serviceRequests.some(request => !input.travellerIds.includes(request.travellerId)) ||
        new Set(serviceRequests.map(request => request.travellerId)).size !== serviceRequests.length) {
      throw new ApiException('VALIDATION_ERROR', 'Service requests must belong to one selected traveller each.', 400);
    }
    if (this.redis) {
      const rate = await this.redis.consumeRateLimit(`flight:intent:customer:${customerId}`, this.config.FLIGHT_BOOKING_INTENT_RATE_LIMIT_PER_MINUTE, 60);
      if (rate === 'limited') throw new ApiException('RATE_LIMITED', 'Too many flight selections. Please try again shortly.', 429);
      if (rate === 'unavailable' && this.config.APP_ENV === 'production') throw unavailable();
    } else if (this.config.APP_ENV === 'production') throw unavailable();
    try {
      const saved = await this.store.create({ customerId, tripId: selection.tripId, searchId: input.searchId,
        offerId: input.offerId, idempotencyKey: input.idempotencyKey, travellerIds: input.travellerIds,
        offer: selection.offer, search: selection.search, serviceRequests, ancillaryRequests });
      if (saved.created) this.telemetry.increment('booking_intent_created_total');
      return saved.intent;
    } catch (error) {
      if (error instanceof BookingIntentPassengerError) throw new ApiException('VALIDATION_ERROR', 'Complete traveler birth dates and match the adult, child and infant counts in your search. A traveler changing age category during the trip needs assistance.', 400);
      if (error instanceof BookingIntentTravellerError) throw missing();
      if (error instanceof BookingIntentConflictError) throw new ApiException('CONFLICT', 'This selection key was already used for another flight.', 409);
      throw error;
    }
  }

  async saveAncillaryRequests(customerId: string, id: string, requests: FlightAncillaryRequest[]) {
    const intent = await this.detail(customerId, id);
    if (!this.store?.saveAncillaryRequests) throw unavailable();
    if (requests.some(extra => extra.passengerIndexes.some(index => index < 0 || index >= intent.travellerIds.length))) throw new ApiException('VALIDATION_ERROR', 'Review the travelers assigned to these extras.', 400);
    try {
      const saved = await this.store.saveAncillaryRequests(customerId, id, requests);
      if (!saved) throw missing();
      return saved;
    } catch (cause) {
      if (cause instanceof BookingIntentConflictError) throw new ApiException('CONFLICT', 'Extras cannot be changed after reservation starts. Contact Flyseri for booking changes.', 409);
      throw cause;
    }
  }

  async detail(customerId: string, id: string): Promise<FlightBookingIntent> {
    if (!this.store) throw unavailable();
    const intent = await this.store.detail(customerId, id);
    if (!intent) throw missing();
    if (intent.expiresAt && Date.parse(intent.expiresAt) <= Date.now() && ['VALIDATED', 'PRICE_CHANGED', 'READY_FOR_PAYMENT'].includes(intent.status)) {
      return { ...intent, status: 'EXPIRED' };
    }
    return intent;
  }

  async list(customerId: string, tripId: string): Promise<FlightBookingIntent[]> {
    if (!this.store) throw unavailable();
    return this.store.list(customerId, tripId);
  }

  async validate(customerId: string, id: string, requestId: string): Promise<FlightBookingIntent> {
    const intent = await this.detail(customerId, id);
    if (intent.status === 'CANCELLED') throw new ApiException('CONFLICT', 'This flight selection was cancelled.', 409);
    if (!this.store) throw unavailable();
    if (this.redis) {
      const rate = await this.redis.consumeRateLimit(`flight:validate:customer:${customerId}`, this.config.FLIGHT_VALIDATION_RATE_LIMIT_PER_MINUTE, 60);
      if (rate === 'limited') throw new ApiException('RATE_LIMITED', 'Too many fare checks. Please try again shortly.', 429);
      if (rate === 'unavailable' && this.config.APP_ENV === 'production') throw unavailable();
    } else if (this.config.APP_ENV === 'production') throw unavailable();
    this.telemetry.increment('validation_request_total');
    const lockKey = `flight:intent:validate:${id}`;
    const owner = randomUUID();
    const lock = this.redis ? await this.redis.tryLock(lockKey, owner, this.config.SABRE_REQUEST_TIMEOUT_MS * 3 + 5000) : 'local';
    if (lock === 'unavailable' || this.config.APP_ENV === 'production' && lock === 'local') throw unavailable();
    if (lock === 'busy' || lock === 'local' && this.localValidations.has(id)) throw new ApiException('CONFLICT', 'A fare check is already in progress.', 409);
    if (lock === 'local') this.localValidations.add(id);
    try {
      const fresh = await this.detail(customerId, id);
      if (fresh.status === 'CANCELLED') throw new ApiException('CONFLICT', 'This flight selection was cancelled.', 409);
      const outcome = await this.validation.validate(fresh, requestId);
      const saved = await this.store.saveValidation(customerId, id, outcome, this.config.FLIGHT_VALIDATION_TTL_SECONDS);
      if (!saved) throw missing();
      return saved;
    } catch (error) {
      this.telemetry.increment('validation_error_total');
      if (error instanceof BookingIntentConflictError) throw new ApiException('CONFLICT', 'This selection already has a booking attempt.', 409);
      throw error;
    }
    finally {
      if (lock === 'acquired') await this.redis!.releaseLock(lockKey, owner);
      if (lock === 'local') this.localValidations.delete(id);
    }
  }

  async confirmPrice(customerId: string, id: string): Promise<FlightBookingIntent> {
    if (!this.store) throw unavailable();
    // Apply the same lock as revalidation so an older price cannot be accepted mid-check.
    const owner = randomUUID(), lockKey = `flight:intent:validate:${id}`;
    const lock = this.redis ? await this.redis.tryLock(lockKey, owner, this.config.SABRE_REQUEST_TIMEOUT_MS * 3 + 5000) : 'local';
    if (lock === 'unavailable' || this.config.APP_ENV === 'production' && lock === 'local') throw unavailable();
    if (lock === 'busy' || lock === 'local' && this.localValidations.has(id)) throw new ApiException('CONFLICT', 'A fare check is already in progress.', 409);
    if (lock === 'local') this.localValidations.add(id);
    try {
      const confirmed = await this.store.confirmPrice(customerId, id);
      if (!confirmed) throw missing();
      return confirmed;
    } catch (error) {
      if (error instanceof BookingIntentConflictError) throw new ApiException('CONFLICT', 'This fare expired or already has a booking attempt.', 409);
      throw error;
    } finally {
      if (lock === 'acquired') await this.redis!.releaseLock(lockKey, owner);
      if (lock === 'local') this.localValidations.delete(id);
    }
  }

  async cancel(customerId: string, id: string): Promise<FlightBookingIntent> {
    if (!this.store) throw unavailable();
    let intent: FlightBookingIntent | null;
    try { intent = await this.store.cancel(customerId, id); }
    catch (error) {
      if (error instanceof BookingIntentConflictError) throw new ApiException('CONFLICT', 'This selection has a booking attempt. Manage its reservation status instead.', 409);
      throw error;
    }
    if (!intent) throw missing();
    return intent;
  }
}
