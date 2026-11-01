import {expect,it} from 'vitest';
import type {FlightBooking} from '@flyseri/types';
import {bookingOutcome,bookingTicketStatus} from './bookingPresentation';
const booking={pnr:'ABC123',passengerNames:['Synthetic Traveler'],status:'AWAITING_STAFF_TICKETING',order:{status:'PAID',paidAt:'2026-10-28T00:00:00Z'}} as FlightBooking;
it('requires issued ticket evidence before displaying a confirmed booking',()=>{
 expect(bookingOutcome(booking)).toBe('pending');
 expect(bookingOutcome({...booking,status:'TICKETED'})).toBe('pending');
 expect(bookingOutcome({...booking,status:'TICKETED',providerView:{cancellationCheckComplete:true,retrievedAt:'2026-10-28T00:00:00Z',flights:[],travellers:[],tickets:[{number:'9971234567890',status:'Issued',travellerIndex:1}]}})).toBe('confirmed');
});
it('distinguishes a completed cancellation from a failed booking attempt',()=>{
 expect(bookingOutcome({...booking,status:'CANCELLED'})).toBe('cancelled');
 expect(bookingOutcome({...booking,status:'BOOKING_FAILED'})).toBe('unsuccessful');
});
it('shows a verified reissued booking as confirmed while preserving exchanged ticket history',()=>{
 const original={number:'9971234567890',status:'Issued',travellerIndex:1,couponStatuses:['Exchanged']};
 const replacement={number:'9971234567891',status:'Issued',travellerIndex:1};
 const current={...booking,status:'TICKETED',providerView:{cancellationCheckComplete:true,retrievedAt:'2026-10-29T07:33:00Z',flights:[],travellers:[],tickets:[original,replacement]}} as FlightBooking;
 expect(bookingOutcome(current)).toBe('confirmed');
 expect(bookingTicketStatus(original)).toBe('Exchanged');
 for(const tickets of [[original],[{...original,couponStatuses:['Not Flown']},replacement],[original,{...replacement,travellerIndex:2}],[original,replacement,replacement]])expect(bookingOutcome({...current,providerView:{...current.providerView!,tickets}})).toBe('pending');
});
