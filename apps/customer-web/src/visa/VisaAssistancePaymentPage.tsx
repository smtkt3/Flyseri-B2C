import { CouponCheckout } from '../commerce/CouponCheckout';
import { PaymentMethodsPanel } from '../components/PaymentMethodsPanel';
import { checkoutPrice } from '../components/checkoutPrice';
import { Translated } from '../travel/language';
import { SavedVisaJourneyProgress } from './SavedVisaJourneyProgress';
import { VisaFlowHeader } from './VisaFlowLayout';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OrderDetail, VisaAssistanceRequestDetail } from '@flyseri/types';
import { commerceService } from '../services/commerceService';
import { visaService } from '../services/visaService';
import { formatMoney } from '../account/presentation';
import { reviewCountry, reviewDate } from './VisaApplicantReview';
import './visa-application.css';
import { CheckoutActionBar } from '../components/CheckoutActionBar';

export function VisaAssistancePaymentPage() {
  const { requestId = '' } = useParams();
  const [request, setRequest] = useState<VisaAssistanceRequestDetail | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [updatingCoupon,setUpdatingCoupon]=useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshVersion = useRef(0);
  const operation=useRef(false);
  const paymentAttempt=useRef<{orderId:string;failedPaymentId:string;key:string}|null>(null);
  const paid = order?.status === 'PAID' && order.payment?.status === 'SUCCEEDED' && !!order.paidAt;
  const travelExpired=Boolean(request&&request.expectedTravelDate<new Date().toISOString().slice(0,10));
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
      if(current.status==='PAID'&&current.payment?.status==='SUCCEEDED'&&current.paidAt){setAvailable(false);return;}
      if(saved.expectedTravelDate<new Date().toISOString().slice(0,10))throw new Error('Your planned travel date has passed. Start a new application with your current travel plans before payment.');
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
    if (!order || operation.current || busy || refreshing || updatingCoupon || paid || !available || !checkoutPrice(order.totalAmount,order.currency) || !['PENDING_PAYMENT','PAYMENT_FAILED'].includes(order.status) || (order.payment&&order.payment.status!=='FAILED')) return;
    operation.current=true; setBusy(true); setError('');
    try {
      const failedPaymentId=order.payment?.status==='FAILED'?order.payment.id:'';
      if(paymentAttempt.current?.orderId!==order.id||paymentAttempt.current.failedPaymentId!==failedPaymentId)paymentAttempt.current={orderId:order.id,failedPaymentId,key:crypto.randomUUID()};
      const checkout = await commerceService.startPayment(order.id, paymentAttempt.current.key);
      if (checkout.redirectUrl) window.location.assign(checkout.redirectUrl);
      else await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Checkout could not start. Refresh payment status before retrying.'); }
    finally { operation.current=false; setBusy(false); }
  }
  async function submit() {
    if (!paid || !consent || operation.current || busy || refreshing) return;
    operation.current=true; setBusy(true); setError('');
    try { setRequest(await visaService.assistanceSubmit(requestId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Submission failed. Your payment and saved information remain available.'); }
    finally { operation.current=false; setBusy(false); }
  }
  return <main className="account-page visa-page visa-assistance-page visa-document-page">
    <VisaFlowHeader title={request?.status !== 'NEW' && request ? 'Application submitted' : 'Payment & submission'} description={request&&request.status!=='NEW' ? `Reference ${request.requestReference} · Follow progress in My applications.` : paid ? 'Payment verified. Confirm below to submit your application to Flyseri.' : 'Review the service fee before opening secure checkout.'} back={<Link to={'/app/visa/assistance/' + requestId + '/documents?step=review'} onClick={event=>{if(busy||refreshing)event.preventDefault();}}>← Application details</Link>}/>
    <SavedVisaJourneyProgress requestId={requestId} current="payment" complete={!!request && request.status !== "NEW"} disabled={loading || busy || refreshing} />
    {!loading && available && !paid && request?.status==='NEW' && <PaymentMethodsPanel/>}
    {loading && <div className="account-panel visa-flow-loading" role="status">Loading payment details…</div>}
    {error && <div className="account-panel" role="alert">{error} {travelExpired&&!paid ? <Link className="account-link" to={'/app/visa/new?'+new URLSearchParams({country:request?.destinationCountryCode||'MY',purpose:request?.purpose||'Tourism'}).toString()}>Start a new application →</Link> : <button disabled={busy || refreshing} onClick={() => void refresh()}><Translated text="Try again" /></button>}</div>}
    {request && <div className="visa-assistance-layout"><section>
      {request.status !== 'NEW' ? <div className="account-panel visa-assistance-success"><span className="visa-assistance-success-mark">✓</span><h2>{request.requestReference}</h2><p>Your request is with Flyseri for review. A submitted request does not mean a visa has been granted or filed with an authority.</p><Link to="/app/visa">Back to visa planning →</Link></div> : <>
        <section className="account-panel visa-upload-applicant"><p className="account-eyebrow">PAYMENT DETAILS</p><h2>{paid ? 'Payment confirmed' : 'Your service fee'}</h2>{order ? <>{order.items.map(item => <div className="commerce-line" key={item.id}><span>{item.description}{item.quantity > 1 ? ` · ${item.quantity} applicants` : ''}</span><strong>{formatMoney(item.totalAmount, item.currency)}</strong></div>)}{Number(order.discountAmount)>0&&<div className="commerce-line"><span>Discounts applied</span><strong>−{formatMoney(order.discountAmount!,order.currency)}</strong></div>}<div className="commerce-line commerce-total"><strong>Total</strong><strong>{formatMoney(order.totalAmount, order.currency)}</strong></div><p>{paid ? 'Your payment has been verified. You can now submit your application.' : 'Your application stays saved until payment is verified and you submit it.'}</p><p className="visa-upload-notice">Test checkout only. No real payment is collected.</p>{!paid && <><CouponCheckout key={order.id} order={order} locked={busy||refreshing||!!order.payment} onChanged={refresh} onBusy={setUpdatingCoupon}/><CheckoutActionBar label="Visa payment" caption="Service fee total" total={formatMoney(order.totalAmount, order.currency)}><button className="btn-primary account-submit" disabled={busy || refreshing || updatingCoupon || !checkoutPrice(order.totalAmount,order.currency) || !available || !['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status) || (!!order.payment && order.payment.status !== 'FAILED')} onClick={() => void pay()}>{busy ? 'Opening checkout…' : 'Continue to test checkout →'}</button></CheckoutActionBar><button className="account-outline-button" disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? 'Checking payment…' : 'Refresh payment status'}</button>{order.payment && ['PENDING', 'PROCESSING', 'UNKNOWN'].includes(order.payment.status) && <p role="status">Payment confirmation is pending. Refresh to check it before trying again.</p>}{!available && <p role="status">Secure payment is temporarily unavailable.</p>}</>}</> : <p>Payment details are not available yet. Your information is saved. Please retry or contact Flyseri with your application reference.</p>}</section>
        <section className="account-panel visa-review-declaration"><h2>Submit your application</h2><p>Payment confirmation is required before your request can be submitted to Flyseri.</p><label className="visa-assistance-confirm"><input type="checkbox" disabled={busy || refreshing} checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I confirm the applicant details and documents are accurate and authorize Flyseri to review and assist with my visa request.</span></label>{paid && <CheckoutActionBar label="Submit paid visa application" caption="Payment confirmed" total={order ? formatMoney(order.totalAmount,order.currency) : "Awaiting total"}><button className="btn-primary account-submit" disabled={!paid || !consent || busy || refreshing} onClick={() => void submit()}>{busy ? 'Please wait…' : 'Submit paid application →'}</button></CheckoutActionBar>}</section>
      </>}
    </section><aside className="account-panel visa-document-sidebar"><p className="account-eyebrow">YOUR APPLICATION</p><h2>{request.requestReference}</h2><p>{reviewCountry(request.destinationCountryCode)} · {request.purpose}</p><p>Travel: {reviewDate(request.expectedTravelDate)}</p><div className="visa-doc-summary-stats"><div><strong>{request.applicants.length}</strong><span>Applicants</span></div><div><strong>{request.documents.length}</strong><span>Documents</span></div></div><div className="visa-doc-advisor-note"><strong>{request.status !== 'NEW' ? 'Submitted to Flyseri' : paid ? 'Payment verified' : 'Payment required'}</strong><p>Flyseri submission is separate from an embassy application. Visa decisions remain with the relevant authority.</p></div></aside></div>}
    {(!request || (request.status==='NEW'&&!order)) && <CheckoutActionBar label="Visa payment" caption="Service fee total" total={loading ? 'Loading price…' : 'Price unavailable'}><button type="button" className="btn-primary account-submit" disabled>{loading ? 'Loading payment…' : 'Continue to payment'}</button></CheckoutActionBar>}
  </main>;
}
