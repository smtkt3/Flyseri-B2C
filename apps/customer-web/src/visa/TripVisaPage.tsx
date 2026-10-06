import { VisaJourneyProgress } from './VisaJourneyProgress';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TripDetail, VisaApplicationSummary, VisaType } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { tripService } from '../services/tripService';
import { visaService } from '../services/visaService';
import { travellerService } from '../services/travellerService';
import { countries, countryName, displayTripTitle } from '../trip/tripPresentation';
import { formatMoney, visaStatus } from '../account/presentation';
import './visa-application.css';

const today = () => new Date().toISOString().slice(0, 10);
const commonPurposes = ['Tourism', 'Business', 'Family visit', 'Study', 'Work', 'Transit', 'Medical', 'Other'];

export function TripVisaPage({ embedded = false, initialTripId }: { embedded?: boolean; initialTripId?: string } = {}) {
  const { tripId: routeTripId } = useParams<{ tripId: string }>();
  const tripId = routeTripId || initialTripId;
  const navigate = useNavigate();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [applications, setApplications] = useState<VisaApplicationSummary[]>([]);
  const [types, setTypes] = useState<VisaType[]>([]);
  const [country, setCountry] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [typeId, setTypeId] = useState('');
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
      setCountry(item.primaryDestination?.countryCode ?? '');
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
    setCountry(''); setTravelDate('');
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
      if (active) setTypes(available);
    }, (cause) => {
      if (active) { setTypes([]); setCatalogueError(cause instanceof ApiClientError ? cause.message : "Visa services couldn't be loaded. Try another country or retry."); }
    }).finally(() => { if (active) setLoadingTypes(false); });
    return () => { active = false; };
  }, [country, catalogueRevision]);

  async function create() {
    const genericPurpose = typeId.startsWith('request:');
    if (preparing.current || busy || (loadingTypes && !genericPurpose)) return;
    if (!trip || !country || !travelDate || !typeId || (!selectedType && !genericPurpose) || (catalogueError && !genericPurpose) || !validApplicantCount) { setError('Choose a country, travel date and visa purpose, with 1–30 applicants.'); return; }
    if (travelDate < today()) { setError('Choose a future travel date.'); return; }
    preparing.current = true; setBusy(true); setError('');
    try {
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
          purpose: selectedType?.name || typeId.replace(/^request:/, ''), travellerIds: people, newApplicantCount: newApplicants };
        try { sessionStorage.setItem('flyseri.visa-assistance-draft', JSON.stringify(draft)); } catch { /* Navigation state carries the choice when browser storage is unavailable. */ }
        navigate('/app/visa/assistance', { state: { visaAssistanceDraft: draft } });
      }
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "We couldn't continue. Your selection is still here; please try again.");
    } finally { preparing.current = false; setBusy(false); }
  }

  if (loading) return <div role="status" className="account-page visa-page"><div className="trip-skeleton trip-skeleton-wide" />Loading visa planning…</div>;
  if (notFound) return <div className="account-page visa-page"><h1>Trip not found</h1><Link to="/app/trips">Back to My Trips</Link></div>;
  if (!trip) return <div role="alert" className="account-page visa-page"><h1>We couldn't load visa planning.</h1><p>{error}</p><button className="btn-primary" onClick={() => tripId && void load(tripId)}>Try again</button></div>;

  return <div className={`${embedded ? '' : 'account-page '}visa-page visa-trip-page${embedded ? ' visa-trip-page-embedded' : ''}`}>
    {!embedded && <Link className="trip-back" to="/app/visa">← Visa planning</Link>}
    <header className="visa-trip-intro"><p className="account-eyebrow">FIND YOUR VISA PATH</p><h1>Where are you going?</h1>
      <p>Choose your destination, expected travel date, and purpose. Flyseri will review your assisted visa request and confirm the next steps.</p></header>
    {!embedded && <VisaJourneyProgress current="choose" />}
    {error && <p role="alert" className="account-error">{error}</p>}
    <div className="visa-trip-sections">
      <section className="account-panel visa-start-panel"><fieldset className="visa-intake-controls" disabled={busy}><div className="visa-start-heading"><span className="visa-start-number">01</span><div><p className="account-eyebrow">YOUR VISA SEARCH</p><h2>Tell us about your visit</h2></div></div>
        <div className="visa-search-grid">
          <label>Destination country<select value={country} onChange={(event) => setCountry(event.target.value)} required><option value="">Choose a country</option>{countries.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label>Expected travel date<input type="date" min={today()} value={travelDate} onChange={(event) => setTravelDate(event.target.value)} required /></label>
          <label>Visa purpose<select value={typeId} onChange={(event) => setTypeId(event.target.value)} required>
            <option value="">Choose a purpose</option>
            {types.length > 0 && <optgroup label="Published visa services">{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</optgroup>}
            <optgroup label="General assisted request">{commonPurposes.map(purpose => <option key={purpose} value={`request:${purpose}`}>{purpose}</option>)}</optgroup>
          </select></label>
        </div>
        {loadingTypes && <p role="status" className="visa-assistance-help">Loading published visa services. You can choose a general purpose now.</p>}
        {catalogueError && <p role="alert" className="account-error">{catalogueError} You can still continue with a general assisted request. <button type="button" onClick={() => setCatalogueRevision((value) => value + 1)}>Retry</button></p>}
        {!loadingTypes && country && !types.length && !catalogueError && <p className="visa-service-empty">Flyseri can review an assisted visa request for {countryName(country)}. This form is for Flyseri’s service; it is not a government application, and you can review the configured service fee before payment.</p>}
        {selectedType && <article className="visa-catalogue-detail"><h3>{countryName(selectedType.destinationCountryCode)} · {selectedType.name}</h3><p>{selectedType.description || 'Visa application assistance by Seri Mechan.'}</p>
          <dl>{selectedType.processingTimeText && <div><dt>Processing time</dt><dd>{selectedType.processingTimeText}</dd></div>}{selectedType.entryType && <div><dt>Entry</dt><dd>{selectedType.entryType}</dd></div>}{selectedType.validityText && <div><dt>Validity</dt><dd>{selectedType.validityText}</dd></div>}{selectedType.governmentFeeAmount && selectedType.currency && <div><dt>Government / embassy fee</dt><dd>{formatMoney(selectedType.governmentFeeAmount, selectedType.currency)}</dd></div>}{selectedType.serviceFeeAmount && selectedType.currency && <div><dt>Service fee</dt><dd>{formatMoney(selectedType.serviceFeeAmount, selectedType.currency)}</dd></div>}</dl>
          {selectedType.notes && <p>{selectedType.notes}</p>}{selectedType.disclaimers?.map((item, index) => <p className="account-muted" key={index}>{item}</p>)}<small>The embassy or relevant authority makes the visa decision. Approval is not guaranteed.</small></article>}
        <fieldset className="visa-applicant-picker"><legend>Who is applying? <span className="visa-optional-label">Optional saved profiles</span></legend><p className="visa-assistance-help">Select previous applicants to reuse their details, or continue with new applicants below.</p>{trip.travellers.map((person) => <label className="visa-check" key={person.id}><input type="checkbox" checked={people.includes(person.id)} onChange={(event) => setPeople(event.target.checked ? [...people, person.id] : people.filter((id) => id !== person.id))} /><span>{person.legalFirstName} {person.legalLastName}</span></label>)}<div className="visa-new-applicant-count"><label htmlFor="visa-new-applicants">New applicants<input id="visa-new-applicants" type="number" min={people.length ? 0 : 1} max={30 - people.length} value={newApplicants} onChange={event => setNewCount(Number(event.target.value))}/></label><p>Enter their details on the next page. You can add more applicants there.</p><strong>{totalApplicants} applicant{totalApplicants === 1 ? '' : 's'} in total</strong></div></fieldset>
        <div className="visa-stage-actions"><span>{trip.primaryDestination?.countryCode !== country || trip.startDate !== travelDate ? 'A new visa journey will be saved for this destination and date.' : `Using ${displayTripTitle(trip)}.`}</span><button type="button" className="btn-primary visa-submit" disabled={busy || ((loadingTypes || Boolean(catalogueError)) && !typeId.startsWith('request:')) || !country || !travelDate || !typeId || !validApplicantCount} onClick={() => void create()}>{busy ? 'Preparing…' : selectedType && !newApplicants ? 'Start visa application →' : 'Continue to request form →'}</button></div>
        </fieldset>
      </section>
      <aside className="account-panel visa-existing-applications"><p className="account-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Your applications</h2>{applications.length ? <div className="visa-app-grid">{applications.map((application) => <Link className="visa-app-card" key={application.id} to={`/app/visa-applications/${application.id}`}><span className="visa-icon" aria-hidden="true">◆</span><div><strong>{countryName(application.destinationCountryCode)} · {application.visaTypeName}</strong><small>{visaStatus(application.status)}</small><small>{application.requiredTotal ? `${application.requiredCompleted} of ${application.requiredTotal} required items provided` : 'Requirements not configured'}</small></div><span aria-hidden="true">→</span></Link>)}</div> : <p className="account-muted">No visa applications for this journey yet.</p>}</aside>
    </div>
  </div>;
}
