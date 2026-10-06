import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { auditEvents, customerTravellers, flightBookingIntents, flightBookingIntentTravellers, flightBookings, travellers, trips, tripTravellers, type DatabaseConnection } from '@flyseri/database';
import type { FlightBookingIntent, FlightOffer, FlightSearchRequest, FlightServiceRequest, FlightAncillaryRequest } from '@flyseri/types';
import { parseFlightOffers } from './flight-response.js';
import type { FlightOfferValidationOutcome } from './flight-offer-validation.service.js';
import { passengerCodeAt } from './flight-passenger-types.js';

export class BookingIntentTravellerError extends Error {}
export class BookingIntentPassengerError extends Error {}
export class BookingIntentConflictError extends Error {}
const requestKey = (requests: FlightServiceRequest[]) => JSON.stringify(requests.map(request =>
  [request.travellerId, request.meal, request.baggage, request.wheelchair, request.assistance, request.note]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
/** Legacy snapshots remain readable during the database upgrade. */
type SearchSnapshot = Omit<FlightSearchRequest, 'tripId'> & { checkoutServiceRequests?: FlightServiceRequest[]; checkoutAncillaryRequests?: FlightAncillaryRequest[]; checkoutTravellerOrder?: string[] };
const savedRequests = (row: typeof flightBookingIntents.$inferSelect): FlightServiceRequest[] => {
  const requests = row.serviceRequests as FlightServiceRequest[];
  return requests.length ? requests : (row.searchRequestSnapshot as SearchSnapshot).checkoutServiceRequests ?? [];
};
const minorUnits = (amount: string): bigint => {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2));
};
export interface BookingIntentCreate {
  customerId: string; tripId: string | null; searchId: string; offerId: string; idempotencyKey: string;
  travellerIds: string[]; offer: FlightOffer; search: Omit<FlightSearchRequest, 'tripId'>;
  serviceRequests?: FlightServiceRequest[];
  ancillaryRequests?: FlightAncillaryRequest[];
}
export interface BookingIntentStore {
  saveAncillaryRequests?(customerId: string, id: string, requests: FlightAncillaryRequest[]): Promise<FlightBookingIntent | null>;
  create(input: BookingIntentCreate): Promise<{ intent: FlightBookingIntent; created: boolean }>;
  list(customerId: string, tripId: string): Promise<FlightBookingIntent[]>;
  detail(customerId: string, id: string): Promise<FlightBookingIntent | null>;
  cancel(customerId: string, id: string): Promise<FlightBookingIntent | null>;
  saveValidation(customerId: string, id: string, outcome: FlightOfferValidationOutcome, ttlSeconds: number): Promise<FlightBookingIntent | null>;
  confirmPrice(customerId: string, id: string): Promise<FlightBookingIntent | null>;
}

type IntentRow = typeof flightBookingIntents.$inferSelect;
function present(row: IntentRow, travellerIds: string[]): FlightBookingIntent {
  const offer = parseFlightOffers([row.selectedOfferSnapshot])?.[0];
  if (!offer) throw new Error('Invalid stored flight offer');
  const { checkoutServiceRequests: _legacyRequests, checkoutAncillaryRequests = [], checkoutTravellerOrder, checkoutAncillaryPurchase: _purchase, ...searchRequest } = row.searchRequestSnapshot as SearchSnapshot & { checkoutAncillaryPurchase?: unknown };
  return {
    id: row.id, tripId: row.tripId, status: row.status as FlightBookingIntent['status'], selectedOffer: offer,
    searchRequest,
    travellerIds: checkoutTravellerOrder && checkoutTravellerOrder.length === travellerIds.length && new Set(checkoutTravellerOrder).size === travellerIds.length && checkoutTravellerOrder.every(id => travellerIds.includes(id)) ? checkoutTravellerOrder : travellerIds, serviceRequests: savedRequests(row), ancillaryRequests: checkoutAncillaryRequests, currency: row.currency, searchTotalAmount: row.searchTotalAmount,
    validatedTotalAmount: row.validatedTotalAmount, priceChanged: row.priceChanged,
    validatedAt: row.validatedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleBookingIntentStore implements BookingIntentStore {
  constructor(private readonly connection: DatabaseConnection) {}
  async saveAncillaryRequests(customerId: string, id: string, requests: FlightAncillaryRequest[]) {
    await this.connection.db.transaction(async tx => {
      const [row] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId))).for('update');
      if (!row || !['CREATED', 'VALIDATED', 'PRICE_CHANGED', 'READY_FOR_PAYMENT'].includes(row.status)) throw new BookingIntentConflictError();
      const [booking] = await tx.select({ id: flightBookings.id }).from(flightBookings).where(eq(flightBookings.bookingIntentId, id)).limit(1);
      if (booking) throw new BookingIntentConflictError();
      await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...row.searchRequestSnapshot as SearchSnapshot, checkoutAncillaryRequests: requests }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, id));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: row.tripId, event: 'flight.ancillary.requests.saved' });
    });
    return this.detail(customerId, id);
  }

  async list(customerId: string, tripId: string): Promise<FlightBookingIntent[]> {
    const rows = await this.connection.db.select().from(flightBookingIntents)
      .where(and(eq(flightBookingIntents.customerId, customerId), eq(flightBookingIntents.tripId, tripId)))
      .orderBy(desc(flightBookingIntents.createdAt)).limit(20);
    if (!rows.length) return [];
    const links = await this.connection.db.select({ intentId: flightBookingIntentTravellers.bookingIntentId, travellerId: flightBookingIntentTravellers.travellerId })
      .from(flightBookingIntentTravellers).where(inArray(flightBookingIntentTravellers.bookingIntentId, rows.map((row) => row.id)));
    const people = new Map<string, string[]>();
    for (const link of links) people.set(link.intentId, [...(people.get(link.intentId) ?? []), link.travellerId]);
    return rows.map((row) => present(row, people.get(row.id) ?? []));
  }

  async create(input: BookingIntentCreate): Promise<{ intent: FlightBookingIntent; created: boolean }> {
    if (!input.travellerIds.length || new Set(input.travellerIds).size !== input.travellerIds.length) throw new BookingIntentTravellerError();
    const saved = await this.connection.db.transaction(async (tx) => {
      if (input.tripId) {
        const [trip] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.id, input.tripId), eq(trips.customerId, input.customerId), isNull(trips.archivedAt))).limit(1);
        if (!trip) throw new BookingIntentTravellerError();
      }
      const owned = await tx.select({ id: travellers.id, dateOfBirth: travellers.dateOfBirth }).from(customerTravellers)
        .innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
        .where(and(eq(customerTravellers.customerId, input.customerId), inArray(travellers.id, input.travellerIds), isNull(travellers.archivedAt)));
      if (owned.length !== input.travellerIds.length) throw new BookingIntentTravellerError();
      const lastDate = (input.offer.multiCityLegs ?? [input.offer.outbound, ...(input.offer.inbound ? [input.offer.inbound] : [])]).flatMap(leg => leg.segments.map(segment => segment.arrivalAt.slice(0, 10))).sort().at(-1) ?? input.search.departureDate;
      const passengerTypes = input.travellerIds.map(id => {
        const birthDate = owned.find(person => person.id === id)?.dateOfBirth;
        if (!birthDate) throw new BookingIntentPassengerError();
        try { const type = passengerCodeAt(birthDate, input.search.departureDate); if (type !== passengerCodeAt(birthDate, lastDate)) throw new BookingIntentPassengerError(); return type; }
        catch { throw new BookingIntentPassengerError(); }
      });
      if (passengerTypes.filter(type => type === 'ADT').length !== input.search.adults || passengerTypes.filter(type => type === 'CNN').length !== input.search.children || passengerTypes.filter(type => type === 'INF').length !== input.search.infants) throw new BookingIntentPassengerError();
      if (input.tripId) {
        const linked = await tx.select({ id: tripTravellers.travellerId }).from(tripTravellers)
          .where(and(eq(tripTravellers.tripId, input.tripId), inArray(tripTravellers.travellerId, input.travellerIds)));
        if (linked.length !== input.travellerIds.length) throw new BookingIntentTravellerError();
      }
      const [created] = await tx.insert(flightBookingIntents).values({
        customerId: input.customerId, tripId: input.tripId, searchId: input.searchId, selectedOfferId: input.offerId,
        idempotencyKey: input.idempotencyKey, currency: input.offer.currency, searchTotalAmount: input.offer.totalAmount,
        selectedOfferSnapshot: input.offer, searchRequestSnapshot: { ...input.search, checkoutServiceRequests: input.serviceRequests ?? [], checkoutAncillaryRequests: input.ancillaryRequests ?? [], checkoutTravellerOrder: input.travellerIds },
        serviceRequests: input.serviceRequests ?? [],
      }).onConflictDoNothing({ target: [flightBookingIntents.customerId, flightBookingIntents.idempotencyKey] }).returning({ id: flightBookingIntents.id });
      if (!created) {
        const [existing] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.customerId, input.customerId), eq(flightBookingIntents.idempotencyKey, input.idempotencyKey))).limit(1);
        if (!existing || existing.searchId !== input.searchId || existing.selectedOfferId !== input.offerId || existing.tripId !== input.tripId) throw new BookingIntentConflictError();
        if (requestKey(savedRequests(existing)) !== requestKey(input.serviceRequests ?? [])) throw new BookingIntentConflictError();
        const extrasKey = (extras: FlightAncillaryRequest[]) => JSON.stringify(extras.map(({ id: _id, ...extra }) => extra));
        if (extrasKey((existing.searchRequestSnapshot as SearchSnapshot).checkoutAncillaryRequests ?? []) !== extrasKey(input.ancillaryRequests ?? [])) throw new BookingIntentConflictError();
        const links = await tx.select({ id: flightBookingIntentTravellers.travellerId }).from(flightBookingIntentTravellers).where(eq(flightBookingIntentTravellers.bookingIntentId, existing.id));
        const savedOrder = (existing.searchRequestSnapshot as SearchSnapshot).checkoutTravellerOrder;
        if (savedOrder && JSON.stringify(savedOrder) !== JSON.stringify(input.travellerIds)) throw new BookingIntentConflictError();
        if (links.length !== input.travellerIds.length || links.some((link) => !input.travellerIds.includes(link.id))) throw new BookingIntentConflictError();
        return { id: existing.id, created: false };
      }
      await tx.insert(flightBookingIntentTravellers).values(input.travellerIds.map((travellerId, index) => ({ bookingIntentId: created.id, travellerId, passengerType: passengerTypes[index] === 'CNN' ? 'CHD' : passengerTypes[index]! })));
      await tx.insert(auditEvents).values({ actorCustomerId: input.customerId, tripId: input.tripId, event: 'flight.booking_intent.created' });
      return { id: created.id, created: true };
    });
    const result = await this.detail(input.customerId, saved.id);
    if (!result) throw new Error('Created booking intent missing');
    return { intent: result, created: saved.created };
  }

  async detail(customerId: string, id: string): Promise<FlightBookingIntent | null> {
    const [row] = await this.connection.db.select().from(flightBookingIntents)
      .where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId))).limit(1);
    if (!row) return null;
    const links = await this.connection.db.select({ id: flightBookingIntentTravellers.travellerId }).from(flightBookingIntentTravellers)
      .where(eq(flightBookingIntentTravellers.bookingIntentId, id));
    return present(row, links.map((link) => link.id));
  }

  async cancel(customerId: string, id: string): Promise<FlightBookingIntent | null> {
    const exists = await this.connection.db.transaction(async (tx) => {
      const [row] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId))).limit(1).for('update');
      if (!row) return false;
      const [booking] = await tx.select({ id: flightBookings.id }).from(flightBookings).where(eq(flightBookings.bookingIntentId, id)).limit(1);
      if (booking) throw new BookingIntentConflictError();
      if (row.status === 'CANCELLED') return true;
      await tx.update(flightBookingIntents).set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId)));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: row.tripId, event: 'flight.booking_intent.cancelled' });
      return true;
    });
    return exists ? this.detail(customerId, id) : null;
  }

  async saveValidation(customerId: string, id: string, outcome: FlightOfferValidationOutcome, ttlSeconds: number): Promise<FlightBookingIntent | null> {
    const changed = await this.connection.db.transaction(async (tx) => {
      const [row] = await tx.select().from(flightBookingIntents)
        .where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId))).limit(1).for('update');
      if (!row || row.status === 'CANCELLED') return false;
      const [booking] = await tx.select({ id: flightBookings.id }).from(flightBookings).where(eq(flightBookings.bookingIntentId, id)).limit(1);
      if (booking) throw new BookingIntentConflictError();
      const validatedAt = new Date(outcome.validatedAt);
      if (!Number.isFinite(validatedAt.getTime())) throw new Error('Invalid validation timestamp');
      const available = outcome.result === 'AVAILABLE';
      if (available && (!/^[A-Z]{3}$/.test(outcome.currency) || !/^\d+(\.\d{1,2})?$/.test(outcome.currentTotalAmount))) throw new Error('Invalid validation amount');
      const originalOffer = parseFlightOffers([row.selectedOfferSnapshot])?.[0];
      if (!originalOffer) throw new Error('Invalid original fare');
      const priceChanged = available && (outcome.currency !== originalOffer.currency || minorUnits(outcome.currentTotalAmount) !== minorUnits(row.searchTotalAmount));
      let expiry = new Date(validatedAt.getTime() + ttlSeconds * 1000);
      if (available && outcome.expiresAt) {
        const supplierExpiry = new Date(outcome.expiresAt);
        if (!Number.isFinite(supplierExpiry.getTime()) || supplierExpiry <= validatedAt) throw new Error('Invalid supplier fare expiry');
        if (supplierExpiry < expiry) expiry = supplierExpiry;
      }
      await tx.update(flightBookingIntents).set({
        status: available ? priceChanged ? 'PRICE_CHANGED' : 'READY_FOR_PAYMENT' : 'FAILED',
        validatedTotalAmount: available ? outcome.currentTotalAmount : null,
        ...(available ? { currency: outcome.currency } : {}),
        ...(available && outcome.ndcContext ? { selectedOfferSnapshot: { ...originalOffer, ndcContext: outcome.ndcContext } } : {}),
        priceChanged, validatedAt, expiresAt: available ? expiry : null,
        updatedAt: new Date(),
      }).where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId)));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: row.tripId,
        event: available ? priceChanged ? 'flight.booking_intent.price_changed' : 'flight.booking_intent.validated' : 'flight.booking_intent.validation_failed' });
      return true;
    });
    return changed ? this.detail(customerId, id) : null;
  }

  async confirmPrice(customerId: string, id: string): Promise<FlightBookingIntent | null> {
    const changed = await this.connection.db.transaction(async (tx) => {
      const [row] = await tx.select().from(flightBookingIntents)
        .where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId))).limit(1).for('update');
      if (!row) return false;
      const [booking] = await tx.select({ id: flightBookings.id }).from(flightBookings).where(eq(flightBookings.bookingIntentId, id)).limit(1);
      if (booking) throw new BookingIntentConflictError();
      if (row.status !== 'PRICE_CHANGED' || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) throw new BookingIntentConflictError();
      await tx.update(flightBookingIntents).set({ status: 'READY_FOR_PAYMENT', updatedAt: new Date() })
        .where(and(eq(flightBookingIntents.id, id), eq(flightBookingIntents.customerId, customerId)));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: row.tripId, event: 'flight.booking_intent.price_accepted' });
      return true;
    });
    return changed ? this.detail(customerId, id) : null;
  }
}
