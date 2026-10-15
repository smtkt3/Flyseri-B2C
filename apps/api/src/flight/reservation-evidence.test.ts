import { describe,expect,it } from 'vitest';
import type { FlightOffer,FlightBookingProviderView } from '@flyseri/types';
import { hasIssuedTicketEvidence, matchesConfirmedItinerary } from './reservation-evidence.js';
import { readSabreBookingView } from './sabre-booking-management.client.js';
const offer={outbound:{segments:[{origin:'DAC',destination:'KUL',marketingCarrier:'BS',flightNumber:'315',departureAt:'2026-10-15T08:25:00+06:00',arrivalAt:'2026-10-15T14:20:00+08:00'}]},inbound:null} as FlightOffer;
const view={flights:[{origin:'DAC',destination:'KUL',airlineCode:'BS',flightNumber:'0315',departureDate:'2026-10-15',departureTime:'08:25:00',arrivalDate:'2026-10-15',arrivalTime:'14:20',status:'Confirmed'}]} as FlightBookingProviderView;
describe('reservation evidence before payment and ticketing',()=>{
 const sparseBooking={bookingId:'ABC123',isTicketed:false,flights:[{flightNumber:315,airlineCode:'BS',fromAirportCode:'DAC',toAirportCode:'KUL',departureDate:'2026-10-15',departureTime:'08:25:00',arrivalDate:'2026-10-15',arrivalTime:'14:20:00',flightStatusName:'Confirmed'}],allSegments:[{id:'12',type:'FLIGHT'}],travelers:[{givenName:'Test',surname:'Traveler'}]};
 it('accepts omitted empty collections only with explicit unticketed and flight-only evidence',()=>{
   const current=readSabreBookingView(sparseBooking);
   expect(current.view.cancellationCheckComplete).toBe(true);
   expect(current.view.tickets).toEqual([]);
   expect(matchesConfirmedItinerary(current.view,offer)).toBe(true);
 });
 it.each([{isTicketed:undefined},{isTicketed:true},{flightTickets:null},{flightTickets:[null]},{hotels:null},{cars:[{}]},{allSegments:undefined},{allSegments:[{type:'HOTEL'}]},{allSegments:[]},{flights:[null]}])('keeps checkout blocked for missing or contradictory evidence: %j',change=>{
   expect(readSabreBookingView({...sparseBooking,...change}).view.cancellationCheckComplete).toBe(false);
 });
 it('continues to accept explicit empty nonflight and ticket collections',()=>{
   expect(readSabreBookingView({...sparseBooking,isTicketed:undefined,allSegments:undefined,flightTickets:[],hotels:[],cars:[]}).view.cancellationCheckComplete).toBe(true);
 });
 it('accepts confirmed exact local schedules including padded flight numbers',()=>{expect(matchesConfirmedItinerary(view,offer)).toBe(true);});
 it.each([{status:'Cancelled'},{status:'Waitlisted'},{departureTime:'09:25'},{arrivalTime:'15:20'},{arrivalDate:'2026-10-16'},{origin:'CGP'},{flightNumber:'316'}])('blocks cancelled, uncertain or changed flight evidence: %j',change=>{
   expect(matchesConfirmedItinerary({...view,flights:[{...view.flights[0]!,...change}]},offer)).toBe(false);
 });
 it('blocks missing and extra flights',()=>{expect(matchesConfirmedItinerary({...view,flights:[]},offer)).toBe(false);expect(matchesConfirmedItinerary({...view,flights:[...view.flights,...view.flights]},offer)).toBe(false);});
 it('requires complete unique issued ticket evidence',()=>{
   const first={number:'1234567890123',status:'Issued',travellerIndex:1};
   expect(hasIssuedTicketEvidence({...view,tickets:[first]},2)).toBe(false);
   expect(hasIssuedTicketEvidence({...view,tickets:[first,first]},2)).toBe(false);
   expect(hasIssuedTicketEvidence({...view,tickets:[first,{...first,number:'1234567890124',travellerIndex:2}]},2)).toBe(true);
   expect(hasIssuedTicketEvidence({...view,tickets:[{...first,status:'Voided'}]},1)).toBe(false);
 });
});
