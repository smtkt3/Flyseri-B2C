import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OrderSummary, PaymentSummary, VisaApplicationSummary } from '@flyseri/types';
import { formatMoney, orderStatus, paymentStatus, visaStatus } from '../account/presentation';
import { commerceService } from '../services/commerceService';
import { visaService } from '../services/visaService';

export function TripActivityPanel({ tripId }: { tripId: string }) {
  const [visas, setVisas] = useState<VisaApplicationSummary[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setUnavailable([]); setVisas([]); setOrders([]); setPayments([]);
    void (async () => {
      const [visaResult, orderResult, paymentResult] = await Promise.allSettled([visaService.list(tripId), commerceService.orders(), commerceService.payments()]);
      if (!active) return;
      const failed: string[] = [];
      if (visaResult.status === 'fulfilled') setVisas(visaResult.value); else failed.push('visa');
      if (orderResult.status === 'fulfilled') setOrders(orderResult.value.filter((order) => order.tripId === tripId)); else failed.push('orders');
      if (paymentResult.status === 'fulfilled') setPayments(paymentResult.value); else failed.push('payments');
      setUnavailable(failed); setLoading(false);
    })();
    return () => { active = false; };
  }, [tripId, attempt]);

  const relevantOrders = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const orderIds = new Set(relevantOrders.map((order) => order.id));
  const recentPayment = [...payments].filter((payment) => orderIds.has(payment.orderId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return <section className="trip-activity-grid" aria-label="Trip services">
    <div className="account-panel trip-activity-card"><p className="account-eyebrow">VISA & DOCUMENTS</p><h2>Travel requirements</h2>
      {loading ? <p role="status">Loading visa plans…</p> : unavailable.includes('visa') ? <p>Visa details are unavailable right now.</p> : visas.length ? <div className="trip-activity-list">{visas.slice(0, 2).map((visa) => <Link key={visa.id} to={`/app/visa-applications/${visa.id}`}><span><strong>{visa.visaTypeName}</strong><small>{visaStatus(visa.status)} · {visa.requiredCompleted}/{visa.requiredTotal} required items complete</small></span><b aria-hidden="true">→</b></Link>)}</div> : <p>No visa applications for this trip yet.</p>}
      <Link className="trip-text-button" to={`/app/trips/${tripId}/visa`}>Open visa planning →</Link><Link className="trip-text-button" to="/app/documents">My Documents →</Link>
    </div>
    <div className="account-panel trip-activity-card"><p className="account-eyebrow">ORDERS & PAYMENTS</p><h2>Purchase activity</h2>
      {loading ? <p role="status">Loading orders…</p> : unavailable.includes('orders') ? <p>Orders are unavailable right now.</p> : relevantOrders.length ? <div className="trip-activity-list">{relevantOrders.slice(0, 2).map((order) => <Link key={order.id} to={`/app/orders/${order.id}`}><span><strong>{order.orderNumber}</strong><small>{orderStatus(order.status)} · {formatMoney(order.totalAmount, order.currency)}</small></span><b aria-hidden="true">→</b></Link>)}</div> : <p>No orders for this trip yet. A selected flight is not a reservation.</p>}
      {!loading && recentPayment && <p className="trip-activity-payment">Latest payment: <strong>{paymentStatus(recentPayment.status)}</strong></p>}
      <Link className="trip-text-button" to="/app/orders">All orders →</Link>
      {unavailable.length > 0 && <button className="trip-text-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry unavailable details</button>}
    </div>
  </section>;
}
