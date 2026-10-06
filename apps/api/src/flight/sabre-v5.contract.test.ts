import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@flyseri/config';
import type { FlightBookingIntent } from '@flyseri/types';
import type { NormalizedFlightSearch } from './flight-search.js';
import { buildSabreBfmV5Request, buildSabreRevalidateV5Request, mapSabreV5Offers } from './sabre-v5.contract.js';
import { SabreRevalidateClient } from './sabre-revalidate.client.js';
import type { SabreAuthService } from './sabre-auth.service.js';
import { parseFlightOffers } from './flight-response.js';

const search: NormalizedFlightSearch = { origin: 'KUL', destination: 'BKK', departureDate: '2026-11-15', tripType: 'ONE_WAY',
  adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };
const gir = (price: number, subsource = 'HPIS') => ({ groupedItineraryResponse: {
  version: '7.2.2', scheduleDescs: [{ id: 1, stopCount: 0, elapsedTime: 135,
    departure: { airport: 'KUL', time: '15:10:00+08:00' }, arrival: { airport: 'BKK', time: '16:25:00+07:00' },
    carrier: { marketing: 'H1', operating: 'H1', marketingFlightNumber: 4783, equipment: { code: 'E75' } } }],
  legDescs: [{ id: 1, elapsedTime: 135, schedules: [{ ref: 1 }] }], baggageAllowanceDescs: [{ id: 1, pieceCount: 0 }],
  itineraryGroups: [{ groupDescription: { legDescriptions: [{ departureDate: '2026-11-15', departureLocation: 'KUL', arrivalLocation: 'BKK' }] },
    itineraries: [{ id: 1, pricingSource: 'ADVJR1', legs: [{ ref: 1 }], pricingInformation: [{ pricingSubsource: subsource,
      fare: { totalFare: { totalPrice: price, currency: 'MYR' }, passengerInfoList: [{ passengerInfo: { passengerType: 'ADT',
        fareComponents: [{ segments: [{ segment: { bookingCode: 'K' } }] }], baggageInformation: [{ allowance: { ref: 1 } }] } }] } }] }] }] } });

describe('Sabre REST v5 documented contract', () => {
  it('preserves actual per-passenger unit fares only when their quantities reconcile with all ticket totals', () => {
    const response = gir(576);
    const fare = response.groupedItineraryResponse.itineraryGroups[0]!.itineraries[0]!.pricingInformation[0]!.fare;
    Object.assign(fare.totalFare, { baseFareAmount: 272, baseFareCurrency: 'MYR', totalTaxAmount: 304 });
    Object.assign(fare.passengerInfoList[0]!.passengerInfo, { passengerNumber: 2, passengerTotalFare: { totalFare: 288, totalTaxAmount: 152, currency: 'MYR', baseFareAmount: 136, baseFareCurrency: 'MYR' } });
    const mapped = mapSabreV5Offers(response);
    expect(mapped[0]?.priceBreakdown?.passengerPrices).toEqual([{ passengerType: 'ADT', count: 2, baseFareAmount: '136.00', taxesAndFeesAmount: '152.00', totalAmount: '288.00', currency: 'MYR' }]);
    expect(parseFlightOffers(mapped)?.[0]?.priceBreakdown?.passengerPrices).toEqual(mapped[0]?.priceBreakdown?.passengerPrices);
    Object.assign(fare.passengerInfoList[0]!.passengerInfo, { passengerNumber: 3 });
    const inconsistent = mapSabreV5Offers(response)[0];
    expect(inconsistent?.priceBreakdown?.passengerPrices).toBeUndefined();
    expect(inconsistent?.priceBreakdown?.baseFareAmount).toBe('272.00');
  });
  it('uses the equivalent base fare in the quoted currency and preserves a reconciled breakdown in the public response', () => {
    const response = gir(234);
    const total = response.groupedItineraryResponse.itineraryGroups[0]!.itineraries[0]!.pricingInformation[0]!.fare.totalFare;
    Object.assign(total, { baseFareAmount: 40, baseFareCurrency: 'USD', equivalentAmount: 180, equivalentCurrency: 'MYR', totalTaxAmount: 54 });
    const offers = mapSabreV5Offers(response);
    expect(offers[0]?.priceBreakdown).toEqual({ baseFareAmount: '180.00', taxesAndFeesAmount: '54.00', currency: 'MYR' });
    expect(parseFlightOffers(offers)?.[0]?.priceBreakdown).toEqual(offers[0]?.priceBreakdown);
    Object.assign(total, { equivalentCurrency: 'USD' });
    expect(mapSabreV5Offers(response)[0]?.priceBreakdown).toBeUndefined();
  });
  it('omits inconsistent price components without hiding an otherwise valid fare', () => {
    const response = gir(234);
    const total = response.groupedItineraryResponse.itineraryGroups[0]!.itineraries[0]!.pricingInformation[0]!.fare.totalFare;
    Object.assign(total, { baseFareAmount: 180, baseFareCurrency: 'MYR', totalTaxAmount: 53.99 });
    const offers = mapSabreV5Offers(response);
    expect(offers[0]?.totalAmount).toBe('234.00');
    expect(offers[0]?.priceBreakdown).toBeUndefined();
    const parsed = parseFlightOffers([{ ...offers[0], priceBreakdown: { baseFareAmount: '180.00', taxesAndFeesAmount: '53.99', currency: 'MYR' } }]);
    expect(parsed?.[0]?.priceBreakdown).toBeUndefined();
  });
  it('builds a BFM v5 request with PCC, passenger and requested currency', () => {
    const request = buildSabreBfmV5Request(search, { SABRE_PCC: 'TEST' }) as { OTA_AirLowFareSearchRQ: Record<string, unknown> };
    expect(request.OTA_AirLowFareSearchRQ).toMatchObject({ Version: '5', POS: { Source: [{ PseudoCityCode: 'TEST' }] },
      TravelPreferences: { Baggage: { RequestType: 'A', Description: true, CarryOnInfo: true } },
      TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }],
        PriceRequestInformation: {
        CurrencyCode: 'MYR', TPA_Extensions: { BrandedFareIndicators: { MultipleBrandedFares: true, ReturnBrandAncillaries: true, UpsellLimit: 9 } },
      } } });
  });
  it('requests cabin alternatives separately from branded fares as required by CERT', () => {
    const request = buildSabreBfmV5Request(search, { SABRE_PCC: 'TEST' }, 'cabins') as {
      OTA_AirLowFareSearchRQ: { TravelPreferences: { TPA_Extensions: { FlexibleFares: { FareParameters: unknown[] } } };
        TravelerInfoSummary: { PriceRequestInformation: { TPA_Extensions: { BrandedFareIndicators?: unknown } } } } };
    expect(request.OTA_AirLowFareSearchRQ.TravelPreferences.TPA_Extensions.FlexibleFares.FareParameters)
      .toEqual(['Y', 'S', 'C', 'F'].map(Type => ({ Cabin: { Type } })));
    expect(request.OTA_AirLowFareSearchRQ.TravelerInfoSummary.PriceRequestInformation.TPA_Extensions.BrandedFareIndicators).toBeUndefined();
  });
  it('retains fare alternatives after the former 300-offer cutoff', () => {
    const response = gir(125.5);
    const itinerary = response.groupedItineraryResponse.itineraryGroups[0]!.itineraries[0]!;
    const base = itinerary.pricingInformation[0]!;
    itinerary.pricingInformation = Array.from({ length: 350 }, (_, index) => ({ ...base,
      fare: { ...base.fare, totalFare: { totalPrice: 125.5 + index, currency: 'MYR' } } }));
    const offers = mapSabreV5Offers(response);
    expect(offers).toHaveLength(350);
    expect(offers.at(-1)?.totalAmount).toBe('474.50');
  });
  it('preserves all ordered multi-city legs in BFM and revalidation requests', () => {
    const multi: NormalizedFlightSearch = { ...search, origin: 'KUL', destination: 'KUL', departureDate: '2026-11-15', tripType: 'MULTI_CITY',
      legs: [{ origin: 'KUL', destination: 'NRT', departureDate: '2026-11-15' }, { origin: 'NRT', destination: 'KIX', departureDate: '2026-11-19' }, { origin: 'KIX', destination: 'KUL', departureDate: '2026-11-22' }] };
    const request = buildSabreBfmV5Request(multi, { SABRE_PCC: 'TEST' }) as { OTA_AirLowFareSearchRQ: { OriginDestinationInformation: { DepartureDateTime: string; OriginLocation: { LocationCode: string }; DestinationLocation: { LocationCode: string } }[] } };
    expect(request.OTA_AirLowFareSearchRQ.OriginDestinationInformation.map((leg) => [leg.OriginLocation.LocationCode, leg.DestinationLocation.LocationCode, leg.DepartureDateTime]))
      .toEqual([['KUL', 'NRT', '2026-11-15T00:00:00'], ['NRT', 'KIX', '2026-11-19T00:00:00'], ['KIX', 'KUL', '2026-11-22T00:00:00']]);
  });
  it('keeps each priced cabin and maps only referenced baggage and amenities from one response', () => {
    const fare = (price: number, bookingCode: string, cabinCode: string, ref: number, allowance: number) => ({
      pricingSubsource: 'MIP', fare: { totalFare: { totalPrice: price, currency: 'MYR' }, passengerInfoList: [{ passengerInfo: {
        passengerType: 'ADT', fareComponents: [{ ref, segments: [{ segment: { bookingCode, cabinCode } }], brandFeatures: [{ ref: 1 }, { ref: 2 }] }],
        nonRefundable: false, penaltiesInfo: { penalties: [{ type: 'Refund', applicability: 'Before', refundable: false },
          { type: 'Exchange', applicability: 'Before', changeable: false }] },
        baggageInformation: [{ provisionType: 'A', segments: [{ id: 0 }], allowance: { ref: allowance } },
          { provisionType: 'B', segments: [{ id: 0 }], allowance: { ref: 2 } },
          { provisionType: 'C', charge: { ref: 5 } }],
      } }] },
    });
    const rich = { groupedItineraryResponse: {
      scheduleDescs: [{ id: 1, stopCount: 0, elapsedTime: 135, departure: { airport: 'KUL', time: '15:10:00+08:00' },
        arrival: { airport: 'PEN', time: '16:25:00+08:00' }, carrier: { marketing: 'OD', operating: 'OD', marketingFlightNumber: 123 } }],
      legDescs: [{ id: 1, elapsedTime: 135, schedules: [{ ref: 1 }] }],
      fareComponentDescs: [{ id: 10, brand: { code: 'SS', brandName: 'Super Saver' } }, { id: 11, brand: { code: 'FL', brandName: 'Flexible' } }],
      brandFeatureDescs: [{ id: 1, commercialName: 'Wi-Fi', application: 'F' }, { id: 2, commercialName: 'Meal', application: 'C' }],
      baggageAllowanceDescs: [{ id: 1, weight: 0, unit: 'kg' }, { id: 2, pieceCount: 1, weight: 7, unit: 'kg' }, { id: 3, pieceCount: 2 }],
      baggageChargeDescs: [{ id: 5, equivalentAmount: 81, equivalentCurrency: 'MYR', description1: 'UP TO 15 KG' }],
      itineraryGroups: [{ groupDescription: { legDescriptions: [{ departureDate: '2026-11-15' }] }, itineraries: [{ id: 7,
        legs: [{ ref: 1 }], pricingInformation: [fare(125, 'K', 'Y', 10, 1), fare(350, 'C', 'C', 11, 3)] }] }],
    } };
    const offers = mapSabreV5Offers(rich);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ itineraryKey: '0:7', totalAmount: '125.00', cabin: 'ECONOMY', fareBrand: 'Super Saver',
      baggageSummary: 'No checked baggage included', baggageCharge: { amount: '81.00', currency: 'MYR' },
      baggageAllowances: [{ type: 'CHECKED', availability: 'NOT_INCLUDED', description: '0 kg', segmentIndexes: [0] },
        { type: 'CARRY_ON', availability: 'INCLUDED', description: '1 piece · 7 kg', segmentIndexes: [0] }],
      penalties: [{ type: 'REFUND', applicability: 'BEFORE', allowed: false, amount: null, currency: null },
        { type: 'CHANGE', applicability: 'BEFORE', allowed: false, amount: null, currency: null }], nonRefundable: false,
      amenities: [{ category: 'WIFI', availability: 'INCLUDED' }, { category: 'MEALS', availability: 'FOR_FEE' }] });
    expect(offers[1]).toMatchObject({ itineraryKey: '0:7', totalAmount: '350.00', cabin: 'BUSINESS', fareBrand: 'Flexible',
      baggageSummary: '2 pieces checked baggage included' });
    expect(offers[0]?.offerId).not.toBe(offers[1]?.offerId);
  });
  it('joins GIR descriptors, preserves booking class, and excludes unsupported NDC content', () => {
    const [offer] = mapSabreV5Offers(gir(125.5));
    expect(offer).toMatchObject({ totalAmount: '125.50', currency: 'MYR', outbound: { stops: 0,
      segments: [{ origin: 'KUL', destination: 'BKK', bookingClass: 'K', aircraftTypeCode: 'E75', operatingCarrier: 'H1', flightNumber: '4783', arrivalAt: '2026-11-15T16:25:00+07:00' }] } });
    expect(mapSabreV5Offers(gir(125.5, 'NDC'))).toEqual([]);
    expect(() => mapSabreV5Offers({ groupedItineraryResponse: {} })).toThrow();
    const revalidate = buildSabreRevalidateV5Request(offer!, search, 'TEST') as { OTA_AirLowFareSearchRQ: Record<string, unknown> };
    expect(revalidate.OTA_AirLowFareSearchRQ).toMatchObject({ Version: '5', OriginDestinationInformation: [{ TPA_Extensions: {
      Flight: [{ Number: 4783, ClassOfService: 'K', DepartureDateTime: '2026-11-15T15:10:00', ArrivalDateTime: '2026-11-15T16:25:00' }] } }],
    TravelPreferences: { TPA_Extensions: { VerificationItinCallLogic: { Value: 'L' } } },
    TravelerInfoSummary: { PriceRequestInformation: { TPA_Extensions: { BrandedFareIndicators: { SingleBrandedFare: true } } } } });
  });
  it('maps a matched CERT-style revalidation fare and rejects changed itineraries', async () => {
    const [selectedOffer] = mapSabreV5Offers(gir(125.5));
    const intent = { selectedOffer, searchRequest: search, currency: 'MYR' } as FlightBookingIntent;
    const config = { ...parseConfig({ APP_ENV: 'test' }), SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_PCC: 'TEST' };
    const auth = { token: vi.fn(async () => 'mock-token'), invalidate: vi.fn() } as unknown as SabreAuthService;
    const http = vi.fn(async () => new Response(JSON.stringify(gir(130, 'SPMIP')), { status: 200 }));
    const client = new SabreRevalidateClient(config, auth, http as typeof fetch);
    await expect(client.validate(intent, 'request')).resolves.toMatchObject({ result: 'AVAILABLE', currentTotalAmount: '130.00', currency: 'MYR' });
    expect(http.mock.calls).toHaveLength(1);
    const changed = gir(130, 'SPMIP');
    changed.groupedItineraryResponse.scheduleDescs[0]!.carrier.marketingFlightNumber = 999;
    http.mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200 }));
    await expect(client.validate(intent, 'request')).resolves.toMatchObject({ result: 'ITINERARY_CHANGED' });
  });
  it('refreshes an expired REST token once and never retries a persistent 401', async () => {
    const [selectedOffer] = mapSabreV5Offers(gir(125.5));
    const intent = { selectedOffer, searchRequest: search, currency: 'MYR' } as FlightBookingIntent;
    const config = { ...parseConfig({ APP_ENV: 'test' }), SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_PCC: 'TEST' };
    const auth = { token: vi.fn().mockResolvedValueOnce('old-token').mockResolvedValue('new-token'), invalidate: vi.fn(async () => {}) } as unknown as SabreAuthService;
    const http = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(gir(130, 'SPMIP')), { status: 200 }));
    const client = new SabreRevalidateClient(config, auth, http as typeof fetch);
    await expect(client.validate(intent, 'request')).resolves.toMatchObject({ result: 'AVAILABLE', currentTotalAmount: '130.00' });
    expect(auth.invalidate).toHaveBeenCalledWith('old-token');
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer old-token' } });
    expect(http.mock.calls[1]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer new-token' } });
    http.mockReset().mockResolvedValue(new Response('', { status: 401 }));
    await expect(client.validate(intent, 'request')).rejects.toMatchObject({ status: 503 });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('handles supplier timeout, failure, malformed body and unavailable fare safely', async () => {
    const [selectedOffer] = mapSabreV5Offers(gir(125.5));
    const intent = { selectedOffer, searchRequest: search, currency: 'MYR' } as FlightBookingIntent;
    const config = { ...parseConfig({ APP_ENV: 'test' }), SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_PCC: 'TEST' };
    const auth = { token: vi.fn(async () => 'mock-token'), invalidate: vi.fn(async () => {}) } as unknown as SabreAuthService;
    const http = vi.fn();
    const client = new SabreRevalidateClient(config, auth, http as typeof fetch);
    http.mockRejectedValueOnce(new Error('timeout'));
    await expect(client.validate(intent, 'request')).rejects.toMatchObject({ status: 503 });
    http.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(client.validate(intent, 'request')).rejects.toMatchObject({ status: 503 });
    http.mockResolvedValueOnce(new Response('{', { status: 200 }));
    await expect(client.validate(intent, 'request')).rejects.toMatchObject({ status: 503 });
    http.mockResolvedValueOnce(new Response(JSON.stringify(gir(130, 'NDC')), { status: 200 }));
    await expect(client.validate(intent, 'request')).resolves.toMatchObject({ result: 'UNAVAILABLE' });
    const otherCurrency = gir(130, 'SPMIP');
    otherCurrency.groupedItineraryResponse.itineraryGroups[0]!.itineraries[0]!.pricingInformation[0]!.fare.totalFare.currency = 'USD';
    http.mockResolvedValueOnce(new Response(JSON.stringify(otherCurrency), { status: 200 }));
    await expect(client.validate(intent, 'request')).resolves.toMatchObject({ result: 'AVAILABLE', currency: 'USD', currentTotalAmount: '130.00' });
  });
});
