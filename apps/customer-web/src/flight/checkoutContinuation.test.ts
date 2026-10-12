import { describe, expect, it } from 'vitest';
import { checkoutPassengerError, closestCheckoutFare } from './checkoutContinuation';
import type { FlightOffer } from '@flyseri/types';

const adult = { kind: 'Adult', givenNames: 'Test', surname: 'Traveler', gender: 'MALE', birthDate: '1990-01-01', nationality: 'MY' };
describe('traveler age checks before checkout', () => {
  it('allows complete adult details without collecting unused ID numbers', () => {
    expect(checkoutPassengerError(adult, '2026-11-18', '2026-11-30')).toBeNull();
  });
  it('rejects invalid dates and passenger categories before saving a profile', () => {
    expect(checkoutPassengerError({ ...adult, birthDate: '1990-02-31' }, '2026-11-18', '2026-11-30')).toContain('valid date');
    expect(checkoutPassengerError({ ...adult, birthDate: '2020-01-01' }, '2026-11-18', '2026-11-30')).toContain('selected adult');
  });
  it('handles birthdays during travel, including lap infants', () => {
    expect(checkoutPassengerError({ ...adult, kind: 'Child', birthDate: '2014-11-20' }, '2026-11-18', '2026-11-30')).toContain('changes age category');
    expect(checkoutPassengerError({ ...adult, kind: 'Infant', birthDate: '2024-11-20' }, '2026-11-18', '2026-11-30')).toContain('changes age category');
    expect(checkoutPassengerError({ ...adult, kind: 'Child', birthDate: '2014-11-18' }, '2026-11-18', '2026-11-30')).toContain('selected child');
  });
});

it('ranks the nearest class on the same flight above another cabin or a cheaper different flight',()=>{
  const original:FlightOffer={offerId:'old',totalAmount:'4349',currency:'BDT',cabin:'ECONOMY',airlineCodes:['BG'],baggageSummary:null,inbound:null,outbound:{stops:0,durationMinutes:75,segments:[{origin:'DAC',destination:'CXB',departureAt:'2027-01-24T08:00:00+06:00',arrivalAt:'2027-01-24T09:15:00+06:00',marketingCarrier:'BG',flightNumber:'535',bookingClass:'G',durationMinutes:75}]}};
  const alternative={...original,offerId:'nearby-class',totalAmount:'5000',outbound:{...original.outbound,segments:[{...original.outbound.segments[0]!,bookingClass:'Y'}]}};
  const otherFlight={...alternative,offerId:'different-flight',totalAmount:'4000',outbound:{...alternative.outbound,segments:[{...alternative.outbound.segments[0]!,flightNumber:'537'}]}};
  const otherCabin={...alternative,offerId:'business',cabin:'BUSINESS' as const,totalAmount:'4400'};
  expect(closestCheckoutFare(original,[otherFlight,otherCabin,alternative])?.offerId).toBe('nearby-class');
  expect(closestCheckoutFare(original,[otherFlight])).toBeUndefined();
  expect(closestCheckoutFare(original,[{...alternative,currency:'USD'}])).toBeUndefined();
});
