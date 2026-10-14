import { Link } from 'react-router-dom';
import type { FlightOffer } from '@flyseri/types';
import { cabinLabel, legsOf, money } from './flightPresentation';
import { includedCheckedBaggageLabel } from './FlightFareInformation';
const key='flyseri.flight-help.v1';
export type FlightHelpContext={text:string;savedAt:number};
export function flightHelpContext(offer:FlightOffer,passengers:string):FlightHelpContext {
  const legs=legsOf(offer);
  const text=[
    `Flight: ${legs.map(leg=>`${leg.segments[0]?.origin} → ${leg.segments.at(-1)?.destination} (${leg.segments[0]?.departureAt.slice(0,10)})`).join('; ')}`,
    `Flights: ${legs.flatMap(leg=>leg.segments.map(segment=>`${segment.marketingCarrier} ${segment.flightNumber}`)).join(', ')}`,
    `${cabinLabel(offer.cabin)}${offer.fareBrand?` · ${offer.fareBrand}`:''} · ${passengers}`,
    `Shopping quote: ${money(offer.totalAmount,offer.currency)} total; price and availability need rechecking.`,
    ...legs.map((_,index)=>includedCheckedBaggageLabel(offer,index)).filter(Boolean),
  ].join('\n').slice(0,500);
  return {text,savedAt:Date.now()};
}
export function readFlightHelp(fallback?:unknown):FlightHelpContext|null {
  const valid=(value:unknown):value is FlightHelpContext=>!!value&&typeof value==='object'&&typeof (value as FlightHelpContext).text==='string'&&(value as FlightHelpContext).text.length<=500&&typeof (value as FlightHelpContext).savedAt==='number'&&(value as FlightHelpContext).savedAt<=Date.now()&&Date.now()-(value as FlightHelpContext).savedAt<1800000;
  if(valid(fallback))return fallback;
  try {const context:unknown=JSON.parse(sessionStorage.getItem(key)??'null');return valid(context)?context:null;}catch{return null;}
}
export function clearFlightHelp(){try{sessionStorage.removeItem(key);}catch{}}
export function FlightSupportLink({offer,passengerLabel}:{offer:FlightOffer;passengerLabel:string}) {
  const context=flightHelpContext(offer,passengerLabel);
  return <Link className="flight-support-link" to="/app/support?flightHelp=1" state={{flightHelp:context}} onClick={()=>{try{sessionStorage.setItem(key,JSON.stringify({...context,savedAt:Date.now()}));}catch{}}}>Ask our team about this fare <span aria-hidden="true">↗</span></Link>;
}
