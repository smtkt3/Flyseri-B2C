import { Chevron } from '../components/Chevron';
import { CheckoutPageHeader } from './CheckoutPageHeader';
import './checkout-step-style.css';
import './flight-review-page.css';
import { ReviewFlightLeg } from './ReviewFlightLeg';
import { ReviewFlightInclusions } from './ReviewFlightInclusions';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FlightBookingIntent, TravellerProfile } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { flightService } from '../services/flightService';
import { travellerService } from '../services/travellerService';
import { AirlineIdentity } from './AirlineIdentity';
import { formatMoney, intentStatus } from '../account/presentation';
import { FlightReservationForm } from './FlightReservationForm';
import { serviceRequestSummary } from './FlightServiceRequests';
import { BookingProgress } from './BookingProgress';
import { useFareExpiry } from './useFareExpiry';
import { useAutomaticFareRefresh } from './useAutomaticFareRefresh';
import { FlightSelectedExtras } from './FlightSelectedExtras';
import { BookingLoading } from './BookingLoading';
import { flightBrowseReturn } from './flightSearchBrowsing';
import { usePreferredDisplayPrices } from './usePreferredDisplayPrices';

export function FlightIntentPage() {
  const { intentId } = useParams();
  const location = useLocation();
  const paymentStep = new URLSearchParams(location.search).get('step') === 'payment';
  const returnTo = useRef(flightBrowseReturn((location.state as { returnTo?: unknown } | null)?.returnTo));
  const navigate = useNavigate();
  const checkedOnEntry = useRef(false);
  const busy = useRef(false);
  const bookingContact = useRef((location.state as { bookingContact?: { contactEmail: string; contactPhone: string } } | null)?.bookingContact);
  const passportsCaptured=useRef((location.state as {passportsCaptured?:boolean}|null)?.passportsCaptured===true);
  const [intent, setIntent] = useState<FlightBookingIntent | null>(null);
  const [travellers, setTravellers] = useState<TravellerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [namesConfirmed, setNamesConfirmed] = useState((location.state as {reviewConfirmed?:boolean}|null)?.reviewConfirmed === true);
  const fareExpiry = useFareExpiry(intent?.expiresAt);
  useAutomaticFareRefresh(intent, fareExpiry.expired, !loading && !checking, check);
  const currentFare = intent?.validatedTotalAmount && ['VALIDATED', 'PRICE_CHANGED', 'READY_FOR_PAYMENT'].includes(intent.status)
    ? intent.validatedTotalAmount : intent?.searchTotalAmount;
  const checkedFare = !!intent?.validatedTotalAmount && ['VALIDATED', 'PRICE_CHANGED', 'READY_FOR_PAYMENT'].includes(intent.status);
  const display = usePreferredDisplayPrices([
    { amount: currentFare ?? null, currency: checkedFare ? intent!.currency : intent?.selectedOffer.currency ?? 'MYR' },
    { amount: intent?.searchTotalAmount ?? null, currency: intent?.selectedOffer.currency ?? 'MYR' },
  ]);
  const displayFare = (index: number) => display.prices[index]?.amount != null
    ? `${display.prices[index]!.estimated ? '≈ ' : ''}${formatMoney(display.prices[index]!.amount, display.currency)}`
    : display.failed ? 'Price conversion unavailable' : `Updating ${display.currency} price…`;

  useEffect(() => {
    if (!intentId) return;
    let active = true;
    setLoading(true); setIntent(null); setError(''); checkedOnEntry.current = false;
    void Promise.all([flightService.intent(intentId), flightService.bookingForIntent(intentId)]).then(([value, booking]) => {
      if (!active) return;
      if (booking) { navigate('/app/bookings/' + booking.id, { replace: true, state: {continueToPayment: true} }); return; }
      setIntent(value); setNamesConfirmed(paymentStep && (location.state as {reviewConfirmed?:boolean}|null)?.reviewConfirmed === true);
      setTravellers([]);
      void Promise.all(value.travellerIds.map(id=>travellerService.get(id))).then((people) => { if (active) setTravellers(people); }, () => {if(active)setError('Passenger details could not be loaded. Refresh this page before confirming the names.');});
      if ((location.state as { checkLatestFare?: boolean } | null)?.checkLatestFare && !checkedOnEntry.current) {
        checkedOnEntry.current = true;
        navigate(location.pathname, { replace: true, state: returnTo.current ? { returnTo: returnTo.current } : null });
        void check(value.id);
      }
    }, (cause) => { if (active) setError(cause instanceof ApiClientError && cause.code === 'NOT_FOUND' ? 'This flight selection was not found.' : "We couldn't load this flight selection."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // The route ID defines the record; clearing navigation state must not refetch it.
  }, [intentId]);

  async function check(id: string) {
    if (busy.current) return;
    busy.current = true; setChecking(true); setError('');
    try { setIntent(await flightService.validateIntent(id)); }
    catch (cause) { setError(cause instanceof ApiClientError && ['DEPENDENCY_UNAVAILABLE', 'VALIDATION_ERROR', 'CONFLICT'].includes(cause.code)
      ? cause.message
      : "We couldn't confirm the latest fare. Please try again or choose another flight."); }
    finally { busy.current = false; setChecking(false); }
  }

  async function acceptLatestFare() {
    if (!intent || busy.current) return;
    busy.current = true; setChecking(true); setError('');
    try { setIntent(await flightService.confirmPrice(intent.id)); }
    catch { setError('This fare could not be accepted. Please check the latest fare again.'); }
    finally { busy.current = false; setChecking(false); }
  }

  return <div className={`account-page flight-page flight-review-page${intent?.status === 'READY_FOR_PAYMENT' ? ' checkout-with-mobile-actions' : ''}`}>
    <CheckoutPageHeader title={paymentStep ? 'Payment details' : 'Review your trip'} description={paymentStep ? 'Add billing details to continue to secure payment.' : 'Check your flights and traveler details before continuing.'} back={<button type="button" onClick={() => paymentStep ? navigate(location.pathname, {state:location.state}) : navigate(-1)}>← {paymentStep ? 'Back to review' : 'Back'}</button>}/>
    <BookingProgress current={paymentStep ? 3 : 2} />
    {loading && <BookingLoading label="Loading your flight selection…" />}
    {!loading && intent && <div className="account-panel flight-intent-card">
      {!paymentStep && <div className="flight-review-layout"><section className="flight-review-main" aria-label="Flight and travelers"><header className="flight-review-heading"><AirlineIdentity codes={intent.selectedOffer.airlineCodes} /><div className="flight-review-price flight-review-header-price"><small>{checkedFare ? 'Latest fare' : 'Shopping fare'} · {intent.travellerIds.length} travelers</small><strong>{displayFare(0)}</strong></div></header>
      <div className="flight-review-meta"><span className={`flight-review-status${intent.status === 'PRICE_CHANGED' ? ' is-changed' : ''}`}>{intentStatus(intent.status)}</span><span className="flight-review-cabin">{intent.selectedOffer.cabin ? intent.selectedOffer.cabin.replace(/_/g, ' ').toLowerCase() : 'Cabin not specified'}{intent.selectedOffer.fareBrand ? ` · ${intent.selectedOffer.fareBrand}` : ''}</span></div>
      <section className="flight-review-itinerary" aria-label="Your flights">{(intent.selectedOffer.multiCityLegs ?? [intent.selectedOffer.outbound, ...(intent.selectedOffer.inbound ? [intent.selectedOffer.inbound] : [])]).map((leg, index) => {
        const first = leg.segments[0]; const last = leg.segments.at(-1);
        if (!first || !last) return null;
        return <ReviewFlightLeg key={index} leg={leg} title={intent.selectedOffer.multiCityLegs ? `Flight ${index + 1}` : index === 0 ? 'Outbound' : 'Return'} />;
      })}</section>
      <details className="flight-review-inclusions"><summary>Baggage &amp; onboard services<span aria-hidden="true"><Chevron/></span></summary><ReviewFlightInclusions offer={intent.selectedOffer}/></details>
      <section className="flight-intent-people review-traveler-panel" aria-label="Traveler review"><header className="review-section-heading"><h2>Travelers</h2><span>{intent.travellerIds.length} {intent.travellerIds.length === 1 ? 'traveler' : 'travelers'}</span></header><p>Check each name matches the travel document.</p><ul>{intent.travellerIds.map((id, index) => {
        const person = travellers.find((item) => item.id === id);
        return <li key={id}><span className="review-traveler-number" aria-hidden="true">{index + 1}</span><div><small>Traveler {index + 1}</small><strong>{person ? [person.legalFirstName, person.legalMiddleName, person.legalLastName].filter(Boolean).join(' ') : 'Traveller details unavailable'}</strong></div></li>;
      })}</ul>{intent.status === 'READY_FOR_PAYMENT' && <label className="flight-name-confirmation"><input type="checkbox" checked={namesConfirmed} onChange={(event) => setNamesConfirmed(event.target.checked)} /> I checked these legal names against their travel documents.</label>}</section>
      {!!intent.serviceRequests?.length && <section className="flight-intent-people"><strong>Service requests · awaiting confirmation</strong>
        <ul>{intent.serviceRequests.map(request => { const person = travellers.find(item => item.id === request.travellerId);
          return <li key={request.travellerId}><strong>{person ? `${person.legalFirstName} ${person.legalLastName}` : 'Traveller'}</strong>: {serviceRequestSummary(request)}</li>;
        })}</ul><p>Saved for Flyseri review. Airline services and additional charges are confirmed separately.</p></section>}
      </section><aside className="flight-review-summary" aria-label="Price summary"><h2>Price summary</h2><p className="flight-review-summary-count">{intent.travellerIds.length} {intent.travellerIds.length === 1 ? 'traveler' : 'travelers'} · {intent.selectedOffer.cabin?.replace(/_/g, ' ').toLowerCase() ?? 'Flight'}</p><div className="flight-review-summary-total"><span>{checkedFare ? 'Checked airfare' : 'Last quoted airfare'}</span><strong>{displayFare(0)}</strong></div>
      {checkedFare ? <section className={`flight-fare-comparison${intent.status === 'PRICE_CHANGED' ? ' is-changed' : ''}`} aria-label="Fare review"><h3>{intent.status === 'PRICE_CHANGED' ? 'Your fare has changed' : 'Latest fare checked'}</h3>{intent.status === 'PRICE_CHANGED' && <><p>Review the updated price before you continue.</p><div className="flight-review-fare-row"><span>Previous fare</span><strong>{displayFare(1)}</strong></div></>}<div className="flight-review-fare-row"><span>Latest total · all travelers</span><strong>{displayFare(0)}</strong></div><small>No payment has been taken. Continue to reserve your flight.</small></section>
        : intent.status !== 'EXPIRED' && <p className="flight-fare-note">Check the latest price and availability before continuing.</p>}
      {display.prices[0]?.estimated && <p className="flight-review-fx-note">Prices in {display.currency} are converted estimates.{display.provider && <> <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Exchange rates</a>.</>}</p>}
      {intent.status === 'READY_FOR_PAYMENT' && <p role="status">{fareExpiry.expired ? checking ? 'Checking the latest fare…' : error ? 'The latest fare could not be checked. Please retry below.' : 'Updating your fare automatically…' : 'Fare check valid for ' + fareExpiry.remaining + '. Reserve to continue to payment.'}</p>}
      <FlightSelectedExtras requests={intent.ancillaryRequests ?? []} airfare={{amount: intent.validatedTotalAmount ?? intent.searchTotalAmount, currency: checkedFare ? intent.currency : intent.selectedOffer.currency}}/>
      {intent.status === 'READY_FOR_PAYMENT' && !fareExpiry.expired && <div className="flight-intent-actions"><Link className="account-outline-button" to={`/app/flights/booking-intents/${intent.id}/extras`} state={{...location.state,bookingContact:bookingContact.current,passportsCaptured:passportsCaptured.current,returnTo:returnTo.current,checkLatestFare:false}}>{intent.ancillaryRequests?.length ? 'Edit airline extras' : 'Customize your flight'} →</Link></div>}
      {intent.status === 'EXPIRED' && <div className="flight-review-expired" role="status"><span className="flight-review-expired-icon" aria-hidden="true">↻</span><h3>{error ? 'Fare check needs attention' : 'Checking your latest fare'}</h3><p>{error ? 'We couldn’t update this fare. Retry the check below or choose another flight.' : 'We’re checking current prices and availability. Your details are saved.'}</p><Link className="btn-primary" to={returnTo.current ? returnTo.current.pathname + returnTo.current.search : '/app/flights'} state={returnTo.current ? {flightBrowseKey:returnTo.current.key} : undefined}>Find available flights →</Link></div>}
      </aside></div>}
      {intent.status === 'READY_FOR_PAYMENT' && <FlightReservationForm passportsCaptured={passportsCaptured.current} intentId={intent.id} initialContact={bookingContact.current} people={intent.travellerIds.flatMap(id => { const person = travellers.find(person => person.id === id); return person ? [person] : []; })} documentValidThrough={(intent.selectedOffer.multiCityLegs?.at(-1) ?? intent.selectedOffer.inbound ?? intent.selectedOffer.outbound).segments.at(-1)?.arrivalAt.slice(0,10)} namesConfirmed={namesConfirmed && !fareExpiry.expired && !checking && intent.travellerIds.length > 0 && intent.travellerIds.every(id => travellers.some(person => person.id === id))}/>}
      {intent.status === 'FAILED' && <p role="status">This option could not be confirmed. Check the fare again or choose another flight.</p>}
      {intent.status === 'CANCELLED' ? <p role="status">This checkout selection was removed. No airline booking was cancelled.</p>
        : intent.status === 'EXPIRED' && !error ? null
        : intent.status === 'FAILED' ? <div className="flight-intent-actions"><Link className="account-outline-button" to="/app/flights">Choose another flight</Link></div>
        : intent.status === 'READY_FOR_PAYMENT' && !fareExpiry.expired ? null
        : <div className="flight-intent-actions flight-required-fare-action">{intent.status === 'PRICE_CHANGED' && !fareExpiry.expired ? <><p>Review and accept the updated total to continue.</p><button type="button" className="btn-primary" disabled={checking} onClick={() => { void acceptLatestFare(); }}>Accept updated fare</button></> : <><p role="status">{checking ? 'Checking the latest fare…' : error ? 'We couldn’t update the fare. Please try again.' : 'Updating your fare automatically…'}</p>{!checking && !!error && <button type="button" className="btn-primary" disabled={checking} onClick={() => { void check(intent.id); }}>{checking ? 'Checking latest fare…' : 'Retry fare check'}</button>}</>}</div>}
    </div>}
    {error && <p role="alert" className="account-error flight-error">{error}</p>}
    <Link className="flight-add-traveller"
      to={returnTo.current ? returnTo.current.pathname + returnTo.current.search : intent?.tripId ? `/app/flights?tripId=${encodeURIComponent(intent.tripId)}` : '/app/flights'}
      state={returnTo.current ? { flightBrowseKey: returnTo.current.key } : undefined}>← {returnTo.current ? 'Back to results' : 'View latest flights'}</Link>
    {intent?.status === 'READY_FOR_PAYMENT' && !fareExpiry.expired && <div className="checkout-mobile-bar" aria-label="Review reservation"><div><small>Checked fare · {intent.travellerIds.length} travelers</small><strong>{displayFare(0)}</strong></div><a className="btn-primary" href="#flight-reservation-review">Review &amp; reserve</a></div>}
  </div>;
}
