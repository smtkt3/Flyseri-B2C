import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@flyseri/config';
import type { FlightOffer } from '@flyseri/types';
import type { SabreAuthService } from './sabre-auth.service.js';
import { buildBookingFlightCheck, buildSabreCreateBooking, buildSabreGetBooking,
  readSabreCreateBooking, readSabreGetBooking, SabreBookingManagementClient, SabreBookingUnknownError,
  selectCheckedAtpcoOffer } from './sabre-booking-management.client.js';

const offer = { offerId: 'offer', totalAmount: '650.00', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { stops: 0, durationMinutes: 90, segments: [{ origin: 'KUL', destination: 'PEN',
    departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T10:30:00+08:00',
    marketingCarrier: 'MH', operatingCarrier: 'MH', flightNumber: '1122', bookingClass: 'K', durationMinutes: 90 }] },
  inbound: null } satisfies FlightOffer;
const agency = { address: { name: 'Configured Agency', street: 'Street', city: 'City', stateProvince: 'State',
  postalCode: '00000', countryCode: 'MY', freeText: 'Configured Agency' }, agencyCustomerNumber: '123', ticketingPolicy: 'TODAY' };
const billingAddress = { name: 'Billing contact', street: 'Street', city: 'City', stateProvince: 'State',
  postalCode: '00000', countryCode: 'MY' };

describe('Booking Management 2026.08 ATPCO boundary', () => {
  it('maps the supplied FlightCheck and CreateBooking shapes without claiming a ticket', () => {
    expect(buildBookingFlightCheck(offer, 1)).toEqual({ journeys: [{ flights: [{ departureAirportCode: 'KUL',
      departureDate: '2026-12-10', departureTime: '09:00', arrivalAirportCode: 'PEN', arrivalDate: '2026-12-10',
      arrivalTime: '10:30', operatingAirlineCode: 'MH', operatingFlightNumber: 1122,
      marketingAirlineCode: 'MH', marketingFlightNumber: 1122 }] }], travelers: [{ passengerTypeCode: 'ADT' }] });
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency, billingAddress);
    expect(body.flightDetails).toEqual({ flights: [{ flightNumber: 1122, airlineCode: 'MH', fromAirportCode: 'KUL',
      toAirportCode: 'PEN', departureDate: '2026-12-10', departureTime: '09:00', bookingClass: 'K', flightStatusCode: 'NN' }],
      flightPricing: [{}] });
    expect(body).not.toHaveProperty('ticketing');
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
      { email: 'test@example.invalid', phone: '+60123456789' }, agency, billingAddress);
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
      { email: 'test@example.invalid', phone: '+60123456789' }, agency, billingAddress);
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
