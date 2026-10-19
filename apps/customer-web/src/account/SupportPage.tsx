import { CheckoutPageHeader } from '../flight/CheckoutPageHeader';
import { Translated } from '../travel/language';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { clearFlightHelp, readFlightHelp } from '../flight/FlightSupportLink';
import { SupportTracker } from '../travel/SupportTracker';
import { seriService } from '../services/seriService';
import './support-page.css';

export function SupportPage() {
  const [params] = useSearchParams();
  const location=useLocation();
  const [flightContext,setFlightContext]=useState(()=>params.get('flightHelp')==='1'?readFlightHelp((location.state as {flightHelp?:unknown}|null)?.flightHelp):null);
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
  const contextSuffix=flightContext?`\nFlight context (shopping quote):\n${flightContext.text}`:'';
  const detailsLimit=Math.max(0,Math.min(900,1000-topic.length-2-contextSuffix.length));
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !details.trim()) return;
    if(details.trim().length>detailsLimit){setError('Please shorten your question so it fits with the attached flight details.');return;}
    sending.current = true; setBusy(true); setError('');
    try { setPrepared(await seriService.prepareSupport({ reason: `${topic}: ${details.trim()}${contextSuffix}`, bookingId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your request could not be prepared.'); }
    finally { sending.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!prepared || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { await seriService.confirm(prepared.conversationId, prepared.actionId); setSent(true); if(flightContext)clearFlightHelp(); }
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
    <div className="support-workspace"><div className="support-workspace-main"><section className="account-panel support-request-card"><div className="support-card-heading"><span className="support-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></svg></span><div><h2><Translated text="Request assistance" /></h2><p>Tell us what you need. Review your message before sending it to Flyseri.</p></div></div>
      <ol className="support-request-steps" aria-label="Support request steps">{['Describe','Review','Send'].map((label,index)=><li key={label} className={(sent?2:prepared?1:0)===index?'is-current':index<(sent?2:prepared?1:0)?'is-done':''} aria-current={(sent?2:prepared?1:0)===index?'step':undefined}><span aria-hidden="true">{index<(sent?2:prepared?1:0)?'✓':index+1}</span>{label}</li>)}</ol>
      {bookingId && <div className="support-booking-context"><span>Your booking is linked to this request.</span><Link className="account-link" to={'/app/bookings/' + encodeURIComponent(bookingId)}>View booking →</Link></div>}
      {!prepared && <form className="support-request-form" aria-busy={busy} onSubmit={event => void prepare(event)}><label><Translated text="What do you need?" /><select disabled={busy} value={topic} onChange={event => setTopic(event.target.value)}>{['Booking assistance', 'Special flight offer enquiry', 'Change flight', 'Cancel / refund review', 'Passenger correction', 'Seat request', 'Baggage / meal request', 'Payment assistance', 'Visa assistance'].map(item => <option key={item}>{item}</option>)}</select></label>
        {flightContext&&<section className="flight-support-context" aria-label="Attached flight details"><strong>Your selected flight</strong><p>{flightContext.text}</p><button type="button" disabled={busy} onClick={()=>{clearFlightHelp();setFlightContext(null);}}>Remove flight details</button><small>You can review the complete request before sharing it with our team.</small></section>}
        {params.get('flightHelp')==='1'&&!flightContext&&<p role="status">No flight details are attached. You can describe your flight below.</p>}
        <label><Translated text="Details" /><textarea required disabled={busy} maxLength={detailsLimit} aria-describedby="support-details-help support-character-count" value={details} onChange={event => setDetails(event.target.value.slice(0,detailsLimit))} placeholder={flightContext?'Your flight details are attached. How can we help?':'Describe what happened and how we can help.'} /></label>
        <p id="support-details-help" className="support-privacy-note">For your security, leave out card numbers, passwords and passport numbers.</p>
        {!detailsLimit && <p role="alert" className="account-error">The attached flight details are too long. Remove them to write your message.</p>}
        <div className="support-form-footer"><div><small id="support-character-count">{details.length} / {detailsLimit} characters</small>{!details.trim()&&<span>Add your details to continue.</span>}</div><button type="submit" className="btn-primary account-submit" disabled={busy || !details.trim() || details.trim().length>detailsLimit}>{busy ? 'Preparing request…' : 'Review request'}</button></div></form>}
      {prepared && !sent && <div className="support-prepared"><h3>Review before sending</h3><p className="support-review-summary">{prepared.summary}</p><p>This shares your message and account contact details with the Flyseri support team.</p><small>Send before {new Date(prepared.expiresAt).toLocaleString()}.</small>
        <div className="support-review-actions"><button className="btn-primary" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Please wait…' : 'Send support request'}</button><button className="account-outline-button" type="button" disabled={busy} onClick={() => void cancel()}>Back to edit</button></div></div>}
      {sent && prepared && <div className="support-sent" role="status"><span aria-hidden="true">✓</span><h3>Your request has been sent</h3><p>Follow your request and messages below. Our team will review your request before making any changes.</p><small>Reference: {prepared.conversationId}</small></div>}
      {prepared && <p><Link className="account-link" to={'/app/seri?conversation=' + encodeURIComponent(prepared.conversationId)}><Translated text="View support conversation →" /></Link></p>}
      {error && <p role="alert" className="account-error">{error}</p>}
      <p className="support-request-policy">We’ll confirm airline rules and any fees with you first. Sending a request does not change your booking or issue a refund.</p>
    </section><SupportTracker revision={sent ? 1 : 0} /></div>
    <aside className="support-sidebar" aria-label="More ways to get help"><section className="account-panel support-help-card"><h2>Quick help</h2><p>Manage your trip or find the information you need.</p><nav aria-label="Support shortcuts"><Link to={bookingId?'/app/bookings/'+encodeURIComponent(bookingId):'/app/bookings'}><span><strong>My bookings</strong><small>Itinerary, ticket status and booking details</small></span><span aria-hidden="true">→</span></Link><Link to="/app/orders"><span><strong>Payments &amp; receipts</strong><small>Payment status and PDF receipts</small></span><span aria-hidden="true">→</span></Link><Link to="/app/seri"><span><strong><Translated text="Ask Seri" /></strong><small>Help with your saved travel information</small></span><span aria-hidden="true">→</span></Link></nav></section><section className="account-panel support-help-card support-next-card"><h2>After you send</h2><p>Your request appears in the list on this page. Open the conversation to follow updates and reply to the team.</p><Link className="account-link" to="/app/seri">View conversations →</Link></section></aside></div>
  </main>;
}
