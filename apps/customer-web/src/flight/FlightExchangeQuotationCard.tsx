import {Link} from 'react-router-dom';
import type {FlightExchangeQuotation} from '@flyseri/types';
import {formatMoney} from '../account/presentation';
import './flight-exchange-quotation.css';

export function FlightExchangeQuotationCard({quotation,checkout=false}:{quotation:FlightExchangeQuotation;checkout?:boolean}){
  const expired=quotation.status==='EXPIRED'||!!quotation.expiresAt&&Date.parse(quotation.expiresAt)<=Date.now()&&!['PAID','COMPLETED'].includes(quotation.status);
  const status=expired?'EXPIRED':quotation.status;
  const labels={PAYMENT_REQUIRED:'Payment required',PAYMENT_PROCESSING:'Payment in progress',PAID:'Payment received',COMPLETED:'Reissue completed',EXPIRED:'Quotation expired',REVIEW_REQUIRED:'Under review'};
  const deadline=quotation.expiresAt?new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(quotation.expiresAt)):null;
  return <section className="flight-exchange-quotation" aria-label="Flight change quotation">
    <div className="flight-exchange-quotation-heading"><div><p className="account-eyebrow">FLIGHT CHANGE</p><h2>Your exchange quotation</h2></div><span className={'flight-exchange-quotation-status is-'+status.toLowerCase()}>{labels[status]}</span></div>
    <div className="flight-exchange-quotation-flights">{quotation.flights.map((flight,index)=><div key={index}><strong>{flight.origin} → {flight.destination}</strong><span>{flight.airline} {flight.number} · {flight.departureDate} · {flight.departureTime.slice(0,5)}–{flight.arrivalTime.slice(0,5)}</span></div>)}</div>
    <div className="flight-exchange-quotation-total"><div><span>Additional payment</span><strong>{formatMoney(quotation.amount,quotation.currency)}</strong></div>{deadline&&!['PAID','COMPLETED'].includes(status)&&<small>{expired?'Payment window closed':'Pay by '+deadline}</small>}</div>
    <p className="account-muted">{status==='COMPLETED'?'Your additional payment and replacement ticket reissue are complete.':status==='PAID'?'Your additional payment is confirmed. Flyseri will verify and issue the replacement ticket.':status==='EXPIRED'?'Ask Flyseri to check the fare again before paying.':status==='REVIEW_REQUIRED'?'Flyseri is reviewing this change. Payment is unavailable until the quotation is verified.':status==='PAYMENT_PROCESSING'?'Check your existing payment before trying again.':'Review the replacement flights and additional amount. Reissue follows confirmed payment. Your original payment is kept separately.'}</p>
    {!checkout&&<Link className={status==='PAYMENT_REQUIRED'?'btn-primary':'account-outline-button'} to={'/app/orders/'+quotation.orderId}>{status==='PAYMENT_REQUIRED'?`Review & pay ${formatMoney(quotation.amount,quotation.currency)} →`:status==='PAYMENT_PROCESSING'?'Check payment status →':'View quotation & payment →'}</Link>}
    {checkout&&<Link className="account-link" to={'/app/bookings/'+quotation.bookingId}>View original booking →</Link>}
  </section>;
}
