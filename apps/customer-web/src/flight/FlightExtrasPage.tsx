import { FlightSeatPlan } from './FlightSeatPlan';
import { checkoutPrice } from '../components/checkoutPrice';
import { CheckoutHelpPanel } from '../components/CheckoutHelpPanel';
import { CheckoutPageHeader } from './CheckoutPageHeader';
import './checkout-step-style.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FlightBookingIntent, TravellerProfile } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { ApiClientError } from '../lib/api/client';
import { travellerService } from '../services/travellerService';
import { AirlineIdentity } from './AirlineIdentity';
import { BookingProgress } from './BookingProgress';
import { BookingLoading } from './BookingLoading';
import { FlightAirlineServices } from './FlightAirlineServices';
import { FlightSelectedExtras } from './FlightSelectedExtras';
import { ancillarySelectionInputs } from './flightAncillarySelections';
import { useFareExpiry } from './useFareExpiry';
import { useLanguage } from '../travel/language';
import './flight-extras-page.css';
import { CheckoutActionBar } from '../components/CheckoutActionBar';
import { flightBrowseReturn } from './flightSearchBrowsing';

export function FlightExtrasPage() {
  const { intentId } = useParams();
  const location = useLocation(), navigate = useNavigate();
  const currentIntentId=useRef(intentId);currentIntentId.current=intentId;
  const { t } = useLanguage();
  const state = useRef(location.state as Record<string, unknown> | null);
  const [intent, setIntent] = useState<FlightBookingIntent | null>(null);
  const [people, setPeople] = useState<TravellerProfile[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [extrasTotal, setExtrasTotal] = useState<{amount:number;currency:string}|null>(null);
  const [rechecking,setRechecking]=useState(false),[fareNotice,setFareNotice]=useState('');
  const [fareNeedsHelp,setFareNeedsHelp]=useState(false);
  const fareRefreshLock=useRef(false),savingState=useRef(false);
  savingState.current=saving;
  const lock = useRef(false), active = useRef(true);
  const expiry = useFareExpiry(intent?.expiresAt);
  const review = `/app/flights/booking-intents/${intentId}`;
  const nextState = () => ({ ...state.current, checkLatestFare: false });
  // Start the new step at its options, not at the previous page's mobile footer.
  useLayoutEffect(() => { window.scrollTo({top:0,behavior:'instant'}); }, [intentId]);
  useEffect(() => {
    let current = true;
    active.current = true; state.current=location.state as Record<string,unknown>|null;
    setLoading(true); setError(''); setIntent(null);setPeople([]);setExtrasTotal(null);setRechecking(false);setFareNeedsHelp(false);
    async function load() {
      if (!intentId) return;
      try {
        const [selected, booking] = await Promise.all([flightService.intent(intentId), flightService.bookingForIntent(intentId)]);
        if (!current) return;
        if (booking) { navigate(`/app/bookings/${booking.id}`, { replace: true }); return; }
        const needsValidation=state.current?.checkLatestFare || ['CREATED','VALIDATING','VALIDATED'].includes(selected.status);
        const value = needsValidation && !['CANCELLED','EXPIRED','FAILED'].includes(selected.status) ? await flightService.validateIntent(intentId) : selected;
        if (!current) return;
        if (state.current?.checkLatestFare) {
          state.current = { ...state.current, checkLatestFare:false };
          navigate(location.pathname, { replace:true, state:state.current });
        }
        setIntent(value);
        // Passenger ordering must match the saved intent and supplier indexes.
        void Promise.all(value.travellerIds.map(id => travellerService.get(id))).then(values => { if (current) setPeople(values); }, () => { /* Supplier indexes remain usable when names cannot be loaded. */ });
      } catch (cause) { if (current) setError(cause instanceof Error ? cause.message : 'Could not load airline extras.'); }
      finally { if (current) setLoading(false); }
    }
    void load(); return () => { current = false; active.current = false; };
  }, [intentId, loadAttempt]);
  useEffect(()=>{
    setFareNotice('');setFareNeedsHelp(false);
    if(!intent||loading||!expiry.expired||!['READY_FOR_PAYMENT','PRICE_CHANGED','EXPIRED'].includes(intent.status))return;
    const id=intent.id;
    let current=true,attempts=0,nextAttempt=0;
    let retry:ReturnType<typeof setTimeout>|undefined;
    async function refreshFare(){
      if(!current||document.visibilityState==='hidden'||fareRefreshLock.current||lock.current||savingState.current||Date.now()<nextAttempt)return;
      fareRefreshLock.current=true;setRechecking(true);setFareNeedsHelp(false);setFareNotice('Checking the latest fare…');attempts++;
      try {
        const booking=await flightService.bookingForIntent(id);
        if(!current)return;
        if(booking){navigate(`/app/bookings/${booking.id}`,{replace:true});return;}
        const refreshed=await flightService.validateIntent(id);
        if(!current)return;
        setIntent(refreshed);setFareNotice('');
      } catch(cause){
        if(!current)return;
        const retryable=!(cause instanceof ApiClientError)||['NETWORK_ERROR','TIMEOUT','DEPENDENCY_UNAVAILABLE','RATE_LIMITED','CONFLICT'].includes(cause.code);
        nextAttempt=Date.now()+Math.max(45_000,cause instanceof ApiClientError?(cause.retryAfterSeconds??0)*1000:0);
        setFareNotice(retryable&&attempts<3?'We couldn’t update your fare just now. We’ll try again shortly.':'We couldn’t confirm your fare. Please return to your flight selection or contact Flyseri.');
        setFareNeedsHelp(!retryable||attempts>=3);
        if(retryable&&attempts<3)retry=setTimeout(()=>void refreshFare(),nextAttempt-Date.now());
      } finally {
        fareRefreshLock.current=false;
        if(current)setRechecking(false);
      }
    }
    const resume=()=>{if(document.visibilityState!=='hidden'&&Date.now()>=nextAttempt){attempts=0;void refreshFare();}};
    // The short wake-up also catches expiry during an extra being saved.
    const wake=setInterval(()=>{if(attempts===0)void refreshFare();},1000);
    void refreshFare();
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return()=>{current=false;clearInterval(wake);if(retry)clearTimeout(retry);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[intent?.id,intent?.expiresAt,intent?.status,loading,expiry.expired]);
  async function updateFare(accept=false) {
    if(!intent || loading || saving || lock.current || fareRefreshLock.current)return;
    const id=intent.id;
    if(accept && (intent.status!=='PRICE_CHANGED'||expiry.expired))return;
    fareRefreshLock.current=true;setRechecking(true);setError('');
    try {
      const updated=await (accept ? flightService.confirmPrice(id) : flightService.validateIntent(id));
      if(active.current&&currentIntentId.current===id){setIntent(updated);setFareNotice('');setFareNeedsHelp(false);}
    } catch {if(active.current&&currentIntentId.current===id)setError(accept ? 'We couldn’t accept this fare. Check the latest fare and try again.' : 'We couldn’t check the latest fare. Please try again.');}
    finally{fareRefreshLock.current=false;if(active.current&&currentIntentId.current===id)setRechecking(false);}
  }
  async function continueToReview(skip = false) {
    if (!intent || !ready || lock.current || saving || fareRefreshLock.current || !checkoutPrice(fare,currency) || !Number.isFinite(Date.parse(intent.expiresAt ?? '')) || Date.parse(intent.expiresAt!) <= Date.now()) return;
    const id=intent.id;
    lock.current = true; setSaving(true); setError('');
    try {
      if (skip && intent.ancillaryRequests?.length) await flightService.saveAncillarySelections(intent.id, []);
      if (active.current&&currentIntentId.current===id) navigate(review, { state:nextState() });
    } catch (cause) { if (active.current&&currentIntentId.current===id) setError(cause instanceof Error ? cause.message : 'Could not save your choices. Please try again.'); }
    finally { lock.current = false; if (active.current&&currentIntentId.current===id) setSaving(false); }
  }
  const ready = intent?.status === 'READY_FOR_PAYMENT' && !expiry.expired && !loading && !rechecking;
  async function removeExtra(id:string) {
    if(!intent||!ready||saving||lock.current)return;
    lock.current=true;setSaving(true);setError('');
    try {
      const remaining=(intent.ancillaryRequests??[]).filter(extra=>extra.id!==id);
      const inputs=remaining.length?ancillarySelectionInputs(remaining,await flightService.intentAncillaries(intent.id)):[];
      const updated=await flightService.saveAncillarySelections(intent.id,inputs);
      if(active.current)setIntent(updated);
    } catch(cause){if(active.current)setError(cause instanceof Error?cause.message:'Could not remove this extra. Please try again.');}
    finally{lock.current=false;if(active.current)setSaving(false);}
  }
  const fare = intent?.validatedTotalAmount ?? intent?.searchTotalAmount;
  const currency = intent?.validatedTotalAmount ? intent.currency : intent?.selectedOffer.currency;
  const total = intent?.ancillaryRequests?.length ? checkoutPrice(extrasTotal?.amount,extrasTotal?.currency) : checkoutPrice(fare,currency);
  return <main className="account-page flight-page flight-extras-page">
    <CheckoutPageHeader progress={<BookingProgress current={2} stage={1} disabled={loading||saving||rechecking||!intent} onEditTravelers={()=>navigate(`/app/flights/booking-intents/${intentId}/travelers`)} />} back={<button type="button" disabled={loading||saving||rechecking||!intent} onClick={() => navigate(`/app/flights/booking-intents/${intentId}/travelers`)}>← {t('Back to travelers')}</button>}/>
    <h1 className="sr-only">{t('Customize your flight')}</h1>
    {loading && <BookingLoading label="Checking your flight and available extras…" heading={t('Customize your flight')} description="Choose only what you need. Airline extras are optional." />}
    {error && <div role="alert" className="account-error"><p>{error}</p>{!intent && <div className="flight-extras-recovery"><button type="button" className="account-outline-button" disabled={loading} onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry loading extras</button><Link to={review} state={nextState()}>Return to your selection</Link></div>}</div>}
    {intent && !loading && <div className="flight-extras-layout"><section className="flight-extras-options">
      <div className="account-panel flight-extras-route"><AirlineIdentity codes={intent.selectedOffer.airlineCodes}/><strong>{(intent.selectedOffer.multiCityLegs ?? [intent.selectedOffer.outbound,...(intent.selectedOffer.inbound?[intent.selectedOffer.inbound]:[])]).map(leg=>`${leg.segments[0]?.origin} → ${leg.segments.at(-1)?.destination}`).join(' · ')}</strong><span>{intent.travellerIds.length} travelers</span></div>
      {intent.status==='PRICE_CHANGED'&&!expiry.expired&&<section className="account-panel flight-extras-fare-review" aria-label="Updated fare"><h2>Your fare has changed</h2><p>Review and accept the updated airfare to choose your extras.</p><strong>{checkoutPrice(fare,currency) ?? 'Price unavailable'}</strong><button type="button" className="btn-primary" disabled={rechecking||saving||!checkoutPrice(fare,currency)} onClick={()=>void updateFare(true)}>{rechecking ? 'Checking fare…' : 'Accept updated fare'}</button></section>}
      {expiry.expired&&['READY_FOR_PAYMENT','PRICE_CHANGED','EXPIRED'].includes(intent.status)&&<div className="account-panel"><p role="status">{fareNotice||'Updating your fare…'}</p>{!rechecking&&fareNeedsHelp&&<button type="button" className="account-outline-button" onClick={()=>void updateFare()}>Retry fare check</button>}</div>}
      {!['READY_FOR_PAYMENT','PRICE_CHANGED','EXPIRED'].includes(intent.status)&&<section className="account-panel" aria-label="Fare availability"><h2>{['FAILED','CANCELLED'].includes(intent.status) ? 'This flight selection needs attention' : 'Checking your flight'}</h2><p>We need to confirm your flight before you choose extras. Your traveler details are saved.</p>{!['FAILED','CANCELLED'].includes(intent.status)&&<button type="button" className="account-outline-button" disabled={rechecking||saving} onClick={()=>void updateFare()}>Check latest fare</button>}<Link className="account-link" to={flightBrowseReturn(state.current?.returnTo) ?? "/flights"}>Return to flight results</Link></section>}
      {<FlightAirlineServices key={intent.validatedAt} intentId={intent.id} ready={!!ready} requireNames={!!intent.selectedOffer.ndcContext} passengers={people.map(person=>({givenName:[person.legalFirstName,person.legalMiddleName].filter(Boolean).join(' '),surname:person.legalLastName}))} selectedExtras={intent.ancillaryRequests ?? []} onSaved={setIntent} onSavingChange={setSaving} disabled={lock.current} showSummary={false} seatPlan={<FlightSeatPlan intent={intent} disabled={!ready||saving||expiry.expired}/>}/>}
    </section><aside className="account-panel flight-extras-summary" aria-label="Your flight and extras total"><h2>{t('Your trip total')}</h2><div className="flight-extras-base"><span>{t('Flights')}</span><strong>{fare && currency ? new Intl.NumberFormat('en',{style:'currency',currency}).format(Number(fare)) : 'Awaiting fare'}</strong></div>
      {intent.ancillaryRequests?.length ? <FlightSelectedExtras requests={intent.ancillaryRequests} airfare={fare && currency ? {amount:fare,currency}:undefined} onEstimatedTripTotal={setExtrasTotal} onRemove={id=>void removeExtra(id)} disabled={saving||!ready}/> : <p>No extras added. You can continue without them.</p>}
      <CheckoutHelpPanel title="About your extras"><p>Your selections are saved as requests. We’ll review airline availability and final prices before payment.</p></CheckoutHelpPanel>
    </aside></div>}
    <CheckoutActionBar label="Continue extras checkout" caption={intent?.ancillaryRequests?.length ? 'Estimated total with extras' : intent ? `Total · ${intent.travellerIds.length} travelers` : 'Trip total'} total={total ?? (loading ? 'Loading price…' : 'Price unavailable')}>
      <button type="button" className="btn-primary" disabled={saving || !ready || !total} onClick={()=>void continueToReview()}>{saving ? 'Saving…' : rechecking ? 'Checking fare…' : t('Continue to review')} →</button>
      <button type="button" className="account-outline-button" disabled={saving || !ready || !checkoutPrice(fare,currency)} onClick={()=>void continueToReview(true)}>{t('Skip extras')}</button>
    </CheckoutActionBar>
  </main>;
}
