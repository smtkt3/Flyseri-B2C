import { readPurchaseBooking, type PurchaseBooking } from './ancillary-purchase.contract.js';
import type { FlightOffer, FlightBookingProviderView } from '@flyseri/types';
import type { AppConfig } from '@flyseri/config';
import type { SabreAuthService } from './sabre-auth.service.js';
import { buildSabreAncillaryRequest, type SabreAncillaryRequest } from './sabre-ancillaries.contract.js';
import type { BookingSpecialService } from './flight-special-services.js';
import type { BookingPassengerCode } from './flight-passenger-types.js';

/** Fields copied from Booking Management 2026.08 / ATPCO / One way - 1xADT. */
export interface BookingAgency {
  address: { name: string; street: string; city: string; stateProvince: string; postalCode: string; countryCode: string; freeText: string };
  agencyCustomerNumber?: string;
  ticketingPolicy: string;
}
export interface BookingIdentityDocument { documentType: 'PASSPORT'|'NATIONAL_ID_CARD'|'VISA'|'ALIEN_RESIDENT'|'BORDER_CROSSING_CARD'|'REFUGEE_REENTRY_PERMIT'; documentNumber: string; expiryDate: string; issuingCountryCode: string; citizenshipCountryCode?: string; givenName: string; surname: string; birthDate: string; gender: string }
export interface BookingPassenger { givenName: string; surname: string; birthDate: string; passengerCode: BookingPassengerCode; infantTravelerIndex?: number; specialServices?: BookingSpecialService[]; identityDocuments?: BookingIdentityDocument[] }
export interface BookingContact { email: string; phone: string }
export type SabreTicketingProfile = { ticketCountryCode: string; hardcopyPrinterAddress: string; ndcAirlineCodes?: string[] } & (
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
  contact: BookingContact, agency: BookingAgency, billingAddress: BillingAddress) {
  if (!passengers.length || !segmentsOf(offer).length || !agency.address.name || !agency.ticketingPolicy ||
      !contact.email || !contact.phone) throw new Error('Incomplete CreateBooking inputs');
  const flights = segmentsOf(offer).map((segment) => {
    if (!segment.bookingClass) throw new Error('Sabre booking class is missing');
    const departure = datePart(segment.departureAt);
    return { flightNumber: flightNumber(segment.flightNumber), airlineCode: segment.marketingCarrier,
      fromAirportCode: segment.origin, toAirportCode: segment.destination,
      departureDate: departure.date, departureTime: departure.time,
      bookingClass: segment.bookingClass, flightStatusCode: 'NN' as const };
  });
  return { agency, travelers: passengers.map(({ givenName, surname, birthDate, passengerCode, infantTravelerIndex, specialServices, identityDocuments }) => ({
    givenName, surname, birthDate, passengerCode, ...(infantTravelerIndex ? { infantTravelerIndex } : {}), ...(specialServices?.length ? { specialServices } : {}), ...(identityDocuments?.length ? { identityDocuments } : {}) })),
    contactInfo: { emails: [contact.email], phones: [contact.phone] },
    flightDetails: { flights, flightPricing: [{}] }, payment: { billingAddress } };
}

/** NDC CreateBooking variant in the supplied agency collection. No fulfillment
 * payment or ticket issuance is requested. Supplier passenger IDs are assigned
 * by passenger type, never by a browser-provided passenger reference.
 */
export function buildSabreCreateNdcBooking(context: NonNullable<FlightOffer['ndcContext']>,
  passengers: (BookingPassenger & { gender: string | null })[], contact: BookingContact, agency: BookingAgency) {
  if (Date.parse(context.expiresAt) <= Date.now() || !context.offerItemIds?.length || passengers.length !== context.passengers.length) throw new Error('Priced NDC context is unavailable');
  const remaining = [...context.passengers];
  const travelers = passengers.map(person => {
    if (!person.givenName.trim() || !person.surname.trim() || !person.birthDate || !['MALE','FEMALE','X'].includes(person.gender ?? '')) throw new Error('Complete traveler gender and birth date for NDC booking');
    const index = remaining.findIndex(entry => entry.passengerTypeCode === person.passengerCode);
    if (index < 0) throw new Error('NDC passenger types do not match');
    const [entry] = remaining.splice(index, 1);
    return { id: entry!.passengerId, givenName: person.givenName, surname: person.surname, birthDate: person.birthDate, passengerCode: person.passengerCode,
      identityDocuments: person.identityDocuments?.length ? person.identityDocuments : [{ documentType: 'SECURE_FLIGHT_PASSENGER_DATA', givenName: person.givenName, surname: person.surname, birthDate: person.birthDate, gender: person.gender! }] };
  });
  return { flightOffer: { offerId: context.offerId, selectedOfferItems: [...context.offerItemIds] }, travelers,
    contactInfo: { emails: [contact.email], phones: [contact.phone] }, agency };
}

export function readSabreCreateBooking(value: unknown): { confirmationId: string; sabreBookingId: string } {
  const data = value as { confirmationId?: unknown; booking?: { bookingId?: unknown }; errors?: unknown } | null;
  if (data?.errors && (!Array.isArray(data.errors) || data.errors.length)) throw new Error('Sabre returned creation errors');
  if (!data || typeof data.confirmationId !== 'string' || !/^[A-Z0-9]{5,16}$/i.test(data.confirmationId) ||
      typeof data.booking?.bookingId !== 'string' || !data.booking.bookingId.trim()) throw new Error('Unconfirmed Sabre CreateBooking response');
  return { confirmationId: data.confirmationId, sabreBookingId: data.booking.bookingId };
}

export function buildSabreGetBooking(confirmationId: string) {
  if (!/^[A-Z0-9]{5,16}$/i.test(confirmationId)) throw new Error('Invalid Sabre confirmation ID');
  return { confirmationId };
}

export function readSabreGetBooking(value: unknown): { bookingId: string } {
  const data = value as { bookingId?: unknown; errors?: unknown } | null;
  if (data?.errors && (!Array.isArray(data.errors) || data.errors.length)) throw new Error('Sabre returned booking errors');
  if (!data || typeof data.bookingId !== 'string' || !data.bookingId.trim()) throw new Error('Unconfirmed Sabre GetBooking response');
  return { bookingId: data.bookingId };
}

/** Only documented customer fields are exposed; payment cards, agency details and raw responses are excluded. */
export function readSabreBookingView(value: unknown): {bookingId: string; view: FlightBookingProviderView} {
  const identity = readSabreGetBooking(value);
  const data = value as Record<string, unknown>;
  const records = (value: unknown) => Array.isArray(value) ? value.slice(0,100).filter((item): item is Record<string,unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
  const text = (value: unknown, max = 120) => typeof value === 'string' && value.length <= max ? value : '';
  const flightNumber = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9999 ? String(value) : text(value, 8);
  return {...identity, view: {retrievedAt: new Date().toISOString(), cancellationCheckComplete: Array.isArray(data.flights) && Array.isArray(data.flightTickets) &&
      records(data.flights).length === data.flights.length && records(data.flightTickets).length === data.flightTickets.length &&
      Array.isArray(data.hotels) && data.hotels.length === 0 && Array.isArray(data.cars) && data.cars.length === 0,
    flights: records(data.flights).map(flight => ({airlineCode: text(flight.airlineCode, 3), flightNumber: flightNumber(flight.flightNumber), origin: text(flight.fromAirportCode, 3), destination: text(flight.toAirportCode, 3),
      departureDate: text(flight.departureDate, 10), departureTime: text(flight.departureTime, 8), arrivalDate: text(flight.arrivalDate, 10), arrivalTime: text(flight.arrivalTime, 8), status: text(flight.flightStatusName, 40)})),
    travellers: records(data.travelers).map(person => ({givenName: text(person.givenName), surname: text(person.surname)})),
    tickets: records(data.flightTickets).map(ticket => ({number: text(ticket.number, 24), status: text(ticket.ticketStatusName, 40), travellerIndex: typeof ticket.travelerIndex === 'number' && Number.isInteger(ticket.travelerIndex) && ticket.travelerIndex >= 0 ? ticket.travelerIndex : null})),
  }};
}

/** A send timeout or uncertain provider response can mean Sabre created a PNR. Never retry blindly. */
export type SabreBookingUnknownReason = 'NETWORK_OR_TIMEOUT' | 'HTTP_408' | 'HTTP_429' | 'HTTP_5XX' | 'INVALID_JSON' | 'UNREADABLE_CONFIRMATION';
export class SabreBookingUnknownError extends Error {
  constructor(readonly reason: SabreBookingUnknownReason, readonly httpStatus?: number, readonly diagnostic?: {errors?: BookingRejectionDiagnostic[]; responseKeys?: string[]; confirmationId?: string; bookingId?: string}) {
    super(`Sabre booking result is unknown (${reason}${httpStatus ? `, HTTP ${httpStatus}` : ''})`);
  }
}
export class SabreBookingRejectedError extends Error {
  constructor(message: string, readonly httpStatus?: number, readonly failureCode: 'AGENCY_CONFIGURATION' | 'PROVIDER_REJECTED' = 'PROVIDER_REJECTED', readonly diagnostics: BookingRejectionDiagnostic[] = []) { super(message); }
}
export interface BookingRejectionDiagnostic { category?: string; type?: string; fieldName?: string; fieldPath?: string; description?: string }
function rejectionDiagnostics(value: unknown, body: unknown): BookingRejectionDiagnostic[] {
  const errors = (value as { errors?: unknown } | null)?.errors;
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
    for (const key of ['category','type','fieldName','fieldPath'] as const) {
      if (typeof error[key] === 'string' && /^[A-Za-z0-9_.\[\]/ -]{1,180}$/.test(error[key])) diagnostic[key] = error[key];
    }
    if (typeof error.description === 'string') {
      collect(error.fieldValue);
      let message = error.description;
      for (const entry of [...privateValues].sort((a,b) => b.length-a.length)) message = message.replaceAll(entry, '[redacted]');
      diagnostic.description = message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]').replace(/\+?\d[\d -]{6,}\d/g, '[redacted]').slice(0, 500);
    }
    return diagnostic;
  });
}

/** Retain a safe classification only, never supplier field values or echoed passenger/payment data. */
function rejectionCode(value: unknown): 'AGENCY_CONFIGURATION' | 'PROVIDER_REJECTED' {
  const errors = (value as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) && errors.some(error => error && typeof error === 'object' &&
    ['agencyCustomerNumber', 'ticketingPolicy'].includes(error.fieldName)) ? 'AGENCY_CONFIGURATION' : 'PROVIDER_REJECTED';
}

export class SabreBookingManagementClient {
  constructor(private readonly config: AppConfig, private readonly auth: SabreAuthService,
    private readonly http: typeof fetch = fetch) {}

  private async post(path: 'flightCheck' | 'createBooking' | 'getBooking' | 'cancelBooking' | 'getAncillaries' | 'priceNdcOffer' | 'fulfillFlightTickets' | 'modifyBooking', body: unknown): Promise<unknown> {
    if (this.config.SABRE_ENV !== 'CERT' || this.config.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com') {
      throw new SabreBookingRejectedError('Booking Management requires an approved CERT configuration');
    }
    const mutation = ['createBooking', 'modifyBooking', 'fulfillFlightTickets'].includes(path);
    const token = await this.auth.token();
    let response: Response;
    try {
      const endpoint = path === 'getAncillaries' ? '/v2/offers/getAncillaries'
        : path === 'priceNdcOffer' ? '/v1/offers/price'
        : path === 'flightCheck' ? '/v1/offers/flightCheck' : `/v1/trip/orders/${path}`;
      response = await this.http(`${this.config.SABRE_BASE_URL}${endpoint}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.SABRE_REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch { throw mutation ? new SabreBookingUnknownError('NETWORK_OR_TIMEOUT') :
      new SabreBookingRejectedError('Sabre booking lookup is unavailable'); }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        let failure: unknown;
        try { failure = await response.json(); } catch { /* HTTP status still identifies the uncertain result. */ }
        throw mutation ? new SabreBookingUnknownError(response.status === 408 ? 'HTTP_408' : response.status === 429 ? 'HTTP_429' : 'HTTP_5XX', response.status, {errors:rejectionDiagnostics(failure,body)}) : new SabreBookingRejectedError('Sabre booking lookup is unavailable');
      }
      let failure: unknown;
      try { failure = await response.json(); } catch { /* Status remains sufficient to classify a rejected request. */ }
      throw new SabreBookingRejectedError(`Sabre Booking Management rejected the request (${response.status})`, response.status, rejectionCode(failure), rejectionDiagnostics(failure, body));
    }
    try { return await response.json(); }
    catch { throw mutation ? new SabreBookingUnknownError('INVALID_JSON', response.status) :
      new SabreBookingRejectedError('Sabre booking response could not be verified'); }
  }

  async createBooking(body: ReturnType<typeof buildSabreCreateBooking> | ReturnType<typeof buildSabreCreateNdcBooking>) {
    const result = await this.post('createBooking', body);
    const response = result as { confirmationId?: unknown; booking?: { bookingId?: unknown }; errors?: unknown } | null;
    // Sabre can return HTTP 200 for preflight validation failures. Other errors or any
    // supplied booking identity remain uncertain and must retain the reconciliation lock.
    if (!response?.confirmationId && !response?.booking?.bookingId && Array.isArray(response?.errors) && response.errors.length &&
      response.errors.every(error => error && typeof error === 'object' && error.category === 'BAD_REQUEST' &&
        ['MANDATORY_DATA_MISSING', 'INVALID_VALUE'].includes(error.type))) {
      throw new SabreBookingRejectedError('Sabre rejected reservation validation', 200, rejectionCode(result), rejectionDiagnostics(result, body));
    }
    try { return readSabreCreateBooking(result); }
    catch {
      throw new SabreBookingUnknownError('UNREADABLE_CONFIRMATION', 200, {
        errors: rejectionDiagnostics(result,body),
        responseKeys: result && typeof result === 'object' ? Object.keys(result).filter(key=>/^[A-Za-z_]{1,60}$/.test(key)).slice(0,30) : [],
        ...(typeof response?.confirmationId === 'string' && /^[A-Z0-9]{5,16}$/i.test(response.confirmationId) ? {confirmationId:response.confirmationId} : {}),
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
  async getBookingView(confirmationId: string) {
    return readSabreBookingView(await this.post('getBooking', buildSabreGetBooking(confirmationId)));
  }
  async cancelUnticketedBooking(confirmationId: string) {
    return this.post('cancelBooking', {...buildSabreGetBooking(confirmationId), cancelAll: true, retrieveBooking: true, errorHandlingPolicy: 'HALT_ON_ERROR'});
  }
  async fulfillFlightTickets(confirmationId: string, profile: SabreTicketingProfile, ancillaryIds: string[] = [], entireNdcOrder = false) {
    const form = profile.formOfPayment === 'INVOICE'
      ? { type: profile.formOfPayment, invoiceDescription: profile.invoiceDescription, addInvoiceDescriptionPrefix: false }
      : { type: profile.formOfPayment, cardTypeCode: profile.cardTypeCode, cardNumber: profile.cardNumber,
        cardSecurityCode: profile.cardSecurityCode, expiryDate: profile.expiryDate,
        ...(profile.manualApprovalCode ? { manualApprovalCode: profile.manualApprovalCode } : {}), ...(profile.cardHolder ? { cardHolder: profile.cardHolder } : {}), ...(profile.authentications ? { authentications: profile.authentications } : {}) };
    const result = await this.post('fulfillFlightTickets', { ...buildSabreGetBooking(confirmationId),
      fulfillments: [{ payment: { primaryFormOfPayment: 1 } }, ...(ancillaryIds.length && !entireNdcOrder ? [{ ancillaryIds: [...ancillaryIds], payment: { primaryFormOfPayment: 1 } }] : [])],
      ...(!entireNdcOrder ? { designatePrinters: [{ hardcopy: { address: profile.hardcopyPrinterAddress } }, { ticket: { countryCode: profile.ticketCountryCode } }] } : {}),
      formsOfPayment: [form],
    });
    const errors = (result as Record<string, unknown> | null)?.errors;
    if (!result || typeof result !== 'object' || Array.isArray(result) || errors !== undefined && (!Array.isArray(errors) || errors.length))
      throw new SabreBookingRejectedError('Ticket fulfillment was not confirmed');
    return result;
  }
}
