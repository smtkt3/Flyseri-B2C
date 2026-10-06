import { VisaJourneyProgress } from './VisaJourneyProgress';
import { Link } from 'react-router-dom';
import { visaService } from '../services/visaService';
import type { VisaAssistanceRequestSummary } from '@flyseri/types';
import { useEffect, useRef, useState } from 'react';
import type { TripSummary } from '@flyseri/types';
import { tripService } from '../services/tripService';
import { TripVisaPage } from './TripVisaPage';
import './visa-application.css';

export function VisaHubPage() {
  const [requests, setRequests] = useState<VisaAssistanceRequestSummary[]>([]);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState('');
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    const [savedTrips, savedRequests] = await Promise.allSettled([tripService.list(), visaService.assistanceList()]);
    if (version !== loadVersion.current) return;
    if (savedTrips.status === 'fulfilled') setTrips(savedTrips.value);
    if (savedRequests.status === 'fulfilled') setRequests(savedRequests.value);
    const messages = [savedTrips.status === 'rejected' ? 'Saved journeys are temporarily unavailable.' : '', savedRequests.status === 'rejected' ? 'Saved visa requests are temporarily unavailable.' : ''].filter(Boolean);
    setError(messages.length ? messages.join(' ') + ' You can still start a new visa search.' : '');
    setInitialized(true);
    setLoading(false);
  }

  useEffect(() => { void load(); return () => { loadVersion.current++; }; }, []);

  return <div className="account-page visa-page visa-hub-page">
    <header className="visa-assistance-intro"><p className="account-eyebrow">FLYSERI ASSISTED SERVICE · STEP 01</p><h1>A clearer journey to your visa</h1>
      <p>Choose your destination, travel date and visa purpose, then complete your applicant details and documents before reviewing the service fee.</p></header>
    <VisaJourneyProgress current="choose" />
    {loading && !initialized ? <div role="status" className="account-panel visa-hub-loading"><div className="trip-skeleton trip-skeleton-wide" />Preparing your visa search…</div>
      : <>
        {error && <div role="alert" className="account-panel visa-hub-error"><p>{error}</p><button type="button" className="btn-primary" disabled={loading} onClick={() => { void load(); }}>Retry saved journeys</button></div>}
        {requests.length > 0 && <section className="account-panel visa-upload-applicant"><h2>Your saved requests</h2>{requests.map(request => <p key={request.id}><Link to={'/app/visa/assistance/' + request.id + '/documents'}>{request.requestReference} · {request.destinationCountryCode} · {request.status === 'NEW' ? 'Continue to documents →' : request.status.replace(/_/g, ' ')}</Link></p>)}</section>}
        <TripVisaPage embedded initialTripId={trips[0]?.id} />
      </>}
  </div>;
}
