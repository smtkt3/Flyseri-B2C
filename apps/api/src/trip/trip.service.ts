import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { TripDestinationInput, TripDetail, TripInput, TripSummary } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { TRIP_STORE } from '../tokens.js';
import { assertDates, TripConflictError, TripDateError, TripTravellerUnavailableError, type TripListFilter, type TripStore } from './trip.repository.js';

const notFound = () => new ApiException('NOT_FOUND', 'The requested trip was not found.', 404);
function uniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && uniqueViolation(error.cause);
}
function mapError(error: unknown): never {
  if (error instanceof TripDateError) throw new ApiException('VALIDATION_ERROR', 'Check the travel dates and try again.', 400);
  if (error instanceof TripTravellerUnavailableError) throw new ApiException('VALIDATION_ERROR', 'A selected traveller is unavailable.', 400);
  if (error instanceof TripConflictError || uniqueViolation(error)) throw new ApiException('CONFLICT', 'This item is already part of the trip.', 409);
  throw error;
}

@Injectable()
export class TripService {
  constructor(@Inject(TRIP_STORE) private readonly store: TripStore | undefined) {}
  private required(): TripStore {
    if (!this.store) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Trips are temporarily unavailable.', 503);
    return this.store;
  }
  list(customerId: string, filter: TripListFilter): Promise<TripSummary[]> { return this.required().list(customerId, filter); }
  async detail(customerId: string, tripId: string): Promise<TripDetail> { return await this.required().detail(customerId, tripId) ?? Promise.reject(notFound()); }
  async create(customerId: string, input: TripInput): Promise<TripDetail> {
    try {
      assertDates(input.startDate, input.endDate);
      for (const destination of input.destinations ?? []) assertDates(destination.startDate, destination.endDate);
      return await this.required().create(customerId, input);
    } catch (error) { return mapError(error); }
  }
  async update(customerId: string, tripId: string, patch: Partial<TripInput>): Promise<TripDetail> {
    if (!Object.keys(patch).length) throw new BadRequestException();
    try { return await this.required().update(customerId, tripId, patch) ?? Promise.reject(notFound()); }
    catch (error) { return mapError(error); }
  }
  async archive(customerId: string, tripId: string): Promise<{ archived: true }> {
    if (!await this.required().archive(customerId, tripId)) throw notFound();
    return { archived: true };
  }
  async addTraveller(customerId: string, tripId: string, travellerId: string): Promise<TripDetail> {
    try { return await this.required().addTraveller(customerId, tripId, travellerId) ?? Promise.reject(notFound()); }
    catch (error) { return mapError(error); }
  }
  async removeTraveller(customerId: string, tripId: string, travellerId: string): Promise<{ removed: true }> {
    if (!await this.required().removeTraveller(customerId, tripId, travellerId)) throw notFound();
    return { removed: true };
  }
  async addDestination(customerId: string, tripId: string, input: TripDestinationInput): Promise<TripDetail> {
    try { assertDates(input.startDate, input.endDate); return await this.required().addDestination(customerId, tripId, input) ?? Promise.reject(notFound()); }
    catch (error) { return mapError(error); }
  }
  async updateDestination(customerId: string, tripId: string, destinationId: string, input: Partial<TripDestinationInput>): Promise<TripDetail> {
    if (!Object.keys(input).length) throw new BadRequestException();
    try { return await this.required().updateDestination(customerId, tripId, destinationId, input) ?? Promise.reject(notFound()); }
    catch (error) { return mapError(error); }
  }
  async removeDestination(customerId: string, tripId: string, destinationId: string): Promise<{ removed: true }> {
    if (!await this.required().removeDestination(customerId, tripId, destinationId)) throw notFound();
    return { removed: true };
  }
}
