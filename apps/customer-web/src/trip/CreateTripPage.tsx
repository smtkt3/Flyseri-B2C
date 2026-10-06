import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TravellerProfile, TripDestinationInput } from '@flyseri/types';
import { travellerService } from '../services/travellerService';
import { tripService } from '../services/tripService';
import { countries } from './tripPresentation';

interface Stop { countryCode: string; cityName: string }
const blankStop = (): Stop => ({ countryCode: '', cityName: '' });
const draftKey = 'flyseri-trip-draft-v1';
interface TripDraft { title: string; startDate: string; endDate: string; stops: Stop[]; selected: string[] }
function readDraft(): TripDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    if (typeof draft !== 'object' || !draft) return null;
    const item = draft as Partial<TripDraft>;
    if (typeof item.title !== 'string' || typeof item.startDate !== 'string' || typeof item.endDate !== 'string' || !Array.isArray(item.stops) || !Array.isArray(item.selected)) return null;
    return { title: item.title, startDate: item.startDate, endDate: item.endDate, stops: item.stops.slice(0, 12).filter((stop) => typeof stop.countryCode === 'string' && typeof stop.cityName === 'string'), selected: item.selected.filter((id) => typeof id === 'string').slice(0, 30) };
  } catch { return null; }
}

export function CreateTripPage() {
  const navigate = useNavigate();
  const [draft] = useState(readDraft);
  const [title, setTitle] = useState(draft?.title ?? '');
  const [startDate, setStartDate] = useState(draft?.startDate ?? '');
  const [endDate, setEndDate] = useState(draft?.endDate ?? '');
  const [stops, setStops] = useState<Stop[]>(draft?.stops.length ? draft.stops : [blankStop()]);
  const [travellers, setTravellers] = useState<TravellerProfile[]>([]);
  const [selected, setSelected] = useState<string[]>(draft?.selected ?? []);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [peopleError, setPeopleError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void travellerService.list().then((data) => { if (active) setTravellers(data); }, () => { if (active) setPeopleError("We couldn't load your travellers. You can still plan this trip."); }).finally(() => { if (active) setLoadingPeople(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { sessionStorage.setItem(draftKey, JSON.stringify({ title, startDate, endDate, stops, selected } satisfies TripDraft)); }, [title, startDate, endDate, stops, selected]);
  function updateStop(index: number, patch: Partial<Stop>) { setStops((current) => current.map((stop, position) => position === index ? { ...stop, ...patch } : stop)); }
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (startDate && endDate && endDate < startDate) { setError('Your return date needs to be on or after your departure date.'); return; }
    if (stops.some((stop) => !stop.countryCode && stop.cityName)) { setError('Choose a country for each city you add.'); return; }
    const destinations: TripDestinationInput[] = stops.filter((stop) => stop.countryCode).map((stop) => ({ countryCode: stop.countryCode, cityName: stop.cityName.trim() || null }));
    setSaving(true);
    try {
      const trip = await tripService.create({ title: title.trim() || null, startDate: startDate || null, endDate: endDate || null, destinations, travellerIds: selected });
      sessionStorage.removeItem(draftKey);
      navigate(`/app/trips/${trip.id}`, { replace: true });
    } catch { setError("We couldn't create your trip. Please check the details and try again."); }
    finally { setSaving(false); }
  }
  return <div className="account-page trip-page"><Link className="trip-back" to="/app/trips">← My Trips</Link><div className="trip-create-header"><p className="account-eyebrow">A NEW JOURNEY</p><h1>Where to next?</h1><p className="account-muted">Start with whatever you know. You can shape the rest as your plans come together.</p></div>
    <form className="trip-create-form" onSubmit={(event) => { void save(event); }}>
      {error && <p role="alert" className="account-error">{error}</p>}
      <section className="account-panel trip-form-section"><div className="trip-step-number">01</div><div className="trip-step-content"><h2>Where are you going?</h2><p>Pick a destination, or leave it open for now.</p>{stops.map((stop, index) => <div className="trip-stop-row" key={index}><div className="trip-stop-number">{index + 1}</div><label>Country<select aria-label={`Destination ${index + 1} country`} value={stop.countryCode} onChange={(event) => updateStop(index, { countryCode: event.target.value })}><option value="">Choose a country</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label><label>City or place <small>Optional</small><input aria-label={`Destination ${index + 1} city`} maxLength={120} placeholder="Tokyo, for example" value={stop.cityName} onChange={(event) => updateStop(index, { cityName: event.target.value })} /></label>{stops.length > 1 && <button className="trip-remove-stop" type="button" onClick={() => setStops((current) => current.filter((_, position) => position !== index))} aria-label={`Remove destination ${index + 1}`}>×</button>}</div>)}{stops.length < 12 && <button type="button" className="trip-text-button" onClick={() => setStops((current) => [...current, blankStop()])}>+ Add another stop</button>}</div></section>
      <section className="account-panel trip-form-section"><div className="trip-step-number">02</div><div className="trip-step-content"><h2>When are you thinking?</h2><p>Dates can wait until you are ready.</p><div className="account-form-grid"><label>Departure date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Return date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div></div></section>
      <section className="account-panel trip-form-section"><div className="trip-step-number">03</div><div className="trip-step-content"><h2>Who is travelling?</h2><p>Choose from your saved travellers. You can add or remove people later.</p>{loadingPeople ? <p role="status" className="trip-inline-loading">Finding your travellers…</p> : peopleError ? <p role="alert" className="account-error">{peopleError}</p> : travellers.length ? <div className="trip-people-options">{travellers.map((traveller) => <label className="trip-person-choice" key={traveller.id}><input type="checkbox" checked={selected.includes(traveller.id)} onChange={() => toggle(traveller.id)} /><span className="trip-person-avatar">{traveller.legalFirstName[0]}{traveller.legalLastName[0]}</span><span><strong>{traveller.legalFirstName} {traveller.legalLastName}</strong><small>{traveller.relationshipType.toLowerCase()}</small></span></label>)}</div> : <div className="trip-inline-empty">No travellers saved yet. You can add them after creating your trip.</div>}<Link to="/app/travellers" state={{ returnTo: '/app/trips/new' }} className="trip-text-button">+ Add a traveller</Link></div></section>
      <section className="account-panel trip-form-section"><div className="trip-step-number">04</div><div className="trip-step-content"><h2>Give this trip a name</h2><p>Optional. A name makes it easier to find later.</p><label>Trip name<input maxLength={160} placeholder="Japan family holiday" value={title} onChange={(event) => setTitle(event.target.value)} /></label></div></section>
      <div className="trip-form-footer"><Link to="/app/trips" onClick={() => sessionStorage.removeItem(draftKey)}>Cancel</Link><button type="submit" className="btn-primary trip-primary-link" disabled={saving}>{saving ? 'Creating your trip…' : 'Create trip →'}</button></div>
    </form>
  </div>;
}
