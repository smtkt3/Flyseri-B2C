import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { CustomerProfile, TravellerProfile } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { CUSTOMER_STORE } from '../tokens.js';
import { TravellerConflictError, type CustomerStore, type TravellerInput, type TravellerPatch } from './customer.repository.js';

function hasFields(value: object): boolean { return Object.keys(value).length > 0; }
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}

@Injectable()
export class CustomerService {
  constructor(@Inject(CUSTOMER_STORE) private readonly store: CustomerStore) {}

  async updateProfile(customerId: string, patch: Partial<CustomerProfile>): Promise<CustomerProfile> {
    if (!hasFields(patch)) throw new BadRequestException();
    return this.store.updateProfile(customerId, patch);
  }

  listTravellers(customerId: string): Promise<TravellerProfile[]> { return this.store.listTravellers(customerId); }

  async getTraveller(customerId: string, travellerId: string): Promise<TravellerProfile> {
    const traveller = await this.store.getTraveller(customerId, travellerId);
    if (!traveller) throw new ApiException('NOT_FOUND', 'The requested resource was not found.', 404);
    return traveller;
  }

  async createTraveller(customerId: string, input: TravellerInput): Promise<TravellerProfile> {
    try { return await this.store.createTraveller(customerId, input); }
    catch (error) {
      if (error instanceof TravellerConflictError || isUniqueViolation(error)) throw new ApiException('CONFLICT', 'This traveller relationship conflicts with an existing record.', 409);
      throw error;
    }
  }

  async updateTraveller(customerId: string, travellerId: string, patch: TravellerPatch): Promise<TravellerProfile> {
    if (!hasFields(patch)) throw new BadRequestException();
    try {
      const traveller = await this.store.updateTraveller(customerId, travellerId, patch);
      if (!traveller) throw new ApiException('NOT_FOUND', 'The requested resource was not found.', 404);
      return traveller;
    } catch (error) {
      if (error instanceof TravellerConflictError || isUniqueViolation(error)) throw new ApiException('CONFLICT', 'This traveller relationship conflicts with an existing record.', 409);
      throw error;
    }
  }

  async archiveTraveller(customerId: string, travellerId: string): Promise<{ archived: true }> {
    if (!await this.store.archiveTraveller(customerId, travellerId)) throw new ApiException('NOT_FOUND', 'The requested resource was not found.', 404);
    return { archived: true };
  }
}
