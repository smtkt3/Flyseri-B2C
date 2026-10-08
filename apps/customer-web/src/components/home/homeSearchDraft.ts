import { useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

export type HomeSearchDraft = {
  origin: string; destination: string; departure: string; returnDate: string;
  mode: 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
  adults: number; children: number; infants: number; cabin: string;
  multiLegs: { origin: string; destination: string; departureDate: string }[];
};
export const emptyHomeSearch: HomeSearchDraft = { origin: 'DAC', destination: '', departure: '', returnDate: '', mode: 'ROUND_TRIP', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', multiLegs: [{ origin: 'DAC', destination: '', departureDate: '' }, { origin: '', destination: '', departureDate: '' }] };
const key = 'flyseri.home-search.v1';
const listeners = new Set<() => void>();
const airport = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : '';
export function normalizeHomeSearch(value: unknown): HomeSearchDraft {
  const input = value && typeof value === 'object' ? value as Partial<HomeSearchDraft> : {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00') >= today ? value : '';
  const number = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : min;
  const adults = number(input.adults, 1, 9), children = number(input.children, 0, 9 - adults), infants = number(input.infants, 0, Math.min(adults, 9 - adults - children));
  const departure = date(input.departure), returning = date(input.returnDate);
  return { origin: airport(input.origin) || 'DAC', destination: airport(input.destination), departure, returnDate: returning >= departure ? returning : '',
    mode: input.mode === 'ONE_WAY' || input.mode === 'MULTI_CITY' ? input.mode : 'ROUND_TRIP', adults, children, infants,
    cabin: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].includes(input.cabin ?? '') ? input.cabin! : 'ECONOMY',
    multiLegs: Array.isArray(input.multiLegs) && input.multiLegs.length >= 2 ? input.multiLegs.slice(0, 6).map(leg => ({ origin: airport(leg?.origin), destination: airport(leg?.destination), departureDate: date(leg?.departureDate) })) : emptyHomeSearch.multiLegs };
}
export function readSavedHomeSearch() { try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved && typeof saved.savedAt === 'number' && saved.savedAt <= Date.now() && Date.now() - saved.savedAt < 7 * 86400000 ? normalizeHomeSearch(saved.draft) : emptyHomeSearch; } catch { return emptyHomeSearch; } }
let draft = readSavedHomeSearch();
export function updateHomeSearch(patch: Partial<HomeSearchDraft>) {
  draft = { ...draft, ...patch };
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), draft })); } catch { /* Search still works when storage is unavailable. */ }
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useHomeSearchDraft() { return useSyncExternalStore(subscribe, () => draft, () => emptyHomeSearch); }
export function useHomeSearchField<K extends keyof HomeSearchDraft>(field: K): [HomeSearchDraft[K], Dispatch<SetStateAction<HomeSearchDraft[K]>>] {
  const current = useHomeSearchDraft();
  return [current[field], value => updateHomeSearch({ [field]: typeof value === 'function' ? (value as (previous: HomeSearchDraft[K]) => HomeSearchDraft[K])(draft[field]) : value })];
}
export function homeSearchUrl(search: HomeSearchDraft, destination = search.destination) {
  const params = new URLSearchParams({ origin: search.origin, destination, tripType: search.mode === 'MULTI_CITY' ? 'ONE_WAY' : search.mode, adults: String(search.adults), children: String(search.children), infants: String(search.infants), cabin: search.cabin });
  if (search.departure) params.set('departureDate', search.departure);
  if (search.mode === 'ROUND_TRIP' && search.returnDate) params.set('returnDate', search.returnDate);
  if (search.departure && destination && (search.mode !== 'ROUND_TRIP' || search.returnDate)) params.set('autoSearch', '1');
  return '/flights?' + params;
}
