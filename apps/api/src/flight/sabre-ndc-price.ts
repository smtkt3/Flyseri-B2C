import type { FlightOffer } from '@flyseri/types';

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/\s/.test(value);
const dated = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

/** Offer Price NDC v1.5 schema. An ambiguous, expired, changed or incomplete
 * response must never become an accepted fare. Pricing is not order creation.
 */
export function readPricedNdcOffer(value: unknown, selected: FlightOffer, now = Date.now()) {
  const context = selected.ndcContext;
  if (!context?.offerItemIds?.length) throw new Error('NDC shopping item references are unavailable');
  const root = object(value);
  const offers = list(object(root?.response)?.offers);
  if (offers.length !== 1) throw new Error('Expected one priced NDC offer');
  const offer = object(offers[0]);
  if (!offer || offer.source !== 'NDC' || !identifier(offer.id) || !dated(offer.offerExpirationDateTime) ||
      !Number.isInteger(offer.ttl) || (offer.ttl as number) <= 0) throw new Error('NDC pricing context is incomplete');
  const expires = Math.min(Date.parse(offer.offerExpirationDateTime), now + (offer.ttl as number) * 1000);
  if (!Number.isFinite(expires) || expires <= now) throw new Error('NDC fare expired');
  const total = object(object(offer.totalPrice)?.totalAmount);
  if (!total || typeof total.amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(total.amount) || typeof total.curCode !== 'string' || !/^[A-Z]{3}$/.test(total.curCode)) throw new Error('NDC fare amount is unsupported');
  const selectedSegments = (selected.multiCityLegs ?? [selected.outbound, ...(selected.inbound ? [selected.inbound] : [])]).flatMap(leg => leg.segments);
  const people = new Map<string, string>();
  const itemIds: string[] = [];
  const items = list(offer.offerItems);
  if (!items.length || items.length > 60) throw new Error('NDC offer items are unavailable');
  for (const itemValue of items) {
    const item = object(itemValue);
    // Service offer items need a separate selection/fulfillment contract.
    if (!item || item.type !== 'Air' || !identifier(item.id)) throw new Error('NDC air-only pricing is required');
    itemIds.push(item.id);
    const passengers = list(item.passengers);
    if (!passengers.length || passengers.length > 9) throw new Error('NDC passenger associations are unavailable');
    for (const personValue of passengers) {
      const person = object(personValue);
      if (!person || !identifier(person.id) || typeof person.requestedPtc !== 'string' || !['ADT','CNN','INF'].includes(person.requestedPtc)) throw new Error('NDC passenger type is unavailable');
      const original = context.passengers.find(entry => entry.passengerId === person.id);
      if (!original || original.passengerTypeCode !== person.requestedPtc || people.has(person.id) && people.get(person.id) !== person.requestedPtc) throw new Error('NDC passengers changed during pricing');
      people.set(person.id, person.requestedPtc);
      const segments = list(person.fareComponents).flatMap(component => list(object(component)?.segments));
      if (segments.length !== selectedSegments.length) throw new Error('NDC priced itinerary is incomplete');
      segments.forEach((segmentValue, index) => {
        const segment = object(segmentValue), originalSegment = selectedSegments[index]!;
        const departure = object(segment?.departure), arrival = object(segment?.arrival);
        if (!segment || departure?.airport !== originalSegment.origin || arrival?.airport !== originalSegment.destination ||
            segment.marketingCarrier !== originalSegment.marketingCarrier || typeof segment.flightNumber !== 'string' || !/^\d+$/.test(segment.flightNumber) || Number(segment.flightNumber) !== Number(originalSegment.flightNumber) ||
            !dated(departure?.date) || !dated(arrival?.date) || Date.parse(departure.date) !== Date.parse(originalSegment.departureAt) || Date.parse(arrival.date) !== Date.parse(originalSegment.arrivalAt) ||
            originalSegment.bookingClass && segment.rbd !== originalSegment.bookingClass) throw new Error('NDC itinerary changed during pricing');
      });
    }
  }
  if (people.size !== context.passengers.length || new Set(itemIds).size !== itemIds.length) throw new Error('NDC passenger or item references are ambiguous');
  return { currentTotalAmount: total.amount, currency: total.curCode, expiresAt: new Date(expires).toISOString(),
    ndcContext: { offerId: offer.id, offerItemIds: itemIds, expiresAt: new Date(expires).toISOString(), passengers: context.passengers.map(person => ({ ...person })) } };
}
