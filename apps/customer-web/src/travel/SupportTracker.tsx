import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupportStage, TravelSupportRequest } from '@flyseri/types';
import { travelService } from '../services/travelService';
import { money } from '../flight/flightPresentation';
import { useLanguage } from './language';
const stageLabels: Record<SupportStage, string> = { QUEUED: 'Queued', REVIEWING: 'Reviewing', QUOTE_READY: 'Quote ready', APPROVED: 'Approved', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export function SupportTracker({ revision = 0 }: { revision?: number }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<TravelSupportRequest[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [review, setReview] = useState<string | null>(null);
  const sending = useRef(false);
  async function load() { setBusy(true); setError(''); try { setItems(await travelService.requests()); } catch { setError('Could not load your requests.'); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, [revision]);
  return <section className="travel-tool"><div className="travel-tool-heading"><h2>{t('Track your requests')}</h2><button disabled={busy} onClick={() => void load()}>{t('Refresh')}</button></div>
    {busy && <p role="status">Loading requests…</p>}{error && <p role="alert" className="travel-error">{error}</p>}
    {!busy && !error && !items.length && <p>Your confirmed support requests and updates will appear here.</p>}
    {items.map(item => <article key={item.id} className="travel-row"><div style={{ width: '100%' }}><span className="travel-badge">{t(stageLabels[item.stage])}</span><strong>{item.reason}</strong><small>Reference: {item.id}</small>
      <details><summary>Progress & messages</summary><ol className="travel-support-history">{item.updates.map((update, index) => <li key={index}><strong>{t(stageLabels[update.stage])} · {update.author === 'TEAM' ? 'Flyseri team' : 'You'}</strong><time dateTime={update.at}>{new Date(update.at).toLocaleString()}</time><p>{update.message}</p></li>)}</ol></details>
      {item.stage === 'QUOTE_READY' && item.quote && <div><h3>{money(String(item.quote.amount), item.quote.currency)}</h3><p>{item.quote.description}</p><p>Valid until {new Date(item.quote.expiresAt).toLocaleString()}. Approval authorizes the team to proceed; payment and airline confirmation are separate.</p>
        {review === item.id ? <div className="travel-actions"><button className="travel-primary" disabled={busy || Date.parse(item.quote.expiresAt) <= Date.now()} onClick={() => { if (sending.current) return; sending.current = true; setBusy(true); void travelService.approve(item).then(updated => { setItems(rows => rows.map(row => row.id === updated.id ? updated : row)); setReview(null); }, cause => setError(cause instanceof Error ? cause.message : 'Could not approve this quote.')).finally(() => { sending.current = false; setBusy(false); }); }}>Confirm approval</button><button onClick={() => setReview(null)}>{t('Cancel')}</button></div> : <button disabled={busy || Date.parse(item.quote.expiresAt) <= Date.now()} onClick={() => setReview(item.id)}>{Date.parse(item.quote.expiresAt) <= Date.now() ? 'Quote expired' : t('Approve quoted fee')}</button>}</div>}
      <Link to={`/app/seri?conversation=${encodeURIComponent(item.conversationId)}`}>{t('View support conversation →')}</Link>
    </div></article>)}
  </section>;
}
