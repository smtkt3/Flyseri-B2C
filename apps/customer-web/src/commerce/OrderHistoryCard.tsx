import { Link } from 'react-router-dom';
import type { OrderSummary } from '@flyseri/types';
import { formatMoney, formatTimestamp, orderStatus } from '../account/presentation';
import { AirlineIdentity } from '../flight/AirlineIdentity';
import { countryName } from '../trip/tripPresentation';
import './order-history.css';

const cabins: Record<string, string> = { ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business', FIRST: 'First', MIXED: 'Mixed cabin' };
const tripTypes = { ONE_WAY: 'One-way', ROUND_TRIP: 'Round trip', MULTI_CITY: 'Multi-city' };
function travelDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
}
function ServiceIcon({ visa, exchange }: { visa: boolean; exchange: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{visa ? <><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M8 16h8M9 18h6"/></> : exchange ? <><path d="M4 7h15l-4-4M20 17H5l4 4M20 7l-5 5M4 17l5-5"/></> : <><path d="m21 3-6 18-4-8-8-4 18-6Z"/><path d="m11 13 5-5"/></>}</svg>;
}
function serviceStatus(order: OrderSummary): string | null {
  const info = order.overview;
  if (order.status !== 'PAID') return null;
  if (info?.kind === 'FLIGHT_EXCHANGE') return order.fulfillmentStatus === 'COMPLETED' ? 'Flight change completed' : ['MANUAL_REVIEW_REQUIRED', 'REFUND_REQUIRED', 'BOOKING_FAILED', 'TICKETING_FAILED', 'PNR_EXPIRED'].includes(info.bookingStatus ?? '') ? 'Flight change needs review' : 'Flight change in progress';
  if (info?.kind !== 'FLIGHT') return null;
  if (info.bookingStatus === 'CANCELLED') return 'Booking cancelled';
  if (info.ticketIssued) return 'Ticket issued';
  if (['MANUAL_REVIEW_REQUIRED', 'REFUND_REQUIRED', 'BOOKING_FAILED', 'TICKETING_FAILED', 'PNR_EXPIRED'].includes(info.bookingStatus ?? '')) return 'Booking needs review';
  return 'Ticket not yet confirmed';
}

export function OrderHistoryCard({ order }: { order: OrderSummary }) {
  const info = order.overview;
  const exchange = info?.kind === 'FLIGHT_EXCHANGE' || !!order.flightServicingCaseId;
  const visa = info?.kind === 'VISA' || !!order.visaApplicationId;
  const flight = info?.kind === 'FLIGHT' || !!order.bookingIntentId;
  const kind = exchange ? 'Flight change' : visa ? 'Visa service' : flight ? 'Flight booking' : 'Order';
  const title = visa && info?.destinationCountryCode ? `${countryName(info.destinationCountryCode)} visa service` : info?.title || kind;
  const date = travelDate(info?.travelDate);
  const returnDate = info?.tripType === 'ROUND_TRIP' ? travelDate(info.journeys?.at(-1)?.departureDate) : null;
  const status = serviceStatus(order);
  const reference = info?.reference && (info.reference.label !== 'PNR' || order.status === 'PAID') ? info.reference : null;
  const unpaid = ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status);
  const tone = order.status === 'PAID' ? 'paid' : ['PAYMENT_PROCESSING', 'PENDING_PAYMENT'].includes(order.status) ? 'pending' : order.status === 'PAYMENT_FAILED' ? 'failed' : 'muted';
  return <Link className="account-panel order-history-card" to={`/app/orders/${order.id}`}>
    <div className="order-card-main">
      <span className={`order-card-icon${visa ? ' visa' : ''}`}><ServiceIcon visa={visa} exchange={exchange}/></span>
      <div className="order-card-content">
        <div className="order-card-kicker"><span>{kind}</span>{info?.tripType && !exchange && <span>{tripTypes[info.tripType]}</span>}</div>
        <h2>{title}</h2>
        <div className="order-card-meta">
          {date && <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M6 2.5v4M14 2.5v4M3 8h14"/></svg><time dateTime={info!.travelDate}>{date}</time>{returnDate && <> – <time dateTime={info?.journeys?.at(-1)?.departureDate}>{returnDate}</time></>}</span>}
          {info?.travelerCount ? <span>{info.travelerCount} {visa ? info.travelerCount === 1 ? 'applicant' : 'applicants' : info.travelerCount === 1 ? 'traveler' : 'travelers'}</span> : null}
          {info?.cabin && cabins[info.cabin] && <span>{cabins[info.cabin]}</span>}
          {!!info?.extrasCount && <span>{info.extrasCount} {info.extrasCount === 1 ? 'extra' : 'extras'}</span>}
        </div>
        {!!info?.airlineCodes?.length && <div className="order-card-airlines"><AirlineIdentity codes={info.airlineCodes}/></div>}
      </div>
    </div>
    <div className="order-card-payment">
      <span className={`order-payment-status ${tone}`}><i aria-hidden="true"/>{orderStatus(order.status)}</span>
      <div className="order-card-total"><span>{exchange ? 'Additional payment' : 'Order total'}</span><strong>{formatMoney(order.totalAmount, order.currency)}</strong></div>
      <span className="order-card-action">{unpaid ? 'Continue payment' : 'View order'} <span aria-hidden="true">→</span></span>
    </div>
    <div className="order-card-footer">
      <span className="order-card-number"><span>Order</span> <strong>{order.orderNumber}</strong></span>
      <span>Ordered <time dateTime={order.createdAt}>{formatTimestamp(order.createdAt)}</time></span>
      {reference && <span className="order-card-reference">{reference.label} <strong>{reference.value}</strong></span>}
      {status && <span className={`order-card-service-status${info?.ticketIssued ? ' issued' : ''}`}>{status}</span>}
    </div>
  </Link>;
}
