import { Link } from 'react-router-dom';

/** A reservation reference is available independently of payment and ticket issuance. */
export function BookingPnr({pnr, bookingId}: {pnr: string | null; bookingId: string}) {
  if (!pnr) return null;
  return <section className="checkout-pnr-confirmation" aria-label="Airline booking reference">
    <span>Booking reference (PNR)</span><strong>{pnr}</strong>
    <p>Keep this reference for your reservation. Check payment and ticket status before traveling.</p>
    <Link className="account-link" to={'/app/bookings/'+bookingId}>View my booking</Link>
  </section>;
}
