import './payment-methods-panel.css';

/** Informational categories; the hosted checkout confirms actual method eligibility. */
export function PaymentMethodsPanel() {
  return <section className="payment-methods-panel" aria-label="Payment methods">
    <h3>Payment methods</h3>
    <ul>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg><span>Cards</span></li>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h13a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H6a1 1 0 0 1 0-2"/><path d="M21 12h-5v5h5"/></svg><span>Digital wallets</span></li>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v9H3M12 15v6M18 12h3M6 12v3"/></svg><span>QR &amp; local payments</span></li>
    </ul>
    <p>Choose your method at secure checkout. Available options depend on your currency, location and device.</p>
  </section>;
}
