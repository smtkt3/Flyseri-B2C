import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeriMessage } from '@flyseri/types';
import { useAuth } from '../auth/AuthProvider';
import { seriService } from '../services/seriService';
import { useLanguage } from './language';

export function SupportHandover({ conversationId, messages }: { conversationId?: string | null; messages: SeriMessage[] }) {
  const { session } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof seriService.prepareSupport>> | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const lastFlights = messages.filter(message => message.payload?.source === 'sabre').at(-1)?.payload?.searchRequest as { origin?: string; destination?: string; departureDate?: string } | undefined;
  async function prepare() {
    if (sending.current) return; sending.current = true; setBusy(true); setError('');
    const lastQuestion = messages.filter(message => message.role === 'USER').at(-1)?.content.slice(0, 600) ?? 'Please help me plan my journey.';
    try { setPrepared(await seriService.prepareSupport({ ...(conversationId ? { conversationId } : {}), reason: `Travel assistance. ${lastFlights ? `Latest flight search: ${lastFlights.origin} → ${lastFlights.destination}, ${lastFlights.departureDate}. ` : ''}Latest question: ${lastQuestion}` })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not prepare support request.'); }
    finally { sending.current = false; setBusy(false); }
  }
  return <div className="travel-handover"><button type="button" className="account-outline-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('Talk to our team')} ↗</button>{open && <div className="travel-tool">
    <strong>{t('Review handover')}</strong><p>{conversationId ? 'Share this conversation and its flight search context with the Flyseri support team.' : 'Share your latest question and flight search details with our team.'} You will receive updates under Support. This is a support request, not a live agent connection.</p>
    {!session ? <Link to="/sign-in">{t('Sign in')} →</Link> : sent ? <p role="status">Request queued. <Link to="/app/support">{t('Track your requests')} →</Link></p> : prepared ? <><p>{prepared.summary}</p><div className="travel-actions"><button className="travel-primary" disabled={busy} onClick={() => { if (sending.current) return; sending.current = true; setBusy(true); void seriService.confirm(prepared.conversationId, prepared.actionId).then(() => setSent(true), cause => setError(cause instanceof Error ? cause.message : 'Could not confirm your request.')).finally(() => { sending.current = false; setBusy(false); }); }}>{busy ? 'Sending…' : t('Share and request support')}</button><button disabled={busy} onClick={() => { if (sending.current) return; sending.current = true; setBusy(true); void seriService.cancel(prepared.conversationId, prepared.actionId).then(() => { setPrepared(null); setOpen(false); }, () => setError('Could not cancel the request.')).finally(() => { sending.current = false; setBusy(false); }); }}>{t('Not now')}</button></div></> : <button disabled={busy} onClick={() => void prepare()}>{busy ? 'Preparing…' : t('Review request')}</button>}
    {error && <p role="alert" className="travel-error">{error}</p>}
  </div>}</div>;
}
