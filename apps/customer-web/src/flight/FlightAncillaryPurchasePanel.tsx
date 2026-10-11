import { Chevron } from '../components/Chevron';
import { Translated } from '../travel/language';
import { useEffect, useRef, useState } from 'react';
import type { FlightAncillaryPurchase, FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { usePreferredDisplayPrices } from './usePreferredDisplayPrices';
import './FlightAirlineServices.css';

export function FlightAncillaryPurchasePanel({ booking, onChange, readOnly = false }: { booking: FlightBooking; onChange?: (purchase: FlightAncillaryPurchase | undefined) => void; readOnly?: boolean }) {
  const [review, setReview] = useState(booking.ancillaryPurchase);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const sending = useRef(false);
  const canReview = !readOnly && !booking.order && !!booking.pnr && ['PNR_CREATED', 'AWAITING_PAYMENT'].includes(booking.status);
  const needsReview = !!booking.ancillaryRequests?.length;
  const display = usePreferredDisplayPrices([
    ...(review?.items ?? []).map(item => ({amount:item.checkoutAmount,currency:review!.currency})),
    {amount:review?.airfareAmount ?? null,currency:review?.currency ?? booking.currency},
    {amount:review?.extrasAmount ?? null,currency:review?.currency ?? booking.currency},
    {amount:review?.totalAmount ?? null,currency:review?.currency ?? booking.currency},
  ]);
  const price = (index: number) => { const value=display.prices[index]; return value?.amount != null ? `${value.estimated ? '≈ ' : ''}${new Intl.NumberFormat('en-MY',{style:'currency',currency:display.currency,currencyDisplay:'code'}).format(Number(value.amount))}` : display.failed ? 'Price unavailable' : `Updating ${display.currency}…`; };
  useEffect(() => { setReview(booking.ancillaryPurchase); }, [booking.id, booking.ancillaryPurchase]);
  useEffect(() => {
    if (!review || !canReview || !['PREPARED', 'PRICE_CHANGED', 'CONFIRMED'].includes(review.status)) return;
    const remaining = Date.parse(review.expiresAt) - Date.now();
    setNow(Date.now());
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 20);
    return () => window.clearTimeout(timer);
  }, [review, canReview]);
  useEffect(() => {
    if (!canReview || !needsReview || booking.ancillaryPurchase) return;
    let active = true; setBusy(true); setError('');
    void flightService.reviewExtras(booking.id).then(value => { if (active) { setReview(value); onChange?.(value); } }, cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not review airline extras.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // The booking identity defines this one automatic price review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id, canReview, needsReview]);
  if (!needsReview) return null;
  async function perform(action: 'review' | 'confirm' | 'skip' | 'reconcile') {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const value = action === 'confirm' ? await flightService.confirmExtras(booking.id, review!.id) : action === 'skip' ? await flightService.skipExtras(booking.id) : action === 'reconcile' ? await flightService.reconcileExtras(booking.id) : await flightService.reviewExtras(booking.id, true);
      setReview(value); onChange?.(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Airline extras could not be updated.');
      if (action === 'confirm') { try { const updated = await flightService.booking(booking.id); setReview(updated.ancillaryPurchase); onChange?.(updated.ancillaryPurchase); } catch { /* Retain the error and prevent a blind repeat. */ } }
    } finally { sending.current = false; setBusy(false); }
  }
  const confirmed = !!review && ['CONFIRMED', 'FULFILLMENT_PENDING', 'FULFILLED'].includes(review.status);
  const expired = !!review && Date.parse(review.expiresAt) <= now;
  const flights = new Map<string, NonNullable<typeof review>['items']>();
  for (const item of review?.items ?? []) { const flight = item.segmentLabels.join(' / '); flights.set(flight, [...(flights.get(flight) ?? []), item]); }
  return <section className="flight-selected-extras flight-extra-purchase" aria-label="Review and purchase airline extras" aria-busy={busy}>
    <h3>{confirmed ? 'Your airline extras' : review?.status === 'SKIPPED' ? 'Ticket only' : 'Review airline extras'}</h3>
    {busy && <p role="status">Checking your airline extras…</p>}
    {error && <p role="alert">{error}</p>}
    {!readOnly && review?.message && <p role="status">{review.message}</p>}
    {canReview && expired && ['PREPARED', 'PRICE_CHANGED', 'CONFIRMED'].includes(review!.status) && <p role="status">The price review expired. Refresh prices before continuing; attached extras will not be added again.</p>}
    {[...flights].map(([flight, items], index) => <details className="flight-airline-offers-flight" key={flight} open={index === 0}><summary><strong>{flight}</strong><span aria-hidden="true"><Chevron/></span></summary><div className="flight-extra-purchase-items">{items.map(item => <div className="flight-selected-extra" key={item.requestId}><div><strong>{item.name}</strong><small>Traveler {item.passengerIndexes.map(index => index + 1).join(', ')}</small></div><span>{price(review!.items.indexOf(item))}</span></div>)}</div></details>)}
    {!!review?.items.length && <><div className="flight-selected-extra-total"><span><Translated text="Flights" /></span><strong>{price(review.items.length)}</strong></div><div className="flight-selected-extra-total"><span>Airline extras</span><strong>{price(review.items.length+1)}</strong></div><div className="flight-selected-extra-total"><span>{confirmed ? 'Total with extras' : 'Reviewed total'}</span><strong>{price(review.items.length+2)}</strong></div>{display.prices.at(-1)?.estimated && <p>Converted estimate in {display.currency}.</p>}</>}
    {confirmed && <p>{review!.status === 'FULFILLED' ? 'Extra-service documents have been verified.' : 'Extras attached to the airline reservation. Document issuance is pending.'}</p>}
    {canReview && (!review || ['PREPARED', 'UNAVAILABLE', 'PRICE_CHANGED'].includes(review.status) || review.status === 'CONFIRMED' && expired) && <div className="flight-extra-purchase-actions">
      {review && ['PREPARED', 'PRICE_CHANGED'].includes(review.status) && <button type="button" className="btn-primary" disabled={busy || expired} onClick={() => void perform('confirm')}>{review.status === 'PRICE_CHANGED' ? 'Accept updated total' : 'Add extras & accept total'}</button>}
      {(!review || ['PREPARED', 'UNAVAILABLE'].includes(review.status)) && <button type="button" className="account-outline-button" disabled={busy} onClick={() => void perform('skip')}>Continue with ticket only</button>}
      <button type="button" className="account-outline-button" disabled={busy} onClick={() => void perform('review')}>Refresh extra prices</button>
    </div>}
    {!readOnly && review && ['ADDING', 'UNKNOWN'].includes(review.status) && <><p>The airline result needs verification. Another purchase will not be sent.</p><button type="button" className="account-outline-button" disabled={busy} onClick={() => void perform('reconcile')}>Check airline result</button></>}
  </section>;
}
