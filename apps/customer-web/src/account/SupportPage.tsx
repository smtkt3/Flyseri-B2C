import { CheckoutPageHeader } from '../flight/CheckoutPageHeader';
import { Translated } from '../travel/language';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SupportTracker } from '../travel/SupportTracker';
import { seriService } from '../services/seriService';

export function SupportPage() {
  const [params] = useSearchParams();
  const bookingId = params.get('bookingId') ?? undefined;
  const [topic, setTopic] = useState(['Group fare enquiry', 'Special flight offer enquiry'].includes(params.get('topic') ?? '') ? 'Special flight offer enquiry' : 'Booking assistance');
  const [details, setDetails] = useState(() => {
    if (['Group fare enquiry', 'Special flight offer enquiry'].includes(params.get('topic') ?? '')) return (params.get('details') ?? '').slice(0, 900);
    const selectionId = params.get('selectionId');
    return selectionId && /^[0-9a-f-]{36}$/i.test(selectionId) ? `Please verify the reservation attempt for flight selection ${selectionId} before I reserve or pay again.` : '';
  });
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof seriService.prepareSupport>> | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !details.trim()) return;
    sending.current = true; setBusy(true); setError('');
    try { setPrepared(await seriService.prepareSupport({ reason: `${topic}: ${details.trim()}`, bookingId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your request could not be prepared.'); }
    finally { sending.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!prepared || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { await seriService.confirm(prepared.conversationId, prepared.actionId); setSent(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Confirmation could not be retrieved. Check your conversation before submitting again.'); }
    finally { sending.current = false; setBusy(false); }
  }
  async function cancel() {
    if (!prepared || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { await seriService.cancel(prepared.conversationId, prepared.actionId); setPrepared(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The request could not be cancelled.'); }
    finally { sending.current = false; setBusy(false); }
  }
  return <main className="account-page support-page"><CheckoutPageHeader title={<Translated text="Support"/>} description="Get help with a booking, payment, document or visa application."/>
    <section className="account-panel account-form"><h2><Translated text="Request assistance" /></h2>
      <p>The team reviews airline rules, availability and fees before any change, refund or additional service. Submitting a request does not change your booking or initiate a refund.</p>
      {bookingId && <p><Link className="account-link" to={'/app/bookings/' + encodeURIComponent(bookingId)}>Back to your booking →</Link></p>}
      {!prepared && <form onSubmit={event => void prepare(event)}><label><Translated text="What do you need?" /><select disabled={busy} value={topic} onChange={event => setTopic(event.target.value)}>{['Booking assistance', 'Special flight offer enquiry', 'Change flight', 'Cancel / refund review', 'Passenger correction', 'Seat request', 'Baggage / meal request', 'Payment assistance', 'Visa assistance'].map(item => <option key={item}>{item}</option>)}</select></label>
        <label><Translated text="Details" /><textarea required disabled={busy} maxLength={900} value={details} onChange={event => setDetails(event.target.value)} placeholder="Tell us what you need. Do not include card numbers, passwords or passport numbers." /></label>
        <button type="submit" className="btn-primary account-submit" disabled={busy || !details.trim()}>{busy ? 'Preparing request…' : 'Review request'}</button></form>}
      {prepared && !sent && <div><h3>Review before sending</h3><p className="support-review-summary">{prepared.summary}</p><p>Confirmation expires {new Date(prepared.expiresAt).toLocaleString()}.</p><p>This shares your request and account contact details with the support team.</p>
        <div className="support-review-actions"><button className="btn-primary" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Please wait…' : 'Confirm support request'}</button><button className="account-outline-button" type="button" disabled={busy} onClick={() => void cancel()}><Translated text="Cancel request" /></button></div></div>}
      {sent && prepared && <div role="status"><h3>Request queued</h3><p>Reference: {prepared.conversationId}. Your request is saved for support review. No airline change or refund has been made.</p></div>}
      {prepared && <p><Link className="account-link" to={'/app/seri?conversation=' + encodeURIComponent(prepared.conversationId)}><Translated text="View support conversation →" /></Link></p>}
      {error && <p role="alert" className="account-error">{error}</p>}
    </section>
    <SupportTracker revision={sent ? 1 : 0} />
    <div className="account-feature-grid"><Link className="account-feature" to="/app/seri"><h2><Translated text="Ask Seri" /></h2><p>Check saved travel information and plan your next step.</p><strong>Open Seri →</strong></Link><Link className="account-feature" to="/app/orders"><h2><Translated text="Orders and payments" /></h2><p>Check payment confirmation and download your receipt.</p><strong>View orders →</strong></Link></div>
  </main>;
}
