import { CheckoutPageHeader } from './CheckoutPageHeader';
import './checkout-step-style.css';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FlightBookingIntent, TravellerProfile } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { travellerService } from '../services/travellerService';
import { AirlineIdentity } from './AirlineIdentity';
import { BookingProgress } from './BookingProgress';
import { BookingLoading } from './BookingLoading';
import { FlightAirlineServices } from './FlightAirlineServices';
import { FlightSelectedExtras } from './FlightSelectedExtras';
import { useFareExpiry } from './useFareExpiry';
import { useLanguage } from '../travel/language';
import './flight-extras-page.css';

export function FlightExtrasPage() {
  const { intentId } = useParams();
  const location = useLocation(), navigate = useNavigate();
  const { t } = useLanguage();
  const state = useRef(location.state as Record<string, unknown> | null);
  const [intent, setIntent] = useState<FlightBookingIntent | null>(null);
  const [people, setPeople] = useState<TravellerProfile[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), active = useRef(true);
  const expiry = useFareExpiry(intent?.expiresAt);
  const review = `/app/flights/booking-intents/${intentId}`;
  const nextState = () => ({ ...state.current, checkLatestFare: false });
  useEffect(() => {
    let current = true;
    active.current = true; setLoading(true); setError(''); setIntent(null);
    async function load() {
      if (!intentId) return;
      try {
        const [selected, booking] = await Promise.all([flightService.intent(intentId), flightService.bookingForIntent(intentId)]);
        if (!current) return;
        if (booking) { navigate(`/app/bookings/${booking.id}`, { replace: true }); return; }
        const value = state.current?.checkLatestFare && !['CANCELLED','EXPIRED'].includes(selected.status) ? await flightService.validateIntent(intentId) : selected;
        if (!current) return;
        if (state.current?.checkLatestFare) {
          state.current = { ...state.current, checkLatestFare:false };
          navigate(location.pathname, { replace:true, state:state.current });
        }
        setIntent(value);
        if (value.status !== 'READY_FOR_PAYMENT') { navigate(review, { replace:true, state:nextState() }); return; }
        // Passenger ordering must match the saved intent and supplier indexes.
        void Promise.all(value.travellerIds.map(id => travellerService.get(id))).then(values => { if (current) setPeople(values); }, () => { /* Supplier indexes remain usable when names cannot be loaded. */ });
      } catch (cause) { if (current) setError(cause instanceof Error ? cause.message : 'Could not load airline extras.'); }
      finally { if (current) setLoading(false); }
    }
    void load(); return () => { current = false; active.current = false; };
  }, [intentId]);
  async function continueToReview(skip = false) {
    if (!intent || lock.current || saving || Date.parse(intent.expiresAt ?? '') <= Date.now()) return;
    lock.current = true; setSaving(true); setError('');
    try {
      if (skip && intent.ancillaryRequests?.length) await flightService.saveAncillarySelections(intent.id, []);
      if (active.current) navigate(review, { state:nextState() });
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Could not save your choices. Please try again.'); }
    finally { lock.current = false; if (active.current) setSaving(false); }
  }
  const ready = intent?.status === 'READY_FOR_PAYMENT' && !expiry.expired;
  const fare = intent?.validatedTotalAmount ?? intent?.searchTotalAmount;
  const currency = intent?.validatedTotalAmount ? intent.currency : intent?.selectedOffer.currency;
  return <main className="account-page flight-page flight-extras-page">
    <CheckoutPageHeader title={t('Customize your flight')} description="Choose only what you need. Airline extras are optional." back={<button type="button" disabled={saving} onClick={() => state.current ? navigate(-1) : navigate(review)}>← {t('Back')}</button>}/>
    <BookingProgress current={2} stage={1} />
    {loading && <BookingLoading label="Checking your flight and available extras…" />}
    {error && <p role="alert" className="account-error">{error} {!intent && <Link to={review} state={nextState()}>Return to your selection</Link>}</p>}
    {intent && !loading && <div className="flight-extras-layout"><section className="flight-extras-options">
      <div className="account-panel flight-extras-route"><AirlineIdentity codes={intent.selectedOffer.airlineCodes}/><strong>{(intent.selectedOffer.multiCityLegs ?? [intent.selectedOffer.outbound,...(intent.selectedOffer.inbound?[intent.selectedOffer.inbound]:[])]).map(leg=>`${leg.segments[0]?.origin} → ${leg.segments.at(-1)?.destination}`).join(' · ')}</strong><span>{intent.travellerIds.length} travelers</span></div>
      {expiry.expired ? <div className="account-panel"><p role="status">Your fare check expired. Refresh it before choosing extras.</p><Link className="btn-primary" to={review} state={nextState()}>Check latest fare</Link></div> : <FlightAirlineServices key={intent.validatedAt} intentId={intent.id} ready={!!ready} requireNames={!!intent.selectedOffer.ndcContext} passengers={people.map(person=>({givenName:[person.legalFirstName,person.legalMiddleName].filter(Boolean).join(' '),surname:person.legalLastName}))} selectedExtras={intent.ancillaryRequests ?? []} onSaved={setIntent} onSavingChange={setSaving} disabled={lock.current} showSummary={false}/>}
    </section><aside className="account-panel flight-extras-summary" aria-label="Your flight and extras total"><h2>{t('Your trip total')}</h2><div className="flight-extras-base"><span>{t('Flights')}</span><strong>{fare && currency ? new Intl.NumberFormat('en',{style:'currency',currency}).format(Number(fare)) : 'Awaiting fare'}</strong></div>
      {intent.ancillaryRequests?.length ? <FlightSelectedExtras requests={intent.ancillaryRequests} airfare={fare && currency ? {amount:fare,currency}:undefined}/> : <p>No extras selected. Your flight’s included allowances stay the same.</p>}
      <div className="flight-extras-actions"><button type="button" className="btn-primary" disabled={saving || !ready} onClick={()=>void continueToReview()}>{saving ? 'Saving…' : t('Continue to review')} →</button><button type="button" className="account-outline-button" disabled={saving || !ready} onClick={()=>void continueToReview(true)}>{t('Skip extras')}</button></div>
      <p className="account-muted">Selections are saved to your booking request. Final airline prices and confirmation are reviewed before payment.</p>
    </aside></div>}
  </main>;
}
