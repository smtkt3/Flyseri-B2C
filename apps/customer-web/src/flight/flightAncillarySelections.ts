import type { FlightAncillaryRequest, FlightAncillaryResponse, FlightAncillarySelectionInput } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { airlineServiceCategory } from './airlineServiceCategories';

type Service = FlightAncillaryResponse['services'][number];
export function ancillaryKey(service: Pick<Service, 'name' | 'serviceCode' | 'groupCode' | 'segmentLabels' | 'passengerIndexes'>) {
  return JSON.stringify([service.name, service.serviceCode, service.groupCode ?? null, service.segmentLabels, service.passengerIndexes]);
}
export function requestedExtra(service: Service): FlightAncillaryRequest {
  return { id: ancillaryKey(service), name: service.name, serviceCode: service.serviceCode, groupCode: service.groupCode,
    category: airlineServiceCategory(service), segmentLabels: service.segmentLabels, passengerIndexes: service.passengerIndexes,
    amount: service.amount, currency: service.currency, status: 'REQUESTED' };
}
export function ancillarySelectionInputs(selected: FlightAncillaryRequest[], quote: FlightAncillaryResponse): FlightAncillarySelectionInput[] {
  if (!selected.length) return [];
  if (!quote.quoteId) throw new Error('Refresh airline extras before saving your choices.');
  return selected.map(extra => {
    const serviceIndex = quote.services.findIndex(service => ancillaryKey(service) === ancillaryKey(extra) && service.amount === extra.amount && service.currency === extra.currency);
    if (serviceIndex < 0) throw new Error('An extra has changed or is no longer available. Refresh offers and review your choices.');
    return { quoteId: quote.quoteId!, serviceIndex };
  });
}
// Obtain an owned, current receipt after guest checkout or a refreshed airfare.
export async function refreshAncillarySelections(input: { searchId: string; offerId: string; passengers: { givenName: string; surname: string }[] }, selected: FlightAncillaryRequest[]) {
  if (!selected.length) return [];
  return ancillarySelectionInputs(selected, await flightService.ancillaries(input));
}
