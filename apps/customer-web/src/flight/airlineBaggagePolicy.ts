import type { FlightBaggageAllowance, FlightOffer } from '@flyseri/types';
import airportCountries from './baggagePolicyAirports.json';
import { legsOf } from './flightPresentation';

// Official policies reviewed 2026-10-14. Reference limits only: supplier weights take precedence.
export const baggagePolicySources: Record<string,string> = {
  TG:'https://www.thaiairways.com/en-th/content/baggage/checked-baggage/',
  CX:'https://www.cathaypacific.com/cx/en_AU/offers/collection/new-economy-fares.html',
  VN:'https://www.vietnamairlines.com/it/en/travel-information/baggage/baggage-allowance-checked-baggage',
  SQ:'https://www.singaporeair.com/en_UK/bd/travel-info/baggage/checked-baggage/',
  QR:'https://www.qatarairways.com/en/baggage/allowance.html',
  EK:'https://www.emirates.com/us/english/before-you-fly/baggage/checked-baggage/',
  BG:'https://www.biman-airlines.com/baggageAll',
  BS:'https://usbair.com/free-baggage-allowence',
  MH:'https://www.malaysiaairlines.com/my/en/travel-info/baggage/checked-baggage.html',
};
export const hasBaggageWeight = (description:string|null) => /\d\s*(?:kg\b|kgs\b|kilo(?:gram)?s?\b|lb(?:s)?\b|pounds?\b|k\b)/i.test(description??'');
type PolicyLimit = {kg:number;basis:'per piece'|'total';url:string};
const countries=airportCountries as Record<string,string>;

/** Never converts a piece into a universal weight or modifies the underlying fare entitlement. */
export function airlineBaggageLimit(offer:FlightOffer,bag:FlightBaggageAllowance):PolicyLimit|null {
  if(bag.type!=='CHECKED'||bag.availability!=='INCLUDED'||hasBaggageWeight(bag.description))return null;
  const pieces=/^\s*(\d{1,2})\s*(?:pieces?|pcs?|pc\(s\))\s*$/i.exec(bag.description??'');
  if(!pieces||Number(pieces[1])<1||Number(pieces[1])>9)return null;
  const now=Date.now();
  if(now<Date.parse('2026-10-14T00:00:00+08:00')||now>Date.parse('2027-01-12T23:59:59+08:00'))return null;
  const legs=legsOf(offer),segments=legs.flatMap(leg=>leg.segments),carrier=segments[0]?.marketingCarrier;
  if(!carrier||!baggagePolicySources[carrier]||!segments.length||segments.some(segment=>segment.marketingCarrier!==carrier||(segment.operatingCarrier&&segment.operatingCarrier!==carrier)))return null;
  if(!offer.cabin||offer.cabin==='MIXED')return null;
  // Stopovers can change the applicable policy. Do not extrapolate across them.
  if(legs.some(leg=>leg.segments.slice(1).some((segment,index)=>{
    const previous=leg.segments[index]!;
    const wait=Date.parse(segment.departureAt)-Date.parse(previous.arrivalAt);
    return !Number.isFinite(wait)||wait<0||wait>86400000||previous.destination!==segment.origin;
  })))return null;
  const endpointCountries=legs.flatMap(leg=>[countries[leg.segments[0]?.origin??''],countries[leg.segments.at(-1)?.destination??'']]);
  const usCanada=endpointCountries.some(country=>country==='US'||country==='CA');
  const africaAmericas=endpointCountries.some(country=>!!country&&country!=='NZ');
  const premium=offer.cabin==='BUSINESS'||offer.cabin==='FIRST';
  let kg:number|null=null,basis:PolicyLimit['basis']='per piece';
  if(carrier==='TG'&&segments.every(segment=>segment.departureAt.slice(0,10)>='2026-03-02')) {
    if(offer.cabin==='ECONOMY')kg=23;
    else if(premium)kg=32;
    // Premium Economy Plus uses 32 kg; ordinary Premium Economy uses 23 kg.
    else if(segments.every(segment=>['U','E'].includes(segment.bookingClass??'')))kg=23;
  }
  if(carrier==='VN'&&offer.cabin!=='FIRST')kg=premium?32:23;
  if(carrier==='CX'&&!(offer.cabin==='BUSINESS'&&endpointCountries.includes('NZ')))kg=premium?32:23;
  if(carrier==='SQ'&&usCanada)kg=premium?32:23;
  if(carrier==='QR'&&africaAmericas&&offer.cabin!=='PREMIUM_ECONOMY')kg=premium?32:23;
  // Conservative Emirates scope: direct services or a connection only in Dubai.
  if(carrier==='EK'&&africaAmericas&&legs.every(leg=>leg.segments.length<=2&&(leg.segments.length===1||leg.segments[0]?.destination==='DXB')))kg=premium?32:23;
  // Biman's page has conflicting general Business limits; only its clear Economy US/CA rule is enabled.
  if(carrier==='BG'&&usCanada&&offer.cabin==='ECONOMY'&&segments.every(segment=>!!segment.bookingClass&&!['G','S'].includes(segment.bookingClass)))kg=23;
  // US-Bangla uses total weight on these direct routes, not kg per piece.
  if(carrier==='BS'&&segments.length===1&&offer.cabin==='ECONOMY') {
    const segment=segments[0]!,bd=['DAC','CGP','ZYL'];
    const outbound=bd.includes(segment.origin),inbound=bd.includes(segment.destination);
    const other=outbound?segment.destination:segment.origin;
    if((outbound||inbound)&&'Y B H M R U N V X T O I K E S G'.split(' ').includes(segment.bookingClass??'')) {
      if(other==='CCU'&&Number(pieces[1])===1)kg=outbound?20:25;
      if(['MAA','MLE','BKK','KUL','SIN'].includes(other)&&Number(pieces[1])<=2)kg=outbound?30:({MAA:30,MLE:35,BKK:30,KUL:35,SIN:40} as Record<string,number>)[other]!;
      basis='total';
    }
  }
  return kg===null?null:{kg,basis,url:baggagePolicySources[carrier]!};
}
