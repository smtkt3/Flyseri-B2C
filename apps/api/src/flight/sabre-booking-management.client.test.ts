import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@flyseri/config';
import type { FlightOffer } from '@flyseri/types';
import type { SabreAuthService } from './sabre-auth.service.js';
import { buildBookingFlightCheck, buildSabreCreateBooking, buildSabreCreateNdcBooking, buildSabreGetBooking,
  readSabreCreateBooking, readSabreGetBooking, SabreBookingManagementClient, SabreBookingUnknownError,
  selectCheckedAtpcoOffer } from './sabre-booking-management.client.js';

const offer = { offerId: 'offer', totalAmount: '650.00', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { stops: 0, durationMinutes: 90, segments: [{ origin: 'KUL', destination: 'PEN',
    departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T10:30:00+08:00',
    marketingCarrier: 'MH', operatingCarrier: 'MH', flightNumber: '1122', bookingClass: 'K', durationMinutes: 90 }] },
  inbound: null } satisfies FlightOffer;
const agency = { address: { name: 'Configured Agency', street: 'Street', city: 'City', stateProvince: 'State',
  postalCode: '00000', countryCode: 'MY', freeText: 'Configured Agency' }, agencyCustomerNumber: '123', ticketingPolicy: 'TODAY' };

describe('Booking Management 2026.08 ATPCO boundary', () => {
  it('preserves NDC traveler gender, assistance and infant associations with priced passenger IDs', () => {
    const context = { offerId:'priced-offer', offerItemIds:['priced-item'], expiresAt:new Date(Date.now()+60000).toISOString(),
      passengers:[{passengerId:'adult-id',passengerTypeCode:'ADT' as const},{passengerId:'infant-id',passengerTypeCode:'INF' as const}] };
    const body = buildSabreCreateNdcBooking(context, [
      {givenName:'Adult',surname:'Traveler',birthDate:'1990-01-01',passengerCode:'ADT',gender:'X',infantTravelerIndex:2,specialServices:[{code:'WCHR',flightIndices:[1]}]},
      {givenName:'Infant',surname:'Traveler',birthDate:'2026-01-01',passengerCode:'INF',gender:'FEMALE'},
    ], {email:'test@example.invalid',phone:'+60123456789'}, agency);
    expect(body.travelers[0]).toMatchObject({id:'adult-id',gender:'UNDEFINED',infantTravelerIndex:2,specialServices:[{code:'WCHR',flightIndices:[1]}],identityDocuments:[{gender:'UNDEFINED'}]});
    expect(body.travelers[1]).toMatchObject({id:'infant-id',gender:'FEMALE'});
    expect(body.travelers[1]).not.toHaveProperty('infantTravelerIndex');
    expect(body).not.toHaveProperty('payment');
    expect(()=>buildSabreCreateNdcBooking({...context,expiresAt:'invalid'},[],{email:'test@example.invalid',phone:'+60123456789'},agency)).toThrow();
  });

  it('translates profile gender X to the documented Sabre identity-document value', () => {
    const body = buildSabreCreateBooking(offer, [{givenName:'Test',surname:'Traveler',birthDate:'1990-01-01',passengerCode:'ADT',
      identityDocuments:[{documentType:'PASSPORT',documentNumber:'TEST00001',expiryDate:'2030-01-01',issuingCountryCode:'MY',residenceCountryCode:'MY',givenName:'Test',surname:'Traveler',birthDate:'1990-01-01',gender:'X'}]}],
      {email:'test@example.invalid',phone:'+60123456789'},agency);
    expect(body.travelers[0]?.identityDocuments?.[0]?.gender).toBe('UNDEFINED');
  });

  it('maps the supplied FlightCheck and CreateBooking shapes without claiming a ticket', () => {
    expect(buildBookingFlightCheck(offer, 1)).toEqual({ journeys: [{ flights: [{ departureAirportCode: 'KUL',
      departureDate: '2026-12-10', departureTime: '09:00', arrivalAirportCode: 'PEN', arrivalDate: '2026-12-10',
      arrivalTime: '10:30', operatingAirlineCode: 'MH', operatingFlightNumber: 1122,
      marketingAirlineCode: 'MH', marketingFlightNumber: 1122 }] }], travelers: [{ passengerTypeCode: 'ADT' }] });
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);
    expect(body.flightDetails).toEqual({ flights: [{ flightNumber: 1122, airlineCode: 'MH', fromAirportCode: 'KUL',
      toAirportCode: 'PEN', departureDate: '2026-12-10', departureTime: '09:00', bookingClass: 'K', flightStatusCode: 'NN' }],
      flightPricing: [{qualifiers:{currencyPricing:'MYR'},priceComparisons:[
        {desiredAmount:'650.00',comparisonType:'INCREASE_BY_AMOUNT',amount:'0.00'},
        {desiredAmount:'650.00',comparisonType:'DECREASE_BY_AMOUNT',amount:'0.00'},
      ]}] });
    expect(body).not.toHaveProperty('ticketing');
    expect(body).not.toHaveProperty('payment');
    const repriced = buildSabreCreateBooking(offer,[{givenName:'Test',surname:'Flyer',birthDate:'1990-01-01',passengerCode:'ADT'}],
      {email:'test@example.invalid',phone:'+60123456789'},agency,{currency:'BDT',totalAmount:'10198.00'});
    expect(repriced.flightDetails.flightPricing[0]?.qualifiers.currencyPricing).toBe('BDT');
    expect(repriced.flightDetails.flightPricing[0]?.priceComparisons.every(comparison => comparison.desiredAmount==='10198.00')).toBe(true);
    expect(readSabreCreateBooking({ confirmationId: 'ABC123', booking: { bookingId: 'booking-123' } }))
      .toEqual({ confirmationId: 'ABC123', sabreBookingId: 'booking-123' });
    expect(buildSabreGetBooking('ABC123')).toEqual({ confirmationId: 'ABC123' });
    expect(readSabreGetBooking({ bookingId: 'booking-123' })).toEqual({ bookingId: 'booking-123' });
  });

  it('rejects unknown codeshare flight numbers and missing PNR confirmations', () => {
    expect(() => buildBookingFlightCheck({ ...offer, outbound: { ...offer.outbound,
      segments: [{ ...offer.outbound.segments[0]!, operatingCarrier: 'FY' }] } }, 1)).toThrow(/Operating flight number/);
    expect(() => readSabreCreateBooking({ booking: { bookingId: 'booking-123' } })).toThrow();
    expect(() => buildSabreGetBooking('arbitrary locator')).toThrow();
  });

  it('sends CreateBooking only once on timeout and treats the outcome as unknown', async () => {
    const http = vi.fn(async () => { throw new Error('timeout'); });
    const config = { SABRE_ENV: 'CERT', SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig;
    const auth = { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService;
    const client = new SabreBookingManagementClient(config, auth, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);
    await expect(client.createBooking(body)).rejects.toBeInstanceOf(SabreBookingUnknownError);
    expect(http).toHaveBeenCalledOnce();
  });

  it.each([408, 429, 500, 503, 200])('preserves uncertainty without a second supplier submission for HTTP %s failure', async status => {
    const http = vi.fn(async () => new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'SABRE_COMMAND_FAILURE',description:'General problem with SabreCommandLLSRQ service.'}]}),{status}));
    const client = new SabreBookingManagementClient({SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,
      {token:vi.fn(async ()=>'test-token')} as unknown as SabreAuthService, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer,[{givenName:'Test',surname:'Traveler',birthDate:'1990-01-01',passengerCode:'ADT'}],{email:'test@example.invalid',phone:'+60123456789'},agency);
    await expect(client.createBooking(body)).rejects.toBeInstanceOf(SabreBookingUnknownError);
    expect(http).toHaveBeenCalledOnce();
  });

  it('uses the collection FlightCheck endpoint with a server OAuth token', async () => {
    const http = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ journeys: [] }), { status: 200 }));
    const config = { SABRE_ENV: 'CERT', SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig;
    const auth = { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService;
    const client = new SabreBookingManagementClient(config, auth, http as unknown as typeof fetch);
    await client.flightCheck(offer, 1);
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0]?.[0]).toBe('https://api.cert.platform.sabre.com/v1/offers/flightCheck');
    expect(auth.token).toHaveBeenCalledOnce();
  });

  it('maps successful mocked CreateBooking and GetBooking without a payment or ticketing operation', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const http = vi.fn(async (url: string, options: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(options.body)) });
      return new Response(JSON.stringify(url.endsWith('/createBooking') ?
        { confirmationId: 'ABC123', booking: { bookingId: 'booking-123' } } : { bookingId: 'booking-123' }), { status: 200 });
    });
    const config = { SABRE_ENV: 'CERT', SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig;
    const auth = { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService;
    const client = new SabreBookingManagementClient(config, auth, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);
    const created = await client.createBooking(body);
    const refreshed = await client.getBooking(created.confirmationId);
    expect(created).toEqual({ confirmationId: 'ABC123', sabreBookingId: 'booking-123' });
    expect(refreshed).toEqual({ bookingId: 'booking-123' });
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.cert.platform.sabre.com/v1/trip/orders/createBooking',
      'https://api.cert.platform.sabre.com/v1/trip/orders/getBooking',
    ]);
    expect(requests[0]?.body).not.toHaveProperty('fulfillFlightTickets');
  });

  it('selects the exact booking class from CERT FlightCheck rather than its misleading validation label', () => {
    const selected = { ...offer, outbound: { ...offer.outbound,
      segments: [{ ...offer.outbound.segments[0]!, bookingClass: 'Q' }] } };
    const response = { offers: [
      { id: 'higher-class', source: { distributionModel: 'ATPCO' }, applicableToPseudoCityCodes: ['TEST'],
        validUntil: '2026-12-31T00:00:00Z', totalPrice: { amount: '43312', currencyCode: 'BDT' },
        items: [{ fares: [{ fareComponents: [{ segmentDetails: [{ bookingClassCode: 'Y' }] }] }] }] },
      { id: 'selected-class', source: { distributionModel: 'ATPCO' }, applicableToPseudoCityCodes: ['TEST'],
        validUntil: '2026-12-31T00:00:00Z', totalPrice: { amount: '9270', currencyCode: 'BDT' },
        items: [{ fares: [{ fareComponents: [{ segmentDetails: [{ bookingClassCode: 'Q' }] }] }] }] },
    ], offerValidationResults: [
      { bookingClassCodeValidation: 'Matched', offerRef: 'higher-class' },
      { bookingClassCodeValidation: 'Same cabin', offerRef: 'selected-class' },
    ] };
    expect(selectCheckedAtpcoOffer(response, selected, 'TEST', Date.parse('2026-09-30T00:00:00Z')))
      .toEqual({ offerId: 'selected-class', totalAmount: '9270', currency: 'BDT', validUntil: '2026-12-31T00:00:00Z' });
    expect(() => selectCheckedAtpcoOffer(response, selected, 'OTHER', Date.parse('2026-09-30T00:00:00Z'))).toThrow();
  });
});
