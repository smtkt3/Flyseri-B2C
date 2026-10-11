import type { FlightOffer } from '@flyseri/types';
import { legsOf } from './flightPresentation';
const duration = (offer: FlightOffer) => legsOf(offer).reduce((sum, leg) => sum + (leg.durationMinutes ?? Infinity), 0);
export function flightRecommendations(offers: FlightOffer[]) {
  const prices = offers.filter(offer => Number.isFinite(Number(offer.totalAmount)) && Number(offer.totalAmount) > 0);
  if (!prices.length || new Set(prices.map(offer => offer.currency)).size !== 1) return { cheapest: undefined, fastest: undefined, balanced: undefined, rank: new Map<string, number>() };
  const cheapest = [...prices].sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))[0]!;
  const timed = prices.filter(offer => Number.isFinite(duration(offer)) && duration(offer) > 0);
  const fastest = [...timed].sort((a, b) => duration(a) - duration(b))[0];
  const minPrice = Number(cheapest.totalAmount);
  const minDuration = fastest ? duration(fastest) : 1;
  // Normalize price and total duration: 60% price, 30% time, 10% connection count.
  const scored = prices.map(offer => ({ offer, score: .6 * Number(offer.totalAmount) / minPrice + .3 * (Number.isFinite(duration(offer)) ? duration(offer) / minDuration : 10) + .1 * legsOf(offer).reduce((sum, leg) => sum + leg.stops, 0) })).sort((a, b) => a.score - b.score || Number(a.offer.totalAmount) - Number(b.offer.totalAmount));
  return { cheapest, fastest, balanced: scored[0]?.offer, rank: new Map(scored.map((item, index) => [item.offer.offerId, index])) };
}
