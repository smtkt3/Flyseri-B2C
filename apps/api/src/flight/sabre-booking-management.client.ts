import { readPurchaseBooking, type PurchaseBooking } from './ancillary-purchase.contract.js';
import {createHash} from 'node:crypto';
import {verifySabreEmptyItinerary} from './sabre-empty-itinerary-verification.js';
import {readTicketDocuments,flightTicketPayload} from './ticketing-reconciliation.contract.js';
import {buildEnhancedAirTicket,buildEnhancedReissue,buildEnhancedAirExtras,enhancedTicketDiagnostics,readEnhancedAirTicket,readEnhancedAirExtras} from './enhanced-air-ticket.contract.js';
import type {TicketDispatchEvidence} from './ticketing-diagnostics.contract.js';
import type { FlightOffer, FlightBookingProviderView } from '@flyseri/types';
import type { AppConfig } from '@flyseri/config';
import type { SabreAuthService } from './sabre-auth.service.js';
import type {CertServicingSessionFactory} from './sabre-cert-session.js';
import { buildSabreAncillaryRequest, type SabreAncillaryRequest } from './sabre-ancillaries.contract.js';
import type { BookingSpecialService } from './flight-special-services.js';
import type { BookingPassengerCode } from './flight-passenger-types.js';
import { servicingContext, ticketEligibility, type ServicingContext } from './flight-servicing.contract.js';
import { readExchangeSearch, type ExchangeJourney, type ExchangeOffer } from './flight-exchange-shopping.contract.js';
import { exchangeVerificationPayload, readExchangeContext, exchangeBookingRequest, readExchangePqrs, type ExchangeContext, type ExchangePqr, type ExchangePricePolicy } from './flight-exchange-execution.contract.js';
import type { AirlineEligibility } from './flight-servicing.contract.js';
import { readContactContext, contactModificationRequest, type ContactContext, type ContactPlan } from './flight-contact-modification.contract.js';
import { currencyPolicy, pricingCurrencyQualifiers, validateTicketingPcc, validateStoredTicketingCurrency, TicketingValidationError, sanitizedTicketingErrors, type SanitizedTicketingError } from './ticketing-currency.contract.js';
import { ticketingExecutionOptions, type TicketingExecutionOptions } from './ticketing-execution.contract.js';

/** Fields copied from Booking Management 2026.08 / ATPCO / One way - 1xADT. */
export interface BookingAgency {
  address: { name: string; street: string; city: string; stateProvince: string; postalCode: string; countryCode: string; freeText: string };
  agencyCustomerNumber?: string;
  ticketingPolicy: string;
}
export interface BookingIdentityDocument { documentType: 'PASSPORT'|'NATIONAL_ID_CARD'|'VISA'|'ALIEN_RESIDENT'|'BORDER_CROSSING_CARD'|'REFUGEE_REENTRY_PERMIT'; documentNumber: string; expiryDate: string; issuingCountryCode: string; residenceCountryCode?: string; citizenshipCountryCode?: string; givenName: string; surname: string; birthDate: string; gender: string }
export interface BookingPassenger { givenName: string; surname: string; birthDate: string; passengerCode: BookingPassengerCode; infantTravelerIndex?: number; specialServices?: BookingSpecialService[]; identityDocuments?: BookingIdentityDocument[] }
export interface BookingContact { email: string; phone: string }
export type SabreTicketingProfile = { ticketCountryCode?: string; hardcopyPrinterAddress: string; ndcAirlineCodes?: string[] } & (
  { formOfPayment: 'CASH' } |
  { formOfPayment: 'INVOICE'; invoiceDescription: string } |
  { formOfPayment: 'PAYMENTCARD'; cardTypeCode: string; cardNumber: string; cardSecurityCode: string; expiryDate: string; manualApprovalCode?: string; cardHolder?: { givenName: string; surname: string; address: BillingAddress }; authentications?: { channelCode: 'MO' }[] }
);
export type BillingAddress = Omit<BookingAgency['address'], 'freeText'>;

const segmentsOf = (offer: FlightOffer) => (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])])
  .flatMap((leg) => leg.segments);
const flightNumber = (value: string): number => {
  if (!/^\d{1,4}$/.test(value)) throw new Error('Sabre flight number is missing');
  return Number(value);
};
const datePart = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) throw new Error('Sabre flight time is missing');
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
};

/** Customer profiles use X; Sabre GenderEnum uses UNDEFINED. */
const sabreGender = (gender: string) => {
  if (gender === 'X') return 'UNDEFINED';
  if (['MALE', 'FEMALE', 'UNDEFINED', 'UNDISCLOSED', 'INFANT_MALE', 'INFANT_FEMALE'].includes(gender)) return gender;
  throw new Error('Unsupported traveler gender');
};
const sabreDocuments = (documents: BookingIdentityDocument[]) => documents.map(document => ({ ...document, gender: sabreGender(document.gender) }));

/** The collection's FlightCheck shape, built from server-selected shopping segments. */
export function buildBookingFlightCheck(offer: FlightOffer, adultCount: number | BookingPassengerCode[]) {
  if (typeof adultCount === 'number' && (!Number.isInteger(adultCount) || adultCount < 1 || adultCount > 9)) throw new Error('Passenger count is invalid');
  const passengerCodes: BookingPassengerCode[] = Array.isArray(adultCount) ? adultCount : Array.from({ length: adultCount }, () => 'ADT');
  if (!passengerCodes.length || passengerCodes.length > 9 || passengerCodes.some(code => !['ADT','CNN','INF'].includes(code))) throw new Error('Passenger types are required');
  return {
    journeys: (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).map((leg) => ({
      flights: leg.segments.map((segment) => {
        // BFM currently stores the marketing flight number only; do not invent a codeshare operating number.
        if (segment.operatingCarrier && segment.operatingCarrier !== segment.marketingCarrier) {
          throw new Error('Operating flight number is unavailable for FlightCheck');
        }
        return {
          departureAirportCode: segment.origin,
          departureDate: datePart(segment.departureAt).date,
          departureTime: datePart(segment.departureAt).time,
          arrivalAirportCode: segment.destination,
          arrivalDate: datePart(segment.arrivalAt).date,
          arrivalTime: datePart(segment.arrivalAt).time,
          operatingAirlineCode: segment.operatingCarrier ?? segment.marketingCarrier,
          operatingFlightNumber: flightNumber(segment.flightNumber),
          marketingAirlineCode: segment.marketingCarrier,
          marketingFlightNumber: flightNumber(segment.flightNumber),
        };
      }),
    })),
    travelers: passengerCodes.map(passengerTypeCode => ({ passengerTypeCode })),
  };
}

/** Match the actual checked segment classes. CERT can label a higher class "Matched" and the
 *  requested class "Same cabin", so the validation label alone cannot select the fare. */
export function selectCheckedAtpcoOffer(response: unknown, selected: FlightOffer, pcc: string, now = Date.now()) {
  const data = response as { offers?: unknown } | null;
  if (!Array.isArray(data?.offers)) throw new Error('FlightCheck returned no offers');
  const selectedClasses = segmentsOf(selected).map((segment) => segment.bookingClass);
  if (!selectedClasses.length || selectedClasses.some((code) => !code)) throw new Error('Selected booking class is unavailable');
  const candidates = data.offers.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
    .filter((value) => {
      const source = value.source as { distributionModel?: unknown } | undefined;
      const pccs = value.applicableToPseudoCityCodes;
      const items = value.items as { fares?: { fareComponents?: { segmentDetails?: { bookingClassCode?: string }[] }[] }[] }[] | undefined;
      const classes = items?.flatMap(item => item.fares?.flatMap(fare => fare.fareComponents?.flatMap(component => component.segmentDetails?.map(segment => segment.bookingClassCode) ?? []) ?? []) ?? []) ?? [];
      return source?.distributionModel === 'ATPCO' && Array.isArray(pccs) && pccs.includes(pcc) &&
        typeof value.validUntil === 'string' && Date.parse(value.validUntil) > now &&
        classes.length >= selectedClasses.length && classes.length % selectedClasses.length === 0 && classes.every((code, index) => code === selectedClasses[index % selectedClasses.length]);
    });
  if (candidates.length !== 1) throw new Error('FlightCheck could not identify one matching ATPCO fare');
  const checked = candidates[0]!;
  const price = checked.totalPrice as { amount?: unknown; currencyCode?: unknown } | undefined;
  if (typeof checked.id !== 'string' || !checked.id || typeof price?.amount !== 'string' ||
    !/^\d+(\.\d{1,2})?$/.test(price.amount) || typeof price.currencyCode !== 'string' ||
    !/^[A-Z]{3}$/.test(price.currencyCode)) throw new Error('FlightCheck price is unavailable');
  return { offerId: checked.id, totalAmount: price.amount, currency: price.currencyCode,
    validUntil: checked.validUntil as string };
}

/** The basic ATPCO CreateBooking variant. No ticket issuance or card charge is requested. */
export function buildSabreCreateBooking(offer: FlightOffer, passengers: BookingPassenger[],
  contact: BookingContact, agency: BookingAgency,
  acceptedFare: { currency: string; totalAmount: string } = { currency: offer.currency, totalAmount: offer.totalAmount }) {
  if (!passengers.length || !segmentsOf(offer).length || !agency.address.name || !agency.ticketingPolicy ||
      !contact.email || !contact.phone) throw new Error('Incomplete CreateBooking inputs');
  if (!/^[A-Z]{3}$/.test(acceptedFare.currency) || !/^\d+(\.\d{1,2})?$/.test(acceptedFare.totalAmount)) throw new Error('Accepted reservation fare is invalid');
  const flights = segmentsOf(offer).map((segment) => {
    if (!segment.bookingClass) throw new Error('Sabre booking class is missing');
    const departure = datePart(segment.departureAt);
    return { flightNumber: flightNumber(segment.flightNumber), airlineCode: segment.marketingCarrier,
      fromAirportCode: segment.origin, toAirportCode: segment.destination,
      departureDate: departure.date, departureTime: departure.time,
      bookingClass: segment.bookingClass, flightStatusCode: 'NN' as const };
  });
  return { agency, travelers: passengers.map(({ givenName, surname, birthDate, passengerCode, infantTravelerIndex, specialServices, identityDocuments }) => ({
    givenName, surname, birthDate, passengerCode, ...(infantTravelerIndex ? { infantTravelerIndex } : {}), ...(specialServices?.length ? { specialServices } : {}), ...(identityDocuments?.length ? { identityDocuments: sabreDocuments(identityDocuments) } : {}) })),
    contactInfo: { emails: [contact.email], phones: [contact.phone] },
    // This operation only reserves and prices flights. Keep billing information in
    // the application until a separate payment operation needs it; sending a
    // payment object here invokes optional supplier payment/address processing.
    flightDetails: { flights, flightPricing: [{
      qualifiers: { currencyPricing: acceptedFare.currency } as {currencyPricing?:string},
      priceComparisons: [
        { desiredAmount: acceptedFare.totalAmount, comparisonType: 'INCREASE_BY_AMOUNT' as const, amount: '0.00' },
        { desiredAmount: acceptedFare.totalAmount, comparisonType: 'DECREASE_BY_AMOUNT' as const, amount: '0.00' },
      ],
    }] } };
}

/** NDC CreateBooking variant in the supplied agency collection. No fulfillment
 * payment or ticket issuance is requested. Supplier passenger IDs are assigned
 * by passenger type, never by a browser-provided passenger reference.
 */
export function buildSabreCreateNdcBooking(context: NonNullable<FlightOffer['ndcContext']>,
  passengers: (BookingPassenger & { gender: string | null })[], contact: BookingContact, agency: BookingAgency) {
  if (!Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now() || !context.offerItemIds?.length || passengers.length !== context.passengers.length) throw new Error('Priced NDC context is unavailable');
  const remaining = [...context.passengers];
  const travelers = passengers.map(person => {
    if (!person.givenName.trim() || !person.surname.trim() || !person.birthDate || !['MALE','FEMALE','X'].includes(person.gender ?? '')) throw new Error('Complete traveler gender and birth date for NDC booking');
    const index = remaining.findIndex(entry => entry.passengerTypeCode === person.passengerCode);
    if (index < 0) throw new Error('NDC passenger types do not match');
    const [entry] = remaining.splice(index, 1);
    return { id: entry!.passengerId, givenName: person.givenName, surname: person.surname, birthDate: person.birthDate, passengerCode: person.passengerCode,
      gender: sabreGender(person.gender!),
      ...(person.infantTravelerIndex ? { infantTravelerIndex: person.infantTravelerIndex } : {}),
      ...(person.specialServices?.length ? { specialServices: person.specialServices } : {}),
      identityDocuments: person.identityDocuments?.length ? sabreDocuments(person.identityDocuments) : [{ documentType: 'SECURE_FLIGHT_PASSENGER_DATA', givenName: person.givenName, surname: person.surname, birthDate: person.birthDate, gender: sabreGender(person.gender!) }] };
  });
  return { flightOffer: { offerId: context.offerId, selectedOfferItems: [...context.offerItemIds] }, travelers,
    contactInfo: { emails: [contact.email], phones: [contact.phone] }, agency };
}

export function readSabreCreateBooking(value: unknown): { confirmationId: string; sabreBookingId: string } {
  const data = value as { confirmationId?: unknown; booking?: { bookingId?: unknown }; errors?: unknown } | null;
  if (data?.errors && (!Array.isArray(data.errors) || data.errors.length)) throw new Error('Sabre returned creation errors');
  if (!data || typeof data.confirmationId !== 'string' || !/^[A-Z0-9]{6,16}$/i.test(data.confirmationId) ||
      typeof data.booking?.bookingId !== 'string' || !data.booking.bookingId.trim()) throw new Error('Unconfirmed Sabre CreateBooking response');
  return { confirmationId: data.confirmationId, sabreBookingId: data.booking.bookingId };
}

export function buildSabreGetBooking(confirmationId: string) {
  if (!/^[A-Z0-9]{6,16}$/i.test(confirmationId)) throw new Error('Invalid Sabre confirmation ID');
  return { confirmationId };
}

export function readSabreGetBooking(value: unknown): { bookingId: string } {
  const data = value as { bookingId?: unknown; errors?: unknown } | null;
  if (data?.errors && (!Array.isArray(data.errors) || data.errors.length)) throw new Error('Sabre returned booking errors');
  if (!data || typeof data.bookingId !== 'string' || !data.bookingId.trim()) throw new Error('Unconfirmed Sabre GetBooking response');
  return { bookingId: data.bookingId };
}

/** Only documented customer fields are exposed; payment cards, agency details and raw responses are excluded. */
export function readSabreBookingView(value: unknown, allowUnavailableFareRules = false): {bookingId: string; view: FlightBookingProviderView} {
  value=flightTicketPayload(value);
  const errors = (value as {errors?: unknown} | null)?.errors;
  // A read-only refresh must still expose cancelled segments when Sabre cannot
  // populate optional fare rules. Transactional context readers remain strict.
  const optionalFareRulesOnly = allowUnavailableFareRules && Array.isArray(errors) && errors.length > 0 && errors.every(error =>
    error && typeof error === 'object' && error.category === 'WARNING' && error.type === 'RESOURCE_UNAVAILABLE' &&
    (['fareRules','fareOffers'].includes(error.fieldName) && error.fieldPath === 'GetBookingResponse' ||
      error.fieldName === 'number' && error.fieldPath === 'GetBookingResponse.flightTickets' &&
      error.description === 'FareRules can not be populated because the ticket is voided, refunded or exchanged.' &&
      Array.isArray((value as {flightTickets?:unknown}).flightTickets) &&
      ((value as {flightTickets:Record<string,unknown>[]}).flightTickets).some(ticket=>['Voided','Refunded/Exchanged'].includes(String(ticket.ticketStatusName)))));
  const identity = readSabreGetBooking(optionalFareRulesOnly ? {...value as Record<string,unknown>,errors:[]} : value);
  const data = value as Record<string, unknown>;
  const records = (value: unknown) => Array.isArray(value) ? value.slice(0,100).filter((item): item is Record<string,unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
  const text = (value: unknown, max = 120) => typeof value === 'string' && value.length <= max ? value : '';
  const flightNumber = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9999 ? String(value) : text(value, 8);
  // Get Booking omits optional empty collections. Treat omission as empty only
  // with explicit evidence, never for null/malformed or incomplete responses.
  // An explicit empty flight collection is valid cancellation evidence. Missing
  // or malformed collections still cannot prove that a PNR was cancelled.
  const explicitEmptySegments=Array.isArray(data.allSegments)&&data.allSegments.length===0;
  const rawFlights=data.flights===undefined&&explicitEmptySegments?[]:data.flights;
  const flightsComplete = Array.isArray(rawFlights) && records(rawFlights).length === rawFlights.length;
  const allFlightSegments = flightsComplete && Array.isArray(rawFlights) && Array.isArray(data.allSegments) && data.allSegments.length === rawFlights.length &&
    records(data.allSegments).length === data.allSegments.length && records(data.allSegments).every(segment => segment.type === 'FLIGHT');
  const noOtherContent = ['hotels','cars'].every(key => Array.isArray(data[key]) ? data[key].length === 0 : data[key] === undefined && allFlightSegments);
  const ticketsComplete = Array.isArray(data.flightTickets) ? records(data.flightTickets).length === data.flightTickets.length :
    data.flightTickets === undefined && data.isTicketed === false;
  return {...identity, view: {retrievedAt: new Date().toISOString(), cancellationCheckComplete: flightsComplete && ticketsComplete && noOtherContent,
    flights: records(data.flights).map(flight => ({airlineCode: text(flight.airlineCode, 3), flightNumber: flightNumber(flight.flightNumber), origin: text(flight.fromAirportCode, 3), destination: text(flight.toAirportCode, 3),
      departureDate: text(flight.departureDate, 10), departureTime: text(flight.departureTime, 8), arrivalDate: text(flight.arrivalDate, 10), arrivalTime: text(flight.arrivalTime, 8), status: text(flight.flightStatusName, 40)})),
    travellers: records(data.travelers).map(person => ({givenName: text(person.givenName), surname: text(person.surname)})),
    tickets: records(data.flightTickets).map(ticket => ({number: text(ticket.number, 24), status: text(ticket.ticketStatusName, 40), travellerIndex: typeof ticket.travelerIndex === 'number' && Number.isInteger(ticket.travelerIndex) && ticket.travelerIndex >= 1 ? ticket.travelerIndex : null,
      ...(Array.isArray(ticket.allCoupons)&&ticket.allCoupons.length>0&&records(ticket.allCoupons).length===ticket.allCoupons.length&&records(ticket.allCoupons).every(coupon=>typeof coupon.couponStatus==='string')?{couponStatuses:records(ticket.allCoupons).map(coupon=>text(coupon.couponStatus,40))}:{})})),
  }};
}

/** A send timeout or uncertain provider response can mean Sabre created a PNR. Never retry blindly. */
export type SabreBookingUnknownReason = 'NETWORK_OR_TIMEOUT' | 'HTTP_408' | 'HTTP_429' | 'HTTP_5XX' | 'INVALID_JSON' | 'UNREADABLE_CONFIRMATION';
export class SabreBookingUnknownError extends Error {
  constructor(readonly reason: SabreBookingUnknownReason, readonly httpStatus?: number, readonly diagnostic?: {errors?: BookingRejectionDiagnostic[]; warnings?: BookingRejectionDiagnostic[]; responseKeys?: string[]; confirmationId?: string; bookingId?: string; supplierRequestId?:string;dispatch?:TicketDispatchEvidence;transportFailure?:'TIMEOUT'|'DISCONNECT'}) {
    super(`Sabre booking result is unknown (${reason}${httpStatus ? `, HTTP ${httpStatus}` : ''})`);
  }
}
export class SabreBookingRejectedError extends Error {
  constructor(message: string, readonly httpStatus?: number, readonly failureCode: 'AGENCY_CONFIGURATION' | 'PROVIDER_REJECTED' = 'PROVIDER_REJECTED', readonly diagnostics: BookingRejectionDiagnostic[] = [],readonly supplierRequestId?:string,readonly dispatch?:TicketDispatchEvidence) { super(message); }
}
export interface BookingRejectionDiagnostic extends SanitizedTicketingError {}
function rejectionDiagnostics(value: unknown, body: unknown, collection: 'errors' | 'warnings' = 'errors'): BookingRejectionDiagnostic[] {
  const errors = (value as { errors?: unknown; warnings?: unknown } | null)?.[collection];
  if(value&&typeof value==='object'&&'AirTicketRS' in value)return enhancedTicketDiagnostics(value)[collection];
  if (!Array.isArray(errors)) return [];
  const privateValues = new Set<string>();
  const collect = (input: unknown): void => {
    if (typeof input === 'string' && input.length >= 3) privateValues.add(input);
    else if (Array.isArray(input)) input.forEach(collect);
    else if (input && typeof input === 'object') Object.values(input).forEach(collect);
  };
  collect(body);
  return errors.slice(0, 10).filter(error => error && typeof error === 'object').map(error => {
    const diagnostic: BookingRejectionDiagnostic = {};
    // Extract only safe metadata before generic redaction and the 500-character
    // display limit can erase a trailing host code or change its fingerprint.
    const safe=sanitizedTicketingErrors([error])[0];
    if(safe?.providerCodes)diagnostic.providerCodes=safe.providerCodes;
    if(safe?.descriptionFingerprint)diagnostic.descriptionFingerprint=safe.descriptionFingerprint;
    if(safe?.unclassifiedAirTicketMessage)diagnostic.unclassifiedAirTicketMessage=true;
    for (const key of ['category','type','fieldName','fieldPath'] as const) {
      if (typeof error[key] === 'string' && /^[A-Za-z0-9_.[\]/ -]{1,180}$/.test(error[key])) diagnostic[key] = error[key];
    }
    if (typeof error.description === 'string') {
      collect(error.fieldValue);
      let message = error.description;
      for (const entry of [...privateValues].sort((a,b) => b.length-a.length)) message = message.replaceAll(entry, '[redacted]');
      diagnostic.description = message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]').replace(/\+?\d[\d -]{6,}\d/g, '[redacted]').slice(0, 500);
    }
    if(Array.isArray((body as {fulfillments?:unknown}|null)?.fulfillments)&&safe?.description)diagnostic.description=safe.description;
    return diagnostic;
  });
}

/** Retain a safe classification only, never supplier field values or echoed passenger/payment data. */
function rejectionCode(value: unknown): 'AGENCY_CONFIGURATION' | 'PROVIDER_REJECTED' {
  const errors = (value as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) && errors.some(error => error && typeof error === 'object' &&
    ['agencyCustomerNumber', 'ticketingPolicy'].includes(error.fieldName)) ? 'AGENCY_CONFIGURATION' : 'PROVIDER_REJECTED';
}

export class SabreExchangeUnconfirmedError extends Error {
  constructor(readonly diagnostic:Record<string,unknown>){super('Exchange outcome requires read-only reconciliation. Do not repeat the supplier request.');}
}
export class SabreBookingManagementClient {
  private readonly responseReferences=new WeakMap<object,string>();
  private readonly dispatchReferences=new WeakMap<object,TicketDispatchEvidence>();
  responseReference(value:unknown){return value&&typeof value==='object'?this.responseReferences.get(value):undefined;}
  dispatchReference(value:unknown){return value&&typeof value==='object'?this.dispatchReferences.get(value):undefined;}
  constructor(private readonly config: AppConfig, private readonly auth: SabreAuthService,
    private readonly http: typeof fetch = fetch,private readonly servicingSession?:CertServicingSessionFactory) {}

  private async post(path: 'flightCheck' | 'createBooking' | 'getBooking' | 'cancelBooking' | 'getAncillaries' | 'priceNdcOffer' | 'fulfillFlightTickets' | 'modifyBooking'|'checkFlightTickets'|'flightReshop'|'exchangeBooking'|'enhancedAirTicket'|'refundFlightTickets', body: unknown): Promise<unknown> {
    if (this.config.SABRE_ENV !== 'CERT' || this.config.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com') {
      throw new SabreBookingRejectedError('Booking Management requires an approved CERT configuration');
    }
    const mutation = ['createBooking', 'modifyBooking', 'fulfillFlightTickets','cancelBooking','exchangeBooking','enhancedAirTicket','refundFlightTickets'].includes(path);
    validateTicketingPcc(this.config.SABRE_PCC,this.config.SABRE_USERNAME);
    const policy=currencyPolicy(this.config.SABRE_CURRENCY_POLICY);
    if(policy&&policy.pcc!==this.config.SABRE_PCC)throw new TicketingValidationError('PCC_CONTEXT_MISMATCH','The currency policy and configured PCC differ.');
    // These operations document targetPcc. Never add it to unrelated schemas.
    if(this.config.SABRE_PCC&&['getBooking','createBooking','fulfillFlightTickets','cancelBooking','refundFlightTickets'].includes(path))body={...(body as object),targetPcc:this.config.SABRE_PCC};
    // Select authentication before dispatch. An uncertain mutation is never
    // retried with another token or API. Shopping keeps its OAuth adapter.
    // Read authentication was verified independently. Enhanced ticketing keeps
    // its established OAuth/session orchestration; a successful read cannot
    // establish printer readiness for a different authentication context.
    const session=this.servicingSession&&path==='getBooking'?await this.servicingSession():undefined;
    try{return await this.postAuthenticated(path,body,session?.token??await this.auth.token(),mutation);}
    finally{if(session)try{await session.close();}catch{/* Cleanup must not erase a supplier result or trigger a replay. */}}
  }
  private async postAuthenticated(path:string,body:unknown,token:string,mutation:boolean):Promise<unknown>{
    const serialized=JSON.stringify(body),request=body as Record<string,unknown>;
    const fulfillment=Array.isArray(request.fulfillments)?request.fulfillments[0]:undefined;
    const qualifiers=fulfillment?.ticketingQualifiers;
    const paymentMethod=Array.isArray(request.formsOfPayment)?request.formsOfPayment[0]?.type:undefined;
    const dispatch:TicketDispatchEvidence|undefined=path==='fulfillFlightTickets'?{operation:'fulfillFlightTickets',environment:this.config.SABRE_ENV,targetPcc:typeof request.targetPcc==='string'?request.targetPcc:undefined,requestSha256:createHash('sha256').update(serialized).digest('hex'),sentAt:new Date().toISOString(),quoteHandling:request.backDatePriceQuoteMethod as TicketDispatchEvidence['quoteHandling'],commitWaitMs:typeof request.commitTicketToBookingWaitTime==='number'?request.commitTicketToBookingWaitTime:undefined}:undefined;
    if(dispatch)Object.assign(dispatch,{supplierPaymentMethod:['CASH','INVOICE','PAYMENTCARD'].includes(paymentMethod)?paymentMethod:undefined,priceQuoteRecordIds:Array.isArray(qualifiers?.priceQuoteRecordIds)?qualifiers.priceQuoteRecordIds.filter((id:unknown)=>typeof id==='string'&&/^[A-Z0-9]{1,3}$/.test(id)):[],validatingAirlineCode:typeof qualifiers?.validatingAirlineCode==='string'&&/^[A-Z0-9]{2}$/.test(qualifiers.validatingAirlineCode)?qualifiers.validatingAirlineCode:undefined,acceptPriceChanges:request.acceptPriceChanges===true,acceptNegotiatedFare:request.acceptNegotiatedFare===true,printerDesignationRequested:Array.isArray(request.designatePrinters)&&request.designatePrinters.length>0});
    const enhanced=request.AirTicketRQ as ReturnType<typeof buildEnhancedAirTicket>['AirTicketRQ']|undefined;
    const ticketDispatch:TicketDispatchEvidence|undefined=path==='enhancedAirTicket'?{operation:'enhancedAirTicket',ticketingApi:'ENHANCED_AIR_TICKET',quoteHandling:enhanced?.PostProcessing.actionOnPQExpired==='R'?'Reprice':'Quit',environment:this.config.SABRE_ENV,targetPcc:enhanced?.targetCity,requestSha256:createHash('sha256').update(serialized).digest('hex'),sentAt:new Date().toISOString(),supplierPaymentMethod:'CASH',priceQuoteRecordIds:enhanced?.Ticketing[0]?.PricingQualifiers?.PriceQuote[0]?.Record.map(record=>String(record.Number))??[],commissionPercent:enhanced?.Ticketing[0]?.MiscQualifiers?.Commission?.Percent,printerDesignationRequested:!!enhanced?.DesignatePrinter,acceptPriceChanges:false,acceptNegotiatedFare:false}:dispatch;
    let response: Response;
    try {
      const endpoint = path === 'getAncillaries' ? '/v2/offers/getAncillaries'
        : path === 'priceNdcOffer' ? '/v1/offers/price'
        : path==='enhancedAirTicket'?'/v1.3.0/air/ticket':path==='exchangeBooking'?'/v1.1.0/exchange/booking':path === 'flightCheck' ? '/v1/offers/flightCheck' : path==='flightReshop'?'/v1/offers/flightReshop':`/v1/trip/orders/${path}`;
      response = await this.http(`${this.config.SABRE_BASE_URL}${endpoint}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(mutation?(this.config.SABRE_SERVICING_TIMEOUT_MS??120000):this.config.SABRE_REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: serialized,
      });
    } catch(error) { throw mutation ? new SabreBookingUnknownError('NETWORK_OR_TIMEOUT',undefined,{dispatch:ticketDispatch,transportFailure:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':'DISCONNECT'}) :
      new SabreBookingRejectedError('Sabre booking lookup is unavailable'); }
    const requestReference=response.headers.get('x-request-id');
    if(ticketDispatch)ticketDispatch.receivedAt=new Date().toISOString();
    const supplierRequestId=requestReference&&/^[A-Za-z0-9_.:-]{1,180}$/.test(requestReference)?requestReference:undefined;
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        let failure: unknown;
        try { failure = await response.json(); } catch { /* HTTP status still identifies the uncertain result. */ }
        throw mutation ? new SabreBookingUnknownError(response.status === 408 ? 'HTTP_408' : response.status === 429 ? 'HTTP_429' : 'HTTP_5XX', response.status, {errors:rejectionDiagnostics(failure,body),warnings:rejectionDiagnostics(failure,body,'warnings'),supplierRequestId,dispatch:ticketDispatch}) : new SabreBookingRejectedError('Sabre booking lookup is unavailable');
      }
      let failure: unknown;
      try { failure = await response.json(); } catch { /* Status remains sufficient to classify a rejected request. */ }
      throw new SabreBookingRejectedError(`Sabre rejected the request (${response.status})`, response.status, rejectionCode(failure), rejectionDiagnostics(failure, body),supplierRequestId,ticketDispatch);
    }
    try { const result:unknown=await response.json();if(result&&typeof result==='object'){if(supplierRequestId)this.responseReferences.set(result,supplierRequestId);if(ticketDispatch){const summary=(result as {AirTicketRS?:{Summary?:unknown}}).AirTicketRS?.Summary;ticketDispatch.documentCount=path==='enhancedAirTicket'?Array.isArray(summary)?summary.filter(item=>['TKT','EMD'].includes(item?.DocumentType)).length:0:Array.isArray((result as {tickets?:unknown}).tickets)?(result as {tickets:unknown[]}).tickets.length:0;this.dispatchReferences.set(result,ticketDispatch);}}return result; }
    catch { throw mutation ? new SabreBookingUnknownError('INVALID_JSON', response.status,{supplierRequestId,dispatch:ticketDispatch}) :
      new SabreBookingRejectedError('Sabre booking response could not be verified'); }
  }

  async createBooking(body: ReturnType<typeof buildSabreCreateBooking> | ReturnType<typeof buildSabreCreateNdcBooking>) {
    try{if('flightDetails' in body){
      const policy=currencyPolicy(this.config.SABRE_CURRENCY_POLICY);
      body={...body,flightDetails:{...body.flightDetails,flightPricing:body.flightDetails.flightPricing.map(pricing=>({...pricing,qualifiers:pricingCurrencyQualifiers(pricing.qualifiers.currencyPricing,this.config.SABRE_PCC,policy)}))}};
    }}catch(error){if(error instanceof TicketingValidationError)throw new SabreBookingRejectedError('Local pricing currency validation failed: '+error.message,undefined,'AGENCY_CONFIGURATION');throw error;}
    let result:unknown;
    try{result=await this.post('createBooking',body);}catch(error){if(error instanceof TicketingValidationError)throw new SabreBookingRejectedError('Local PCC validation failed: '+error.message,undefined,'AGENCY_CONFIGURATION');throw error;}
    const response = result as { confirmationId?: unknown; booking?: { bookingId?: unknown }; errors?: unknown } | null;
    // Sabre can return HTTP 200 for preflight validation failures. Other errors or any
    // supplied booking identity remain uncertain and must retain the reconciliation lock.
    if (!response?.confirmationId && !response?.booking?.bookingId && Array.isArray(response?.errors) && response.errors.length &&
      response.errors.every(error => error && typeof error === 'object' && error.category === 'BAD_REQUEST' &&
        ['MANDATORY_DATA_MISSING', 'INVALID_VALUE'].includes(error.type))) {
      throw new SabreBookingRejectedError('Sabre rejected reservation validation', 200, rejectionCode(result), rejectionDiagnostics(result, body),this.responseReference(result));
    }
    try { return readSabreCreateBooking(result); }
    catch {
      throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION', 200, {
        errors: rejectionDiagnostics(result,body),
        warnings: rejectionDiagnostics(result,body,'warnings'),
        supplierRequestId:this.responseReference(result),
        responseKeys: result && typeof result === 'object' ? Object.keys(result).filter(key=>/^[A-Za-z_]{1,60}$/.test(key)).slice(0,30) : [],
        ...(typeof response?.confirmationId === 'string' && /^[A-Z0-9]{6,16}$/i.test(response.confirmationId) ? {confirmationId:response.confirmationId} : {}),
        ...(typeof response?.booking?.bookingId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(response.booking.bookingId) ? {bookingId:response.booking.bookingId} : {}),
      });
    }
  }

  async flightCheck(offer: FlightOffer, adultCount: number | BookingPassengerCode[]) {
    return this.post('flightCheck', buildBookingFlightCheck(offer, adultCount));
  }

  /** Internal pricing request from the supplied collection. The pricing response
   * needs a verified mapper before it can become an owned bookable context.
   * Do not invent payment-card/BIN values to obtain a quote.
   */
  async priceNdcOffer(offerItemIds: string[]): Promise<unknown> {
    if (!Array.isArray(offerItemIds) || !offerItemIds.length || offerItemIds.length > 60 ||
      offerItemIds.some(id => typeof id !== 'string' || !id.length || id.length > 160 || /\s/.test(id)) || new Set(offerItemIds).size !== offerItemIds.length)
      throw new SabreBookingRejectedError('Supplier NDC offer item references are required for pricing');
    return this.post('priceNdcOffer', { query: [{ offerItemId: [...offerItemIds] }] });
  }

  /** Supports NDC offer IDs after shopping/pricing and NDC order IDs with
   * optional passenger/segment selection, from the user's supplied examples.
   * Keep the response internal until its public ancillary DTO is verified.
   * Shopping-stage offers are informational; discovery alone cannot book them.
   */
  async getAncillaryOffers(input: SabreAncillaryRequest): Promise<unknown> {
    let body: SabreAncillaryRequest;
    try { body = buildSabreAncillaryRequest(input); }
    catch { throw new SabreBookingRejectedError('A valid NDC offer or order context is required for ancillary offers'); }
    const result = await this.post('getAncillaries', body);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new SabreBookingRejectedError('Sabre ancillary response could not be read');
    }
    const errors = (result as Record<string, unknown>).errors;
    if (errors !== undefined && (!Array.isArray(errors) || errors.length > 0)) {
      throw new SabreBookingRejectedError('Sabre could not retrieve ancillary offers');
    }
    return result;
  }

  async getPurchaseBooking(confirmationId: string): Promise<PurchaseBooking> {
    return readPurchaseBooking(await this.post('getBooking', buildSabreGetBooking(confirmationId)));
  }
  async modifyAncillaries(body: unknown) {
    const result = await this.post('modifyBooking', body);
    const data = result as Record<string, unknown> | null;
    if (!data || data.errors !== undefined && (!Array.isArray(data.errors) || data.errors.length)) throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION');
    return result;
  }
  async getBooking(confirmationId: string) {
    const result = await this.post('getBooking', buildSabreGetBooking(confirmationId));
    return readSabreGetBooking(result);
  }
  async getBookingView(confirmationId: string,originalExchange?:ExchangeContext) {
    const raw=await this.post('getBooking', buildSabreGetBooking(confirmationId));
    return readSabreBookingView(originalExchange?exchangeVerificationPayload(raw,originalExchange):raw, true);
  }
  async verifyTerminalEmptyItinerary(pnr:string,bookingId:string,kind:'VOID'|'REFUND',numbers:string[]){
    const raw=await this.post('getBooking',buildSabreGetBooking(pnr)) as Record<string,unknown>;
    const current=readSabreBookingView(raw,true);
    const tickets=raw.flightTickets as Record<string,unknown>[]|undefined;
    if(current.bookingId!==bookingId||!numbers.length||new Set(numbers).size!==numbers.length||numbers.some(number=>!/^\d{13}$/.test(number))||
      current.view.flights.length||current.view.tickets.length!==numbers.length||new Set(current.view.tickets.map(ticket=>ticket.number)).size!==numbers.length||
      !Array.isArray(tickets)||tickets.some(ticket=>ticket.ticketingPcc!==this.config.SABRE_PCC)||
      ['flights','allSegments','journeys','hotels','cars','trains','cruises'].some(key=>raw[key]!==undefined&&(!Array.isArray(raw[key])||(raw[key] as unknown[]).length>0))||
      current.view.tickets.some(ticket=>!numbers.includes(ticket.number)||(kind==='VOID'?ticket.status!=='Voided':ticket.status!=='Refunded/Exchanged'||!ticket.couponStatuses?.length||ticket.couponStatuses.some(status=>status!=='Refunded'))))throw Error('Terminal booking evidence incomplete');
    const proof=await verifySabreEmptyItinerary(this.config,pnr,this.http);
    return {...current,view:{...current.view,cancellationCheckComplete:true},proof};
  }
  async getIssuedTicketContext(confirmationId:string){
    const raw=await this.post('getBooking',buildSabreGetBooking(confirmationId)) as Record<string,unknown>;
    return {...readSabreBookingView(raw),documents:readTicketDocuments(flightTicketPayload(raw) as Record<string,unknown>),supplierRequestId:this.responseReference(raw)};
  }
  async getTicketingContext(confirmationId:string,execution?:TicketingExecutionOptions){
    const options=ticketingExecutionOptions(execution);
    const raw=await this.post('getBooking',buildSabreGetBooking(confirmationId));
    const errors=(raw as {errors?:unknown})?.errors;
    // An authoritative current PQ can support ATPCO ticketing when optional
    // shopping-style fareOffers cannot be populated. No other error is ignored.
    const optionalOffersOnly=Array.isArray(errors)&&errors.length>0&&errors.every(error=>error&&typeof error==='object'&&error.category==='WARNING'&&error.type==='RESOURCE_UNAVAILABLE'&&error.fieldName==='fareOffers'&&error.fieldPath==='GetBookingResponse');
    const booking=optionalOffersOnly?undefined:readSabreBookingView(raw);
    const pricing=validateStoredTicketingCurrency(raw,{pcc:this.config.SABRE_PCC,username:this.config.SABRE_USERNAME,policy:currencyPolicy(this.config.SABRE_CURRENCY_POLICY),allowStaleForReprice:options.quoteHandling==='Reprice'});
    return {...(booking??readSabreBookingView({...raw as Record<string,unknown>,errors:[]})),...pricing};
  }
  async getExchangeContext(confirmationId:string,original?:ExchangeContext){
    const raw=await this.post('getBooking',buildSabreGetBooking(confirmationId));
    const result=original?exchangeVerificationPayload(raw,original):raw;
    return readExchangeContext(result,readSabreBookingView(result));
  }
  async exchangeBooking(confirmationId:string,offer:ExchangeOffer,context:ExchangeContext,pricePolicy?:ExchangePricePolicy){
    let cashProfile=false;try{cashProfile=JSON.parse(this.config.SABRE_TICKETING_PROFILE??'null')?.formOfPayment==='CASH';}catch{}
    if(this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production'||!cashProfile)throw new SabreBookingRejectedError('Exchange preparation is limited to approved CERT CASH servicing');
    const policy=currencyPolicy(this.config.SABRE_CURRENCY_POLICY);
    validateTicketingPcc(this.config.SABRE_PCC,this.config.SABRE_USERNAME);
    pricingCurrencyQualifiers(offer.currency,this.config.SABRE_PCC,policy);
    const body=exchangeBookingRequest(confirmationId,offer,context,{pricePolicy,pcc:this.config.SABRE_PCC,nativeCurrency:policy?.pricingMode==='LOCAL_DEFAULT'?policy.localCurrency:undefined});
    const diagnostic={operation:'exchangeBooking',requestSha256:createHash('sha256').update(JSON.stringify(body)).digest('hex'),attemptedAt:new Date().toISOString(),automaticRetry:false};
    let result:unknown;
    try{result=await this.post('exchangeBooking',body);}
    catch(error){
      if(error instanceof SabreBookingUnknownError)throw new SabreExchangeUnconfirmedError({...diagnostic,classification:'TRANSPORT_OR_SUPPLIER_UNCONFIRMED',httpStatus:error.httpStatus,reason:error.reason,errors:sanitizedTicketingErrors(error.diagnostic?.errors),warnings:sanitizedTicketingErrors(error.diagnostic?.warnings),supplierRequestId:error.diagnostic?.supplierRequestId});
      if(error instanceof SabreBookingRejectedError)throw new SabreExchangeUnconfirmedError({...diagnostic,classification:'SUPPLIER_REQUEST_REJECTED',httpStatus:error.httpStatus,errors:sanitizedTicketingErrors(error.diagnostics),supplierRequestId:error.supplierRequestId});
      throw error;
    }
    const supplier=enhancedTicketDiagnostics({AirTicketRS:(result as {ExchangeBookingRS?:unknown})?.ExchangeBookingRS??result},[confirmationId,...context.travelers.flatMap(person=>[person.givenName,person.surname]),...context.tickets.map(ticket=>ticket.number)]);
    try{return readExchangePqrs(result,offer,context);}
    catch(error){throw new SabreExchangeUnconfirmedError({...diagnostic,classification:error instanceof Error&&error.message==='PQR change-fee document requires specialist servicing'?'CHANGE_FEE_DOCUMENT_REQUIRED':'PQR_NOT_VERIFIED',supplierStatus:supplier.status,errors:supplier.errors,warnings:supplier.warnings,supplierRequestId:this.responseReference(result),responseSha256:createHash('sha256').update(JSON.stringify(result)).digest('hex')});}
  }
  async fulfillExchange(confirmationId:string,pqrs:ExchangePqr[],profile:SabreTicketingProfile,privateTravelerNames:string[]=[]){
    if(this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production'||profile.formOfPayment!=='CASH'||!pqrs.length||new Set(pqrs.map(pqr=>pqr.id)).size!==pqrs.length||pqrs.some(pqr=>!/^\d{1,3}$/.test(pqr.id)))throw new SabreBookingRejectedError('Verified CERT CASH PQR fulfillment is required');
    if(pqrs.some(pqr=>!pqr.validatingAirlineCode||!/^[A-Z0-9]{2}$/.test(pqr.validatingAirlineCode)))throw new SabreBookingRejectedError('The stored PQR validating carrier is required');
    const body=buildEnhancedReissue(confirmationId,this.config.SABRE_PCC??'',profile,pqrs);
    const raw=await this.post('enhancedAirTicket',body),result=readEnhancedAirTicket(raw,confirmationId,this.config.SABRE_PCC??'',[confirmationId,...pqrs.map(pqr=>pqr.ticketNumber),...privateTravelerNames]);
    if(!result.complete)throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION',200,{errors:result.errors,warnings:result.warnings,supplierRequestId:this.responseReference(raw),dispatch:this.dispatchReference(raw)});
    return result;
  }
  async getContactContext(confirmationId:string){
    const result=await this.post('getBooking',buildSabreGetBooking(confirmationId));
    return readContactContext(result,readSabreBookingView(result));
  }
  async modifyTravelerContact(confirmationId:string,context:ContactContext,plan:ContactPlan){
    return this.modifyAncillaries(contactModificationRequest(confirmationId,context,plan));
  }
  async getTicketServicingContext(confirmationId:string){
    const result=await this.post('getBooking',buildSabreGetBooking(confirmationId));
    return servicingContext(result,readSabreBookingView(result));
  }
  async checkFlightTickets(confirmationId:string,context:ServicingContext){
    if(!/^[A-Z0-9]{6}$/.test(confirmationId)||!context.ticketNumbers.length||context.ticketNumbers.length>12||new Set(context.ticketNumbers).size!==context.ticketNumbers.length||context.ticketNumbers.some(number=>!/^\d{13}$/.test(number)))throw new SabreBookingRejectedError('Verified ticket numbers are required for eligibility retrieval');
    // CheckTicketsRequest permits a PNR OR specific tickets, never both.
    // Scope the lookup to the documents independently retrieved from this PNR.
    const body={...(this.config.SABRE_PCC?{targetPcc:this.config.SABRE_PCC}:{}),tickets:context.ticketNumbers.map(number=>({number}))};
    const result=await this.post('checkFlightTickets',body);
    if(Array.isArray((result as {errors?:unknown})?.errors)&&(result as {errors:unknown[]}).errors.length)throw new SabreBookingRejectedError('Sabre rejected ticket eligibility validation',200,rejectionCode(result),rejectionDiagnostics(result,body),this.responseReference(result));
    return ticketEligibility(result,context);
  }
  async reshopFlightTickets(confirmationId:string,eligibility:AirlineEligibility,journeys:ExchangeJourney[]){
    const result=await this.post('flightReshop',{bookingId:confirmationId,source:{distributionModel:'ATPCO'},tickets:eligibility.tickets.map(ticket=>({number:ticket.number,overrideCheckedInTicketCoupons:false})),journeys:journeys.map(journey=>({departureLocation:{airportCode:journey.origin},arrivalLocation:{airportCode:journey.destination},departureDate:journey.departureDate}))});
    return readExchangeSearch(result,eligibility,journeys);
  }
  async cancelTicketedBooking(confirmationId:string,kind:'VOID'|'REFUND',printers:{hardcopy:{address:string}}[]){
    return this.post('cancelBooking',{...buildSabreGetBooking(confirmationId),cancelAll:true,flightTicketOperation:kind,retrieveBooking:true,errorHandlingPolicy:'HALT_ON_ERROR',voidNonElectronicTickets:false,refundDocumentsType:'Tickets',receivedFrom:'Flyseri sandbox staff servicing',designatePrinters:printers});
  }
  async cancelUnticketedBooking(confirmationId: string) {
    return this.post('cancelBooking', {...buildSabreGetBooking(confirmationId), cancelAll: true, retrieveBooking: true, errorHandlingPolicy: 'HALT_ON_ERROR'});
  }
  async getRemainingCancellationContext(pnr:string,kind:'VOID'|'REFUND',expected:string[]){
    const raw=await this.post('getBooking',buildSabreGetBooking(pnr)) as Record<string,unknown>;
    const identity=readSabreBookingView(raw,true),context=servicingContext(raw,identity);
    const flightIds=Array.isArray(raw.flights)?raw.flights.map(flight=>(flight as {itemId?:unknown}).itemId):[];
    if(!context.atpcoFlightOnly||!expected.length||new Set(expected).size!==expected.length||context.ticketNumbers.length!==expected.length||context.ticketNumbers.some(number=>!expected.includes(number))||
      context.ticketingPccs.some(pcc=>pcc!==this.config.SABRE_PCC)||!flightIds.length||flightIds.length>60||flightIds.some(id=>typeof id!=='string'||!/^[A-Z0-9]{1,20}$/.test(id))||new Set(flightIds).size!==flightIds.length||
      identity.view.tickets.some(ticket=>kind==='VOID'?ticket.status!=='Voided':ticket.status!=='Refunded/Exchanged'||!ticket.couponStatuses?.length||ticket.couponStatuses.some(status=>status!=='Refunded')))throw new SabreBookingRejectedError('Verified terminal tickets and complete remaining ATPCO flight scope are required');
    const {retrievedAt:_,...view}=identity.view;
    const fingerprint=createHash('sha256').update(JSON.stringify({pnr,pcc:this.config.SABRE_PCC,bookingId:identity.bookingId,kind,view,flightIds})).digest('hex');
    return {...identity,flightIds:flightIds as string[],fingerprint};
  }
  async cancelRemainingFlightSegments(pnr:string,flightIds:string[]){
    if(!flightIds.length||flightIds.length>60||flightIds.some(id=>!/^[A-Z0-9]{1,20}$/.test(id))||new Set(flightIds).size!==flightIds.length)throw new SabreBookingRejectedError('Invalid remaining flight scope');
    // Ticket operation deliberately absent: terminal documents must never be voided/refunded twice.
    return this.post('cancelBooking',{...buildSabreGetBooking(pnr),cancelAll:false,flights:flightIds.map(itemId=>({itemId})),retrieveBooking:true,errorHandlingPolicy:'HALT_ON_ERROR',receivedFrom:'Flyseri CERT approved segment recovery'});
  }
  async fulfillFlightTickets(confirmationId: string, profile: SabreTicketingProfile, ancillaryIds: string[] = [], entireNdcOrder = false,selection?:{priceQuoteRecordIds:string[];validatingAirlineCode:string},execution?:TicketingExecutionOptions) {
    const options=ticketingExecutionOptions(execution);
    if(options.ticketingApi==='ENHANCED_AIR_TICKET')throw new SabreBookingRejectedError('Enhanced Air Ticket requires its separately approved endpoint');
    if(profile.formOfPayment==='CASH'&&(this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production'||entireNdcOrder))throw new SabreBookingRejectedError('CASH fulfillment is limited to ATPCO CERT staff tests');
    const form = profile.formOfPayment === 'INVOICE'
      ? { type: profile.formOfPayment, invoiceDescription: profile.invoiceDescription, addInvoiceDescriptionPrefix: false }
      : profile.formOfPayment==='CASH' ? {type:'CASH'}
      : { type: profile.formOfPayment, cardTypeCode: profile.cardTypeCode, cardNumber: profile.cardNumber,
        cardSecurityCode: profile.cardSecurityCode, expiryDate: profile.expiryDate,
        ...(profile.manualApprovalCode ? { manualApprovalCode: profile.manualApprovalCode } : {}), ...(profile.cardHolder ? { cardHolder: profile.cardHolder } : {}), ...(profile.authentications ? { authentications: profile.authentications } : {}) };
    const body = { ...buildSabreGetBooking(confirmationId),
      acceptPriceChanges:false,acceptNegotiatedFare:false,
      // Repricing is an explicit part of the approved case; overrides are unsupported.
      ...(!entireNdcOrder ? {backDatePriceQuoteMethod:options.quoteHandling,priceQuoteExpirationMethod:options.quoteHandling,commitTicketToBookingWaitTime:options.commitWaitMs} : {}),
      fulfillments: [{ ...(selection&&!entireNdcOrder?{ticketingQualifiers:selection}:{}),payment: { primaryFormOfPayment: 1 } }, ...(ancillaryIds.length && !entireNdcOrder ? [{ ancillaryIds: [...ancillaryIds], payment: { primaryFormOfPayment: 1 } }] : [])],
      ...(!entireNdcOrder ? { designatePrinters: [{ hardcopy: { address: profile.hardcopyPrinterAddress } }, ...(profile.ticketCountryCode ? [{ ticket: { countryCode: profile.ticketCountryCode } }] : [])] } : {}),
      formsOfPayment: [form],
    };
    const result=await this.post('fulfillFlightTickets',body);
    const errors = (result as Record<string, unknown> | null)?.errors;
    const tickets = (result as Record<string, unknown> | null)?.tickets;
    // A 200 response containing warnings alone is not document issuance. Preserve
    // both collections for reconciliation, even when Sabre omits the tickets key.
    if (!result || typeof result !== 'object' || Array.isArray(result) || errors !== undefined && (!Array.isArray(errors) || errors.length) || !Array.isArray(tickets) || !tickets.length)
      throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION',200,{errors:rejectionDiagnostics(result,body),warnings:rejectionDiagnostics(result,body,'warnings'),supplierRequestId:this.responseReference(result),dispatch:this.dispatchReference(result),responseKeys:result&&typeof result==='object'?Object.keys(result).filter(key=>/^[A-Za-z_]{1,60}$/.test(key)).slice(0,30):[]});
    return result;
  }
  async getAncillaryDocumentBooking(pnr:string){
    const raw=await this.post('getBooking',buildSabreGetBooking(pnr)) as Record<string,unknown>;
    const booking=readPurchaseBooking(raw);
    if(!Array.isArray(raw.flightTickets)||raw.flightTickets.some(value=>!value||typeof value!=='object'))throw new SabreBookingRejectedError('Complete extra-service document evidence is unavailable');
    return {...booking,documents:raw.flightTickets as Record<string,unknown>[]};
  }
  async refundAncillaryDocument(pnr:string,document:string,printers:unknown[]){
    if(this.config.APP_ENV==='production'||this.config.SABRE_ENV!=='CERT'||!/^\d{13}$/.test(document)||!printers.length)throw new SabreBookingRejectedError('A verified CERT extra-service document and printer are required');
    return this.post('refundFlightTickets',{confirmationId:pnr,tickets:[{number:document}],documentsType:'EMDs',errorHandlingPolicy:'HALT_ON_ERROR',receivedFrom:'Flyseri approved CERT extra refund',designatePrinters:printers});
  }
  async fulfillAncillaryDocuments(pnr:string,profile:SabreTicketingProfile,ids:string[]){
    if(this.config.APP_ENV==='production'||this.config.SABRE_ENV!=='CERT'||profile.formOfPayment!=='CASH'||!/^[A-Z0-9]{6}$/.test(profile.hardcopyPrinterAddress)||!/^[A-Z]{2}$/.test(profile.ticketCountryCode??'')||!ids.length||ids.length>40||new Set(ids).size!==ids.length||ids.some(id=>!(/^[A-Z0-9]+$/).test(id)))throw new SabreBookingRejectedError('Verified CERT CASH extra-service references and printer profile are required');
    return this.post('fulfillFlightTickets',{confirmationId:pnr,acceptPriceChanges:false,acceptNegotiatedFare:false,commitTicketToBookingWaitTime:3000,fulfillments:[{ancillaryIds:ids,payment:{primaryFormOfPayment:1}}],formsOfPayment:[{type:'CASH'}],designatePrinters:[{hardcopy:{address:profile.hardcopyPrinterAddress}},...(profile.ticketCountryCode?[{ticket:{countryCode:profile.ticketCountryCode}}]:[])]});
  }
  async issueEnhancedAncillaryDocuments(pnr:string,profile:SabreTicketingProfile,ids:string[],privateValues:string[]=[]){
    if(this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production')throw new SabreBookingRejectedError('Enhanced EMD issuance is limited to approved CERT servicing');
    const body=buildEnhancedAirExtras(pnr,this.config.SABRE_PCC??'',profile,ids);
    const raw=await this.post('enhancedAirTicket',body),result=readEnhancedAirExtras(raw,pnr,this.config.SABRE_PCC??'',privateValues);
    const dispatch=this.dispatchReference(raw),supplierRequestId=this.responseReference(raw);
    if(!result.complete)throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION',200,{errors:result.errors,warnings:result.warnings,supplierRequestId,dispatch});
    if(dispatch)this.dispatchReferences.set(result,dispatch);if(supplierRequestId)this.responseReferences.set(result,supplierRequestId);
    return result;
  }
  async issueEnhancedAirTicket(confirmationId:string,profile:SabreTicketingProfile,selection:{priceQuoteRecordIds:string[];validatingAirlineCode:string},execution:TicketingExecutionOptions,privateValues:string[]=[]){
    if(this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production'||profile.formOfPayment!=='CASH')throw new SabreBookingRejectedError('Enhanced Air Ticket is limited to approved ATPCO CASH CERT servicing');
    const body=buildEnhancedAirTicket(confirmationId,this.config.SABRE_PCC??'',profile,selection.priceQuoteRecordIds,execution);
    const raw=await this.post('enhancedAirTicket',body),result=readEnhancedAirTicket(raw,confirmationId,this.config.SABRE_PCC??'',[confirmationId,this.config.SABRE_PCC??'',...privateValues]);
    const dispatch=this.dispatchReference(raw),supplierRequestId=this.responseReference(raw);
    if(dispatch)dispatch.validatingAirlineCode=selection.validatingAirlineCode;
    if(!result.complete)throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION',200,{errors:result.errors,warnings:result.warnings,supplierRequestId,dispatch,responseKeys:raw&&typeof raw==='object'?Object.keys(raw).filter(key=>/^[A-Za-z_]{1,60}$/.test(key)):[]});
    if(dispatch)this.dispatchReferences.set(result,dispatch);if(supplierRequestId)this.responseReferences.set(result,supplierRequestId);
    return result;
  }
}
