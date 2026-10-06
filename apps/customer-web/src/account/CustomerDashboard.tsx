import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerProfile, DocumentSummary, FlightBookingIntent, OrderSummary, PaymentSummary, TravellerProfile, TripSummary, VisaApplicationSummary } from '@flyseri/types';
import { useAuth } from '../auth/AuthProvider';
import { commerceService } from '../services/commerceService';
import { customerService } from '../services/customerService';
import { documentService } from '../services/documentService';
import { flightService } from '../services/flightService';
import { travellerService } from '../services/travellerService';
import { tripService } from '../services/tripService';
import { visaService } from '../services/visaService';
import { destinationLabel, displayDate, displayTripTitle } from '../trip/tripPresentation';
import { formatMoney, formatTimestamp, intentStatus, orderStatus, paymentStatus, visaStatus } from './presentation';
import './dashboard.css';

interface DashboardData {
  profile: CustomerProfile | null;
  trips: TripSummary[];
  travellers: TravellerProfile[];
  orders: OrderSummary[];
  payments: PaymentSummary[];
  documents: DocumentSummary[];
  visas: VisaApplicationSummary[];
  intents: FlightBookingIntent[];
  unavailable: string[];
}

const emptyData: DashboardData = { profile: null, trips: [], travellers: [], orders: [], payments: [], documents: [], visas: [], intents: [], unavailable: [] };

function result<T>(settled: PromiseSettledResult<T>, fallback: T, name: string, unavailable: string[]): T {
  if (settled.status === 'fulfilled') return settled.value;
  unavailable.push(name);
  return fallback;
}

function nextTrip(trips: TripSummary[]): TripSummary | null {
  const today = new Date().toISOString().slice(0, 10);
  return [...trips].filter((trip) => !['CANCELLED', 'COMPLETED'].includes(trip.status) && (!trip.endDate || trip.endDate >= today))
    .sort((a, b) => (a.startDate ?? '9999-12-31').localeCompare(b.startDate ?? '9999-12-31') || b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

interface Action { key: string; title: string; detail: string; to: string; tone: 'urgent' | 'attention' }
function requiredActions(data: DashboardData, trip: TripSummary | null): Action[] {
  const actions: Action[] = [];
  for (const payment of data.payments) {
    if (payment.status === 'FAILED' || payment.reconciliationState === 'REQUIRED') actions.push({ key: `payment-${payment.id}`, title: 'Check a payment', detail: payment.reconciliationState === 'REQUIRED' ? 'This payment needs a review before its status is clear.' : 'A payment attempt failed. Review the order before trying again.', to: `/app/orders/${payment.orderId}`, tone: 'urgent' });
  }
  for (const order of data.orders) {
    if (order.fulfillmentStatus === 'REVALIDATION_REQUIRED' || order.status === 'PAYMENT_FAILED') actions.push({ key: `order-${order.id}`, title: order.fulfillmentStatus === 'REVALIDATION_REQUIRED' ? 'Fare needs a fresh check' : 'Review an unpaid order', detail: `Order ${order.orderNumber} needs attention.`, to: `/app/orders/${order.id}`, tone: 'urgent' });
  }
  for (const intent of data.intents) {
    if (intent.status === 'PRICE_CHANGED') actions.push({ key: `intent-${intent.id}`, title: 'Your selected fare changed', detail: 'Review the latest airline fare before you continue.', to: `/app/flights/booking-intents/${intent.id}`, tone: 'urgent' });
    if (intent.status === 'EXPIRED') actions.push({ key: `intent-${intent.id}`, title: 'A flight selection expired', detail: 'Search again for current flight options.', to: `/app/flights/booking-intents/${intent.id}`, tone: 'attention' });
  }
  for (const visa of data.visas) {
    const missing = Math.max(0, visa.requiredTotal - visa.requiredCompleted);
    if (missing > 0 && visa.status !== 'CANCELLED') actions.push({ key: `visa-${visa.id}`, title: `${missing} visa checklist ${missing === 1 ? 'item' : 'items'} to complete`, detail: `${visa.visaTypeName}${trip ? ` · ${displayTripTitle(trip)}` : ''}`, to: `/app/visa-applications/${visa.id}`, tone: 'attention' });
  }
  for (const document of data.documents) {
    if (document.status === 'REVIEW_REQUIRED') actions.push({ key: `document-${document.id}`, title: 'Review a travel document', detail: document.displayName || document.documentType.replace(/_/g, ' ').toLowerCase(), to: `/app/documents/${document.id}`, tone: 'attention' });
  }
  return actions.slice(0, 5);
}

export function CustomerDashboard() {
  const { session } = useAuth();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const unavailable: string[] = [];
      const [profileResult, tripResult, travellerResult, orderResult, paymentResult, documentResult] = await Promise.allSettled([
        customerService.me(), tripService.list(), travellerService.list(), commerceService.orders(), commerceService.payments(), documentService.list(),
      ]);
      const profile = result(profileResult, null, 'profile', unavailable);
      const trips = result(tripResult, [] as TripSummary[], 'trips', unavailable);
      const travellers = result(travellerResult, [] as TravellerProfile[], 'travellers', unavailable);
      const orders = result(orderResult, [] as OrderSummary[], 'orders', unavailable);
      const payments = result(paymentResult, [] as PaymentSummary[], 'payments', unavailable);
      const documents = result(documentResult, [] as DocumentSummary[], 'documents', unavailable);
      const trip = nextTrip(trips);
      const [visaResult, intentResult] = trip ? await Promise.allSettled([visaService.list(trip.id), flightService.intentsForTrip(trip.id)]) : [null, null];
      const visas = visaResult ? result(visaResult, [] as VisaApplicationSummary[], 'visa', unavailable) : [];
      const intents = intentResult ? result(intentResult, [] as FlightBookingIntent[], 'flights', unavailable) : [];
      if (!active) return;
      setData({ profile, trips, travellers, orders, payments, documents, visas, intents, unavailable });
      setLoading(false);
    })();
    return () => { active = false; };
  }, [attempt]);

  const trip = nextTrip(data.trips);
  const actions = requiredActions(data, trip);
  const latestIntent = [...data.intents].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const latestPayment = [...data.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const recentOrders = [...data.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  const name = data.profile?.displayName?.trim().split(/\s+/)[0] || session?.user.email?.split('@')[0] || 'traveller';

  return <main className="account-page customer-dashboard">
    <header className="dashboard-hero"><div><p className="account-eyebrow">YOUR FLYSERI</p><h1>Welcome back, {name}</h1><p>Your journeys, travel tasks and next steps in one place.</p></div><Link className="btn-primary dashboard-main-action" to="/app/flights">Find a flight <span aria-hidden="true">↗</span></Link></header>
    {data.unavailable.length > 0 && !loading && <div className="dashboard-warning" role="alert">Some travel details could not be loaded. Your saved information has not changed. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
    {loading ? <div className="dashboard-skeleton-grid" role="status" aria-label="Loading your dashboard"><div /><div /><div /></div> : <>
      <div className="dashboard-main-grid">
        <section className="dashboard-card dashboard-actions" aria-labelledby="dashboard-actions-title"><div className="dashboard-section-heading"><div><p className="account-eyebrow">YOUR NEXT STEPS</p><h2 id="dashboard-actions-title">Action required</h2></div><span>{actions.length ? `${actions.length} to review` : 'Up to date'}</span></div>
          {actions.length ? <ul>{actions.map((action) => <li key={action.key}><Link to={action.to}><span className={`dashboard-action-mark ${action.tone}`} aria-hidden="true">{action.tone === 'urgent' ? '!' : '✓'}</span><span><strong>{action.title}</strong><small>{action.detail}</small></span><b aria-hidden="true">→</b></Link></li>)}</ul>
            : <div className="dashboard-empty"><span aria-hidden="true">✓</span><strong>{data.unavailable.length ? 'No available actions to show' : 'Nothing needs your attention right now'}</strong><p>{data.unavailable.length ? 'Retry to check the details that could not load.' : 'We’ll show real travel tasks here as your plans take shape.'}</p></div>}
        </section>
        <section className="dashboard-card dashboard-trip" aria-labelledby="dashboard-trip-title"><div className="dashboard-section-heading"><div><p className="account-eyebrow">COMING UP</p><h2 id="dashboard-trip-title">Your next trip</h2></div><Link to="/app/trips">All trips →</Link></div>
          {trip ? <><div className="dashboard-trip-destination"><span aria-hidden="true">✈</span><div><h3>{displayTripTitle(trip)}</h3><p>{destinationLabel(trip)}</p></div></div><dl><div><dt>When</dt><dd>{trip.startDate ? `${displayDate(trip.startDate)}${trip.endDate ? ` – ${displayDate(trip.endDate)}` : ''}` : 'Dates to be decided'}</dd></div><div><dt>Travellers</dt><dd>{trip.travellerCount} {trip.travellerCount === 1 ? 'person' : 'people'}</dd></div></dl><Link className="dashboard-card-link" to={`/app/trips/${trip.id}`}>Open trip workspace →</Link></>
            : <div className="dashboard-empty"><span aria-hidden="true">✈</span><strong>{data.unavailable.includes('trips') ? 'Trips are unavailable right now' : 'No upcoming trip yet'}</strong><p>Choose a destination and build your plan at your own pace.</p><Link to="/app/trips/new">Plan a trip →</Link></div>}
        </section>
      </div>

      <section className="dashboard-status-grid" aria-label="Current travel status">
        <div className="dashboard-card dashboard-mini"><span className="dashboard-mini-icon">✈</span><div><p className="account-eyebrow">FLIGHT SELECTION</p><h2>{latestIntent ? intentStatus(latestIntent.status) : 'No flight selected'}</h2><p>{latestIntent ? 'A selected fare is not an airline reservation.' : 'Compare current options for your next journey.'}</p></div><Link to={latestIntent ? `/app/flights/booking-intents/${latestIntent.id}` : '/app/flights'}>{latestIntent ? 'Review selection' : 'Search flights'} →</Link></div>
        <div className="dashboard-card dashboard-mini"><span className="dashboard-mini-icon">◇</span><div><p className="account-eyebrow">VISA PLANNING</p><h2>{data.visas.length ? visaStatus(data.visas[0]!.status) : 'No application yet'}</h2><p>{data.visas.length ? `${data.visas[0]!.requiredCompleted} of ${data.visas[0]!.requiredTotal} required checklist items complete` : 'Applications and requirements live inside a trip.'}</p></div><Link to={data.visas.length ? `/app/visa-applications/${data.visas[0]!.id}` : trip ? `/app/trips/${trip.id}/visa` : '/app/visa'}>View visa plans →</Link></div>
        <div className="dashboard-card dashboard-mini"><span className="dashboard-mini-icon">◈</span><div><p className="account-eyebrow">PAYMENT STATUS</p><h2>{latestPayment ? paymentStatus(latestPayment.status) : 'No payment yet'}</h2><p>{latestPayment ? 'Only a confirmed provider result counts as paid.' : 'Review orders and payment updates here.'}</p></div><Link to={latestPayment ? `/app/orders/${latestPayment.orderId}` : '/app/orders'}>View orders →</Link></div>
      </section>

      <div className="dashboard-lower-grid"><section className="dashboard-card dashboard-orders" aria-labelledby="dashboard-orders-title"><div className="dashboard-section-heading"><div><p className="account-eyebrow">RECENT ACTIVITY</p><h2 id="dashboard-orders-title">Orders</h2></div><Link to="/app/orders">View all →</Link></div>
        {recentOrders.length ? <ul>{recentOrders.map((order) => <li key={order.id}><Link to={`/app/orders/${order.id}`}><span><strong>{order.orderNumber}</strong><small>{formatTimestamp(order.createdAt)} · {orderStatus(order.status)}</small></span><b>{formatMoney(order.totalAmount, order.currency)}</b></Link></li>)}</ul> : <div className="dashboard-empty compact"><strong>{data.unavailable.includes('orders') ? 'Orders are unavailable right now' : 'No orders yet'}</strong><p>Saved flight selections and orders will appear here.</p></div>}
      </section><section className="dashboard-card dashboard-help"><p className="account-eyebrow">PLAN WITH CONFIDENCE</p><h2>Where to next?</h2><p>Find flights, keep your travel documents ready, or ask Seri about the trip you’re planning.</p><div className="dashboard-help-links"><Link to="/app/travellers">Travellers <span>→</span></Link><Link to="/app/documents">Documents <span>→</span></Link><Link to={trip ? `/app/trips/${trip.id}/seri` : '/app/seri'}>Ask Seri <span>→</span></Link><Link to="/app/support">Support <span>→</span></Link></div></section></div>
    </>}
  </main>;
}
