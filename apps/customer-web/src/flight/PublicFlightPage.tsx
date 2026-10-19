import { Navigate, useLocation } from 'react-router-dom';
import { CustomerSiteLayout } from '../account/CustomerSiteLayout';
import { FlightSearchPage } from './FlightSearchPage';
import { useAuth } from '../auth/AuthProvider';

export function PublicFlightPage() {
  const location = useLocation();
  const { resolving } = useAuth();
  if (new URLSearchParams(location.search).has('tripId')) return <Navigate to={`/app/flights${location.search}`} replace />;
  return <CustomerSiteLayout><div className="public-flight-shell">
    <main aria-label="Flight search">{resolving ? <p role="status" className="account-muted">Restoring your search…</p> : <FlightSearchPage key={location.key} publicSearch />}</main>
  </div></CustomerSiteLayout>;
}
