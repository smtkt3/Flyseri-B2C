import { useEffect, useState, type CSSProperties } from 'react';
import './aircraft-seat-map.css';

/** Normalized provider geometry. Null columns are supplier-reported aisles; absent seats are gaps. */
import type {AircraftCabinLayout,AircraftSeat,AircraftSeatMapData} from '@flyseri/types';
export type {AircraftCabinLayout,AircraftSeat,AircraftSeatMapData} from '@flyseri/types';

/** Rendering only. Selection callbacks must be connected to server-validated airline quotes. */
export function AircraftSeatMap({map,travelerId,selectedSeatIds=[],onSelect,onRefresh,disabled=false}:{
  map:AircraftSeatMapData;travelerId?:string;selectedSeatIds?:string[];
  onSelect?:(seat:AircraftSeat)=>void;onRefresh?:()=>void;disabled?:boolean;
}) {
  const [deckId,setDeckId]=useState(map.decks[0]?.id);
  const [now,setNow]=useState(Date.now);
  const [inspected,setInspected]=useState<AircraftSeat|null>(null);
  useEffect(()=>setInspected(null),[map]);
  useEffect(()=>{setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[map.expiresAt]);
  const expired=!Number.isFinite(Date.parse(map.expiresAt))||Date.parse(map.expiresAt)<=now;
  const deck=map.decks.find(value=>value.id===deckId)??map.decks[0];
  const priceLabel=(seat:AircraftSeat)=>{
    if(!seat.price||!Number.isFinite(Number(seat.price.amount))||Number(seat.price.amount)<0||!/^[A-Z]{3}$/.test(seat.price.currency))return 'Price unavailable';
    return Number(seat.price.amount)===0?'No seat fee':new Intl.NumberFormat('en-MY',{style:'currency',currency:seat.price.currency}).format(Number(seat.price.amount));
  };
  return <section className="aircraft-seat-map" aria-label={`Seat map for ${map.flightLabel}`}>
    <header className="aircraft-seat-map-heading"><div><h3>Seat plan</h3><p>{map.flightLabel}{map.aircraftName?` · ${map.aircraftName}`:''}</p></div>{map.decks.length>1&&<label>Deck<select value={deck?.id} onChange={event=>setDeckId(event.target.value)}>{map.decks.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}</header>
    <ul className="aircraft-seat-legend" aria-label="Seat status legend"><li><i className="is-available"/>Available</li><li><i className="is-selected"/>Selected</li><li><i className="is-unavailable"/>Unavailable</li></ul>
    {map.viewOnly&&<p className="aircraft-seat-map-note">Seat-plan preview · tap a seat to view its details. Seats are not assigned from this preview.</p>}
    {inspected&&<p className="aircraft-seat-inspection" role="status"><strong>Seat {inspected.label}</strong> · {inspected.status.toLowerCase()} · {priceLabel(inspected)}{inspected.characteristics?.length?` · ${inspected.characteristics.join(', ')}`:''}</p>}
    {expired&&<div className="aircraft-seat-expired" role="status">This seat map expired.{onRefresh&&<button type="button" onClick={onRefresh} disabled={disabled}>Refresh seat map</button>}</div>}
    {!deck?.cabins.length?<p role="status">The airline has not supplied a cabin layout for this flight.</p>:<div className="aircraft-seat-scroll" tabIndex={0} role="region" aria-label="Aircraft cabin layout; scroll to view all seats">
      <div className="aircraft-fuselage"><div className="aircraft-nose" aria-hidden="true"><span/><span/></div>
      {deck.cabins.map(cabin=>{
        const valid=cabin.columns.length>0&&cabin.columns.length<=20&&cabin.columns.some(Boolean)&&new Set(cabin.columns.filter(Boolean)).size===cabin.columns.filter(Boolean).length&&cabin.rows.length<=200;
        if(!valid)return <p key={cabin.id}>Cabin layout unavailable.</p>;
        const grid={gridTemplateColumns:`28px ${cabin.columns.map(column=>column===null?'18px':'minmax(36px,1fr)').join(' ')}`} as CSSProperties;
        return <section className="aircraft-cabin" key={cabin.id} aria-label={cabin.name}><h4>{cabin.name}</h4>
          <div className="aircraft-seat-columns" style={grid} aria-hidden="true"><span/>{cabin.columns.map((column,index)=><span key={index}>{column??''}</span>)}</div>
          {cabin.rows.map(row=><div className={`aircraft-seat-row-group${row.wing?' is-over-wing':''}`} key={row.number}>
            {(row.exitLeft||row.exitRight)&&<div className="aircraft-exit-row"><span>{row.exitLeft?'← Exit':''}</span><span>{row.exitRight?'Exit →':''}</span></div>}
            {!!row.facilities?.length&&<p className="aircraft-seat-facilities">{row.facilities.join(' · ')}</p>}
            <div className="aircraft-seat-row" style={grid}><span className="aircraft-row-number">{row.number}</span>{cabin.columns.map((column,index)=>{
              const seat=column===null?undefined:row.seats[column];
              if(!seat)return <span key={index} className={column===null?'aircraft-aisle':'aircraft-seat-gap'} aria-hidden="true"/>;
              const selected=selectedSeatIds.includes(seat.id),available=seat.status==='AVAILABLE';
              const priced=!!seat.price&&Number.isFinite(Number(seat.price.amount))&&Number(seat.price.amount)>=0&&/^[A-Z]{3}$/.test(seat.price.currency);
              const eligible=!!travelerId&&!!seat.eligibleTravelerIds?.includes(travelerId);
              const selectable=available&&priced&&eligible&&!!onSelect&&!disabled&&!expired&&!map.viewOnly;
              const label=`Seat ${seat.label}, ${seat.status.toLowerCase()}, ${priceLabel(seat)}${seat.characteristics?.length?`, ${seat.characteristics.join(', ')}`:''}${selected?', selected':''}`;
              return <button type="button" key={seat.id} className={`aircraft-seat ${selected?'is-selected':available?'is-available':'is-unavailable'}`} aria-label={label} aria-pressed={selected} title={label} disabled={disabled||expired} onClick={()=>{setInspected(seat);if(selectable)onSelect?.(seat);}}><span>{seat.label}</span>{!available&&<span aria-hidden="true">×</span>}</button>;
            })}</div>
          </div>)}
        </section>;
      })}</div>
    </div>}
    <p className="aircraft-seat-map-note">Cabin layout is not to scale. Aircraft and availability can change. A seat is confirmed only after the airline accepts the assignment.</p>
  </section>;
}
