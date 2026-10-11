import { Translated } from '../travel/language';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TripSummary } from '@flyseri/types';
import { tripService } from '../services/tripService';
import { destinationLabel, displayDate, displayTripTitle, tripGroup } from './tripPresentation';

export function MyTripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<TripSummary[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { setTrips(await tripService.list()); }
    catch { setError("We couldn't load your trips. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!showArchived) return;
    let active = true;
    setArchivedLoading(true); setArchivedError(false);
    void tripService.list({ archived: true }).then((items) => { if (active) setArchived(items); }, () => { if (active) setArchivedError(true); })
      .finally(() => { if (active) setArchivedLoading(false); });
    return () => { active = false; };
  }, [showArchived]);
  return <div className="account-page trip-page">
    <div className="trip-page-heading"><div><p className="account-eyebrow">YOUR JOURNEYS</p><h1><Translated text="My Trips" /></h1><p className="account-muted">Every great journey starts with a plan. Keep yours together here.</p></div><Link className="btn-primary trip-primary-link" to="/app/trips/new">Plan a trip <span aria-hidden="true">↗</span></Link></div>
    {loading ? <div role="status" className="trip-loading"><div className="trip-skeleton" /><div className="trip-skeleton" /><span>Finding your trips…</span></div> : error ? <div role="alert" className="account-error">{error} <button onClick={() => { void load(); }}><Translated text="Retry" /></button></div> : trips.length === 0 ? <div className="trip-empty"><span className="trip-empty-mark">✦</span><p className="account-eyebrow">A BLANK PAGE, FULL OF POSSIBILITY</p><h2>No trips yet</h2><p>Start with a place you dream of visiting. You can choose dates and travelling companions later.</p><div className="trip-empty-actions"><Link className="btn-primary trip-primary-link" to="/app/trips/new">Plan a trip</Link><Link to="/app/seri" className="account-outline-button trip-secondary-link"><Translated text="Ask Seri" /></Link></div></div> : <>
      {(['Upcoming', 'Planning', 'Past'] as const).map((group) => { const items = trips.filter((trip) => tripGroup(trip) === group); return items.length ? <section className="trip-group" key={group}><div className="trip-group-heading"><h2>{group}</h2><span>{items.length} {items.length === 1 ? 'trip' : 'trips'}</span></div><div className="trip-card-grid">{items.map((trip) => <Link key={trip.id} className="trip-card" to={`/app/trips/${trip.id}`}><div className="trip-card-top"><span className="trip-card-icon">✈</span><span className="trip-status">{trip.status.toLowerCase()}</span></div><h3>{displayTripTitle(trip)}</h3><p>{destinationLabel(trip)}</p><div className="trip-card-meta"><span>◷ {trip.startDate ? `${displayDate(trip.startDate)}${trip.endDate ? ` – ${displayDate(trip.endDate)}` : ''}` : 'Dates to be decided'}</span><span>♧ {trip.travellerCount} {trip.travellerCount === 1 ? 'traveller' : 'travellers'}</span></div><strong>Open trip <span aria-hidden="true">→</span></strong></Link>)}</div></section> : null; })}
    </>}
    <section className="trip-archive-section"><button type="button" className="account-outline-button" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? 'Hide archived trips' : 'Show archived trips'}</button>
      {showArchived && (archivedLoading ? <p role="status">Loading archived trips…</p> : archivedError ? <p role="alert">We couldn't load archived trips. Hide and reopen this section to retry.</p> : archived.length ? <div className="trip-card-grid">{archived.map((trip) => <article className="trip-card" key={trip.id}><div className="trip-card-top"><span className="trip-card-icon">✈</span><span className="trip-status">Archived</span></div><h3>{displayTripTitle(trip)}</h3><p>{destinationLabel(trip)}</p><div className="trip-card-meta"><span>{trip.startDate ? displayDate(trip.startDate) : 'Dates not set'}</span><span>{trip.travellerCount} {trip.travellerCount === 1 ? 'traveller' : 'travellers'}</span></div><small>Archived trips are kept for your records.</small></article>)}</div> : <p className="account-muted">No archived trips.</p>)}
    </section>
  </div>;
}
