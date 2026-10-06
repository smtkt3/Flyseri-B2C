import type { FlightCabin, FlightSearchLeg, FlightSearchRequest, FlightSearchResponse, FlightTripType } from '@flyseri/types';

export type FlightSort = 'RECOMMENDED' | 'DIRECT_FIRST' | 'CHEAPEST' | 'FASTEST' | 'EARLIEST';
export interface FlightBrowseReturn {
  pathname: '/flights' | '/app/flights';
  search: string;
  key: string;
}
export function flightBrowseSearchQuery(request: FlightSearchRequest): string {
  const params = new URLSearchParams({ origin: request.origin, destination: request.destination,
    departureDate: request.departureDate, tripType: request.tripType, adults: String(request.adults),
    children: String(request.children), infants: String(request.infants), cabin: request.cabin,
    currency: request.currency, autoSearch: '1' });
  if (request.tripType === 'ROUND_TRIP' && request.returnDate) params.set('returnDate', request.returnDate);
  if (request.tripType === 'MULTI_CITY' && request.legs) params.set('legs', JSON.stringify(request.legs));
  if (request.tripId) params.set('tripId', request.tripId);
  return '?' + params.toString();
}
export function flightBrowseReturn(value: unknown): FlightBrowseReturn | undefined {
  if (!value || typeof value !== 'object') return;
  const target = value as Partial<FlightBrowseReturn>;
  if ((target.pathname !== '/flights' && target.pathname !== '/app/flights') ||
    typeof target.search !== 'string' || (target.search !== '' && !target.search.startsWith('?')) ||
    typeof target.key !== 'string' || !target.key || target.key.length > 128) return;
  return { pathname: target.pathname, search: target.search, key: target.key };
}
export interface FlightBrowseSnapshot {
  route?: { pathname: string; search: string };
  owner: string | null;
  publicSearch: boolean;
  savedAt: number;
  form: { origin: string; destination: string; departureDate: string; returnDate: string; tripType: FlightTripType; multiLegs: FlightSearchLeg[]; adults: number; children: number; infants: number; cabin: FlightCabin; currency: string };
  result: FlightSearchResponse | null;
  wasLoading: boolean;
  refreshOnReturn?: boolean;
  sort: FlightSort;
  stopFilter: 'ANY' | 'NONSTOP' | 'ONE_OR_FEWER' | 'TWO_OR_MORE';
  baggageOnly: boolean;
  refundableOnly: boolean;
  selectedAirlines: string[];
  selectedStopovers: string[];
  selectedAirports: string[];
  selectedCabins: string[];
  selectedAircrafts: string[];
  departureWindow: [number, number];
  arrivalWindow: [number, number];
  maxDuration: number | null;
  maxPrice: number | null;
  airlineQuery: string;
  airlinesExpanded: boolean;
  visibleCount: number;
  selectedLegKeys: string[];
  selectedFareKeys?: (string | null)[];
  fareChoice: Record<string, string>;
  openDetails: string | null;
  comparedIds: string[];
  displayKeys: string[];
  scrollY: number;
  anchorKey: string | null;
  anchorOffset: number;
}

// Flight-only state: no traveler profiles, contact details, passports or tokens.
// Tab storage survives reloads without extending the supplier quote lifetime.
const snapshots = new Map<string, FlightBrowseSnapshot>();
const storageKey = 'flyseri.flight-browse.v1';
const retentionMs = 30 * 60_000;
let loaded = false;
function loadSnapshots() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 1_500_000) return;
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(-3)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object') continue;
      const value = entry[1] as FlightBrowseSnapshot;
      if (!Number.isFinite(value.savedAt) || Date.now() - value.savedAt > retentionMs || value.savedAt > Date.now() + 60_000) continue;
      if (!value.form || typeof value.form.origin !== 'string' || typeof value.form.destination !== 'string' ||
        typeof value.form.departureDate !== 'string' || typeof value.form.returnDate !== 'string' ||
        !['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'].includes(value.form.tripType) ||
        typeof value.form.currency !== 'string' || !Array.isArray(value.form.multiLegs) ||
        typeof value.publicSearch !== 'boolean' || (value.owner !== null && typeof value.owner !== 'string')) continue;
      const arrayKeys = ['selectedLegKeys', 'selectedAirlines', 'selectedStopovers', 'selectedAirports', 'selectedCabins', 'selectedAircrafts', 'departureWindow', 'arrivalWindow', 'comparedIds', 'displayKeys'] as const;
      if (arrayKeys.some(key => !Array.isArray(value[key])) || !value.fareChoice || typeof value.fareChoice !== 'object') continue;
      if (value.result && (!Array.isArray(value.result.offers) || typeof value.result.searchId !== 'string' ||
        typeof value.result.expiresAt !== 'string' || typeof value.result.searchedAt !== 'string' ||
        value.result.offers.some(offer => !offer || typeof offer.offerId !== 'string' || !Array.isArray(offer.airlineCodes) || !offer.outbound || !Array.isArray(offer.outbound.segments)))) continue;
      snapshots.set(entry[0], value);
    }
  } catch { /* Restricted storage or corrupt data must not prevent searching. */ }
}
function persistSnapshots() {
  try {
    const entries: [string, FlightBrowseSnapshot][] = [];
    let size = 0;
    for (const [key, snapshot] of [...snapshots].reverse()) {
      if (Date.now() - snapshot.savedAt > retentionMs) continue;
      let stored = snapshot;
      let serialized = JSON.stringify([key, stored]);
      if (serialized.length > 1_000_000) {
        stored = { ...snapshot, result: null, refreshOnReturn: !!snapshot.result || snapshot.wasLoading };
        serialized = JSON.stringify([key, stored]);
      }
      if (size + serialized.length > 1_400_000) continue;
      size += serialized.length;
      entries.unshift([key, stored]);
    }
    sessionStorage.setItem(storageKey, JSON.stringify(entries));
  } catch { /* In-memory navigation remains available if storage is full/blocked. */ }
}
export function rememberFlightBrowse(key: string, snapshot: FlightBrowseSnapshot) {
  loadSnapshots();
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  while (snapshots.size > 3) snapshots.delete(snapshots.keys().next().value!);
  persistSnapshots();
}
export function recallFlightBrowse(key: string, owner: string | null, publicSearch: boolean): FlightBrowseSnapshot | undefined {
  loadSnapshots();
  const value = snapshots.get(key);
  if (!value || value.publicSearch !== publicSearch) return;
  if (Date.now() - value.savedAt > retentionMs) { snapshots.delete(key); return; }
  if (value.owner !== owner && !publicSearch) return;
  const result = value.owner === owner && value.result && Date.parse(value.result.expiresAt) > Date.now() ? value.result : null;
  return { ...value, result, refreshOnReturn: value.refreshOnReturn || value.wasLoading || (!!value.result && !result), openDetails: result ? value.openDetails : null, comparedIds: result ? value.comparedIds : [] };
}
// Supports checkout pages opened before return-location metadata was added.
export function recallFlightBrowseBySearchId(searchId: unknown, owner: string | null, publicSearch: boolean): FlightBrowseSnapshot | undefined {
  loadSnapshots();
  if (typeof searchId !== 'string') return;
  for (const [key, snapshot] of snapshots) {
    if (snapshot.result?.searchId === searchId) return recallFlightBrowse(key, owner, publicSearch);
  }
}
/** A bare results link can recover this account's last non-trip search. */
export function recallLatestFlightBrowse(pathname: string, owner: string | null, publicSearch: boolean): FlightBrowseSnapshot | undefined {
  loadSnapshots();
  for (const [key, snapshot] of [...snapshots].reverse()) {
    if (snapshot.owner !== owner || snapshot.route?.pathname !== pathname ||
      new URLSearchParams(snapshot.route.search).has('tripId') ||
      !snapshot.form.origin || !snapshot.form.destination || !snapshot.form.departureDate) continue;
    const recalled = recallFlightBrowse(key, owner, publicSearch);
    if (recalled) return recalled;
  }
}
