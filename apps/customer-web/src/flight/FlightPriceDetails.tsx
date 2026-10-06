import type { FlightOffer, FlightSearchRequest, FlightServicePreferences, FlightAncillaryRequest } from '@flyseri/types';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flightMoney as money, flightPriceSummary, type PurchasedFlightExtra } from './flightPriceSummary';
import { FlightMealDetails } from './FlightMealDetails';
import { FlightSelectedExtras } from './FlightSelectedExtras';
const bagNames = { PERSONAL_ITEM: 'Personal item', CARRY_ON: 'Carry-on baggage', CHECKED: 'Checked baggage' };
const mealNames = { VEGETARIAN: 'Vegetarian meal', VEGAN: 'Vegan meal', HALAL: 'Halal meal', GLUTEN_FREE: 'Gluten-free meal' };
const typeNames = { ADT: 'Adult', CNN: 'Child', INF: 'Infant' };

export function FlightPriceDetails({ offer, search, purchasedExtras = [], requests = [], selectedExtras = [], onClose, onEstimatedTripTotal }: {
  offer: FlightOffer; search: FlightSearchRequest; purchasedExtras?: PurchasedFlightExtra[]; requests?: FlightServicePreferences[]; selectedExtras?: FlightAncillaryRequest[]; onClose?: () => void; onEstimatedTripTotal?: (total:{amount:number;currency:string}|null)=>void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [ancillaryTotal,setAncillaryTotal]=useState<{amount:number;currency:string}|null>(null);
  const reportAncillaryTotal=useCallback((total:{amount:number;currency:string}|null)=>{setAncillaryTotal(total);onEstimatedTripTotal?.(total);},[onEstimatedTripTotal]);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // Measure the rendered height, including expanded meals and ticket details.
    const updateHeight = () => card.style.setProperty('--flight-price-card-height', `${card.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const price = flightPriceSummary(offer, search, purchasedExtras);
  const travelers = [`${search.adults} ${search.adults === 1 ? 'adult' : 'adults'}`, ...(search.children ? [`${search.children} ${search.children === 1 ? 'child' : 'children'}`] : []), ...(search.infants ? [`${search.infants} ${search.infants === 1 ? 'infant' : 'infants'}`] : [])].join(', ');
  const segments = (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap(leg => leg.segments);
  const bags = (offer.baggageAllowances ?? []).filter(bag => bag.availability !== 'UNKNOWN');
  const meals = (offer.amenities ?? []).filter(service => service.category === 'MEALS' && service.availability !== 'UNKNOWN');
  const hasRequests = requests.some(value => value.baggage !== 'NONE' || value.meal !== 'NONE');
  let passengerIndex = 0;
  const extraRows = (category: PurchasedFlightExtra['category']) => price.extras.filter(extra => extra.category === category).map(extra =>
    <div className="guest-price-service-row" key={extra.id}><div><span>{extra.description}</span><small>{extra.passengerIndexes.length ? `Passenger ${extra.passengerIndexes.map(index => index + 1).join(', ')}` : 'All travelers'}{extra.quantity > 1 ? ` · ${extra.quantity} units` : ''}</small></div><strong>{Number(extra.totalAmount) === 0 ? 'Free' : money(extra.totalAmount, offer.currency)}</strong></div>);
  return <aside ref={cardRef} className="guest-checkout-price-card guest-price-reference" aria-label="Price details">
    <div className="guest-price-title-row"><h2>Price details</h2>{onClose && <button type="button" className="guest-price-close" aria-label="Close price details" onClick={onClose}>×</button>}</div>
    <div className="guest-price-scroll">
    <details className="guest-price-tickets" open><summary><span>Tickets <span className="guest-price-count">({travelers})</span><i aria-hidden="true" /></span><strong>{money(offer.totalAmount, offer.currency)}</strong></summary>
      <div className="guest-price-ticket-body">{price.passengerPrices.length ? price.passengerPrices.map((person, index) => {
        const first = passengerIndex + 1; passengerIndex += person.count;
        return <div className="guest-price-passenger-group" key={`${person.passengerType}-${index}`}>
          <div className="guest-price-passenger-title"><span>{typeNames[person.passengerType]}{person.count > 1 ? 's' : ''} (Passenger{person.count > 1 ? 's' : ''} {first}{person.count > 1 ? `–${passengerIndex}` : ''})</span><span>{money(person.totalAmount, offer.currency)} <small>× {person.count}</small></span></div>
          <dl className="guest-price-breakdown"><div><dt>Fare</dt><dd>{money(person.baseFareAmount, offer.currency)} <span>× {person.count}</span></dd></div><div><dt>Taxes &amp; fees</dt><dd>{money(person.taxesAndFeesAmount, offer.currency)} <span>× {person.count}</span></dd></div></dl>
        </div>;
      }) : <dl className="guest-price-breakdown">{price.validBreakdown && offer.priceBreakdown ? <><div><dt>Fare</dt><dd>{money(offer.priceBreakdown.baseFareAmount, offer.currency)}</dd></div><div><dt>Taxes &amp; fees</dt><dd>{money(offer.priceBreakdown.taxesAndFeesAmount, offer.currency)}</dd></div></> : <div><dt>Airfare</dt><dd>{money(offer.totalAmount, offer.currency)}</dd></div>}</dl>}</div>
    </details>
    {(bags.length > 0 || price.extras.some(extra => extra.category === 'BAGGAGE') || requests.some(value => value.baggage !== 'NONE')) && <section className="guest-price-services" aria-label="Baggage price details"><h3>Baggage</h3>
      {bags.map((bag, index) => <div className="guest-price-service-row" key={`${bag.type}-${index}`}><div><span>{bagNames[bag.type]}</span>{bag.description && <small>{bag.description}</small>}{bag.segmentIndexes.length > 0 && segments.length > 1 && <small>{bag.segmentIndexes.map(index => `${segments[index]?.origin} → ${segments[index]?.destination}`).join(' / ')}</small>}</div><span className={bag.availability === 'INCLUDED' ? 'guest-price-free' : 'guest-price-unavailable'}>{bag.availability === 'INCLUDED' ? 'Free' : 'Not included'}</span></div>)}
      {extraRows('BAGGAGE')}{requests.map((request, index) => request.baggage !== 'NONE' && <div className="guest-price-service-row guest-price-request" key={index}><div><span>Extra checked baggage</span><small>Passenger {index + 1}</small></div><span>Requested</span></div>)}
    </section>}
    {(meals.length > 0 || price.extras.some(extra => extra.category === 'MEAL') || requests.some(value => value.meal !== 'NONE')) && <section className="guest-price-services" aria-label="Meal price details"><h3>Meals</h3>
      <FlightMealDetails offer={offer} knownOnly />
      {extraRows('MEAL')}{requests.map((request, index) => request.meal !== 'NONE' && <div className="guest-price-service-row guest-price-request" key={index}><div><span>{mealNames[request.meal]}</span><small>Passenger {index + 1}</small></div><span>Requested</span></div>)}
    </section>}
    {price.extras.some(extra => extra.category === 'OTHER') && <section className="guest-price-services"><h3>Other extras</h3>{extraRows('OTHER')}</section>}
    {hasRequests && <p className="guest-price-request-note">Requested services are awaiting airline confirmation and are not charged.</p>}
    <FlightSelectedExtras requests={selectedExtras} airfare={{amount: offer.totalAmount, currency: offer.currency}} onEstimatedTripTotal={reportAncillaryTotal}/>
    {price.invalidExtras && <p className="guest-price-request-note" role="status">An extra charge needs confirmation before the total can be shown.</p>}
    </div>
    <footer className="guest-price-sticky-footer">
      {selectedExtras.length ? <><div className="guest-checkout-total"><strong>Estimated total with extras</strong><strong>{ancillaryTotal ? money(String(ancillaryTotal.amount),ancillaryTotal.currency) : 'Awaiting prices'}</strong></div><p>Airfare + {selectedExtras.length} selected extra{selectedExtras.length===1?'':'s'} · estimate in your chosen currency</p></> : <><div className="guest-checkout-total"><strong>Total</strong><strong>{price.totalAmount ? money(price.totalAmount, offer.currency) : 'Awaiting price confirmation'}</strong></div><p>{offer.currency} · Total for all travelers and flights</p></>}
    </footer>
  </aside>;
}
