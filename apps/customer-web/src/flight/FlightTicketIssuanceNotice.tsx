import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { bookingHasIssuedTickets } from './bookingPresentation';
import './ticket-issuance-notice.css';

const issuanceWindowMs = 6 * 60 * 60 * 1000;

/** The deadline uses persisted payment evidence, so refreshing never restarts it. */
export function FlightTicketIssuanceNotice({ booking, paidAt, ticketingAvailable }: {
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
  const review = ['MANUAL_REVIEW_REQUIRED','BOOKING_UNKNOWN','BOOKING_FAILED','CANCELLED'].includes(booking.status) || booking.status === 'TICKETED' && !issued;
  const delayed = !issued && now >= dueAt;
  const heading = issued ? 'Your ticket is ready' : review ? 'Ticket issuance needs attention' : delayed ? 'Your ticket is taking longer than expected' : 'Ticket issuance within 6 hours';
  return <section className={`ticket-issuance-notice${review || delayed ? ' needs-attention' : ''}`} aria-label="Ticket issuance">
    <span className="ticket-issuance-icon" aria-hidden="true">{issued ? '✓' : '◷'}</span>
    <div><h3>{heading}</h3>
      <p>{issued ? 'Your issued ticket documents are available in My bookings.' : review ? 'Your payment is recorded. Our team must verify this booking before issuing tickets. Please contact Flyseri; do not pay again.' : delayed ? 'The six-hour issuance target has passed. Please contact Flyseri for an update. Your payment is recorded; do not pay again.' : 'Your ticket is expected to be issued within 6 hours of confirmed payment. It will be available in My bookings once the airline confirms issuance.'}</p>
      {!issued && !review && !delayed && <p className="ticket-issuance-deadline">Expected by <time dateTime={new Date(dueAt).toISOString()}>{new Intl.DateTimeFormat('en', { dateStyle:'medium',timeStyle:'short' }).format(dueAt)}</time> · your local time</p>}
      {!issued && !ticketingAvailable && !review && !delayed && <p>Automatic issuance is currently unavailable. Contact Flyseri to arrange your ticket.</p>}
      {(review || delayed || !issued && !ticketingAvailable) && <Link to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>Get ticketing help →</Link>}
    </div>
  </section>;
}
