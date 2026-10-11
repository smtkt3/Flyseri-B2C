import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { FareWatch, FlightSearchRequest } from '@flyseri/types';
import { useAuth } from '../auth/AuthProvider';
import { travelService } from '../services/travelService';
import { money } from '../flight/flightPresentation';
import { useLanguage } from './language';

export function FareWatchControl({ search, initialAmount }: { search: FlightSearchRequest; initialAmount?: number }) {
  const { session } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [target, setTarget] = useState(initialAmount ? Math.floor(initialAmount * .9).toString() : '');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  return <div className="travel-tool"><details><summary>♧ {t('Watch this route')}</summary>
    <p>{t('Price alerts')} · {search.currency} · {search.adults + search.children + search.infants} travellers</p>
    {!session ? <Link to="/sign-in" state={{ returnTo: location.pathname + location.search }}>{t('Sign in')} →</Link> : <form onSubmit={event => {
      event.preventDefault(); if (sending.current) return;
      sending.current = true; setBusy(true); setError(''); setNotice('');
      void travelService.watch(search, Number(target)).then(() => setNotice('Saved. We check about every 6 hours and show matching fares in Price alerts.'), cause => setError(cause instanceof Error ? cause.message : 'Could not save your price watch.')).finally(() => { sending.current = false; setBusy(false); });
    }}><label>{t('Target total')} ({search.currency})<input type="number" required min="1" max="999999999" step="0.01" value={target} onChange={event => setTarget(event.target.value)} /></label><div className="travel-actions"><button className="travel-primary" disabled={busy}>{busy ? 'Saving…' : t('Save price watch')}</button><Link to="/app/price-alerts">{t('Price alerts')} →</Link></div></form>}
    <p>In-app alerts only. A price watch does not hold a fare or reserve seats.</p>
    {notice && <p role="status" className="travel-success">{notice}</p>}{error && <p role="alert" className="travel-error">{error}</p>}
  </details></div>;
}
export function FareWatchesPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<FareWatch[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function load() { setBusy(true); setError(''); try { setItems(await travelService.watches()); } catch { setError('Could not load price watches. Please try again.'); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);
  return <main className="account-page"><h1>{t('Price alerts')}</h1><section className="travel-tool"><div className="travel-tool-heading"><h2>{t('Saved price watches')}</h2><button disabled={busy} onClick={() => void load()}>{t('Refresh')}</button></div><p>We check approximately every 6 hours while the service is running. Matching fares appear here; prices are checked again before booking.</p>
    {busy && <p role="status">Loading price watches…</p>}{error && <p role="alert" className="travel-error">{error}</p>}
    {!busy && !error && !items.length && <p>Search for a flight, then choose “Watch this route” to save your target price. <Link to="/app/flights">{t('Search flights')} →</Link></p>}
    {items.map(item => <article className="travel-row" key={item.id}><div><strong>{item.search.origin} → {item.search.destination}</strong><small>{item.search.departureDate}{item.search.returnDate ? ` — ${item.search.returnDate}` : ''} · {item.search.adults} adults</small><small>Target: {money(String(item.targetAmount), item.currency)}</small>
      {item.matchedAt && !item.checkError && <span className="travel-badge">Within your target</span>}
      <small>{!item.active ? 'Travel date passed' : item.checkError ? 'Last check unavailable. We will retry.' : item.lastAmount !== null ? `Last found: ${money(String(item.lastAmount), item.currency)}` : 'Waiting for first check'}</small><small>{item.checkedAt ? `Checked ${new Date(item.checkedAt).toLocaleString()}` : 'Checks begin shortly'}</small></div>
      <div className="travel-actions"><Link className="travel-button" to={`/app/flights?${new URLSearchParams(Object.entries(item.search).filter(([key]) => key !== 'legs' && key !== 'tripId').map(([key, value]) => [key, String(value)]))}${item.search.legs ? '&legs=' + encodeURIComponent(JSON.stringify(item.search.legs)) : ''}&autoSearch=1`}>{t('Search again')}</Link><button disabled={busy} onClick={() => { setBusy(true); void travelService.removeWatch(item.id).then(load, () => { setError('Could not remove this watch.'); setBusy(false); }); }}>{t('Remove')}</button></div>
    </article>)}
  </section></main>;
}
