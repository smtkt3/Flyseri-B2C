import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '@flyseri/config';
import { auditEvents, flightBookings, flightBookingIntents, orders, type DatabaseConnection } from '@flyseri/database';
import type { FlightAncillaryRequest, FlightAncillaryResponse, FlightOffer } from '@flyseri/types';
import { APP_CONFIG, DATABASE_CONNECTION, SABRE_BOOKING_CLIENT } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import { SabreBookingManagementClient } from './sabre-booking-management.client.js';
import { SabreAtpcoAncillariesClient } from './sabre-atpco-ancillaries.client.js';
import { FlightTicketingService } from './flight-ticketing.service.js';
import { readSabreAncillaries } from './flight-ancillaries.service.js';
import { buildAncillaryModification, cents, confirmedAncillaryItems, fromCents, normalizeName, publicAncillaryPurchase, requestKey,
  type AncillarySnapshot, type PurchaseBooking, type StoredAncillaryPurchase, type AncillaryPurchasePlan } from './ancillary-purchase.contract.js';

const conflict = (message: string) => new ApiException('CONFLICT', message, 409);
const segments = (offer: FlightOffer) => (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap(leg => leg.segments);
const key = (service: Pick<FlightAncillaryRequest, 'name' | 'serviceCode' | 'segmentLabels' | 'passengerIndexes'>) => JSON.stringify([service.name, service.serviceCode, service.segmentLabels, service.passengerIndexes]);

@Injectable()
export class FlightAncillaryPurchaseService {
  private readonly preparing = new Map<string, Promise<ReturnType<typeof publicAncillaryPurchase>>>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre: SabreBookingManagementClient | undefined,
    @Inject(SabreAtpcoAncillariesClient) private readonly atpco: SabreAtpcoAncillariesClient | undefined,
    @Inject(FlightTicketingService) private readonly ticketing: FlightTicketingService) {}
  private get db() { if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Booking extras are temporarily unavailable.', 503); return this.connection.db; }
  private async owned(customerId: string, bookingId: string) {
    const [row] = await this.db.select({ booking: flightBookings, intent: flightBookingIntents }).from(flightBookings)
      .innerJoin(flightBookingIntents, and(eq(flightBookingIntents.id, flightBookings.bookingIntentId), eq(flightBookingIntents.customerId, customerId)))
      .where(and(eq(flightBookings.id, bookingId), eq(flightBookings.customerId, customerId))).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Booking not found.', 404);
    return row;
  }
  /** Only administrator-approved checkout rates can become a customer charge. */
  private checkoutAmount(amount: string, from: string, currency: string): string {
    if (from === currency || cents(amount) === 0n) return fromCents(cents(amount));
    let entry: { numerator?: string; denominator?: string; validUntil?: string } | undefined;
    try { entry = JSON.parse(this.config.FLIGHT_EXTRA_CHECKOUT_FX_RATES ?? '{}')[`${from}:${currency}`]; } catch { /* Invalid configuration is unavailable. */ }
    if (!entry || !/^\d{1,12}$/.test(entry.numerator ?? '') || !/^\d{1,12}$/.test(entry.denominator ?? '') ||
      BigInt(entry.numerator!) <= 0n || BigInt(entry.denominator!) <= 0n || !entry.validUntil || Date.parse(entry.validUntil) <= Date.now() || !Number.isFinite(Date.parse(entry.validUntil))) throw conflict('A confirmed checkout exchange rate is unavailable for these extras. Choose ticket only or contact Flyseri.');
    const numerator = cents(amount) * BigInt(entry.numerator!), denominator = BigInt(entry.denominator!);
    const decimals = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    if (decimals !== 0 && decimals !== 2) throw conflict('This checkout currency requires separate pricing support. Contact Flyseri.');
    const divisor = decimals === 0 ? denominator * 100n : denominator;
    return fromCents(((numerator + divisor / 2n) / divisor) * (decimals === 0 ? 100n : 1n));
  }
  private verifyBooking(current: PurchaseBooking, storedBookingId: string | null, offer: FlightOffer, names: string[]) {
    const itinerary = segments(offer);
    if (current.bookingId !== storedBookingId || !names.length || current.travelers.length !== names.length || current.flights.length !== itinerary.length ||
      current.travelers.some((person, index) => normalizeName(`${person.givenName} ${person.surname}`) !== normalizeName(names[index]!)) ||
      current.flights.some((flight, index) => {
        const segment = itinerary[index]!;
        return flight.fromAirportCode !== segment.origin || flight.toAirportCode !== segment.destination || flight.airlineCode !== segment.marketingCarrier ||
          Number(flight.flightNumber) !== Number(segment.flightNumber) || flight.departureDate !== segment.departureAt.slice(0, 10) || flight.flightStatusName !== 'Confirmed';
      })) throw conflict('The airline itinerary or passengers need review before adding extras.');
  }
  private async bookedNames(bookingId: string): Promise<string[]> {
    const result = await this.connection!.pool.query('SELECT to_jsonb(b)->\'booked_passenger_names\' AS names FROM flight_bookings b WHERE id = $1', [bookingId]);
    const names = result.rows[0]?.names;
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw conflict('This reservation needs passenger verification before adding extras.');
    return names;
  }
  private async quote(offer: FlightOffer, current: PurchaseBooking, requests: FlightAncillaryRequest[], checkoutCurrency: string) {
    const plans: AncillaryPurchasePlan[] = [];
    let quote: FlightAncillaryResponse;
    if (offer.ndcContext) {
      const raw = await this.sabre!.getAncillaryOffers({ requestType: 'orderId', request: { orderId: current.bookingId } });
      const passengers = (raw as { ancillaries?: { passengers?: { passengerId: string; givenName: string; surname: string }[] } }).ancillaries?.passengers;
      if (!Array.isArray(passengers)) throw conflict('Airline passenger references are unavailable for these extras.');
      const passengerIds = current.travelers.map(person => {
        const matches = passengers.filter(passenger => normalizeName(`${passenger.givenName} ${passenger.surname}`) === normalizeName(`${person.givenName} ${person.surname}`));
        if (matches.length !== 1) throw conflict('Airline passenger references could not be matched uniquely.');
        return matches[0]!.passengerId;
      });
      quote = readSabreAncillaries(raw, passengerIds, 'NDC_ORDER');
      for (const request of requests) {
        const matches = quote.services.filter(service => key(service) === key(request));
        if (matches.length !== 1 || !matches[0]!.offerItemId || matches[0]!.sellable !== true || matches[0]!.passengerIndexes.length !== 1) throw conflict('The airline has not supplied a bookable item for a selected extra.');
        plans.push({ requestId: request.id, passengerIndex: request.passengerIndexes[0]!, ndcOfferItemId: matches[0]!.offerItemId!, segmentIndexes: this.segmentIndexes(request, offer) });
      }
    } else {
      if (!this.atpco || current.travelers.some(person => person.passengerCode !== 'ADT')) throw conflict('These airline extras need assistance for this passenger type.');
      const detailed = await this.atpco.lookupForPurchase(offer, current.travelers.length);
      quote = detailed.quote;
      for (const request of requests) {
        const matches = quote.services.map((service, index) => ({ service, option: detailed.options[index] })).filter(({ service }) => key(service) === key(request));
        if (matches.length !== 1 || !matches[0]!.option) throw conflict('A selected extra has no complete purchase price or requires airline assistance.');
        plans.push({ requestId: request.id, passengerIndex: request.passengerIndexes[0]!, segmentIndexes: matches[0]!.option!.segmentIndexes, atpco: matches[0]!.option! });
      }
    }
    const items = requests.map(request => {
      const service = quote.services.find(service => key(service) === key(request));
      if (!service?.currency || service.amount === null) throw conflict('A selected extra has no confirmed price.');
      return { requestId: request.id, name: request.name, segmentLabels: request.segmentLabels, passengerIndexes: request.passengerIndexes,
        airlineAmount: fromCents(cents(service.amount)), airlineCurrency: service.currency, checkoutAmount: this.checkoutAmount(service.amount, service.currency, checkoutCurrency), providerAncillaryIds: [] as string[] };
    });
    return { plans, items };
  }
  private segmentIndexes(request: FlightAncillaryRequest, offer: FlightOffer) {
    return request.segmentLabels.map(label => {
      const matches = segments(offer).flatMap((segment, index) => label === `${segment.origin} → ${segment.destination} · ${segment.marketingCarrier} ${segment.flightNumber} · ${segment.departureAt.slice(0, 10)}` ? [index] : []);
      if (matches.length !== 1) throw conflict('The extra could not be assigned to one airline flight.');
      return matches[0]!;
    });
  }
  prepare(customerId: string, bookingId: string, refresh = false) {
    const id = `${customerId}:${bookingId}`, running = this.preparing.get(id);
    if (running) return running;
    if (this.preparing.size >= 100) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Extra prices are busy. Please try again shortly.', 503);
    const promise = this.prepareOwned(customerId, bookingId, refresh); this.preparing.set(id, promise);
    void promise.finally(() => this.preparing.delete(id)).catch(() => undefined);
    return promise;
  }
  private async prepareOwned(customerId: string, bookingId: string, refresh: boolean) {
    const row = await this.owned(customerId, bookingId), snapshot = row.intent.searchRequestSnapshot as AncillarySnapshot;
    const requests = snapshot.checkoutAncillaryRequests ?? [], previous = snapshot.checkoutAncillaryPurchase;
    if (!requests.length) return undefined;
    if (previous && ['PRICE_CHANGED', 'CONFIRMED'].includes(previous.status) && (refresh || Date.parse(previous.expiresAt) <= Date.now())) return this.reconcile(customerId, bookingId);
    if (previous && !['PREPARED', 'UNAVAILABLE'].includes(previous.status)) return publicAncillaryPurchase(previous);
    if (!refresh && previous?.status === 'PREPARED' && Date.parse(previous.expiresAt) > Date.now()) return publicAncillaryPurchase(previous);
    if (!row.booking.pnrLocator || !['PNR_CREATED', 'AWAITING_PAYMENT'].includes(row.booking.status) || !row.intent.validatedTotalAmount || !row.intent.expiresAt || row.intent.expiresAt <= new Date()) throw conflict('Refresh the reservation fare before reviewing extras.');
    let purchase: StoredAncillaryPurchase = { id: randomUUID(), status: 'UNAVAILABLE', currency: row.intent.currency, airfareAmount: row.intent.validatedTotalAmount,
      extrasAmount: '0.00', totalAmount: row.intent.validatedTotalAmount, expiresAt: new Date(Math.min(Date.now() + 120000, row.intent.expiresAt.getTime())).toISOString(), items: [], plans: [], bookingId: row.booking.sabreBookingId ?? '', requestKey: requestKey(requests) };
    try {
      if (this.config.FLIGHT_ANCILLARY_EXECUTION_ENABLED !== 'true' || !this.sabre) throw conflict('Online purchase of airline extras is awaiting activation. Your selected requests are kept; you can continue with ticket only.');
      const current = await this.sabre.getPurchaseBooking(row.booking.pnrLocator);
      const offer = row.intent.selectedOfferSnapshot as FlightOffer;
      if (!(await this.ticketing.capabilities()).ticketIssuanceAvailable || offer.ndcContext && !this.ticketing.canFulfillNdc(offer.airlineCodes)) throw conflict('Airline extras purchasing needs approved document issuance support for this fare. You can continue with ticket only.');
      this.verifyBooking(current, row.booking.sabreBookingId, offer, await this.bookedNames(bookingId));
      const quote = await this.quote(offer, current, requests, row.intent.currency);
      buildAncillaryModification(row.booking.pnrLocator, current, quote.plans);
      const extras = quote.items.reduce((total, item) => total + cents(item.checkoutAmount), 0n);
      purchase = { ...purchase, ...quote, status: 'PREPARED', bookingId: current.bookingId, extrasAmount: fromCents(extras), totalAmount: fromCents(cents(purchase.airfareAmount) + extras) };
    } catch (cause) { purchase.message = cause instanceof ApiException ? cause.message : 'The airline could not confirm these extras. Your reservation is kept; refresh or choose ticket only.'; }
    await this.storeReview(customerId, bookingId, row.intent.id, requests, purchase);
    return publicAncillaryPurchase(purchase);
  }
  private async storeReview(customerId: string, bookingId: string, intentId: string, requests: FlightAncillaryRequest[], purchase: StoredAncillaryPurchase) {
    await this.db.transaction(async tx => {
      const [intent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, intentId), eq(flightBookingIntents.customerId, customerId))).for('update');
      const [booking] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id, bookingId), eq(flightBookings.customerId, customerId))).for('update');
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.bookingIntentId, intentId)).limit(1);
      const snapshot = intent!.searchRequestSnapshot as AncillarySnapshot;
      if (order || !['PNR_CREATED', 'AWAITING_PAYMENT'].includes(booking!.status) || requestKey(snapshot.checkoutAncillaryRequests ?? []) !== requestKey(requests) || snapshot.checkoutAncillaryPurchase && !['PREPARED', 'UNAVAILABLE'].includes(snapshot.checkoutAncillaryPurchase.status)) throw conflict('This booking changed while reviewing extras.');
      await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...snapshot, checkoutAncillaryPurchase: purchase }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, intent!.id));
    });
  }
  async skip(customerId: string, bookingId: string) {
    const owned = await this.owned(customerId, bookingId);
    await this.db.transaction(async tx => {
      const [intent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, owned.intent.id), eq(flightBookingIntents.customerId, customerId))).for('update');
      const [booking] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id, bookingId), eq(flightBookings.customerId, customerId))).for('update');
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.bookingIntentId, owned.intent.id)).limit(1);
      const snapshot = intent!.searchRequestSnapshot as AncillarySnapshot, previous = snapshot.checkoutAncillaryPurchase;
      if (order || !['PNR_CREATED', 'AWAITING_PAYMENT'].includes(booking!.status) || previous && !['PREPARED', 'UNAVAILABLE', 'SKIPPED'].includes(previous.status)) throw conflict('Airline extras already have an addition attempt. Contact Flyseri for changes.');
      if (!intent!.validatedTotalAmount || !intent!.expiresAt || intent!.expiresAt <= new Date()) throw conflict('Refresh the reservation fare before continuing with ticket only.');
      const purchase: StoredAncillaryPurchase = { id: previous?.id ?? randomUUID(), status: 'SKIPPED', currency: intent!.currency, airfareAmount: intent!.validatedTotalAmount!, extrasAmount: '0.00', totalAmount: intent!.validatedTotalAmount!, expiresAt: intent!.expiresAt!.toISOString(), items: [], plans: [], bookingId: booking!.sabreBookingId ?? '', requestKey: requestKey(snapshot.checkoutAncillaryRequests ?? []), message: 'You chose ticket only. Selected extras will not be purchased.' };
      await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...snapshot, checkoutAncillaryPurchase: purchase }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, intent!.id));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: intent!.tripId, event: 'flight.extras.skipped' });
    });
    return publicAncillaryPurchase(((await this.owned(customerId, bookingId)).intent.searchRequestSnapshot as AncillarySnapshot).checkoutAncillaryPurchase);
  }
  async confirm(customerId: string, bookingId: string, reviewId: string) {
    if (this.config.FLIGHT_ANCILLARY_EXECUTION_ENABLED !== 'true' || !this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Airline extras purchasing is awaiting activation.', 503);
    const owned = await this.owned(customerId, bookingId), snapshot = owned.intent.searchRequestSnapshot as AncillarySnapshot;
    const requested = snapshot.checkoutAncillaryRequests ?? [], purchase = snapshot.checkoutAncillaryPurchase;
    if (!purchase || purchase.id !== reviewId) throw conflict('Review the current extras total before accepting it.');
    if (['CONFIRMED', 'FULFILLMENT_PENDING', 'FULFILLED'].includes(purchase.status)) return publicAncillaryPurchase(purchase);
    if (!['PREPARED', 'PRICE_CHANGED'].includes(purchase.status) || Date.parse(purchase.expiresAt) <= Date.now()) throw conflict('The extra price review expired or needs reconciliation. Refresh it before continuing.');
    const current = await this.sabre.getPurchaseBooking(owned.booking.pnrLocator!);
    this.verifyBooking(current, owned.booking.sabreBookingId, owned.intent.selectedOfferSnapshot as FlightOffer, await this.bookedNames(bookingId));
    let fresh = purchase;
    if (purchase.status === 'PREPARED') {
      const quoted = await this.quote(owned.intent.selectedOfferSnapshot as FlightOffer, current, requested, purchase.currency);
      if (quoted.items.some((item, index) => item.airlineAmount !== purchase.items[index]?.airlineAmount || item.airlineCurrency !== purchase.items[index]?.airlineCurrency || item.checkoutAmount !== purchase.items[index]?.checkoutAmount)) throw conflict('An extra price changed. Refresh the review before adding it.');
      fresh = { ...purchase, plans: quoted.plans };
    } else {
      const evidence = confirmedAncillaryItems(current, purchase.plans, requested);
      if (evidence.some(item => !purchase.items.some(expected => expected.requestId === item.requestId && expected.providerAncillaryIds.includes(item.itemId) && cents(expected.airlineAmount) === cents(item.amount) && expected.airlineCurrency === item.currency && expected.checkoutAmount === this.checkoutAmount(item.amount, item.currency, purchase.currency)))) throw conflict('The airline extra price changed again. Refresh the review before accepting it.');
    }
    const body = purchase.status === 'PREPARED' ? buildAncillaryModification(owned.booking.pnrLocator!, current, fresh.plans) : null;
    await this.db.transaction(async tx => {
      const [intent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, owned.intent.id), eq(flightBookingIntents.customerId, customerId))).for('update');
      const [booking] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id, bookingId), eq(flightBookings.customerId, customerId))).for('update');
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.bookingIntentId, intent!.id)).limit(1);
      const stored = intent!.searchRequestSnapshot as AncillarySnapshot;
      if (order || !['PNR_CREATED', 'AWAITING_PAYMENT'].includes(booking!.status) || !intent!.expiresAt || intent!.expiresAt <= new Date() || stored.checkoutAncillaryPurchase?.id !== reviewId || stored.checkoutAncillaryPurchase.status !== purchase.status || requestKey(stored.checkoutAncillaryRequests ?? []) !== purchase.requestKey) throw conflict('This booking changed or already has an extras attempt.');
      await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...stored, checkoutAncillaryPurchase: { ...fresh, status: body ? 'ADDING' : 'CONFIRMED' } }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, intent!.id));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: intent!.tripId, event: body ? 'flight.extras.addition.claimed' : 'flight.extras.changed-price.accepted' });
    });
    if (!body) return publicAncillaryPurchase({ ...fresh, status: 'CONFIRMED' });
    try {
      await this.sabre.modifyAncillaries(body);
      const after = await this.sabre.getPurchaseBooking(owned.booking.pnrLocator!);
      this.verifyBooking(after, owned.booking.sabreBookingId, owned.intent.selectedOfferSnapshot as FlightOffer, await this.bookedNames(bookingId));
      const evidence = confirmedAncillaryItems(after, fresh.plans, requested);
      const items = fresh.items.map(item => {
        const actual = evidence.find(entry => entry.requestId === item.requestId)!;
        return { ...item, airlineAmount: fromCents(cents(actual.amount)), airlineCurrency: actual.currency, checkoutAmount: this.checkoutAmount(actual.amount, actual.currency, fresh.currency), providerAncillaryIds: [actual.itemId] };
      });
      const extrasAmount = fromCents(items.reduce((sum, item) => sum + cents(item.checkoutAmount), 0n));
      const totalAmount = fromCents(cents(fresh.airfareAmount) + cents(extrasAmount));
      const changed = items.some((item, index) => item.checkoutAmount !== fresh.items[index]!.checkoutAmount || item.airlineAmount !== fresh.items[index]!.airlineAmount || item.airlineCurrency !== fresh.items[index]!.airlineCurrency);
      const confirmed: StoredAncillaryPurchase = { ...fresh, id: changed ? randomUUID() : fresh.id, items, extrasAmount, totalAmount, status: changed ? 'PRICE_CHANGED' : 'CONFIRMED', message: changed ? 'The airline attached your extras at a changed price. Review and accept this total before payment; no second addition will be sent.' : 'Airline extras are confirmed on your reservation. Document issuance follows payment.' };
      await this.finish(customerId, bookingId, fresh.id, confirmed);
      return publicAncillaryPurchase(confirmed);
    } catch {
      await this.finish(customerId, bookingId, fresh.id, { ...fresh, status: 'UNKNOWN', message: 'The airline extras result needs verification. Do not add them again or pay yet. Contact Flyseri.' }, true);
      throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Airline extras need reconciliation. No automatic retry or payment is allowed.', 503);
    }
  }
  /** Read-only supplier reconciliation. Never submit a second addition. */
  async reconcile(customerId: string, bookingId: string) {
    if (!this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Airline lookup is unavailable.', 503);
    const owned = await this.owned(customerId, bookingId), snapshot = owned.intent.searchRequestSnapshot as AncillarySnapshot;
    const purchase = snapshot.checkoutAncillaryPurchase, requests = snapshot.checkoutAncillaryRequests ?? [];
    if (!purchase || !['ADDING', 'UNKNOWN', 'PRICE_CHANGED', 'CONFIRMED'].includes(purchase.status) || !owned.booking.pnrLocator) throw conflict('This booking has no extras addition to verify.');
    const current = await this.sabre.getPurchaseBooking(owned.booking.pnrLocator);
    this.verifyBooking(current, owned.booking.sabreBookingId, owned.intent.selectedOfferSnapshot as FlightOffer, await this.bookedNames(bookingId));
    let evidence: ReturnType<typeof confirmedAncillaryItems>;
    try { evidence = confirmedAncillaryItems(current, purchase.plans, requests); }
    catch { throw conflict('The airline has not returned complete confirmed extras. The attempt remains locked; contact Flyseri before purchasing again.'); }
    const items = purchase.items.map(item => {
      const actual = evidence.find(entry => entry.requestId === item.requestId)!;
      return { ...item, airlineAmount: fromCents(cents(actual.amount)), airlineCurrency: actual.currency, checkoutAmount: this.checkoutAmount(actual.amount, actual.currency, purchase.currency), providerAncillaryIds: [actual.itemId] };
    });
    const extrasAmount = fromCents(items.reduce((sum, item) => sum + cents(item.checkoutAmount), 0n));
    const changed = purchase.status === 'PRICE_CHANGED' || items.some((item, index) => item.checkoutAmount !== purchase.items[index]?.checkoutAmount || item.airlineCurrency !== purchase.items[index]?.airlineCurrency || item.airlineAmount !== purchase.items[index]?.airlineAmount);
    const reconciled: StoredAncillaryPurchase = { ...purchase, id: changed ? randomUUID() : purchase.id, status: changed ? 'PRICE_CHANGED' : 'CONFIRMED', items, extrasAmount, totalAmount: fromCents(cents(purchase.airfareAmount) + cents(extrasAmount)), expiresAt: new Date(Math.min(Date.now() + 120000, owned.intent.expiresAt?.getTime() ?? Date.parse(purchase.expiresAt))).toISOString(), message: changed ? 'Airline extras are attached at a changed price. Accept the updated total before payment.' : 'Airline extras were verified on your reservation. No new addition was sent.' };
    await this.db.transaction(async tx => {
      const [intent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, owned.intent.id), eq(flightBookingIntents.customerId, customerId))).for('update');
      const [booking] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id, bookingId), eq(flightBookings.customerId, customerId))).for('update');
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.bookingIntentId, intent!.id)).limit(1);
      const stored = intent!.searchRequestSnapshot as AncillarySnapshot;
      if (order || stored.checkoutAncillaryPurchase?.id !== purchase.id || !['ADDING', 'UNKNOWN', 'PRICE_CHANGED', 'CONFIRMED'].includes(stored.checkoutAncillaryPurchase.status) || !['PNR_CREATED', 'AWAITING_PAYMENT', 'MANUAL_REVIEW_REQUIRED'].includes(booking!.status) || requestKey(stored.checkoutAncillaryRequests ?? []) !== purchase.requestKey) throw conflict('This extras attempt changed while verifying it.');
      await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...stored, checkoutAncillaryPurchase: reconciled }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, intent!.id));
      if (booking!.status === 'MANUAL_REVIEW_REQUIRED') await tx.update(flightBookings).set({ status: 'PNR_CREATED', updatedAt: new Date() }).where(eq(flightBookings.id, bookingId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: intent!.tripId, event: 'flight.extras.reconciled' });
    });
    return publicAncillaryPurchase(reconciled);
  }
  private async finish(customerId: string, bookingId: string, reviewId: string, purchase: StoredAncillaryPurchase, unknown = false) {
    const owned = await this.owned(customerId, bookingId);
    await this.db.transaction(async tx => {
      const [intent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, owned.intent.id), eq(flightBookingIntents.customerId, customerId))).for('update');
      const snapshot = intent!.searchRequestSnapshot as AncillarySnapshot;
      if (snapshot.checkoutAncillaryPurchase?.id !== reviewId || snapshot.checkoutAncillaryPurchase.status !== 'ADDING') throw conflict('The extras attempt changed; reconciliation is required.');
      await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...snapshot, checkoutAncillaryPurchase: purchase }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, intent!.id));
      if (unknown) await tx.update(flightBookings).set({ status: 'MANUAL_REVIEW_REQUIRED', updatedAt: new Date() }).where(eq(flightBookings.id, bookingId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: intent!.tripId, event: `flight.extras.${purchase.status.toLowerCase()}` });
    });
  }
}
