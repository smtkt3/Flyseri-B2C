import type { FlightOffer, FlightPassengerPrice } from '@flyseri/types';

const cents = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
};

/** Optional fare metadata must reconcile exactly; never mix base-fare currencies. */
export function parseFlightPriceBreakdown(value: unknown, totalAmount: string, currency: string): FlightOffer['priceBreakdown'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const base = cents(row.baseFareAmount), taxes = cents(row.taxesAndFeesAmount), total = cents(totalAmount);
  if (row.currency !== currency || base === null || taxes === null || total === null || base + taxes !== total) return undefined;
  const passengers: FlightPassengerPrice[] = [];
  if (Array.isArray(row.passengerPrices) && row.passengerPrices.length >= 1 && row.passengerPrices.length <= 9) {
    for (const value of row.passengerPrices) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) break;
      const person = value as Record<string, unknown>;
      const unitBase = cents(person.baseFareAmount), unitTaxes = cents(person.taxesAndFeesAmount), unitTotal = cents(person.totalAmount);
      if (!['ADT', 'CNN', 'INF'].includes(String(person.passengerType)) || !Number.isInteger(person.count) ||
          (person.count as number) < 1 || (person.count as number) > 9 || person.currency !== currency ||
          unitBase === null || unitTaxes === null || unitTotal === null || unitBase + unitTaxes !== unitTotal) break;
      passengers.push({ passengerType: person.passengerType as FlightPassengerPrice['passengerType'], count: person.count as number,
        baseFareAmount: person.baseFareAmount as string, taxesAndFeesAmount: person.taxesAndFeesAmount as string,
        totalAmount: person.totalAmount as string, currency });
    }
  }
  const reconciledPassengers = passengers.length > 0 && passengers.length === (Array.isArray(row.passengerPrices) ? row.passengerPrices.length : 0) &&
    passengers.reduce((sum, person) => sum + person.count, 0) <= 9 &&
    passengers.reduce((sum, person) => sum + cents(person.baseFareAmount)! * person.count, 0) === base &&
    passengers.reduce((sum, person) => sum + cents(person.taxesAndFeesAmount)! * person.count, 0) === taxes;
  return { baseFareAmount: row.baseFareAmount as string, taxesAndFeesAmount: row.taxesAndFeesAmount as string, currency,
    ...(reconciledPassengers && { passengerPrices: passengers }) };
}
