import { demoSpecialFlightOffers } from '../../data/demo/specialFlightOffers';
export const GROUP_FARE_CURRENCY = 'BDT';
export type GroupFare = {
  amountPerPerson: number;
  demo?: boolean;
  availableSeats?: number;
  currency?: string;
  tripType?: 'ONE_WAY' | 'RETURN';
  travelDates?: string[];
  minimumTravellers?: number;
  baggage?: string;
  taxesIncluded?: boolean;
  validUntil?: string;
};
// Add only approved airline group quotes. Empty routes remain quote requests.
export const approvedGroupFares: Partial<Record<string, GroupFare>> = {};
export function activeGroupFare(code: string): GroupFare | undefined {
  const fare = approvedGroupFares[code] ?? demoSpecialFlightOffers[code];
  return fare && Number.isFinite(fare.amountPerPerson) && fare.amountPerPerson > 0 && (!fare.validUntil || Date.parse(fare.validUntil) > Date.now()) ? fare : undefined;
}
export function groupFareMoney(fare: GroupFare) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: fare.currency ?? GROUP_FARE_CURRENCY, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(fare.amountPerPerson);
}
