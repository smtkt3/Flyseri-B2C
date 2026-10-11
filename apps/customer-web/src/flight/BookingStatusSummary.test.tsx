import { expect,it } from 'vitest';
import type { FlightBooking } from '@flyseri/types';
import { bookingMilestones } from './BookingStatusSummary';
import { bookingDisplayStatus, bookingHasIssuedTickets, bookingNeedsAttention } from './bookingPresentation';
it('never presents a cancelled or uncertain PNR as a confirmed reservation',()=>{
 for(const status of ['BOOKING_UNKNOWN','MANUAL_REVIEW_REQUIRED','BOOKING_IN_PROGRESS']) {
  expect(bookingMilestones({status,pnr:'ABC123'} as FlightBooking)[0]).toMatchObject({value:'Needs verification',tone:'attention'});
 }
 expect(bookingMilestones({status:'CANCELLED',pnr:'ABC123'} as FlightBooking)[0]).toMatchObject({value:'Cancelled',tone:'neutral'});
});
it('requires a distinct issued document for every passenger before confirming ticket status',()=>{
 const booking={passengerNames:['Demo One','Demo Two'],providerView:{tickets:[{number:'1234567890123',status:'Issued'}]}} as FlightBooking;
 expect(bookingHasIssuedTickets(booking)).toBe(false);
 booking.providerView!.tickets.push({...booking.providerView!.tickets[0]!});
 expect(bookingHasIssuedTickets(booking)).toBe(false);
 booking.providerView!.tickets[1]!.number='1234567890124';
 expect(bookingHasIssuedTickets(booking)).toBe(true);
});
it('flags previously ticketed bookings when the current document evidence is incomplete or voided',()=>{
 const booking={status:'TICKETED',passengerNames:['Sample'],providerView:{tickets:[{number:'1234567890123',status:'Voided'}]}} as FlightBooking;
 expect(bookingDisplayStatus(booking)).toBe('Ticket status needs review');expect(bookingNeedsAttention(booking)).toBe(true);
});
