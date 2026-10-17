import { BookingLoading } from './BookingLoading';
import { FlightBillingFields } from './FlightBillingFields';
import { CheckoutHelpPanel } from '../components/CheckoutHelpPanel';
import { Translated } from '../travel/language';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FlightReservationInput, TravellerProfile, FlightIdentityDocumentType } from '@flyseri/types';
import { useAuth } from '../auth/AuthProvider';
import { flightService } from '../services/flightService';
import { countries } from '../trip/tripPresentation';
import {checkoutPassports,clearCheckoutPassports,hasCheckoutPassportDraft} from './checkoutPassportDraft';
import { ApiClientError } from '../lib/api/client';
import { clearCheckoutDraft, clearReservationRecovery, keepCheckoutDraft, markReservationUncertain, readCheckoutDraft, reservationNeedsRecovery, reservationRecoveryKey } from './checkoutDrafts';
import { BoundedSelect } from '../components/BoundedSelect';
import { CheckoutActionBar } from '../components/CheckoutActionBar';
import { checkoutPassportError } from './checkoutContinuation';
import { CalendarDateField } from '../components/CalendarDateField';

export function FlightReservationForm({intentId, namesConfirmed, initialContact, people = [], documentValidThrough,passportsCaptured=false,total='Checked fare',totalCaption='Checked airfare',priceAvailable=true,onBusyChange}: {intentId: string; namesConfirmed: boolean; initialContact?: {contactEmail: string; contactPhone: string}; people?: TravellerProfile[]; documentValidThrough?: string;passportsCaptured?:boolean;total?:string;totalCaption?:string;priceAvailable?:boolean;onBusyChange?:(busy:boolean)=>void}) {
  const formId = useId();
  const navigate = useNavigate();
  const {session} = useAuth();
  const draftKey = `reservation:${intentId}`;
  const recoveryKey = reservationRecoveryKey(intentId, session?.user.id ?? 'guest');
  const [needsRecovery, setNeedsRecovery] = useState(() => reservationNeedsRecovery(recoveryKey));
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof flightService.bookingCapabilities>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current=true; return () => {active.current=false;}; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy,onBusyChange]);
  const [passports, setPassports] = useState<Record<string, {documentType?:FlightIdentityDocumentType;documentNumber: string; expiryDate: string; issuingCountryCode: string; residenceCountryCode?:string}>>({});
  const [passportConsent, setPassportConsent] = useState(false);
  const [usingPassengerPassports,setUsingPassengerPassports]=useState(false);
  const hasPassports = Object.keys(passports).length > 0;
  const peopleKey = people.map(person=>person.id).join(',');
  const documentComplete = (document:{documentNumber:string;expiryDate:string;issuingCountryCode:string;residenceCountryCode?:string}|undefined) => !!document && !checkoutPassportError({idNumber:document.documentNumber,idExpiryDate:document.expiryDate,issuingCountryCode:document.issuingCountryCode,residenceCountryCode:document.residenceCountryCode},documentValidThrough??new Date().toISOString().slice(0,10));
  const documentsComplete = people.length>0 && people.every(person=>documentComplete(passports[person.id]));
  const minPassportExpiry = documentValidThrough && Number.isFinite(Date.parse(documentValidThrough)) ? new Date(Date.parse(documentValidThrough) + 86400000).toISOString().slice(0,10) : undefined;
  useEffect(() => {
    const records=session?checkoutPassports(intentId,session.user.id):[];
    const captured=!!session&&passportsCaptured&&hasCheckoutPassportDraft(intentId,session.user.id)&&people.length>0&&people.every(person=>documentComplete(records.find(document=>document.travellerId===person.id)));
    setPassports(Object.fromEntries(people.map(person=>{
      const record=records.find(document=>document.travellerId===person.id);
      return [person.id,record?{documentType:record.documentType,documentNumber:record.documentNumber,expiryDate:record.expiryDate,issuingCountryCode:record.issuingCountryCode,residenceCountryCode:record.residenceCountryCode??''}:{documentType:'PASSPORT',documentNumber:'',expiryDate:'',issuingCountryCode:'',residenceCountryCode:''}];
    })));
    setPassportConsent(captured);setUsingPassengerPassports(captured);
  }, [intentId,session?.user.id,passportsCaptured,peopleKey,documentValidThrough]);
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
      if (saved) { clearReservationRecovery(recoveryKey); if(active.current)navigate('/app/bookings/' + saved.id, { state: { continueToPayment: true }, replace: true }); return; }
      if (!active.current) return;
      setError('No saved booking was returned yet. Keep this selection reference and contact Flyseri before trying another reservation.');
    } catch { if(active.current)setError('The booking status could not be retrieved. Please contact Flyseri before reserving again.'); }
    finally { sending.current = false; if(active.current)setBusy(false); }
  }
  useEffect(() => {
    let active = true; setCapabilities(null); setError('');
    void flightService.bookingCapabilities().then(value => { if (active) setCapabilities(value); }, () => { if (active) setError('Reservation availability could not be checked.'); });
    return () => {active = false;};
  }, [attempt]);
  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || needsRecovery || !priceAvailable || !namesConfirmed || !capabilities?.reservationAvailable || hasPassports && !passportConsent) return;
    if (!documentsComplete) { setError('Complete travel document details for every traveler.'); return; }
    if (!event.currentTarget.reportValidity()) return;
    sending.current = true; setBusy(true); setError('');
    markReservationUncertain(recoveryKey);
    try { const booking = await flightService.reserve(intentId, {...input, namesConfirmed,
      ...(hasPassports ? { passports: Object.entries(passports).map(([travellerId, document]) => ({ travellerId, ...document })) } : {}) }); clearReservationRecovery(recoveryKey); clearCheckoutDraft(draftKey); clearCheckoutPassports(intentId);if(active.current){setPassports({}); navigate('/app/bookings/' + booking.id, { state: { continueToPayment: true }, replace: true });} }
    catch (cause) {
      // A browser timeout can follow a successful provider send. Restore the saved
      // attempt before displaying a retry action; never send another request here.
      let noSavedAttempt = false;
      try {
        const saved = await flightService.bookingForIntent(intentId);
        if (saved) { clearReservationRecovery(recoveryKey); clearCheckoutDraft(draftKey); clearCheckoutPassports(intentId);if(active.current){setPassports({}); navigate('/app/bookings/' + saved.id, { state: { continueToPayment: true }, replace: true });} return; }
        noSavedAttempt = true;
      } catch { /* The original error remains visible when recovery is unavailable. */ }
      if(active.current)setError(cause instanceof Error ? cause.message : 'The reservation result could not be retrieved. Open My bookings before retrying.');
      const safeToCorrect = cause instanceof ApiClientError && (['VALIDATION_ERROR', 'OFFER_EXPIRED', 'PRICE_CHANGED', 'AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(cause.code)
        || (cause.code === 'CONFLICT' && noSavedAttempt));
      if (safeToCorrect) clearReservationRecovery(recoveryKey);
      if(active.current)setNeedsRecovery(!safeToCorrect);
    }
    finally {sending.current = false; if(active.current)setBusy(false);}
  }
  return <section id="flight-reservation-review" className="account-panel account-form reservation-contact-panel"><header className="reservation-contact-heading"><h2>Contact &amp; billing details</h2><p>All fields are required. Use the payer’s billing address for your receipt.</p></header>
    {busy && <BookingLoading label="Preparing secure payment…" heading="Preparing secure payment" description="Please keep this page open while we confirm your flight."/>}
    {needsRecovery && <section className="booking-recovery" role="status"><h3>Check this attempt before continuing</h3><p>The last response could not be verified. Another reservation submission is paused to avoid duplicates.</p><p className="checkout-reference">Selection: {intentId}</p><button type="button" className="account-outline-button" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking saved booking…' : 'Check saved booking'}</button> <Link className="account-link" to={`/app/support?selectionId=${encodeURIComponent(intentId)}`}>Get help</Link></section>}
    {!capabilities && !error && <p role="status">Checking reservation availability…</p>}
    {error && <p role="alert" className="account-error">{error}{!capabilities && <button type="button" onClick={() => setAttempt(value => value + 1)}><Translated text="Retry" /></button>}</p>}
    {capabilities && !capabilities.reservationAvailable && <p>{capabilities.message}</p>}
    {capabilities?.reservationAvailable && <form id={formId} onSubmit={event => void reserve(event)}><div className="reservation-test-notice" role="note"><span aria-hidden="true">ⓘ</span> Test checkout · reservations and payments are in test mode.</div><fieldset disabled={busy || needsRecovery} style={{border: 0, padding: 0, margin: 0}}><FlightBillingFields value={input} onChange={setInput} disabled={busy || needsRecovery}/>
    {passportsCaptured&&!usingPassengerPassports&&<p role="alert">Travel document details from the passenger form expired. Enter the required details again below.</p>}
    {!usingPassengerPassports && people.length > 0 && <details open className="reservation-passports"><summary>Travel document details <span>Required</span></summary>
      {people.map(person => <section key={person.id}><h3>{person.legalFirstName} {person.legalLastName}</h3>
        {passports[person.id] && <div className="account-form-grid"><label>Document type<BoundedSelect disabled={busy||needsRecovery} ariaLabel={`Document type for ${person.legalFirstName}`} value={passports[person.id]!.documentType??'PASSPORT'} placeholder="Select document type" options={[{value:'PASSPORT',label:'Passport'},{value:'NATIONAL_ID_CARD',label:'National ID card'},{value:'VISA',label:'Visa'},{value:'ALIEN_RESIDENT',label:'Resident permit'},{value:'BORDER_CROSSING_CARD',label:'Border crossing card'},{value:'REFUGEE_REENTRY_PERMIT',label:'Refugee travel document'}]} onChange={documentType=>{setPassportConsent(false);setPassports(previous=>({...previous,[person.id]:{...previous[person.id]!,documentType:documentType as FlightIdentityDocumentType,documentNumber:'',expiryDate:'',issuingCountryCode:''}}));}}/></label>
        <label>Document number<input required autoComplete="off" maxLength={30} pattern="[A-Z0-9]{3,30}" value={passports[person.id]!.documentNumber} onChange={event => { setPassportConsent(false); setPassports(previous => ({...previous,[person.id]:{...previous[person.id]!,documentNumber:event.target.value.toUpperCase().replace(/\s/g,'')}})); }}/></label>
        <label>Expiry date<CalendarDateField label="Document expiry date" required className="checkout-calendar-field" minDate={minPassportExpiry} value={passports[person.id]!.expiryDate} onChange={expiryDate=>{setPassportConsent(false);setPassports(previous=>({...previous,[person.id]:{...previous[person.id]!,expiryDate}}));}}/></label>
        <label>Issuing country<BoundedSelect required disabled={busy||needsRecovery} searchable searchPlaceholder="Search countries" ariaLabel={`Issuing country for ${person.legalFirstName}`} value={passports[person.id]!.issuingCountryCode} placeholder="Select country" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={issuingCountryCode=>{setPassportConsent(false);setPassports(previous=>({...previous,[person.id]:{...previous[person.id]!,issuingCountryCode}}));}}/></label><label>Country of residence *<BoundedSelect required disabled={busy||needsRecovery} searchable searchPlaceholder="Search countries" ariaLabel={`Country of residence for ${person.legalFirstName}`} value={passports[person.id]!.residenceCountryCode??''} placeholder="Where the traveler lives" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={residenceCountryCode=>{setPassportConsent(false);setPassports(previous=>({...previous,[person.id]:{...previous[person.id]!,residenceCountryCode}}));}}/></label></div>}
      </section>)}
      {hasPassports && <label className="reservation-passport-toggle"><input type="checkbox" required checked={passportConsent} onChange={event => setPassportConsent(event.target.checked)} /><span>I checked these travel document details and authorize submitting them for this reservation.</span></label>}
    </details>}
    <CheckoutHelpPanel title="Next: payment"><p>{!namesConfirmed ? 'Confirm the traveler names above before continuing.' : !documentsComplete || !passportConsent ? 'Complete and confirm the travel documents above before continuing.' : !priceAvailable ? 'Please wait while we check your fare, or review the price update above.' : 'Choose your payment method and apply a promo code on the next step.'}</p></CheckoutHelpPanel></fieldset>

    </form>}
    <CheckoutActionBar label="Continue reservation checkout" caption={totalCaption} total={total} detailsHref="#flight-review-total"><button type="submit" form={formId} className="btn-primary account-submit" disabled={!priceAvailable || !capabilities?.reservationAvailable || !namesConfirmed || busy || needsRecovery || !documentsComplete || !passportConsent}>{busy ? 'Preparing payment…' : 'Continue to payment'}</button></CheckoutActionBar>

  </section>;
}
