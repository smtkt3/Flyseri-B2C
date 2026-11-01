import {describe,it,expect} from 'vitest';
import {ticketFixture} from './ticket-document.fixture.js';
import {ticketDocumentAvailable,queueTicketEmail,currentTicketNumbers,resolveTicketEmail} from './ticket-document.contract.js';
import {createTicketPdf} from './ticket-pdf.js';
import {ticketEmailContent} from './ticket-email.js';
describe('verified ticket PDF and automatic delivery contract',()=>{
 it.each(['PAID','AWAITING_STAFF_TICKETING','MANUAL_REVIEW_REQUIRED','CANCELLED'])('blocks %s reservations even with stale ticket evidence',async status=>{
  const booking={...ticketFixture(),status};expect(ticketDocumentAvailable(booking)).toBe(false);await expect(createTicketPdf(booking,'CERT')).rejects.toThrow('Verified');
 });
 it.each(['Voided','Refunded/Exchanged'])('blocks %s ticket documents',status=>{const booking=ticketFixture();booking.providerView!.tickets[0]!.status=status;expect(ticketDocumentAvailable(booking)).toBe(false);});
 it('rejects changed passenger or flight identities and cancelled airline segments',()=>{
  for(const mutate of [(b:ReturnType<typeof ticketFixture>)=>b.providerView!.travellers[0]!.surname='Different',(b:ReturnType<typeof ticketFixture>)=>b.providerView!.flights[0]!.status='Cancelled',(b:ReturnType<typeof ticketFixture>)=>b.providerView!.flights[0]!.departureTime='15:00']){const booking=ticketFixture();mutate(booking);expect(ticketDocumentAvailable(booking)).toBe(false);}
 });
 it('selects only current reissued tickets and creates one new email version',()=>{
  const booking=ticketFixture(),original=queueTicketEmail({checkoutContactEmail:'booking@example.com'},booking.id,booking.providerView!);
  expect(original.ticketEmail?.status).toBe('QUEUED');expect(queueTicketEmail(original,booking.id,booking.providerView!)).toBe(original);
  booking.providerView!.tickets[0]!.couponStatuses=['Exchanged'];booking.providerView!.tickets.push({number:'9970000000002',status:'Issued',travellerIndex:1,couponStatuses:['Okay']});
  expect(ticketDocumentAvailable(booking)).toBe(true);expect(currentTicketNumbers(booking.providerView!)).toEqual(['9970000000002']);
  const replacement=queueTicketEmail(original,booking.id,booking.providerView!);expect(replacement.ticketEmail?.id).not.toBe(original.ticketEmail?.id);expect(replacement.ticketEmail?.recipient).toBe('booking@example.com');
 });
 it('does not guess an email recipient or queue without valid ticket evidence',()=>{
  const booking=ticketFixture();expect(queueTicketEmail({},booking.id,booking.providerView!).ticketEmail).toBeUndefined();
  expect(queueTicketEmail({checkoutContactEmail:'a@example.com\nBcc: b@example.com'},booking.id,booking.providerView!).ticketEmail).toBeUndefined();
  expect(queueTicketEmail({checkoutContactEmail:'victim@example.com,other@example.com'},booking.id,booking.providerView!).ticketEmail).toBeUndefined();
  booking.providerView!.tickets=[];expect(queueTicketEmail({checkoutContactEmail:'booking@example.com'},booking.id,booking.providerView!).ticketEmail).toBeUndefined();
 });
 it('recovers only one identity-matched booked address for older reservations',async()=>{
  const booking=ticketFixture(),current={bookingId:'provider',bookingSignature:'signature',flights:[],travelers:[{givenName:'Test',surname:'Traveler',emails:['booked@example.com']}]};
  expect(await resolveTicketEmail({},'provider',booking.providerView!,async()=>current)).toBe('booked@example.com');
  expect(await resolveTicketEmail({},'provider',booking.providerView!,async()=>({...current,travelers:[{...current.travelers[0],surname:'Someone else'}]}))).toBeUndefined();
  expect(await resolveTicketEmail({},'provider',booking.providerView!,async()=>({...current,travelers:[{...current.travelers[0],emails:['first@example.com','second@example.com']}]}))).toBeUndefined();
  expect(await resolveTicketEmail({checkoutContactEmail:'original@example.com'},'provider',booking.providerView!,async()=>{throw Error('Should not read');})).toBe('original@example.com');
 });
 it('paginates a long itinerary without dropping the ticket document',async()=>{
  const booking=ticketFixture(),segments=Array.from({length:9},(_,index)=>({...booking.selectedOffer.outbound.segments[0]!,flightNumber:String(435+index)}));
  booking.selectedOffer.outbound.segments=segments;booking.providerView!.flights=segments.map(segment=>({...booking.providerView!.flights[0]!,flightNumber:segment.flightNumber}));
  const pdf=await createTicketPdf(booking,'CERT');expect((pdf.toString('latin1').match(/\/Type \/Page\b/g)??[]).length).toBeGreaterThan(1);
 });
 it('creates a genuine PDF with embedded fonts and logo, and a test-labeled HTML/plain email',async()=>{
  const booking=ticketFixture(),pdf=await createTicketPdf(booking,'CERT');expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(10000);
  const content=ticketEmailContent(booking,'https://flyseri.example',true);expect(content.subject).toContain('[CERT TEST]');expect(content.html).toContain('cid:flyseri-logo');expect(content.html).toContain('not valid for travel');expect(content.text).toContain('9970000000001');
  booking.passengerNames=['<img src=x onerror=alert(1)>'];expect(ticketEmailContent(booking,'https://flyseri.example',false).html).not.toContain('<img src=x');
 });
});
