import type { FlightAncillaryPurchase, FlightAncillaryRequest } from '@flyseri/types';

export interface AtpcoPurchaseOption {
  commercialName: string;
  subcode: string;
  airlineCode: string;
  groupCode: string;
  reasonForIssuanceName: string;
  electronicMiscellaneousDocumentType: string;
  basePrice: string;
  currencyCode: string;
  totals: { subtotal: string; taxes: string; total: string; currencyCode: string };
  segmentIndexes: number[];
}
export interface AncillaryPurchasePlan {
  requestId: string;
  passengerIndex: number;
  segmentIndexes: number[];
  atpco?: AtpcoPurchaseOption;
  ndcOfferItemId?: string;
}
export interface StoredAncillaryPurchase extends FlightAncillaryPurchase {
  plans: AncillaryPurchasePlan[];
  bookingId: string;
  requestKey: string;
}
export interface AncillarySnapshot {
  checkoutAncillaryRequests?: FlightAncillaryRequest[];
  checkoutAncillaryPurchase?: StoredAncillaryPurchase;
  checkoutTravellerOrder?: string[];
  [key: string]: unknown;
}
export const requestKey = (requests: FlightAncillaryRequest[]) => JSON.stringify(requests.map(({ id: _id, ...request }) => request));
export function publicAncillaryPurchase(purchase?: StoredAncillaryPurchase): FlightAncillaryPurchase | undefined {
  if (!purchase) return undefined;
  const { plans: _plans, bookingId: _bookingId, requestKey: _requestKey, ...publicValue } = purchase;
  return publicValue;
}
export function cents(amount: string): bigint {
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amount)) throw new Error('Invalid airline amount');
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const fromCents = (amount: bigint) => `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
export const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();

/** Fields used by the supplied 2026.08 agency GetBooking/ModifyBooking examples. */
export interface PurchaseBooking {
  bookingId: string;
  bookingSignature: string;
  flights: Record<string, unknown>[];
  travelers: Record<string, unknown>[];
}
export function readPurchaseBooking(value: unknown): PurchaseBooking {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid booking');
  const data = value as Record<string, unknown>;
  if (data.errors !== undefined && (!Array.isArray(data.errors) || data.errors.length)) throw new Error('Booking lookup failed');
  const records = (input: unknown, limit: number): Record<string, unknown>[] => {
    if (!Array.isArray(input) || input.length > limit || input.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Incomplete booking associations');
    return input as Record<string, unknown>[];
  };
  if (typeof data.bookingId !== 'string' || !data.bookingId || typeof data.bookingSignature !== 'string' || !data.bookingSignature || data.bookingSignature.length > 20000) throw new Error('Current booking signature missing');
  return { bookingId: data.bookingId, bookingSignature: data.bookingSignature, flights: records(data.flights, 60), travelers: records(data.travelers, 9) };
}
export function buildAncillaryModification(pnr: string, booking: PurchaseBooking, plans: AncillaryPurchasePlan[]) {
  if (!plans.length || plans.length > 40 || !/^[A-Z0-9]{5,16}$/.test(pnr)) throw new Error('Invalid ancillary change');
  if (plans.some(plan => !Number.isInteger(plan.passengerIndex) || plan.passengerIndex < 0 || plan.passengerIndex >= booking.travelers.length || !plan.segmentIndexes.length || new Set(plan.segmentIndexes).size !== plan.segmentIndexes.length || plan.segmentIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= booking.flights.length))) throw new Error('Invalid ancillary association');
  const before = booking.travelers.map(person => {
    if (typeof person.givenName !== 'string' || typeof person.surname !== 'string' || typeof person.passengerCode !== 'string') throw new Error('Passenger identity unavailable');
    if (person.ancillaries !== undefined && (!Array.isArray(person.ancillaries) || person.ancillaries.length)) throw new Error('Existing airline extras need reconciliation before additions');
    return { givenName: person.givenName, surname: person.surname, passengerCode: person.passengerCode,
      ...(typeof person.nameAssociationId === 'string' ? { nameAssociationId: person.nameAssociationId } : {}),
      ...(typeof person.type === 'string' ? { type: person.type } : {}) };
  });
  const after = before.map((person, passengerIndex) => ({ ...person, ancillaries: plans.filter(plan => plan.passengerIndex === passengerIndex).map(plan => {
    if (plan.ndcOfferItemId) return { offerId: plan.ndcOfferItemId };
    if (!plan.atpco || !person.nameAssociationId) throw new Error('ATPCO passenger association unavailable');
    const { segmentIndexes: _indexes, ...option } = plan.atpco;
    return { ...option, flights: plan.segmentIndexes.map(index => {
      const itemId = booking.flights[index]?.itemId;
      if (typeof itemId !== 'string' && typeof itemId !== 'number') throw new Error('Airline flight item missing');
      return { itemId };
    }) };
  }) }));
  return { confirmationId: pnr, bookingSignature: booking.bookingSignature, before: { travelers: before }, after: { travelers: after }, retrieveBooking: true, receivedFrom: 'Flyseri CERT ancillary selection' };
}

/** Confirmation is based on current reservation items, not HTTP success alone. */
export function confirmedAncillaryItems(booking: PurchaseBooking, plans: AncillaryPurchasePlan[], requests: FlightAncillaryRequest[]) {
  const used = new Set<string>();
  return plans.map(plan => {
    const request = requests.find(request => request.id === plan.requestId);
    const entries = booking.travelers[plan.passengerIndex]?.ancillaries;
    if (!request || !Array.isArray(entries)) throw new Error('Airline ancillary evidence missing');
    const expectedFlights = plan.segmentIndexes.map(index => String(booking.flights[index]?.itemId));
    const matching = entries.filter((entry): entry is Record<string, unknown> => {
      if (!entry || typeof entry !== 'object') return false;
      const flights = (entry as Record<string, unknown>).flights;
      return (entry as Record<string, unknown>).commercialName === request.name && (entry as Record<string, unknown>).statusName === 'Confirmed' && Array.isArray(flights) && flights.length === expectedFlights.length && new Set(flights.map(flight => flight && typeof flight === 'object' ? String(flight.itemId) : '')).size === expectedFlights.length && flights.every(flight => flight && typeof flight === 'object' && expectedFlights.includes(String(flight.itemId)));
    });
    if (matching.length !== 1) throw new Error('One confirmed ancillary per selection is required');
    const ancillary = matching[0]!, itemId = String(ancillary.itemId ?? '');
    const totals = ancillary.totals as { total?: unknown; currencyCode?: unknown } | undefined;
    if (!itemId || used.has(itemId) || typeof totals?.total !== 'string' || typeof totals.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(totals.currencyCode)) throw new Error('Ancillary identity or price missing');
    cents(totals.total); used.add(itemId);
    return { requestId: request.id, itemId, amount: totals.total, currency: totals.currencyCode };
  });
}
