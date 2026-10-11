import './customer-ux.css';
import { Translated } from '../travel/language';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { authService } from '../services/authService';
import { CustomerDashboard } from './CustomerDashboard';
import { SupportPage } from './SupportPage';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { PageRecovery, PageRecoveryBoundary } from './PageRecovery';

const FareWatchesPage = lazy(() => import('../travel/FareWatches').then(module => ({ default: module.FareWatchesPage })));
const ProfilePage = lazy(() => import('./ProfilePage').then((module) => ({ default: module.ProfilePage })));
const TravellersPage = lazy(() => import('./TravellersPage').then((module) => ({ default: module.TravellersPage })));
const MyTripsPage = lazy(() => import('../trip/MyTripsPage').then((module) => ({ default: module.MyTripsPage })));
const CreateTripPage = lazy(() => import('../trip/CreateTripPage').then((module) => ({ default: module.CreateTripPage })));
const TripWorkspacePage = lazy(() => import('../trip/TripWorkspacePage').then((module) => ({ default: module.TripWorkspacePage })));
const MyDocumentsPage = lazy(() => import('../document/MyDocumentsPage').then((module) => ({ default: module.MyDocumentsPage })));
const DocumentDetailPage = lazy(() => import('../document/DocumentDetailPage').then((module) => ({ default: module.DocumentDetailPage })));
const TripVisaPage = lazy(() => import('../visa/TripVisaPage').then((module) => ({ default: module.TripVisaPage })));
const VisaHubPage = lazy(() => import('../visa/VisaHubPage').then((module) => ({ default: module.VisaHubPage })));
const VisaApplicationPage = lazy(() => import('../visa/VisaApplicationPage').then((module) => ({ default: module.VisaApplicationPage })));
const VisaAssistancePaymentPage = lazy(() => import('../visa/VisaAssistancePaymentPage').then(module => ({ default: module.VisaAssistancePaymentPage })));
const VisaAssistanceDocumentsPage = lazy(() => import('../visa/VisaAssistanceDocumentsPage').then(module => ({ default: module.VisaAssistanceDocumentsPage })));
const VisaAssistanceRequestPage = lazy(() => import('../visa/VisaAssistanceRequestPage').then((module) => ({ default: module.VisaAssistanceRequestPage })));
const FlightSearchPage = lazy(() => import('../flight/FlightSearchPage').then((module) => ({ default: module.FlightSearchPage })));
const FlightIntentPage = lazy(() => import('../flight/FlightIntentPage').then((module) => ({ default: module.FlightIntentPage })));
const FlightExtrasPage = lazy(() => import('../flight/FlightExtrasPage').then((module) => ({ default: module.FlightExtrasPage })));
const FlightBookingsPage = lazy(() => import('../flight/FlightBookingsPage').then(module => ({default: module.FlightBookingsPage})));
const FlightBookingPage = lazy(() => import('../flight/FlightBookingsPage').then(module => ({default: module.FlightBookingPage})));
const OrdersPage = lazy(() => import('../commerce/OrdersPage').then((module) => ({ default: module.OrdersPage })));
const OrderDetailPage = lazy(() => import('../commerce/OrderDetailPage').then((module) => ({ default: module.OrderDetailPage })));
const PaymentsPage = lazy(() => import('../commerce/PaymentsPage').then((module) => ({ default: module.PaymentsPage })));
const SeriPage = lazy(() => import('../seri/SeriPage').then((module) => ({ default: module.SeriPage })));

const sections = [
  { to: '/app', label: 'Home', icon: '⌂', ready: true },
  { to: '/app/trips', label: 'My Trips', icon: '✈', ready: true },
  { to: '/app/visa', label: 'Visa', icon: '◇', ready: true },
  { to: '/app/flights', label: 'Find Flights', icon: '⌕', ready: true },
  { to: '/app/orders', label: 'My Orders', icon: '◈', ready: true },
  { to: '/app/bookings', label: 'My Bookings', icon: '✈', ready: true },
  { to: '/app/documents', label: 'My Documents', icon: '◆', ready: true },
  { to: '/app/travellers', label: 'Travellers', icon: '♧', ready: true },
  { to: '/app/payments', label: 'Payments', icon: '◇', ready: true },
  { to: '/app/seri', label: 'Ask Seri', icon: '✦', ready: true },
  { to: '/app/price-alerts', label: 'Price alerts', icon: '♧', ready: true },
  { to: '/app/support', label: 'Support', icon: '☏', ready: true },
  { to: '/app/profile', label: 'Profile', icon: '◉', ready: true },
];
const mobileSections = ['/app', '/app/flights', '/app/bookings', '/app/trips', '/app/seri'].map(to => sections.find(section => section.to === to)!);

function PlannedPage({ title }: { title: string }) {
  return <div className="account-page"><p className="account-eyebrow">COMING LATER</p><h1>{title}</h1><p className="account-muted">This part of your Flyseri journey is being built. There is no live {title.toLowerCase()} data here yet.</p><Link className="account-link" to="/app">Back to Home →</Link></div>;
}

export function CustomerShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [signOutError, setSignOutError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  async function signOut() {
    try { await authService.signOut(); navigate('/', { replace: true }); }
    catch { setSignOutError('We could not sign you out. Please try again.'); }
  }
  return <div className="customer-site-shell"><PremiumNavbar />
    <div className="account-shell">
    <div className="account-content"><div className="account-page-menu"><button type="button" aria-expanded={menuOpen} aria-controls="account-mobile-menu" onClick={() => setMenuOpen(value=>!value)}>{menuOpen ? "Close account menu" : "Account menu"}</button></div>
      {menuOpen && <nav id="account-mobile-menu" className="account-mobile-menu" aria-label="All customer pages">{sections.map((section) => <NavLink key={section.to} to={section.to} end={section.to === '/app'}>{section.label}</NavLink>)}<button type="button" onClick={() => { void signOut(); }}><Translated text="Sign out" /></button>{signOutError && <span role="alert">{signOutError}</span>}</nav>}
      <PageRecoveryBoundary key={location.pathname}><Suspense fallback={<div className="account-page" role="status">Opening your page…</div>}><Routes>
      <Route index element={<CustomerDashboard />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="travellers" element={<TravellersPage />} />
      <Route path="trips" element={<MyTripsPage />} />
      <Route path="trips/new" element={<CreateTripPage />} />
      <Route path="trips/:tripId/seri" element={<SeriPage />} />
      <Route path="trips/:tripId" element={<TripWorkspacePage />} />
      <Route path="trips/:tripId/visa" element={<TripVisaPage />} />
      <Route path="visa" element={<VisaHubPage />} />
      <Route path="visa/assistance/:requestId/payment" element={<VisaAssistancePaymentPage />} />
      <Route path="visa/assistance/:requestId/documents" element={<VisaAssistanceDocumentsPage />} />
      <Route path="visa/assistance" element={<VisaAssistanceRequestPage />} />
      <Route path="visa/new" element={<TripVisaPage />} />
      <Route path="flights" element={<FlightSearchPage />} />
      <Route path="flights/booking-intents/:intentId" element={<FlightIntentPage />} />
      <Route path="flights/booking-intents/:intentId/extras" element={<FlightExtrasPage />} />
      <Route path="bookings" element={<FlightBookingsPage />} />
      <Route path="bookings/:bookingId" element={<FlightBookingPage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="orders/:orderId" element={<OrderDetailPage />} />
      <Route path="payments" element={<PaymentsPage />} />
      <Route path="seri" element={<SeriPage />} />
      <Route path="price-alerts" element={<FareWatchesPage />} />
      <Route path="support" element={<SupportPage />} />
      <Route path="visa-applications/:applicationId" element={<VisaApplicationPage />} />
      <Route path="documents" element={<MyDocumentsPage />} />
      <Route path="documents/:documentId" element={<DocumentDetailPage />} />
      {sections.filter((section) => !section.ready).map((section) => <Route key={section.to} path={section.to.slice('/app/'.length)} element={<PlannedPage title={section.label} />} />)}
      <Route path="*" element={<PageRecovery />} />
    </Routes></Suspense></PageRecoveryBoundary></div>
    <nav className="account-mobile-bottom" aria-label="Quick navigation">{mobileSections.map((section) => <NavLink key={section.to} to={section.to} end={section.to === '/app'} className={({ isActive }) => isActive ? 'active' : ''}><span aria-hidden="true">{section.icon}</span>{section.label === 'Find Flights' ? 'Flights' : section.label === 'My Trips' ? 'Trips' : section.label === 'My Bookings' ? 'Bookings' : section.label === 'Ask Seri' ? 'Seri' : section.label}</NavLink>)}</nav>
  </div></div>;
}
