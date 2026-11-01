import { hasIssuedTicketEvidence, hasCurrentIssuedTicketEvidence, matchesConfirmedItinerary } from './reservation-evidence.js';
import { publicAncillaryPurchase,confirmedAncillaryItems,cents,requestKey, type AncillarySnapshot } from './ancillary-purchase.contract.js';
import {publicAncillaryRequest} from '../pricing/ancillary-pricing.contract.js';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { auditEvents, customerTravellers, flightBookingIntents, flightBookingIntentTravellers, flightBookings, orders, payments, travellers, type DatabaseConnection } from '@flyseri/database';
import type { AppConfig } from '@flyseri/config';
import type { FlightBooking, FlightBookingProviderView, FlightReservationInput, FlightServiceRequest, OrderStatus, FlightAncillaryRequest } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DATABASE_CONNECTION, FLIGHT_TELEMETRY, SABRE_BOOKING_CLIENT } from '../tokens.js';
import { BookingIntentService } from './booking-intent.service.js';
import { BookingReservationRepository, BookingReservationConflictError, BookingReservationMissingError } from './booking-reservation.repository.js';
import { parseFlightOffers } from './flight-response.js';
import { bookingSpecialServices } from './flight-special-services.js';
import { passengerCodeAt } from './flight-passenger-types.js';
import { FlightTelemetry } from './flight.telemetry.js';
import { SabreBookingManagementClient, SabreBookingUnknownError, SabreBookingRejectedError, buildSabreCreateBooking, buildSabreCreateNdcBooking, selectCheckedAtpcoOffer, type BookingAgency } from './sabre-booking-management.client.js';
import { readPricedNdcOffer } from './sabre-ndc-price.js';
import { TicketingValidationError } from './ticketing-currency.contract.js';
import { reservationFailureMessage } from './reservation-failure.contract.js';
import {customerExchangeQuotations} from './customer-exchange-quotation.js';
import {readRetailPricing} from '../pricing/flight-pricing.contract.js';
import {ticketDocumentAvailable} from './ticket-document.contract.js';

const missing = () => new ApiException('NOT_FOUND', 'Booking not found.', 404);
const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Reservation creation is not configured. Your flight selection is kept.', 503);
const amountEquals = (a: string, b: string) => {
  const minor = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2)); };
  return minor(a) === minor(b);
};

@Injectable()
export class FlightBookingsService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre: SabreBookingManagementClient | undefined,
    @Inject(BookingIntentService) private readonly intents: BookingIntentService,
    @Inject(FLIGHT_TELEMETRY) private readonly telemetry: FlightTelemetry) {}
  private get db() { if (!this.connection) throw unavailable(); return this.connection.db; }
  private agency(): BookingAgency | null {
    try {
      const value = JSON.parse(this.config.SABRE_BOOKING_AGENCY ?? 'null') as BookingAgency | null;
      // PCC authenticates the agency. The optional customer/DK number has a separate Sabre format.
      const agencyCustomerNumber = value?.agencyCustomerNumber;
      if (!value || !value.address || !['name','street','city','stateProvince','postalCode','countryCode','freeText'].every(key => {
        const field = value.address[key as keyof BookingAgency['address']]; return typeof field === 'string' && field.trim().length > 0 && field.length <= 500;
      }) || !/^[A-Z]{2}$/.test(value.address.countryCode) || (agencyCustomerNumber !== undefined && (typeof agencyCustomerNumber !== 'string' || !/^[0-9A-Z]{6}([1-9A-Z*]{1}|[0-9A-Z]{4})?$/.test(agencyCustomerNumber))) || typeof value.ticketingPolicy !== 'string' || !value.ticketingPolicy.trim() || value.ticketingPolicy.length > 40) return null;
      return { address: {...value.address}, ...(agencyCustomerNumber ? {agencyCustomerNumber} : {}), ticketingPolicy: value.ticketingPolicy };
    } catch { return null; }
  }
  capabilities() {
    const reservationAvailable = this.config.FLIGHT_BOOKING_EXECUTION_ENABLED === 'true' && !!this.connection && !!this.sabre && !!this.agency();
    return { reservationAvailable, environment: this.config.SABRE_ENV, ticketIssuanceAvailable: false,
      message: reservationAvailable ? 'Test reservations are available. Ticket issuance is handled separately.' : 'Reservation creation is awaiting approved agency configuration. Existing bookings can still be viewed.' };
  }
  private rows(customerId: string, id?: string) {
    return this.db.select({ booking: flightBookings, offer: flightBookingIntents.selectedOfferSnapshot,
      serviceRequests: flightBookingIntents.serviceRequests,
      searchSnapshot: flightBookingIntents.searchRequestSnapshot,
      bookedNames: sql<string[] | null>`to_jsonb(${flightBookings})->'booked_passenger_names'`,
      providerSnapshot: sql<FlightBookingProviderView | null>`to_jsonb(${flightBookings})->'provider_view_snapshot'`,
      failureCode: sql<string | null>`(SELECT CASE WHEN a.event = 'flight.booking.rejected:' || ${flightBookings.id}::text || ':AGENCY_CONFIGURATION' THEN 'AGENCY_CONFIGURATION' ELSE 'PROVIDER_REJECTED' END FROM audit_events a WHERE a.actor_customer_id = ${flightBookings.customerId} AND a.event IN ('flight.booking.rejected:' || ${flightBookings.id}::text || ':AGENCY_CONFIGURATION', 'flight.booking.rejected:' || ${flightBookings.id}::text || ':PROVIDER_REJECTED') ORDER BY a.created_at DESC LIMIT 1)`,
      unknownDiagnosticEvent: sql<string | null>`(SELECT a.event FROM audit_events a WHERE a.actor_customer_id = ${flightBookings.customerId} AND a.event LIKE 'flight.booking.unknown-diagnostic:' || ${flightBookings.id}::text || ':%' ORDER BY a.created_at DESC LIMIT 1)`,
      reconciliationEvent: sql<string | null>`(SELECT a.event FROM audit_events a WHERE a.actor_customer_id = ${flightBookings.customerId} AND a.event LIKE 'flight.booking.reconciliation:' || ${flightBookings.id}::text || ':%' ORDER BY a.created_at DESC LIMIT 1)`,
      order: { id: orders.id, orderNumber: orders.orderNumber, status: orders.status, expiresAt: orders.expiresAt, paidAt: orders.paidAt },
      currency: flightBookingIntents.currency, amount: flightBookingIntents.validatedTotalAmount, shoppingAmount: flightBookingIntents.searchTotalAmount })
      .from(flightBookings).innerJoin(flightBookingIntents, and(eq(flightBookingIntents.id, flightBookings.bookingIntentId), eq(flightBookingIntents.customerId, customerId)))
      .leftJoin(orders, and(eq(orders.bookingIntentId, flightBookings.bookingIntentId), eq(orders.customerId, customerId)))
      .where(and(eq(flightBookings.customerId, customerId), id ? eq(flightBookings.id, id) : undefined))
      .orderBy(desc(flightBookings.createdAt), desc(flightBookings.id)).limit(id ? 1 : 100);
  }
  private async present(row: Awaited<ReturnType<FlightBookingsService['rows']>>[number]): Promise<FlightBooking> {
    const serviced=(row.searchSnapshot as {servicedOffer?:unknown}).servicedOffer;
    const selectedOffer = parseFlightOffers([serviced??row.offer])?.[0];
    if (!selectedOffer) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'The saved itinerary could not be read.', 503);
    const unconfirmedMessage=row.booking.status==='BOOKING_UNKNOWN'&&!row.booking.pnrLocator?reservationFailureMessage(row.unknownDiagnosticEvent,row.booking.id,selectedOffer):undefined;
    let reconciliation: {checkedAt:string;result:'NO_ACTIVE_MATCH'} | undefined;
    if(row.reconciliationEvent) try {
      const evidence=JSON.parse(row.reconciliationEvent.split(':').slice(2).join(':'));
      if(evidence.source==='CERT_TRIP_SEARCH' && evidence.result==='NO_ACTIVE_MATCH' && typeof evidence.checkedAt==='string' && Number.isFinite(Date.parse(evidence.checkedAt))) reconciliation={checkedAt:evidence.checkedAt,result:evidence.result};
    } catch { /* Invalid historical evidence is not exposed. */ }
    const people = await this.db.select({ id: travellers.id, first: travellers.legalFirstName, middle: travellers.legalMiddleName, last: travellers.legalLastName }).from(flightBookingIntentTravellers)
      .innerJoin(customerTravellers, and(eq(customerTravellers.travellerId, flightBookingIntentTravellers.travellerId), eq(customerTravellers.customerId, row.booking.customerId)))
      .innerJoin(travellers, eq(travellers.id, flightBookingIntentTravellers.travellerId)).where(eq(flightBookingIntentTravellers.bookingIntentId, row.booking.bookingIntentId));
    const storedOrder = (row.searchSnapshot as { checkoutTravellerOrder?: string[] }).checkoutTravellerOrder;
    const orderedPeople = storedOrder && storedOrder.length === people.length && new Set(storedOrder).size === people.length && storedOrder.every(id => people.some(person => person.id === id)) ? storedOrder.map(id => people.find(person => person.id === id)!) : people;
    const presented:FlightBooking={ id: row.booking.id, bookingIntentId: row.booking.bookingIntentId, tripId: row.booking.tripId, status: row.booking.status,
      pnr: row.booking.pnrLocator, currency: row.currency, amount: row.amount ?? row.shoppingAmount, selectedOffer,
      ancillaryPurchase: publicAncillaryPurchase((row.searchSnapshot as AncillarySnapshot).checkoutAncillaryPurchase),
      ancillaryRequests: ((row.searchSnapshot as { checkoutAncillaryRequests?: FlightAncillaryRequest[] }).checkoutAncillaryRequests ?? []).map(publicAncillaryRequest),
      passengerNames: row.bookedNames ?? orderedPeople.map(person => [person.first, person.middle, person.last].filter(Boolean).join(' ')),
      passengerNamesSource: row.bookedNames ? 'BOOKED_SNAPSHOT' : 'CURRENT_PROFILES',
      ...(reconciliation ? {reconciliation} : {}),
      ...(row.failureCode ? { failureMessage: row.failureCode === 'AGENCY_CONFIGURATION' ? 'The reservation was rejected because of an agency configuration issue. No PNR was confirmed.' : 'The airline provider rejected this reservation. No PNR was confirmed.' } : {}),
      ...(unconfirmedMessage?{failureMessage:unconfirmedMessage}:{}),
      serviceRequests: ((row.serviceRequests ?? []) as FlightServiceRequest[]).map(request => {
        const person = people.find(person => person.id === request.travellerId);
        return { ...request, passengerName: person ? [person.first, person.middle, person.last].filter(Boolean).join(' ') : 'Traveler' };
      }),
      ...(row.providerSnapshot ? { providerView: row.providerSnapshot } : {}),
      ...(row.order?.id ? { order: { ...row.order, status: (row.order.expiresAt && row.order.expiresAt.getTime() <= Date.now() && ['PENDING_PAYMENT','PAYMENT_FAILED'].includes(row.order.status) ? 'EXPIRED' : row.order.status) as OrderStatus, expiresAt: row.order.expiresAt?.toISOString() ?? null, paidAt: row.order.paidAt?.toISOString() ?? null } } : {}),
      createdAt: row.booking.createdAt.toISOString(), updatedAt: row.booking.updatedAt.toISOString(),
      lastSabreRefreshAt: row.booking.lastSabreRefreshAt?.toISOString() ?? null, ticketStatus: hasCurrentIssuedTicketEvidence(row.providerSnapshot,row.bookedNames?.length ?? orderedPeople.length) ? 'ISSUED' : 'NOT_VERIFIED' };
    return {...presented,ticketDocumentAvailable:ticketDocumentAvailable(presented)};
  }
  async list(customerId: string) {
    const rows=await this.rows(customerId),quotations=await customerExchangeQuotations(this.connection!,customerId,{bookingIds:rows.map(row=>row.booking.id)});
    return Promise.all(rows.map(async row=>({...await this.present(row),exchangeQuotations:quotations.filter(quote=>quote.bookingId===row.booking.id)})));
  }
  async detail(customerId: string, id: string) { const [row] = await this.rows(customerId, id); if (!row) throw missing(); return {...await this.present(row),exchangeQuotations:await customerExchangeQuotations(this.connection!,customerId,{bookingIds:[id]})}; }
  async forIntent(customerId: string, intentId: string) {
    await this.intents.detail(customerId, intentId);
    const [row] = await this.db.select({ id: flightBookings.id }).from(flightBookings)
      .where(and(eq(flightBookings.customerId, customerId), eq(flightBookings.bookingIntentId, intentId))).limit(1);
    return row ? this.detail(customerId, row.id) : null;
  }
  async reserve(customerId: string, intentId: string, input: FlightReservationInput): Promise<FlightBooking> {
    // Restoring an existing attempt is safe even after execution has been disabled.
    const [existing] = await this.db.select({id: flightBookings.id}).from(flightBookings).where(and(eq(flightBookings.customerId, customerId), eq(flightBookings.bookingIntentId, intentId))).limit(1);
    if (existing) return this.detail(customerId, existing.id);
    const agency = this.agency();
    if (!this.capabilities().reservationAvailable || !this.sabre || !agency || !this.connection) throw unavailable();
    if (!input.namesConfirmed) throw new ApiException('VALIDATION_ERROR', 'Confirm all passenger legal names before reserving.', 400);
    const intent = await this.intents.detail(customerId, intentId);
    if (intent.status !== 'READY_FOR_PAYMENT' || !intent.validatedTotalAmount || !intent.expiresAt || Date.parse(intent.expiresAt) <= Date.now()) throw new ApiException('CONFLICT', 'Check and accept the latest fare before reserving.', 409);
    if (!intent.searchRequest) throw new ApiException('VALIDATION_ERROR', 'The original passenger search details are required.', 400);
    const passports = input.passports ?? [];
    if (passports.length !== intent.travellerIds.length || intent.travellerIds.some(id => !passports.some(document => document.travellerId === id))) throw new ApiException('VALIDATION_ERROR', 'Provide travel document details for every selected traveler before reserving.', 400);
    if (passports.some(document=>!/^[A-Z]{2}$/.test(document.residenceCountryCode??''))) throw new ApiException('VALIDATION_ERROR','Choose the country of residence for every traveler before reserving.',400);
    if (new Set(passports.map(document => document.travellerId)).size !== passports.length || passports.some(document => !intent.travellerIds.includes(document.travellerId))) throw new ApiException('VALIDATION_ERROR', 'Provide at most one travel document for each selected traveler.', 400);
    const people = await this.db.select({person: travellers, passengerType: flightBookingIntentTravellers.passengerType}).from(flightBookingIntentTravellers)
      .innerJoin(customerTravellers, and(eq(customerTravellers.travellerId, flightBookingIntentTravellers.travellerId), eq(customerTravellers.customerId, customerId)))
      .innerJoin(travellers, and(eq(travellers.id, flightBookingIntentTravellers.travellerId), isNull(travellers.archivedAt)))
      .where(and(eq(flightBookingIntentTravellers.bookingIntentId, intentId), inArray(flightBookingIntentTravellers.travellerId, intent.travellerIds)));
    if (people.length !== intent.travellerIds.length || people.length !== intent.searchRequest.adults + intent.searchRequest.children + intent.searchRequest.infants || people.some(({person}) => !person.dateOfBirth)) throw new ApiException('VALIDATION_ERROR', 'Complete each traveler’s date of birth before reserving.', 400);
    const passengers = intent.travellerIds.map(id => {
      const person = people.find(value => value.person.id === id)!.person;
      const date = intent.searchRequest!.departureDate;
      const legs = intent.selectedOffer.multiCityLegs ?? [intent.selectedOffer.outbound, ...(intent.selectedOffer.inbound ? [intent.selectedOffer.inbound] : [])];
      let passengerCode: ReturnType<typeof passengerCodeAt>;
      try {
        passengerCode = passengerCodeAt(person.dateOfBirth!, date);
        const lastDate = legs.at(-1)!.segments.at(-1)!.arrivalAt.slice(0, 10);
        if (passengerCode !== passengerCodeAt(person.dateOfBirth!, lastDate)) throw new Error('Passenger age category changes');
      } catch { throw new ApiException('VALIDATION_ERROR', 'Check traveler birth dates. A traveler changing age category during the trip needs assistance.', 400); }
      const expected = people.find(value => value.person.id === id)!.passengerType;
      if (passengerCode !== (expected === 'CHD' ? 'CNN' : expected)) throw new ApiException('VALIDATION_ERROR', 'A traveler’s age no longer matches the saved passenger type. Choose the flight again.', 400);
      const flightCount = (intent.selectedOffer.multiCityLegs ?? [intent.selectedOffer.outbound, ...(intent.selectedOffer.inbound ? [intent.selectedOffer.inbound] : [])]).reduce((count, leg) => count + leg.segments.length, 0);
      const specialServices = bookingSpecialServices(intent.serviceRequests?.find(request => request.travellerId === id), flightCount);
      const passport = passports.find(document => document.travellerId === id);
      if (passport && (!['MALE','FEMALE','X'].includes(person.gender ?? '') || passport.expiryDate <= legs.at(-1)!.segments.at(-1)!.arrivalAt.slice(0, 10))) throw new ApiException('VALIDATION_ERROR', 'Check traveler gender and passport validity through the last flight. Destination entry rules may require additional validity.', 400);
      const identityDocuments = passport ? [{ documentType: passport.documentType ?? 'PASSPORT', documentNumber: passport.documentNumber, expiryDate: passport.expiryDate,
        issuingCountryCode: passport.issuingCountryCode, residenceCountryCode:passport.residenceCountryCode!, ...(person.nationalityCountryCode ? { citizenshipCountryCode: person.nationalityCountryCode } : {}),
        givenName: [person.legalFirstName, person.legalMiddleName].filter(Boolean).join(' '), surname: person.legalLastName, birthDate: person.dateOfBirth!, gender: person.gender! }] : [];
      return {givenName: [person.legalFirstName, person.legalMiddleName].filter(Boolean).join(' '), surname: person.legalLastName, birthDate: person.dateOfBirth!, passengerCode, gender: person.gender,
        ...(specialServices.length ? { specialServices } : {}), ...(identityDocuments.length ? { identityDocuments } : {})};
    });
    let body: ReturnType<typeof buildSabreCreateBooking> | ReturnType<typeof buildSabreCreateNdcBooking>;
    const adults = passengers.flatMap((person, index) => person.passengerCode === 'ADT' ? [index] : []);
    const infants = passengers.flatMap((person, index) => person.passengerCode === 'INF' ? [index] : []);
    if (adults.length !== intent.searchRequest.adults || passengers.filter(person => person.passengerCode === 'CNN').length !== intent.searchRequest.children || infants.length !== intent.searchRequest.infants || infants.length > adults.length) throw new ApiException('VALIDATION_ERROR', 'Passenger ages must match the adults, children and infants in your search.', 400);
    try {
      const associatedPassengers = passengers.map((person, index) => { const adultPosition = adults.indexOf(index); return adultPosition >= 0 && infants[adultPosition] !== undefined ? { ...person, infantTravelerIndex: infants[adultPosition]! + 1 } : person; });
      let checked: { currency: string; totalAmount: string };
      if (intent.selectedOffer.ndcContext) {
        if (passengers.some(person => !['MALE','FEMALE','X'].includes(person.gender ?? ''))) throw new ApiException('VALIDATION_ERROR', 'Complete each traveler’s gender before reserving this NDC fare.', 400);
        const priced = readPricedNdcOffer(await this.sabre.priceNdcOffer(intent.selectedOffer.ndcContext.offerItemIds ?? []), intent.selectedOffer);
        checked = { currency: priced.currency, totalAmount: priced.currentTotalAmount };
        body = buildSabreCreateNdcBooking(priced.ndcContext, associatedPassengers, { email: input.contactEmail, phone: input.contactPhone }, agency);
      } else {
        body = buildSabreCreateBooking(intent.selectedOffer, associatedPassengers, {email: input.contactEmail, phone: input.contactPhone}, agency,
          {currency: intent.currency, totalAmount: intent.validatedTotalAmount});
        checked = selectCheckedAtpcoOffer(await this.sabre.flightCheck(intent.selectedOffer, passengers.map(person => person.passengerCode)), intent.selectedOffer, this.config.SABRE_PCC!);
      }
      if (checked.currency !== intent.currency || !amountEquals(checked.totalAmount, intent.validatedTotalAmount)) throw new ApiException('CONFLICT', 'The reservation fare differs from the accepted fare. No booking was sent. Please check the fare again.', 409);
    } catch (error) { if (error instanceof ApiException) throw error; throw new ApiException('DEPENDENCY_UNAVAILABLE', 'The airline reservation fare could not be confirmed. No booking was sent.', 503); }
    const repository = new BookingReservationRepository(this.connection);
    let id: string;
    try { id = await repository.claim(customerId, intentId, {currency: intent.currency, amount: intent.validatedTotalAmount}, passengers.map(person => `${person.givenName} ${person.surname}`),input.contactEmail); }
    catch (error) {
      if (error instanceof BookingReservationMissingError) throw missing();
      if (error instanceof BookingReservationConflictError) {
        this.telemetry.increment('booking_duplicate_prevented_total');
        const [saved] = await this.db.select({id: flightBookings.id}).from(flightBookings).where(and(eq(flightBookings.customerId, customerId), eq(flightBookings.bookingIntentId, intentId))).limit(1);
        if (saved) return this.detail(customerId, saved.id);
        throw new ApiException('CONFLICT', 'The fare changed or expired before reservation. Check it again.', 409);
      }
      throw error;
    }
    this.telemetry.increment('booking_create_attempt_total');
    let created: {confirmationId: string; sabreBookingId: string};
    try { created = await this.sabre.createBooking(body); }
    catch (error) {
      if (error instanceof SabreBookingRejectedError) {
        await repository.rejected(id, error.failureCode, {httpStatus:error.httpStatus,errors:error.diagnostics,supplierRequestId:error.supplierRequestId});
        this.telemetry.increment('booking_create_failure_total');
      } else {
        // An unexpected adapter error does not prove the airline rejected the
        // reservation. Preserve uncertainty and the original one-attempt claim.
        await repository.unknown(id, error instanceof SabreBookingUnknownError ? error : undefined);
        this.telemetry.increment('booking_unknown_total');
      }
      return this.detail(customerId, id);
    }
    // Persistence errors must not turn a confirmed provider reservation into a rejected attempt.
    await repository.created(id, created.confirmationId, created.sabreBookingId);
    this.telemetry.increment('booking_create_success_total');
    return this.detail(customerId, id);
  }
  async refresh(customerId: string, id: string) {
    if (!this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Sabre booking lookup is unavailable.', 503);
    const [booking] = await this.db.select().from(flightBookings).where(and(eq(flightBookings.customerId, customerId), eq(flightBookings.id, id))).limit(1);
    if (!booking) throw missing();
    if (!booking.pnrLocator) throw new ApiException('CONFLICT', 'This attempt has no confirmed PNR. Contact Flyseri for reconciliation.', 409);
    this.telemetry.increment('booking_get_total');
    let result: Awaited<ReturnType<SabreBookingManagementClient['getBookingView']>>;
    try { result = await this.sabre.getBookingView(booking.pnrLocator); }
    catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Sabre could not verify the booking right now.', 503); }
    if (booking.sabreBookingId && booking.sabreBookingId !== result.bookingId) throw new ApiException('CONFLICT', 'The airline booking identifier changed. Contact Flyseri.', 409);
    await this.db.transaction(async tx => {
      const [saved] = await tx.update(flightBookings).set({sabreBookingId: result.bookingId, lastSabreRefreshAt: new Date(), updatedAt: new Date()})
        .where(and(eq(flightBookings.id, id), eq(flightBookings.customerId, customerId), eq(flightBookings.pnrLocator, booking.pnrLocator!))).returning({id: flightBookings.id});
      if (!saved) throw new ApiException('CONFLICT', 'The booking changed during refresh.', 409);
      const evidence = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flight_bookings' AND column_name = 'provider_view_snapshot') AS ready`);
      if (evidence.rows[0]?.ready === true) await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot = ${JSON.stringify(result.view)}::jsonb WHERE id = ${id}::uuid AND customer_id = ${customerId}::uuid`);
      await tx.insert(auditEvents).values({actorCustomerId: customerId, tripId: booking.tripId, event: 'flight.booking.refreshed'});
    });
    return {...await this.detail(customerId, id), providerView: result.view};
  }
  private async checkoutFareEvidence(customerId: string, booking: FlightBooking) {
    if (!this.sabre) throw unavailable();
    if (!booking.pnr) throw new ApiException('CONFLICT', 'This reservation needs review before payment.', 409);
    // The shopping fare can still match while the stored PNR quote is invalid.
    // Validate the actual ticketing quote before offering customer payment.
    let current: Awaited<ReturnType<SabreBookingManagementClient['getBookingView']>>;
    let storedQuote: Awaited<ReturnType<SabreBookingManagementClient['getTicketingContext']>> | undefined;
    try {
      if (booking.selectedOffer.ndcContext) current = await this.sabre.getBookingView(booking.pnr);
      else { storedQuote = await this.sabre.getTicketingContext(booking.pnr); current = storedQuote; }
    } catch (error) {
      if (error instanceof TicketingValidationError) throw new ApiException('CONFLICT', 'The stored airline fare needs review before payment. Contact Flyseri about this reservation; please do not book it again.', 409);
      throw error;
    }
    const [record] = await this.db.select().from(flightBookings).where(and(eq(flightBookings.id,booking.id),eq(flightBookings.customerId,customerId))).limit(1);
    if (booking.passengerNamesSource !== 'BOOKED_SNAPSHOT' || !record || current.bookingId !== (record.sabreBookingId ?? booking.pnr) || !current.view.cancellationCheckComplete || current.view.tickets.length || current.view.travellers.length !== booking.passengerNames.length || current.view.travellers.some((person,index)=>[person.givenName,person.surname].join(' ').trim().replace(/\s+/g,' ').toUpperCase() !== booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase()) || !matchesConfirmedItinerary(current.view, booking.selectedOffer)) throw new ApiException('CONFLICT','Your reservation needs airline verification before payment. Contact Flyseri.',409);
    const [intent] = await this.db.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id,booking.bookingIntentId),eq(flightBookingIntents.customerId,customerId))).limit(1);
    if (!intent?.validatedTotalAmount) throw missing();
    if (storedQuote && (storedQuote.selection.currency !== intent.currency || !amountEquals(storedQuote.selection.totalAmount, intent.validatedTotalAmount))) throw new ApiException('CONFLICT', 'The stored airline fare differs from the price you accepted. Contact Flyseri to review this reservation before payment.', 409);
    const offer=booking.selectedOffer;
    // A held ATPCO seat is verified against its active stored PQ, not the
    // availability for selling another seat in the same booking class.
    const checked = offer.ndcContext ? await (async()=>{const priced=readPricedNdcOffer(await this.sabre!.priceNdcOffer(offer.ndcContext!.offerItemIds ?? []),offer);return {totalAmount:priced.currentTotalAmount,currency:priced.currency,validUntil:priced.expiresAt};})()
      : {totalAmount:storedQuote!.selection.totalAmount,currency:storedQuote!.selection.currency,validUntil:undefined};
    if (checked.currency!==intent.currency || !amountEquals(checked.totalAmount,intent.validatedTotalAmount)) throw new ApiException('CONFLICT','The airline fare changed. Contact Flyseri to review your existing reservation before paying.',409);
    const expiresAt=new Date(Math.min(Date.now()+this.config.FLIGHT_VALIDATION_TTL_SECONDS*1000,checked.validUntil ? Date.parse(checked.validUntil) : Infinity));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt<=new Date()) throw new ApiException('CONFLICT','This airline fare is no longer available for payment.',409);
    return {intent,expiresAt};
  }
  /** An existing order cannot bypass the supplier checks before a Stripe checkout starts or resumes. */
  async verifyPaymentReady(customerId: string, intentId: string, orderId: string) {
    const booking = await this.forIntent(customerId,intentId);
    if (!booking || booking.order?.id !== orderId || !['PNR_CREATED','AWAITING_PAYMENT','PAYMENT_PENDING'].includes(booking.status))
      throw new ApiException('CONFLICT','This reservation needs review before payment.',409);
    const {intent,expiresAt}=await this.checkoutFareEvidence(customerId,booking);
    const reviewedSnapshot=intent.searchRequestSnapshot as AncillarySnapshot,reviewedExtras=reviewedSnapshot.checkoutAncillaryPurchase;
    if(reviewedExtras&&!['SKIPPED','UNAVAILABLE'].includes(reviewedExtras.status)){
      if(reviewedExtras.status!=='CONFIRMED'||reviewedExtras.requestKey!==requestKey(reviewedSnapshot.checkoutAncillaryRequests??[]))throw new ApiException('CONFLICT','The selected extras need reconciliation before payment.',409);
      const current=await this.sabre!.getPurchaseBooking(booking.pnr!);
      if(current.bookingId!==reviewedExtras.bookingId||current.travelers.length!==booking.passengerNames.length||current.travelers.some((person,index)=>[person.givenName,person.surname].join(' ').trim().replace(/\s+/g,' ').toUpperCase()!==booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase()))throw new ApiException('CONFLICT','The extra-service reservation or travelers changed before payment.',409);
      let evidence:ReturnType<typeof confirmedAncillaryItems>;
      try{evidence=confirmedAncillaryItems(current,reviewedExtras.plans,reviewedSnapshot.checkoutAncillaryRequests??[]);}catch{throw new ApiException('CONFLICT','The attached airline extras could not be verified before payment.',409);}
      if(evidence.length!==reviewedExtras.items.length||reviewedExtras.items.some(item=>!evidence.some(actual=>actual.requestId===item.requestId&&item.providerAncillaryIds.includes(actual.itemId)&&actual.currency===item.airlineCurrency&&cents(actual.amount)===cents(item.airlineAmount))))throw new ApiException('CONFLICT','The airline extra price or association changed. Review the existing reservation before payment.',409);
    }
    // Carry the fresh, unchanged-fare evidence into the existing order. Otherwise
    // reservePayment still rejects the old shopping TTL after Sabre just passed.
    // This renews our fare-check window, never the airline's ticketing deadline.
    await this.db.transaction(async tx=>{
      const [lockedIntent]=await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id,intentId),eq(flightBookingIntents.customerId,customerId))).for('update');
      const [order]=await tx.select().from(orders).where(and(eq(orders.id,orderId),eq(orders.customerId,customerId))).for('update');
      const [payment]=await tx.select().from(payments).where(eq(payments.orderId,orderId)).for('update');
      const [saved]=await tx.select().from(flightBookings).where(eq(flightBookings.id,booking.id)).for('update');
      if(!lockedIntent || !order || order.bookingIntentId!==intentId || order.flightServicingCaseId || !['PENDING_PAYMENT','PAYMENT_FAILED','PAYMENT_PROCESSING'].includes(order.status) || order.paidAt ||
        !saved || !['PNR_CREATED','AWAITING_PAYMENT','PAYMENT_PENDING'].includes(saved.status) || saved.pnrLocator!==booking.pnr ||
        lockedIntent.currency!==intent.currency || lockedIntent.validatedTotalAmount!==intent.validatedTotalAmount ||
        payment && (!['FAILED','PENDING'].includes(payment.status) || payment.currency!==order.currency || payment.amount!==order.totalAmount))
        throw new ApiException('CONFLICT','Checkout changed. Check payment and reservation status before continuing.',409);
      const extras=(lockedIntent.searchRequestSnapshot as AncillarySnapshot).checkoutAncillaryPurchase;
      // An existing extras order also needs supplier service-price verification;
      // do not silently extend that snapshot with airfare-only evidence.
      if(extras && !['SKIPPED','UNAVAILABLE'].includes(extras.status)) {
        const retail=readRetailPricing((lockedIntent.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing,intent.validatedTotalAmount!,intent.currency);
        if(extras.status!=='CONFIRMED'||JSON.stringify(extras)!==JSON.stringify(reviewedExtras)||extras.currency!==order.currency||order.currency!==intent.currency||cents(extras.extrasAmount)!==extras.items.reduce((sum,item)=>sum+cents(item.checkoutAmount),0n)||cents(order.subtotalAmount)!==cents(retail?.sellingTotal??intent.validatedTotalAmount!)+cents(extras.extrasAmount))throw new ApiException('CONFLICT','The frozen extra-service order changed. Review it before payment.',409);
        const verifiedUntil=new Date(Math.min(expiresAt.getTime(),Date.now()+120000));
        await tx.update(orders).set({expiresAt:verifiedUntil,updatedAt:new Date()}).where(eq(orders.id,orderId));
        await tx.update(flightBookingIntents).set({expiresAt:verifiedUntil,validatedAt:new Date(),searchRequestSnapshot:{...lockedIntent.searchRequestSnapshot as AncillarySnapshot,checkoutAncillaryPurchase:{...extras,expiresAt:verifiedUntil.toISOString()}},updatedAt:new Date()}).where(eq(flightBookingIntents.id,intentId));
        await tx.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.payment.fare_and_extras_revalidated'});
        return;
      }
      const retail=readRetailPricing((lockedIntent.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing,intent.validatedTotalAmount!,intent.currency);
      if(order.currency!==intent.currency || !amountEquals(order.subtotalAmount,retail?.sellingTotal??intent.validatedTotalAmount!))
        throw new ApiException('CONFLICT','The order no longer matches the verified airline fare. Contact Flyseri before payment.',409);
      await tx.update(orders).set({expiresAt,updatedAt:new Date()}).where(eq(orders.id,orderId));
      await tx.update(flightBookingIntents).set({expiresAt,validatedAt:new Date(),updatedAt:new Date()}).where(eq(flightBookingIntents.id,intentId));
      await tx.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.payment.fare_revalidated'});
    });
    return booking;
  }
  /** Refresh an existing reservation's checkout window without creating another PNR. */
  async refreshCheckout(customerId: string, id: string) {
    if (!this.sabre) throw unavailable();
    const booking = await this.detail(customerId, id);
    if (booking.order) return booking;
    if (!booking.pnr || !['PNR_CREATED', 'AWAITING_PAYMENT'].includes(booking.status)) throw new ApiException('CONFLICT', 'This reservation needs review before payment.', 409);
    const {intent,expiresAt}=await this.checkoutFareEvidence(customerId,booking);
    await this.db.transaction(async tx=>{
      const [locked]=await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id,intent.id),eq(flightBookingIntents.customerId,customerId))).for('update');
      const [order]=await tx.select({id:orders.id}).from(orders).where(eq(orders.bookingIntentId,intent.id)).limit(1);
      const [saved]=await tx.select().from(flightBookings).where(and(eq(flightBookings.id,id),eq(flightBookings.customerId,customerId))).for('update');
      if (order || !saved || !['PNR_CREATED','AWAITING_PAYMENT'].includes(saved.status) || saved.pnrLocator!==booking.pnr || locked?.validatedTotalAmount!==intent.validatedTotalAmount || locked.currency!==intent.currency) throw new ApiException('CONFLICT','Checkout changed. Refresh to continue.',409);
      await tx.update(flightBookingIntents).set({expiresAt,validatedAt:new Date(),status:'READY_FOR_PAYMENT',updatedAt:new Date()}).where(eq(flightBookingIntents.id,intent.id));
      await tx.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.checkout.refreshed'});
    });
    return this.detail(customerId,id);
  }
  async cancelUnticketed(customerId: string, id: string, confirmedPnr: string) {
    if (!this.sabre || !this.capabilities().reservationAvailable) throw unavailable();
    const [owned] = await this.db.select({ intentId: flightBookings.bookingIntentId }).from(flightBookings).where(and(eq(flightBookings.id, id), eq(flightBookings.customerId, customerId))).limit(1);
    if (!owned) throw missing();
    // Claim before provider calls. Any uncertain cancellation remains locked for staff reconciliation.
    const booking = await this.db.transaction(async tx => {
      const [intent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, owned.intentId), eq(flightBookingIntents.customerId, customerId))).for('update');
      const purchase = (intent?.searchRequestSnapshot as AncillarySnapshot | undefined)?.checkoutAncillaryPurchase;
      if (purchase && !['PREPARED', 'UNAVAILABLE', 'SKIPPED'].includes(purchase.status)) throw new ApiException('CONFLICT', 'This reservation has attached or pending airline extras. Contact Flyseri to review service and cancellation conditions.', 409);
      const [row] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id,id), eq(flightBookings.customerId,customerId))).for('update');
      if (!row) throw missing();
      if (!row.pnrLocator || confirmedPnr !== row.pnrLocator || !['PNR_CREATED','AWAITING_PAYMENT'].includes(row.status)) throw new ApiException('CONFLICT','Review the current PNR before cancelling.',409);
      const [order] = await tx.select({id:orders.id}).from(orders).where(eq(orders.bookingIntentId,row.bookingIntentId)).limit(1);
      if (order) throw new ApiException('CONFLICT','This reservation has an order. Contact Flyseri to review payment and cancellation conditions.',409);
      await tx.update(flightBookings).set({status:'MANUAL_REVIEW_REQUIRED', updatedAt:new Date()}).where(eq(flightBookings.id,id));
      await tx.insert(auditEvents).values({actorCustomerId:customerId, tripId:row.tripId, event:'flight.booking.cancellation.claimed'});
      return row;
    });
    let before: Awaited<ReturnType<SabreBookingManagementClient['getBookingView']>>;
    try { before = await this.sabre.getBookingView(booking.pnrLocator!); }
    catch {
      await this.db.update(flightBookings).set({status:booking.status, updatedAt:new Date()}).where(and(eq(flightBookings.id,id), eq(flightBookings.status,'MANUAL_REVIEW_REQUIRED')));
      throw new ApiException('DEPENDENCY_UNAVAILABLE','The airline details could not be verified. No cancellation was sent. Try refreshing the booking again.',503);
    }
    const matches = !booking.sabreBookingId || booking.sabreBookingId === before.bookingId;
    if (!matches || !before.view.cancellationCheckComplete || before.view.tickets.length || !before.view.flights.length) {
      // A rejected preflight sent no supplier mutation; restore the reservation state.
      await this.db.update(flightBookings).set({status:booking.status, updatedAt:new Date()}).where(and(eq(flightBookings.id,id), eq(flightBookings.status,'MANUAL_REVIEW_REQUIRED')));
      throw new ApiException('CONFLICT','Online cancellation requires a verified, unticketed flight-only PNR without an order. Contact Flyseri for this reservation.',409);
    }
    try {
      await this.sabre.cancelUnticketedBooking(booking.pnrLocator!);
      const after = await this.sabre.getBookingView(booking.pnrLocator!);
      if (after.bookingId !== before.bookingId || !after.view.cancellationCheckComplete || after.view.flights.length || after.view.tickets.length) throw new Error('Cancellation could not be verified');
      await this.db.transaction(async tx => {
        const [saved] = await tx.update(flightBookings).set({status:'CANCELLED', lastSabreRefreshAt:new Date(), updatedAt:new Date()})
          .where(and(eq(flightBookings.id,id), eq(flightBookings.customerId,customerId), eq(flightBookings.status,'MANUAL_REVIEW_REQUIRED'))).returning({id:flightBookings.id});
        if (!saved) throw new Error('Booking state changed');
        const evidence = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flight_bookings' AND column_name = 'provider_view_snapshot') AS ready`);
        if (evidence.rows[0]?.ready === true) await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot = ${JSON.stringify(after.view)}::jsonb WHERE id = ${id}::uuid AND customer_id = ${customerId}::uuid`);
        await tx.insert(auditEvents).values({actorCustomerId:customerId, tripId:booking.tripId, event:'flight.booking.cancelled'});
      });
      return {...await this.detail(customerId,id), providerView:after.view};
    } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE','Cancellation is not confirmed. Contact Flyseri to reconcile this PNR before taking further action.',503); }
  }
}
