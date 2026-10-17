import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { bookingHasIssuedTickets } from './bookingPresentation';
import './ticket-issuance-notice.css';

const issuanceWindowMs = 6 * 60 * 60 * 1000;

/** The deadline uses persisted payment evidence, so refreshing never restarts it. */
export function FlightTicketIssuanceNotice({ booking, paidAt }: {
  booking: FlightBooking; paidAt: string | null | undefined; ticketingAvailable: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const paymentTime = paidAt ? Date.parse(paidAt) : NaN;
  if (!Number.isFinite(paymentTime)) return null;
  const dueAt = paymentTime + issuanceWindowMs;
  const issued = bookingHasIssuedTickets(booking);
  const review = !booking.pnr || ['BOOKING_UNKNOWN','BOOKING_FAILED','CANCELLED','PNR_EXPIRED','TICKETING_FAILED','REFUND_REQUIRED'].includes(booking.status) || booking.status === 'TICKETED' && !issued;
  const delayed = !issued && now >= dueAt;
  const heading = issued ? 'Your ticket is ready' : review ? 'Your booking needs attention' : delayed ? 'Your ticket is taking longer than expected' : 'Your ticket will be ready within 6 hours';
  return <section className={`ticket-issuance-notice${review || delayed ? ' needs-attention' : ''}`} aria-label="Ticket issuance">
    <span className="ticket-issuance-icon" aria-hidden="true">{issued ? '✓' : '◷'}</span>
    <div><h3>{heading}</h3>
      <p>{issued ? 'Your ticket has been issued. You can view your ticket details in My bookings.' : review ? 'Your payment is recorded, but there is an issue with your reservation. Contact Flyseri for help; please do not pay again.' : delayed ? 'Your ticket has not been issued within 6 hours of payment. Contact Flyseri for an update; please do not pay again.' : 'Flyseri will issue your ticket within 6 hours of confirmed payment. We’ll send it to your booking email and add it to My bookings in the app. You can download it from either place.'}</p>
      {!issued && !review && !delayed && <p className="ticket-issuance-deadline">Expected by <time dateTime={new Date(dueAt).toISOString()}>{new Intl.DateTimeFormat('en', { dateStyle:'medium',timeStyle:'short' }).format(dueAt)}</time> · your local time</p>}
      {!issued && !review && !delayed && <p>You don’t need to take any further action while we prepare your ticket.</p>}
      {(review || delayed) && <Link to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>Get ticketing help →</Link>}
    </div>
  </section>;
}
