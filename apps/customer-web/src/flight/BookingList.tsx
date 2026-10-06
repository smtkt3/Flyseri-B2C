import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { formatMoney, formatTimestamp } from '../account/presentation';
import { AirlineIdentity } from './AirlineIdentity';
import { bookingStatusLabel, bookingLegs, bookingRoute, bookingNeedsAttention, bookingIsPast } from './bookingPresentation';
import './booking-management.css';
import { BookingStatusSummary } from './BookingStatusSummary';
import { BookingLoading } from './BookingLoading';

export function BookingList() {
  const [items, setItems] = useState<FlightBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void flightService.bookings().then(value => { if (active) setItems(value); }, () => { if (active) setError('We could not load your bookings.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const groups: Record<string, (item: FlightBooking) => boolean> = {
    All: () => true,
    Upcoming: item => !bookingIsPast(item) && !['CANCELLED', 'BOOKING_FAILED'].includes(item.status),
    'Needs attention': bookingNeedsAttention,
    Past: item => bookingIsPast(item) && item.status !== 'CANCELLED',
    Cancelled: item => item.status === 'CANCELLED',
  };
  const filtered = items.filter(item => groups[filter]!(item) && [item.pnr, bookingRoute(item), ...item.passengerNames, item.order?.orderNumber].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="account-page flight-page booking-management">
    <header className="booking-management-heading"><div><p className="account-eyebrow">YOUR FLIGHTS</p><h1>My bookings</h1><p className="account-muted">Your reservations, payments and airline updates in one place.</p></div><Link className="btn-primary" to="/flights">Book a flight</Link></header>
    <section className="booking-management-tools" aria-label="Find a booking">
      <button type="button" className="account-outline-button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh bookings'}</button>
      <label>Find a booking<input type="search" placeholder="PNR, route, passenger or order number" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="booking-management-filters" role="group" aria-label="Filter bookings">{Object.entries(groups).map(([name, match]) => <button type="button" key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}<span>{items.filter(match).length}</span></button>)}</div>
    </section>
    {loading && <BookingLoading label="Loading your bookings…" />}
    {error && <div className="account-panel" role="alert">{error} <button className="account-outline-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
    {!loading && !error && !filtered.length && <section className="account-panel booking-management-empty"><span aria-hidden="true">✈</span><h2>{items.length ? 'No matching bookings' : 'Your next journey starts here'}</h2><p>{items.length ? 'Try another name, route or booking filter.' : 'Choose a flight and complete your reservation. You can manage it here whenever you need.'}</p><Link className="account-link" to="/flights">Explore flights →</Link></section>}
    {!loading && !error && filtered.map(booking => <article className="account-panel booking-management-card" key={booking.id}>
      <div className="booking-management-card-top"><AirlineIdentity codes={booking.selectedOffer.airlineCodes}/><span className={bookingNeedsAttention(booking) ? 'booking-status needs-attention' : 'booking-status'}>{bookingStatusLabel(booking.status)}</span></div>
      <div className="booking-management-route"><div><h2>{bookingRoute(booking)}</h2><p>{formatTimestamp(bookingLegs(booking)[0]!.segments[0]!.departureAt)} · {booking.passengerNames.length} {booking.passengerNames.length === 1 ? 'traveler' : 'travelers'}</p></div><strong>{formatMoney(booking.amount, booking.currency)}</strong></div>
      <BookingStatusSummary booking={booking} compact />
      {!!booking.ancillaryRequests?.length && <p className="account-muted">{booking.ancillaryRequests.length} selected extras - {booking.ancillaryPurchase?.status === 'SKIPPED' ? 'ticket only selected' : ['CONFIRMED', 'FULFILLMENT_PENDING', 'FULFILLED'].includes(booking.ancillaryPurchase?.status ?? '') ? 'attached to the airline reservation' : 'review in Manage booking'}</p>}
      <div className="booking-management-card-bottom"><div><small>Booking reference</small><strong>{booking.pnr ?? 'Awaiting confirmation'}</strong>{booking.order && <small>{booking.order.status === 'PAID' ? 'Payment confirmed' : booking.order.status === 'PAYMENT_PROCESSING' ? 'Payment processing' : booking.order.status === 'EXPIRED' ? 'Payment window expired' : 'Payment incomplete'}</small>}</div><Link className="account-outline-button" to={'/app/bookings/' + booking.id}>Manage booking →</Link></div>
    </article>)}
  </div>;
}
