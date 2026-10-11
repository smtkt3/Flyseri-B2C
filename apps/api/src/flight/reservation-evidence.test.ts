import { describe,expect,it } from 'vitest';
import type { FlightOffer,FlightBookingProviderView } from '@flyseri/types';
import { hasIssuedTicketEvidence, matchesConfirmedItinerary } from './reservation-evidence.js';
const offer={outbound:{segments:[{origin:'DAC',destination:'KUL',marketingCarrier:'BS',flightNumber:'315',departureAt:'2026-10-15T08:25:00+06:00',arrivalAt:'2026-10-15T14:20:00+08:00'}]},inbound:null} as FlightOffer;
const view={flights:[{origin:'DAC',destination:'KUL',airlineCode:'BS',flightNumber:'0315',departureDate:'2026-10-15',departureTime:'08:25:00',arrivalDate:'2026-10-15',arrivalTime:'14:20',status:'Confirmed'}]} as FlightBookingProviderView;
describe('reservation evidence before payment and ticketing',()=>{
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
