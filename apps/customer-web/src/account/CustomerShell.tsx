import './customer-ux.css';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MobileAccountNavigation } from './MobileAccountNavigation';
import { lazy, Suspense } from 'react';
import { CustomerDashboard } from './CustomerDashboard';
import { SupportPage } from './SupportPage';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { PageRecovery, PageRecoveryBoundary } from './PageRecovery';
import { PageLoading } from '../components/PageLoading';
import { TravelWorkspace } from './TravelWorkspace';

const FareWatchesPage = lazy(() => import('../travel/FareWatches').then(module => ({ default: module.FareWatchesPage })));
const ProfilePage = lazy(() => import('./ProfilePage').then((module) => ({ default: module.ProfilePage })));
const TravellersPage = lazy(() => import('./TravellersPage').then((module) => ({ default: module.TravellersPage })));
const MyTripsPage = lazy(() => import('../trip/MyTripsPage').then((module) => ({ default: module.MyTripsPage })));
const CreateTripPage = lazy(() => import('../trip/CreateTripPage').then((module) => ({ default: module.CreateTripPage })));
const TripWorkspacePage = lazy(() => import('../trip/TripWorkspacePage').then((module) => ({ default: module.TripWorkspacePage })));
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
const FlightTravelerEditPage=lazy(()=>import('../flight/GuestFlightCheckoutPage').then(module=>({default:module.FlightTravelerEditPage})));
const FlightBookingsPage = lazy(() => import('../flight/FlightBookingsPage').then(module => ({default: module.FlightBookingsPage})));
const FlightBookingPage = lazy(() => import('../flight/FlightBookingsPage').then(module => ({default: module.FlightBookingPage})));
const OrdersPage = lazy(() => import('../commerce/OrdersPage').then((module) => ({ default: module.OrdersPage })));
const OrderDetailPage = lazy(() => import('../commerce/OrderDetailPage').then((module) => ({ default: module.OrderDetailPage })));
const PaymentsPage = lazy(() => import('../commerce/PaymentsPage').then((module) => ({ default: module.PaymentsPage })));
const PointsPage = lazy(() => import('../rewards/PointsPage').then(module => ({default:module.PointsPage})));
const SeriPage = lazy(() => import('../seri/SeriPage').then((module) => ({ default: module.SeriPage })));

const sections = [
  { to: '/app', label: 'Home', icon: '⌂', ready: true },
  { to: '/app/bookings', label: 'My travel', icon: '✈', ready: true },
  { to: '/app/visa', label: 'Visa', icon: '◇', ready: true },
  { to: '/app/flights', label: 'Find Flights', icon: '⌕', ready: true },
  { to: '/app/travellers', label: 'Travellers', icon: '♧', ready: true },
  { to: '/app/payments', label: 'Payments', icon: '◇', ready: true },
  { to: '/app/points', label: 'Flyseri Points', icon: '✦', ready: true },
  { to: '/app/seri', label: 'Ask Seri', icon: '✦', ready: true },
  { to: '/app/price-alerts', label: 'Price alerts', icon: '♧', ready: true },
  { to: '/app/support', label: 'Support', icon: '☏', ready: true },
  { to: '/app/profile', label: 'Profile & settings', icon: '◉', ready: true },
];

function PlannedPage({ title }: { title: string }) {
  return <div className="account-page"><p className="account-eyebrow">COMING LATER</p><h1>{title}</h1><p className="account-muted">This part of your Flyseri journey is being built. There is no live {title.toLowerCase()} data here yet.</p><Link className="account-link" to="/app">Back to Home →</Link></div>;
}

export function CustomerShell() {
  const location = useLocation();
  return <div className="customer-site-shell"><PremiumNavbar />
    <div className="account-shell">
    <div className="account-content">
      <PageRecoveryBoundary key={location.pathname}><Suspense fallback={<PageLoading />}><Routes>
      <Route index element={<CustomerDashboard />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="travellers" element={<TravellersPage />} />
      <Route path="trips" element={<TravelWorkspace tab="trips"><MyTripsPage embedded /></TravelWorkspace>} />
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
      <Route path="flights/booking-intents/:intentId/travelers" element={<FlightTravelerEditPage />} />
      <Route path="bookings" element={<TravelWorkspace tab="bookings"><FlightBookingsPage embedded /></TravelWorkspace>} />
      <Route path="bookings/:bookingId" element={<FlightBookingPage />} />
      <Route path="orders" element={<TravelWorkspace tab="orders"><OrdersPage embedded /></TravelWorkspace>} />
      <Route path="orders/:orderId" element={<OrderDetailPage />} />
      <Route path="payments" element={<PaymentsPage />} />
      <Route path="points" element={<PointsPage />} />
      <Route path="seri" element={<SeriPage />} />
      <Route path="price-alerts" element={<FareWatchesPage />} />
      <Route path="support" element={<SupportPage />} />
      <Route path="visa-applications/:applicationId" element={<VisaApplicationPage />} />
      <Route path="documents" element={<Navigate to="/app/profile?section=documents" state={location.state} replace />} />
      <Route path="documents/:documentId" element={<DocumentDetailPage />} />
      {sections.filter((section) => !section.ready).map((section) => <Route key={section.to} path={section.to.slice('/app/'.length)} element={<PlannedPage title={section.label} />} />)}
      <Route path="*" element={<PageRecovery />} />
    </Routes></Suspense></PageRecoveryBoundary></div>
    <MobileAccountNavigation/>
  </div></div>;
}
