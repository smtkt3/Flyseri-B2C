import type { FlightBooking } from '@flyseri/types';

export function bookingHasIssuedTickets(booking: FlightBooking): boolean {
  const tickets = booking.providerView?.tickets;
  const count = booking.passengerNames?.length ?? 0;
  return count > 0 && tickets?.length === count &&
    new Set(tickets.map(ticket => ticket.number)).size === tickets.length &&
    tickets.every(ticket => /^\d{13}$/.test(ticket.number) && ticket.status === 'Issued');
}

export function bookingStatusLabel(status: string): string {
  return ({ PNR_CREATED: 'Reserved · payment due', AWAITING_PAYMENT: 'Payment due', PAYMENT_PENDING: 'Payment processing', PAID: 'Payment confirmed',
    AWAITING_STAFF_TICKETING: 'Payment confirmed', TICKETED: 'Ticket issued', CANCELLED: 'Cancelled', BOOKING_FAILED: 'Reservation unsuccessful',
    BOOKING_IN_PROGRESS: 'Confirming reservation', BOOKING_UNKNOWN: 'Confirmation needs review', MANUAL_REVIEW_REQUIRED: 'Needs review',
    TICKETING_IN_PROGRESS: 'Issuing tickets' } as Record<string, string>)[status] ?? 'Needs review';
}
export function bookingDisplayStatus(booking: FlightBooking): string {
  return booking.status === 'TICKETED' && !bookingHasIssuedTickets(booking) ? 'Ticket status needs review' : bookingStatusLabel(booking.status);
}
export const bookingLegs = (booking: FlightBooking) => booking.selectedOffer.multiCityLegs ?? [booking.selectedOffer.outbound, ...(booking.selectedOffer.inbound ? [booking.selectedOffer.inbound] : [])];
export const bookingRoute = (booking: FlightBooking) => bookingLegs(booking).map(leg => `${leg.segments[0]?.origin} → ${leg.segments.at(-1)?.destination}`).join(' · ');
export function bookingNeedsAttention(booking: FlightBooking): boolean {
  if (booking.status === 'CANCELLED') return false;
  if (booking.status === 'TICKETED') return !bookingHasIssuedTickets(booking);
  if (booking.order && ['EXPIRED', 'PAYMENT_FAILED'].includes(booking.order.status)) return true;
  return ['BOOKING_UNKNOWN', 'MANUAL_REVIEW_REQUIRED', 'BOOKING_FAILED'].includes(booking.status);
}
export function bookingIsPast(booking: FlightBooking, now = Date.now()): boolean {
  const arrival = bookingLegs(booking).at(-1)?.segments.at(-1)?.arrivalAt;
  return Boolean(arrival && Date.parse(arrival) < now);
}
