import { useEffect, useState } from 'react';
import type { FlightBookingIntent, FlightSeatMapResponse } from '@flyseri/types';
import { AircraftSeatMap } from './AircraftSeatMap';
import { legsOf } from './flightPresentation';
import { flightService } from '../services/flightService';

export function FlightSeatPlan({intent,disabled=false}:{intent:FlightBookingIntent;disabled?:boolean}) {
  const [open,setOpen]=useState(false),[segment,setSegment]=useState(0),[passenger,setPassenger]=useState(0),[attempt,setAttempt]=useState(0);
  const [result,setResult]=useState<FlightSeatMapResponse|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const segments=legsOf(intent.selectedOffer).flatMap(leg=>leg.segments);
  useEffect(()=>{
    setResult(null);setError('');setLoading(false);
    if(!open||disabled)return;
    const abort=new AbortController();setLoading(true);
    void flightService.seatMap(intent.id,segment,passenger,abort.signal).then(value=>{if(!abort.signal.aborted)setResult(value);},cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'The airline seat map is unavailable.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[open,disabled,intent.id,intent.validatedAt,segment,passenger,attempt]);
  return <section className="account-panel flight-seat-plan"><div className="flight-seat-plan-heading"><div><h2>Aircraft seat plan</h2><p>View the airline’s cabin layout, seat availability and quoted fees.</p></div><button type="button" className="account-outline-button" disabled={disabled} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Close seat plan':'View seat plan'}</button></div>
    {open&&<><div className="flight-seat-plan-controls"><label>Flight<select disabled={loading||disabled} value={segment} onChange={event=>setSegment(Number(event.target.value))}>{segments.map((flight,index)=><option value={index} key={index}>{flight.marketingCarrier} {flight.flightNumber} · {flight.origin} → {flight.destination}</option>)}</select></label><label>Traveler<select disabled={loading||disabled} value={passenger} onChange={event=>setPassenger(Number(event.target.value))}>{intent.travellerIds.map((id,index)=><option value={index} key={id}>Traveler {index+1}</option>)}</select></label></div>
      {loading&&<p role="status">Loading the airline seat plan…</p>}
      {error&&<div className="flight-seat-plan-unavailable" role="status"><p>{error}</p><button type="button" disabled={loading||disabled} className="account-outline-button" onClick={()=>setAttempt(value=>value+1)}>Retry seat map</button><p>You can continue checkout without viewing seats.</p></div>}
      {result&&!result.maps.length&&<p role="status">{result.message??'The airline did not return a seat plan for this flight.'}</p>}
      {result?.maps.map((map,index)=><AircraftSeatMap key={`${segment}-${passenger}-${index}-${map.expiresAt}`} map={map} disabled={disabled} onRefresh={()=>setAttempt(value=>value+1)}/>)}
    </>}
  </section>;
}
