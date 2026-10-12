import type { FlightOffer } from '@flyseri/types';
export { FLYSERI_POINTS_RULES as POINTS_RULES } from '@flyseri/types';
export function minor(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
export const earnedPoints = (value: bigint) => Number(value / 100_000n);
/** Fail closed if a refreshed total no longer reconciles with the saved fare breakdown. */
export function eligibleFare(offer: FlightOffer, validated: string | null, currency: string, discount: string): bigint {
  const base = minor(offer.priceBreakdown?.baseFareAmount), tax = minor(offer.priceBreakdown?.taxesAndFeesAmount);
  const total = minor(validated), off = minor(discount);
  if (currency !== 'BDT' || offer.currency !== currency || offer.priceBreakdown?.currency !== currency ||
    base === null || tax === null || total === null || off === null || base + tax !== total) return 0n;
  return base > off ? base - off : 0n;
}
export function lastArrival(offer: FlightOffer): number | null {
  const segments = [offer.outbound, ...(offer.inbound ? [offer.inbound] : []), ...(offer.multiCityLegs ?? [])].flatMap(leg => leg?.segments ?? []);
  const times = segments.map(segment => Date.parse(segment.arrivalAt));
  return times.length && times.every(Number.isFinite) ? Math.max(...times) : null;
}
