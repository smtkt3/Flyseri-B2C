import { Fragment } from 'react';
import type { FlightOffer } from '@flyseri/types';
import { airlineName } from './AirlineIdentity';
import { dateTime, minutes } from './flightPresentation';

export function OrganizedFlightItinerary({title,offer,airports}:{title:string;offer:FlightOffer['outbound'];airports:Record<string,{city:string;name:string}>}) {
  const place = (code:string) => airports[code]?.city ? `${airports[code].city} (${code})` : code;
  return <section className="organized-flight-leg" aria-label={title}>
    <header><h4>{title}</h4><span>{minutes(offer.durationMinutes)} · {offer.stops===0?'Direct':`${offer.stops} ${offer.stops===1?'stop':'stops'}`}</span></header>
    {offer.segments.map((segment,index)=>{
      const onward=offer.segments[index+1];
      const wait=onward?(Date.parse(onward.departureAt)-Date.parse(segment.arrivalAt))/60000:null;
      const airportChange=onward&&onward.origin!==segment.destination;
      return <Fragment key={`${segment.marketingCarrier}-${segment.flightNumber}-${segment.departureAt}`}>
        <div className="organized-flight-segment">
          <div className="organized-flight-airline"><strong>{airlineName(segment.marketingCarrier)??segment.marketingCarrier} · {segment.marketingCarrier} {segment.flightNumber}</strong>{segment.aircraftTypeCode&&<small>Aircraft {segment.aircraftTypeCode}</small>}{segment.operatingCarrier&&segment.operatingCarrier!==segment.marketingCarrier&&<small>Operated by {airlineName(segment.operatingCarrier)??segment.operatingCarrier} ({segment.operatingCarrier})</small>}</div>
          <div className="organized-flight-endpoint"><strong>{place(segment.origin)}</strong><span>{dateTime(segment.departureAt)}</span></div>
          <span className="organized-flight-arrow" aria-hidden="true">→</span>
          <div className="organized-flight-endpoint"><strong>{place(segment.destination)}</strong><span>{dateTime(segment.arrivalAt)}</span></div>
        </div>
        {onward&&<div className={`organized-flight-layover${airportChange?' is-airport-change':''}`}><strong>{airportChange?`Airport change: ${place(segment.destination)} → ${place(onward.origin)}`:`Layover in ${place(onward.origin)}`}</strong><span>{wait!==null&&Number.isFinite(wait)&&wait>=0?minutes(Math.floor(wait)):'Connection time unavailable'}</span>{airportChange&&<small>Allow time for travel between airports and check entry requirements.</small>}</div>}
      </Fragment>;
    })}
  </section>;
}
