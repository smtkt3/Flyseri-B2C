import type { TripDestinationInput, TripDetail, TripInput, TripSummary } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const tripService = {
  async list(filter: { archived?: boolean } = {}): Promise<TripSummary[]> { return (await apiClient.get<TripSummary[]>(filter.archived ? '/trips?archived=true' : '/trips')).data; },
  async detail(id: string): Promise<TripDetail> { return (await apiClient.get<TripDetail>(`/trips/${encodeURIComponent(id)}`)).data; },
  async create(input: TripInput): Promise<TripDetail> { return (await apiClient.post<TripDetail>('/trips', input)).data; },
  async update(id: string, patch: Partial<TripInput>): Promise<TripDetail> { return (await apiClient.patch<TripDetail>(`/trips/${encodeURIComponent(id)}`, patch)).data; },
  async archive(id: string): Promise<void> { await apiClient.delete(`/trips/${encodeURIComponent(id)}`); },
  async addTraveller(id: string, travellerId: string): Promise<TripDetail> { return (await apiClient.post<TripDetail>(`/trips/${encodeURIComponent(id)}/travellers`, { travellerId })).data; },
  async removeTraveller(id: string, travellerId: string): Promise<void> { await apiClient.delete(`/trips/${encodeURIComponent(id)}/travellers/${encodeURIComponent(travellerId)}`); },
  async addDestination(id: string, input: TripDestinationInput): Promise<TripDetail> { return (await apiClient.post<TripDetail>(`/trips/${encodeURIComponent(id)}/destinations`, input)).data; },
  async updateDestination(id: string, destinationId: string, input: Partial<TripDestinationInput>): Promise<TripDetail> { return (await apiClient.patch<TripDetail>(`/trips/${encodeURIComponent(id)}/destinations/${encodeURIComponent(destinationId)}`, input)).data; },
  async removeDestination(id: string, destinationId: string): Promise<void> { await apiClient.delete(`/trips/${encodeURIComponent(id)}/destinations/${encodeURIComponent(destinationId)}`); },
};
