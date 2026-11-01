import { createHash } from 'node:crypto';
import type { AirlineEligibility } from './flight-servicing.contract.js';

export interface ExchangeJourney {origin:string;destination:string;departureDate:string}
export interface ExchangeFlight {airline:string;number:string;origin:string;destination:string;departureDate:string;departureTime:string;arrivalDate:string;arrivalTime:string;bookingClasses:string[];cabins:string[]}
export interface ExchangeOffer {
  id:string;reference:string;airlineExpiresAt:string|null;priceGuaranteed:boolean;splitBooking:boolean;mixedCabins:boolean;
  chargeType:'Add collect'|'Even'|'Refund'|'Unknown';amount:string|null;currency:string|null;airlineFee:string|null;flights:ExchangeFlight[];
  ticketPrices?:{number:string;amount:string;currency:string;chargeType:'Add collect'|'Even'|'Refund';bookingClasses:string[]}[];
}
export interface ExchangeSearch {searchedAt:string;reviewExpiresAt:string;reference:string;bookingId:string;eligibilityFingerprint:string;ticketNumbers:string[];journeys:ExchangeJourney[];offers:ExchangeOffer[];warningsPresent:boolean}
const obj=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const rows=(value:unknown)=>Array.isArray(value)?value.map(obj).filter((row):row is Record<string,unknown>=>Boolean(row)):[];
const text=(value:unknown,max=160)=>typeof value==='string'&&value.length<=max?value:'';
const amount=(value:unknown)=>typeof value==='string'&&/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)?value:null;
const date=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function exchangeJourneys(value:unknown):ExchangeJourney[]{
  if(!Array.isArray(value)||!value.length||value.length>10)throw Error('Enter 1–10 journeys for the complete replacement itinerary.');
  const journeys=value.map(raw=>{const row=obj(raw);if(!row||Object.keys(row).some(key=>!['origin','destination','departureDate'].includes(key))||typeof row.origin!=='string'||typeof row.destination!=='string'||typeof row.departureDate!=='string'||![/^[A-Z]{3}$/.test(row.origin),/^[A-Z]{3}$/.test(row.destination),date(row.departureDate)].every(Boolean)||row.origin===row.destination)throw Error('Each journey needs distinct three-letter airport codes and a valid departure date.');return {origin:row.origin,destination:row.destination,departureDate:row.departureDate};});
  if(journeys.some((journey,index)=>journey.departureDate<new Date(Date.now()-86400000).toISOString().slice(0,10)||index>0&&journey.departureDate<journeys[index-1]!.departureDate))throw Error('Use future travel dates in chronological order.');
  return journeys;
}
/** Public fields only. Supplier request echoes, passenger names and payment data are excluded. */
export function readExchangeSearch(value:unknown,eligibility:AirlineEligibility,journeys:ExchangeJourney[]):ExchangeSearch{
  const data=obj(value);
  if(!data||data.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length)||!Array.isArray(data.offers)||data.offers.length>50)throw Error('Incomplete Sabre Flight Reshop response');
  const allFlights=rows(data.flights),allJourneys=rows(data.journeys);
  const reference='RESHOP-'+createHash('sha256').update(JSON.stringify({eligibility:eligibility.fingerprint,journeys,offers:data.offers})).digest('hex').slice(0,16).toUpperCase();
  const offers:ExchangeOffer[]=[];
  for(const offer of rows(data.offers)){
    if(!text(offer.id)||obj(offer.source)?.distributionModel!=='ATPCO'||!Array.isArray(offer.journeyRefs)||!offer.journeyRefs.length)continue;
    const selectedJourneys=offer.journeyRefs.map(id=>allJourneys.find(journey=>journey.id===id));
    if(selectedJourneys.some(journey=>!journey||!Array.isArray(journey.flightRefs)||!journey.flightRefs.length))continue;
    const flightRefs=selectedJourneys.flatMap(journey=>journey!.flightRefs as unknown[]);
    if(flightRefs.length>16||new Set(flightRefs).size!==flightRefs.length)continue;
    const fareSegments=rows(offer.items).flatMap(item=>rows(item.fares).flatMap(fare=>rows(fare.fareComponents).flatMap(component=>rows(component.segmentDetails))));
    const flights=flightRefs.map(id=>{
      const flight=allFlights.find(entry=>entry.id===id);
      if(!flight)return null;
      const number=typeof flight.marketingFlightNumber==='number'?String(flight.marketingFlightNumber):text(flight.marketingFlightNumber,4);
      const result={airline:text(flight.marketingAirlineCode,3),number,origin:text(flight.departureAirportCode,3),destination:text(flight.arrivalAirportCode,3),departureDate:text(flight.departureDate,10),departureTime:text(flight.departureTime,8),arrivalDate:text(flight.arrivalDate,10),arrivalTime:text(flight.arrivalTime,8),bookingClasses:[...new Set(fareSegments.filter(segment=>segment.flightRef===id).map(segment=>text(segment.bookingClassCode,2)).filter(Boolean))],cabins:[...new Set(fareSegments.filter(segment=>segment.flightRef===id).map(segment=>text(segment.cabinName,50)).filter(Boolean))]};
      return /^[A-Z0-9]{2,3}$/.test(result.airline)&&/^\d{1,4}$/.test(number)&&/^[A-Z]{3}$/.test(result.origin)&&/^[A-Z]{3}$/.test(result.destination)&&date(result.departureDate)&&date(result.arrivalDate)&&/^\d{2}:\d{2}(?::\d{2})?$/.test(result.departureTime)&&/^\d{2}:\d{2}(?::\d{2})?$/.test(result.arrivalTime)?result:null;
    });
    if(!flights.length||flights.some(flight=>!flight))continue;
    const price=obj(offer.totalPriceDifference),chargeType=['Add collect','Even','Refund'].includes(String(price?.type))?price!.type as ExchangeOffer['chargeType']:'Unknown';
    const expires=text(offer.validUntil,40);
    const ticketPrices:NonNullable<ExchangeOffer['ticketPrices']>=[];
    for(const fare of rows(offer.items).flatMap(item=>rows(item.fares))){
      const difference=obj(fare.priceDifference),classes=flightRefs.map(id=>rows(fare.fareComponents).flatMap(component=>rows(component.segmentDetails)).filter(segment=>segment.flightRef===id).map(segment=>text(segment.bookingClassCode,1)));
      if(!difference||!['Add collect','Even','Refund'].includes(String(difference.type))||amount(difference.grandTotal)===null||typeof difference.currencyCode!=='string'||!/^[A-Z]{3}$/.test(difference.currencyCode)||classes.some(values=>values.length!==1||!/^[A-Z]$/.test(values[0]!)))continue;
      for(const traveler of rows(fare.travelers))if(typeof traveler.ticketNumber==='string'&&eligibility.tickets.some(ticket=>ticket.number===traveler.ticketNumber))ticketPrices.push({number:traveler.ticketNumber,amount:amount(difference.grandTotal)!,currency:difference.currencyCode,chargeType:difference.type as 'Add collect'|'Even'|'Refund',bookingClasses:classes.map(values=>values[0]!)});
    }
    const complete=ticketPrices.length===eligibility.tickets.length&&new Set(ticketPrices.map(ticket=>ticket.number)).size===eligibility.tickets.length;
    offers.push({id:text(offer.id),reference:reference+':'+offers.length,airlineExpiresAt:expires&&/Z$/.test(expires)&&Number.isFinite(Date.parse(expires))?expires:null,priceGuaranteed:offer.isPriceGuaranteed===true,splitBooking:offer.splitBooking===true,mixedCabins:offer.hasTravelersInDifferentCabins===true,chargeType,amount:amount(price?.grandTotal),currency:typeof price?.currencyCode==='string'&&/^[A-Z]{3}$/.test(price.currencyCode)?price.currencyCode:null,airlineFee:amount(price?.totalFee),flights:flights as ExchangeFlight[],...(complete?{ticketPrices}: {})});
  }
  return {searchedAt:new Date().toISOString(),reviewExpiresAt:new Date(Date.now()+10*60000).toISOString(),reference,bookingId:eligibility.bookingId,eligibilityFingerprint:eligibility.fingerprint,ticketNumbers:eligibility.tickets.map(ticket=>ticket.number),journeys,offers,warningsPresent:Array.isArray(data.warnings)&&data.warnings.length>0};
}
