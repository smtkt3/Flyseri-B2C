import type { FlightOffer, FlightSearchRequest, FlightPassengerPrice } from '@flyseri/types';

/** Purchase records, not ancillary shopping quotes or customer service requests. */
export interface PurchasedFlightExtra {
  id: string;
  category: 'BAGGAGE' | 'MEAL' | 'OTHER';
  description: string;
  passengerIndexes: number[];
  quantity: number;
  unitAmount: string;
  currency: string;
  status: 'PURCHASED';
}
export const flightAmountCents = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};
export const flightMoney = (value: string, currency: string) => new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(Number(value));

export function flightPriceSummary(offer: FlightOffer, search: FlightSearchRequest, purchasedExtras: PurchasedFlightExtra[] = []) {
  const total = flightAmountCents(offer.totalAmount);
  const breakdown = offer.priceBreakdown;
  const base = breakdown ? flightAmountCents(breakdown.baseFareAmount) : null;
  const taxes = breakdown ? flightAmountCents(breakdown.taxesAndFeesAmount) : null;
  const validBreakdown = breakdown?.currency === offer.currency && base !== null && taxes !== null && total !== null && base + taxes === total;
  const expected = { ADT: search.adults, CNN: search.children, INF: search.infants };
  const passengerCount = search.adults + search.children + search.infants;
  let passengerPrices: FlightPassengerPrice[] = [];
  const reported = validBreakdown ? breakdown?.passengerPrices ?? [] : [];
  if (reported.length && (Object.keys(expected) as (keyof typeof expected)[]).every(type => reported.filter(person => person.passengerType === type).reduce((sum, person) => sum + person.count, 0) === expected[type]) &&
    reported.every(person => ['ADT', 'CNN', 'INF'].includes(person.passengerType) && person.currency === offer.currency && Number.isInteger(person.count) && person.count > 0 &&
      flightAmountCents(person.baseFareAmount) !== null && flightAmountCents(person.taxesAndFeesAmount) !== null && flightAmountCents(person.totalAmount) !== null &&
      flightAmountCents(person.baseFareAmount)! + flightAmountCents(person.taxesAndFeesAmount)! === flightAmountCents(person.totalAmount)) &&
    reported.reduce((sum, person) => sum + flightAmountCents(person.totalAmount)! * person.count, 0) === total &&
    reported.reduce((sum, person) => sum + flightAmountCents(person.baseFareAmount)! * person.count, 0) === base) passengerPrices = reported;
  else if (validBreakdown && breakdown && passengerCount === 1) passengerPrices = [{ passengerType: search.adults ? 'ADT' : search.children ? 'CNN' : 'INF', count: 1,
    baseFareAmount: breakdown.baseFareAmount, taxesAndFeesAmount: breakdown.taxesAndFeesAmount, totalAmount: offer.totalAmount, currency: offer.currency }];

  const extras: (PurchasedFlightExtra & { totalAmount: string })[] = [];
  const seen = new Set<string>();
  let extraCents = 0;
  let invalidExtras = false;
  for (const extra of purchasedExtras) {
    if (extra.status !== 'PURCHASED') continue;
    if (seen.has(extra.id)) { invalidExtras = true; continue; }
    seen.add(extra.id);
    const unit = flightAmountCents(extra.unitAmount);
    if (typeof extra.id !== 'string' || !extra.id || typeof extra.description !== 'string' || !extra.description.trim() || extra.currency !== offer.currency || unit === null || !Number.isInteger(extra.quantity) || extra.quantity < 1 || extra.quantity > 99 ||
      !['BAGGAGE', 'MEAL', 'OTHER'].includes(extra.category) || !Array.isArray(extra.passengerIndexes) || extra.passengerIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= passengerCount)) { invalidExtras = true; continue; }
    const amount = unit * extra.quantity;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(extraCents + amount)) { invalidExtras = true; continue; }
    extraCents += amount;
    extras.push({ ...extra, totalAmount: (amount / 100).toFixed(2) });
  }
  return { validBreakdown, passengerPrices, extras, invalidExtras,
    totalAmount: !invalidExtras && total !== null && Number.isSafeInteger(total + extraCents) ? ((total + extraCents) / 100).toFixed(2) : null };
}
