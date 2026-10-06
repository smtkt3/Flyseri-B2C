import { createContext, useContext, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FlightBookingIntent, TravellerProfile, TripDetail, TripStatus } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { travellerService } from '../services/travellerService';
import { tripService } from '../services/tripService';
import { flightService } from '../services/flightService';
import { countries, countryName, destinationLabel, displayDate, displayTripTitle } from './tripPresentation';
import { TripActivityPanel } from './TripActivityPanel';

type Tab = 'overview' | 'travellers' | 'itinerary';
const TripWorkspaceContext = createContext<{ tripId: string; trip: TripDetail } | null>(null);
export const useTripWorkspace = () => useContext(TripWorkspaceContext);
const statusLabels: Record<TripStatus, string> = { PLANNING: 'Planning', ACTIVE: 'Active', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

function WorkspaceContent({ trip, setTrip }: { trip: TripDetail; setTrip: (trip: TripDetail) => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(trip.title ?? '');
  const [status, setStatus] = useState<TripStatus>(trip.status);
  const [startDate, setStartDate] = useState(trip.startDate ?? '');
  const [endDate, setEndDate] = useState(trip.endDate ?? '');
  const [people, setPeople] = useState<TravellerProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [selectedTraveller, setSelectedTraveller] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newCity, setNewCity] = useState('');
  const [editingDestination, setEditingDestination] = useState<string | null>(null);
  const [editCountry, setEditCountry] = useState('');
  const [editCity, setEditCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (tab !== 'travellers') return;
    let active = true;
    setPeopleLoading(true); setPeopleError('');
    void travellerService.list().then((data) => { if (active) setPeople(data); }, () => { if (active) setPeopleError("We couldn't load your saved travellers."); }).finally(() => { if (active) setPeopleLoading(false); });
    return () => { active = false; };
  }, [tab]);

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (startDate && endDate && endDate < startDate) { setError('Your return date needs to be on or after your departure date.'); return; }
    setBusy(true);
    try { setTrip(await tripService.update(trip.id, { title: title.trim() || null, status, startDate: startDate || null, endDate: endDate || null })); setEditing(false); setNotice('Trip updated.'); }
    catch { setError("We couldn't save this trip. Please try again."); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!window.confirm('Archive this trip? It will leave your active trip list.')) return;
    setBusy(true); setError('');
    try { await tripService.archive(trip.id); navigate('/app/trips', { replace: true }); }
    catch { setError("We couldn't archive this trip. Please try again."); setBusy(false); }
  }
  async function addTraveller() {
    if (!selectedTraveller) return;
    setBusy(true); setError(''); setNotice('');
    try { setTrip(await tripService.addTraveller(trip.id, selectedTraveller)); setSelectedTraveller(''); setNotice('Traveller added to your trip.'); }
    catch { setError("We couldn't add this traveller. Please try again."); }
    finally { setBusy(false); }
  }
  async function removeTraveller(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { await tripService.removeTraveller(trip.id, id); setTrip(await tripService.detail(trip.id)); setNotice('Traveller removed from this trip.'); }
    catch { setError("We couldn't remove this traveller. Please try again."); }
    finally { setBusy(false); }
  }
  async function addDestination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newCountry) { setError('Choose a country for this stop.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { setTrip(await tripService.addDestination(trip.id, { countryCode: newCountry, cityName: newCity.trim() || null })); setNewCountry(''); setNewCity(''); setNotice('Stop added to your itinerary.'); }
    catch { setError("We couldn't add this stop. Please try again."); }
    finally { setBusy(false); }
  }
  async function saveDestination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingDestination) return;
    setBusy(true); setError('');
    try { setTrip(await tripService.updateDestination(trip.id, editingDestination, { countryCode: editCountry, cityName: editCity.trim() || null })); setEditingDestination(null); setNotice('Stop updated.'); }
    catch { setError("We couldn't update this stop. Please try again."); }
    finally { setBusy(false); }
  }
  async function removeDestination(id: string) {
    setBusy(true); setError('');
    try { await tripService.removeDestination(trip.id, id); setTrip(await tripService.detail(trip.id)); setNotice('Stop removed.'); }
    catch { setError("We couldn't remove this stop. Please try again."); }
    finally { setBusy(false); }
  }
  const availablePeople = people.filter((person) => !trip.travellers.some((included) => included.id === person.id));
  return <TripWorkspaceContext.Provider value={{ tripId: trip.id, trip }}><div className="account-page trip-page trip-workspace"><Link className="trip-back" to="/app/trips">← My Trips</Link>
    <div className="trip-workspace-hero"><div><p className="account-eyebrow">YOUR TRIP WORKSPACE</p><h1>{displayTripTitle(trip)}</h1><p>{destinationLabel(trip)}</p><div className="trip-hero-meta"><span>◷ {trip.startDate ? `${displayDate(trip.startDate)}${trip.endDate ? ` – ${displayDate(trip.endDate)}` : ''}` : 'Dates to be decided'}</span><span>♧ {trip.travellers.length} {trip.travellers.length === 1 ? 'traveller' : 'travellers'}</span><span>{statusLabels[trip.status]}</span></div></div><button className="account-outline-button trip-hero-edit" onClick={() => { setEditing(true); setTab('overview'); }}>Edit trip</button></div>
    {error && <p role="alert" className="account-error">{error}</p>}{notice && <p role="status" className="account-notice">{notice}</p>}
    <div className="trip-active-services"><Link className="trip-live-card" to={`/app/flights?tripId=${trip.id}`}><span>✈</span><div>Find flights<small>Compare live shopping results when connected</small></div><strong>Search →</strong></Link><Link className="trip-live-card" to={`/app/trips/${trip.id}/visa`}><span>◆</span><div>Visa planning<small>Applications and real requirement checklists</small></div><strong>Open →</strong></Link><Link className="trip-live-card" to="/app/documents"><span>▣</span><div>My Documents<small>Keep private files ready to reuse</small></div><strong>Open →</strong></Link><Link className="trip-live-card" to={`/app/trips/${trip.id}/seri`}><span>✦</span><div>Ask Seri<small>Get help with this trip’s context</small></div><strong>Chat →</strong></Link></div>
    <TripFlightSelections tripId={trip.id} />
    <TripActivityPanel tripId={trip.id} />
    <div className="trip-tabs" role="tablist" aria-label="Trip workspace">{(['overview', 'travellers', 'itinerary'] as const).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    {tab === 'overview' && <div className="trip-overview-layout"><div>{editing ? <form className="account-panel account-form trip-edit-form" onSubmit={(event) => { void saveTrip(event); }}><div className="account-panel-heading"><h2>Edit your trip</h2><button type="button" onClick={() => setEditing(false)}>Cancel</button></div><div className="account-form-grid"><label>Trip name<input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Trip stage<select value={status} onChange={(event) => setStatus(event.target.value as TripStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Departure date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Return date<input type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div><button type="submit" className="btn-primary account-submit" disabled={busy}>Save changes</button></form> : <div className="account-panel trip-overview-panel"><p className="account-eyebrow">AT A GLANCE</p><h2>The journey so far</h2><dl><div><dt>Destination</dt><dd>{destinationLabel(trip)}</dd></div><div><dt>When</dt><dd>{trip.startDate ? `${displayDate(trip.startDate)}${trip.endDate ? ` – ${displayDate(trip.endDate)}` : ''}` : 'Dates to be decided'}</dd></div><div><dt>Who</dt><dd>{trip.travellers.length ? trip.travellers.map((person) => person.legalFirstName).join(', ') : 'Travellers to be added'}</dd></div><div><dt>Stage</dt><dd>{statusLabels[trip.status]}</dd></div></dl><div className="trip-overview-actions"><button onClick={() => setTab('travellers')}>Manage travellers →</button><button onClick={() => setTab('itinerary')}>Plan stops →</button></div></div>}<div className="account-panel trip-next-panel"><p className="account-eyebrow">ALSO COMING TO YOUR WORKSPACE</p><h2>More of your journey, together.</h2><div className="trip-future-grid">{[['◇', 'Stays', 'Stay planning will appear here later.'], ['◉', 'Activities', 'Activities will appear here later.']].map(([icon, label, copy]) => <div key={label} className="trip-future-card"><span>{icon}</span><strong>{label}</strong><small>{copy}</small></div>)}</div></div></div><aside className="trip-overview-aside"><div className="account-panel"><p className="account-eyebrow">QUICK ACTIONS</p><h2>Keep planning</h2><button onClick={() => setTab('travellers')}>♧ Manage travellers</button><button onClick={() => setTab('itinerary')}>◈ Explore the itinerary</button><button className="trip-archive" disabled={busy} onClick={() => { void archive(); }}>Archive trip</button></div></aside></div>}
    {tab === 'travellers' && <section className="account-panel trip-tab-panel"><p className="account-eyebrow">WHO'S COMING</p><h2>Travellers</h2><p className="account-muted">These people are part of your overall trip. You can change the group as your plans take shape.</p>{trip.travellers.length ? <div className="trip-workspace-people">{trip.travellers.map((person) => <div className="trip-workspace-person" key={person.id}><span className="trip-person-avatar">{person.legalFirstName[0]}{person.legalLastName[0]}</span><div><strong>{person.legalFirstName} {person.legalLastName}</strong><small>{person.relationshipType.toLowerCase()}</small></div><button disabled={busy} onClick={() => { void removeTraveller(person.id); }}>Remove</button></div>)}</div> : <div className="trip-inline-empty">No travellers on this trip yet.</div>}<div className="trip-add-person"><h3>Add a saved traveller</h3>{peopleLoading ? <p role="status">Loading your travellers…</p> : peopleError ? <p role="alert">{peopleError}</p> : availablePeople.length ? <div><select aria-label="Choose a traveller" value={selectedTraveller} onChange={(event) => setSelectedTraveller(event.target.value)}><option value="">Choose a traveller</option>{availablePeople.map((person) => <option key={person.id} value={person.id}>{person.legalFirstName} {person.legalLastName}</option>)}</select><button className="btn-primary trip-primary-link" disabled={!selectedTraveller || busy} onClick={() => { void addTraveller(); }}>Add to trip</button></div> : <p>Everyone in your saved list is already on this trip.</p>}<Link to="/app/travellers" className="trip-text-button">+ Add a new traveller profile</Link></div></section>}
    {tab === 'itinerary' && <section className="account-panel trip-tab-panel"><p className="account-eyebrow">PLACES ALONG THE WAY</p><h2>Your itinerary</h2><p className="account-muted">Add the places you'd like to visit. The order can grow with your plans.</p>{trip.destinations.length ? <ol className="trip-itinerary-list">{trip.destinations.map((stop, index) => <li key={stop.id}><span className="trip-itinerary-number">{String(index + 1).padStart(2, '0')}</span><div>{editingDestination === stop.id ? <form className="trip-inline-edit" onSubmit={(event) => { void saveDestination(event); }}><select aria-label="Edit country" value={editCountry} onChange={(event) => setEditCountry(event.target.value)}>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select><input aria-label="Edit city" maxLength={120} value={editCity} onChange={(event) => setEditCity(event.target.value)} placeholder="City or place" /><button type="submit" disabled={busy}>Save</button><button type="button" onClick={() => setEditingDestination(null)}>Cancel</button></form> : <><strong>{stop.cityName || countryName(stop.countryCode)}</strong><small>{countryName(stop.countryCode)}</small></>}</div>{editingDestination !== stop.id && <div className="trip-stop-actions"><button onClick={() => { setEditingDestination(stop.id); setEditCountry(stop.countryCode); setEditCity(stop.cityName ?? ''); }}>Edit</button><button disabled={busy} onClick={() => { void removeDestination(stop.id); }}>Remove</button></div>}</li>)}</ol> : <div className="trip-inline-empty">No places added yet. Add your first stop below.</div>}<form className="trip-add-stop" onSubmit={(event) => { void addDestination(event); }}><h3>Add a stop</h3><div><label>Country<select value={newCountry} onChange={(event) => setNewCountry(event.target.value)} required><option value="">Choose a country</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label><label>City or place<input maxLength={120} value={newCity} onChange={(event) => setNewCity(event.target.value)} placeholder="Optional" /></label><button type="submit" className="btn-primary trip-primary-link" disabled={busy}>Add stop</button></div></form></section>}
  </div></TripWorkspaceContext.Provider>;
}

function TripFlightSelections({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<FlightBookingIntent[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    void flightService.intentsForTrip(tripId).then((rows) => { if (active) setItems(rows); }, () => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [tripId]);
  return <section className="account-panel trip-tab-panel" aria-label="Selected flights">
    <p className="account-eyebrow">FLIGHTS FOR THIS TRIP</p><h2>Selected flights</h2>
    {unavailable ? <p className="account-muted">Flight selections are unavailable right now.</p>
      : items === null ? <p role="status">Loading flight selections…</p>
        : items.length === 0 ? <p className="account-muted">No flight selected yet.</p>
          : <div className="trip-workspace-people">{items.map((item) => <div className="trip-workspace-person" key={item.id}><span className="trip-person-avatar">✈</span><div><strong>{item.selectedOffer.outbound.segments[0]?.origin} → {item.selectedOffer.outbound.segments.at(-1)?.destination}</strong><small>{item.status === 'CANCELLED' ? 'Selection removed' : item.status === 'READY_FOR_PAYMENT' ? 'Fare checked · payment not available yet' : 'Selected · not booked'}</small></div><Link to={`/app/flights/booking-intents/${item.id}`}>Review →</Link></div>)}</div>}
    <Link className="trip-text-button" to={`/app/flights?tripId=${tripId}`}>Find flights →</Link>
  </section>;
}

export function TripWorkspacePage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  async function load(id: string) {
    setLoading(true); setError(''); setNotFound(false);
    try { setTrip(await tripService.detail(id)); }
    catch (cause) { if (cause instanceof ApiClientError && cause.status === 404) setNotFound(true); else setError("We couldn't load this trip. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (tripId) void load(tripId); }, [tripId]);
  if (!tripId) return <div className="account-page"><h1>Trip not found</h1><Link to="/app/trips">Back to My Trips</Link></div>;
  if (loading) return <div role="status" className="account-page trip-page"><div className="trip-skeleton trip-skeleton-wide" /><div className="trip-skeleton" /><span>Opening your trip…</span></div>;
  if (notFound) return <div className="account-page trip-page trip-state"><p className="account-eyebrow">TRIP UNAVAILABLE</p><h1>Trip not found</h1><p className="account-muted">This trip may have been archived or is no longer available.</p><Link className="btn-primary trip-primary-link" to="/app/trips">Back to My Trips</Link></div>;
  if (error || !trip) return <div className="account-page trip-page trip-state" role="alert"><h1>We couldn't load this trip.</h1><p>{error || 'Please try again.'}</p><button className="btn-primary trip-primary-link" onClick={() => { void load(tripId); }}>Retry</button></div>;
  return <WorkspaceContent key={trip.id} trip={trip} setTrip={setTrip} />;
}
