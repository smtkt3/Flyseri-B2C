import { createHash } from 'node:crypto';
import type { FlightBookingProviderView, FlightOffer, FlightLeg } from '@flyseri/types';
import type { ExchangeOffer } from './flight-exchange-shopping.contract.js';
import {hasExchangedCouponEvidence,hasIssuedTicketEvidence} from './reservation-evidence.js';

const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Incomplete exchange evidence');return value as Record<string,unknown>;};
const rows=(value:unknown)=>{if(!Array.isArray(value)||value.length>100)throw Error('Incomplete exchange collection');return value.map(object);};
const integer=(value:unknown)=>{if(!/^\d{1,5}$/.test(String(value))||Number(value)<1)throw Error('Invalid source association');return Number(value);};
export const exchangeCents=(value:string)=>{if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))throw Error('Invalid exchange amount');const [whole,fraction='']=value.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));};
const signed=(value:string)=>value.startsWith('-')?-exchangeCents(value.slice(1)):exchangeCents(value);
export interface ExchangeContext {bookingId:string;fingerprint:string;segmentIds:number[];travelers:{nameAssociationId:number;givenName:string;surname:string}[];tickets:{number:string;travelerIndex:number;validatingAirlineCode:string}[];pqrIds:string[];pqrRecords:{id:string;active:boolean;travelerIndices:number[]|null;pricingHash:string;validatingAirlineCode?:string}[];view:FlightBookingProviderView}
export interface ExchangePqr {id:string;ticketNumber:string;amount:string;validatingAirlineCode?:string}
export function exchangeRecordId(value:unknown):string{
 const id=String(value??'');if(!/^\d{1,3}$/.test(id)||Number(id)<1)throw Error('Invalid price quote reissue record');return String(Number(id));
}
/** After a committed exchange, passengerCode may be unavailable until the new
 * flight is ticketed. Only this optional warning is tolerated, with an active
 * PQR and exact original booking, traveler and ticket associations. */
export function exchangeVerificationPayload(value:unknown,before:ExchangeContext):unknown{
 const data=object(value);if(data.errors===undefined||Array.isArray(data.errors)&&!data.errors.length)return value;
 const errors=rows(data.errors),travelers=rows(data.travelers),tickets=rows(data.flightTickets),fares=rows(data.fares);
 const norm=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase();
 if(!errors.length||errors.some(error=>error.category!=='WARNING'||error.type!=='RESOURCE_UNAVAILABLE'||error.fieldName!=='passengerCode'||error.fieldPath!=='GetBookingResponse.travelers')||data.bookingId!==before.bookingId||!fares.some(fare=>fare.recordTypeCode==='PQR'&&fare.pricingStatusName==='Active'&&fare.hasValidPricing!==false)||travelers.length!==before.travelers.length||travelers.some((person,index)=>person.type==='INFANT'||person.passengerCode==='INF'||integer(person.nameAssociationId)!==before.travelers[index]!.nameAssociationId||norm(person.givenName+' '+person.surname)!==norm(before.travelers[index]!.givenName+' '+before.travelers[index]!.surname))||tickets.length!==before.tickets.length||tickets.some(ticket=>!before.tickets.some(original=>original.number===ticket.number&&original.travelerIndex===ticket.travelerIndex&&original.validatingAirlineCode===ticket.airlineCode)))throw Error('Incomplete post-exchange verification evidence');
 return {...data,errors:[]};
}
/** Preserve the original purchased offer separately; publish only verified new routing.
 * Reshop times are airport-local. Do not invent UTC offsets or retain old baggage/rules. */
export function exchangedItineraryOffer(original:FlightOffer,offer:ExchangeOffer,journeys:{origin:string;destination:string}[]):FlightOffer{
  const legs:FlightLeg[]=[];let cursor=0;
  for(const journey of journeys){
    const segments:FlightLeg['segments']=[];
    while(cursor<offer.flights.length){
      const flight=offer.flights[cursor++]!;
      if(!segments.length&&flight.origin!==journey.origin||segments.length&&segments.at(-1)!.destination!==flight.origin)throw Error('Replacement journey association is incomplete');
      segments.push({origin:flight.origin,destination:flight.destination,departureAt:flight.departureDate+'T'+flight.departureTime,arrivalAt:flight.arrivalDate+'T'+flight.arrivalTime,marketingCarrier:flight.airline,flightNumber:flight.number,bookingClass:offer.ticketPrices?.[0]?.bookingClasses[cursor-1],durationMinutes:null});
      if(flight.destination===journey.destination)break;
    }
    if(!segments.length||segments.at(-1)!.destination!==journey.destination)throw Error('Replacement journey does not match its approved endpoints');
    legs.push({segments,durationMinutes:null,stops:segments.length-1});
  }
  if(!legs.length||cursor!==offer.flights.length)throw Error('Replacement flights are not fully associated');
  return {offerId:original.offerId,totalAmount:original.totalAmount,currency:original.currency,airlineCodes:[...new Set(offer.flights.map(f=>f.airline))],baggageSummary:null,outbound:legs[0]!,inbound:null,...(legs.length>1?{multiCityLegs:legs}:{})};
}
export function readExchangeContext(value:unknown,identity:{bookingId:string;view:FlightBookingProviderView}):ExchangeContext{
  const data=object(value),flights=rows(data.flights),segments=rows(data.allSegments),travelers=rows(data.travelers),tickets=rows(data.flightTickets);
  if(travelers.some(person=>person.type==='INFANT'||person.passengerCode==='INF'))throw Error('Infant seat and ticket associations require specialist exchange handling');
  if(!identity.view.cancellationCheckComplete||!flights.length||flights.length!==segments.length||segments.some(segment=>segment.type!=='FLIGHT')||flights.some(flight=>flight.sourceType!=='ATPCO')||data.ancillaries!==undefined&&rows(data.ancillaries).length||tickets.length!==travelers.length||!tickets.length||tickets.length>9)throw Error('Exchange requires complete ATPCO flight-only tickets for every traveler');
  const segmentIds=segments.map(segment=>integer(segment.id));
  const names=travelers.map(person=>({nameAssociationId:integer(person.nameAssociationId),givenName:String(person.givenName??''),surname:String(person.surname??'')}));
  const associations=tickets.map(ticket=>({number:String(ticket.number??''),travelerIndex:integer(ticket.travelerIndex),validatingAirlineCode:String(ticket.airlineCode??'')}));
  if(associations.some(ticket=>!/^[A-Z0-9]{2}$/.test(ticket.validatingAirlineCode)))throw Error('The original ticket issuing carrier must be verified before exchange');
  if(new Set(segmentIds).size!==segmentIds.length||new Set(names.map(person=>person.nameAssociationId)).size!==names.length||names.some(person=>!person.givenName||!person.surname)||new Set(associations.map(ticket=>ticket.travelerIndex)).size!==names.length||associations.some(ticket=>!/^\d{13}$/.test(ticket.number)||ticket.travelerIndex>names.length)||new Set(associations.map(ticket=>ticket.number)).size!==associations.length)throw Error('Ambiguous exchange passenger or segment association');
  const pqrRecords=(data.fares===undefined?[]:rows(data.fares)).filter(fare=>fare.recordTypeCode==='PQR').map(fare=>({id:exchangeRecordId(fare.recordId),validatingAirlineCode:typeof fare.airlineCode==='string'&&/^[A-Z0-9]{2}$/.test(fare.airlineCode)?fare.airlineCode:undefined,active:fare.pricingStatusName==='Active'&&fare.hasValidPricing!==false,travelerIndices:Array.isArray(fare.travelerIndices)?fare.travelerIndices.map(integer):null,pricingHash:createHash('sha256').update(JSON.stringify({airlineCode:fare.airlineCode,totals:fare.totals,status:fare.pricingStatusName,valid:fare.hasValidPricing,travelerIndices:fare.travelerIndices})).digest('hex')}));
  const pqrIds=pqrRecords.map(fare=>fare.id);
  const {retrievedAt:_,...view}=identity.view;
  return {...identity,segmentIds,travelers:names,tickets:associations,pqrIds,pqrRecords,fingerprint:createHash('sha256').update(JSON.stringify({bookingId:identity.bookingId,view,segmentIds,names,associations,pqrRecords})).digest('hex')};
}
export type ExchangePricePolicy='EXACT_MATCH';
/** An indicative reshop is never a guarantee. Explicit manager approval can bind
 * an exact price; the supplier must halt on either an increase or a decrease. */
export function executableExchange(offer:ExchangeOffer,context:ExchangeContext,policy?:ExchangePricePolicy){
  if(!offer.priceGuaranteed&&policy!=='EXACT_MATCH'||offer.splitBooking||offer.mixedCabins||!offer.ticketPrices||offer.ticketPrices.length!==context.tickets.length||new Set(offer.ticketPrices.map(ticket=>ticket.number)).size!==context.tickets.length||!offer.currency||offer.amount===null||offer.chargeType==='Unknown')throw Error('The selected offer lacks executable ticket pricing');
  const prices=offer.ticketPrices;
  if(prices.some(ticket=>!context.tickets.some(original=>original.number===ticket.number&&/^[A-Z0-9]{2}$/.test(original.validatingAirlineCode))||ticket.currency!==offer.currency||ticket.chargeType!==offer.chargeType||ticket.bookingClasses.length!==offer.flights.length||ticket.bookingClasses.some((code,index)=>!/^[A-Z]$/.test(code)||prices.some(other=>other.bookingClasses[index]!==code))))throw Error('Mixed or ambiguous per-ticket pricing needs specialist servicing');
  if(prices.reduce((sum,ticket)=>sum+exchangeCents(ticket.amount),0n)!==exchangeCents(offer.amount)||offer.chargeType==='Even'&&exchangeCents(offer.amount)!==0n)throw Error('Exchange total does not match its ticket breakdown');
}
export function exchangeBookingRequest(pnr:string,offer:ExchangeOffer,context:ExchangeContext,options:{pricePolicy?:ExchangePricePolicy;nativeCurrency?:string;pcc?:string}={}){
  executableExchange(offer,context,options.pricePolicy);
  if(!/^[A-Z0-9]{6}$/.test(pnr))throw Error('Invalid exchange PNR');
  return {ExchangeBookingRQ:{version:'1.1.0',...(options.pcc?{targetCity:options.pcc}:{}),Itinerary:{id:pnr},Cancel:{Segment:context.segmentIds.map(itemId=>({itemId}))},AirBook:{HaltOnStatus:['HL','KK','LL','NN','NO','UC','US'].map(Code=>({Code})),OriginDestinationInformation:{FlightSegment:offer.flights.map((flight,index)=>({FlightNumber:flight.number,NumberInParty:String(context.travelers.length),ResBookDesigCode:offer.ticketPrices![0]!.bookingClasses[index],Status:'NN',OriginLocation:{LocationCode:flight.origin},DestinationLocation:{LocationCode:flight.destination},MarketingAirline:{Code:flight.airline,FlightNumber:flight.number},DepartureDateTime:flight.departureDate+'T'+flight.departureTime.slice(0,5),ArrivalDateTime:flight.arrivalDate+'T'+flight.arrivalTime.slice(0,5)}))}},AutomatedExchanges:offer.ticketPrices!.map(ticket=>({ExchangeConfirmation:{DoNotIssueEMDForChangeFee:true,OptionalQualifiers:{FOP_Qualifiers:{BasicFOP:[{Type:'CA'}]}}},PriceComparison:{amountSpecified:Number(ticket.amount)*(ticket.chargeType==='Refund'?-1:1),AcceptablePriceIncrease:{Amount:0,haltOnNonAcceptablePrice:true},AcceptablePriceDecrease:{Amount:0,haltOnNonAcceptablePrice:true}},ExchangeComparison:{OriginalTicketNumber:ticket.number,PriceRequestInformation:{OptionalQualifiers:{FlightQualifiers:{VendorPrefs:{Airline:{Code:context.tickets.find(original=>original.number===ticket.number)!.validatingAirlineCode}}},PricingQualifiers:{AutoRedirect:false,ChangeFeeCollectionOptions:{CollectFee:{InTotal:true}},...(options.nativeCurrency===ticket.currency?{}:{AlternateCurrencyCode:ticket.currency}),NameSelect:{nameAssociationId:context.travelers[context.tickets.find(original=>original.number===ticket.number)!.travelerIndex-1]!.nameAssociationId}}}}}})),PostProcessing:{returnPQRInfo:true,redisplayReservation:true,EndTransaction:{Source:{ReceivedFrom:'Flyseri CERT approved exchange'}}}}};
}
export function readExchangePqrs(value:unknown,offer:ExchangeOffer,context:ExchangeContext):ExchangePqr[]{
  const data=object(object(value).ExchangeBookingRS),application=object(data.ApplicationResults);
  if(application.status!=='Complete'||application.Error!==undefined&&(!Array.isArray(application.Error)||application.Error.length))throw Error('Exchange transaction outcome requires reconciliation');
  // This automated path cannot confirm a separately issued fee document.
  // Never open customer collection based only on the replacement ticket PQR.
  const feeInstructions=JSON.stringify([data.PriceQuoteReissue??[],data.ExchangeConfirmation??[]]);
  if(/FEE TO BE COLLECTED ON SEPARATE DOCUMENT|CHANGE FEE[^"\r\n]{0,120}(?:ON|ISSUE)[^"\r\n]{0,40}EMD/i.test(feeInstructions))throw Error('PQR change-fee document requires specialist servicing');
  const confirmations=rows(data.ExchangeConfirmation);
  if(confirmations.length!==offer.ticketPrices!.length)throw Error('Incomplete exchange confirmations');
  const result=confirmations.map((confirmation,index)=>{
    const id=String(confirmation.PQR_Number??''),amount=String(object(confirmation.PriceComparison).amountReturned??''),expected=offer.ticketPrices![index]!;
    if(!/^\d{1,3}$/.test(id)||context.pqrIds.some(original=>exchangeRecordId(original)===exchangeRecordId(id))||signed(amount)!==exchangeCents(expected.amount)*(expected.chargeType==='Refund'?-1n:1n)||confirmation.AutoRedirect!==undefined&&!['false','N'].includes(String(confirmation.AutoRedirect))||confirmation.RefundableAmountOnEMD&&signed(String(confirmation.RefundableAmountOnEMD))!==0n)throw Error('PQR amount or residual payment needs specialist reconciliation');
    if(typeof offer.airlineFee==='string'&&exchangeCents(offer.airlineFee)>0n){
      if(!Array.isArray(data.PriceQuoteReissue))throw Error('PQR change-fee document requires specialist servicing');
      const details=rows(data.PriceQuoteReissue).filter(record=>exchangeRecordId(record.PQR_Number)===exchangeRecordId(id));
      if(details.length!==1)throw Error('PQR change-fee document requires specialist servicing');
      const exchange=object(object(object(details[0]!.PricedItinerary).AirItineraryPricingInfo).ExchangeDetails);
      const transactions=rows(exchange.TransactionInformation);
      if(exchange.DocNumber!==expected.number||transactions.length!==1||transactions[0]!.CurrencyCode!==expected.currency||signed(String(transactions[0]!.Amount??''))!==signed(amount))throw Error('PQR change-fee document requires specialist servicing');
    }
    return {id:exchangeRecordId(id),ticketNumber:expected.number,amount};
  });
  if(new Set(result.map(pqr=>pqr.id)).size!==result.length)throw Error('Duplicate PQR');
  return result;
}
export function exchangeItineraryMatches(view:FlightBookingProviderView,offer:ExchangeOffer,context:ExchangeContext){
  const norm=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
  return view.cancellationCheckComplete&&view.travellers.length===context.travelers.length&&view.travellers.every((person,index)=>norm(person.givenName+' '+person.surname)===norm(context.travelers[index]!.givenName+' '+context.travelers[index]!.surname))&&view.flights.length===offer.flights.length&&view.flights.every((flight,index)=>{const expected=offer.flights[index]!;return flight.status==='Confirmed'&&flight.airlineCode===expected.airline&&flight.flightNumber===expected.number&&flight.origin===expected.origin&&flight.destination===expected.destination&&flight.departureDate===expected.departureDate&&flight.departureTime.slice(0,5)===expected.departureTime.slice(0,5)&&flight.arrivalDate===expected.arrivalDate&&flight.arrivalTime.slice(0,5)===expected.arrivalTime.slice(0,5);});
}
export function reissueComplete(view:FlightBookingProviderView,offer:ExchangeOffer,context:ExchangeContext){
  if(!exchangeItineraryMatches(view,offer,context))return false;
  const original=context.tickets.map(ticket=>ticket.number),newTickets=view.tickets.filter(ticket=>!original.includes(ticket.number));
  return view.tickets.length===context.tickets.length+context.travelers.length&&new Set(view.tickets.map(ticket=>ticket.number)).size===view.tickets.length&&hasIssuedTicketEvidence({...view,tickets:newTickets},context.travelers.length)&&context.tickets.every(original=>view.tickets.some(ticket=>ticket.number===original.number&&ticket.travellerIndex===original.travelerIndex&&hasExchangedCouponEvidence(ticket)));
}
