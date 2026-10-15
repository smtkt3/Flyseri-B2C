import { useBookingEvidencePoll } from './useBookingEvidencePoll';
import { BookingProgress } from './BookingProgress';
import { FlightTicketIssuanceNotice } from './FlightTicketIssuanceNotice';
import { CheckoutHelpPanel } from '../components/CheckoutHelpPanel';
import { CheckoutActionBar } from '../components/CheckoutActionBar';
import { bookingHasIssuedTickets, bookingOutcome } from '../flight/bookingPresentation';
import { Chevron } from '../components/Chevron';
import { CheckoutPageHeader } from './CheckoutPageHeader';
import { Translated } from '../travel/language';
import { FlightAncillaryPurchasePanel } from './FlightAncillaryPurchasePanel';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { formatMoney, formatTimestamp } from '../account/presentation';
import { AirlineIdentity } from './AirlineIdentity';
import { downloadText } from '../lib/downloadText';
import { serviceRequestSummary } from './FlightServiceRequests';
import { FlightSelectedExtras } from './FlightSelectedExtras';
import { ReviewFlightLeg } from './ReviewFlightLeg';
import { ReviewFlightInclusions } from './ReviewFlightInclusions';
import './flight-review-page.css';
import './reservation-details.css';
import { TravelCompanion } from '../travel/TravelCompanion';
import { BookingRecovery, BookingStatusSummary } from './BookingStatusSummary';
import { BookingLoading } from './BookingLoading';
import { FlightPaymentPreparation } from './FlightPaymentPreparation';
import { usePreferredDisplayPrices } from './usePreferredDisplayPrices';

export { BookingList as FlightBookingsPage } from './BookingList';
import { bookingDisplayStatus as statusLabel, bookingLegs as legsOf, bookingRoute as routeOf } from './bookingPresentation';

export function FlightBookingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {bookingId = ''} = useParams();
  const activeBookingId = useRef(bookingId);
  activeBookingId.current = bookingId;
  const mutation = useRef(false);
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
    let active = true; setLoading(true); setBooking(null); setError(''); setNotice(''); setCancelConfirmation('');
    setServicingAvailable(false);
    setTicketingAvailable(false);
    void flightService.bookingCapabilities().then(value => {if (active) { setServicingAvailable(value.reservationAvailable); setTicketingAvailable(value.ticketIssuanceAvailable); }}, () => undefined);
    void flightService.booking(bookingId).then(value => { if (active) setBooking(value); }, () => { if (active) setError('We could not load this booking.'); }).finally(() => { if (active) setLoading(false); });
    return () => {active = false;};
  }, [bookingId, attempt]);
  useBookingEvidencePoll(booking,booking?.id === bookingId,setBooking);
  async function refresh() {
    if (busy || mutation.current) return;const id=bookingId;mutation.current=true;setBusy(true); setError(''); setNotice('');
    try { const value=await flightService.refreshBooking(id);if(activeBookingId.current===id){setBooking(value);setNotice('Your booking details have been updated. See the airline details and ticket documents below.');} }
    catch (cause) { if(activeBookingId.current===id)setError(cause instanceof Error ? cause.message : 'Booking refresh failed.'); }
    finally { mutation.current=false;setBusy(false); }
  }
  async function continueToOrder() {
    if (!booking || booking.id !== bookingId || busy) return;
    if (booking.order) { navigate('/app/orders/' + booking.order.id); return; }
    // Use the same reservation verification, fare refresh and extras review as checkout.
    navigate('/app/bookings/' + booking.id, { state: { continueToPayment: true } });
  }
  async function cancelReservation() {
    if (!booking?.pnr || booking.id !== bookingId || cancelConfirmation !== booking.pnr || busy || mutation.current) return;
    const id=bookingId;mutation.current=true;
    setBusy(true); setError(''); setNotice('');
    try { const value=await flightService.cancelBooking(id,cancelConfirmation);if(activeBookingId.current===id){setBooking(value);setCancelConfirmation('');setNotice('Your flight reservation has been cancelled.');} }
    catch (cause) {
      if(activeBookingId.current===id)setError(cause instanceof Error ? cause.message : 'Cancellation could not be confirmed.');
      try {const value=await flightService.booking(id);if(activeBookingId.current===id)setBooking(value);} catch { /* Keep the last displayed reservation and its error. */ }
    } finally {mutation.current=false;setBusy(false);}
  }
  const paymentConfirmed = booking?.order?.status === 'PAID' && !!booking.order.paidAt && Number.isFinite(Date.parse(booking.order.paidAt));
  const checkoutBlocked = (location.state as {checkoutBlocked?:string}|null)?.checkoutBlocked;
  const canPreparePayment = !!booking?.pnr && ['PNR_CREATED','AWAITING_PAYMENT','PAYMENT_PENDING'].includes(booking.status) && (!booking.order || ['PENDING_PAYMENT','PAYMENT_PROCESSING'].includes(booking.order.status));
  const outcome = booking ? bookingOutcome(booking) : undefined;
  if (booking && canPreparePayment && !paymentConfirmed && checkoutBlocked) return <main className="account-page flight-page checkout-step-page"><CheckoutPageHeader introOnly progress={<BookingProgress current={2}/>} title="Review your reservation" description="Your reservation is saved. Check your selection to continue."/><CheckoutHelpPanel title="Reservation needs review"><p>{checkoutBlocked}</p><Link className="checkout-help-link" to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>Get booking help →</Link></CheckoutHelpPanel><CheckoutActionBar label="Continue booking review" caption="Flight total" total={displayedFare}><button type="button" className="btn-primary" onClick={() => navigate('/app/bookings/' + booking.id, {replace:true,state:{continueToPayment:true}})}>Check &amp; continue to payment</button></CheckoutActionBar></main>;
  if (booking && canPreparePayment && !paymentConfirmed && !checkoutBlocked) return <FlightPaymentPreparation key={booking.id} booking={booking} />;
  return <div className="account-page flight-page flight-review-page reservation-details-page"><CheckoutPageHeader introOnly={!outcome} progress={<BookingProgress current={3} outcome={outcome} paymentComplete={!!paymentConfirmed}/>} title={outcome ? {confirmed:'Booking confirmed',pending:'Booking pending',unsuccessful:'Booking unsuccessful'}[outcome] : 'Booking status'} back={<Link to="/app/bookings">← My bookings</Link>}/>
    {loading && <BookingLoading label="Loading booking details…" heading="Booking status" description="Checking your reservation and latest updates." />}
    {error && <div role="alert" className="account-error">{error}{!booking && <button className="account-outline-button" onClick={() => setAttempt(value => value + 1)}><Translated text="Retry" /></button>}</div>}
    {(location.state as {checkoutBlocked?:string}|null)?.checkoutBlocked && <section className="booking-recovery" role="alert"><h2>Reservation verification required</h2><p>{(location.state as {checkoutBlocked:string}).checkoutBlocked}</p><p>Payment is paused. Your selected extras have not been changed. Contact Flyseri to verify this reservation before continuing.</p><Link className="account-outline-button" to={`/app/support?bookingId=${encodeURIComponent(bookingId)}`}>Get booking help</Link></section>}
    {notice && <p role="status" className="account-panel">{notice}</p>}
    {booking && <><section className="account-panel flight-intent-card"><div className="flight-offer-top"><AirlineIdentity codes={booking.selectedOffer.airlineCodes}/><strong className="reservation-status-badge">{statusLabel(booking)}</strong></div><h2>{routeOf(booking)}</h2>

      <BookingStatusSummary booking={booking} />
      {paymentConfirmed && <FlightTicketIssuanceNotice booking={booking} paidAt={booking.order?.paidAt} ticketingAvailable={ticketingAvailable}/> }
      <BookingRecovery booking={booking} />
      <div className="reservation-workspace"><div className="reservation-workspace-main"><div className="reservation-document-action"><button className="account-outline-button" type="button" onClick={() => downloadText(`Flyseri-booking-${booking.id}.txt`, ['Flyseri reservation summary', `Booking: ${booking.id}`, `PNR: ${booking.pnr ?? 'Awaiting airline confirmation'}`, `Status: ${statusLabel(booking)}`, `Accepted fare: ${booking.currency} ${booking.amount}`, 'Passengers:', ...booking.passengerNames, ...(booking.ancillaryPurchase ? [`Airline extras status: ${booking.ancillaryPurchase.status}`, `Extras checkout total: ${booking.ancillaryPurchase.currency} ${booking.ancillaryPurchase.extrasAmount}`, `Trip total: ${booking.ancillaryPurchase.currency} ${booking.ancillaryPurchase.totalAmount}`] : []), ...(booking.ancillaryPurchase?.status === 'SKIPPED' ? [] : (booking.ancillaryRequests ?? [])).map(extra => `Selected extra (${['CONFIRMED', 'FULFILLMENT_PENDING', 'FULFILLED'].includes(booking.ancillaryPurchase?.status ?? '') ? 'attached to airline reservation; see document status' : 'awaiting airline confirmation, not purchased'}): ${extra.name}; ${extra.segmentLabels.join(' / ')}; Traveler ${extra.passengerIndexes.map(index => index + 1).join(', ')}; quote ${extra.currency ?? ''} ${extra.amount ?? 'not available'}`), ...(booking.serviceRequests ?? []).map(request => `Service request (awaiting confirmation) - ${request.passengerName}: ${serviceRequestSummary(request)}`), ...legsOf(booking).flatMap(leg => leg.segments.map(segment => `${segment.marketingCarrier}${segment.flightNumber}: ${segment.origin} → ${segment.destination}; ${segment.departureAt} → ${segment.arrivalAt}`)), `Last booking update: ${booking.lastSabreRefreshAt ?? 'Not refreshed'}`, 'This reservation summary is not an airline ticket. Confirm airline status before travel.'].join('\n'))}>Download reservation summary</button><span>Summary only · not an airline ticket</span></div>
      <div className="reservation-detail-grid"><section className="reservation-content-section reservation-itinerary"><h2>Your flights</h2><p className="account-muted">Saved itinerary · times are local to each airport.</p>{legsOf(booking).map((leg,index)=><ReviewFlightLeg key={index} leg={leg} title={booking.selectedOffer.multiCityLegs ? `Flight ${index+1}` : index===0 ? 'Outbound' : 'Return'}/>)}</section><section className="reservation-content-section reservation-passengers"><h2>Travelers · {booking.passengerNames.length}</h2><ul>{booking.passengerNames.map((name,index)=><li key={index}><span aria-hidden="true">{index+1}</span><div><small>Traveler {index+1}</small><strong>{name}</strong></div></li>)}</ul><p className="account-muted">{booking.passengerNamesSource === 'BOOKED_SNAPSHOT' ? 'Names submitted with this reservation.' : 'Selected profile names; airline confirmation pending.'}</p></section></div>
      <section className="reservation-content-section" aria-label="Meals, baggage and assistance"><details className="reservation-inclusions"><summary>Baggage &amp; onboard services <span aria-hidden="true"><Chevron/></span></summary><ReviewFlightInclusions offer={booking.selectedOffer}/></details>
        {!!booking.serviceRequests?.length && <><h4>Your saved requests</h4><ul>{booking.serviceRequests.map(request => <li key={request.travellerId}><strong>{request.passengerName}</strong>: {serviceRequestSummary(request)}</li>)}</ul>
          <p className="account-muted">Awaiting airline confirmation. These requests are not purchased extras and are excluded from your ticket total.</p></>}
        </section><section className="reservation-content-section reservation-extras"><h2>Airline extras</h2><FlightAncillaryPurchasePanel readOnly={!!(location.state as {checkoutBlocked?:string}|null)?.checkoutBlocked || !booking.pnr || !['PNR_CREATED','AWAITING_PAYMENT'].includes(booking.status)} booking={booking} onChange={purchase => { setBooking(current => current ? {...current, ancillaryPurchase: purchase} : current); void flightService.booking(booking.id).then(value => setBooking(current => current?.id === value.id ? value : current), () => undefined); }}/>
        {!booking.ancillaryPurchase || ['PREPARED', 'UNAVAILABLE', 'ADDING', 'UNKNOWN'].includes(booking.ancillaryPurchase.status) ? <FlightSelectedExtras requests={booking.ancillaryRequests ?? []} airfare={{amount: booking.amount, currency: booking.currency}}/> : null}
        {!booking.ancillaryRequests?.length && !booking.serviceRequests?.length && <p className="account-muted">No additional service requests were saved.</p>}
      </section>
      <p className="account-muted">The itinerary and accepted fare above are saved from your selected flight. Contact Flyseri to confirm airline schedule changes and ticket status.</p>

      {booking.status === 'BOOKING_UNKNOWN' && <p role="status">We could not confirm your reservation. Please contact Flyseri before making another booking for the same flight.</p>}
      {booking.reconciliation?.result === 'NO_ACTIVE_MATCH' && <p role="status">Reservation checked at {formatTimestamp(booking.reconciliation.checkedAt)}. No active reservation was found for this traveler. Please contact Flyseri before booking again. Ticket issuance is not confirmed.</p>}
      {['BOOKING_IN_PROGRESS','MANUAL_REVIEW_REQUIRED'].includes(booking.status) && <p role="status">Your reservation needs a review. Please contact Flyseri before making another booking for the same flight.</p>}
      {booking.status === 'BOOKING_FAILED' && <p role="status">{booking.failureMessage ?? 'No confirmed PNR was received. Contact Flyseri before starting a new booking attempt.'}</p>}
      </div><aside className="reservation-sidebar" aria-label="Reservation summary"><h2>Booking summary</h2>      <div className="reservation-facts"><p><span>Airline reference (PNR)</span><strong>{booking.pnr || 'Awaiting airline confirmation'}</strong></p><p><span>Accepted airfare</span><strong>{displayedFare}</strong></p><p><span>Ticket status</span><strong>{bookingHasIssuedTickets(booking) ? 'Issued — see documents below' : booking.pnr ? 'Not issued' : 'Not confirmed'}</strong></p></div>      <section className="reservation-next-step"><h2>Payment &amp; verification</h2><p className="reservation-verified-at">Last airline check: {booking.lastSabreRefreshAt ? formatTimestamp(booking.lastSabreRefreshAt) : 'Not refreshed yet'}</p>
      {booking.pnr && <button className="account-outline-button" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking booking status…' : 'Check airline status'}</button>}
      {!(location.state as {checkoutBlocked?:string}|null)?.checkoutBlocked && booking.pnr && (booking.order || ['PNR_CREATED','AWAITING_PAYMENT','PAYMENT_PENDING','AWAITING_STAFF_TICKETING'].includes(booking.status)) && <CheckoutActionBar label="Continue booking payment" caption="Reservation total" total={new Intl.NumberFormat('en',{style:'currency',currency:booking.ancillaryPurchase && ['CONFIRMED','FULFILLMENT_PENDING','FULFILLED'].includes(booking.ancillaryPurchase.status) ? booking.ancillaryPurchase.currency : booking.currency}).format(Number(booking.ancillaryPurchase && ['CONFIRMED','FULFILLMENT_PENDING','FULFILLED'].includes(booking.ancillaryPurchase.status) ? booking.ancillaryPurchase.totalAmount : booking.amount))}><button type="button" className="btn-primary account-submit" disabled={busy || !booking.order && !!booking.ancillaryRequests?.length && !['CONFIRMED', 'SKIPPED'].includes(booking.ancillaryPurchase?.status ?? '')} onClick={() => void continueToOrder()}>{busy ? 'Opening your order…' : booking.order?.status === 'PAID' ? 'View payment and receipt' : booking.status === 'PAYMENT_PENDING' ? 'View payment status' : 'Continue to secure payment →'}</button></CheckoutActionBar>}
      {(location.state as {checkoutBlocked?:string}|null)?.checkoutBlocked && <p className="account-muted">Payment is paused until Flyseri verifies your reservation.</p>}</section><Link className="reservation-sidebar-help" to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>Need help with this booking? →</Link></aside></div>
    </section>{booking.providerView && <section className="account-panel reservation-airline-details"><details><summary>Current airline details &amp; ticket documents</summary><p className="account-eyebrow">AIRLINE BOOKING DETAILS</p><h2>Current airline details</h2><p className="account-muted">Retrieved {formatTimestamp(booking.providerView.retrievedAt)}. Refresh again for later changes.</p>
      {booking.providerView.travellers.length > 0 && <><h3>Airline passenger names</h3><ul>{booking.providerView.travellers.map((person,index) => <li key={index}>{person.givenName} {person.surname}</li>)}</ul></>}
      <h3>Flight segments</h3>{booking.providerView.flights.length ? booking.providerView.flights.map((flight,index) => <p key={index}><strong>{flight.airlineCode}{flight.flightNumber} · {flight.origin} → {flight.destination}</strong><br/>{flight.departureDate} {flight.departureTime} — {flight.arrivalDate} {flight.arrivalTime}<br/><small>{flight.status || 'Status not supplied'}</small></p>) : <p>No flight segments were supplied in this response. Contact Flyseri if a flight is missing.</p>}
      <h3>Ticket documents</h3>{booking.providerView.tickets.length ? <ul>{booking.providerView.tickets.map((ticket,index) => <li key={index}><strong>{ticket.number || 'Document number not supplied'}</strong> · {ticket.status || 'Status not supplied'}</li>)}</ul> : <p>No ticket documents were supplied in this response. Ticket issuance is not confirmed.</p>}
    </details></section>}<section className="account-panel reservation-tools"><h2>Save your trip</h2><TravelCompanion booking={booking}/></section><section className="account-panel account-form reservation-support"><h2>Changes &amp; support</h2><p>Contact Flyseri for passenger corrections, flight changes, ticketing or cancellation. The team must check the airline’s conditions and any fees before processing your request.</p>
      {servicingAvailable && !booking.order && booking.pnr && ['PNR_CREATED','AWAITING_PAYMENT'].includes(booking.status) && booking.providerView?.cancellationCheckComplete && booking.providerView.tickets.length === 0 && booking.providerView.flights.length > 0 && <form onSubmit={event => {event.preventDefault(); void cancelReservation();}}><h3>Cancel this unticketed reservation</h3><p>This removes the flight reservation from the airline. Reservations with orders, tickets, hotels or cars require staff review.</p><label>Type PNR {booking.pnr} to confirm<input required maxLength={16} value={cancelConfirmation} disabled={busy} onChange={event => setCancelConfirmation(event.target.value.toUpperCase())}/></label><button type="submit" className="account-outline-button" disabled={busy || cancelConfirmation !== booking.pnr}>{busy ? 'Checking cancellation…' : 'Cancel reservation'}</button></form>}
      <Link className="account-link" to={'/app/support?bookingId=' + encodeURIComponent(booking.id)}>Request a change, refund or additional service →</Link></section></>}
  </div>;
}
