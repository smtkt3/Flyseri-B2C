import { Translated } from '../travel/language';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { FlightReservationInput, TravellerProfile, FlightIdentityDocumentType } from '@flyseri/types';
import { useAuth } from '../auth/AuthProvider';
import { flightService } from '../services/flightService';
import { countries } from '../trip/tripPresentation';
import {checkoutPassports,clearCheckoutPassports,hasCheckoutPassportDraft} from './checkoutPassportDraft';
import { ApiClientError } from '../lib/api/client';
import { clearCheckoutDraft, clearReservationRecovery, keepCheckoutDraft, markReservationUncertain, readCheckoutDraft, reservationNeedsRecovery, reservationRecoveryKey } from './checkoutDrafts';
import { BoundedSelect } from '../components/BoundedSelect';

export function FlightReservationForm({intentId, namesConfirmed, initialContact, people = [], documentValidThrough,passportsCaptured=false}: {intentId: string; namesConfirmed: boolean; initialContact?: {contactEmail: string; contactPhone: string}; people?: TravellerProfile[]; documentValidThrough?: string;passportsCaptured?:boolean}) {
  const navigate = useNavigate();
  const location = useLocation();
  const paymentStep = new URLSearchParams(location.search).get('step') === 'payment';
  const {session} = useAuth();
  const draftKey = `reservation:${intentId}`;
  const recoveryKey = reservationRecoveryKey(intentId, session?.user.id ?? 'guest');
  const [needsRecovery, setNeedsRecovery] = useState(() => reservationNeedsRecovery(recoveryKey));
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof flightService.bookingCapabilities>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sending = useRef(false);
  const [passports, setPassports] = useState<Record<string, {documentType?:FlightIdentityDocumentType;documentNumber: string; expiryDate: string; issuingCountryCode: string}>>({});
  const [passportConsent, setPassportConsent] = useState(false);
  const [usingPassengerPassports,setUsingPassengerPassports]=useState(false);
  const hasPassports = Object.keys(passports).length > 0;
  const minPassportExpiry = documentValidThrough && Number.isFinite(Date.parse(documentValidThrough)) ? new Date(Date.parse(documentValidThrough) + 86400000).toISOString().slice(0,10) : undefined;
  useEffect(() => { const captured=!!session&&passportsCaptured&&hasCheckoutPassportDraft(intentId,session.user.id);const records=session?checkoutPassports(intentId,session.user.id):[];setPassports(Object.fromEntries(records.map(({travellerId,...document})=>[travellerId,document])));setPassportConsent(captured);setUsingPassengerPassports(captured); }, [intentId,session?.user.id,passportsCaptured]);
  const [input, setInput] = useState<FlightReservationInput>(() => readCheckoutDraft<FlightReservationInput>(draftKey, session?.user.id ?? null) ?? {contactEmail: initialContact?.contactEmail ?? session?.user.email ?? '', contactPhone: initialContact?.contactPhone ?? '', namesConfirmed: false,
    billingAddress: {name: '', street: '', city: '', stateProvince: '', postalCode: '', countryCode: ''}});
  const inputOwner = useRef(session?.user.id ?? null);
  useEffect(() => {
    const owner = session?.user.id ?? null;
    if (inputOwner.current !== owner) {
      inputOwner.current = owner; setPassports({}); setPassportConsent(false); setUsingPassengerPassports(false);
      setInput(readCheckoutDraft<FlightReservationInput>(draftKey, owner) ?? { contactEmail: session?.user.email ?? '', contactPhone: '', namesConfirmed: false, billingAddress: { name: '', street: '', city: '', stateProvince: '', postalCode: '', countryCode: '' } });
      setNeedsRecovery(reservationNeedsRecovery(recoveryKey)); return;
    }
    keepCheckoutDraft(draftKey, owner, input);
  }, [draftKey, session?.user.id, input, recoveryKey]);
  async function recover() {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const saved = await flightService.bookingForIntent(intentId);
      if (saved) { clearReservationRecovery(recoveryKey); navigate('/app/bookings/' + saved.id, { state: { continueToPayment: true }, replace: true }); return; }
      setError('No saved booking was returned yet. Keep this selection reference and contact Flyseri before trying another reservation.');
    } catch { setError('The booking status could not be retrieved. Please contact Flyseri before reserving again.'); }
    finally { sending.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true; setCapabilities(null); setError('');
    void flightService.bookingCapabilities().then(value => { if (active) setCapabilities(value); }, () => { if (active) setError('Reservation availability could not be checked.'); });
    return () => {active = false;};
  }, [attempt]);
  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || needsRecovery || !namesConfirmed || !capabilities?.reservationAvailable || hasPassports && !passportConsent) return;
    sending.current = true; setBusy(true); setError('');
    if (!paymentStep) {
      sending.current = false; setBusy(false);
      keepCheckoutDraft(draftKey, session?.user.id ?? null, input);
      navigate(location.pathname + '?step=payment', { state: { ...location.state, reviewConfirmed: true } });
      return;
    }
    markReservationUncertain(recoveryKey);
    try { const booking = await flightService.reserve(intentId, {...input, namesConfirmed,
      ...(hasPassports ? { passports: Object.entries(passports).map(([travellerId, document]) => ({ travellerId, ...document })) } : {}) }); clearReservationRecovery(recoveryKey); clearCheckoutDraft(draftKey); clearCheckoutPassports(intentId);setPassports({}); navigate('/app/bookings/' + booking.id, { state: { continueToPayment: true }, replace: true }); }
    catch (cause) {
      // A browser timeout can follow a successful provider send. Restore the saved
      // attempt before displaying a retry action; never send another request here.
      let noSavedAttempt = false;
      try {
        const saved = await flightService.bookingForIntent(intentId);
        if (saved) { clearReservationRecovery(recoveryKey); clearCheckoutDraft(draftKey); clearCheckoutPassports(intentId);setPassports({}); navigate('/app/bookings/' + saved.id, { state: { continueToPayment: true }, replace: true }); return; }
        noSavedAttempt = true;
      } catch { /* The original error remains visible when recovery is unavailable. */ }
      setError(cause instanceof Error ? cause.message : 'The reservation result could not be retrieved. Open My bookings before retrying.');
      const safeToCorrect = cause instanceof ApiClientError && (['VALIDATION_ERROR', 'OFFER_EXPIRED', 'PRICE_CHANGED', 'AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(cause.code)
        || (cause.code === 'CONFLICT' && noSavedAttempt));
      if (safeToCorrect) clearReservationRecovery(recoveryKey);
      setNeedsRecovery(!safeToCorrect);
    }
    finally {sending.current = false; setBusy(false);}
  }
  return <section id="flight-reservation-review" className="account-panel account-form reservation-contact-panel"><header className="reservation-contact-heading"><h2>{paymentStep ? 'Billing details' : 'Booking contact'}</h2>{!paymentStep && <p>Where we’ll send booking updates.</p>}</header>
    {needsRecovery && <section className="booking-recovery" role="status"><h3>Check this attempt before continuing</h3><p>The last response could not be verified. Another reservation submission is paused to avoid duplicates.</p><p className="checkout-reference">Selection: {intentId}</p><button type="button" className="account-outline-button" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking saved booking…' : 'Check saved booking'}</button> <Link className="account-link" to={`/app/support?selectionId=${encodeURIComponent(intentId)}`}>Get help</Link></section>}
    {!capabilities && !error && <p role="status">Checking reservation availability…</p>}
    {error && <p role="alert" className="account-error">{error}{!capabilities && <button type="button" onClick={() => setAttempt(value => value + 1)}><Translated text="Retry" /></button>}</p>}
    {capabilities && !capabilities.reservationAvailable && <p>{capabilities.message}</p>}
    {capabilities?.reservationAvailable && <form onSubmit={event => void reserve(event)}><div className="reservation-test-notice" role="note"><span aria-hidden="true">ⓘ</span> Test checkout · reservations and payments are in test mode.</div><fieldset disabled={busy || needsRecovery} style={{border: 0, padding: 0, margin: 0}}><div className="account-form-grid">
      {!paymentStep && <><label>Booking email<input type="email" required maxLength={254} autoComplete="email" value={input.contactEmail} onChange={event => setInput(previous => ({...previous, contactEmail: event.target.value}))}/></label>
      <label>Booking phone<input type="tel" required pattern="\+?[0-9]{7,20}" maxLength={21} autoComplete="tel" placeholder="+60123456789" value={input.contactPhone} onChange={event => setInput(previous => ({...previous, contactPhone: event.target.value}))}/></label>
      </>}
      {paymentStep && <>{([['name','Billing name',120], ['street','Billing street address',240], ['city','Billing city',120], ['stateProvince','Billing state / region',120], ['postalCode','Billing postcode',24]] as const).map(([key,label,maxLength]) => <label key={key}>{label}<input required pattern=".*\S.*" maxLength={maxLength} value={input.billingAddress[key]} onChange={event => setInput(previous => ({...previous, billingAddress: {...previous.billingAddress, [key]: event.target.value}}))}/></label>)}
      <label>Billing country<BoundedSelect required disabled={busy||needsRecovery} searchable searchPlaceholder="Search countries" ariaLabel="Billing country" value={input.billingAddress.countryCode} placeholder="Select country" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={countryCode=>setInput(previous=>({...previous,billingAddress:{...previous.billingAddress,countryCode}}))}/></label></>}
    </div>
    {!paymentStep&&passportsCaptured&&!usingPassengerPassports&&<p role="alert">Travel document details from the passenger form expired. Enter them again below if needed.</p>}
    {!paymentStep && !usingPassengerPassports && people.length > 0 && <details open={passportsCaptured||undefined} className="reservation-passports"><summary>Travel document details <span>Optional</span></summary>
      {people.map(person => <section key={person.id}><label className="reservation-passport-toggle"><input type="checkbox" checked={!!passports[person.id]} onChange={event => { setPassportConsent(false); setPassports(previous => { const next = {...previous}; if (event.target.checked) next[person.id] = {documentType:'PASSPORT',documentNumber:'',expiryDate:'',issuingCountryCode:''}; else delete next[person.id]; return next; }); }} /><span>Add travel document for {person.legalFirstName} {person.legalLastName}</span></label>
        {passports[person.id] && <div className="account-form-grid"><label>Document type<BoundedSelect disabled={busy||needsRecovery} ariaLabel={`Document type for ${person.legalFirstName}`} value={passports[person.id]!.documentType??'PASSPORT'} placeholder="Select document type" options={[{value:'PASSPORT',label:'Passport'},{value:'NATIONAL_ID_CARD',label:'National ID card'},{value:'VISA',label:'Visa'},{value:'ALIEN_RESIDENT',label:'Resident permit'},{value:'BORDER_CROSSING_CARD',label:'Border crossing card'},{value:'REFUGEE_REENTRY_PERMIT',label:'Refugee travel document'}]} onChange={documentType=>{setPassportConsent(false);setPassports(previous=>({...previous,[person.id]:{...previous[person.id]!,documentType:documentType as FlightIdentityDocumentType,documentNumber:'',expiryDate:'',issuingCountryCode:''}}));}}/></label>
        <label>Document number<input required autoComplete="off" maxLength={30} pattern="[A-Z0-9]{3,30}" value={passports[person.id]!.documentNumber} onChange={event => { setPassportConsent(false); setPassports(previous => ({...previous,[person.id]:{...previous[person.id]!,documentNumber:event.target.value.toUpperCase().replace(/\s/g,'')}})); }}/></label>
        <label>Expiry date<input required type="date" autoComplete="off" min={minPassportExpiry} value={passports[person.id]!.expiryDate} onChange={event => {setPassportConsent(false); setPassports(previous => ({...previous,[person.id]:{...previous[person.id]!,expiryDate:event.target.value}}));}}/></label>
        <label>Issuing country<BoundedSelect required disabled={busy||needsRecovery} searchable searchPlaceholder="Search countries" ariaLabel={`Issuing country for ${person.legalFirstName}`} value={passports[person.id]!.issuingCountryCode} placeholder="Select country" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={issuingCountryCode=>{setPassportConsent(false);setPassports(previous=>({...previous,[person.id]:{...previous[person.id]!,issuingCountryCode}}));}}/></label></div>}
      </section>)}
      {hasPassports && <label className="reservation-passport-toggle"><input type="checkbox" required checked={passportConsent} onChange={event => setPassportConsent(event.target.checked)} /><span>I checked these travel document details and authorize submitting them for this reservation.</span></label>}
    </details>}
    {paymentStep && <><p>Your billing details prepare the airline reservation before secure payment. No payment is taken here.</p><button type="button" className="account-outline-button" disabled={busy} onClick={() => navigate(location.pathname, {state:location.state})}>← Back to review</button></>}
    <div className="reservation-contact-actions"><div><strong>{paymentStep ? 'Ready for secure payment?' : 'Next: payment details'}</strong><p>{!namesConfirmed ? 'Confirm traveler names and check that your fare is still valid.' : paymentStep ? 'Review your billing details before continuing.' : 'Add your billing details in the next step.'}</p></div><button type="submit" className="btn-primary account-submit" disabled={!namesConfirmed || busy || hasPassports && !passportConsent}>{busy ? 'Preparing payment…' : paymentStep ? 'Continue to secure payment' : 'Continue to payment'}</button></div></fieldset></form>}

  </section>;
}
