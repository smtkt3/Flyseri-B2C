import type { FlightCabin } from '@flyseri/types';
export type FlightSearchPreferences = { adults: number; children: number; infants: number; cabin: FlightCabin };
export const defaultFlightPreferences: FlightSearchPreferences = { adults:1, children:0, infants:0, cabin:'ECONOMY' };
const key='flyseri.flight-preferences.v1';
export const flightPreferencesEvent='flyseri:flight-preferences';
export function normalizeFlightPreferences(value: unknown): FlightSearchPreferences {
  const input=value&&typeof value==='object'?value as Partial<FlightSearchPreferences>:{};
  const count=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isInteger(value)?Math.max(min,Math.min(max,value)):min;
  const adults=count(input.adults,1,9), children=count(input.children,0,9-adults), infants=count(input.infants,0,Math.min(adults,9-adults-children));
  const cabin=['ECONOMY','PREMIUM_ECONOMY','BUSINESS','FIRST'].includes(input.cabin??'')?input.cabin!:'ECONOMY';
  return {adults,children,infants,cabin};
}
export function readFlightPreferences(): FlightSearchPreferences | null {
  try { const value=localStorage.getItem(key);return value?normalizeFlightPreferences(JSON.parse(value)):null; } catch { return null; }
}
export function saveFlightPreferences(value: FlightSearchPreferences) {
  const preferences=normalizeFlightPreferences(value);
  try { localStorage.setItem(key,JSON.stringify(preferences)); } catch { /* Preferences are optional. */ }
  window.dispatchEvent(new CustomEvent(flightPreferencesEvent,{detail:preferences}));
}
export function clearFlightPreferences() {
  try { localStorage.removeItem(key); } catch { /* Current form still resets. */ }
  window.dispatchEvent(new CustomEvent(flightPreferencesEvent,{detail:defaultFlightPreferences}));
}
