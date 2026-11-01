import { createHash } from 'node:crypto';
import type { FlightBookingProviderView } from '@flyseri/types';

export type ContactChange={travelerIndex:number;email:string;phone:string};
type ContactTraveler={givenName:string;surname:string;emails:string[];phones:{number:string;label?:string}[]};
export type ContactContext={bookingId:string;signature:string;travelers:ContactTraveler[];view:FlightBookingProviderView};
export type ContactPlan={change:ContactChange;bookingId:string;signatureHash:string;baseline:string;reference:string;expiresAt:string;previousStatus:string};
const object=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizedPhone=(value:string)=>value.replace(/\D/g,'');
export function contactChange(value:unknown):ContactChange{
  const input=object(value);
  if(!input||Object.keys(input).some(key=>!['travelerIndex','email','phone'].includes(key))||!Number.isSafeInteger(input.travelerIndex)||Number(input.travelerIndex)<0||Number(input.travelerIndex)>8||typeof input.email!=='string'||input.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)||typeof input.phone!=='string'||!/^\+[1-9]\d{6,14}$/.test(input.phone))throw Error('Choose a traveler, valid email and international phone number.');
  return {travelerIndex:Number(input.travelerIndex),email:input.email.trim().toLowerCase(),phone:input.phone};
}
export function readContactContext(value:unknown,identity:{bookingId:string;view:FlightBookingProviderView}):ContactContext{
  const data=object(value),flights=data?.flights,segments=data?.allSegments;
  if(typeof data?.bookingSignature!=='string'||!data.bookingSignature||!Array.isArray(data.travelers)||!data.travelers.length||data.travelers.length>9||!identity.view.cancellationCheckComplete||!Array.isArray(flights)||!flights.length||!flights.every(flight=>object(flight)?.sourceType==='ATPCO')||!Array.isArray(segments)||segments.length!==flights.length||!segments.every(segment=>object(segment)?.type==='FLIGHT')||data.ancillaries!==undefined&&(!Array.isArray(data.ancillaries)||data.ancillaries.length))throw Error('Contact updates require a complete ATPCO flight-only booking without extras.');
  const travelers=data.travelers.map(value=>{
    const row=object(value);
    if(typeof row?.givenName!=='string'||typeof row.surname!=='string'||row.isGrouped===true||row.emails!==undefined&&(!Array.isArray(row.emails)||!row.emails.every(email=>typeof email==='string'))||row.phones!==undefined&&(!Array.isArray(row.phones)||!row.phones.every(phone=>typeof object(phone)?.number==='string')))throw Error('Traveler contact evidence is incomplete.');
    return {givenName:row.givenName,surname:row.surname,emails:(row.emails??[]) as string[],phones:((row.phones??[]) as {number:string;label?:string}[]).map(phone=>({number:phone.number,...(phone.label?{label:phone.label}:{})}))};
  });
  if(new Set(travelers.map(person=>(person.givenName+' '+person.surname).toUpperCase())).size!==travelers.length)throw Error('Travelers with duplicate names need specialist contact servicing.');
  return {...identity,signature:data.bookingSignature,travelers};
}
function baseline(context:ContactContext){
  return hash({bookingId:context.bookingId,travelers:context.view.travellers,flights:context.view.flights,tickets:context.view.tickets});
}
export function prepareContactPlan(context:ContactContext,change:ContactChange,previousStatus:string):ContactPlan{
  if(!context.travelers[change.travelerIndex])throw Error('The selected traveler is no longer present.');
  const signatureHash=hash(context.signature),fingerprint=hash({signatureHash,change});
  return {change,bookingId:context.bookingId,signatureHash,baseline:baseline(context),reference:'CONTACT-'+fingerprint.slice(0,16).toUpperCase(),expiresAt:new Date(Date.now()+10*60000).toISOString(),previousStatus};
}
export function contactModificationRequest(pnr:string,context:ContactContext,plan:ContactPlan){
  if(context.bookingId!==plan.bookingId||hash(context.signature)!==plan.signatureHash||Date.parse(plan.expiresAt)<=Date.now()||baseline(context)!==plan.baseline)throw Error('The booking changed. Prepare a new contact update.');
  const person=context.travelers[plan.change.travelerIndex];
  if(!person)throw Error('Traveler missing.');
  // Only the selected contact fields are included. No name, itinerary, payment,
  // document, SSR or loyalty mutation can be supplied by the browser.
  const before={givenName:person.givenName,surname:person.surname,emails:person.emails,phones:person.phones};
  const after={...before,emails:[plan.change.email],phones:[{number:plan.change.phone,label:'M'}]};
  return {confirmationId:pnr,bookingSignature:context.signature,bookingSource:'SABRE',retrieveBooking:true,receivedFrom:'Flyseri CERT approved contact update',before:{travelers:[before]},after:{travelers:[after]}};
}
export function contactModificationComplete(context:ContactContext,plan:ContactPlan){
  const person=context.travelers[plan.change.travelerIndex];
  return context.bookingId===plan.bookingId&&baseline(context)===plan.baseline&&person?.emails.length===1&&person.emails[0]?.toLowerCase()===plan.change.email&&person.phones.length===1&&normalizedPhone(person.phones[0]!.number)===normalizedPhone(plan.change.phone);
}
