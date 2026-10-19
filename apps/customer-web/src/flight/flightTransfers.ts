import type { FlightOffer } from '@flyseri/types';

export interface FlightConnection {
  key:string; legIndex:number; arrivalAirport:string; departureAirport:string; arrivalAt:string;
  originAirport:string; destinationAirport:string; departureAt:string;
  incomingCarrier:string; outgoingCarrier:string; incomingOperator:string; outgoingOperator:string;
  airportChange:boolean; selfTransfer:boolean; baggageTransfer:'RECHECK_REQUIRED'|'THROUGH_CHECKED'|'UNKNOWN';
}
export function flightConnections(offer:FlightOffer,legIndex?:number):FlightConnection[] {
  const legs=offer.multiCityLegs ?? [offer.outbound,...(offer.inbound?[offer.inbound]:[])];
  return legs.flatMap((leg,index)=>legIndex!==undefined&&index!==legIndex ? [] : leg.segments.slice(0,-1).map((segment,position)=>{
    const next=leg.segments[position+1]!;
    const airportChange=segment.destination!==next.origin;
    return {key:`${index}:${position}`,legIndex:index,arrivalAirport:segment.destination,departureAirport:next.origin,arrivalAt:segment.arrivalAt,
      originAirport:segment.origin,destinationAirport:next.destination,departureAt:next.departureAt,
      incomingCarrier:segment.marketingCarrier,outgoingCarrier:next.marketingCarrier,
      incomingOperator:segment.operatingCarrier??segment.marketingCarrier,outgoingOperator:next.operatingCarrier??next.marketingCarrier,
      airportChange,selfTransfer:airportChange||segment.connectionAfter?.selfTransfer===true,
      baggageTransfer:segment.connectionAfter?.baggageTransfer ?? 'UNKNOWN'};
  }));
}

const checkedAt='2026-10-18';
const reviewUntil='2027-01-16';
const officialRules:Record<string,{url:string;name:string}>={
  SG:{url:'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/bangladesh',name:'Singapore ICA'},
  MY:{url:'https://www.imi.gov.my/index.php/en/main-services/visa/visa-requirement-by-country/',name:'Malaysia Immigration'},
};
export function baggageEntryAdvice(input:{country?:string;nationality:string;issuingCountry:string;documentType:string;arrivalAt:string;now?:Date}) {
  const rule=input.country ? officialRules[input.country] : undefined;
  const today=(input.now??new Date()).toISOString().slice(0,10);
  const fresh=today>=checkedAt && today<=reviewUntil && /^\d{4}-\d{2}-\d{2}T/.test(input.arrivalAt) && input.arrivalAt.slice(0,10)<=reviewUntil;
  if(input.documentType==='PASSPORT' && input.nationality==='BD' && input.issuingCountry==='BD' && rule && fresh) {
    return {status:'required' as const,title:'Entry visa normally required',
      detail:'For an ordinary Bangladeshi passport, entering this country normally requires a valid entry visa. If you already hold a valid visa, residence permission or another exemption, confirm that it permits this entry. Baggage collection is not covered by airside transit alone.',
      source:rule.url,sourceLabel:rule.name,checkedAt};
  }
  return {status:'check' as const,title:'Entry requirements need checking',
    detail:'We cannot confirm visa eligibility for these passport details. Check entry permission for baggage collection using the official authority or IATA Travel Centre. Existing visas, residence permits, passport type, travel date and onward itinerary can change the answer.',
    source:'https://www.iatatravelcentre.com/',sourceLabel:'IATA Travel Centre',checkedAt:null};
}
