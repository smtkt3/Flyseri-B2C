import type { FlightBaggageAllowance, FlightLeg, FlightOffer, FlightPenalty, FlightSegment } from '@flyseri/types';
import { parseFlightPriceBreakdown } from './flight-price-breakdown.js';

const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 120): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
const minutes = (value: unknown): number | null | undefined => value === null ? null : Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10000 ? value as number : undefined;
function segment(value: unknown): FlightSegment | null {
  const row = object(value); if (!row) return null;
  const origin = text(row.origin, 3), destination = text(row.destination, 3), departureAt = text(row.departureAt, 40), arrivalAt = text(row.arrivalAt, 40);
  const marketingCarrier = text(row.marketingCarrier, 3), flightNumber = text(row.flightNumber, 8), durationMinutes = minutes(row.durationMinutes);
  if (!origin || !destination || !departureAt || !arrivalAt || !marketingCarrier || !flightNumber || durationMinutes === undefined ||
    !/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !/^\d{4}-\d{2}-\d{2}T/.test(departureAt) || !/^\d{4}-\d{2}-\d{2}T/.test(arrivalAt)) return null;
  const bookingClass = row.bookingClass === undefined ? undefined : text(row.bookingClass, 2);
  const aircraftTypeCode = text(row.aircraftTypeCode, 4);
  const operatingCarrier = row.operatingCarrier === undefined ? undefined : text(row.operatingCarrier, 3);
  const seatsAvailable = row.seatsAvailable;
  if (seatsAvailable !== undefined && (!Number.isInteger(seatsAvailable) || (seatsAvailable as number) < 0 || (seatsAvailable as number) > 999)) return null;
  if (row.bookingClass !== undefined && (!bookingClass || !/^[A-Z0-9]{1,2}$/.test(bookingClass)) ||
    row.operatingCarrier !== undefined && (!operatingCarrier || !/^[A-Z0-9]{2,3}$/.test(operatingCarrier))) return null;
  return { origin, destination, departureAt, arrivalAt, marketingCarrier, flightNumber, durationMinutes,
    ...(seatsAvailable !== undefined ? { seatsAvailable: seatsAvailable as number } : {}),
    ...(bookingClass ? { bookingClass } : {}), ...(aircraftTypeCode && /^[A-Z0-9]{2,4}$/.test(aircraftTypeCode) ? { aircraftTypeCode } : {}),
    ...(operatingCarrier ? { operatingCarrier } : {}) };
}
function leg(value: unknown): FlightLeg | null {
  const row = object(value); if (!row || !Array.isArray(row.segments) || row.segments.length < 1 || row.segments.length > 10) return null;
  const segments = row.segments.map(segment);
  const durationMinutes = minutes(row.durationMinutes);
  if (segments.some((item) => !item) || durationMinutes === undefined || row.stops !== segments.length - 1) return null;
  return { segments: segments as FlightSegment[], durationMinutes, stops: segments.length - 1 };
}
function fareDetails(row: Record<string, unknown>): Pick<FlightOffer, 'itineraryKey' | 'cabin' | 'fareBrand' | 'fareBrandCode' | 'baggageCharge' | 'amenities' | 'baggageAllowances' | 'penalties' | 'nonRefundable'> | null {
  const itineraryKey = row.itineraryKey === undefined ? undefined : text(row.itineraryKey, 80);
  const cabin = row.cabin === undefined || row.cabin === null ? null :
    ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST', 'MIXED'].includes(String(row.cabin)) ? row.cabin as FlightOffer['cabin'] : undefined;
  const fareBrand = row.fareBrand === undefined || row.fareBrand === null ? null : text(row.fareBrand, 80);
  const fareBrandCode = row.fareBrandCode === undefined || row.fareBrandCode === null ? null : text(row.fareBrandCode, 12);
  const charge = row.baggageCharge === undefined || row.baggageCharge === null ? null : object(row.baggageCharge);
  const baggageCharge = charge ? { amount: text(charge.amount, 24), currency: text(charge.currency, 3),
    description: charge.description === null ? null : text(charge.description, 100) } : null;
  const baggageAllowances = row.baggageAllowances === undefined ? [] : Array.isArray(row.baggageAllowances) && row.baggageAllowances.length <= 60
    ? row.baggageAllowances.map(object) : null;
  const penalties = row.penalties === undefined ? [] : Array.isArray(row.penalties) && row.penalties.length <= 4
    ? row.penalties.map(object) : null;
  const nonRefundable = row.nonRefundable === undefined || row.nonRefundable === null ? null
    : typeof row.nonRefundable === 'boolean' ? row.nonRefundable : undefined;
  const amenities = row.amenities === undefined ? [] : Array.isArray(row.amenities) && row.amenities.length <= 720 ? row.amenities.map(object) : null;
  const validBaggageAllowances = baggageAllowances?.map((item) => {
    if (!item || !['PERSONAL_ITEM', 'CARRY_ON', 'CHECKED'].includes(String(item.type)) ||
      !['INCLUDED', 'FOR_FEE', 'NOT_INCLUDED', 'UNKNOWN'].includes(String(item.availability)) ||
      item.description !== null && !text(item.description, 120) || !Array.isArray(item.segmentIndexes) || item.segmentIndexes.length > 60 ||
      item.segmentIndexes.some((index) => !Number.isInteger(index) || (index as number) < 0 || (index as number) >= 60)) return null;
    return { type: item.type, availability: item.availability, description: item.description,
      segmentIndexes: [...new Set(item.segmentIndexes as number[])] } as FlightBaggageAllowance;
  });
  const validPenalties = penalties?.map((item) => {
    if (!item || !['REFUND', 'CHANGE'].includes(String(item.type)) || !['BEFORE', 'AFTER'].includes(String(item.applicability)) ||
      typeof item.allowed !== 'boolean' || item.amount !== null && (!text(item.amount, 24) || !/^\d+(\.\d{1,2})?$/.test(item.amount as string)) ||
      item.currency !== null && (!text(item.currency, 3) || !/^[A-Z]{3}$/.test(item.currency as string)) ||
      item.amount !== null && item.currency === null && !(item.allowed && item.amount === '0.00') || item.amount === null && item.currency !== null) return null;
    return { type: item.type, applicability: item.applicability, allowed: item.allowed,
      amount: item.amount, currency: item.currency } as FlightPenalty;
  });
  if (row.itineraryKey !== undefined && (!itineraryKey || !/^[0-9]+:[0-9]+$/.test(itineraryKey)) || cabin === undefined ||
    row.fareBrand != null && !fareBrand || row.fareBrandCode != null && !fareBrandCode || row.baggageCharge != null && !charge ||
    charge && (!baggageCharge?.amount || !/^\d+(\.\d{1,2})?$/.test(baggageCharge.amount) ||
      !baggageCharge.currency || !/^[A-Z]{3}$/.test(baggageCharge.currency) || charge.description != null && !baggageCharge.description) ||
    !validBaggageAllowances || validBaggageAllowances.some((item) => !item) || !validPenalties || validPenalties.some((item) => !item) || nonRefundable === undefined ||
    !amenities || amenities.some((item) => !item || !['WIFI', 'ENTERTAINMENT', 'MEALS', 'BAGGAGE'].includes(String(item.category)) ||
      !text(item.name, 80) || !['INCLUDED', 'FOR_FEE', 'NOT_INCLUDED', 'UNKNOWN'].includes(String(item.availability)) ||
      item.segmentIndexes !== undefined && (!Array.isArray(item.segmentIndexes) || item.segmentIndexes.length > 60 ||
        item.segmentIndexes.some((index) => !Number.isInteger(index) || (index as number) < 0 || (index as number) >= 60)))) return null;
  return { ...(itineraryKey ? { itineraryKey } : {}), cabin, fareBrand, fareBrandCode,
    baggageCharge: baggageCharge as FlightOffer['baggageCharge'], amenities: amenities as NonNullable<FlightOffer['amenities']>,
    baggageAllowances: validBaggageAllowances as FlightBaggageAllowance[], penalties: validPenalties as FlightPenalty[], nonRefundable };
}
/** Rebuilds the public DTO; supplier or cache-only fields cannot pass through. */
export function parseFlightOffers(value: unknown): FlightOffer[] | null {
  if (!Array.isArray(value) || value.length > 2000) return null;
  const offers: FlightOffer[] = [];
  for (const item of value) {
    const row = object(item); if (!row) return null;
    const offerId = text(row.offerId, 80), totalAmount = text(row.totalAmount, 24), currency = text(row.currency, 3), outbound = leg(row.outbound);
    const inbound = row.inbound === null ? null : leg(row.inbound);
    const multiCityLegs = row.multiCityLegs === undefined ? undefined : Array.isArray(row.multiCityLegs) && row.multiCityLegs.length >= 2 && row.multiCityLegs.length <= 6
      ? row.multiCityLegs.map(leg) : null;
    const baggageSummary = row.baggageSummary === null ? null : text(row.baggageSummary, 200);
    const details = fareDetails(row);
    const ndc = row.ndcContext === undefined ? undefined : object(row.ndcContext);
    if (row.ndcContext !== undefined && (!ndc || !text(ndc.offerId, 160) || /\s/.test(ndc.offerId as string) ||
      ndc.offerItemIds !== undefined && (!Array.isArray(ndc.offerItemIds) || ndc.offerItemIds.length > 60 ||
        ndc.offerItemIds.some(value => !text(value, 160) || /\s/.test(String(value))) || new Set(ndc.offerItemIds).size !== ndc.offerItemIds.length) ||
      !text(ndc.expiresAt, 40) || !Number.isFinite(Date.parse(ndc.expiresAt as string)) ||
      !Array.isArray(ndc.passengers) || ndc.passengers.length > 9 || ndc.passengers.some((value) => {
        const person = object(value); return !person || !text(person.passengerId, 160) || /\s/.test(person.passengerId as string) ||
          !['ADT', 'CNN', 'INF'].includes(String(person.passengerTypeCode));
      }) || new Set(ndc.passengers.map((person) => (person as Record<string, unknown>).passengerId)).size !== ndc.passengers.length)) return null;
    if (!offerId || !totalAmount || !currency || !outbound || inbound === null && row.inbound !== null || multiCityLegs === null || multiCityLegs?.some((item) => !item) || baggageSummary === null && row.baggageSummary !== null ||
      !/^\d+(\.\d{1,2})?$/.test(totalAmount) || !/^[A-Z]{3}$/.test(currency) || !Array.isArray(row.airlineCodes) ||
      row.airlineCodes.length > 20 || row.airlineCodes.some((code) => typeof code !== 'string' || !/^[A-Z0-9]{2,3}$/.test(code)) || !details) return null;
    const priceBreakdown = parseFlightPriceBreakdown(row.priceBreakdown, totalAmount, currency);
    offers.push({ offerId, totalAmount, currency, ...(priceBreakdown && { priceBreakdown }), outbound, inbound, ...(multiCityLegs ? { multiCityLegs: multiCityLegs as FlightLeg[] } : {}), baggageSummary, airlineCodes: [...row.airlineCodes] as string[], ...details,
      ...(ndc ? { ndcContext: { offerId: ndc.offerId as string, expiresAt: ndc.expiresAt as string,
        ...(ndc.offerItemIds !== undefined ? { offerItemIds: [...ndc.offerItemIds as string[]] } : {}),
        passengers: (ndc.passengers as NonNullable<FlightOffer['ndcContext']>['passengers']).map((person) => ({ passengerId: person.passengerId, passengerTypeCode: person.passengerTypeCode })) } } : {}) });
  }
  return offers;
}
