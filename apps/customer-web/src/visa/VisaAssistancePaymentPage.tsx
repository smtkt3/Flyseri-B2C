import { Translated } from '../travel/language';
import { SavedVisaJourneyProgress } from './SavedVisaJourneyProgress';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OrderDetail, VisaAssistanceRequestDetail } from '@flyseri/types';
import { commerceService } from '../services/commerceService';
import { visaService } from '../services/visaService';
import { formatMoney } from '../account/presentation';
import { reviewCountry, reviewDate } from './VisaApplicantReview';
import './visa-application.css';

export function VisaAssistancePaymentPage() {
  const { requestId = '' } = useParams();
  const [request, setRequest] = useState<VisaAssistanceRequestDetail | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshVersion = useRef(0);
  const paid = order?.status === 'PAID' && order.payment?.status === 'SUCCEEDED' && !!order.paidAt;
  async function refresh() {
    const version = ++refreshVersion.current;
    const active = () => refreshVersion.current === version;
    setRefreshing(true); setError('');
    try {
      const saved = await visaService.assistanceDetail(requestId);
      if (!active()) return;
      setRequest(saved);
      if (saved.status !== 'NEW') { setOrder(null); setAvailable(false); return; }
      let current = await commerceService.createAssistanceOrder(requestId);
      if (!active()) return;
      setOrder(current);
      if (current.payment && ['PENDING', 'PROCESSING', 'UNKNOWN'].includes(current.payment.status)) {
        await commerceService.payment(current.payment.id);
        current = await commerceService.order(current.id);
        if (!active()) return;
        setOrder(current);
      }
      const capabilities = await commerceService.paymentCapabilities();
      if (active()) setAvailable(capabilities.checkoutAvailable);
    } catch (e) { if (active()) { setAvailable(false); setError(e instanceof Error ? e.message : 'Payment details could not load. Please try again.'); } }
    finally { if (active()) { setLoading(false); setRefreshing(false); } }
  }
  useEffect(() => {
    setRequest(null); setOrder(null); setAvailable(false); setConsent(false); setLoading(true);
    void refresh();
    return () => { refreshVersion.current++; };
  }, [requestId]);
  async function pay() {
    if (!order || busy || refreshing || paid) return;
    setBusy(true); setError('');
    try {
      const checkout = await commerceService.startPayment(order.id, crypto.randomUUID());
      if (checkout.redirectUrl) window.location.assign(checkout.redirectUrl);
      else await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Checkout could not start. Refresh payment status before retrying.'); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!paid || !consent || busy || refreshing) return;
    setBusy(true); setError('');
    try { setRequest(await visaService.assistanceSubmit(requestId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Submission failed. Your payment and saved information remain available.'); }
    finally { setBusy(false); }
  }
  return <main className="account-page visa-page visa-assistance-page visa-document-page">
    <Link className="visa-back-link" to={'/app/visa/assistance/' + requestId + '/documents?step=review'}>← Application details</Link>
    <header className="account-panel visa-assistance-intro"><p className="account-eyebrow">SECURE VISA CHECKOUT</p><h1>{request?.status !== 'NEW' && request ? 'Application submitted' : 'Payment & submission'}</h1><p>Complete payment for Flyseri’s assisted visa service, then submit your application to our team.</p></header>
    <SavedVisaJourneyProgress requestId={requestId} current="payment" complete={!!request && request.status !== "NEW"} disabled={loading || busy || refreshing} />
    {loading && <div className="account-panel" role="status">Loading payment details…</div>}
    {error && <div className="account-panel" role="alert">{error} <button disabled={busy || refreshing} onClick={() => void refresh()}><Translated text="Try again" /></button></div>}
    {request && <div className="visa-assistance-layout"><section>
      {request.status !== 'NEW' ? <div className="account-panel visa-assistance-success"><span className="visa-assistance-success-mark">✓</span><h2>{request.requestReference}</h2><p>Your request is with Flyseri for review. A submitted request does not mean a visa has been granted or filed with an authority.</p><Link to="/app/visa">Back to visa planning →</Link></div> : <>
        <section className="account-panel visa-upload-applicant"><p className="account-eyebrow">PAYMENT DETAILS</p><h2>{paid ? 'Payment confirmed' : 'Your service fee'}</h2>{order ? <>{order.items.map(item => <div className="commerce-line" key={item.id}><span>{item.description}{item.quantity > 1 ? ` · ${item.quantity} applicants` : ''}</span><strong>{formatMoney(item.totalAmount, item.currency)}</strong></div>)}<div className="commerce-line commerce-total"><strong>Total</strong><strong>{formatMoney(order.totalAmount, order.currency)}</strong></div><p>{paid ? 'Your payment has been verified. You can now submit your application.' : 'Your application stays saved until payment is verified and you submit it.'}</p><p className="visa-upload-notice">Stripe sandbox checkout uses test payments. No real funds are collected in this environment.</p>{!paid && <><button className="btn-primary account-submit" disabled={busy || refreshing || !available || !['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status) || (!!order.payment && order.payment.status !== 'FAILED')} onClick={() => void pay()}>{busy ? 'Opening checkout…' : 'Pay with Stripe test checkout →'}</button><button className="account-outline-button" disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? 'Checking payment…' : 'Refresh payment status'}</button>{order.payment && ['PENDING', 'PROCESSING', 'UNKNOWN'].includes(order.payment.status) && <p role="status">Payment confirmation is pending. Refresh to check it before trying again.</p>}{!available && <p role="status">Secure payment is temporarily unavailable.</p>}</>}</> : <p>Payment details are not available yet. Your information is saved. Please retry or contact Flyseri with your application reference.</p>}</section>
        <section className="account-panel visa-review-declaration"><h2>Submit your application</h2><p>Payment confirmation is required before your request can be submitted to Flyseri.</p><label className="visa-assistance-confirm"><input type="checkbox" disabled={busy || refreshing} checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I confirm the applicant details and documents are accurate and authorize Flyseri to review and assist with my visa request.</span></label><button className="btn-primary account-submit" disabled={!paid || !consent || busy || refreshing} onClick={() => void submit()}>{busy ? 'Please wait…' : 'Submit paid application →'}</button></section>
      </>}
    </section><aside className="account-panel visa-document-sidebar"><p className="account-eyebrow">YOUR APPLICATION</p><h2>{request.requestReference}</h2><p>{reviewCountry(request.destinationCountryCode)} · {request.purpose}</p><p>Travel: {reviewDate(request.expectedTravelDate)}</p><div className="visa-doc-summary-stats"><div><strong>{request.applicants.length}</strong><span>Applicants</span></div><div><strong>{request.documents.length}</strong><span>Documents</span></div></div><div className="visa-doc-advisor-note"><strong>{request.status !== 'NEW' ? 'Submitted to Flyseri' : paid ? 'Payment verified' : 'Payment required'}</strong><p>Flyseri submission is separate from an embassy application. Visa decisions remain with the relevant authority.</p></div></aside></div>}
  </main>;
}
