import { FlightBaggageDetails, FlightServiceDetails } from './FlightFareInformation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { FlightOffer, FlightSearchRequest, TravellerProfile, FlightAncillaryRequest, FlightIdentityDocumentType } from '@flyseri/types';
import {keepCheckoutPassports} from './checkoutPassportDraft';
import { emptyServicePreferences, FlightServiceRequestFields, hasServiceRequest } from './FlightServiceRequests';
import { FlightAirlineServices } from './FlightAirlineServices';
import { refreshAncillarySelections } from './flightAncillarySelections';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { useAuth } from '../auth/AuthProvider';
import { AirlineIdentity, airlineName } from './AirlineIdentity';
import { flightService } from '../services/flightService';
import { travellerService } from '../services/travellerService';
import { countries } from '../trip/tripPresentation';
import { checkoutPassengerError, checkoutPassportError, matchingCheckoutTraveller } from './checkoutContinuation';
import { ApiClientError } from '../lib/api/client';
import { randomUUID } from '../lib/randomUUID';
import { FlightPriceDetails } from './FlightPriceDetails';
import { BookingProgress } from './BookingProgress';
import { BoundedSelect } from '../components/BoundedSelect';
import { useCheckoutShoppingFare } from './useCheckoutShoppingFare';
import { clearCheckoutDraft, keepCheckoutDraft, readCheckoutDraft } from './checkoutDrafts';
import { flightBrowseReturn, flightBrowseSearchQuery, type FlightBrowseReturn } from './flightSearchBrowsing';

interface GuestCheckoutState {
  offer: FlightOffer;
  searchRequest: FlightSearchRequest;
  searchId: string;
  returnTo?: FlightBrowseReturn;
}
type PassengerKind = 'Adult' | 'Child' | 'Infant';
type Passenger = { kind: PassengerKind; givenNames: string; surname: string; gender: string; birthDate: string; nationality: string; idType: FlightIdentityDocumentType; idNumber: string; idExpiryDate: string; issuingCountryCode:string; saveForFuture:boolean; frequentFlyer: string; confirmed: boolean };
type Contact = { name: string; email: string; dialCode: string; phone: string };
type GuestDraft = { selectedExtras?: FlightAncillaryRequest[]; passengers: Passenger[]; contact: Contact; servicePreferences: ReturnType<typeof emptyServicePreferences>[]; contactNameManuallyEdited: boolean; submissionKey: string; submittedAttemptId: string | null };
const emptyPassenger = (kind: PassengerKind): Passenger => ({ kind, givenNames: '', surname: '', gender: '', birthDate: '', nationality: '', idType: 'PASSPORT', idNumber: '', idExpiryDate: '', issuingCountryCode:'', saveForFuture:false, frequentFlyer: '', confirmed: false });
const documentTypes: Array<{value:FlightIdentityDocumentType;label:string}> = [{value:'PASSPORT',label:'Passport'},{value:'NATIONAL_ID_CARD',label:'National ID card'},{value:'VISA',label:'Visa'},{value:'ALIEN_RESIDENT',label:'Resident permit'},{value:'BORDER_CROSSING_CARD',label:'Border crossing card'},{value:'REFUGEE_REENTRY_PERMIT',label:'Refugee travel document'}];
const passengersFor = (request: FlightSearchRequest): Passenger[] => [
  ...Array.from({ length: request.adults }, () => emptyPassenger('Adult')),
  ...Array.from({ length: request.children }, () => emptyPassenger('Child')),
  ...Array.from({ length: request.infants }, () => emptyPassenger('Infant')),
];
const validPassenger = (passenger: Passenger, departureDate: string, lastTravelDate: string) => !checkoutPassengerError(passenger, departureDate, lastTravelDate);

const money = (amount: string, currency: string) => {
  const value = Number(amount);
  return Number.isFinite(value) ? new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(value) : `${currency} ${amount}`;
};
const dateTime = (value: string) => {
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!local) return value;
  const wallTime = new Date(`${local[1]}T${local[2]}:00Z`);
  if (Number.isNaN(wallTime.valueOf())) return value;
  const displayed = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(wallTime);
  return `${displayed} ${local[3] === 'Z' ? 'UTC' : `UTC${local[3]}`}`;
};
const legsOf = (offer: FlightOffer) => offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];

function isCheckoutState(value: unknown): value is GuestCheckoutState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GuestCheckoutState>;
  return typeof candidate.searchId === 'string' && !!candidate.searchRequest && !!candidate.offer &&
    typeof candidate.offer.offerId === 'string' && Array.isArray(candidate.offer.airlineCodes);
}

export function GuestFlightCheckoutPage() {
  const location = useLocation();
  const state = isCheckoutState(location.state) ? location.state : null;
  if (!state) return <Navigate to="/flights" replace state={{ notice: 'Choose a flight again to continue.' }} />;
  return <CheckoutContent key={`${state.searchId}:${state.offer.offerId}`} checkout={state} />;
}

function CheckoutContent({ checkout }: { checkout: GuestCheckoutState }) {
  const returnTo = flightBrowseReturn(checkout.returnTo);
  const navigate = useNavigate();
  const { session } = useAuth();
  const { offer, searchRequest } = checkout;
  const draftKey = `guest:${checkout.searchId}:${offer.offerId}`;
  const [draft] = useState(() => readCheckoutDraft<GuestDraft>(draftKey, session?.user.id ?? null));
  const [passengers, setPassengers] = useState(() => draft?.passengers ?? passengersFor(searchRequest));
  const [savedPeople,setSavedPeople]=useState<TravellerProfile[]>([]);
  const [savedSelections,setSavedSelections]=useState<Record<number,string>>({});
  const [archivingPerson,setArchivingPerson]=useState<string|null>(null);
  const createdPeople=useRef<Map<number,string>>(new Map());
  const profileRequest=useRef(0);
  useEffect(()=>{let active=true;setSavedPeople([]);createdPeople.current.clear();if(session)void travellerService.list().then(people=>{if(active)setSavedPeople(people);},()=>undefined);return()=>{active=false;profileRequest.current++;};},[session?.user.id]);
  const [servicePreferences, setServicePreferences] = useState(() => draft?.servicePreferences ?? passengersFor(searchRequest).map(() => emptyServicePreferences()));
  const [selectedExtras, setSelectedExtras] = useState<FlightAncillaryRequest[]>(draft?.selectedExtras ?? []);
  const [ancillaryTotal,setAncillaryTotal]=useState<{amount:number;currency:string}|null>(null);
  const reportAncillaryTotal=useCallback((total:{amount:number;currency:string}|null)=>setAncillaryTotal(current=>current?.amount===total?.amount&&current?.currency===total?.currency?current:total),[]);
  const [contact, setContact] = useState<Contact>(draft?.contact ?? { name: '', email: '', dialCode: '+60', phone: '' });
  const [contactNameManuallyEdited, setContactNameManuallyEdited] = useState(draft?.contactNameManuallyEdited ?? false);
  const [checkoutNotice, setCheckoutNotice] = useState('');
  const [mobilePriceDetailsOpen, setMobilePriceDetailsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedAttemptId, setSubmittedAttemptId] = useState<string | null>(draft?.submittedAttemptId ?? null);
  const submissionKey = useRef(draft?.submissionKey ?? randomUUID());
  const draftOwner = useRef(session?.user.id ?? null);
  useEffect(() => {
    const owner = session?.user.id ?? null;
    // Guest details may follow the sign-in overlay; switching away from an
    // existing account clears private fields before another owner can save them.
    if (draftOwner.current !== null && draftOwner.current !== owner) {
      clearCheckoutDraft(draftKey); draftOwner.current = owner;
      setPassengers(passengersFor(searchRequest)); setContact({ name: '', email: '', dialCode: '+60', phone: '' });
      setServicePreferences(passengersFor(searchRequest).map(() => emptyServicePreferences()));
      setContactNameManuallyEdited(false); setSubmittedAttemptId(null); submissionKey.current = randomUUID();
      setSelectedExtras([]); clearShoppingFare(); return;
    }
    draftOwner.current = owner;
    keepCheckoutDraft(draftKey, owner, { passengers, contact, servicePreferences, selectedExtras, contactNameManuallyEdited, submissionKey: submissionKey.current, submittedAttemptId });
  }, [draftKey, session?.user.id, passengers, contact, servicePreferences, selectedExtras, contactNameManuallyEdited, submittedAttemptId, searchRequest]);
  const sending = useRef(false);
  const route = legsOf(offer).map((leg) => `${leg.segments[0]?.origin ?? '—'} → ${leg.segments.at(-1)?.destination ?? '—'}`).join(' · ');
  const lastTravelDate = legsOf(offer).flatMap((leg) => leg.segments.map((segment) => segment.arrivalAt.slice(0, 10))).sort().at(-1) ?? searchRequest.departureDate;
  const detailsReady=passengers.every(person=>person.confirmed&&validPassenger(person,searchRequest.departureDate,lastTravelDate)&&!checkoutPassportError(person,lastTravelDate))&&!!contact.name.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())&&contact.phone.replace(/\D/g,'').length>=6;
  const {selection:latestSelection,checking:checkingFare,error:fareCheckError,ensure:ensureShoppingFare,clear:clearShoppingFare}=useCheckoutShoppingFare(offer,searchRequest,session?.user.id??null,detailsReady,submitting||!!submittedAttemptId);
  const pricedOffer = latestSelection?.offer ?? offer;
  const priceChanged=!!latestSelection&&(latestSelection.offer.currency!==offer.currency||Number(latestSelection.offer.totalAmount)!==Number(offer.totalAmount));
  const travelers = passengers.length;
  useEffect(() => {
    if (!mobilePriceDetailsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobilePriceDetailsOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobilePriceDetailsOpen]);
  const tripDescription = searchRequest.tripType === 'ROUND_TRIP' ? 'Round trip' : searchRequest.tripType === 'MULTI_CITY' ? 'Multi-city' : 'One way';
  function markDetailsChanged() {
    submissionKey.current = randomUUID();
    setSubmittedAttemptId(null);
    setCheckoutNotice('');
  }
  function editPassenger(index: number, update: Partial<Passenger>, keepSavedSelection = false) {
    if (sending.current) return;
    markDetailsChanged();
    createdPeople.current.delete(index);
    profileRequest.current++;
    if (!keepSavedSelection) setSavedSelections(current => { const next={...current};delete next[index];return next; });
    setPassengers((current) => current.map((passenger, at) => at === index ? { ...passenger, ...update } : passenger));
  }
  function confirmPassenger(event: FormEvent<HTMLFormElement>, index: number) {
    event.preventDefault();
    const passenger = passengers[index];
    if (!passenger) return;
    const error = checkoutPassengerError(passenger, searchRequest.departureDate, lastTravelDate);
    if (error) { setCheckoutNotice(error); return; }
    const passportError=checkoutPassportError(passenger,lastTravelDate);
    if(passportError){setCheckoutNotice(passportError);return;}
    editPassenger(index, { confirmed: true });
    if (index === 0 && !contactNameManuallyEdited) setContact((current) => ({ ...current, name: `${passenger.givenNames.trim()} ${passenger.surname.trim()}` }));
  }
  async function selectSavedPassenger(index:number,id:string){
    const person=savedPeople.find(person=>person.id===id);if(!person)return;
    editPassenger(index,{givenNames:[person.legalFirstName,person.legalMiddleName].filter(Boolean).join(' '),surname:person.legalLastName,gender:person.gender??'',birthDate:person.dateOfBirth??'',nationality:person.nationalityCountryCode??'',idType:'PASSPORT',idNumber:'',idExpiryDate:'',issuingCountryCode:'',confirmed:false},true);
    setSavedSelections(current=>({...current,[index]:id}));
    const request=++profileRequest.current;
    try{const passport=await travellerService.passport(id);if(request===profileRequest.current&&passport)editPassenger(index,{idNumber:passport.documentNumber,idExpiryDate:passport.expiryDate,issuingCountryCode:passport.issuingCountryCode},true);}catch{if(request===profileRequest.current)setCheckoutNotice('Traveler details loaded. Enter passport details manually if needed.');}
  }
  async function archiveSavedPassenger(person:TravellerProfile){
    const name=[person.legalFirstName,person.legalMiddleName,person.legalLastName].filter(Boolean).join(' ');
    if(!window.confirm(`Remove ${name} from your saved travelers? Details already entered in this booking will remain.`))return;
    setArchivingPerson(person.id);setCheckoutNotice('');
    try{
      await travellerService.archive(person.id);
      setSavedPeople(current=>current.filter(saved=>saved.id!==person.id));
      setSavedSelections(current=>Object.fromEntries(Object.entries(current).filter(([,id])=>id!==person.id)));
      setCheckoutNotice(`${name} was removed from saved travelers. Details already entered in this booking remain.`);
    }catch{setCheckoutNotice("We couldn't remove this saved traveler. Please try again.");}
    finally{setArchivingPerson(null);}
  }
  function updateContact(update: Partial<Contact>) {
    if (sending.current) return;
    markDetailsChanged();
    if (update.name !== undefined) setContactNameManuallyEdited(true);
    setContact((current) => ({ ...current, ...update }));
  }
  async function handleNext() {
    if (sending.current || submittedAttemptId) return;
    if (passengers.some((passenger) => !passenger.confirmed || !validPassenger(passenger, searchRequest.departureDate, lastTravelDate) || checkoutPassportError(passenger,lastTravelDate))) {
      setCheckoutNotice('Confirm every passenger before continuing.');
      return;
    }
    if (!contact.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) || contact.phone.replace(/\D/g, '').length < 6) {
      setCheckoutNotice('Enter a contact name, valid email address, and mobile phone number before continuing.');
      return;
    }
    if (!session) {
      navigate('/sign-in', { state: { from: '/flight-checkout' } });
      return;
    }
    sending.current = true;
    setSubmitting(true);
    setCheckoutNotice('');
    try {
      const selection=await ensureShoppingFare();
      if(selection.offer.currency!==pricedOffer.currency||Number(selection.offer.totalAmount)!==Number(pricedOffer.totalAmount)){
        setCheckoutNotice('The fare has changed. Review the updated total, then continue.');
        return;
      }
      const people = await travellerService.list();
      const travellerIds: string[] = [];
      for (const [index,passenger] of passengers.entries()) {
        const matches = passenger.saveForFuture ? people.filter(person => !travellerIds.includes(person.id) && matchingCheckoutTraveller(person, passenger)) : [];
        if (matches.length > 1) throw new Error('More than one saved profile matches a passenger. Select the correct profile from My Flyseri flight search.');
        const previous=createdPeople.current.get(index);
        const person = previous ? {id:previous} : matches[0] ?? await travellerService.create({ legalFirstName: passenger.givenNames.trim(), legalLastName: passenger.surname.trim(),
          dateOfBirth: passenger.birthDate, gender: passenger.gender as 'FEMALE' | 'MALE' | 'X', nationalityCountryCode: passenger.nationality, relationshipType: 'OTHER',saveForFuture:passenger.saveForFuture });
        createdPeople.current.set(index,person.id);
        if(passenger.saveForFuture&&passenger.idType==='PASSPORT'&&passenger.idNumber)await travellerService.savePassport(person.id,{documentNumber:passenger.idNumber,expiryDate:passenger.idExpiryDate,issuingCountryCode:passenger.issuingCountryCode});
        if (!matches.length && 'legalFirstName' in person && passenger.saveForFuture) people.push(person as TravellerProfile);
        travellerIds.push(person.id);
      }
      const intent = await flightService.createIntent({ searchId: selection.searchId, offerId: selection.offer.offerId,
        ancillarySelections: await refreshAncillarySelections({ searchId: selection.searchId, offerId: selection.offer.offerId, passengers: passengers.map(person => ({ givenName: selection.offer.ndcContext ? person.givenNames.trim() : '', surname: selection.offer.ndcContext ? person.surname.trim() : '' })) }, selectedExtras),
        tripId: searchRequest.tripId, travellerIds, idempotencyKey: submissionKey.current,
        serviceRequests: servicePreferences.flatMap((value, index) => hasServiceRequest(value) ? [{ ...value, note: value.note.trim(), travellerId: travellerIds[index]! }] : []) });
      setSubmittedAttemptId(intent.id);
      keepCheckoutPassports(intent.id,session.user.id,passengers.flatMap((person,index)=>person.idNumber?[{travellerId:travellerIds[index]!,documentType:person.idType,documentNumber:person.idNumber,expiryDate:person.idExpiryDate,issuingCountryCode:person.issuingCountryCode}]:[]));
      navigate(`/app/flights/booking-intents/${intent.id}`, { state: { checkLatestFare: true, returnTo,
        passportsCaptured:true, bookingContact: { contactEmail: contact.email.trim(), contactPhone: `${contact.dialCode}${contact.phone.replace(/\D/g, '').replace(/^0/, '')}` } } });
    } catch (error) {
      if (error instanceof ApiClientError && ['OFFER_EXPIRED', 'NOT_FOUND'].includes(error.code)) clearShoppingFare();
      setCheckoutNotice(error instanceof Error ? error.message : 'We could not continue checkout. Please try again.');
    } finally { sending.current = false; setSubmitting(false); }
  }

  return <div className="guest-checkout-shell">
    <PremiumNavbar />
    <Link className="guest-checkout-back" to={(returnTo?.pathname ?? '/flights') + flightBrowseSearchQuery(checkout.searchRequest)}
      state={{ flightBrowseKey: returnTo?.key, flightBrowseSearchId: checkout.searchId }}>← Back to results</Link>
    <main className="guest-checkout-content">
      <BookingProgress current={1} stage={latestSelection ? 2 : passengers.every(person => person.confirmed) ? 1 : 0} />
      <h1>Complete your traveler details</h1>
      <p className="guest-checkout-intro">Enter your details, then sign in or create an account to check the fare and manage your test reservation.</p>

      <div className="guest-checkout-layout">
        <section className="guest-checkout-main">
          <section className="guest-checkout-card">
            <div className="guest-checkout-card-heading"><div><span className="guest-checkout-eyebrow">YOUR FLIGHT</span><h2>{route}</h2></div><span className="guest-checkout-pill">{tripDescription}</span></div>
            <div className="guest-checkout-airline"><AirlineIdentity codes={offer.airlineCodes} /><strong>{offer.cabin?.replace(/_/g, ' ').toLowerCase() ?? 'Cabin not specified'}{offer.fareBrand ? ` · ${offer.fareBrand}` : ''}</strong></div>
            {legsOf(offer).map((leg, index) => <div className="guest-checkout-leg" key={`${leg.segments[0]?.origin}-${index}`}>
              <span>{offer.multiCityLegs ? `Flight ${index + 1}` : index === 0 ? 'Depart' : 'Return'}</span>
              <div>{leg.segments.map((segment) => <div className="guest-checkout-segment" key={`${segment.marketingCarrier}-${segment.flightNumber}-${segment.departureAt}`}>
                <div><strong>{segment.origin}</strong><small>{dateTime(segment.departureAt)}</small></div><span aria-hidden="true">→</span><div><strong>{segment.destination}</strong><small>{dateTime(segment.arrivalAt)}</small></div>
                <small className="guest-checkout-flight-meta">{airlineName(segment.marketingCarrier) ?? segment.marketingCarrier} {segment.flightNumber}{segment.operatingCarrier && segment.operatingCarrier !== segment.marketingCarrier ? ` · operated by ${airlineName(segment.operatingCarrier) ?? segment.operatingCarrier}` : ''}</small>
              </div>)}</div>
            </div>)}
            <p className="guest-checkout-note">This is a shopping fare. Your seat and price are not reserved yet.</p>
          </section>

          <section className="guest-checkout-card guest-checkout-travelers">
            <div className="guest-checkout-card-heading"><div><span className="guest-checkout-eyebrow">TRAVELERS</span><h2>Who’s traveling?</h2></div><span className="guest-checkout-pill">{travelers} {travelers === 1 ? 'traveler' : 'travelers'}</span></div>
            <div className="guest-checkout-info"><strong>Names must match the travel ID used at check-in.</strong><span>Enter each passenger’s details exactly as shown on their ID.</span></div>
            {passengers.map((passenger, index) => <section className="guest-checkout-person" key={index} aria-label={`Passenger ${index + 1}`}>
              <div className="guest-checkout-person-heading"><div><strong>Passenger {index + 1}: {passenger.confirmed ? `${passenger.givenNames.trim()} ${passenger.surname.trim()}` : passenger.kind}</strong>{passenger.confirmed && <small>{passenger.kind} &nbsp;|&nbsp; {passenger.gender} &nbsp;|&nbsp; {passenger.nationality.trim()}</small>}</div><button type="button" className={passenger.confirmed ? 'guest-checkout-status done' : 'guest-checkout-status'} onClick={() => passenger.confirmed && editPassenger(index, { confirmed: false })}>{passenger.confirmed ? '✓ Completed · Edit' : 'Not completed'}</button></div>
              {passenger.confirmed && <p className="guest-checkout-note">{passenger.idNumber ? `${documentTypes.find(type=>type.value===passenger.idType)?.label??'Travel document'} ending ${passenger.idNumber.slice(-4)} · Expires ${passenger.idExpiryDate} · ` : ''}{passenger.saveForFuture ? 'Traveler saved to my account' : 'For this booking only'}</p>}
              {!passenger.confirmed && <form onSubmit={(event) => confirmPassenger(event, index)}>
                {savedPeople.length>0&&<details className="guest-checkout-saved-picker">
                  <summary><span><small>Saved travelers</small><strong>{savedPeople.find(person=>person.id===savedSelections[index]) ? [savedPeople.find(person=>person.id===savedSelections[index])?.legalFirstName,savedPeople.find(person=>person.id===savedSelections[index])?.legalMiddleName,savedPeople.find(person=>person.id===savedSelections[index])?.legalLastName].filter(Boolean).join(' ') : 'Choose a saved traveler'}</strong></span><span className="guest-checkout-saved-count">{savedPeople.length} saved</span></summary>
                  <div className="guest-checkout-saved-list">{savedPeople.map((person,personIndex)=>{
                    const fullName=[person.legalFirstName,person.legalMiddleName,person.legalLastName].filter(Boolean).join(' ');
                    const sameNameCount=savedPeople.filter(candidate=>[candidate.legalFirstName,candidate.legalMiddleName,candidate.legalLastName].filter(Boolean).join(' ').toLocaleLowerCase()===fullName.toLocaleLowerCase()).length;
                    const duplicateNumber=sameNameCount>1?savedPeople.slice(0,personIndex+1).filter(candidate=>[candidate.legalFirstName,candidate.legalMiddleName,candidate.legalLastName].filter(Boolean).join(' ').toLocaleLowerCase()===fullName.toLocaleLowerCase()).length:null;
                    const subtitle=[person.relationshipType.toLocaleLowerCase().replace(/^./,letter=>letter.toLocaleUpperCase()),person.dateOfBirth?`Born ${person.dateOfBirth}`:null,person.nationalityCountryCode].filter(Boolean).join(' · ');
                    return <article className="guest-checkout-saved-row" key={person.id}>
                      <button type="button" className="guest-checkout-saved-use" onClick={event=>{void selectSavedPassenger(index,person.id);const details=event.currentTarget.closest('details');if(details)details.open=false;}}>
                        <span className="guest-checkout-saved-avatar" aria-hidden="true">{person.legalFirstName.charAt(0)}{person.legalLastName.charAt(0)}</span>
                        <span className="guest-checkout-saved-copy"><strong>{fullName}{duplicateNumber?` · Profile ${duplicateNumber}`:''}</strong><small>{subtitle}</small></span>
                        <span className="guest-checkout-saved-action">Use</span>
                      </button>
                      <button type="button" className="guest-checkout-saved-remove" aria-label={`Remove ${fullName} from saved travelers`} disabled={archivingPerson===person.id} onClick={()=>void archiveSavedPassenger(person)}>{archivingPerson===person.id?'Removing…':'Remove'}</button>
                    </article>;
                  })}</div>
                </details>}
                <div className="guest-checkout-fields two"><label>First / given names <span>*</span><input required autoComplete="given-name" value={passenger.givenNames} onChange={(event) => editPassenger(index, { givenNames: event.target.value })} /></label><label>Last name (surname) <span>*</span><input required autoComplete="family-name" value={passenger.surname} onChange={(event) => editPassenger(index, { surname: event.target.value })} /></label></div>
                <div className="guest-checkout-fields three"><label>Gender on ID <span>*</span><BoundedSelect required ariaLabel={`Passenger ${index+1} gender`} value={passenger.gender} placeholder="Select gender" options={[{value:'FEMALE',label:'Female'},{value:'MALE',label:'Male'},{value:'X',label:'Other'}]} onChange={gender=>editPassenger(index,{gender})}/></label><label>Date of birth <span>*</span><input required type="date" max={new Date().toISOString().slice(0, 10)} value={passenger.birthDate} onChange={(event) => editPassenger(index, { birthDate: event.target.value })} /></label><label>Nationality (country/region) <span>*</span><BoundedSelect required searchable searchPlaceholder="Search countries" ariaLabel={`Passenger ${index+1} nationality`} value={passenger.nationality} placeholder="Select nationality" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={nationality=>editPassenger(index,{nationality})}/></label></div>
                <div className="guest-checkout-passport"><h3>Travel document details</h3><div className="guest-checkout-fields three"><label>Document type<BoundedSelect ariaLabel={`Passenger ${index+1} document type`} value={passenger.idType} placeholder="Select document type" options={documentTypes} onChange={idType=>editPassenger(index,{idType:idType as FlightIdentityDocumentType,idNumber:'',idExpiryDate:'',issuingCountryCode:''})}/></label><label>Document number<input autoComplete="off" maxLength={30} pattern="[A-Z0-9]{3,30}" value={passenger.idNumber} onChange={event=>editPassenger(index,{idNumber:event.target.value.toUpperCase().replace(/\s/g,'')})}/></label><label>Expiry date<input type="date" autoComplete="off" min={lastTravelDate} value={passenger.idExpiryDate} onChange={event=>editPassenger(index,{idExpiryDate:event.target.value})}/></label><label>Issuing country<BoundedSelect searchable searchPlaceholder="Search countries" ariaLabel={`Passenger ${index+1} document issuing country`} value={passenger.issuingCountryCode} placeholder="Select issuing country" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={issuingCountryCode=>editPassenger(index,{issuingCountryCode})}/></label></div></div>
                <label className="guest-checkout-save-choice"><input type="checkbox" checked={passenger.saveForFuture} onChange={event=>editPassenger(index,{saveForFuture:event.target.checked})}/><span>Save this traveler to my account for future bookings.</span></label>
                <button className="guest-checkout-confirm" type="submit">Confirm passenger</button>
              </form>}
            </section>)}
          </section>

          <section className="guest-checkout-card guest-checkout-contact"><div className="guest-checkout-card-heading"><div><span className="guest-checkout-eyebrow">BOOKING CONTACT</span><h2>Contact details</h2></div></div><p className="guest-checkout-note">We use these details for booking updates. Each traveler’s save option controls whether their details are available for future bookings.</p>
            <div className="guest-checkout-fields three"><label>Contact name <span>*</span><input required autoComplete="name" value={contact.name} onChange={(event) => updateContact({ name: event.target.value })} /></label><label>Email <span>*</span><input required type="email" autoComplete="email" value={contact.email} onChange={(event) => updateContact({ email: event.target.value })} /></label><label>Mobile phone <span>*</span><div className="guest-checkout-phone"><BoundedSelect ariaLabel="Country calling code" value={contact.dialCode} placeholder="+60" options={['+60','+65','+880','+1','+44'].map(code=>({value:code,label:code}))} onChange={dialCode=>updateContact({dialCode})}/><input required aria-label="Mobile phone number" type="tel" autoComplete="tel-national" value={contact.phone} onChange={(event) => updateContact({ phone: event.target.value })} /></div></label></div>
          </section>

          <section className="guest-checkout-card guest-checkout-baggage">
            <div className="guest-checkout-card-heading"><div><span className="guest-checkout-eyebrow">FARE INFORMATION</span><h2>Baggage allowance</h2></div></div>
            <FlightBaggageDetails offer={offer} />
            {offer.baggageCharge && <p className="guest-checkout-note">Sabre returned an additional baggage charge: {money(offer.baggageCharge.amount, offer.baggageCharge.currency)}{offer.baggageCharge.description ? ` · ${offer.baggageCharge.description}` : ''}. Purchase isn’t available here.</p>}
          </section>

          <section className="guest-checkout-card">
            <div className="guest-checkout-card-heading"><div><span className="guest-checkout-eyebrow">AIRLINE SERVICES</span><h2>Meals, baggage & assistance</h2></div></div>
            <FlightServiceDetails offer={pricedOffer} knownOnly />
            <p className="guest-checkout-note">Choose optional requests for each traveller. Flyseri will review them; airline confirmation and any additional charges apply. These requests do not change your fare or included baggage allowance.</p>
            {passengers.map((person, index) => <FlightServiceRequestFields key={index} value={servicePreferences[index]!}
              label={`Traveller ${index + 1}${person.givenNames.trim() ? ` · ${person.givenNames.trim()} ${person.surname.trim()}` : ''}`}
              onChange={update => { if (sending.current) return; markDetailsChanged(); setServicePreferences(current => current.map((value, position) => position === index ? { ...value, ...update } : value)); }}
              disabled={submitting || !!submittedAttemptId} />)}
            <FlightAirlineServices searchId={latestSelection?.searchId ?? checkout.searchId} offerId={latestSelection?.offer.offerId ?? offer.offerId}
              passengers={passengers.map(person => ({ givenName: person.givenNames.trim(), surname: person.surname.trim() }))}
              selectedExtras={selectedExtras} disabled={submitting || !!submittedAttemptId} onSelectedExtrasChange={extras => { if (sending.current) return; submissionKey.current = randomUUID(); setSelectedExtras(extras); }}
              requireNames={!!offer.ndcContext} ready={!offer.ndcContext || passengers.every(person => person.confirmed)} />
          </section>

          <section className="guest-checkout-finish" aria-label="Checkout total">
            <p className="guest-checkout-acknowledgment">The fare shown is a shopping price and may change when checked again. A reservation is created only after Sabre confirms a PNR; ticket issuance is a separate step.</p>
            <div className="guest-checkout-finish-card">
              <div className="guest-checkout-finish-total"><strong>{selectedExtras.length?'Estimated total with extras':'Total'}</strong><strong>{selectedExtras.length?(ancillaryTotal?money(String(ancillaryTotal.amount),ancillaryTotal.currency):'Awaiting prices'):money(pricedOffer.totalAmount,pricedOffer.currency)}</strong></div>
              {priceChanged && <p className="guest-checkout-next-notice">Fare updated from {money(offer.totalAmount,offer.currency)} to {money(pricedOffer.totalAmount,pricedOffer.currency)}. Review the total before continuing.</p>}
              <button className="guest-checkout-next" type="button" onClick={() => void handleNext()} disabled={submitting || checkingFare || !!submittedAttemptId}>{submitting ? 'Preparing checkout…' : checkingFare ? 'Checking fare…' : !session ? 'Sign in to continue' : priceChanged ? 'Accept updated fare & continue' : 'Continue'}</button>
              {fareCheckError && <p className="guest-checkout-next-notice" role="status">{fareCheckError}</p>}
              {checkoutNotice && <p className="guest-checkout-next-notice" role="status">{checkoutNotice}</p>}
            </div>
            <div className="guest-checkout-assurance" aria-label="Checkout information"><span>✓ Guest details</span><span>✓ Fare breakdown</span><span>✓ No payment taken yet</span></div>
          </section>
        </section>

        <FlightPriceDetails offer={pricedOffer} search={searchRequest} requests={servicePreferences} selectedExtras={selectedExtras} onEstimatedTripTotal={reportAncillaryTotal} />
      </div>
      <div className="checkout-mobile-bar" aria-label="Continue checkout">
        <button type="button" className="checkout-mobile-total" aria-haspopup="dialog" aria-expanded={mobilePriceDetailsOpen} aria-label={`Price details. ${selectedExtras.length?'Estimated total with extras':'Total'} ${selectedExtras.length?(ancillaryTotal?money(String(ancillaryTotal.amount),ancillaryTotal.currency):'awaiting prices'):money(pricedOffer.totalAmount,pricedOffer.currency)}`} onClick={() => setMobilePriceDetailsOpen(true)}>
          <small>{selectedExtras.length?'Estimated total with extras':`Total · ${travelers} ${travelers === 1 ? 'traveler' : 'travelers'}`}</small>
          <strong>{selectedExtras.length?(ancillaryTotal?money(String(ancillaryTotal.amount),ancillaryTotal.currency):'Awaiting prices'):money(pricedOffer.totalAmount,pricedOffer.currency)}</strong>
          <span>Price details <i aria-hidden="true" /></span>
        </button>
        <button type="button" className="btn-primary" disabled={submitting || checkingFare || !!submittedAttemptId} onClick={() => void handleNext()}>{submitting ? 'Preparing…' : checkingFare ? 'Checking fare…' : !session ? 'Sign in to continue' : priceChanged ? 'Accept & continue' : 'Continue'}</button>
      </div>
      {mobilePriceDetailsOpen && <div className="checkout-mobile-price-layer">
        <button type="button" className="checkout-mobile-price-scrim" aria-label="Close price details" onClick={() => setMobilePriceDetailsOpen(false)} />
        <section className="checkout-mobile-price-sheet" role="dialog" aria-modal="true" aria-label="Price details">
          <FlightPriceDetails offer={pricedOffer} search={searchRequest} requests={servicePreferences} selectedExtras={selectedExtras} onClose={() => setMobilePriceDetailsOpen(false)} onEstimatedTripTotal={reportAncillaryTotal} />
        </section>
      </div>}
    </main>
  </div>;
}
