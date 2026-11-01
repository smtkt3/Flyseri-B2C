import type { FlightBooking,FlightBookingProviderView } from '@flyseri/types';

export type BookingOutcome = 'confirmed' | 'pending' | 'unsuccessful' | 'cancelled';
export function bookingHasCancelledSegments(booking: FlightBooking): boolean {
  return !!booking.providerView?.flights.some(flight=>['cancelled','canceled'].includes(flight.status.trim().toLowerCase()));
}
export function bookingOutcome(booking: FlightBooking): BookingOutcome {
  if (booking.status === 'CANCELLED') return 'cancelled';
  if (bookingHasCancelledSegments(booking)) return 'unsuccessful';
  if (['BOOKING_FAILED', 'CANCELLED', 'PNR_EXPIRED', 'PAYMENT_FAILED', 'TICKETING_FAILED', 'REFUND_REQUIRED'].includes(booking.status) ||
    booking.order && ['PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'].includes(booking.order.status)) return 'unsuccessful';
  if (!booking.pnr || ['BOOKING_PENDING', 'BOOKING_IN_PROGRESS', 'BOOKING_UNKNOWN', 'MANUAL_REVIEW_REQUIRED', 'FARE_CHANGED'].includes(booking.status)) return 'pending';
  if (booking.status === 'TICKETED') return bookingHasIssuedTickets(booking) ? 'confirmed' : 'pending';
  return 'pending';
}

export function bookingHasIssuedTickets(booking: FlightBooking): boolean {
  const tickets = booking.providerView?.tickets;
  const count = booking.passengerNames?.length ?? 0;
  if(!tickets)return false;
  const current=tickets.filter(ticket=>!(['Issued','Refunded/Exchanged'].includes(ticket.status)&&Boolean(ticket.couponStatuses?.length)&&ticket.couponStatuses!.every(status=>status==='Exchanged')));
  return count > 0 && current.length === count &&
    new Set(tickets.map(ticket => ticket.number)).size === tickets.length &&
    new Set(current.map(ticket=>ticket.travellerIndex)).size===count&&
    current.every(ticket => /^\d{13}$/.test(ticket.number) && ticket.status === 'Issued'&&Number.isInteger(ticket.travellerIndex)&&ticket.travellerIndex!>=1&&ticket.travellerIndex!<=count&&!ticket.couponStatuses?.some(status=>['Exchanged','Refunded','Voided'].includes(status)));
}

export function bookingTicketStatus(ticket:FlightBookingProviderView['tickets'][number]):string {
  return ['Issued','Refunded/Exchanged'].includes(ticket.status)&&Boolean(ticket.couponStatuses?.length)&&ticket.couponStatuses!.every(status=>status==='Exchanged')?'Exchanged':ticket.status||'Status not supplied';
}

export function bookingStatusLabel(status: string): string {
  return ({ PNR_CREATED: 'Reserved · payment due', AWAITING_PAYMENT: 'Payment due', PAYMENT_PENDING: 'Payment processing', PAID: 'Payment confirmed',
    AWAITING_STAFF_TICKETING: 'Payment confirmed', TICKETED: 'Ticket issued', CANCELLED: 'Cancelled', BOOKING_FAILED: 'Reservation unsuccessful',
    BOOKING_IN_PROGRESS: 'Confirming reservation', BOOKING_UNKNOWN: 'Confirmation needs review', MANUAL_REVIEW_REQUIRED: 'Needs review',
    TICKETING_IN_PROGRESS: 'Issuing tickets' } as Record<string, string>)[status] ?? 'Needs review';
}
export function bookingDisplayStatus(booking: FlightBooking): string {
  if (bookingHasCancelledSegments(booking)) return 'Airline reservation cancelled';
  return booking.status === 'TICKETED' && !bookingHasIssuedTickets(booking) ? 'Ticket status needs review' : bookingStatusLabel(booking.status);
}
export const bookingLegs = (booking: FlightBooking) => booking.selectedOffer.multiCityLegs ?? [booking.selectedOffer.outbound, ...(booking.selectedOffer.inbound ? [booking.selectedOffer.inbound] : [])];
export const bookingRoute = (booking: FlightBooking) => bookingLegs(booking).map(leg => `${leg.segments[0]?.origin} → ${leg.segments.at(-1)?.destination}`).join(' · ');
export function bookingNeedsAttention(booking: FlightBooking): boolean {
  if (bookingHasCancelledSegments(booking)) return true;
  if (booking.status === 'CANCELLED') return false;
  if (booking.status === 'TICKETED') return !bookingHasIssuedTickets(booking);
  if (booking.order && ['EXPIRED', 'PAYMENT_FAILED'].includes(booking.order.status)) return true;
  return ['BOOKING_UNKNOWN', 'MANUAL_REVIEW_REQUIRED', 'BOOKING_FAILED'].includes(booking.status);
}
export function bookingIsPast(booking: FlightBooking, now = Date.now()): boolean {
  const arrival = bookingLegs(booking).at(-1)?.segments.at(-1)?.arrivalAt;
  return Boolean(arrival && Date.parse(arrival) < now);
}
