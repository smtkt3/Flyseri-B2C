import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { FlightAncillaryResponse, FlightAncillaryRequest, FlightAncillarySelectionInput } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { SABRE_BOOKING_CLIENT } from '../tokens.js';
import { FlightService } from './flight.service.js';
import { SabreBookingManagementClient } from './sabre-booking-management.client.js';
import { SabreAtpcoAncillariesClient } from './sabre-atpco-ancillaries.client.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { customerTravellers, travellers, type DatabaseConnection } from '@flyseri/database';
import { DATABASE_CONNECTION } from '../tokens.js';
import { BookingIntentService } from './booking-intent.service.js';
import { passengerCodeAt } from './flight-passenger-types.js';

const object = (value: unknown): Record<string, unknown> | null => !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown, max = 160): string | null => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null;
const list = (value: unknown, max = 1000): Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.length > max || value.some((item) => !object(item))) throw new Error('Invalid ancillary list');
  return value as Record<string, unknown>[];
};

/** Public response built from Sabre's documented ancillaries/offer/otherServices
 * references. No passenger names or raw supplier fields pass through.
 */
export function readSabreAncillaries(value: unknown, passengerIds: string[], context: NonNullable<FlightAncillaryResponse['context']> = 'SHOPPING_OFFER'): FlightAncillaryResponse {
  const ancillaries = object(object(value)?.ancillaries);
  const offer = object(ancillaries?.offer);
  if (!ancillaries || !offer || !string(offer.offerId)) throw new Error('Ancillary offer missing');
  const segments = new Map(list(ancillaries.segments, 60).map((item) => [string(item.id), item]));
  const passengers = new Set(list(ancillaries.passengers, 9).map((item) => string(item.passengerId)));
  if (!passengerIds.every((id) => passengers.has(id))) throw new Error('Ancillary passenger mismatch');
  const definitions = new Map(list(ancillaries.serviceDefinitions).map((item) => [string(item.id), item]));
  const prices = new Map(list(ancillaries.priceDefinitions ?? []).map((item) => [string(item.id), item]));
  const services = list(offer.otherServices).map((item) => {
    const definition = definitions.get(string(item.serviceDefinitionRef));
    const offerItemId = string(item.offerItemId), serviceCode = string(definition?.serviceCode, 40);
    if (!definition || !serviceCode || (item.offerItemId !== undefined && item.offerItemId !== null && !offerItemId) || !Array.isArray(item.segmentRefs) || !item.segmentRefs.length ||
      !Array.isArray(item.passengerRefs) || !item.passengerRefs.length) throw new Error('Ancillary references missing');
    const segmentLabels = item.segmentRefs.map((ref) => {
      const segment = segments.get(string(ref));
      const origin = string(segment?.departureAirportCode, 3), destination = string(segment?.arrivalAirportCode, 3);
      const airline = string(segment?.bookingAirlineCode, 3), date = string(segment?.departureDate, 10);
      const number = segment?.bookingFlightNumber;
      if (!origin || !destination || !airline || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        (typeof number !== 'number' && typeof number !== 'string') || !/^\d{1,4}$/.test(String(number))) throw new Error('Ancillary segment missing');
      return `${origin} → ${destination} · ${airline} ${number} · ${date}`;
    });
    const passengerIndexes = item.passengerRefs.map((ref) => {
      const index = passengerIds.indexOf(String(ref));
      if (index < 0) throw new Error('Ancillary passenger missing');
      return index;
    });
    let amount: string | null = null, currency: string | null = null;
    if (item.priceDefinitionRef !== undefined) {
      const price = prices.get(string(item.priceDefinitionRef));
      const sale = object(object(object(price?.serviceFee)?.totalPrice)?.saleAmount);
      if (!sale || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(sale.amount)) || !/^[A-Z]{3}$/.test(String(sale.currencyCode))) throw new Error('Ancillary price missing');
      amount = String(sale.amount); currency = String(sale.currencyCode);
    }
    // BFM ancillary content is informational, even if an item identifier happens
    // to be present. Missing identifiers must not discard display-only services.
    const flags = [item.sellable, offer.sellable, ancillaries.sellable];
    const sellable = context === 'SHOPPING_OFFER' || !offerItemId || flags.includes(false) ? false : flags.includes(true) ? true : null;
    const groupCode = string(definition.groupCode, 2);
    return { offerItemId, sellable, serviceCode, name: string(definition.commercialName, 160) ?? serviceCode,
      ...(groupCode && /^[A-Z]{2}$/.test(groupCode) ? { groupCode } : {}),
      amount, currency, segmentLabels, passengerIndexes };
  });
  return { retrievedAt: new Date().toISOString(), context, bookingAvailable: false, services };
}

@Injectable()
export class FlightAncillariesService {
  private readonly receipts = new Map<string, { owner: string | null; searchId?: string; offerId?: string; intentId?: string; until: number; result: FlightAncillaryResponse }>();
  private readonly quotes = new Map<string, { until: number; promise: Promise<FlightAncillaryResponse> }>();
  private cachedQuote(scope: unknown[], expiresAt: string | undefined, lookup: () => Promise<FlightAncillaryResponse>) {
    for (const [id, entry] of this.quotes) if (entry.until <= Date.now()) this.quotes.delete(id);
    const key = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    const previous = this.quotes.get(key);
    if (previous) return previous.promise;
    while (this.quotes.size >= 100) this.quotes.delete(this.quotes.keys().next().value!);
    const expiry = expiresAt ? Date.parse(expiresAt) : Infinity;
    const until = Math.min(Date.now() + 120000, expiry);
    const entry = { until, promise: lookup().then(result => {
      for (const [id, receipt] of this.receipts) if (receipt.until <= Date.now()) this.receipts.delete(id);
      while (this.receipts.size >= 100) this.receipts.delete(this.receipts.keys().next().value!);
      const quoteId = randomUUID();
      const source = String(scope[0]);
      const quoted = { ...result, quoteId, expiresAt: new Date(until).toISOString() };
      this.receipts.set(quoteId, { owner: scope[1] as string | null,
        ...(source.startsWith('shopping') ? { searchId: String(scope[2]), offerId: String(scope[3]) } : { intentId: String(scope[2]) }), until, result: quoted });
      return quoted;
    }) };
    this.quotes.set(key, entry);
    void entry.promise.catch(() => { if (this.quotes.get(key) === entry) this.quotes.delete(key); });
    return entry.promise;
  }
  resolveSelections(customerId: string, scope: { searchId?: string; offerId?: string; intentId?: string }, selections: FlightAncillarySelectionInput[]): FlightAncillaryRequest[] {
    const seen = new Set<string>();
    const requests = selections.map(selection => {
      const receipt = this.receipts.get(selection.quoteId);
      if (!receipt || receipt.until <= Date.now()) throw new ApiException('OFFER_EXPIRED', 'Refresh airline extras before saving your selection.', 410);
      if (receipt.owner !== customerId || receipt.searchId !== scope.searchId || receipt.offerId !== scope.offerId || receipt.intentId !== scope.intentId) throw new ApiException('CONFLICT', 'These extras belong to a different flight selection.', 409);
      const service = receipt.result.services[selection.serviceIndex];
      const id = `${selection.quoteId}:${selection.serviceIndex}`;
      const serviceKey = service ? JSON.stringify([service.name, service.serviceCode, service.groupCode, service.segmentLabels, service.passengerIndexes]) : '';
      if (!service || seen.has(serviceKey) || !service.segmentLabels.length || !service.passengerIndexes.length) throw new ApiException('VALIDATION_ERROR', 'Choose each airline extra once with its flight and traveler association.', 400);
      seen.add(serviceKey);
      const group = service.groupCode;
      const name = service.name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
      const category: FlightAncillaryRequest['category'] = group === 'BG' ? 'BAGGAGE' : group === 'SA' ? 'SEATS' : group === 'ML' ? 'FOOD' : group ? 'OTHER' :
        /\b(BAGGAGE|LUGGAGE|BAG|BAGS|EXCESS WEIGHT|EXTRA WEIGHT|SPORTS EQUIPMENT)\b/.test(name) ? 'BAGGAGE' :
        /\b(SEAT|SEATS|SEATING|LEGROOM|LEG ROOM)\b/.test(name) ? 'SEATS' :
        /\b(MEAL|MEALS|FOOD|DRINK|DRINKS|BEVERAGE|BEVERAGES|SNACK|SNACKS|COFFEE|TEA|JUICE|WATER|COCONUTWATER|SODA|COLA|WINE|BEER|SANDWICH|CHICKEN|RICE|NOODLES|PASTA|BREAKFAST|LUNCH|DINNER|VEGETARIAN|VEGAN)\b/.test(name) ? 'FOOD' : 'OTHER';
      return { id, name: service.name, serviceCode: service.serviceCode, groupCode: service.groupCode, category,
        segmentLabels: [...service.segmentLabels], passengerIndexes: [...service.passengerIndexes], amount: service.amount, currency: service.currency, status: 'REQUESTED' as const };
    });
    for (let index = 0; index < requests.length; index++) {
      const extra = requests[index]!;
      if (['BAGGAGE', 'SEATS'].includes(extra.category) && requests.slice(0, index).some(previous => previous.category === extra.category && previous.segmentLabels.some(label => extra.segmentLabels.includes(label)) && previous.passengerIndexes.some(passenger => extra.passengerIndexes.includes(passenger)))) throw new ApiException('VALIDATION_ERROR', 'Choose one baggage or seat option per flight and traveler.', 400);
    }
    return requests;
  }
  constructor(@Inject(FlightService) private readonly flights: FlightService,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre: SabreBookingManagementClient | undefined,
    @Inject(SabreAtpcoAncillariesClient) private readonly atpco: SabreAtpcoAncillariesClient | undefined,
    @Inject(BookingIntentService) private readonly intents: BookingIntentService,
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined) {}
  async lookupIntent(customerId: string, intentId: string): Promise<FlightAncillaryResponse> {
    const intent = await this.intents.detail(customerId, intentId);
    if (intent.status !== 'READY_FOR_PAYMENT' || !intent.expiresAt || Date.parse(intent.expiresAt) <= Date.now() || !intent.searchRequest) throw new ApiException('CONFLICT', 'Check and accept the latest fare before checking airline services.', 409);
    const context = intent.selectedOffer.ndcContext;
    if (!context) {
      if (intent.searchRequest.children || intent.searchRequest.infants) throw new ApiException('CONFLICT', 'Additional service quotes for children and infants need Flyseri assistance. Your requests can still be saved.', 409);
      if (!this.atpco) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Airline service lookup is temporarily unavailable.', 503);
      try { return await this.cachedQuote(['intent-atpco', customerId, intentId, intent.validatedAt, intent.selectedOffer], intent.expiresAt, () => this.atpco!.lookup(intent.selectedOffer, intent.searchRequest!.adults)); }
      catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Additional airline offers could not be retrieved. Your saved requests are kept.', 503); }
    }
    if (!this.sabre || !this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Additional airline offers are temporarily unavailable.', 503);
    if (!context.offerItemIds?.length || Date.parse(context.expiresAt) <= Date.now()) throw new ApiException('OFFER_EXPIRED', 'Refresh the fare before checking additional services.', 410);
    const people = await this.connection.db.select({ person: travellers }).from(customerTravellers)
      .innerJoin(travellers, and(eq(travellers.id, customerTravellers.travellerId), isNull(travellers.archivedAt)))
      .where(and(eq(customerTravellers.customerId, customerId), inArray(travellers.id, intent.travellerIds)));
    if (people.length !== intent.travellerIds.length || context.passengers.length !== intent.travellerIds.length) throw new ApiException('CONFLICT', 'The selected traveler details need review.', 409);
    try {
      const remaining = [...context.passengers];
      const passengers = intent.travellerIds.map(id => {
        const person = people.find(row => row.person.id === id)!.person;
        if (!person.dateOfBirth) throw new Error('Missing birth date');
        const code = passengerCodeAt(person.dateOfBirth, intent.searchRequest!.departureDate);
        const index = remaining.findIndex(ref => ref.passengerTypeCode === code);
        if (index < 0) throw new Error('Passenger association mismatch');
        return { ...remaining.splice(index, 1)[0]!, givenName: [person.legalFirstName, person.legalMiddleName].filter(Boolean).join(' '), surname: person.legalLastName };
      });
      return await this.cachedQuote(['intent-ndc', customerId, intentId, context.offerId, passengers], context.expiresAt, async () => {
        const response = await this.sabre!.getAncillaryOffers({ requestType: 'offerId', request: { offerId: context.offerId, passengers } });
        return readSabreAncillaries(response, passengers.map(person => person.passengerId), 'PRICED_OFFER');
      });
    } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Additional airline offers could not be confirmed for these travelers. Your fare and saved requests are kept.', 503); }
  }
  async lookup(customerId: string | null, input: { searchId: string; offerId: string; passengers: { givenName: string; surname: string }[] }) {
    const selection = await this.flights.selectedOffer(customerId, input.searchId, input.offerId);
    const context = selection.offer.ndcContext;
    if (!context) {
      if (selection.search.children || selection.search.infants || selection.search.adults !== input.passengers.length) throw new ApiException('CONFLICT', 'Additional service lookup currently supports adult travelers. Your requests can still be saved.', 409);
      if (!this.atpco) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Airline service lookup is temporarily unavailable. Your requests can still be saved.', 503);
      try { return await this.cachedQuote(['shopping-atpco', customerId, input.searchId, input.offerId, selection.search.adults], undefined, () => this.atpco!.lookup(selection.offer, selection.search.adults)); }
      catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Sabre could not confirm additional services for this fare. You can still save your requests for Flyseri review.', 503); }
    }
    if (!context || !context.passengers.length) throw new ApiException('CONFLICT', 'Ancillary lookup needs an NDC offer with passenger references. This fare has no supported NDC context.', 409);
    if (Date.parse(context.expiresAt) <= Date.now()) throw new ApiException('OFFER_EXPIRED', 'This airline offer has expired. Search again to check additional services.', 410);
    if (input.passengers.some(person => !person.givenName.trim() || !person.surname.trim())) throw new ApiException('VALIDATION_ERROR', 'Confirm passenger names before checking NDC services.', 400);
    if (context.passengers.length !== input.passengers.length || context.passengers.length !== selection.search.adults ||
      context.passengers.some((person) => person.passengerTypeCode !== 'ADT')) throw new ApiException('VALIDATION_ERROR', 'Confirm all adult passenger names before checking services.', 400);
    if (!this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Additional services are temporarily unavailable.', 503);
    try {
      return await this.cachedQuote(['shopping-ndc', customerId, input.searchId, input.offerId, input.passengers], context.expiresAt, async () => {
        const response = await this.sabre!.getAncillaryOffers({ requestType: 'offerId', request: { offerId: context.offerId,
          passengers: context.passengers.map((person, index) => ({ ...person, ...input.passengers[index]! })) } });
        return readSabreAncillaries(response, context.passengers.map((person) => person.passengerId));
      });
    } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'The airline additional services could not be confirmed. Please try again or contact Flyseri.', 503); }
  }
}
