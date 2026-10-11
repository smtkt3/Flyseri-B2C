import { CheckoutPageHeader } from './CheckoutPageHeader';
import { Translated } from '../travel/language';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { formatMoney } from '../account/presentation';
import { AirlineIdentity } from './AirlineIdentity';
import { bookingDisplayStatus, bookingLegs, bookingRoute, bookingNeedsAttention, bookingIsPast } from './bookingPresentation';
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
    <div className="booking-management-heading"><CheckoutPageHeader title="My bookings" description="Manage your reservations, payments and airline updates."/><div className="booking-management-heading-actions"><button type="button" className="account-outline-button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh bookings'}</button><Link className="btn-primary" to="/flights">Book a flight</Link></div></div>
    <section className="booking-management-tools" aria-label="Find a booking">
      <p className="account-muted">Testing the process? <Link className="account-link" to="/demo/bookings">Try a demo booking &amp; payment</Link> · No money or airline seats involved.</p>
      <label>Find a booking<input type="search" placeholder="PNR, route, passenger or order number" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="booking-management-filters" role="group" aria-label="Filter bookings">{Object.entries(groups).map(([name, match]) => <button type="button" key={name} aria-pressed={filter === name} disabled={loading || !!error} onClick={() => setFilter(name)}>{name}{!loading && !error && <span>{items.filter(match).length}</span>}</button>)}</div>
    </section>
    {loading && <BookingLoading label="Loading your bookings…" />}
    {error && <div className="account-panel" role="alert">{error} <button className="account-outline-button" onClick={() => setAttempt(value => value + 1)}><Translated text="Retry" /></button></div>}
    {!loading && !error && !filtered.length && <section className="account-panel booking-management-empty"><span aria-hidden="true">✈</span><h2>{items.length ? 'No matching bookings' : 'Your next journey starts here'}</h2><p>{items.length ? 'Try another name, route or booking filter.' : 'Choose a flight and complete your reservation. You can manage it here whenever you need.'}</p>{items.length ? <button type="button" className="account-outline-button" onClick={() => {setQuery('');setFilter('All');}}>Clear search & filters</button> : <Link className="btn-primary" to="/flights">Explore flights</Link>}</section>}
    {!loading && !error && filtered.map(booking => <article className="account-panel booking-management-card" key={booking.id}>
      <div className="booking-management-card-top"><AirlineIdentity codes={booking.selectedOffer.airlineCodes}/><span className={bookingNeedsAttention(booking) ? 'booking-status needs-attention' : 'booking-status'}>{bookingDisplayStatus(booking)}</span></div>
      <div className="booking-management-route"><div className="booking-card-journeys">{bookingLegs(booking).map((leg,index)=>{const first=leg.segments[0],last=leg.segments.at(-1);if(!first||!last)return null;return <div className="booking-card-journey" key={index}><div className="booking-card-journey-label"><span>{booking.selectedOffer.multiCityLegs ? `Flight ${index+1}` : index===0 ? 'Outbound' : 'Return'}</span><time dateTime={first.departureAt.slice(0,10)}>{new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(first.departureAt.slice(0,10)+'T12:00:00Z'))}</time></div><h2>{first.origin} <span aria-hidden="true">→</span> {last.destination}</h2><p><strong>{first.departureAt.slice(11,16)} – {last.arrivalAt.slice(11,16)}</strong><span> · Local airport times</span>{first.departureAt.slice(0,10)!==last.arrivalAt.slice(0,10)&&<span> · Arrives {last.arrivalAt.slice(0,10)}</span>}</p></div>;})}<span className="booking-card-traveler-count">{booking.passengerNames.length} {booking.passengerNames.length===1?'traveler':'travelers'}</span></div><div className="booking-card-fare"><span>Accepted airfare</span><strong>{formatMoney(booking.amount, booking.currency)}</strong></div></div>
      <BookingStatusSummary booking={booking} compact />
      {!!booking.ancillaryRequests?.length && <p className="account-muted">{booking.ancillaryRequests.length} selected extras - {booking.ancillaryPurchase?.status === 'SKIPPED' ? 'ticket only selected' : ['CONFIRMED', 'FULFILLMENT_PENDING', 'FULFILLED'].includes(booking.ancillaryPurchase?.status ?? '') ? 'attached to the airline reservation' : 'review in Manage booking'}</p>}
      <div className="booking-management-card-bottom"><div><small>Airline reference (PNR)</small><strong>{booking.pnr ?? 'Awaiting confirmation'}</strong></div><Link className="booking-card-manage" aria-label={`Manage booking ${booking.pnr ?? bookingRoute(booking)}`} to={'/app/bookings/' + booking.id}>Manage booking <span aria-hidden="true">→</span></Link></div>
    </article>)}
  </div>;
}
