import {sanitizedTicketingErrors} from './ticketing-currency.contract.js';
import type {SabreTicketingProfile} from './sabre-booking-management.client.js';
import {ticketingExecutionOptions,type TicketingExecutionOptions} from './ticketing-execution.contract.js';
import type {ExchangePqr} from './flight-exchange-execution.contract.js';
import {exchangeMessageTokens} from './exchange-diagnostic-tokens.js';

/** Exact ATPCO CASH shape supplied by Sabre support and verified against 1.3.0. */
export function buildEnhancedAirTicket(pnr:string,pcc:string,profile:SabreTicketingProfile,records:string[],execution:TicketingExecutionOptions){
 const options=ticketingExecutionOptions(execution);
 if(options.ticketingApi!=='ENHANCED_AIR_TICKET'||profile.formOfPayment!=='CASH'||!/^[A-Z0-9]{6}$/.test(pnr)||!/^[A-Z0-9]{4}$/.test(pcc)||!/^[A-Z]{2}$/.test(profile.ticketCountryCode??'')||!/^[A-Z0-9]{6}$/.test(profile.hardcopyPrinterAddress)||!records.length||records.length>9||new Set(records).size!==records.length||records.some(id=>!/^[1-9]\d{0,2}$/.test(id)))throw Error('Verified ATPCO CERT CASH profile, ticket country, PNR, PCC and stored PQ records are required.');
 return {
  AirTicketRQ:{
   version:'1.3.0',targetCity:pcc,
   DesignatePrinter:{Printers:{Ticket:{CountryCode:profile.ticketCountryCode!},Hardcopy:{LNIATA:profile.hardcopyPrinterAddress},InvoiceItinerary:{LNIATA:profile.hardcopyPrinterAddress}}},
   Itinerary:{ID:pnr},
   Ticketing:[{
    FOP_Qualifiers:{BasicFOP:{Type:'CA'}},
    ...(options.commissionPercent!==undefined?{MiscQualifiers:{Commission:{Percent:options.commissionPercent}}}:{}),
    PricingQualifiers:{PriceQuote:[{Record:records.map(id=>({Number:Number(id),Reissue:false}))}]},
   }],
   PostProcessing:{acceptPriceChanges:false,acceptNegotiatedFare:false,actionOnPQExpired:options.quoteHandling==='Reprice'?'R':'Q',actionOnBackDatePrice:options.quoteHandling==='Reprice'?'R':'Q',EndTransaction:{Source:{ReceivedFrom:pcc+' WEB'}}},
  },
 };
}
/** Stored PQRs already carry confirmation payment data. Follow the retained
 * Sabre reissue sample: select PQR records without adding initial-issue FOP or
 * ticket modifiers to the retained reissue command. */
export function buildEnhancedReissue(pnr:string,pcc:string,profile:SabreTicketingProfile,pqrs:ExchangePqr[]){
 if(!pqrs.length||new Set(pqrs.map(pqr=>pqr.ticketNumber)).size!==pqrs.length||pqrs.some(pqr=>!/^\d{13}$/.test(pqr.ticketNumber)||!pqr.validatingAirlineCode||!/^[A-Z0-9]{2}$/.test(pqr.validatingAirlineCode)))throw Error('Verified original ticket and validating carrier associations are required for PQR reissue');
 const request=buildEnhancedAirTicket(pnr,pcc,profile,pqrs.map(pqr=>pqr.id),{ticketingApi:'ENHANCED_AIR_TICKET',quoteHandling:'Quit',commitWaitMs:0});
 return {AirTicketRQ:{...request.AirTicketRQ,Ticketing:[{
  PricingQualifiers:{PriceQuote:[{Record:pqrs.map(pqr=>({Number:Number(pqr.id),Reissue:true}))}]},
 }]}};
}
/** EMD-only selection uses Get Booking itemId, never PQ records or host AE line numbers. */
export function buildEnhancedAirExtras(pnr:string,pcc:string,profile:SabreTicketingProfile,ids:string[]){
 if(profile.formOfPayment!=='CASH'||!/^[A-Z0-9]{6}$/.test(pnr)||!/^[A-Z0-9]{4}$/.test(pcc)||!/^[A-Z]{2}$/.test(profile.ticketCountryCode??'')||!/^[A-Z0-9]{6}$/.test(profile.hardcopyPrinterAddress)||!ids.length||ids.length>40||new Set(ids).size!==ids.length||ids.some(id=>!(/^[1-9]\d{0,9}$/).test(id)||Number(id)>2147483647))throw Error('Verified CERT CASH profile and numeric Get Booking ancillary item IDs are required.');
 return {AirTicketRQ:{version:'1.3.0',targetCity:pcc,
  DesignatePrinter:{Printers:{Ticket:{CountryCode:profile.ticketCountryCode!},Hardcopy:{LNIATA:profile.hardcopyPrinterAddress},InvoiceItinerary:{LNIATA:profile.hardcopyPrinterAddress}}},
  Itinerary:{ID:pnr},Ticketing:[{FOP_Qualifiers:{BasicFOP:{Type:'CA'}},MiscQualifiers:{AirExtras:ids.map(id=>({itemId:Number(id)}))}}],
  PostProcessing:{acceptPriceChanges:false,acceptNegotiatedFare:false,actionOnPQExpired:'Q',actionOnBackDatePrice:'Q',EndTransaction:{Source:{ReceivedFrom:pcc+' WEB'}}},
 }};
}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const list=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.slice(0,99).map(object):[];
/** Only codes, canonical summaries and fingerprints escape this boundary. */
export function enhancedTicketDiagnostics(raw:unknown,exchangePrivateValues?:string[]){
 const response=object(object(raw).AirTicketRS),results=object(response.ApplicationResults);
 function classify(value:unknown,warning:boolean){
  return list(value).slice(0,10).map(result=>{
   const systems=list(result.SystemSpecificResults);
   const messages=systems.flatMap(system=>list(system.Message));
   const descriptions=[...messages.map(message=>message.content),...systems.map(system=>system.ShortText)].filter((value):value is string=>typeof value==='string').join('; ');
   const codes=messages.map(message=>message.code).filter((value):value is string=>typeof value==='string'&&/^\d{4}$/.test(value));
   const messageCodes=messages.map(message=>message.code).filter((value):value is string=>typeof value==='string'&&/^(?:ERR|WARN)\.(?:SP|SWS)\.[A-Z_.]{1,80}$/.test(value));
   return sanitizedTicketingErrors([{category:warning?'PROCESSING_WARNING':'APPLICATION_ERROR',type:warning?'DOWNLINE_SERVICE_WARNING':'DOWNLINE_SERVICE_ERROR',description:descriptions,...(codes.length?{providerCodes:codes}:{}),...(messageCodes.length?{providerMessageCodes:messageCodes}:{}),...(exchangePrivateValues?{messageTokens:exchangeMessageTokens(descriptions,exchangePrivateValues)}:{})}])[0]!;
  });
 }
 return {status:typeof results.status==='string'&&['Complete','Incomplete','NotProcessed','Unknown'].includes(results.status)?results.status:'Unknown',errors:classify(results.Error,false),warnings:classify(results.Warning,true)};
}
export function readEnhancedAirTicket(raw:unknown,pnr:string,pcc:string,privateValues?:string[]){
 const response=object(object(raw).AirTicketRS),results=object(response.ApplicationResults),diagnostics=enhancedTicketDiagnostics(raw,privateValues);
 const summary=list(response.Summary);
 const tickets=summary.filter(item=>item.DocumentType==='TKT').map(item=>({number:typeof item.DocumentNumber==='string'?item.DocumentNumber:'',payment:{total:object(item.TotalAmount).content,currencyCode:object(item.TotalAmount).currencyCode}}));
 const complete=diagnostics.status==='Complete'&&Array.isArray(results.Success)&&results.Success.length>0&&(results.Error===undefined||Array.isArray(results.Error)&&!results.Error.length)&&(results.Warning===undefined||Array.isArray(results.Warning))&&Array.isArray(response.Summary)&&summary.length===response.Summary.length&&summary.length>0&&summary.every(item=>item.DocumentType==='TKT'&&/^\d{13}$/.test(String(item.DocumentNumber))&&object(item.Reservation).content===pnr&&item.IssuingLocation===pcc&&item.committed!==false&&!item.DocumentStatus)&&new Set(tickets.map(item=>item.number)).size===tickets.length;
 return {...diagnostics,tickets,complete};
}
export function readEnhancedAirExtras(raw:unknown,pnr:string,pcc:string,privateValues:string[]=[]){
 const response=object(object(raw).AirTicketRS),results=object(response.ApplicationResults),diagnostics=enhancedTicketDiagnostics(raw,[pnr,pcc,...privateValues]),summary=list(response.Summary);
 const documents=summary.filter(item=>item.DocumentType==='EMD').map(item=>({number:typeof item.DocumentNumber==='string'?item.DocumentNumber:''}));
 // No flight ticket is acceptable in an EMD-only response, even on HTTP 200.
 const verified=diagnostics.status==='Complete'&&Array.isArray(results.Success)&&results.Success.length>0&&(results.Error===undefined||Array.isArray(results.Error)&&!results.Error.length)&&(results.Warning===undefined||Array.isArray(results.Warning))&&Array.isArray(response.Summary)&&summary.length===response.Summary.length&&summary.length>0&&summary.every(item=>item.DocumentType==='EMD'&&/^\d{13}$/.test(String(item.DocumentNumber))&&object(item.Reservation).content===pnr&&item.IssuingLocation===pcc&&item.committed!==false&&!item.DocumentStatus)&&new Set(documents.map(d=>d.number)).size===documents.length;
 return {...diagnostics,documents,complete:verified};
}
