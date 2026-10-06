import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OrderSummary } from '@flyseri/types';
import { commerceService } from '../services/commerceService';
import { formatMoney, formatTimestamp, orderStatus } from '../account/presentation';
import '../flight/booking-checkout.css';

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'UNPAID' | 'PAID'>('ALL');
  const visible = orders.filter(order => filter === 'ALL' || (filter === 'PAID' ? order.status === 'PAID' : order.status !== 'PAID'));
  useEffect(() => { let active = true; setLoading(true); setError(false); void commerceService.orders().then((rows) => { if (active) setOrders(rows); },
    () => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [attempt]);
  return <div className="account-page"><p className="account-eyebrow">YOUR JOURNEY</p><h1>My Orders</h1>
    <p className="account-muted">Continue checkout, review payment status and access your receipts in one place.</p>
    {loading && <div className="account-panel" role="status">Loading your orders…</div>}
    {!loading && error && <div className="account-panel" role="alert">We couldn't load your orders. <button className="account-link" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && <><div className="checkout-history-stats" aria-label="Order counts"><div><strong>{orders.length}</strong><span>Total orders</span></div><div><strong>{orders.filter(order => order.status === 'PAID').length}</strong><span>Payment confirmed</span></div><div><strong>{orders.filter(order => ['PENDING_PAYMENT','PAYMENT_PROCESSING','PAYMENT_FAILED'].includes(order.status)).length}</strong><span>Awaiting payment</span></div></div>
    {!orders.length ? <section className="account-panel checkout-empty"><span className="checkout-empty-icon" aria-hidden="true">✈</span><p className="account-eyebrow">YOUR NEXT JOURNEY STARTS HERE</p><h2>Your orders will appear here</h2><p>Choose a flight, complete traveler details and confirm a test reservation. You can then review the order and pay through Stripe sandbox.</p><div className="checkout-actions"><Link className="btn-primary" to="/app/flights">Find a flight →</Link><Link className="account-outline-button" to="/app/bookings">View my reservations</Link></div><small>Already reserved a flight? Open its reservation and select “Continue to secure payment”.</small></section> : <><div className="checkout-history-filter" role="group" aria-label="Filter orders">{([['ALL','All orders'],['UNPAID','Unpaid'],['PAID','Paid']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {!visible.length && <p role="status" className="account-panel">No orders match this filter.</p>}
    {visible.map((order) => <Link className="account-panel commerce-order-link" key={order.id} to={`/app/orders/${order.id}`}>
      <div><strong>{order.orderNumber}</strong><p>{formatTimestamp(order.createdAt)} · {orderStatus(order.status)}</p></div>
      <strong>{formatMoney(order.totalAmount, order.currency)}</strong><span aria-hidden="true">→</span></Link>)}</>}
      <div className="checkout-trial-note"><div><strong>Test reservations and sandbox payments</strong>Payment confirmation and airline ticket issuance are separate. Ticket issuance is skipped for this trial.</div></div></>}
  </div>;
}
