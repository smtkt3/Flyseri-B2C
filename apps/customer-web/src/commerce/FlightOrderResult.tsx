import { Link } from 'react-router-dom';
import type { FlightBooking, OrderDetail } from '@flyseri/types';
import { formatMoney, formatTimestamp } from '../account/presentation';
import { AirlineIdentity } from '../flight/AirlineIdentity';
import { bookingHasIssuedTickets, bookingLegs, type BookingOutcome } from '../flight/bookingPresentation';
import { ReviewFlightLeg } from '../flight/ReviewFlightLeg';
import { FlightBaggageDetails, FlightServiceDetails } from '../flight/FlightFareInformation';
import { FlightAncillaryPurchasePanel } from '../flight/FlightAncillaryPurchasePanel';
import { FlightTicketIssuanceNotice } from '../flight/FlightTicketIssuanceNotice';
import { serviceRequestSummary } from '../flight/FlightServiceRequests';
import { TravelCompanion } from '../travel/TravelCompanion';
import { PaymentReceiptActions } from './PaymentReceiptActions';
import '../flight/flight-review-page.css';
import './flight-order-result.css';

/** Payment comes from the order; ticket completion requires actual issued documents. */
export function FlightOrderResult({order, booking, paid, outcome, ticketingAvailable, refreshing, onRefresh, canPay, paymentConfirmed, onPaymentConfirmed, startingPayment, onPay}: {
  order: OrderDetail; booking: FlightBooking; paid: boolean; outcome: BookingOutcome;
  ticketingAvailable: boolean;
  refreshing: boolean; onRefresh: () => void; canPay: boolean;
  paymentConfirmed: boolean; onPaymentConfirmed: (value: boolean) => void;
  startingPayment: boolean; onPay: () => void;
}) {
  const issued = bookingHasIssuedTickets(booking);
  const reserved = !!booking.pnr && !['BOOKING_FAILED','CANCELLED','PNR_EXPIRED'].includes(booking.status);
  const review = !booking.pnr || ['BOOKING_UNKNOWN','BOOKING_FAILED','CANCELLED','PNR_EXPIRED','TICKETING_FAILED','REFUND_REQUIRED'].includes(booking.status) || booking.status === 'TICKETED' && !issued;
  const failed = outcome === 'unsuccessful';
  const title = failed ? 'Your booking needs attention' : paid ? issued ? 'Your booking is confirmed' : 'Payment received' : 'We’re checking your payment';
  const badge = failed ? 'Unsuccessful' : paid && issued ? 'Confirmed' : review ? 'Booking under review' : paid ? 'Ticket pending' : 'Payment pending';
  const description = failed ? paid ? 'Your payment is recorded, but the booking could not be completed. Contact Flyseri for help with the next step.' : 'This checkout was not completed. Review the payment status below before trying again.'
    : paid ? issued ? 'Your airline ticket has been issued. Review your itinerary and ticket documents before traveling.' : review ? 'Your payment is recorded, but your reservation needs attention. Contact Flyseri for help; please do not pay again.' : 'Your payment is confirmed. Flyseri will issue your ticket within 6 hours and send it to your booking email and My bookings in the app.'
    : 'We haven’t confirmed payment yet. This page will update when the payment result is available. Please do not start another booking.';
  const supportUrl = `/app/support?bookingId=${encodeURIComponent(booking.id)}`;
  const extrasIncluded = ['CONFIRMED','FULFILLMENT_PENDING','FULFILLED'].includes(booking.ancillaryPurchase?.status ?? '');
  const legs = bookingLegs(booking);
  return <div className="flight-order-result">
    <section className={`result-hero${failed ? ' is-attention' : paid ? ' is-paid' : ''}`} aria-label="Booking result" aria-live="polite">
      <div className="result-hero-heading"><span className="result-hero-icon" aria-hidden="true">{failed ? '!' : paid ? '✓' : '◷'}</span><div><span className={`result-badge${issued && !failed ? ' is-confirmed' : ''}`}>{badge}</span><h2>{title}</h2><p>{description}</p></div></div>
      <div className="result-reference-row"><section aria-label="Airline booking reference"><span>Booking reference (PNR)</span><strong>{booking.pnr ?? 'Awaiting confirmation'}</strong></section><div className="result-hero-actions"><Link className="btn-primary" to={`/app/bookings/${booking.id}`}>Manage booking</Link><Link className="account-outline-button" to={supportUrl}>Get help</Link></div></div>
      <dl className="result-milestones" aria-label="Reservation, payment and ticket status">
        {[{label:'Reservation',value:reserved ? 'Reserved' : 'Needs review',done:reserved},{label:'Payment',value:paid ? 'Received' : failed ? 'Not confirmed' : 'Being checked',done:paid},{label:'Airline ticket',value:issued ? 'Issued' : review ? 'Awaiting review' : 'Not issued yet',done:issued}].map(item => <div key={item.label} className={item.done ? 'is-done' : ''}><span aria-hidden="true">{item.done ? '✓' : '◷'}</span><div><dt>{item.label}</dt><dd>{item.value}</dd></div></div>)}
      </dl>
    </section>
    {order.payment?.provider === 'STRIPE_TEST' && <p className="result-test-note"><strong>Test booking</strong> No real money is collected. This booking is not valid for travel.</p>}
    <div className="result-layout">
      <div className="result-main">
        <section className="result-panel result-itinerary flight-review-page" aria-label="Your itinerary"><div className="result-section-heading"><h2>Your itinerary</h2><AirlineIdentity codes={booking.selectedOffer.airlineCodes}/></div>
          {legs.map((leg,index) => <ReviewFlightLeg key={index} leg={leg} title={booking.selectedOffer.multiCityLegs ? `Flight ${index+1}` : index === 0 ? 'Outbound' : 'Return'}/>)}
          <details className="result-details"><summary>Travelers · {booking.passengerNames.length}</summary><ul className="result-travelers">{booking.passengerNames.map((name,index) => <li key={index}><span>{index+1}</span><strong>{name}</strong></li>)}</ul></details>
          <details className="result-details"><summary>Baggage &amp; included services</summary><FlightBaggageDetails offer={booking.selectedOffer}/><FlightServiceDetails offer={booking.selectedOffer}/>
            {!!booking.serviceRequests?.length && <><h3>Service requests</h3><ul>{booking.serviceRequests.map(request=><li key={request.travellerId}>{request.passengerName}: {serviceRequestSummary(request)}</li>)}</ul><p>Subject to airline confirmation.</p></>}
          </details>
          {extrasIncluded && <details className="result-details"><summary>Your selected extras</summary><FlightAncillaryPurchasePanel booking={booking} readOnly/></details>}
          {!!booking.ancillaryRequests?.length && !extrasIncluded && <div className="result-extras-note"><strong>Extra requests not purchased</strong><p>No charge for these extra requests is included in your payment.</p><ul>{booking.ancillaryRequests.map(extra=><li key={extra.id}>{extra.name} · {extra.segmentLabels.join(' / ')}</li>)}</ul></div>}
        </section>
        <section className="result-panel result-next"><h2>What happens next?</h2>
          {paid ? <FlightTicketIssuanceNotice booking={booking} paidAt={order.paidAt} ticketingAvailable={ticketingAvailable}/> : <p>{failed ? 'If your bank shows a charge, contact Flyseri with your order number before paying again.' : 'We’re checking the payment result automatically. Keep this booking and wait for confirmation before paying again.'}</p>}
          {!paid && <button className="account-outline-button" disabled={refreshing || startingPayment} onClick={onRefresh}>{refreshing ? 'Checking payment…' : 'Check payment status'}</button>}
          {canPay && <div className="result-retry"><label className="checkout-confirmation"><input type="checkbox" checked={paymentConfirmed} onChange={event=>onPaymentConfirmed(event.target.checked)}/><span>I reviewed the total and traveler details. I understand this is a test payment.</span></label><button className="btn-primary" disabled={!paymentConfirmed || refreshing || startingPayment} onClick={onPay}>{startingPayment ? 'Opening secure checkout…' : `Continue payment · ${formatMoney(order.totalAmount,order.currency)}`}</button></div>}
          <TravelCompanion booking={booking} toolsOnly/>
        </section>
      </div>
      <aside className="result-panel result-payment" aria-label="Order summary"><h2>Payment summary</h2><dl className="result-order-facts"><div><dt>Order number</dt><dd>{order.orderNumber}</dd></div>{paid && <div><dt>Payment date</dt><dd>{formatTimestamp(order.paidAt)}</dd></div>}</dl>
        {order.items.map(item=><div className="result-price-line" key={item.id}><span>{item.description}</span><strong>{formatMoney(item.totalAmount,item.currency)}</strong></div>)}
        {Number(order.discountAmount)>0 && <div className="result-price-line"><span>Discounts</span><strong>−{formatMoney(order.discountAmount!,order.currency)}</strong></div>}
        <div className="result-total"><span>{paid ? 'Total paid' : 'Order total'}</span><strong>{formatMoney(order.totalAmount,order.currency)}</strong></div><p className="result-payment-caption">{paid ? 'Payment received. Ticket status is shown separately.' : 'No payment has been confirmed yet.'}</p>
        {paid && <PaymentReceiptActions key={order.id} order={order} booking={booking}/>}
        <div className="result-support"><strong>Need help with your trip?</strong><p>Contact Flyseri with your booking reference.</p><Link to={supportUrl}>Contact support →</Link></div>
      </aside>
    </div>
  </div>;
}
