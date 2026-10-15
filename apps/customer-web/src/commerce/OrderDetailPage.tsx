import { CouponCheckout } from './CouponCheckout';
import { PaymentMethodsPanel } from '../components/PaymentMethodsPanel';
import { useBookingEvidencePoll } from '../flight/useBookingEvidencePoll';
import { FlightTicketIssuanceNotice } from '../flight/FlightTicketIssuanceNotice';
import { CheckoutActionBar } from '../components/CheckoutActionBar';
import { checkoutPrice } from '../components/checkoutPrice';
import { CheckoutHelpPanel } from '../components/CheckoutHelpPanel';
import { bookingHasIssuedTickets, bookingOutcome } from '../flight/bookingPresentation';
import { CheckoutPageHeader } from '../flight/CheckoutPageHeader';
import '../flight/checkout-step-style.css';
import { Translated } from '../travel/language';
import { FlightAncillaryPurchasePanel } from '../flight/FlightAncillaryPurchasePanel';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { FlightBooking, OrderDetail, OrderReceipt } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { serviceRequestSummary } from '../flight/FlightServiceRequests';
import { FlightBaggageDetails, FlightServiceDetails } from '../flight/FlightFareInformation';
import { commerceService } from '../services/commerceService';
import { downloadText } from '../lib/downloadText';
import { formatMoney, formatTimestamp, orderStatus, paymentStatus } from '../account/presentation';
import { TravelCompanion } from '../travel/TravelCompanion';
import { BookingProgress } from '../flight/BookingProgress';
import { BookingPnr } from '../flight/BookingPnr';
import { BookingLoading } from '../flight/BookingLoading';
import { usePreferredDisplayPrices } from '../flight/usePreferredDisplayPrices';
import { clearPaymentAttempt, keepPaymentAttempt, readPaymentAttempt } from './paymentRecovery';
import { PointsCheckout } from '../rewards/PointsCheckout';

export function OrderDetailPage() {
  const { orderId } = useParams();
  const activeOrderId = useRef(orderId);
  activeOrderId.current = orderId;
  const [query] = useSearchParams();
  const sending = useRef(false);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [booking, setBooking] = useState<FlightBooking | null>(null);
  const [servicesUnavailable, setServicesUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [checkoutAvailable, setCheckoutAvailable] = useState(false);
  const [ticketingAvailable, setTicketingAvailable] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  const [updatingPoints,setUpdatingPoints]=useState(false);
  const [updatingCoupon,setUpdatingCoupon]=useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [needsPaymentCheck, setNeedsPaymentCheck] = useState(() => !!orderId && !!readPaymentAttempt(orderId)?.uncertain);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const paid = order?.status === 'PAID' && order.payment?.status === 'SUCCEEDED' && !!order.paidAt && Number.isFinite(Date.parse(order.paidAt));
  const display = usePreferredDisplayPrices([
    {amount:order?.totalAmount ?? null,currency:order?.currency ?? 'MYR'},
    ...(order?.items ?? []).map(item=>({amount:item.totalAmount,currency:item.currency})),
  ]);
  const displayPrice = (index: number) => {const value=display.prices[index];return value?.amount != null ? `${value.estimated ? '≈ ' : ''}${formatMoney(value.amount,display.currency)}` : display.failed ? 'Conversion unavailable' : `Updating ${display.currency}…`;};
  const expired = !!order?.expiresAt && Date.parse(order.expiresAt) <= now && !paid;
  const mustCheckPayment = !paid && (needsPaymentCheck || ['UNKNOWN','CREATED'].includes(order?.payment?.status ?? ''));
  const pending = !!order?.payment && ['PENDING', 'PROCESSING', 'UNKNOWN', 'CREATED'].includes(order.payment.status);
  const resultReached = !!order && (paid || pending || mustCheckPayment || ['PAYMENT_FAILED','CANCELLED','EXPIRED'].includes(order.status));
  const outcome = !order ? undefined : ['PAYMENT_FAILED','CANCELLED','EXPIRED'].includes(order.status) ? 'unsuccessful' as const : paid && booking ? bookingOutcome(booking) : 'pending' as const;
  const checkoutTotal = checkoutPrice(order?.totalAmount,order?.currency);
  const canPay = !!checkoutTotal && !!order && order.id === orderId && checkoutAvailable && !error && !mustCheckPayment && !expired && ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_PROCESSING'].includes(order.status)
    && (!order.payment || ['FAILED','PENDING','PROCESSING'].includes(order.payment.status));
  useEffect(() => {
    let active = true; setBooking(null); setServicesUnavailable(false);
    setTicketingAvailable(false);
    if (order?.flightBookingId) void flightService.bookingCapabilities().then(value=>{if(active)setTicketingAvailable(value.ticketIssuanceAvailable);},()=>undefined);
    if (order?.flightBookingId) void flightService.booking(order.flightBookingId).then(value => { if (active) setBooking(value); }, () => { if (active) setServicesUnavailable(true); });
    return () => { active = false; };
  }, [order?.flightBookingId, paid]);
  useBookingEvidencePoll(booking,!!paid && order?.id === orderId && booking?.id === order?.flightBookingId,setBooking);
  async function loadOrder(id: string): Promise<OrderDetail> {
    const current = await commerceService.order(id);
    if (!current.payment || !['PENDING', 'PROCESSING', 'UNKNOWN'].includes(current.payment.status)) return current;
    try { await commerceService.payment(current.payment.id); return await commerceService.order(id); }
    catch { return current; }
  }
  useEffect(() => { if (!orderId) return; let active = true; setNeedsPaymentCheck(!!readPaymentAttempt(orderId)?.uncertain); setCheckoutAvailable(false); setStartingPayment(false); setUpdatingPoints(false); setUpdatingCoupon(false); setRefreshing(false); setLoading(true); setOrder(null); setReceipt(null); setError(false); setPaymentNotice(''); setPaymentConfirmed(false); void loadOrder(orderId).then((value) => {
    if (active) setOrder(value); }, () => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    void commerceService.paymentCapabilities().then((value) => { if (active) setCheckoutAvailable(value.checkoutAvailable); }, () => {});
    return () => { active = false; }; }, [orderId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!orderId || !pending) return;
    let active = true, running = false, attempts = 0;
    const timer = window.setInterval(() => {
      if (!active || running || document.visibilityState !== 'visible') return;
      if (++attempts > 12) { window.clearInterval(timer); return; }
      running = true;
      void loadOrder(orderId).then(value => { if (active) setOrder(value); }, () => undefined).finally(() => { running = false; });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [orderId, pending]);
  async function refresh() { if (!orderId || refreshing) return; const id=orderId;setRefreshing(true); try { const value=await loadOrder(id);if(activeOrderId.current===id){setOrder(value);setError(false);setPaymentConfirmed(false);if(!value.payment||value.payment?.status==='FAILED'||['PAID','CANCELLED','EXPIRED'].includes(value.status))clearPaymentAttempt(id);if(!value.payment||!['UNKNOWN','CREATED'].includes(value.payment.status)){setNeedsPaymentCheck(false);if(readPaymentAttempt(id))keepPaymentAttempt(id,false);}} } catch { if(activeOrderId.current===id)setError(true); } finally { if(activeOrderId.current===id)setRefreshing(false); } }
  async function showReceipt() { if (!orderId) return; const id=orderId;try { const value=await commerceService.receipt(id);if(activeOrderId.current===id)setReceipt(value); } catch { if(activeOrderId.current===id)setPaymentNotice('The receipt could not be loaded. Check payment status and try again.'); } }
  async function beginPayment() {
    if (!orderId || sending.current || updatingPoints || updatingCoupon || !paymentConfirmed || !canPay) return;
    sending.current = true;
    const id=orderId;
    setStartingPayment(true); setPaymentNotice('');
    try {
      const attempt = keepPaymentAttempt(id, true);
      const result = await commerceService.startPayment(id, attempt.key);
      if (activeOrderId.current !== id) return;
      keepPaymentAttempt(id, false);
      if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
      setPaymentNotice(result.payment.status === 'SUCCEEDED' ? 'Payment verified. Your order is being updated.' : 'This checkout has no available payment link. Check the latest status before continuing.');
      await refresh();
    } catch (cause) { keepPaymentAttempt(id,true); if(activeOrderId.current===id){setNeedsPaymentCheck(true);setPaymentConfirmed(false);setPaymentNotice(cause instanceof Error ? cause.message : 'Checkout could not start. Check the order status before trying again.');} }
    finally { sending.current = false; if(activeOrderId.current===id)setStartingPayment(false); }
  }
  return <div className={`account-page checkout-step-page${canPay ? ' checkout-with-mobile-actions' : ''}`}>
    <CheckoutPageHeader introOnly={!resultReached} progress={order?.flightBookingId ? <BookingProgress current={3} outcome={resultReached ? outcome : undefined} paymentComplete={paid} /> : undefined} title={order?.flightBookingId && resultReached && outcome ? {confirmed:'Booking confirmed',pending:'Booking pending',unsuccessful:'Booking unsuccessful'}[outcome] : paid ? 'Payment confirmed' : 'Complete your payment'} back={<Link to="/app/orders">← My orders</Link>}/>
    {loading && <BookingLoading label="Loading your order…" heading="Complete your payment" description="Review your total and continue to secure checkout." />}
    {!loading && error && <div className="account-panel" role="alert">We couldn't refresh this order. <button className="account-link" onClick={() => { void refresh(); }}><Translated text="Retry" /></button></div>}
    {mustCheckPayment && <section className="checkout-recovery-card" role="status"><h2>Check your payment before continuing</h2><p>The checkout connection was interrupted. Your payment may still be processing. Check the latest status before trying again; don’t create another booking.</p><button type="button" className="account-outline-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing?'Checking payment…':'Check payment status'}</button><Link to="/help#payment-help">Payment help</Link></section>}
    {paid && booking && <TravelCompanion booking={booking} />}
    {order && <>
      <div className="checkout-trial-note"><span aria-hidden="true">◈</span><div><strong>Test checkout</strong>Use test payment details. No real payment is collected. Any issued test tickets are not valid for travel.</div></div>
      <div className="checkout-layout"><section className="account-panel">
      <div className={`checkout-status-card${paid ? ' is-paid' : expired || order.status === 'PAYMENT_FAILED' ? ' is-attention' : ''}`} role="status" aria-live="polite">
        <span className="checkout-status-caption"><i />{paid ? 'Payment verified' : expired ? 'Payment window closed' : mustCheckPayment ? 'Payment status needs checking' : pending ? 'Checkout in progress' : 'Secure checkout'}</span>
        <h2>{paid ? 'Payment confirmed' : expired ? 'This payment window has expired' : needsPaymentCheck ? 'Verify the latest payment result' : order.status === 'PAYMENT_FAILED' ? 'Payment was not completed' : pending ? 'Continue your payment' : 'Review and pay'}</h2>
        <p>{paid ? order.flightBookingId ? 'Your test reservation and payment are saved. View your booking reference and services below.' : 'Your test payment is recorded. Review the next step below.' : expired ? 'Payment is unavailable for this expired order. Contact Flyseri to review the reservation before creating another booking.' : mustCheckPayment ? 'Your last checkout did not return a confirmed result. Check payment status before attempting payment again.' : pending ? 'We’re checking your payment. You can resume an available checkout below. Please wait for confirmation before paying again.' : 'Check the order total and reservation details, then continue to secure checkout.'}</p>
        {query.get('checkout') === 'cancelled' && !paid && <p>You returned from checkout without completing it. Your reservation has not been cancelled.</p>}
        {query.get('checkout') === 'returned' && !paid && <p>Welcome back. We’re checking your payment. Please wait for confirmation before paying again.</p>}
      </div>
      <p>Status: <strong>{orderStatus(order.status)}</strong>{order.payment && <> · Payment: <strong>{paymentStatus(order.payment.status)}</strong></>}</p>
      {booking && resultReached && <BookingPnr pnr={booking.pnr} bookingId={booking.id}/>}
      {paid && booking && <FlightTicketIssuanceNotice booking={booking} paidAt={order.paidAt} ticketingAvailable={ticketingAvailable}/>}
      {paid && order.flightBookingId && <p><Link className="account-link" to={'/app/bookings/' + order.flightBookingId}>View reservation and ticket status →</Link></p>}
      {order.expiresAt && order.status !== 'PAID' && <p>Fare valid until {new Date(order.expiresAt).toLocaleString()}.</p>}
      {booking && <details className="checkout-services checkout-service-details"><summary>Flight details &amp; included services</summary><section aria-label="Meals, baggage and assistance">
        <FlightBaggageDetails offer={booking.selectedOffer} /><FlightServiceDetails offer={booking.selectedOffer} />
        {!!booking.serviceRequests?.length && <><h3>Service preferences</h3><ul>{booking.serviceRequests.map(request => <li key={request.travellerId}><strong>{request.passengerName}</strong>: {serviceRequestSummary(request)}</li>)}</ul>
          <p className="account-muted">Awaiting airline confirmation. These preferences are requests, not purchased services.</p></>}
      </section></details>}
      {servicesUnavailable && <p role="status">Your saved service requests could not be loaded. Open the reservation details to review them.</p>}
      {order.status === 'PAID' && order.payment?.status === 'SUCCEEDED' ? <><p>{order.visaAssistanceRequestId ? "Payment confirmed. Continue to submit your visa application to Flyseri." : "Payment confirmed. Fulfilment is handled separately."}</p>{order.visaAssistanceRequestId && <Link className="btn-primary account-submit" to={"/app/visa/assistance/" + order.visaAssistanceRequestId + "/payment"}>Continue to visa submission →</Link>}
        {order.fulfillmentStatus === 'REVALIDATION_REQUIRED' && <p role="status">This fare needs a fresh check before the flight can be booked. Please contact support with your order number.</p>}
        <button className="account-outline-button" type="button" onClick={() => { void showReceipt(); }}>View payment receipt</button></>
        : order.payment && ['PENDING', 'PROCESSING', 'UNKNOWN', 'CREATED'].includes(order.payment.status)
          ? <p role="status">Payment confirmation is pending. Check its status below{order.payment.status !== 'UNKNOWN' ? ' or resume an available checkout' : ''}. Please wait for payment confirmation before paying again.</p>
          : order.payment ? <p role="status">No payment has been confirmed for this order. If your bank shows a charge, contact support with your order number.</p>
            : checkoutAvailable ? <p>Your trip is ready for secure test payment. Ticket issuance starts after payment is verified.</p>
              : <p>Online payment is not available yet. Please contact Flyseri before making a payment.</p>}
      {!paid && <PaymentMethodsPanel/>}
      {!paid && <CouponCheckout key={order.id} order={order} locked={!!order.payment || expired || startingPayment || updatingPoints || refreshing || mustCheckPayment || !!readPaymentAttempt(order.id)} onChanged={refresh} onBusy={value=>{if(activeOrderId.current===order.id){setUpdatingCoupon(value);setPaymentConfirmed(false);}}}/>}
      {!paid && order.flightBookingId && <PointsCheckout orderId={order.id} locked={startingPayment || pending || paid || mustCheckPayment || updatingCoupon || !!order.coupon || !!order.payment || !!readPaymentAttempt(order.id)} onChanged={refresh} onBusy={value=>{if(activeOrderId.current===order.id){setUpdatingPoints(value);setPaymentConfirmed(false);}}}/>}
      {canPay && <><p className="checkout-charge-amount"><span>Payment total · {order.currency}</span><strong>{formatMoney(order.totalAmount, order.currency)}</strong></p><label className="checkout-confirmation"><input type="checkbox" checked={paymentConfirmed} onChange={event => setPaymentConfirmed(event.target.checked)} /><span>I reviewed the total{order.flightBookingId ? ' and traveler details' : ''}. I understand this is a test payment.</span></label></>}
      <div className="checkout-actions">
      {paymentNotice && <p role="status">{paymentNotice}</p>}
      {order.visaAssistanceRequestId && order.status !== "PAID" && <Link className="account-link" to={"/app/visa/assistance/" + order.visaAssistanceRequestId + "/payment"}>Back to visa payment →</Link>}{!mustCheckPayment&&<button className="account-outline-button" type="button" disabled={refreshing || startingPayment} onClick={() => { void refresh(); }}>{refreshing ? 'Checking payment…' : 'Check payment status'}</button>}</div>
      <CheckoutHelpPanel title={paid ? 'What happens next?' : 'Need help with this order?'}><p>{paid && order.flightBookingId ? 'You can view your reservation and download the payment receipt. Airline service requests remain pending until confirmed by the carrier.' : 'Keep your order number when contacting Flyseri. If payment is being checked, review its status before starting another booking.'}</p><Link className="checkout-help-link" to={order.flightBookingId ? `/app/support?bookingId=${encodeURIComponent(order.flightBookingId)}` : '/app/support'}>Contact Flyseri →</Link></CheckoutHelpPanel>
      {receipt && <div className="commerce-receipt" role="status"><h2>Payment receipt</h2><p>{receipt.orderNumber} · Paid {formatTimestamp(receipt.paidAt)}</p><p>{formatMoney(receipt.totalAmount, receipt.currency)}</p><small>Payment receipt, not a tax invoice.</small><p><button className="account-outline-button" type="button" onClick={() => downloadText(`Flyseri-receipt-${receipt.orderNumber.replace(/[^A-Za-z0-9-]/g, '')}.txt`, ['Flyseri payment receipt', receipt.orderNumber, `Paid: ${receipt.paidAt}`, ...receipt.items.map(item => `${item.description}: ${item.currency} ${item.totalAmount}`), ...(Number(receipt.discountAmount)>0 ? [`Discounts: -${receipt.currency} ${receipt.discountAmount}`] : []), `Total: ${receipt.currency} ${receipt.totalAmount}`, 'This payment receipt is not an airline ticket or a tax invoice.', order.payment?.provider === 'STRIPE_TEST' ? 'Test payment. No real payment collected.' : ''].join('\n'))}>Download receipt</button></p></div>}
    </section><aside className="account-panel checkout-summary" aria-label="Order summary"><p className="account-eyebrow">YOUR TRIP</p><h2>{paid ? 'Booking summary' : 'Payment summary'}</h2><dl><div><dt>Order</dt><dd>{order.orderNumber}</dd></div>{booking && <>{resultReached && <div><dt>Booking reference (PNR)</dt><dd className="checkout-reference">{booking.pnr ?? 'Awaiting airline confirmation'}</dd></div>}<div><dt>Travelers</dt><dd>{booking.passengerNames.length}</dd></div></>}</dl>
      {order.items.map((item,index) => <div className="commerce-line" key={item.id}><span>{item.description}</span><strong>{displayPrice(index+1)}</strong></div>)}{Number(order.discountAmount)>0&&<div className="commerce-line"><span>Discounts applied</span><strong>−{formatMoney(order.discountAmount!,order.currency)}</strong></div>}<div className="commerce-line commerce-total"><strong>{paid ? 'Paid' : 'Total'}</strong><strong>{displayPrice(0)}</strong></div><small>Includes the flights and extras listed above.</small>{display.prices[0]?.estimated && <small>Converted estimate. Payment is collected as {formatMoney(order.totalAmount,order.currency)}.</small>}
      {booking?.ancillaryPurchase && ['CONFIRMED','FULFILLMENT_PENDING','FULFILLED'].includes(booking.ancillaryPurchase.status) && <details className="checkout-service-details"><summary>Your selected extras</summary><FlightAncillaryPurchasePanel booking={booking} readOnly /></details>}
      {booking?.ancillaryRequests?.length && !['CONFIRMED','FULFILLMENT_PENDING','FULFILLED'].includes(booking.ancillaryPurchase?.status ?? '') && <CheckoutHelpPanel title="Extras not included"><p>Your selected extra requests were not purchased. No extra charge is included in this payment.</p><ul>{booking.ancillaryRequests.map(extra=><li key={extra.id}>{extra.name} · {extra.segmentLabels.join(' / ')}</li>)}</ul></CheckoutHelpPanel>}
      </aside></div></>}
    <CheckoutActionBar label="Continue payment" caption={paid ? 'Payment confirmed' : expired ? 'Order expired' : mustCheckPayment ? 'Check payment status above' : 'Payment total'} total={checkoutTotal ?? (loading ? 'Loading price…' : 'Price unavailable')}>
      <button type="button" className="btn-primary" disabled={!canPay || loading || refreshing || startingPayment || updatingPoints || updatingCoupon || !paymentConfirmed} onClick={() => void beginPayment()}>{loading ? 'Loading payment…' : startingPayment ? 'Opening secure checkout…' : paid ? 'Payment completed' : !canPay ? 'Payment unavailable' : pending ? 'Resume secure checkout →' : `Pay ${checkoutTotal} securely →`}</button>
    </CheckoutActionBar>
  </div>;
}
