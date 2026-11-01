import { PageLoading } from '../components/PageLoading';
import { DateInput } from '../components/DateInput';
import { Translated } from '../travel/language';
import { VisaJourneyProgress } from './VisaJourneyProgress';
import { VisaFlowHeader, VisaFlowActions } from './VisaFlowLayout';
import { visaPurposeForService, visaPurposeMatches } from './visaPricing';
import { hasVisitedVisaRequirements, visaRequirementsUrl } from './VisaRequirementsGate';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { TripDetail, VisaApplicationSummary, VisaType } from '@flyseri/types';
import { isSupportedVisaDestination } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { tripService } from '../services/tripService';
import { visaService } from '../services/visaService';
import { travellerService } from '../services/travellerService';
import { countries, countryName } from '../trip/tripPresentation';
import { formatMoney, visaStatus } from '../account/presentation';
import './visa-application.css';
import './visa-discovery.css';

const today = () => new Date().toISOString().slice(0, 10);
const commonPurposes = ['Tourism', 'Business', 'Family visit', 'Study', 'Work', 'Transit', 'Medical', 'Other'];

export function TripVisaPage({ embedded = false, initialTripId, selectionChosen = false }: { embedded?: boolean; initialTripId?: string; selectionChosen?: boolean } = {}) {
  const { tripId: routeTripId } = useParams<{ tripId: string }>();
  const tripId = routeTripId || initialTripId;
  const [searchParams] = useSearchParams();
  const requestedCountry = searchParams.get('country')?.toUpperCase() || '';
  const initialCountry = isSupportedVisaDestination(requestedCountry) ? requestedCountry : '';
  const requestedPurpose = searchParams.get('purpose') || '';
  const initialPurpose = commonPurposes.includes(requestedPurpose) ? requestedPurpose : '';
  const requestedServiceId = searchParams.get('service') || '';
  const navigate = useNavigate();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [applications, setApplications] = useState<VisaApplicationSummary[]>([]);
  const [types, setTypes] = useState<VisaType[]>([]);
  const [country, setCountry] = useState(initialCountry);
  const [travelDate, setTravelDate] = useState('');
  const [typeId, setTypeId] = useState(initialPurpose ? 'request:' + initialPurpose : '');
  const [people, setPeople] = useState<string[]>([]);
  const [newCount, setNewCount] = useState<number | null>(null);
  const newApplicants = newCount ?? (people.length ? 0 : 1);
  const totalApplicants = people.length + newApplicants;
  const [loading, setLoading] = useState(true);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [catalogueError, setCatalogueError] = useState('');
  const [catalogueRevision, setCatalogueRevision] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const loadVersion = useRef(0);
  const preparing = useRef(false);
  const selectedType = types.find((type) => type.id === typeId);
  const validApplicantCount = Number.isInteger(newApplicants) && newApplicants >= 0 && totalApplicants >= 1 && totalApplicants <= 30;

  async function load(id: string) {
    const version = ++loadVersion.current;
    setLoading(true); setError(''); setNotFound(false);
    setTrip(null); setApplications([]); setPeople([]); setNewCount(null);
    try {
      const item = await tripService.detail(id);
      if (version !== loadVersion.current) return;
      setTrip(item);
      setCountry(isSupportedVisaDestination(item.primaryDestination?.countryCode) ? item.primaryDestination!.countryCode : '');
      setTravelDate(item.startDate ?? item.destinations[0]?.startDate ?? '');
      try { const saved = await visaService.list(id); if (version === loadVersion.current) setApplications(saved); }
      catch { if (version === loadVersion.current) { setApplications([]); setError('Your existing applications are temporarily unavailable. You can still explore visa services.'); } }
    } catch (cause) {
      if (version !== loadVersion.current) return;
      if (cause instanceof ApiClientError && cause.status === 404) setNotFound(true);
      else setError(cause instanceof ApiClientError ? cause.message : "We couldn't load this journey. Please try again.");
    } finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => { if (tripId) void load(tripId); return () => { loadVersion.current++; }; }, [tripId]);
  useEffect(() => {
    if (tripId) return;
    let active = true;
    setLoading(true);
    setError(''); setNotFound(false); setPeople([]); setNewCount(null); setApplications([]);
    setCountry(initialCountry); setTravelDate('');
    void travellerService.list().then((travellers) => {
      if (!active) return;
      setTrip({ id: '', title: 'New visa journey', status: 'PLANNING', startDate: null, endDate: null,
        primaryDestination: null, travellerCount: travellers.length, createdAt: '', updatedAt: '', destinations: [],
        travellers: travellers.map((person) => ({ id: person.id, legalFirstName: person.legalFirstName,
          legalLastName: person.legalLastName, relationshipType: person.relationshipType })) });
    }, () => {if (!active) return; setTrip({id:'',title:'New visa journey',status:'PLANNING',startDate:null,endDate:null,primaryDestination:null,travellerCount:0,createdAt:'',updatedAt:'',destinations:[],travellers:[]});setError('Saved profiles are temporarily unavailable. You can still continue with new applicants.');}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tripId]);
  useEffect(() => {
    setTypes([]); setCatalogueError('');
    setTypeId(current => current.startsWith('request:') ? current : '');
    if (!country) { setLoadingTypes(false); return; }
    let active = true;
    setLoadingTypes(true); setCatalogueError('');
    void visaService.catalogue(country).then((available) => {
      if (active) {
        setTypes(available);
        if (country === initialCountry && available.some(item => item.id === requestedServiceId && (!selectionChosen || visaPurposeMatches(item,initialPurpose)))) setTypeId(requestedServiceId);
      }
    }, (cause) => {
      if (active) { setTypes([]); setCatalogueError(cause instanceof ApiClientError ? cause.message : "Visa services couldn't be loaded. Try another country or retry."); }
    }).finally(() => { if (active) setLoadingTypes(false); });
    return () => { active = false; };
  }, [country, catalogueRevision]);

  async function create() {
    const genericPurpose = typeId.startsWith('request:');
    if (preparing.current || busy || (loadingTypes && !genericPurpose)) return;
    if (!trip || !isSupportedVisaDestination(country) || !travelDate || !typeId || (!selectedType && !genericPurpose) || (catalogueError && !genericPurpose) || !validApplicantCount) { setError('Choose an available destination, travel date and visa purpose, with 1–30 applicants.'); return; }
    if (travelDate < today()) { setError('Choose a future travel date.'); return; }
    const applicationPurpose = visaPurposeForService(selectedType, initialPurpose || typeId.replace(/^request:/, ''));
    if (!hasVisitedVisaRequirements(country, applicationPurpose)) {
      navigate(visaRequirementsUrl(country, applicationPurpose));
      return;
    }
    preparing.current = true; setBusy(true); setError('');
    try {
      if (people.length) {
        const profiles = await travellerService.list();
        if (people.some(id => profiles.find(person => person.id === id)?.nationalityCountryCode !== 'BD')) { setError('This visa service is for Bangladeshi nationals only. Choose a Bangladeshi applicant or continue with a new applicant.'); return; }
      }
      const matchesTrip = trip.primaryDestination?.countryCode === country && trip.startDate === travelDate;
      const targetTrip = matchesTrip ? trip : await tripService.create({
        title: `${countryName(country)} visa journey`, startDate: travelDate,
        destinations: [{ countryCode: country, startDate: travelDate }], travellerIds: people,
      });
      if (selectedType && !newApplicants) {
        const application = await visaService.create(targetTrip.id, typeId, people);
        navigate(`/app/visa-applications/${application.id}`);
      } else {
        const draft = { tripId: targetTrip.id, destinationCountryCode: country, expectedTravelDate: travelDate,
          purpose: visaPurposeForService(selectedType,initialPurpose || typeId.replace(/^request:/, '')), travellerIds: people, newApplicantCount: newApplicants };
        try { sessionStorage.setItem('flyseri.visa-assistance-draft', JSON.stringify(draft)); } catch { /* Navigation state carries the choice when browser storage is unavailable. */ }
        navigate('/app/visa/assistance', { state: { visaAssistanceDraft: draft } });
      }
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "We couldn't continue. Your selection is still here; please try again.");
    } finally { preparing.current = false; setBusy(false); }
  }

  if (selectionChosen && (!initialCountry || !initialPurpose)) return <Navigate to="/app/visa/new" replace />;
  if (loading) return <PageLoading label="Loading visa planning"/>;
  if (notFound) return <div className="account-page visa-page"><h1>Trip not found</h1><Link to="/app/trips">Back to My Trips</Link></div>;
  if (!trip) return <div role="alert" className="account-page visa-page"><h1>We couldn't load visa planning.</h1><p>{error}</p><button className="btn-primary" onClick={() => tripId && void load(tripId)}><Translated text="Try again" /></button></div>;

  return <div className={`${embedded ? '' : 'account-page '}visa-page visa-trip-page${embedded ? ' visa-trip-page-embedded' : ''}`}>
    <VisaFlowHeader
      back={!embedded && <Link to={selectionChosen ? '/app/visa/new?' + searchParams.toString() : '/app/visa'}>{selectionChosen ? '← Change visa selection' : '← Visa planning'}</Link>}
      title={selectionChosen ? 'Visa application' : 'Where are you going?'}
      description={selectionChosen ? `${countryName(country)} · ${selectedType?.name || initialPurpose} · Bangladeshi nationals only.` : 'For Bangladeshi nationals only. Choose your destination, expected travel date and purpose to begin.'}
    />
    {!embedded && <VisaJourneyProgress current="choose" />}
    {error && <p role="alert" className="account-error">{error}</p>}
    <div className="visa-trip-sections">
      <section className="account-panel visa-start-panel"><fieldset className="visa-intake-controls" disabled={busy}><div className="visa-start-heading"><span className="visa-start-number">01</span><div><p className="account-eyebrow">{selectionChosen ? 'TRAVEL & APPLICANTS' : 'YOUR VISA SEARCH'}</p><h2>{selectionChosen ? 'Prepare your application' : 'Tell us about your visit'}</h2></div></div>
        <div className="visa-search-grid">
          {!selectionChosen && <label>Destination country<select value={country} onChange={(event) => setCountry(event.target.value)} required><option value="">Choose a country</option>{countries.filter(item => isSupportedVisaDestination(item.code)).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>}
          <label>Expected travel date<DateInput label="Expected travel date"  min={today()} value={travelDate} onChange={(event) => setTravelDate(event.target.value)} required /></label>
          {!selectionChosen && <label>Visa purpose<select value={typeId} onChange={(event) => setTypeId(event.target.value)} required>
            <option value="">Choose a purpose</option>
            {types.length > 0 && <optgroup label="Published visa services">{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</optgroup>}
            <optgroup label="General assisted request">{commonPurposes.map(purpose => <option key={purpose} value={`request:${purpose}`}>{purpose}</option>)}</optgroup>
          </select></label>}
        </div>
        {loadingTypes && <PageLoading inline label="Loading visa services"/>}
        {catalogueError && <p role="alert" className="account-error">{catalogueError} You can still continue with a general assisted request. <button type="button" onClick={() => setCatalogueRevision((value) => value + 1)}><Translated text="Retry" /></button></p>}
        {!loadingTypes && country && !types.length && !catalogueError && <p className="visa-service-empty">Flyseri can review an assisted visa request for {countryName(country)}. This form is for Flyseri’s service; it is not a government application, and you can review the service fee before payment.</p>}
        {selectedType && <article className="visa-catalogue-detail"><h3>{countryName(selectedType.destinationCountryCode)} · {selectedType.name}</h3><p>{selectedType.description || 'Visa application assistance by Seri Mechan.'}</p>
          <dl>{selectedType.processingTimeText && <div><dt>Processing time</dt><dd>{selectedType.processingTimeText}</dd></div>}{selectedType.entryType && <div><dt>Entry</dt><dd>{selectedType.entryType}</dd></div>}{selectedType.validityText && <div><dt>Validity</dt><dd>{selectedType.validityText}</dd></div>}{selectedType.governmentFeeAmount && selectedType.currency && <div><dt>Government / embassy fee</dt><dd>{formatMoney(selectedType.governmentFeeAmount, selectedType.currency)}</dd></div>}{selectedType.serviceFeeAmount && selectedType.currency && <div><dt>Service fee</dt><dd>{formatMoney(selectedType.serviceFeeAmount, selectedType.currency)}</dd></div>}</dl>
          {selectedType.notes && <p>{selectedType.notes}</p>}{selectedType.disclaimers?.map((item, index) => <p className="account-muted" key={index}>{item}</p>)}<small>The embassy or relevant authority makes the visa decision. Approval is not guaranteed.</small></article>}
        <fieldset className="visa-applicant-picker"><legend>Who is applying? <span className="visa-optional-label">Optional saved profiles</span></legend><p className="visa-assistance-help">Select previous applicants to reuse their details, or continue with new applicants below.</p>{trip.travellers.map((person) => <label className="visa-check" key={person.id}><input type="checkbox" checked={people.includes(person.id)} onChange={(event) => setPeople(event.target.checked ? [...people, person.id] : people.filter((id) => id !== person.id))} /><span>{person.legalFirstName} {person.legalLastName}</span></label>)}<div className="visa-new-applicant-count"><label htmlFor="visa-new-applicants">New applicants<input id="visa-new-applicants" type="number" min={people.length ? 0 : 1} max={30 - people.length} value={newApplicants} onChange={event => setNewCount(Number(event.target.value))}/></label><p>Enter their details on the next page. You can add more applicants there.</p><strong>{totalApplicants} applicant{totalApplicants === 1 ? '' : 's'} in total</strong></div></fieldset>
        <VisaFlowActions next="Applicant details" back={<Link onClick={event=>{if(busy)event.preventDefault();}} to={selectionChosen ? '/app/visa/new?'+searchParams.toString() : '/app/visa'}>← Back</Link>}><button type="button" className="btn-primary" aria-label={busy ? 'Preparing application' : selectedType && !newApplicants ? 'Start visa application' : 'Continue to applicant details'} disabled={busy || ((loadingTypes || Boolean(catalogueError)) && !typeId.startsWith('request:')) || !country || !travelDate || !typeId || !validApplicantCount} onClick={() => void create()}>{busy ? 'Preparing…' : <>Continue <span aria-hidden="true">→</span></>}</button></VisaFlowActions>
        </fieldset>
      </section>
      <aside className="account-panel visa-existing-applications"><p className="account-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Your applications</h2>{applications.length ? <div className="visa-app-grid">{applications.map((application) => <Link className="visa-app-card" key={application.id} to={`/app/visa-applications/${application.id}`}><span className="visa-icon" aria-hidden="true">◆</span><div><strong>{countryName(application.destinationCountryCode)} · {application.visaTypeName}</strong><small>{visaStatus(application.status)}</small><small>{application.requiredTotal ? `${application.requiredCompleted} of ${application.requiredTotal} required items provided` : 'Contact Flyseri for document requirements'}</small></div><span aria-hidden="true">→</span></Link>)}</div> : <p className="account-muted">No visa applications for this journey yet.</p>}</aside>
    </div>
  </div>;
}
