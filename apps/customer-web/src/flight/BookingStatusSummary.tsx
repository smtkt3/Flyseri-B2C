import type { FlightBooking } from '@flyseri/types';
import { bookingHasIssuedTickets } from './bookingPresentation';
import { Link } from 'react-router-dom';
import './booking-checkout.css';

export function bookingMilestones(booking: FlightBooking, paymentConfirmed?: boolean) {
  const uncertain = ['BOOKING_UNKNOWN', 'MANUAL_REVIEW_REQUIRED', 'BOOKING_IN_PROGRESS'].includes(booking.status);
  const paid = paymentConfirmed ?? booking.order?.status === 'PAID';
  const issued = bookingHasIssuedTickets(booking);
  return [
    { label: 'Reservation', value: booking.status === 'CANCELLED' ? 'Cancelled' : uncertain ? 'Needs verification' : booking.pnr ? 'PNR confirmed' : booking.status === 'BOOKING_FAILED' ? 'Unsuccessful' : 'Not confirmed', tone: booking.status === 'CANCELLED' ? 'neutral' : !uncertain && booking.pnr ? 'confirmed' : 'attention' },
    { label: 'Payment', value: paid ? 'Sandbox payment confirmed' : booking.order?.status === 'PAYMENT_PROCESSING' ? 'Processing' : booking.order?.status === 'PAYMENT_FAILED' ? 'Failed' : booking.order?.status === 'EXPIRED' ? 'Payment window expired' : booking.order ? 'Payment due' : 'No confirmed payment', tone: paid ? 'confirmed' : 'neutral' },
    { label: 'Ticket', value: issued ? 'Issued documents reported' : booking.status === 'TICKETING_IN_PROGRESS' ? 'Issuance in progress' : 'Not verified', tone: issued ? 'confirmed' : 'neutral' },
  ];
}

export function BookingStatusSummary({ booking, compact = false, paymentConfirmed }: { booking: FlightBooking; compact?: boolean; paymentConfirmed?: boolean }) {
  return <dl className={`booking-milestones${compact ? ' is-compact' : ''}`} aria-label="Reservation, payment and ticket status">
    {bookingMilestones(booking, paymentConfirmed).map(item => <div key={item.label} className={`is-${item.tone}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
  </dl>;
}

export function BookingRecovery({ booking }: { booking: FlightBooking }) {
  const uncertain = ['BOOKING_UNKNOWN', 'MANUAL_REVIEW_REQUIRED', 'BOOKING_IN_PROGRESS', 'TICKETING_IN_PROGRESS'].includes(booking.status);
  const failed = booking.status === 'BOOKING_FAILED';
  if (!uncertain && !failed) return null;
  return <section className="booking-recovery" aria-label="Booking recovery">
    <h3>{uncertain ? 'Reservation needs verification' : 'Your reservation needs attention'}</h3>
    <p>{uncertain ? 'The airline response has not been fully verified. Please keep this booking reference and ask Flyseri to check it before reserving or paying again.' : 'This attempt did not receive a confirmed reservation. Flyseri can check the result and help you choose the next step.'}</p>
    <p className="checkout-reference">Reference: {booking.id}</p>
    <Link className="account-outline-button" to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>Get booking help</Link>
    <small>A payment receipt and a PNR are separate from an issued airline ticket.</small>
  </section>;
}
