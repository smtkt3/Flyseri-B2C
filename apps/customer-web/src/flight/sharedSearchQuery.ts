import type { FlightSearchRequest } from '@flyseri/types';
import { flightBrowseSearchQuery, type FlightBrowseSnapshot } from './flightSearchBrowsing';

export type SharedFlightFilters = Pick<FlightBrowseSnapshot, 'sort' | 'stopFilter' | 'baggageOnly' | 'refundableOnly' | 'selectedAirlines' | 'selectedStopovers' | 'selectedAirports' | 'selectedCabins' | 'selectedAircrafts' | 'departureWindow' | 'arrivalWindow' | 'maxDuration' | 'maxPrice'>;
export function readSharedFlightFilters(params: URLSearchParams): Partial<SharedFlightFilters> {
  if (params.get('shared') !== '1') return {};
  const raw = params.get('filters');
  if (!raw || raw.length > 4000) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Partial<SharedFlightFilters> = {};
    if (['RECOMMENDED','DIRECT_FIRST','CHEAPEST','FASTEST','EARLIEST'].includes(value.sort)) result.sort = value.sort;
    if (['ANY','NONSTOP','ONE_OR_FEWER','TWO_OR_MORE'].includes(value.stopFilter)) result.stopFilter = value.stopFilter;
    for (const key of ['baggageOnly','refundableOnly'] as const) if (typeof value[key] === 'boolean') result[key] = value[key];
    for (const key of ['selectedAirlines','selectedStopovers','selectedAirports','selectedCabins','selectedAircrafts'] as const) {
      if (Array.isArray(value[key])) result[key] = [...new Set<string>(value[key].filter((item: unknown) => typeof item === 'string' && /^[\w .()-]{1,48}$/.test(item)))].slice(0,20);
    }
    for (const key of ['departureWindow','arrivalWindow'] as const) {
      const range = value[key];
      if (Array.isArray(range) && range.length === 2 && range.every(item => Number.isInteger(item) && item >= 0 && item <= 1440) && range[0] <= range[1]) result[key] = [range[0],range[1]];
    }
    for (const key of ['maxDuration','maxPrice'] as const) if (value[key] === null || typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0 && value[key] <= (key === 'maxDuration' ? 10080 : 1e9)) result[key] = value[key];
    return result;
  } catch { return {}; }
}
export function sharedFlightSearchQuery(request: FlightSearchRequest, filters: SharedFlightFilters): string {
  const params = new URLSearchParams(flightBrowseSearchQuery(request));
  // Public links carry search criteria only, never account or live offer identifiers.
  params.delete('tripId');
  params.set('shared','1');
  params.set('filters',JSON.stringify(filters));
  const safeFilters = readSharedFlightFilters(params);
  params.set('filters',JSON.stringify(safeFilters));
  return '?' + params.toString();
}
