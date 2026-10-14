import { Translated } from '../travel/language';
import { useRef, useState } from 'react';
import type { FlightOffer } from '@flyseri/types';
import { AirlineIdentity } from './AirlineIdentity';
import { FlightBaggageDetails, hasKnownBaggage } from './FlightFareInformation';
import { useFlightDialog } from './flightUiHooks';
import { cabinLabel, dateTime, legsOf, minutes, money, penaltySummary } from './flightPresentation';

export default function FlightComparison({ offers, passengerLabel, finalLeg, onClose, onChoose, onRemove }: {
  offers: FlightOffer[]; passengerLabel: string; finalLeg: boolean;
  onClose: () => void; onChoose: (offer: FlightOffer) => void; onRemove: (id: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  useFlightDialog(true, panel, onClose);
  const signature = (fare: FlightOffer, label: string) => {
    if (label === 'Total price') return JSON.stringify([fare.currency, Number(fare.totalAmount)]);
    if (label === 'Cabin & fare') return JSON.stringify([fare.cabin, fare.fareBrand]);
    if (label === 'Itinerary') return JSON.stringify(legsOf(fare).map(leg=>[leg.durationMinutes,leg.stops,leg.segments.map(segment=>[segment.origin,segment.destination,segment.departureAt,segment.arrivalAt,segment.marketingCarrier,segment.flightNumber])]));
    if (label === 'Baggage') return JSON.stringify(legsOf(fare).flatMap(leg => leg.segments).map((_, index) =>
      (fare.baggageAllowances ?? []).filter(item => item.availability!=='UNKNOWN'&&(!item.segmentIndexes?.length || item.segmentIndexes.includes(index)))
        .map(item => [item.type, item.availability, item.description]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
    return JSON.stringify(penaltySummary(fare, label === 'Cancellation' ? 'REFUND' : 'CHANGE').sort());
  };
  const rows: { label: string; content: (fare: FlightOffer) => React.ReactNode }[] = [
    { label: 'Total price', content: fare => <strong className="flight-comparison-price">{money(fare.totalAmount, fare.currency)}</strong> },
    { label: 'Cabin & fare', content: fare => <>{cabinLabel(fare.cabin)}{fare.fareBrand && <small>{fare.fareBrand}</small>}</> },
    { label: 'Itinerary', content: fare => legsOf(fare).map((leg, index) => <div className="flight-comparison-leg" key={index}><strong>{leg.segments[0]?.origin} → {leg.segments.at(-1)?.destination}</strong><span>{dateTime(leg.segments[0]!.departureAt)}<br/>{dateTime(leg.segments.at(-1)!.arrivalAt)}</span><small>{minutes(leg.durationMinutes)} · {leg.stops === 0 ? 'Direct' : `${leg.stops} ${leg.stops === 1 ? 'stop' : 'stops'}`}</small></div>) },
    { label: 'Baggage', content: fare => hasKnownBaggage(fare) ? <FlightBaggageDetails offer={fare} knownOnly/> : <span className="flight-comparison-unknown">Not provided for this fare</span> },
    { label: 'Cancellation', content: fare => { const policies = penaltySummary(fare, 'REFUND'); return policies.length ? policies.map(value => <p key={value}>{value}</p>) : <span className="flight-comparison-unknown">Conditions not provided</span>; } },
    { label: 'Changes', content: fare => { const policies = penaltySummary(fare, 'CHANGE'); return <>{policies.length ? policies.map(value => <p key={value}>{value}</p>) : <span className="flight-comparison-unknown">Conditions not provided</span>}{fare.penalties?.some(rule => rule.type === 'CHANGE' && rule.allowed) && <small>Fare difference may apply.</small>}</>; } },
  ];
  const differingRows = new Set(rows.filter(row => new Set(offers.map(fare => signature(fare, row.label))).size > 1).map(row => row.label));
  const visibleRows = rows.filter(row => !differencesOnly || differingRows.has(row.label));
  return <div className="flight-fare-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="flight-comparison-dialog" role="dialog" aria-modal="true" aria-labelledby="flight-comparison-title" tabIndex={-1}>
      <header className="flight-fare-drawer-head"><div><h2 id="flight-comparison-title"><Translated text="Compare fares" /></h2><p>Complete-trip totals for {passengerLabel}</p></div><button type="button" className="flight-fare-drawer-close" aria-label="Close fare comparison" onClick={onClose}>×</button></header>
      <div className="flight-comparison-body">{offers.length < 2 && <p role="status">Add another fare to compare prices and conditions.</p>}
        {offers.length>1&&<div className="flight-comparison-controls"><p>Highlighted rows show differences in the reported fares.</p><label><input type="checkbox" checked={differencesOnly} onChange={event=>setDifferencesOnly(event.target.checked)}/>Show differences only</label></div>}
        {differencesOnly&&!visibleRows.length&&<p role="status">These fares have the same reported prices and conditions.</p>}
        {offers.length > 0 && <div className="flight-comparison-mobile">
          <nav className="flight-comparison-shortcuts" aria-label="Jump to a fare option">
            {offers.map((fare, index) => <button type="button" key={fare.offerId}
              aria-label={`View option ${index + 1}, ${money(fare.totalAmount, fare.currency)}`}
              onClick={() => panel.current?.querySelector(`[data-comparison-option="${index}"]`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>
              <span>Option {index + 1}</span><strong>{money(fare.totalAmount, fare.currency)}</strong>
            </button>)}
          </nav>
          <div className="flight-comparison-cards">{offers.map((fare, index) => {
            const unavailable = legsOf(fare).some(leg => leg.segments.some(segment => segment.seatsAvailable === 0));
            return <article className="flight-comparison-card" data-comparison-option={index} key={fare.offerId} aria-label={`Fare option ${index + 1}`}>
              <div className="flight-comparison-card-top"><span>Option {index + 1}</span><button type="button" onClick={() => onRemove(fare.offerId)} aria-label={`Remove option ${index + 1} from comparison`}><Translated text="Remove" /></button></div>
              <div className={`flight-comparison-card-summary${differingRows.has('Total price')?' flight-comparison-difference':''}`}><AirlineIdentity codes={fare.airlineCodes}/><div><small>Total price{differingRows.has('Total price')&&<span className="flight-difference-label">Differs</span>}</small><strong className="flight-comparison-price">{money(fare.totalAmount, fare.currency)}</strong></div></div>
              <dl className="flight-comparison-card-details">{visibleRows.filter(row=>row.label!=='Total price').map(row => <div key={row.label} className={differingRows.has(row.label)?'flight-comparison-difference':undefined}><dt>{row.label}{differingRows.has(row.label)&&<small className="flight-difference-label">Differs</small>}</dt><dd>{row.content(fare)}</dd></div>)}</dl>
              <button type="button" className="btn-primary flight-comparison-card-select" disabled={unavailable} onClick={() => onChoose(fare)}>{unavailable ? 'Fare unavailable' : finalLeg ? 'Select fare' : 'Choose this flight'}</button>
            </article>;
          })}</div>
        </div>}
        {offers.length > 0 && <div className="flight-comparison-table-wrap" tabIndex={0} role="region" aria-label="Fare comparison table"><table className="flight-comparison-table"><caption className="sr-only">Price, baggage and fare conditions for your selected flights</caption><thead><tr><th scope="col">Fare details</th>{offers.map((fare, index) => <th scope="col" key={fare.offerId}><AirlineIdentity codes={fare.airlineCodes}/><span className="flight-comparison-number">Option {index + 1}</span><button type="button" onClick={() => onRemove(fare.offerId)} aria-label={`Remove option ${index + 1} from comparison`}><Translated text="Remove" /></button></th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.label} className={differingRows.has(row.label)?'flight-comparison-difference':undefined}><th scope="row">{row.label}{differingRows.has(row.label)&&<small className="flight-difference-label">Differs</small>}</th>{offers.map(fare => <td key={fare.offerId}>{row.content(fare)}</td>)}</tr>)}<tr><th scope="row">Select</th>{offers.map(fare => { const unavailable = legsOf(fare).some(leg => leg.segments.some(segment => segment.seatsAvailable === 0)); return <td key={fare.offerId}><button type="button" className="btn-primary" disabled={unavailable} onClick={() => onChoose(fare)}>{unavailable ? 'Fare unavailable' : finalLeg ? 'Select fare' : 'Choose this flight'}</button></td>; })}</tr></tbody></table></div>}
        <p className="flight-fare-disclaimer">Prices and availability are checked before reservation. Conditions apply to the flights and fare shown.</p>
      </div>
    </section>
  </div>;
}

