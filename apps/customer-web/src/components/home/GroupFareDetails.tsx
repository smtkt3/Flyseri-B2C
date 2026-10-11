import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { HomeAirlineOffer } from './AirlineOfferDetails';
import { activeGroupFare, groupFareMoney } from './groupFares';
import { DemoOfferCheckout } from './DemoOfferCheckout';

export function GroupFareDetails({ offer, onClose }: { offer: HomeAirlineOffer; onClose: () => void }) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const fare = activeGroupFare(offer.code);
  const [date, setDate] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [size, setSize] = useState(fare?.minimumTravellers ?? 1);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const today = new Date();
  const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const valid = Number.isInteger(size) && size >= (fare?.minimumTravellers ?? 1) && size <= (fare?.availableSeats ?? 999) && date >= minimumDate && (!fare?.travelDates?.length || fare.travelDates.includes(date));
  function continueOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string,string> = {};
    if (!date || date < minimumDate || (fare?.travelDates?.length && !fare.travelDates.includes(date))) next.date = 'Choose an available departure date.';
    if (!Number.isInteger(size) || size < (fare?.minimumTravellers ?? 1) || size > (fare?.availableSeats ?? 999)) next.size = `Enter ${fare?.minimumTravellers ?? 1}–${fare?.availableSeats ?? 999} travellers.`;
    setErrors(next);
    if (Object.keys(next).length) { document.getElementById(Object.keys(next)[0] === 'date' ? 'offer-date' : 'offer-size')?.focus(); return; }
    if (fare?.demo) setCheckout(true);
    else { navigate('/app/support?' + new URLSearchParams({topic:'Special flight offer enquiry',details}).toString()); onClose(); }
  }
  const details = `Please provide details of the special flight offer for DAC → ${offer.code} (${offer.city}), ${offer.name}. Preferred departure: ${date}. Travellers: ${size}. Please confirm travel dates, itinerary, baggage, taxes and payment terms.${fare ? ` Advertised fare: ${groupFareMoney(fare)} per person ${fare.tripType ? ` (${fare.tripType === 'RETURN' ? 'return' : 'one-way'})` : ''}.` : ''}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.current?.showModal(); document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="home-offer-dialog group-fare-dialog" aria-labelledby="group-fare-title" onCancel={onClose}>
    <div className="home-offer-heading"><img src={'/airlines/' + offer.airline + '.png'} alt=""/><div><h2 id="group-fare-title">Special Flight Offer · {offer.city}</h2><p>DAC → {offer.code} · {offer.name}</p></div><button type="button" aria-label="Close special flight offer details" onClick={onClose}>×</button></div>
    {checkout && fare?.demo ? <DemoOfferCheckout code={offer.code} city={offer.city} fare={fare} departure={date} travellers={size} onBack={() => setCheckout(false)}/> : <>
    {fare?.demo && <p className="special-offer-demo-label">Demo offer · illustrative price, dates and baggage</p>}
    <div className="group-fare-quote"><small>{fare ? 'From / person' : 'Plan your journey'}</small><strong>{fare ? groupFareMoney(fare) : 'Request an offer quote'}</strong><p>{fare?.demo ? "Try the booking experience with a five-minute demo hold. No airline seats are reserved." : "Our team will confirm the price and availability before you book."}</p></div>
    {fare && <dl><div><dt>Journey</dt><dd>{fare.tripType ? (fare.tripType === 'RETURN' ? 'Return' : 'One-way') : 'To be confirmed'}</dd></div><div><dt>Minimum travellers</dt><dd>{fare.minimumTravellers ? fare.minimumTravellers + (fare.minimumTravellers===1?' traveller':' travellers') : 'To be confirmed'}</dd></div><div><dt>Checked baggage</dt><dd>{fare.baggage ?? 'To be confirmed'}</dd></div><div><dt>Taxes</dt><dd>{fare.taxesIncluded === undefined ? 'To be confirmed' : fare.taxesIncluded ? 'Included' : 'Additional · confirm total with our team'}</dd></div></dl>}
    {!fare && <p className="home-offer-sample">Sample route · no published fare yet. Your quote will include the travel dates, baggage and applicable taxes.</p>}
    <form noValidate onSubmit={continueOffer}>
    <div className="group-fare-fields"><label>Preferred departure{fare?.travelDates?.length ? <select id="offer-date" aria-invalid={!!errors.date} aria-describedby={errors.date?'offer-date-error':undefined} value={date} onChange={event => {setDate(event.target.value);setErrors(current=>({...current,date:''}));}}><option value="">Choose date</option>{fare.travelDates.filter(value => value >= minimumDate).map(value => <option key={value} value={value}>{value}</option>)}</select> : <input id="offer-date" aria-invalid={!!errors.date} aria-describedby={errors.date?'offer-date-error':undefined} type="date" value={date} min={minimumDate} onChange={event => {setDate(event.target.value);setErrors(current=>({...current,date:''}));}}/>}{errors.date&&<small id="offer-date-error" className="checkout-field-error">{errors.date}</small>}</label><label>Number of travellers<input id="offer-size" aria-invalid={!!errors.size} aria-describedby={errors.size?'offer-size-error':undefined} type="number" inputMode="numeric" min={fare?.minimumTravellers ?? 1} max={fare?.availableSeats ?? 999} value={Number.isNaN(size) ? '' : size} onChange={event => {setSize(event.target.valueAsNumber);setErrors(current=>({...current,size:''}));}}/>{errors.size&&<small id="offer-size-error" className="checkout-field-error">{errors.size}</small>}</label></div>
    {fare && valid && <div className="special-offer-total"><span>{fare.taxesIncluded?'Total for your selection':'Fare subtotal'}<small>{size} traveller{size===1?'':'s'} · {date}{fare.demo?' · demo':''}</small></span><strong>{groupFareMoney({...fare,amountPerPerson:fare.amountPerPerson*size})}</strong></div>}
    {fare && <p className="group-fare-hint">{fare.taxesIncluded?'Taxes included.':'Any additional taxes and charges must be confirmed.'} {fare.availableSeats===undefined?'Availability will be confirmed.':`${fare.availableSeats} ${fare.demo?'sample seats':'advertised seats'} · subject to confirmation.`} Changes and refunds depend on the confirmed fare conditions.</p>}
    <button className="home-offer-search" type="submit">{fare?.demo?'Continue to demo booking':'Enquire about this offer'}</button>
    </form>
    <p className="group-fare-hint"><Link to="/help#booking-information" onClick={onClose}>Read booking and payment information</Link></p>
    <p className="group-fare-hint">{fare?.demo ? "Choose a travel date and number of travellers to try the demo. No payment is collected." : "You’ll review your request before sending. This does not reserve seats or collect payment."}</p>
    </>}
  </dialog>, document.body);
}
