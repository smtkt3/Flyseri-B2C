import type {FlightBookingProviderView,FlightOffer} from '@flyseri/types';
import {hasIssuedTicketEvidence,matchesConfirmedItinerary} from './reservation-evidence.js';
import {ticketingPaymentEvidence} from './ticketing-execution.contract.js';
import {sanitizedTicketingErrors} from './ticketing-currency.contract.js';
/** Only explicitly referenced EMD numbers are separated from flight tickets.
 * Unknown or malformed documents remain visible to the strict verifier. */
export function flightTicketPayload(value:unknown):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const data=value as Record<string,unknown>;
 if(!Array.isArray(data.travelers)||!Array.isArray(data.flightTickets))return value;
 const numbers=new Set<string>();
 for(const traveler of data.travelers){if(!traveler||!Array.isArray(traveler.ancillaries))continue;for(const extra of traveler.ancillaries){const number=extra?.electronicMiscellaneousDocumentNumber;if(typeof number==='string'&&/^\d{13}$/.test(number))numbers.add(number);}}
 return numbers.size?{...data,flightTickets:data.flightTickets.filter(ticket=>!ticket||typeof ticket!=='object'||!numbers.has(ticket.number))}:value;
}

export type TicketDocumentEvidence={number:string;travelerIndex:number|null;airlineCode:string;ticketingPcc:string;status:string;payment:{total:unknown;currencyCode:unknown};coupons:{itemId:string;status:string;statusCode?:string}[]};
export type TicketDocumentContext={bookingId:string;view:FlightBookingProviderView;documents:{tickets:TicketDocumentEvidence[];flightItemIds:string[];complete:boolean;bookingPcc?:string;warnings:ReturnType<typeof sanitizedTicketingErrors>};supplierRequestId?:string};
export type TicketReconciliationExpected={pnr:string;bookingId:string;passengerNames:string[];offer:FlightOffer;currency:string;amount:string;pcc:string;validatingCarrier?:string;ticketNumbers?:string[]};
export type TicketVerification='VERIFIED'|'NO_TICKETS_REPORTED'|'DOCUMENTS_INCOMPLETE'|'IDENTITY_MISMATCH'|'LOOKUP_UNAVAILABLE';
export type TicketRecoveryCheck={verification:TicketVerification;checkedAt:string;documentCount:number;supplierRequestId?:string};
export type TicketReconciliation={verification:TicketVerification;checkedAt:string;documentCount:number;pccScope:'PCC_CONFIRMED'|'PCC_NOT_CONFIRMED';reasons:string[];automaticRetry:false;supplierRequestId?:string;context?:TicketDocumentContext;recovery?:{lookupCount:number;checks:TicketRecoveryCheck[]}};
const text=(value:unknown,pattern:RegExp)=>typeof value==='string'&&pattern.test(value)?value:'';
const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&!Array.isArray(row)).slice(0,100):[];
// Booking Management's documented coupon enums include Not Flown / I.
// Accept that unused coupon only as a matching status/code pair; every other
// document, association, passenger, fare and PCC check still applies.
const usableCoupon=(status:string,code?:string)=>['Okay','Airport Control','Checked In'].includes(status)||status==='Not Flown'&&code==='I';
/** Project only documented ticket fields. No raw passenger/payment response is retained. */
export function readTicketDocuments(raw:Record<string,unknown>):TicketDocumentContext['documents']{
 const flights=rows(raw.flights),tickets=rows(raw.flightTickets);
 const flightItemIds=flights.map(f=>text(f.itemId,/^[A-Z0-9]{1,30}$/));
 const warnings=sanitizedTicketingErrors(raw.warnings);
 const errors=raw.errors;
 const allCouponsComplete=tickets.every(ticket=>{
  if(ticket.allCoupons===undefined)return true;
  const coupons=rows(ticket.allCoupons);
  return Array.isArray(ticket.allCoupons)&&coupons.length===ticket.allCoupons.length&&coupons.length===rows(ticket.flightCoupons).length&&new Set(coupons.map(c=>c.itemId)).size===coupons.length&&coupons.every(c=>typeof c.itemId==='string'&&flightItemIds.includes(c.itemId)&&usableCoupon(String(c.couponStatus),typeof c.couponStatusCode==='string'?c.couponStatusCode:undefined));
 });
 const complete=allCouponsComplete&&(raw.flightTickets===undefined?raw.isTicketed===false:Array.isArray(raw.flightTickets)&&tickets.length===raw.flightTickets.length)&&Array.isArray(raw.flights)&&flights.length===raw.flights.length&&flightItemIds.every(Boolean)&&new Set(flightItemIds).size===flightItemIds.length&&(errors===undefined||Array.isArray(errors)&&!errors.length)&&(raw.warnings===undefined||Array.isArray(raw.warnings)&&!raw.warnings.length);
 return {complete,flightItemIds,warnings,bookingPcc:text((raw.creationDetails as {userWorkPcc?:unknown}|undefined)?.userWorkPcc,/^[A-Z0-9]{3,4}$/)||undefined,tickets:tickets.map(ticket=>{
  const payment=ticket.payment as {total?:unknown;currencyCode?:unknown}|undefined;
  const coupons=rows(ticket.flightCoupons);
  return {number:text(ticket.number,/^\d{13}$/),travelerIndex:Number.isInteger(ticket.travelerIndex)?Number(ticket.travelerIndex):null,airlineCode:text(ticket.airlineCode,/^[A-Z0-9]{2}$/),ticketingPcc:text(ticket.ticketingPcc,/^[A-Z0-9]{3,4}$/),status:text(ticket.ticketStatusName,/^(Issued|Voided|Refunded\/Exchanged)$/),payment:{total:payment?.total,currencyCode:payment?.currencyCode},coupons:Array.isArray(ticket.flightCoupons)&&coupons.length===ticket.flightCoupons.length?coupons.map(c=>({itemId:text(c.itemId,/^[A-Z0-9]{1,30}$/),status:text(c.couponStatus,/^[A-Za-z ]{1,40}$/),...(text(c.couponStatusCode,/^[A-Z]{1,2}$/)?{statusCode:text(c.couponStatusCode,/^[A-Z]{1,2}$/)}:{})})):[]};
 })};
}
const name=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
export function verifyTicketDocuments(context:TicketDocumentContext,expected:TicketReconciliationExpected,checkedAt=new Date().toISOString()):TicketReconciliation{
 const result:TicketReconciliation={verification:'DOCUMENTS_INCOMPLETE',checkedAt,documentCount:context.documents.tickets.length,pccScope:'PCC_NOT_CONFIRMED',reasons:[],automaticRetry:false,supplierRequestId:context.supplierRequestId,context};
 if(context.bookingId!==expected.bookingId||!expected.passengerNames.length||context.view.travellers.length!==expected.passengerNames.length||context.view.travellers.some((p,i)=>name(p.givenName+' '+p.surname)!==name(expected.passengerNames[i]!))||!matchesConfirmedItinerary(context.view,expected.offer))return {...result,verification:'IDENTITY_MISMATCH',reasons:['PNR_PASSENGER_OR_SEGMENT_MISMATCH']};
 if(!context.view.cancellationCheckComplete||!context.documents.complete)return {...result,reasons:['INCOMPLETE_SUPPLIER_DOCUMENT_LOOKUP']};
 if(!context.view.tickets.length&&!context.documents.tickets.length)return {...result,verification:'NO_TICKETS_REPORTED',reasons:['ABSENCE_DOES_NOT_ESTABLISH_NON_ISSUANCE']};
 const tickets=context.documents.tickets;
 if(!hasIssuedTicketEvidence(context.view,expected.passengerNames.length)||tickets.length!==expected.passengerNames.length||new Set(tickets.map(t=>t.number)).size!==tickets.length)result.reasons.push('PARTIAL_OR_INVALID_DOCUMENTS');
 if(!expected.validatingCarrier||tickets.some(t=>t.airlineCode!==expected.validatingCarrier))result.reasons.push('VALIDATING_CARRIER_NOT_VERIFIED');
 if(tickets.length&&tickets.every(t=>t.ticketingPcc===expected.pcc))result.pccScope='PCC_CONFIRMED';else result.reasons.push('PCC_NOT_CONFIRMED');
 for(const ticket of tickets){
  const associated=context.view.tickets.find(t=>t.number===ticket.number);
  if(ticket.status!=='Issued'||!associated||associated.travellerIndex!==ticket.travelerIndex)result.reasons.push('DOCUMENT_PASSENGER_OR_STATUS_MISMATCH');
  if(ticket.coupons.length!==context.documents.flightItemIds.length||new Set(ticket.coupons.map(c=>c.itemId)).size!==ticket.coupons.length||ticket.coupons.some(c=>!context.documents.flightItemIds.includes(c.itemId)||!usableCoupon(c.status,c.statusCode)))result.reasons.push('DOCUMENT_SEGMENT_OR_COUPON_STATUS_MISMATCH');
 }
 if(expected.ticketNumbers&&(expected.ticketNumbers.length!==tickets.length||tickets.some(t=>!expected.ticketNumbers!.includes(t.number))))result.reasons.push('RETURNED_TICKET_NUMBER_MISMATCH');
 if(!ticketingPaymentEvidence(context.documents,{currency:expected.currency,amount:expected.amount,ticketNumbers:context.view.tickets.map(t=>t.number)}))result.reasons.push('DOCUMENT_AMOUNT_OR_CURRENCY_MISMATCH');
 result.reasons=[...new Set(result.reasons)];
 if(!result.reasons.length)result.verification='VERIFIED';
 return result;
}
