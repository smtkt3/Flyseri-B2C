import { createHash } from 'node:crypto';
import {validateExchangeMessageTokens} from './exchange-diagnostic-tokens.js';

/** Server-only policy. These are operator-authorized values, not inferred BSP rights. */
export interface TicketingCurrencyPolicy {
  pcc:string; countryCode:string; localCurrency:string; allowedTicketCurrencies:string[];
  pricingMode:'LOCAL_DEFAULT'|'EXPLICIT'; timeZone:string; authorizedBookingPccs?:string[];
}
export type TicketingValidationCode='CURRENCY_NOT_AUTHORIZED'|'PCC_CONTEXT_MISMATCH'|'PRICE_QUOTE_REPRICE_REQUIRED'|'PRICE_QUOTE_SCOPE_INVALID';
export class TicketingValidationError extends Error {
  constructor(readonly code:TicketingValidationCode,message:string){super(message);}
}
export function normalizeCurrency(value:unknown):string{
  if(typeof value!=='string'||!/^\s*[A-Za-z]{3}\s*$/.test(value))throw new TicketingValidationError('CURRENCY_NOT_AUTHORIZED','A valid supplier currency code is required.');
  return value.trim().toUpperCase();
}
export function currencyPolicy(value:string|undefined):TicketingCurrencyPolicy|undefined{
  if(!value)return undefined;
  let p:TicketingCurrencyPolicy;try{p=JSON.parse(value);}catch{throw Error('Invalid server ticketing currency policy');}
  if(!p||typeof p.timeZone!=='string'||!p.timeZone||p.timeZone.length>80||Object.keys(p).some(k=>!['pcc','countryCode','localCurrency','allowedTicketCurrencies','pricingMode','timeZone','authorizedBookingPccs'].includes(k))||!/^[A-Z0-9]{3,4}$/.test(p.pcc)||!/^[A-Z]{2}$/.test(p.countryCode)||!['LOCAL_DEFAULT','EXPLICIT'].includes(p.pricingMode)||!Array.isArray(p.allowedTicketCurrencies)||!p.allowedTicketCurrencies.length||p.allowedTicketCurrencies.length>20||p.allowedTicketCurrencies.some(c=>!/^[A-Z]{3}$/.test(c))||!/^[A-Z]{3}$/.test(p.localCurrency)||!p.allowedTicketCurrencies.includes(p.localCurrency)||p.authorizedBookingPccs!==undefined&&(!Array.isArray(p.authorizedBookingPccs)||p.authorizedBookingPccs.some(pcc=>!/^[A-Z0-9]{3,4}$/.test(pcc))))throw Error('Invalid server ticketing currency policy');
  try{new Intl.DateTimeFormat('en',{timeZone:p.timeZone}).format();}catch{throw Error('Invalid server ticketing timezone');}
  return p;
}
export function credentialPcc(username:string|undefined):string|undefined{
  // Verified OAuth v3 password-grant credential format. Never return the EPR/password.
  return username?.match(/^[^-]+-([A-Z0-9]{3,4})-[^-]+$/)?.[1];
}
export function validateTicketingPcc(configuredPcc:string|undefined,username:string|undefined,policy?:TicketingCurrencyPolicy,bookingPcc?:unknown,farePcc?:unknown){
  const authenticated=credentialPcc(username);
  if(authenticated&&configuredPcc!==authenticated||policy&&policy.pcc!==configuredPcc)throw new TicketingValidationError('PCC_CONTEXT_MISMATCH','Configured and credential PCC context differ. Review server configuration; no ticket request was sent.');
  if(policy){
    const allowed=policy.authorizedBookingPccs??[policy.pcc];
    for(const pcc of [bookingPcc,farePcc])if(typeof pcc!=='string'||!allowed.includes(pcc))throw new TicketingValidationError('PCC_CONTEXT_MISMATCH','Stored booking or fare PCC is missing or not authorized for this ticketing context. Manual review is required.');
  }
}
export function pricingCurrencyQualifiers(currency:unknown,pcc?:string,policy?:TicketingCurrencyPolicy):{currencyPricing?:string}{
  const code=normalizeCurrency(currency);
  if(policy&&pcc!==policy.pcc)throw new TicketingValidationError('PCC_CONTEXT_MISMATCH','The pricing currency policy belongs to another PCC.');
  if(policy&&!policy.allowedTicketCurrencies.includes(code))throw new TicketingValidationError('CURRENCY_NOT_AUTHORIZED','The requested pricing currency is not authorized by this PCC policy.');
  return policy?.pricingMode==='LOCAL_DEFAULT'&&code===policy.localCurrency?{}:{currencyPricing:code};
}
type Obj=Record<string,any>;
export interface StoredTicketingSelection {priceQuoteRecordIds:string[];validatingAirlineCode:string;currency:string;totalAmount:string}
export interface TicketingCurrencyEvidence {
  configuredPcc?:string;credentialPcc?:string;bookingPcc?:string;farePccs:string[];
  requestedCurrency?:string;payableCurrency:string;baseCurrencies:string[];policyCountry?:string;policyLocalCurrency?:string;
  priceQuoteRecordIds:string[];scope:'CURRENT_ITINERARY'|'UNVERIFIED';currencyOverrideHistory:'NOT_EXPOSED_BY_GET_BOOKING';
}
const minor=(value:unknown)=>{if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value))throw new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','The stored supplier payable amount is incomplete.');const [w,f='']=value.split('.');return BigInt(w!)*100n+BigInt(f.padEnd(2,'0'));};
export function validateStoredTicketingCurrency(raw:unknown,context:{pcc?:string;username?:string;policy?:TicketingCurrencyPolicy;requestedCurrency?:string;now?:Date;allowStaleForReprice?:boolean}):{selection:StoredTicketingSelection;currencyEvidence:TicketingCurrencyEvidence}{
  const data=raw as Obj,policy=context.policy;
  if(!data||!Array.isArray(data.fares)||!Array.isArray(data.travelers)||!data.travelers.length)throw new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','Retrieve a valid active stored Price Quote before ticketing.');
  let fares:Obj[]=data.fares.filter((f:Obj)=>f&&typeof f==='object'&&f.recordTypeCode==='PQ'&&f.pricingStatusName==='Active');
  // Sabre can retain an expired PQ as Active after a fresh quote is stored.
  // Exclude explicitly invalid historical quotes only when fresh valid pricing
  // exists; passenger/itinerary uniqueness and all remaining checks still apply.
  if(!context.allowStaleForReprice&&fares.some(fare=>fare.hasValidPricing!==false))fares=fares.filter(fare=>fare.hasValidPricing!==false);
  if(!fares.length||fares.length>9)throw new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','An active stored Price Quote is required. Obtain controlled repricing; do not recreate the reservation.');
  const references:string[]=[],indices:number[]=[],carriers=new Set<string>(),currencies=new Set<string>(),baseCurrencies=new Set<string>(),farePccs=new Set<string>();let total=0n;let itineraryScopeVerified=true;
  const now=context.now??new Date();
  const parts=policy?new Intl.DateTimeFormat('en-CA',{timeZone:policy.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now):[];
  const part=(name:string)=>parts.find(p=>p.type===name)?.value;
  const agencyDate=policy?`${part('year')}-${part('month')}-${part('day')}`:undefined;
  const agencyTime=policy?`${part('hour')}:${part('minute')}`:undefined;
  for(const fare of fares){
    validateTicketingPcc(context.pcc,context.username,policy,data.creationDetails?.userWorkPcc,fare.creationDetails?.userWorkPcc);
    const deadline=fare.creationDetails?.purchaseDeadlineDate;
    const deadlineTime=fare.creationDetails?.purchaseDeadlineTime;
    if(!context.allowStaleForReprice&&(fare.hasValidPricing!==undefined&&fare.hasValidPricing!==true||typeof deadline==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(deadline)&&agencyDate&&(deadline<agencyDate||deadline===agencyDate&&typeof deadlineTime==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(deadlineTime)&&deadlineTime<agencyTime!)))throw new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','The stored Price Quote expired. Supported repricing and any changed-price approval are required before ticketing.');
    if(typeof fare.creationDetails?.userWorkPcc==='string'&&/^[A-Z0-9]{3,4}$/.test(fare.creationDetails.userWorkPcc))farePccs.add(fare.creationDetails.userWorkPcc);
    const components=fare.fareConstruction;
    if(!Array.isArray(components)||!components.length||components.some((c:Obj)=>c?.isCurrentItinerary!==true))itineraryScopeVerified=false;
    if(components!==undefined&&!Array.isArray(components))throw new TicketingValidationError('PRICE_QUOTE_SCOPE_INVALID','The stored fare construction is incomplete.');
    if(policy&&(!Array.isArray(components)||!components.length)||Array.isArray(components)&&components.some((c:Obj)=>!c||typeof c!=='object'||c.isCurrentItinerary===false))throw new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','The stored Price Quote does not establish the current itinerary. Controlled repricing is required.');
    for(const component of components??[]){
      if(policy&&component.isCurrentItinerary!==true)throw new TicketingValidationError('PRICE_QUOTE_SCOPE_INVALID','The Price Quote itinerary association is unverified.');
      if(component.baseRate?.currencyCode)baseCurrencies.add(normalizeCurrency(component.baseRate.currencyCode));
      if(component.flights!==undefined&&(!Array.isArray(component.flights)||component.flights.some((f:Obj)=>!data.flights?.some((current:Obj)=>current.itemId===f.itemId)))||component.flightIndices!==undefined&&(!Array.isArray(component.flightIndices)||component.flightIndices.some((n:unknown)=>!Number.isInteger(n)||Number(n)<1||Number(n)>(data.flights?.length??0))))throw new TicketingValidationError('PRICE_QUOTE_SCOPE_INVALID','The stored fare references different flight segments.');
    }
    if(fare.originalTotalValues?.currencyCode)baseCurrencies.add(normalizeCurrency(fare.originalTotalValues.currencyCode));
    const code=normalizeCurrency(fare.totals?.currencyCode);currencies.add(code);
    if(policy&&!policy.allowedTicketCurrencies.includes(code))throw new TicketingValidationError('CURRENCY_NOT_AUTHORIZED','The stored Price Quote payable currency is not authorized for the ticketing PCC. A converted display price is insufficient.');
    const selected=Array.isArray(fare.travelerIndices)?fare.travelerIndices:fares.length===1?data.travelers.map((_:unknown,i:number)=>i+1):[];
    if(!selected.length||selected.some((i:unknown)=>!Number.isInteger(i)||Number(i)<1||Number(i)>data.travelers.length))throw new TicketingValidationError('PRICE_QUOTE_SCOPE_INVALID','Stored fare passenger scope is ambiguous.');
    references.push(String(fare.recordId??''));indices.push(...selected);carriers.add(fare.airlineCode);total+=minor(fare.totals?.total)*BigInt(selected.length);
  }
  if(carriers.size!==1||[...carriers].some(c=>typeof c!=='string'||!/^[A-Z0-9]{2}$/.test(c))||currencies.size!==1||references.some(id=>!/^[A-Z0-9]{1,3}$/.test(id))||new Set(references).size!==references.length||indices.length!==data.travelers.length||new Set(indices).size!==indices.length)throw new TicketingValidationError('PRICE_QUOTE_SCOPE_INVALID','Stored validating carrier and fare scope need specialist review.');
  const currency=[...currencies][0]!;
  if(context.requestedCurrency&&normalizeCurrency(context.requestedCurrency)!==currency)throw new TicketingValidationError('CURRENCY_NOT_AUTHORIZED','Accepted and stored supplier payable currencies differ. Do not convert a ticket amount manually.');
  return {selection:{priceQuoteRecordIds:references,validatingAirlineCode:[...carriers][0]!,currency,totalAmount:(total/100n)+'.'+(total%100n).toString().padStart(2,'0')},currencyEvidence:{configuredPcc:context.pcc,credentialPcc:credentialPcc(context.username),bookingPcc:typeof data.creationDetails?.userWorkPcc==='string'&&/^[A-Z0-9]{3,4}$/.test(data.creationDetails.userWorkPcc)?data.creationDetails.userWorkPcc:undefined,farePccs:[...farePccs],requestedCurrency:context.requestedCurrency,payableCurrency:currency,baseCurrencies:[...baseCurrencies],policyCountry:policy?.countryCode,policyLocalCurrency:policy?.localCurrency,priceQuoteRecordIds:references,scope:itineraryScopeVerified?'CURRENT_ITINERARY':'UNVERIFIED',currencyOverrideHistory:'NOT_EXPOSED_BY_GET_BOOKING'}};
}
export function alternateCurrencyRestriction(errors:unknown):{code:string;messageFamily:'ALTERNATE_CURRENCY_NOT_ALLOWED'|'REQUESTED_CURRENCY_RESTRICTED';classification:'SABRE_CURRENCY_RESTRICTION';manualSupportRequired:true}|null{
  if(!Array.isArray(errors))return null;
  for(const error of errors){
    const description=typeof error?.description==='string'?error.description:'';
    if(/TICKETING IN ALTERNATE CURRENCY NOT ALLOWED-2101\b/i.test(description))return {code:'2101',messageFamily:'ALTERNATE_CURRENCY_NOT_ALLOWED',classification:'SABRE_CURRENCY_RESTRICTION',manualSupportRequired:true};
    const related=description.match(/(TICKETING IN ALTERNATE CURRENCY NOT ALLOWED|CANNOT TICKET IN CURRENCY REQUESTED)-(\d{4})\b/i);
    if(related)return {code:related[2]!,messageFamily:related[1]!.toUpperCase().startsWith('CANNOT')?'REQUESTED_CURRENCY_RESTRICTED':'ALTERNATE_CURRENCY_NOT_ALLOWED',classification:'SABRE_CURRENCY_RESTRICTION',manualSupportRequired:true};
    if(/TICKETING IN ALTERNATE CURRENCY NOT ALLOWED|CANNOT TICKET IN CURRENCY REQUESTED/i.test(description))return {code:'UNSPECIFIED',messageFamily:/CANNOT TICKET/i.test(description)?'REQUESTED_CURRENCY_RESTRICTED':'ALTERNATE_CURRENCY_NOT_ALLOWED',classification:'SABRE_CURRENCY_RESTRICTION',manualSupportRequired:true};
  }
  return null;
}
/** Persist classifications, never free-form supplier text that can echo passenger PII. */
export interface SanitizedTicketingError {category?:string;type?:string;fieldName?:string;fieldPath?:string;description?:string;messageTokens?:string[];providerCodes?:string[];providerMessageCodes?:string[];supplierOperations?:string[];descriptionSource?:'CANONICAL_MATCH'|'PUBLIC_MESSAGE_HASH_MATCH';descriptionFingerprint?:string;unclassifiedAirTicketMessage?:boolean}
// Canonical summaries of documented Fulfill Flight Tickets errors, not raw
// supplier descriptions (which may echo card, locator or passenger data).
// Source: Developer Hub /fulfill-flight-tickets-error-list.html, 26 Oct 2026.
const fulfillmentFailures:Readonly<Record<string,string>>={
  PAYMENT_REQUIRED:'Supplier form of payment is missing.',
  PAYMENT_NOT_FOUND:'The referenced supplier form of payment was not found.',
  PAYMENT_INDEX_OUT_OF_BOUNDS:'The fulfillment payment reference is outside the forms of payment list.',
  PAYMENT_DUPLICATE_REFERENCE:'Primary and secondary payment references are duplicated.',
  INVALID_PAYMENT_CARD_NUMBER:'The supplier payment card number is invalid.',
  PAYMENT_CARD_CVV_INVALID:'The supplier payment card security code is invalid.',
  PAYMENT_CARD_CVV_MISSING:'The supplier payment card security code is missing.',
  PAYMENT_CARD_DECLINED:'The supplier payment card was declined.',
  PAYMENT_CARD_EXPIRATION_DATE_INVALID:'The supplier payment card expiry date is invalid.',
  PAYMENT_CARD_ISSUE:'The supplier reported a payment card issue.',
  PENDING_PAYMENT:'Supplier payment is pending; this does not describe the client Stripe payment.',
  FAILED_PAYMENT:'Supplier payment failed; this does not describe the client Stripe payment.',
  CARDHOLDER_DATA_MISSING:'Required supplier cardholder details are missing.',
  PAYER_DATA_MISSING:'Required supplier payer details are missing.',
  PRICE_MISMATCH:'The supplier price changed; approved price review is required.',
  PRICE_QUOTE_RECORD_NUMBER_INVALID:'The supplier price quote record reference is invalid.',
  PRICE_QUOTE_REISSUE_RECORD_NUMBER_INVALID:'The supplier reissue quote record reference is invalid.',
  SECURE_FLIGHT_PASSENGER_DATA_MISSING:'Required secure flight passenger data is missing.',
  AIR_TICKET_VALIDATING_AIRLINE_MISSING:'The supplier validating airline is missing.',
  MINIMUM_CONNECT_TIME_NOT_VALID:'The supplier rejected the connection time.',
  MISSING_PRICE_QUOTE_AIR_EXTRAS_DETAILS:'Stored pricing is missing required air extras details.',
  INTERNAL_SERVER_TIMEOUT:'Supplier processing timed out; reconcile documents before further action.',
  INVALID_FLAGS_COMBINATION:'The supplier rejected an incompatible combination of request fields.',
};
export function sanitizedTicketingErrors(errors:unknown):SanitizedTicketingError[]{
  if(!Array.isArray(errors))return [];
  return errors.slice(0,10).map(error=>{
    const result:SanitizedTicketingError={};
    if(['APPLICATION_ERROR','BAD_REQUEST','INVALID_DATA','RESOURCE_NOT_FOUND','INTERNAL_SERVER_ERROR','APPLICATION_WARNING','PROCESSING_WARNING'].includes(error?.category))result.category=error.category;
    if(typeof error?.type==='string'&&(Object.hasOwn(fulfillmentFailures,error.type)||['DOWNLINE_SERVICE_ERROR','DOWNLINE_SERVICE_WARNING','UNABLE_TO_RETRIEVE_TICKETS','PRINTER_NOT_ASSIGNED','INVALID_VALUE','MANDATORY_DATA_MISSING'].includes(error.type)))result.type=error.type;
    if(result.type&&Object.hasOwn(fulfillmentFailures,result.type))result.description=fulfillmentFailures[result.type];
    if(error?.fieldName==='ticket')result.fieldName='ticket';
    if(error?.fieldPath==='FulfillTicketsRequest.designatePrinters')result.fieldPath='FulfillTicketsRequest.designatePrinters';
    if(error?.fieldPath==='CheckTicketsRequest')result.fieldPath='CheckTicketsRequest';
    const restriction=alternateCurrencyRestriction([error]);
    const text=typeof error?.description==='string'?error.description:'';
    // Documented Enhanced Air Ticket masks must survive sanitization. Retaining only
    // the generic document-service summary loses the actual reason for failed issuance.
    const knownMessages=[
      'UNABLE TO TICKET STORED FARE - PQ EXPIRED',
      'UNABLE TO TICKET STORED FARE - PQ CONTAINS BACK DATE PRICE',
      'UNABLE TO TICKET STORED FARE - NEGOTIATED FARE STORED',
      'VERIFY TKT TTL (*) TICKET',
      'TKT PRT NOT ASSIGNED/USE W*-1496',
      'SIMULTANEOUS CHANGES TO PNR - USE IR TO IGNORE AND RETRIEVE PNR',
      'Tickets might have been issued successfully but application could not retrieve them.',
      'UNABLE TO REPRICE FOR AUTOMATED AND MANUAL REISSUE',
      'REISSUE NOT ALLOWED - NUMBER OF REISSUES RESTRICTED',
      'INVALID AS BOOKED - LOWER FARE APPLIES',
      'FLT$ CHK DATE/TIME CONTINUITY',
      'NO COMBINABLE FARES FOR CLASS USED',
      'VERIFY COUPON STATUS',
      'BASE/EQV CURRENCY MUST BE THE SAME ON THE EXCH AND NEW TICKET',
      'INCORRECT COUPON STATUS FOR ALL REQUESTED TICKETS',
      'WFRF ENTRY NOT AVAILABLE',
      'NEED VALIDATING CARRIER',
      'NEED FOP',
      'Unable to perform automated exchanges confirmation step. Comparison step did not generate PQR Number',
    ].filter(message=>text.toUpperCase().includes(message.toUpperCase()));
    if(restriction)result.description=(restriction.messageFamily==='ALTERNATE_CURRENCY_NOT_ALLOWED'?'TICKETING IN ALTERNATE CURRENCY NOT ALLOWED-':'CANNOT TICKET IN CURRENCY REQUESTED-')+restriction.code;
    else if(text.includes('VALIDATING CARRIER NOT PRESENT IN ITINERARY'))result.description='VALIDATING CARRIER NOT PRESENT IN ITINERARY';
    if(knownMessages.length)result.description=[result.description,...knownMessages].filter(Boolean).join('; ');
    if(error?.type==='UNABLE_TO_RETRIEVE_TICKETS')result.description='Tickets may have been issued, but Sabre could not retrieve them. Verify booking details and agency audit records before any further action.';
    // Codes and fingerprints are safe support references, never arbitrary supplier text.
    const codes=[...text.matchAll(/\bAirTicketLLSRQ:\s*[^;\r\n]{0,8192}?-(\d{4})\b/g)].map(match=>match[1]!);
    const savedCodes=Array.isArray(error?.providerCodes)?error.providerCodes.filter((code:unknown)=>typeof code==='string'&&/^\d{4}$/.test(code)):[];
    if(codes.length||savedCodes.length)result.providerCodes=[...new Set<string>([...codes,...savedCodes])].slice(0,5);
    // Stored diagnostics pass through this sanitizer again in the developer
    // console. Preserve validated metadata rather than hashing the safe summary
    // and discarding the original provider codes on every read.
    if(typeof error?.descriptionFingerprint==='string'&&/^[a-f0-9]{64}$/.test(error.descriptionFingerprint))result.descriptionFingerprint=error.descriptionFingerprint;
    else if(text)result.descriptionFingerprint=createHash('sha256').update(text).digest('hex');
    if(error?.unclassifiedAirTicketMessage===true||/\bAirTicketLLS(?:RQ)?\b/.test(text)&&!restriction&&!knownMessages.length&&!result.description)result.unclassifiedAirTicketMessage=true;
    if(text.includes('TicketingDocumentServicesRQ: No new tickets have been issued'))result.description=(result.description?result.description+'; ':'')+'TicketingDocumentServicesRQ: No new tickets have been issued';
    const messageCodes=Array.isArray(error?.providerMessageCodes)?error.providerMessageCodes.filter((code:unknown)=>typeof code==='string'&&/^(?:ERR|WARN)\.(?:SP|SWS)\.[A-Z_.]{1,80}$/.test(code)):[];
    if(messageCodes.length)result.providerMessageCodes=[...new Set<string>(messageCodes)].slice(0,10);
    const messageTokens=validateExchangeMessageTokens(error?.messageTokens);if(messageTokens.length)result.messageTokens=messageTokens;
    const operations=['AutomatedExchangesLLSRQ','OTA_AirBookLLSRQ','GetReservationRQ','EndTransactionLLSRQ','DisplayPriceQuoteLLSRQ','AirTicketLLSRQ'];
    const sources=operations.filter(operation=>text.includes(operation)||Array.isArray(error?.supplierOperations)&&error.supplierOperations.includes(operation));
    if(sources.length)result.supplierOperations=sources;
    if(result.description)result.descriptionSource=error?.descriptionSource==='PUBLIC_MESSAGE_HASH_MATCH'?'PUBLIC_MESSAGE_HASH_MATCH':'CANONICAL_MATCH';
    // Exact public-message hash match, never an inference from an unknown error.
    if(!result.description&&result.descriptionFingerprint==='91a1136e96f148dfee7af40ec739bfeccdac5bf338fdcb19c7207fde5e671283'){
      result.description='No new tickets have been issued';
      result.descriptionSource='PUBLIC_MESSAGE_HASH_MATCH';
    }
    if(!result.description&&result.descriptionFingerprint==='f0c8eaaefd23657a5405e0f900706b76682b1fd7dfe405824687aef9d7e7dd78'){
      result.description='Unable to perform automated exchanges confirmation step. Comparison step did not generate PQR Number';
      result.descriptionSource='PUBLIC_MESSAGE_HASH_MATCH';
    }
    if(!result.description&&result.descriptionFingerprint==='4e0ba09fc56514f2785fb71cee6174bd08a6d7cb416dca74c790877205cdcd01'){
      result.description='AutomatedExchangesLLSRQ: NEED VALIDATING CARRIER';
      result.descriptionSource='PUBLIC_MESSAGE_HASH_MATCH';
    }
    if(!result.description&&result.descriptionFingerprint==='c3b1ae7a171e6d4be3ea292610d9c962042f95cb3a2cb7bf58d50374b8bd1784'){
      result.description='AutomatedExchangesLLSRQ: NEED FOP';
      result.descriptionSource='PUBLIC_MESSAGE_HASH_MATCH';
    }
    return result;
  });
}
