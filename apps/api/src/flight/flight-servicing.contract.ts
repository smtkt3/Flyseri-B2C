import { createHash } from 'node:crypto';
import type { FlightBookingProviderView } from '@flyseri/types';

/** Booking Management v1.33. Never retain echoed agency/payment credentials. */
export interface ServicingContext {
  bookingId:string;
  view:FlightBookingProviderView;
  atpcoFlightOnly:boolean;
  atpcoUnticketedFlightOnly:boolean;
  /** Flight structure only; attached extras require separate exact verification. */
  atpcoUnticketed?:boolean;
  ticketingPccs:string[];
  ticketNumbers:string[];
}
export interface CheckedFlightTicket {
  number:string;
  voidable:boolean|null;
  refundable:boolean|null;
  automatedRefundEligible:boolean|null;
  changeable:boolean|null;
  refundTotal:{amount:string;currency:string}|null;
  refundFee:{amount:string;currency:string}|null;
}
export interface AirlineEligibility {
  checkedAt:string;
  expiresAt:string;
  reference:string;
  fingerprint:string;
  bookingId:string;
  atpcoFlightOnly:boolean;
  tickets:CheckedFlightTicket[];
}
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const records=(value:unknown)=>Array.isArray(value)?value.map(object):null;
const decimal=(value:unknown)=>typeof value==='string'&&/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)?value:null;
function total(value:unknown,amountKey='total'){
  const item=object(value),amount=decimal(item?.[amountKey]),currency=item?.currencyCode;
  return amount!==null&&typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)?{amount,currency}:null;
}
export function servicingContext(value:unknown,identity:{bookingId:string;view:FlightBookingProviderView}):ServicingContext{
  const data=object(value),flights=records(data?.flights),tickets=records(data?.flightTickets);
  const segments=records(data?.allSegments);
  const extras=data?.ancillaries;
  const numbers=identity.view.tickets.map(ticket=>ticket.number);
  const ticketingPccs=tickets?.map(ticket=>typeof ticket?.ticketingPcc==='string'?ticket.ticketingPcc:'')??[];
  const atpcoFlightOnly=identity.view.cancellationCheckComplete&&Boolean(flights?.length)&&Boolean(segments)&&segments!.length===flights!.length&&segments!.every(segment=>segment?.type==='FLIGHT')&&flights!.every(flight=>flight?.sourceType==='ATPCO')&&
    Boolean(tickets?.length)&&tickets!.length<=12&&tickets!.every(ticket=>Array.isArray(ticket?.flightCoupons)&&ticket.flightCoupons.length>0)&&
    numbers.length===tickets!.length&&numbers.every(number=>/^\d{13}$/.test(number))&&new Set(numbers).size===numbers.length&&
    (extras===undefined||Array.isArray(extras)&&extras.length===0);
  const atpcoUnticketed=identity.view.cancellationCheckComplete&&Boolean(flights?.length)&&Boolean(segments)&&segments!.length===flights!.length&&segments!.every(segment=>segment?.type==='FLIGHT')&&flights!.every(flight=>flight?.sourceType==='ATPCO')&&numbers.length===0&&(data?.flightTickets===undefined||Array.isArray(data.flightTickets)&&data.flightTickets.length===0);
  const atpcoUnticketedFlightOnly=atpcoUnticketed&&(extras===undefined||Array.isArray(extras)&&extras.length===0);
  return {...identity,atpcoFlightOnly,atpcoUnticketedFlightOnly,atpcoUnticketed,ticketingPccs,ticketNumbers:numbers};
}
export function ticketEligibility(value:unknown,context:ServicingContext):AirlineEligibility{
  const data=object(value),rows=records(data?.tickets);
  if(!data||data.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length)||!rows?.length||rows.length!==context.ticketNumbers.length)throw Error('Incomplete airline ticket eligibility');
  const tickets=rows.map(row=>{
    if(!row||typeof row.number!=='string'||!context.ticketNumbers.includes(row.number))throw Error('Ticket scope changed');
    const flag=(key:string)=>typeof row[key]==='boolean'?row[key] as boolean:null;
    return {number:row.number,voidable:flag('isVoidable'),refundable:flag('isRefundable'),automatedRefundEligible:flag('isAutomatedRefundsEligible'),changeable:flag('isChangeable'),refundTotal:total(row.refundTotals),refundFee:total(row.refundFee,'amount')};
  }).sort((left,right)=>left.number.localeCompare(right.number));
  if(new Set(tickets.map(ticket=>ticket.number)).size!==context.ticketNumbers.length)throw Error('Duplicate airline ticket evidence');
  const {retrievedAt:_,...view}=context.view;
  const fingerprint=createHash('sha256').update(JSON.stringify({bookingId:context.bookingId,view,atpcoFlightOnly:context.atpcoFlightOnly,ticketingPccs:context.ticketingPccs,tickets})).digest('hex');
  return {bookingId:context.bookingId,checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60000).toISOString(),reference:'SABRE-'+fingerprint.slice(0,16).toUpperCase(),fingerprint,atpcoFlightOnly:context.atpcoFlightOnly,tickets};
}
export function completedTicketCancellation(value:unknown,kind:'VOID'|'REFUND',expected:string[]):boolean{
  const data=object(value),numbers=data?.[kind==='VOID'?'voidedTickets':'refundedTickets'];
  return Boolean(data)&&!(data!.errors!==undefined&&(!Array.isArray(data!.errors)||data!.errors.length))&&Array.isArray(numbers)&&numbers.length===expected.length&&new Set(numbers).size===expected.length&&numbers.every(number=>typeof number==='string'&&expected.includes(number));
}
