import type { FlightServicePreferences } from '@flyseri/types';

export interface BookingSpecialService { code: string; flightIndices: number[] }

/** Standard SSR requests. No baggage purchase or arbitrary free-text SSR is inferred. */
export function bookingSpecialServices(request: FlightServicePreferences | undefined, flightCount: number): BookingSpecialService[] {
  if (!request) return [];
  if (!Number.isInteger(flightCount) || flightCount < 1 || flightCount > 60) throw new Error('Invalid SSR flight associations');
  const meals = { NONE: null, VEGETARIAN: 'VLML', VEGAN: 'VGML', HALAL: 'MOML', GLUTEN_FREE: 'GFML' } as const;
  const wheelchair = { NONE: null, AIRPORT: 'WCHR', STAIRS: 'WCHS', TO_SEAT: 'WCHC' } as const;
  const assistance = { NONE: null, HEARING: 'DEAF', VISION: 'BLND' } as const;
  const codes = [meals[request.meal], wheelchair[request.wheelchair], assistance[request.assistance]].filter((code): code is NonNullable<typeof code> => !!code);
  return codes.map(code => ({ code, flightIndices: Array.from({ length: flightCount }, (_, index) => index + 1) }));
}
