import { CheckoutPageHeader } from './CheckoutPageHeader';
import './checkout-step-style.css';
import { ApiClientError } from '../lib/api/client';
import { Translated } from '../travel/language';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { commerceService } from '../services/commerceService';
import { BookingProgress } from './BookingProgress';
import { BookingLoading } from './BookingLoading';
import { FlightAncillaryPurchasePanel } from './FlightAncillaryPurchasePanel';
import { FlightSelectedExtras } from './FlightSelectedExtras';

/** The reservation is created before payment, but it is not a separate buyer step. */
export function FlightPaymentPreparation({ booking: initial }: { booking: FlightBooking }) {
  const navigate = useNavigate();
  const [booking, setBooking] = useState(initial);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const task = useRef<Promise<{ booking: FlightBooking; orderId?: string }> | null>(null);
  const sending = useRef(false);
  async function verifiedCheckout(value: FlightBooking) {
    try { return await flightService.refreshCheckout(value.id); }
    catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'CONFLICT') {
        navigate('/app/bookings/' + value.id, { replace:true, state:{checkoutBlocked: cause.message} });
      }
      throw cause;
    }
  }
  async function prepare(value: FlightBooking, automaticallyConfirm: boolean, refresh = true) {
    if (value.order) return { booking: value, orderId: value.order.id };
    if (refresh) value = await verifiedCheckout(value);
    let purchase = value.ancillaryPurchase;
    if (value.ancillaryRequests?.length && !purchase) purchase = await flightService.reviewExtras(value.id);
    // Only the exact selected airline prices may be accepted automatically.
    // Changed prices, unavailable services and uncertain additions need a buyer decision.
    if (automaticallyConfirm && purchase?.status === 'PREPARED' && purchase.items.length === value.ancillaryRequests?.length && purchase.items.every(item => {
      const selected = value.ancillaryRequests?.find(extra => extra.id === item.requestId);
      return selected?.amount != null && selected.currency === item.airlineCurrency && Number(selected.amount) === Number(item.airlineAmount);
    })) purchase = await flightService.confirmExtras(value.id, purchase.id);
    const updated = { ...value, ancillaryPurchase: purchase };
    if (!value.ancillaryRequests?.length || purchase && ['CONFIRMED', 'SKIPPED'].includes(purchase.status)) {
      const order = await commerceService.createFlightOrder(value.bookingIntentId);
      return { booking: updated, orderId: order.id };
    }
    return { booking: updated };
  }
  useEffect(() => {
    let active = true;
    task.current ??= prepare(initial, true);
    void task.current.then(result => {
      if (!active) return;
      setBooking(result.booking);
      if (result.orderId) navigate('/app/orders/' + result.orderId, { replace: true });
    }, async () => {
      if (active) setError('We could not finish preparing payment. Your selection is saved. Check it below before continuing.');
      try { const saved = await flightService.booking(initial.id); if (active) setBooking(saved); } catch { /* Do not repeat an uncertain airline addition. */ }
    })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // Keep a single preparation promise across effect replays; never repeat an airline addition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);
  async function continueCheckout(action: 'confirm' | 'skip' | 'retry' | 'reconcile') {
    if (sending.current || busy) return;
    sending.current = true; setBusy(true); setError('');
    try {
      let current = await flightService.booking(booking.id);
      if (current.order) { navigate('/app/orders/' + current.order.id, {replace:true}); return; }
      current = await verifiedCheckout(current);
      if (action === 'confirm' && current.ancillaryPurchase) current = { ...current, ancillaryPurchase: await flightService.confirmExtras(current.id, current.ancillaryPurchase.id) };
      if (action === 'skip') current = { ...current, ancillaryPurchase: await flightService.skipExtras(current.id) };
      if (action === 'reconcile') current = { ...current, ancillaryPurchase: await flightService.reconcileExtras(current.id) };
      if (action === 'retry' && ['PREPARED', 'UNAVAILABLE'].includes(current.ancillaryPurchase?.status ?? '')) current = { ...current, ancillaryPurchase: await flightService.reviewExtras(current.id, true) };
      const result = await prepare(current, false, false);
      setBooking(result.booking);
      if (result.orderId) navigate('/app/orders/' + result.orderId, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be prepared. Please try again.');
      try { setBooking(await flightService.booking(booking.id)); } catch { /* Preserve the error and saved selection. */ }
    } finally { sending.current = false; setBusy(false); }
  }
  const status = booking.ancillaryPurchase?.status;
  return <div className="account-page flight-page checkout-step-page"><CheckoutPageHeader title={busy ? 'Preparing your payment' : 'Review your extras'} description="Review your selected services before secure payment."/><BookingProgress current={3} />
    {busy && <BookingLoading label="Checking your selection and preparing the total…" />}
    {error && <p className="account-error" role="alert">{error}</p>}
    {!busy && <section className="account-panel flight-intent-card"><p>{status === 'UNAVAILABLE' ? 'These extras could not be added. You can continue with your flight only, or contact us for help.' : 'Review the latest total before continuing to payment.'}</p>
      <FlightAncillaryPurchasePanel booking={booking} readOnly />
      {(!booking.ancillaryPurchase?.items.length && status !== 'SKIPPED') && <FlightSelectedExtras requests={booking.ancillaryRequests ?? []} airfare={{ amount: booking.amount, currency: booking.currency }} />}
      <div className="flight-intent-actions">
        {status && ['PREPARED', 'PRICE_CHANGED'].includes(status) && <button className="btn-primary" onClick={() => void continueCheckout('confirm')}>Accept total &amp; continue to payment</button>}
        {status && ['ADDING', 'UNKNOWN'].includes(status) ? <button className="btn-primary" onClick={() => void continueCheckout('reconcile')}>Check selected extras</button> : <>
          {(!status || ['PREPARED', 'UNAVAILABLE'].includes(status)) && !!booking.ancillaryRequests?.length && <button className="account-outline-button" onClick={() => void continueCheckout('skip')}>Continue without extras</button>}
          <button className="account-outline-button" onClick={() => void continueCheckout('retry')}><Translated text="Try again" /></button>
        </>}
      </div><Link className="account-link" to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>Contact Flyseri</Link>
    </section>}
  </div>;
}
