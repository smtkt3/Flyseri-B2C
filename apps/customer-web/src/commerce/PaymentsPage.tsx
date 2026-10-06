import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PaymentSummary } from '@flyseri/types';
import { commerceService } from '../services/commerceService';
import { formatMoney, formatTimestamp, paymentStatus } from '../account/presentation';
import '../flight/booking-checkout.css';

export function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setError(false); void commerceService.payments().then((rows) => { if (active) setPayments(rows); },
    () => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [attempt]);
  return <div className="account-page"><p className="account-eyebrow">ACCOUNT ACTIVITY</p><h1>Payments</h1>
    <p className="account-muted">Only confirmed payments appear as paid. Flight selections and unpaid orders are shown in My Orders.</p>
    {loading && <div className="account-panel" role="status">Loading payments…</div>}
    {!loading && error && <div className="account-panel" role="alert">We couldn't load your payments. <button className="account-link" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && !payments.length && <div className="account-panel"><h2>No payments yet</h2>
      <p>Your payment history will appear here after checkout starts. Open an order to continue Stripe sandbox payment or check its latest status.</p><div className="checkout-actions"><Link className="account-outline-button" to="/app/orders">View my orders →</Link></div></div>}
    {!loading && !error && payments.map((payment) => <Link className="account-panel commerce-order-link" key={payment.id} to={`/app/orders/${payment.orderId}`}>
      <div><strong>{paymentStatus(payment.status)}</strong><p>{formatTimestamp(payment.createdAt)}{payment.provider === 'STRIPE_TEST' ? ' · Stripe sandbox' : ''}</p><small>{payment.status === 'SUCCEEDED' ? 'View order and receipt' : ['PENDING','PROCESSING','UNKNOWN'].includes(payment.status) ? 'Open order to check or resume checkout' : 'View order details'}</small></div>
      <strong>{formatMoney(payment.amount, payment.currency)}</strong><span aria-hidden="true">→</span></Link>)}
  </div>;
}
