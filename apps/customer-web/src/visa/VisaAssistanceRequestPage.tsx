import { Translated } from '../travel/language';
import { VisaJourneyProgress } from './VisaJourneyProgress';
import { SavedVisaJourneyProgress } from './SavedVisaJourneyProgress';
import { cloneElement, createContext, useContext, useEffect, useId, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import type { TravellerProfile, VisaAssistanceAddress, VisaAssistanceApplicantInput, VisaAssistanceRequestDetail } from '@flyseri/types';
import { useAuth } from '../auth/AuthProvider';
import { ApiClientError } from '../lib/api/client';
import { tripService } from '../services/tripService';
import { travellerService } from '../services/travellerService';
import { visaService } from '../services/visaService';
import { countries, countryName } from '../trip/tripPresentation';
import './visa-application.css';

interface VisaAssistanceDraft {
  tripId: string;
  destinationCountryCode: string;
  expectedTravelDate: string;
  purpose: string;
  travellerIds: string[];
  newApplicantCount?: number;
}

const storageKey = 'flyseri.visa-assistance-draft';
const today = () => new Date().toISOString().slice(0, 10);
const emptyAddress = (): VisaAssistanceAddress => ({ addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', countryCode: '' });

function fromTraveller(person: TravellerProfile): VisaAssistanceApplicantInput {
  return { travellerId: person.id, firstName: person.legalFirstName, middleName: person.legalMiddleName ?? '',
    lastName: person.legalLastName, dateOfBirth: person.dateOfBirth ?? '', gender: person.gender ?? 'UNDISCLOSED',
    nationalityCountryCode: person.nationalityCountryCode ?? '', birthCity: '', birthCountryCode: '',
    documentType: 'PASSPORT', documentNumber: '', documentIssuingCountryCode: '', documentIssuedOn: '', documentExpiresOn: '',
    currentAddress: emptyAddress(), permanentAddress: emptyAddress(), occupation: '', employerOrSchool: '', notes: '' };
}

type FieldControl = { required?: boolean; id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };
const FieldErrors = createContext<Record<string, string>>({});
export function AssistanceField({ label, optional, className = '', children }: { label: string; optional?: boolean; className?: string; children: ReactElement<FieldControl> }) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const message = useContext(FieldErrors)[id];
  return <div className={'visa-assistance-field ' + className}>
    <label htmlFor={id}>{label}{children.props.required && <span className="visa-required" aria-hidden="true"> *</span>}{optional && <span className="visa-field-optional"> (optional)</span>}</label>
    {cloneElement(children, { id, 'aria-invalid': Boolean(message), 'aria-describedby': message ? id + '-error' : undefined })}
    {message && <span className="visa-field-error" id={id + '-error'}>{message}</span>}
  </div>;
}
export function validateAssistanceForm(form: HTMLElement): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const control of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))) {
    if (control.disabled || !control.id || control.type === 'hidden') continue;
    if (control.required && control.type !== 'checkbox' && !control.value.trim()) errors[control.id] = 'Please complete this field.';
    else if (!control.validity.valid) errors[control.id] = control.type === 'checkbox' ? 'Please confirm before continuing.' : control.validity.typeMismatch ? 'Enter a valid email address.' : control.validity.rangeUnderflow || control.validity.rangeOverflow ? 'Choose a date within the allowed range.' : 'Please check this field.';
  }
  return errors;
}

function CountrySelect({ value, onChange, label }: { value: string; onChange: (code: string) => void; label: string }) {
  return <AssistanceField label={label}><select required value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Choose a country</option>
    {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
  </select></AssistanceField>;
}

function AddressFields({ title, address, onChange }: { title: string; address: VisaAssistanceAddress;
  onChange: (field: keyof VisaAssistanceAddress, value: string) => void }) {
  return <div className="visa-assistance-address"><h4>{title}</h4><div className="visa-assistance-fields">
    <AssistanceField label="Address line 1" className="visa-assistance-wide"><input required maxLength={160} value={address.addressLine1} onChange={(event) => onChange('addressLine1', event.target.value)} autoComplete="off" /></AssistanceField>
    <AssistanceField label="Address line 2" optional className="visa-assistance-wide"><input maxLength={160} value={address.addressLine2 ?? ''} onChange={(event) => onChange('addressLine2', event.target.value)} autoComplete="off" /></AssistanceField>
    <AssistanceField label="City / town"><input required maxLength={100} value={address.city} onChange={(event) => onChange('city', event.target.value)} autoComplete="off" /></AssistanceField>
    <AssistanceField label="State / province" optional><input maxLength={100} value={address.region ?? ''} onChange={(event) => onChange('region', event.target.value)} autoComplete="off" /></AssistanceField>
    <AssistanceField label="Postal code" optional><input maxLength={24} value={address.postalCode ?? ''} onChange={(event) => onChange('postalCode', event.target.value)} autoComplete="off" /></AssistanceField>
    <CountrySelect label="Country of residence" value={address.countryCode} onChange={(value) => onChange('countryCode', value)} />
  </div></div>;
}

function ApplicantForm({ index, person, samePermanentAddress, onChange, onAddressChange, onSameAddressChange, travelDate }: {
  index: number; person: VisaAssistanceApplicantInput; samePermanentAddress: boolean; travelDate: string;
  onChange: (patch: Partial<VisaAssistanceApplicantInput>) => void;
  onAddressChange: (field: 'currentAddress' | 'permanentAddress', key: keyof VisaAssistanceAddress, value: string) => void;
  onSameAddressChange: (same: boolean) => void;
}) {
  return <article className="visa-assistance-person">
    <div className="visa-assistance-person-heading"><span className="visa-start-number">{String(index + 1).padStart(2, '0')}</span><div><p className="account-eyebrow">APPLICANT {index + 1}</p><h3>{person.firstName || 'Applicant'} {person.lastName}</h3></div></div>
    <div className="visa-assistance-subsection"><h4>Personal details</h4><div className="visa-assistance-fields visa-assistance-personal-grid">
      <AssistanceField label="First / given name"><input required maxLength={100} value={person.firstName} onChange={(event) => onChange({ firstName: event.target.value })} autoComplete="off" /></AssistanceField>
      <AssistanceField label="Middle name" optional><input maxLength={100} value={person.middleName ?? ''} onChange={(event) => onChange({ middleName: event.target.value })} autoComplete="off" /></AssistanceField>
      <AssistanceField label="Last / family name"><input required maxLength={100} value={person.lastName} onChange={(event) => onChange({ lastName: event.target.value })} autoComplete="off" /></AssistanceField>
      <AssistanceField label="Date of birth"><input required type="date" max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} value={person.dateOfBirth} onChange={(event) => onChange({ dateOfBirth: event.target.value })} /></AssistanceField>
      <AssistanceField label="Gender as shown on document"><select required value={person.gender} onChange={(event) => onChange({ gender: event.target.value as VisaAssistanceApplicantInput['gender'] })}>
        <option value="UNDISCLOSED">Not specified / ask Flyseri</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="X">X</option>
      </select></AssistanceField>
      <CountrySelect label="Nationality / citizenship" value={person.nationalityCountryCode} onChange={(value) => onChange({ nationalityCountryCode: value })} />
      <AssistanceField label="City of birth" optional><input maxLength={100} value={person.birthCity ?? ''} onChange={(event) => onChange({ birthCity: event.target.value })} /></AssistanceField>
      <CountrySelect label="Country of birth" value={person.birthCountryCode} onChange={(value) => onChange({ birthCountryCode: value })} />
    </div></div>
    <div className="visa-assistance-subsection"><h4>Passport or travel document</h4><div className="visa-assistance-fields">
      <AssistanceField label="Document type"><select required value={person.documentType} onChange={(event) => onChange({ documentType: event.target.value as VisaAssistanceApplicantInput['documentType'] })}>
        <option value="PASSPORT">Passport</option><option value="TRAVEL_DOCUMENT">Other travel document</option><option value="NATIONAL_ID">National ID</option>
      </select></AssistanceField>
      <AssistanceField label="Document number"><input required maxLength={40} value={person.documentNumber} onChange={(event) => onChange({ documentNumber: event.target.value })} autoComplete="off" /></AssistanceField>
      <CountrySelect label="Issuing country" value={person.documentIssuingCountryCode} onChange={(value) => onChange({ documentIssuingCountryCode: value })} />
      <AssistanceField label="Issue date" optional><input type="date" max={today()} value={person.documentIssuedOn ?? ''} onChange={(event) => onChange({ documentIssuedOn: event.target.value })} /></AssistanceField>
      <AssistanceField label="Expiry date"><input required type="date" min={person.documentIssuedOn || undefined} value={person.documentExpiresOn} onChange={(event) => onChange({ documentExpiresOn: event.target.value })} /></AssistanceField>
    </div>{person.documentExpiresOn && person.documentExpiresOn < travelDate && <p className="visa-assistance-warning">This document expires before your planned travel. Flyseri will review whether you need a new document.</p>}</div>
    <div className="visa-assistance-subsection"><AddressFields title="Current address" address={person.currentAddress} onChange={(field, value) => onAddressChange('currentAddress', field, value)} />
      <label className="visa-assistance-same-address"><input type="checkbox" checked={samePermanentAddress} onChange={(event) => onSameAddressChange(event.target.checked)} /> My permanent address is the same as my current address</label>
      {!samePermanentAddress && <AddressFields title="Permanent address" address={person.permanentAddress} onChange={(field, value) => onAddressChange('permanentAddress', field, value)} />}
    </div>
    <div className="visa-assistance-subsection"><h4>Additional background <span>(optional)</span></h4><div className="visa-assistance-fields">
      <AssistanceField label="Occupation or role" optional><input maxLength={120} value={person.occupation ?? ''} onChange={(event) => onChange({ occupation: event.target.value })} /></AssistanceField>
      <AssistanceField label="Employer or school" optional><input maxLength={160} value={person.employerOrSchool ?? ''} onChange={(event) => onChange({ employerOrSchool: event.target.value })} /></AssistanceField>
      <AssistanceField label="Previous visa refusal" optional className="visa-assistance-wide"><select value={person.previousVisaRefusal ?? ''} onChange={(event) => onChange({ previousVisaRefusal: event.target.value as VisaAssistanceApplicantInput['previousVisaRefusal'] })}>
        <option value="">Choose if you wish to share</option><option value="NO">No</option><option value="YES">Yes</option><option value="PREFER_TO_DISCUSS">Prefer to discuss with Flyseri</option>
      </select></AssistanceField>
      <AssistanceField label="Notes for this applicant" optional className="visa-assistance-wide"><textarea rows={3} maxLength={1000} value={person.notes ?? ''} onChange={(event) => onChange({ notes: event.target.value })} placeholder="Name differences, document renewal, previous travel or other useful context" /></AssistanceField>
    </div></div>
  </article>;
}
function readDraft(value: unknown): VisaAssistanceDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<VisaAssistanceDraft>;
  if (typeof draft.tripId !== 'string' || !/^[A-Z]{2}$/.test(draft.destinationCountryCode ?? '') ||
      typeof draft.expectedTravelDate !== 'string' || typeof draft.purpose !== 'string' ||
      !Array.isArray(draft.travellerIds) || !draft.travellerIds.every((id) => typeof id === 'string')) return null;
  const count = draft.newApplicantCount ?? (draft.travellerIds.length ? 0 : 1);
  if (!Number.isInteger(count) || count < 0 || count + draft.travellerIds.length < 1 || count + draft.travellerIds.length > 30) return null;
  return { ...draft, newApplicantCount: count } as VisaAssistanceDraft;
}

export function VisaAssistanceRequestPage({ savedRequest, onSaved }: { savedRequest?: VisaAssistanceRequestDetail; onSaved?: (request: VisaAssistanceRequestDetail) => void } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const navigationDraft = readDraft((location.state as { visaAssistanceDraft?: unknown } | null)?.visaAssistanceDraft);
  const [draft] = useState<VisaAssistanceDraft | null>(() => {
    if (savedRequest) return { tripId: savedRequest.tripId, destinationCountryCode: savedRequest.destinationCountryCode, expectedTravelDate: savedRequest.expectedTravelDate, purpose: savedRequest.purpose, travellerIds: savedRequest.applicants.map(person => person.travellerId), newApplicantCount: 0 };
    if (navigationDraft) return navigationDraft;
    try { return readDraft(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')); } catch { return null; }
  });
  const [applicantIds, setApplicantIds] = useState<string[]>(() => draft ? [...draft.travellerIds, ...Array.from({length:draft.newApplicantCount || 0}, () => 'new:' + crypto.randomUUID())] : []);
  const [applicantDetails, setApplicantDetails] = useState<Record<string, VisaAssistanceApplicantInput>>(() => Object.fromEntries(savedRequest ? savedRequest.applicants.map(person => [person.travellerId, person.details ?? fromTraveller({id:person.travellerId,legalFirstName:'',legalLastName:''} as TravellerProfile)]) : applicantIds.filter(id => id.startsWith('new:')).map(id => [id, fromTraveller({id,legalFirstName:'',legalLastName:''} as TravellerProfile)])));
  const savedNewApplicants = useRef<Record<string, {id:string;linked:boolean}>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const [focusApplicant, setFocusApplicant] = useState('');
  const [savedApplicantIds, setSavedApplicantIds] = useState<string[]>(() => savedRequest?.applicants.filter(person => person.details).map(person => person.travellerId) ?? []);
  const [applicantAttempts, setApplicantAttempts] = useState<string[]>([]);
  const addApplicantRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [sameAddress, setSameAddress] = useState<Record<string, boolean>>({});
  const [applicantLoading, setApplicantLoading] = useState(!savedRequest);
  const [applicantError, setApplicantError] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState(savedRequest?.expectedReturnDate ?? '');
  const [accommodationOrHost, setAccommodationOrHost] = useState(savedRequest?.accommodationOrHost ?? '');
  const [contactName, setContactName] = useState(savedRequest?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(savedRequest?.contactEmail ?? session?.user.email ?? '');
  const [contactPhone, setContactPhone] = useState(savedRequest?.contactPhone ?? '');
  const [customerMessage, setCustomerMessage] = useState(savedRequest?.customerMessage ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formChanged, setFormChanged] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (navigationDraft && !savedRequest) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(navigationDraft)); } catch { /* navigation state still holds the draft */ }
    }
  }, [navigationDraft]);
  useEffect(() => {
    if (!draft || savedRequest) return;
    let active = true;
    setApplicantLoading(true); setApplicantError('');
    void Promise.all([tripService.detail(draft.tripId), draft.travellerIds.length ? travellerService.list() : Promise.resolve([])]).then(([trip, profiles]) => {
      if (!active) return;
      const onTrip = new Set(trip.travellers.map(({ id }) => id));
      const selected = draft.travellerIds.map((id) => profiles.find((person) => person.id === id && onTrip.has(id)));
      if (selected.some((person) => !person)) throw new Error('A selected applicant is no longer on this journey. Return to visa planning and select them again.');
      setApplicantDetails((previous) => ({ ...previous, ...Object.fromEntries(selected.map((person) => [person!.id, previous[person!.id] ?? fromTraveller(person!)])) }));
    }).catch((cause) => { if (active) setApplicantError(cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : "We couldn't load the applicants."); })
      .finally(() => { if (active) setApplicantLoading(false); });
    return () => { active = false; };
  }, [draft, savedRequest]);
  useEffect(() => {
    const metadataName = session?.user.user_metadata?.full_name;
    if (!contactName && typeof metadataName === 'string') setContactName(metadataName);
    if (!contactEmail && session?.user.email) setContactEmail(session.user.email);
  }, [session, contactName, contactEmail]);

  useEffect(() => {
    if (!focusApplicant) return;
    const applicant = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-applicant-id]') || []).find(item => item.dataset.applicantId === focusApplicant);
    const field = applicant?.querySelector<HTMLInputElement>('input');
    if (field) { applicant?.scrollIntoView?.({behavior:'smooth',block:'start'}); field.focus({preventScroll:true}); setFocusApplicant(''); }
  }, [applicantIds, focusApplicant, savedApplicantIds]);
  function applicantSection(id: string) {
    return Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-applicant-id]') || []).find(item => item.dataset.applicantId === id);
  }
  function setSectionErrors(section: HTMLElement, invalid: Record<string, string>) {
    const ids = new Set(Array.from(section.querySelectorAll('input, select, textarea')).map(control => control.id));
    setFieldErrors(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.has(id))), ...invalid }));
  }
  function saveApplicant(id: string, addNext = false) {
    if (busy || applicantLoading || applicantError || savedApplicantIds.includes(id)) return;
    const section = applicantSection(id);
    if (!section || !applicantDetails[id]) return;
    const invalid = validateAssistanceForm(section);
    setSectionErrors(section, invalid);
    if (Object.keys(invalid).length) {
      setApplicantAttempts(previous => previous.includes(id) ? previous : [...previous, id]);
      setError('Please complete the highlighted applicant fields before saving.');
      const first = Array.from(section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')).find(control => invalid[control.id]);
      requestAnimationFrame(() => { first?.scrollIntoView?.({behavior:'smooth',block:'center'}); first?.focus({preventScroll:true}); });
      return;
    }
    setSavedApplicantIds(previous => [...previous, id]);
    setApplicantAttempts(previous => previous.filter(value => value !== id));
    setError('');
    if (addNext && applicantIds.length < 30) addApplicant();
    else {
      const next = applicantIds.find(value => value !== id && !savedApplicantIds.includes(value));
      if (next) setFocusApplicant(next);
      else requestAnimationFrame(() => { addApplicantRef.current?.focus(); });
    }
  }
  function editApplicant(id: string) {
    if (busy) return;
    setFormChanged(true);
    setSavedApplicantIds(previous => previous.filter(value => value !== id));
    setFocusApplicant(id);
  }
  function addApplicant() {
    if (applicantIds.length >= 30 || busy) return;
    setFormChanged(true);
    const id = 'new:' + crypto.randomUUID();
    setApplicantDetails(previous => ({...previous,[id]:fromTraveller({id,legalFirstName:'',legalLastName:''} as TravellerProfile)}));
    setApplicantIds(previous => [...previous,id]);
    setFocusApplicant(id);
  }
  function removeApplicant(id: string) {
    if (applicantIds.length <= 1 || busy) return;
    if (savedRequest?.documents.some(document => document.travellerId === id)) { setError('Remove this applicant’s attachments in the documents step before removing the applicant.'); return; }
    setFormChanged(true);
    setApplicantIds(previous => previous.filter(value => value !== id));
    setSavedApplicantIds(previous => previous.filter(value => value !== id));
    setApplicantAttempts(previous => previous.filter(value => value !== id));
    setFieldErrors({}); setAttempted(false);
  }
  function updateApplicant(id: string, patch: Partial<VisaAssistanceApplicantInput>) {
    setApplicantDetails((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  }
  function updateAddress(id: string, field: 'currentAddress' | 'permanentAddress', key: keyof VisaAssistanceAddress, value: string) {
    setApplicantDetails((previous) => ({ ...previous, [id]: { ...previous[id], [field]: { ...previous[id][field], [key]: value } } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || submitting.current || busy || applicantLoading || applicantError) return;
    const form = event.currentTarget;
    const invalid = validateAssistanceForm(form);
    setAttempted(true); setFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      setError('Please complete the highlighted fields before continuing.');
      const first = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')).find(control => invalid[control.id]);
      requestAnimationFrame(() => { first?.scrollIntoView({ behavior: 'smooth', block: 'center' }); first?.focus({ preventScroll: true }); });
      return;
    }
    const applicants = applicantIds.map((id) => applicantDetails[id]).filter((person): person is VisaAssistanceApplicantInput => Boolean(person));
    if (applicants.length !== applicantIds.length) { setError('Reload the applicants before sending this request.'); return; }
    if (expectedReturnDate && expectedReturnDate < draft.expectedTravelDate) { setError('Your expected return date must be after departure.'); return; }
    for (const person of applicants) {
      if (person.dateOfBirth >= today()) { setError(`Check ${person.firstName}'s date of birth.`); return; }
      if (person.documentIssuedOn && person.documentIssuedOn > person.documentExpiresOn) { setError(`Check ${person.firstName}'s document dates.`); return; }
    }
    submitting.current = true; setBusy(true); setError('');
    try {
      const persistedApplicants: VisaAssistanceApplicantInput[] = [];
      for (const person of applicants) {
        let travellerId = person.travellerId;
        if (travellerId.startsWith('new:')) {
          let saved = savedNewApplicants.current[travellerId];
          if (!saved) {
            const profile = await travellerService.create({legalFirstName:person.firstName,legalMiddleName:person.middleName || undefined,legalLastName:person.lastName,dateOfBirth:person.dateOfBirth,gender:person.gender,nationalityCountryCode:person.nationalityCountryCode,relationshipType:'OTHER'});
            saved = {id:profile.id,linked:false}; savedNewApplicants.current[travellerId] = saved;
          }
          if (!saved.linked) { await tripService.addTraveller(draft.tripId,saved.id); saved.linked = true; }
          travellerId = saved.id;
        }
        persistedApplicants.push({...person,travellerId,permanentAddress:sameAddress[person.travellerId] ? {...person.currentAddress} : person.permanentAddress});
      }
      const { travellerIds: _travellerIds, newApplicantCount: _newApplicantCount, ...selection } = draft;
      const input = { ...selection,
        applicants: persistedApplicants.map((person) => ({ ...person, documentIssuedOn: person.documentIssuedOn || undefined,
          previousVisaRefusal: person.previousVisaRefusal || undefined,
          permanentAddress: person.permanentAddress })),
        expectedReturnDate: expectedReturnDate || undefined, accommodationOrHost, contactName, contactEmail, contactPhone, customerMessage };
      let request: { id: string };
      if (savedRequest) {
        const saved = await visaService.assistanceSaveForm(savedRequest.id, input);
        onSaved?.(saved);
        request = saved;
      } else request = await visaService.createAssistanceRequest(input);
      navigate('/app/visa/assistance/' + request.id + '/documents');
      try { sessionStorage.removeItem(storageKey); } catch { /* the saved server request remains authoritative */ }
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "We couldn't send your request. Your details are still here; please try again.");
    } finally { submitting.current = false; setBusy(false); }
  }

  if (!draft) return <main className="account-page visa-page visa-assistance-page"><div className="account-panel visa-assistance-empty"><h1>Start with your visa search</h1><p>Your destination and applicant selection are missing. Return to visa planning and continue from the search form.</p><Link className="btn-primary" to="/app/visa">Back to visa planning</Link></div></main>;

  return <main className="account-page visa-page visa-assistance-page">
    <Link className="trip-back" to="/app/visa">← Visa planning</Link>
    <header className="visa-assistance-intro"><p className="account-eyebrow">FLYSERI ASSISTED SERVICE · STEP 02</p><h1>{savedRequest ? 'Your saved applicant details' : 'Tell us about your visa request'}</h1>
      <p>Enter each applicant’s details as shown on their travel document. Flyseri will review them and confirm any destination specific questions or documents before proceeding.</p></header>
    {savedRequest ? <SavedVisaJourneyProgress requestId={savedRequest.id} current="form" disabled={busy || formChanged}/> : <VisaJourneyProgress current="form" onSelect={busy ? undefined : step => { if(step === "choose") navigate("/app/visa"); }} />}
    <p className="visa-required-note"><span className="visa-required" aria-hidden="true">*</span> Required fields · Optional fields are clearly marked.</p>
    {(error || applicantError) && <p role="alert" className="account-error">{error || applicantError}</p>}
    <FieldErrors.Provider value={fieldErrors}><div className="visa-assistance-layout">
      <form ref={formRef} noValidate onChange={event => {
        setFormChanged(true);
        if (attempted) { setFieldErrors(validateAssistanceForm(event.currentTarget)); setError(''); }
        else {
          const section = (event.target as HTMLElement).closest<HTMLElement>('[data-applicant-id]');
          if (section && applicantAttempts.includes(section.dataset.applicantId || '')) { setSectionErrors(section, validateAssistanceForm(section)); setError(''); }
        }
      }} className="account-panel visa-assistance-form" onSubmit={(event) => void submit(event)}><fieldset className="visa-intake-controls" disabled={busy}>
        <section className="visa-assistance-section"><div className="visa-start-heading"><span className="visa-start-number">01</span><div><p className="account-eyebrow">ONE FORM PER APPLICANT</p><h2>Applicant information</h2></div></div>
          <p className="visa-assistance-help">Use the name and document number exactly as printed on each travel document. Optional details help us review your request; extra questions vary by destination.</p>
          <p className="visa-assistance-help">Save each applicant to collapse their details into a summary bar. Applicants stay in this form until you save the complete request and continue to documents.</p>
          {applicantLoading && <p role="status" className="visa-assistance-help">Loading your saved travellers…</p>}
          {!applicantLoading && !applicantError && applicantIds.map((id, index) => {
            const person = applicantDetails[id];
            if (!person) return null;
            const name = [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ');
            return savedApplicantIds.includes(id) ? <article className="visa-saved-applicant-bar" aria-label={'Saved applicant ' + (index + 1)} key={id}>
              <span className="visa-start-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="visa-saved-applicant-copy"><h3>{name}</h3><p>{countryName(person.nationalityCountryCode)} · {person.documentType === 'PASSPORT' ? 'Passport' : person.documentType === 'NATIONAL_ID' ? 'National ID' : 'Travel document'} ending {person.documentNumber.slice(-4)}</p></div>
              <span className="visa-saved-applicant-status"><span aria-hidden="true">✓ </span>Saved</span>
              <div className="visa-saved-applicant-actions"><button type="button" className="account-outline-button" aria-label={'Edit applicant ' + (index + 1)} onClick={() => editApplicant(id)}>Edit</button>{applicantIds.length > 1 && <button type="button" className="visa-remove-applicant" aria-label={'Remove applicant ' + (index + 1)} onClick={() => removeApplicant(id)}><Translated text="Remove" /></button>}</div>
            </article> : <div className="visa-applicant-form-wrap" data-applicant-id={id} key={id}>{applicantIds.length > 1 && <button type="button" className="visa-remove-applicant" aria-label={'Remove applicant ' + (index + 1)} disabled={busy} onClick={() => removeApplicant(id)}>Remove applicant</button>}<ApplicantForm index={index} person={person} travelDate={draft.expectedTravelDate}
              samePermanentAddress={Boolean(sameAddress[id])} onChange={(patch) => updateApplicant(id, patch)}
              onAddressChange={(field, key, value) => updateAddress(id, field, key, value)}
              onSameAddressChange={(same) => setSameAddress((previous) => ({ ...previous, [id]: same }))} />
              <div className="visa-applicant-save-actions"><span>Complete the required fields, then save this applicant.</span><div><button type="button" className="account-outline-button" onClick={() => saveApplicant(id, true)} disabled={busy || applicantIds.length >= 30}>Save & add another</button><button type="button" className="btn-primary" aria-label={'Save applicant ' + (index + 1)} disabled={busy} onClick={() => saveApplicant(id)}>Save applicant <span aria-hidden="true">✓</span></button></div></div>
            </div>;
          })}
          {!applicantLoading && !applicantError && <div className="visa-applicant-add-bar"><span>{applicantIds.length} applicant{applicantIds.length === 1 ? '' : 's'} · {savedApplicantIds.length} saved · Up to 30 per application</span><button ref={addApplicantRef} type="button" className="account-outline-button" disabled={busy || applicantIds.length >= 30} onClick={addApplicant}>+ Add another applicant</button></div>}
        </section>
        <section className="visa-assistance-section"><div className="visa-start-heading"><span className="visa-start-number">02</span><div><p className="account-eyebrow">YOUR TRIP</p><h2>Travel details</h2></div></div>
          <div className="visa-assistance-summary">
            <span>Destination<strong>{countryName(draft.destinationCountryCode)}</strong></span>
            <span>Expected travel date<strong>{draft.expectedTravelDate}</strong></span>
            <span>Visa purpose<strong>{draft.purpose}</strong></span>
          </div>
          <div className="visa-assistance-fields visa-assistance-trip-extra">
            <AssistanceField label="Expected return date" optional><input type="date" min={draft.expectedTravelDate} value={expectedReturnDate} onChange={(event) => setExpectedReturnDate(event.target.value)} /></AssistanceField>
            <AssistanceField label="Hotel, host or planned stay" optional><input maxLength={240} value={accommodationOrHost} onChange={(event) => setAccommodationOrHost(event.target.value)} placeholder="If known" /></AssistanceField>
          </div>
        </section>
        <section className="visa-assistance-section"><div className="visa-start-heading"><span className="visa-start-number">03</span><div><p className="account-eyebrow">HOW TO REACH YOU</p><h2>Your contact details</h2></div></div>
          <div className="visa-assistance-fields">
            <AssistanceField label="Contact name"><input autoComplete="name" required maxLength={120} value={contactName} onChange={(event) => setContactName(event.target.value)} /></AssistanceField>
            <AssistanceField label="Email address"><input type="email" autoComplete="email" required maxLength={254} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></AssistanceField>
            <AssistanceField label="Phone number" optional><input type="tel" autoComplete="tel" maxLength={32} value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></AssistanceField>
          </div>
        </section>
        <section className="visa-assistance-section"><AssistanceField label="Anything else we should know?" optional className="visa-assistance-message"><textarea rows={4} maxLength={2000} value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} placeholder="Share any details that would help our visa team review your request." /></AssistanceField></section>
        <label className="visa-assistance-confirm"><input id="visa-assistance-declaration" aria-invalid={Boolean(fieldErrors['visa-assistance-declaration'])} aria-describedby={fieldErrors['visa-assistance-declaration'] ? 'visa-assistance-declaration-error' : undefined} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span><span className="visa-required" aria-hidden="true">* </span>I confirm the details are accurate to the best of my knowledge. I understand this is a request for Flyseri’s assisted visa service. Flyseri will confirm requirements and fees before any payment, and this does not submit an application to an embassy or government authority.</span></label>
        {fieldErrors['visa-assistance-declaration'] && <p className="visa-field-error" id="visa-assistance-declaration-error">Please confirm before continuing.</p>}
        <div className="visa-stage-actions"><span>No payment is due at this step.</span><button className="btn-primary visa-submit" type="submit" disabled={busy || applicantLoading || Boolean(applicantError)}>{busy ? 'Saving applicant details…' : 'Save & continue to documents →'}</button></div>
      </fieldset></form>
      <aside className="account-panel visa-assistance-aside"><div className="visa-intake-trip-card"><p className="account-eyebrow">YOUR VISA REQUEST</p><h2>{countryName(draft.destinationCountryCode)}</h2><p>{draft.purpose} · {draft.expectedTravelDate}</p><span>{applicantIds.length} applicant{applicantIds.length === 1 ? '' : 's'}</span></div><p className="account-eyebrow">WHAT HAPPENS NEXT</p><h2>We’ll review your details</h2><ol><li>Review applicant details and upload supporting documents.</li><li>Check the configured service fee and complete payment.</li><li>Submit your paid request to Flyseri for review.</li></ol><p>Visa requirements depend on nationality, destination and purpose. The destination authority makes the final decision.</p></aside>
    </div></FieldErrors.Provider>
  </main>;
}
