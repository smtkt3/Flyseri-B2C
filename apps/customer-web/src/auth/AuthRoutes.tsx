import { lazy, Suspense, useRef } from 'react';
import { Route, Routes, useLocation, type Location } from 'react-router-dom';
import { ProtectedRoute } from './AuthProvider';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { PageRecovery, PageRecoveryBoundary } from '../account/PageRecovery';
import { HomeLoadingScreen } from '../components/home/HomeLoadingScreen';

const BudgetPage = lazy(() => import('../travel/TravelPages').then(module => ({ default: module.BudgetPage })));
const DemoBookingManagement = lazy(() => import('../flight/DemoBookingManagement').then(module => ({ default: module.DemoBookingManagement })));
const App = lazy(() => import('../App'));
const AuthPage = lazy(() => import('./AuthPage').then((module) => ({ default: module.AuthPage })));
const CustomerShell = lazy(() => import('../account/CustomerShell').then((module) => ({ default: module.CustomerShell })));
const PublicFlightPage = lazy(() => import('../flight/PublicFlightPage').then((module) => ({ default: module.PublicFlightPage })));
const GuestFlightCheckoutPage = lazy(() => import('../flight/GuestFlightCheckoutPage').then((module) => ({ default: module.GuestFlightCheckoutPage })));
const HolidayCataloguePage = lazy(() => import('../holiday/HolidayPages').then(module => ({ default: module.HolidayCataloguePage })));
const HolidayDetailPage = lazy(() => import('../holiday/HolidayPages').then(module => ({ default: module.HolidayDetailPage })));
const HolidayBookingsPage = lazy(() => import('../holiday/HolidayPages').then(module => ({ default: module.HolidayBookingsPage })));

const overlayPaths = new Set(['/sign-in', '/create-account', '/forgot-password']);

function homeLocation(location: Location): Location {
  return { ...location, pathname: '/', search: '', hash: '', state: null, key: 'auth-home' };
}

function publicLocation(location: Location): boolean {
  return !overlayPaths.has(location.pathname) && !location.pathname.startsWith('/app') && location.pathname !== '/reset-password';
}

export function AuthRoutes() {
  const location = useLocation();
  const lastPage = useRef<Location>(publicLocation(location) ? location : homeLocation(location));
  if (publicLocation(location)) lastPage.current = location;

  const overlay = overlayPaths.has(location.pathname);
  const background = overlay ? lastPage.current : location;
  const backgroundPath = `${background.pathname}${background.search}${background.hash}`;

  return <>
    <div className={overlay ? 'auth-background auth-background-blurred' : 'auth-background'} inert={overlay} aria-hidden={overlay}>
      <PageRecoveryBoundary key={background.pathname} fallback={<div className="customer-site-shell"><PremiumNavbar/><PageRecovery failed /></div>}><Suspense fallback={background.pathname === '/' ? <HomeLoadingScreen /> : <div className="account-center" role="status">Opening Flyseri…</div>}>
        <Routes location={background}>
          <Route path="/" element={<App />} />
          <Route path="/reset-password" element={<div className="customer-site-shell"><PremiumNavbar/><AuthPage mode="reset-password" /></div>} />
          <Route path="/plan-budget" element={<BudgetPage />} />
          <Route path="/flights" element={<PublicFlightPage />} />
          <Route path="/flight-checkout" element={<GuestFlightCheckoutPage />} />
          <Route path="/demo/bookings" element={<DemoBookingManagement />} />
          <Route path="/demo/bookings/:demoId" element={<DemoBookingManagement />} />
          <Route path="/holidays" element={<HolidayCataloguePage />} />
          <Route path="/holidays/bookings" element={<ProtectedRoute><HolidayBookingsPage /></ProtectedRoute>} />
          <Route path="/holidays/:id" element={<HolidayDetailPage />} />
          <Route path="/app/*" element={<ProtectedRoute><CustomerShell /></ProtectedRoute>} />
          <Route path="*" element={<div className="customer-site-shell"><PremiumNavbar/><PageRecovery /></div>} />
        </Routes>
      </Suspense></PageRecoveryBoundary>
    </div>
    {overlay && <Suspense fallback={<div className="account-center" role="status">Opening sign in…</div>}>
      <Routes>
        <Route path="/sign-in" element={<AuthPage mode="sign-in" modal backgroundPath={backgroundPath} backgroundState={background.state} />} />
        <Route path="/create-account" element={<AuthPage mode="create-account" modal backgroundPath={backgroundPath} backgroundState={background.state} />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot-password" modal backgroundPath={backgroundPath} backgroundState={background.state} />} />
      </Routes>
    </Suspense>}
  </>;
}
