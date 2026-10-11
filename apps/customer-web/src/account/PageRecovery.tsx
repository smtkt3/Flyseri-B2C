import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './page-recovery.css';

export function PageRecovery({ failed = false }: { failed?: boolean }) {
  return <main className="page-recovery">
    <section aria-labelledby="page-recovery-title">
      <span className="page-recovery-icon" aria-hidden="true">{failed ? '!' : '404'}</span>
      <p className="page-recovery-eyebrow">LET’S GET YOU BACK ON TRACK</p>
      <h1 id="page-recovery-title">{failed ? 'This page couldn’t open' : 'We couldn’t find this page'}</h1>
      <p>{failed ? 'Please reload the page, or choose where you’d like to go next.' : 'The link may be outdated or the address may be incorrect. You can continue from the homepage or your bookings.'}</p>
      {failed && <p className="page-recovery-note">Were you reserving or paying? Check your booking status before submitting again.</p>}
      <div className="page-recovery-actions">
        {failed ? <button type="button" onClick={() => window.location.reload()}>Reload page</button> : <Link to="/">Go to homepage</Link>}
        <Link to="/app/bookings">My bookings</Link>
      </div>
      <Link className="page-recovery-support" to="/app/support">Contact support</Link>
    </section>
  </main>;
}

/** Key this boundary by pathname so a failed page cannot block the next route. */
export class PageRecoveryBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback ?? <PageRecovery failed /> : this.props.children; }
}
