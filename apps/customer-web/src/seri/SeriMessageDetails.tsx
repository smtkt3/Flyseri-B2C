import type { SeriMessage } from '@flyseri/types';
import { useMemo } from 'react';
import { displayDate } from '../trip/tripPresentation';
import { chatFlights, SeriFlightResults, type ChatFlights } from './SeriFlightResults';

export function SeriMessageDetails({ message, onFlightsUpdate }: { message: SeriMessage; onFlightsUpdate?: (data: ChatFlights) => void }) {
  const payload = message.payload;
  const flights = useMemo(() => chatFlights(payload), [payload]);
  if (!payload) return null;
  if (flights) return <SeriFlightResults data={flights} onUpdate={onFlightsUpdate} />;
  const trips = Array.isArray(payload.trips) ? payload.trips as Array<Record<string, unknown>> : [];
  const applications = Array.isArray(payload.applications) ? payload.applications as Array<Record<string, unknown>> : [];
  const payments = Array.isArray(payload.payments) ? payload.payments as Array<Record<string, unknown>> : [];
  const orders = Array.isArray(payload.orders) ? payload.orders as Array<Record<string, unknown>> : [];
  const offers = Array.isArray(payload.offers) ? payload.offers as Array<Record<string, unknown>> : [];
  const hotels = Array.isArray(payload.hotels) ? payload.hotels.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
  if (hotels.length) return <div className="seri-data-list">{hotels.slice(0, 5).map((item, i) => {
    const hotel = item.hotel && typeof item.hotel === 'object' ? item.hotel as Record<string, unknown> : {};
    const rate = item.rateDetails && typeof item.rateDetails === 'object' ? item.rateDetails as Record<string, unknown> : {};
    const amount = typeof rate.approxTotalPrice === 'string' || typeof rate.approxTotalPrice === 'number' ? Number(rate.approxTotalPrice) : NaN;
    const currency = typeof rate.currencyCode === 'string' && /^[A-Z]{3}$/.test(rate.currencyCode) ? rate.currencyCode : '';
    return <article key={i}><strong>{String(hotel.hotelName ?? hotel.name ?? 'Hotel option')}</strong>
      <span>{String(payload.checkInDate ?? '')} – {String(payload.checkOutDate ?? '')}</span>
      {Number.isFinite(amount) && amount >= 0 && currency && <span>{currency} {amount.toFixed(2)} · estimated stay total</span>}
      <small>Test availability · booking coming soon</small></article>;
  })}</div>;
  if (trips.length) return <div className="seri-data-list">{trips.slice(0, 5).map((trip, i) => <article key={String(trip.id ?? i)}><strong>{String(trip.title || (trip.primaryDestination as { cityName?: string | null } | null)?.cityName || 'Your trip')}</strong><span>{trip.startDate ? displayDate(String(trip.startDate)) : 'Dates to be decided'} · {String(trip.status ?? '')}</span></article>)}</div>;
  if (applications.length) return <div className="seri-data-list">{applications.slice(0, 5).map((item, i) => <article key={String(item.id ?? i)}><strong>{String(item.visaTypeName ?? 'Visa application')}</strong><span>{String(item.status ?? '')}{typeof item.requiredCompleted === 'number' ? ` · ${item.requiredCompleted}/${String(item.requiredTotal)} checklist items` : ''}</span>{Array.isArray(item.missing) && item.missing.length > 0 && <small>Still needed: {(item.missing as string[]).join(', ')}</small>}</article>)}</div>;
  if (payments.length) return <div className="seri-data-list">{payments.slice(0, 5).map((item, i) => <article key={String(item.id ?? i)}><strong>{String(item.status ?? 'Payment')}</strong><span>{String(item.currency ?? '')} {String(item.amount ?? '')}{item.paidAt ? ` · Paid ${displayDate(String(item.paidAt).slice(0, 10))}` : ''}</span></article>)}</div>;
  if (orders.length) return <div className="seri-data-list">{orders.slice(0, 5).map((item, i) => <article key={String(item.id ?? i)}><strong>{String(item.orderNumber ?? 'Order')}</strong><span>{String(item.status ?? '')} · {String(item.currency ?? '')} {String(item.totalAmount ?? '')}</span></article>)}</div>;
  if (offers.length) return <div className="seri-data-list">{offers.slice(0, 4).map((item, i) => <article key={String(item.offerId ?? i)}><strong>{String(item.airlineCodes ?? 'Flight option')}</strong><span>{String(item.currency ?? '')} {String(item.totalAmount ?? '')} · shopping fare</span></article>)}</div>;
  return null;
}
