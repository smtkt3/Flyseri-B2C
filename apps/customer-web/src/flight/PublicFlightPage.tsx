import { Navigate, useLocation } from 'react-router-dom';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { FlightSearchPage } from './FlightSearchPage';
import { useAuth } from '../auth/AuthProvider';

export function PublicFlightPage() {
  const location = useLocation();
  const { resolving } = useAuth();
  if (new URLSearchParams(location.search).has('tripId')) return <Navigate to={`/app/flights${location.search}`} replace />;
  return <div className="public-flight-shell">
    <PremiumNavbar />
    <main><h1 className="sr-only">Search flights</h1>{resolving ? <p role="status" className="account-muted">Restoring your search…</p> : <FlightSearchPage key={location.key} publicSearch />}</main>
  </div>;
}
