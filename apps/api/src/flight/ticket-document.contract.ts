import {createHash} from 'node:crypto';
import type {FlightBooking,FlightBookingProviderView} from '@flyseri/types';
import {hasCurrentIssuedTicketEvidence,hasExchangedCouponEvidence,matchesConfirmedItinerary} from './reservation-evidence.js';
import type {PurchaseBooking} from './ancillary-purchase.contract.js';
import {isEmail} from 'class-validator';

export interface TicketEmailJob {id:string;status:'QUEUED'|'SENDING'|'SENT'|'REVIEW_REQUIRED'|'SUPERSEDED';recipient:string;ticketNumbers:string[];queuedAt:string;claimedAt?:string;sentAt?:string}
export type TicketDeliverySnapshot=Record<string,unknown>&{checkoutContactEmail?:string;ticketEmail?:TicketEmailJob};
export const validTicketEmail=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&!/[,;<>\r\n]/.test(value)&&isEmail(value,{allow_display_name:false});
export function ticketDocumentAvailable(booking:FlightBooking):boolean{
 const view=booking.providerView;
 return booking.status==='TICKETED'&&booking.passengerNamesSource==='BOOKED_SNAPSHOT'&&!!booking.pnr&&!!view&&view.cancellationCheckComplete&&hasCurrentIssuedTicketEvidence(view,booking.passengerNames.length)&&matchesConfirmedItinerary(view,booking.selectedOffer)&&view.travellers.length===booking.passengerNames.length&&view.travellers.every((person,index)=>(person.givenName+' '+person.surname).trim().replace(/\s+/g,' ').toUpperCase()===booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase());
}
export const currentTicketNumbers=(view:FlightBookingProviderView)=>view.tickets.filter(ticket=>!hasExchangedCouponEvidence(ticket)).map(ticket=>ticket.number).sort();
/** Older reservations may predate contact persistence. Use one unambiguous,
 * identity-matched booked address; never guess from a mutable profile. */
export async function resolveTicketEmail(snapshot:TicketDeliverySnapshot,bookingId:string,view:FlightBookingProviderView,read:()=>Promise<PurchaseBooking>):Promise<string|undefined>{
 if(validTicketEmail(snapshot.checkoutContactEmail))return snapshot.checkoutContactEmail;
 try{
  const current=await read(),name=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
  if(current.bookingId!==bookingId||current.travelers.length!==view.travellers.length||current.travelers.some((person,index)=>name(String(person.givenName)+' '+String(person.surname))!==name(view.travellers[index]!.givenName+' '+view.travellers[index]!.surname)))return;
  const emails=[...new Set(current.travelers.flatMap(person=>Array.isArray(person.emails)?person.emails.filter(validTicketEmail).map(email=>email.toLowerCase()):[]))];
  return emails.length===1?emails[0]:undefined;
 }catch{return undefined;}
}
/** Called in the same transaction that persists independently verified documents. */
export function queueTicketEmail(snapshot:TicketDeliverySnapshot,bookingId:string,view:FlightBookingProviderView):TicketDeliverySnapshot{
 if(!validTicketEmail(snapshot.checkoutContactEmail)||!hasCurrentIssuedTicketEvidence(view,view.travellers.length))return snapshot;
 const ticketNumbers=currentTicketNumbers(view),id=createHash('sha256').update(JSON.stringify({bookingId,ticketNumbers,flights:view.flights,recipient:snapshot.checkoutContactEmail})).digest('hex');
 if(snapshot.ticketEmail?.id===id)return snapshot;
 return {...snapshot,ticketEmail:{id,status:'QUEUED',recipient:snapshot.checkoutContactEmail,ticketNumbers,queuedAt:new Date().toISOString()}};
}
