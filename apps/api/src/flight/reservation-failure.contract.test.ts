import {expect,it} from 'vitest';
import type {FlightOffer} from '@flyseri/types';
import {reservationFailureMessage} from './reservation-failure.contract.js';

const id='1b20312d-22fc-4f34-9ab7-2f298578173e';
const offer={outbound:{segments:[{marketingCarrier:'MH',flightNumber:'0197'}]},inbound:null} as unknown as FlightOffer;
const diagnostic=(value:unknown,bookingId=id)=>`flight.booking.unknown-diagnostic:${bookingId}:${JSON.stringify(value)}`;
it('explains a recorded unconfirmed sell without leaking provider text or suggesting a retry',()=>{
 const message=reservationFailureMessage(diagnostic({errors:[{category:'APPLICATION_ERROR',type:'UNABLE_TO_BOOK_FLIGHTS_WRONG_STATUS_CODE',description:'Private passenger and contact details',fieldPath:'CreateBookingRequest.flightDetails.flights[0]'}]}),id,offer);
 expect(message).toContain('MH197');
 expect(message).toContain('reservation check before booking again');
 expect(message).not.toContain('Private');
});
it.each([
 null,
 'flight.booking.unknown-diagnostic:'+id+':broken-json',
 diagnostic({errors:[{category:'APPLICATION_ERROR',type:'UNABLE_TO_BOOK_FLIGHTS_WRONG_STATUS_CODE'}]},'another-booking'),
 diagnostic({reason:'NETWORK_OR_TIMEOUT'}),
 diagnostic({errors:[{category:'APPLICATION_ERROR',type:'INTERNAL_SERVER_ERROR'}]}),
])('does not invent an airline sell failure from other evidence: %s',event=>{
 expect(reservationFailureMessage(event,id,offer)).toBeUndefined();
});
