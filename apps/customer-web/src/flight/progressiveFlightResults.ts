import type { FlightSearchResponse } from '@flyseri/types';

/** Keep arrival order and refresh existing fares without duplicating flight offers. */
export function mergeProgressiveFlightResults(previous: FlightSearchResponse | null, next: FlightSearchResponse): FlightSearchResponse {
  if (!previous || previous.searchId !== next.searchId) return next;
  const active=new Set(next.offers.map(offer=>offer.offerId));
  const offers = new Map(previous.offers.filter(offer=>active.has(offer.offerId)).map(offer => [offer.offerId, offer]));
  for (const offer of next.offers) offers.set(offer.offerId, offer);
  return {...next, offers:[...offers.values()]};
}
