import type { FareWatch, FlightSearchRequest, TravelSupportRequest } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const travelService = {
  async watches() { return (await apiClient.get<FareWatch[]>('/travel/fare-watches')).data; },
  async watch(search: FlightSearchRequest, targetAmount: number) { return (await apiClient.post<FareWatch>('/travel/fare-watches', { search, targetAmount })).data; },
  async removeWatch(id: string) { return (await apiClient.delete(`/travel/fare-watches/${encodeURIComponent(id)}`)).data; },
  async requests() { return (await apiClient.get<TravelSupportRequest[]>('/travel/support-requests')).data; },
  async approve(request: TravelSupportRequest) { return (await apiClient.post<TravelSupportRequest>(`/travel/support-requests/${encodeURIComponent(request.id)}/approve`, { expectedVersion: request.version })).data; },
};
