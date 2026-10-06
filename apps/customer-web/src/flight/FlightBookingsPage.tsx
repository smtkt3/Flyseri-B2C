import { FlightAncillaryPurchasePanel } from './FlightAncillaryPurchasePanel';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { formatMoney, formatTimestamp } from '../account/presentation';
import { AirlineIdentity } from './AirlineIdentity';
import { commerceService } from '../services/commerceService';
import { downloadText } from '../lib/downloadText';
import { serviceRequestSummary } from './FlightServiceRequests';
import { FlightSelectedExtras } from './FlightSelectedExtras';
import { FlightBaggageDetails, FlightServiceDetails } from './FlightFareInformation';
import { BookingProgress } from './BookingProgress';
import { BookingRecovery, BookingStatusSummary } from './BookingStatusSummary';
import { BookingLoading } from './BookingLoading';
import { FlightPaymentPreparation } from './FlightPaymentPreparation';
import { usePreferredDisplayPrices } from './usePreferredDisplayPrices';

export { BookingList as FlightBookingsPage } from './BookingList';
import { bookingStatusLabel as statusLabel, bookingLegs as legsOf, bookingRoute as routeOf } from './bookingPresentation';

export function FlightBookingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {bookingId = ''} = useParams();
  const [booking, setBooking] = useState<FlightBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [cancelConfirmation, setCancelConfirmation] = useState('');
  const [servicingAvailable, setServicingAvailable] = useState(false);
  const [ticketingAvailable, setTicketingAvailable] = useState(false);
  const display = usePreferredDisplayPrices([{amount: booking?.amount ?? null, currency: booking?.currency ?? 'MYR'}]);
  const displayedFare = display.prices[0]?.amount != null ? `${display.prices[0].estimated ? '≈ ' : ''}${formatMoney(display.prices[0].amount, display.currency)}` : `Updating ${display.currency} price…`;
  useEffect(() => {
    let active = true; setLoading(true); setBooking(null); setError(''); setNotice('');
    setServicingAvailable(false);
    setTicketingAvailable(false);
    void flightService.bookingCapabilities().then(value => {if (active) { setServicingAvailable(value.reservationAvailable); setTicketingAvailable(value.ticketIssuanceAvailable); }}, () => undefined);
    void flightService.booking(bookingId).then(value => { if (active) setBooking(value); }, () => { if (active) setError('We could not load this booking.'); }).finally(() => { if (active) setLoading(false); });
    return () => {active = false;};
  }, [bookingId, attempt]);
  useEffect(() => {
    if (!booking || !['BOOKING_IN_PROGRESS', 'TICKETING_IN_PROGRESS', 'AWAITING_STAFF_TICKETING', 'PAID'].includes(booking.status)) return;
    let active = true, running = false, checks = 0;
    // Read Flyseri's saved result only. Never repeat a Sabre mutation or turn an
    // uncertain response into a confirmed reservation merely because time passed.
    const timer = window.setInterval(() => {
      if (!active || running || document.visibilityState !== 'visible') return;
      if (++checks > 12) { window.clearInterval(timer); return; }
      running = true;
      void flightService.booking(bookingId).then(value => { if (active) setBooking(value); }, () => undefined).finally(() => { running = false; });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bookingId, booking?.status]);
  async function refresh() {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { setBooking(await flightService.refreshBooking(bookingId)); setNotice('Current booking details were retrieved from Sabre. See the airline details and ticket documents below.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Booking refresh failed.'); }
    finally { setBusy(false); }
  }
  async function continueToOrder() {
    if (!booking || busy) return;
    if (booking.order) { navigate('/app/orders/' + booking.order.id); return; }
    setBusy(true); setError('');
    try { const order = await commerceService.createFlightOrder(booking.bookingIntentId); navigate('/app/orders/' + order.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The order could not be prepared.'); }
    finally {setBusy(false);}
  }
  async function cancelReservation() {
    if (!booking?.pnr || cancelConfirmation !== booking.pnr || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setBooking(await flightService.cancelBooking(bookingId,cancelConfirmation)); setCancelConfirmation(''); setNotice('Sabre confirmed that the flight reservation was cancelled.'); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cancellation could not be confirmed.');
      try {setBooking(await flightService.booking(bookingId));} catch { /* Keep the last displayed reservation and its error. */ }
    } finally {setBusy(false);}
  }
  if (booking?.pnr && ['PNR_CREATED', 'AWAITING_PAYMENT', 'PAYMENT_PENDING'].includes(booking.status) && (location.state as {continueToPayment?: boolean} | null)?.continueToPayment) return <FlightPaymentPreparation key={booking.id} booking={booking} />;
  return <div className="account-page flight-page"><Link className="account-link" to="/app/bookings">← My Bookings</Link><p className="account-eyebrow">AIRLINE RESERVATION</p><h1>{booking?.pnr ? 'Booking ' + booking.pnr : 'Your booking attempt'}</h1>
    {loading && <BookingLoading label="Loading booking details…" />}
    {error && <div role="alert" className="account-error">{error}{!booking && <button className="account-outline-button" onClick={() => setAttempt(value => value + 1)}>Retry</button>}</div>}
    {notice && <p role="status" className="account-panel">{notice}</p>}
    {booking && <><BookingProgress current={booking.pnr ? 3 : 2} complete={booking.status === 'AWAITING_STAFF_TICKETING' || booking.status === 'TICKETED'} /><section className="account-panel flight-intent-card"><div className="flight-offer-top"><AirlineIdentity codes={booking.selectedOffer.airlineCodes}/><strong>{statusLabel(booking.status)}</strong></div><h2>{routeOf(booking)}</h2>
      <p>PNR: <strong>{booking.pnr || 'Not confirmed'}</strong></p><p>Flight fare: <strong>{displayedFare}</strong></p><p>Ticket status: <strong>{booking.providerView?.tickets.some(ticket => ticket.status === 'Issued') ? 'Issued — see documents below' : 'Awaiting issuance'}</strong></p>
      <BookingStatusSummary booking={booking} />
      <BookingRecovery booking={booking} />
      <p><button className="account-outline-button" type="button" onClick={() => downloadText(`Flyseri-booking-${booking.id}.txt`, ['Flyseri reservation summary', `Booking: ${booking.id}`, `PNR: ${booking.pnr ?? 'Not confirmed'}`, `Status: ${statusLabel(booking.status)}`, `Accepted fare: ${booking.currency} ${booking.amount}`, `Passenger names source: ${booking.passengerNamesSource ?? 'CURRENT_PROFILES'}`, ...booking.passengerNames, ...(booking.ancillaryPurchase ? [`Airline extras status: ${booking.ancillaryPurchase.status}`, `Extras checkout total: ${booking.ancillaryPurchase.currency} ${booking.ancillaryPurchase.extrasAmount}`, `Trip total: ${booking.ancillaryPurchase.currency} ${booking.ancillaryPurchase.totalAmount}`] : []), ...(booking.ancillaryPurchase?.status === 'SKIPPED' ? [] : (booking.ancillaryRequests ?? [])).map(extra => `Selected extra (${['CONFIRMED', 'FULFILLMENT_PENDING', 'FULFILLED'].includes(booking.ancillaryPurchase?.status ?? '') ? 'attached to airline reservation; see document status' : 'awaiting airline confirmation, not purchased'}): ${extra.name}; ${extra.segmentLabels.join(' / ')}; Traveler ${extra.passengerIndexes.map(index => index + 1).join(', ')}; quote ${extra.currency ?? ''} ${extra.amount ?? 'not available'}`), ...(booking.serviceRequests ?? []).map(request => `Service request (awaiting confirmation) - ${request.passengerName}: ${serviceRequestSummary(request)}`), ...legsOf(booking).flatMap(leg => leg.segments.map(segment => `${segment.marketingCarrier}${segment.flightNumber}: ${segment.origin} → ${segment.destination}; ${segment.departureAt} → ${segment.arrivalAt}`)), `Last Sabre refresh: ${booking.lastSabreRefreshAt ?? 'Not refreshed'}`, 'This reservation summary is not an airline ticket. Confirm airline status before travel.'].join('\n'))}>Download reservation summary</button></p>
      <h3>{booking.passengerNamesSource === 'BOOKED_SNAPSHOT' ? 'Passengers submitted for reservation' : 'Selected traveller profiles'}</h3><ul>{booking.passengerNames.map((name, index) => <li key={index}>{name}</li>)}</ul>
      <h3>Saved flight itinerary</h3>{legsOf(booking).map((leg, index) => <div key={index}>{leg.segments.map((segment, segmentIndex) => <p key={segmentIndex}><strong>{segment.marketingCarrier}{segment.flightNumber}</strong> · {segment.origin} → {segment.destination}<br/><small>{segment.departureAt.replace('T', ' ')} — {segment.arrivalAt.replace('T', ' ')}</small></p>)}</div>)}
      <section aria-label="Meals, baggage and assistance"><h3>Meals, baggage &amp; assistance</h3>
        <FlightBaggageDetails offer={booking.selectedOffer} /><FlightServiceDetails offer={booking.selectedOffer} />
        {!!booking.serviceRequests?.length && <><h4>Your saved requests</h4><ul>{booking.serviceRequests.map(request => <li key={request.travellerId}><strong>{request.passengerName}</strong>: {serviceRequestSummary(request)}</li>)}</ul>
          <p className="account-muted">Awaiting airline confirmation. These requests are not purchased extras and are excluded from your ticket total.</p></>}
        <FlightAncillaryPurchasePanel booking={booking} onChange={purchase => { setBooking(current => current ? {...current, ancillaryPurchase: purchase} : current); void flightService.booking(booking.id).then(value => setBooking(current => current?.id === value.id ? value : current), () => undefined); }}/>
        {!booking.ancillaryPurchase || ['PREPARED', 'UNAVAILABLE', 'ADDING', 'UNKNOWN'].includes(booking.ancillaryPurchase.status) ? <FlightSelectedExtras requests={booking.ancillaryRequests ?? []} airfare={{amount: booking.amount, currency: booking.currency}}/> : null}
        {!booking.ancillaryRequests?.length && !booking.serviceRequests?.length && <p className="account-muted">No additional service requests were saved.</p>}
      </section>
      <p className="account-muted">The itinerary and accepted fare above are saved from your selected flight. Contact Flyseri to confirm airline schedule changes and ticket status.</p>
      <p>Last PNR verification: {booking.lastSabreRefreshAt ? formatTimestamp(booking.lastSabreRefreshAt) : 'Not refreshed yet'}</p>
      {booking.pnr && <button className="btn-primary" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking with Sabre…' : 'Refresh PNR from Sabre'}</button>}
      {booking.pnr && (booking.order || ['PNR_CREATED','AWAITING_PAYMENT','PAYMENT_PENDING','AWAITING_STAFF_TICKETING'].includes(booking.status)) && <p><button type="button" className="btn-primary account-submit" disabled={busy || !booking.order && !!booking.ancillaryRequests?.length && !['CONFIRMED', 'SKIPPED'].includes(booking.ancillaryPurchase?.status ?? '')} onClick={() => void continueToOrder()}>{busy ? 'Opening your order…' : booking.order?.status === 'PAID' ? 'View payment and receipt' : booking.status === 'PAYMENT_PENDING' ? 'View payment status' : 'Continue to secure payment →'}</button></p>}
      {booking.status === 'AWAITING_STAFF_TICKETING' && <section className="account-form"><h3>Test payment confirmed</h3>
        <p>{ticketingAvailable ? 'Your test tickets are being prepared automatically. This page updates when the airline confirms issuance.' : 'Your payment is saved. Test ticket issuance is awaiting activation.'}</p>
      </section>}
      {booking.status === 'BOOKING_UNKNOWN' && <p role="status">The reservation response could not be verified. This does not confirm a booking or a rejection. Confirmation will not update automatically; Flyseri must check Sabre before another reservation is submitted.</p>}
      {booking.reconciliation?.result === 'NO_ACTIVE_MATCH' && <p role="status">Sabre CERT reservation search completed at {formatTimestamp(booking.reconciliation.checkedAt)}. No active reservation matched this passenger’s exact name in the agency PCC. This search does not verify a ticket or replace a review of the uncertain creation response.</p>}
      {['BOOKING_IN_PROGRESS','MANUAL_REVIEW_REQUIRED'].includes(booking.status) && <p role="status">Flyseri needs to reconcile this attempt with Sabre. Please contact support before making another reservation for the same flight.</p>}
      {booking.status === 'BOOKING_FAILED' && <p role="status">{booking.failureMessage ?? 'No confirmed PNR was received. Contact Flyseri before starting a new booking attempt.'}</p>}
    </section>{booking.providerView && <section className="account-panel"><p className="account-eyebrow">RETRIEVED FROM SABRE</p><h2>Current airline details</h2><p className="account-muted">Retrieved {formatTimestamp(booking.providerView.retrievedAt)}. Refresh again for later changes.</p>
      {booking.providerView.travellers.length > 0 && <><h3>Airline passenger names</h3><ul>{booking.providerView.travellers.map((person,index) => <li key={index}>{person.givenName} {person.surname}</li>)}</ul></>}
      <h3>Flight segments</h3>{booking.providerView.flights.length ? booking.providerView.flights.map((flight,index) => <p key={index}><strong>{flight.airlineCode}{flight.flightNumber} · {flight.origin} → {flight.destination}</strong><br/>{flight.departureDate} {flight.departureTime} — {flight.arrivalDate} {flight.arrivalTime}<br/><small>{flight.status || 'Status not supplied'}</small></p>) : <p>No flight segments were supplied in this response. Contact Flyseri if a flight is missing.</p>}
      <h3>Ticket documents</h3>{booking.providerView.tickets.length ? <ul>{booking.providerView.tickets.map((ticket,index) => <li key={index}><strong>{ticket.number || 'Document number not supplied'}</strong> · {ticket.status || 'Status not supplied'}</li>)}</ul> : <p>No ticket documents were supplied in this response. Ticket issuance is not confirmed.</p>}
    </section>}<section className="account-panel account-form"><h2>Changes and cancellation</h2><p>Contact Flyseri for passenger corrections, flight changes, ticketing or cancellation. The team must check the airline’s conditions and any fees before processing your request.</p>
      {servicingAvailable && !booking.order && booking.pnr && ['PNR_CREATED','AWAITING_PAYMENT'].includes(booking.status) && booking.providerView?.cancellationCheckComplete && booking.providerView.tickets.length === 0 && booking.providerView.flights.length > 0 && <form onSubmit={event => {event.preventDefault(); void cancelReservation();}}><h3>Cancel this unticketed reservation</h3><p>This removes the flight reservation from the airline. Reservations with orders, tickets, hotels or cars require staff review.</p><label>Type PNR {booking.pnr} to confirm<input required maxLength={16} value={cancelConfirmation} disabled={busy} onChange={event => setCancelConfirmation(event.target.value.toUpperCase())}/></label><button type="submit" className="account-outline-button" disabled={busy || cancelConfirmation !== booking.pnr}>{busy ? 'Checking cancellation…' : 'Cancel reservation'}</button></form>}
      <Link className="account-link" to={'/app/support?bookingId=' + encodeURIComponent(booking.id)}>Request a change, refund or additional service →</Link></section></>}
  </div>;
}
