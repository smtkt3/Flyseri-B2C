import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {AppConfig} from '@flyseri/config';
import {buildEnhancedAirTicket,buildEnhancedReissue,readEnhancedAirTicket,enhancedTicketDiagnostics} from './enhanced-air-ticket.contract.js';
import {ticketingExecutionOptions,sameTicketingExecution,type TicketingExecutionOptions} from './ticketing-execution.contract.js';
import {SabreBookingManagementClient,SabreBookingUnknownError} from './sabre-booking-management.client.js';
import {FlightTicketingService} from './flight-ticketing.service.js';
const policy:TicketingExecutionOptions={ticketingApi:'ENHANCED_AIR_TICKET',quoteHandling:'Quit',commitWaitMs:0,commissionPercent:7};
const profile={formOfPayment:'CASH' as const,ticketCountryCode:'BD',hardcopyPrinterAddress:'ABC123'};
const selection={priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'};
const response=()=>({AirTicketRS:{ApplicationResults:{status:'Complete',Success:[{timeStamp:'2026-10-27T02:00:00Z'}]},Summary:[{DocumentNumber:'9971234567890',DocumentType:'TKT',IssuingLocation:'BD01',Reservation:{content:'ABC123'},committed:true,TotalAmount:{content:'6049.00',currencyCode:'BDT'}}]}});
const config={APP_ENV:'test',SABRE_ENV:'CERT',SABRE_PCC:'BD01',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig;
const client=(http:typeof fetch,override={})=>new SabreBookingManagementClient({...config,...override},{token:async()=>'fixture-token'} as never,http);
describe('Enhanced Air Ticket ATPCO CERT boundary',()=>{
 it('uses the retained Sabre PQR sample selection without an initial-issue FOP override',()=>{
  type Sample={name?:string;request?:{body?:{raw?:string}};item?:Sample[]};
  const collection=JSON.parse(readFileSync('../../reference/sabre/Sabre APIs v2023.02.postman_collection.json','utf8')) as Sample;
  const samples:Sample[]=[];
  const visit=(node:Sample)=>{if(node.name==='AirTicketRQ 1.2.1 Reissue Ticket (PQR)')samples.push(node);for(const child of node.item??[])visit(child);};visit(collection);
  expect(samples.length).toBeGreaterThan(0);
  for(const sample of samples){
   expect(sample.request?.body?.raw).toContain('Reissue="true"');
   expect(sample.request?.body?.raw).not.toContain('FOP_Qualifiers');
  }
  const request=buildEnhancedReissue('ABC123','BD01',profile,[{id:'3',ticketNumber:'9971234567890',amount:'1000.00',validatingAirlineCode:'BG'}]);
  expect(request.AirTicketRQ.Ticketing[0]!.PricingQualifiers.PriceQuote[0]!.Record).toEqual([{Number:3,Reissue:true}]);
  expect(request.AirTicketRQ.Ticketing[0]).not.toHaveProperty('FOP_Qualifiers');
 });
 it('distinguishes PQR reissue from initial PQ issuance without a commission override',()=>{
  const reissue=buildEnhancedReissue('ABC123','BD01',profile,[{id:'2',ticketNumber:'9971234567890',amount:'1000.00',validatingAirlineCode:'BG'}]);
  expect(reissue.AirTicketRQ.Ticketing).toEqual([{PricingQualifiers:{PriceQuote:[{Record:[{Number:2,Reissue:true}]}]}}]);
  expect(reissue.AirTicketRQ.Ticketing[0]).not.toHaveProperty('FOP_Qualifiers');
  expect(reissue.AirTicketRQ.PostProcessing).toMatchObject({acceptPriceChanges:false,acceptNegotiatedFare:false,actionOnPQExpired:'Q',actionOnBackDatePrice:'Q'});
  expect(buildEnhancedAirTicket('ABC123','BD01',profile,['2'],policy).AirTicketRQ.Ticketing[0]!.PricingQualifiers.PriceQuote[0]!.Record[0]!.Reissue).toBe(false);
  expect(()=>buildEnhancedReissue('ABC123','BD01',profile,[{id:'2',ticketNumber:'9971234567890',amount:'1000.00'}])).toThrow();
 });
 it('offers the Enhanced default only for a complete CERT CASH profile',()=>{
  const ready={...config,SABRE_TICKETING_PROFILE:JSON.stringify(profile)};
  const supports=(override:Record<string,unknown>)=>new FlightTicketingService({...ready,...override} as AppConfig,undefined,undefined,undefined as never).supportsEnhancedTicketing();
  expect(supports({})).toBe(true);
  expect(supports({APP_ENV:'production'})).toBe(false);
  expect(supports({SABRE_ENV:'PROD'})).toBe(false);
  expect(supports({SABRE_TICKETING_PROFILE:JSON.stringify({...profile,ticketCountryCode:undefined})})).toBe(false);
  expect(supports({SABRE_TICKETING_PROFILE:JSON.stringify({...profile,formOfPayment:'INVOICE'})})).toBe(false);
 });
 it('matches the documented endpoint request and official 1.3.0 schema',()=>{
  const body=buildEnhancedAirTicket('ABC123','BD01',profile,['1'],policy);
  expect(body).toEqual({AirTicketRQ:{version:'1.3.0',targetCity:'BD01',DesignatePrinter:{Printers:{Ticket:{CountryCode:'BD'},Hardcopy:{LNIATA:'ABC123'},InvoiceItinerary:{LNIATA:'ABC123'}}},Itinerary:{ID:'ABC123'},Ticketing:[{FOP_Qualifiers:{BasicFOP:{Type:'CA'}},MiscQualifiers:{Commission:{Percent:7}},PricingQualifiers:{PriceQuote:[{Record:[{Number:1,Reissue:false}]}]}}],PostProcessing:{acceptPriceChanges:false,acceptNegotiatedFare:false,actionOnPQExpired:'Q',actionOnBackDatePrice:'Q',EndTransaction:{Source:{ReceivedFrom:'BD01 WEB'}}}}});
  const require=createRequire(realpathSync('../../node_modules/eslint/package.json'));
  const spec=require('js-yaml').load(readFileSync('../../reference/sabre/enhanced-air-ticket-1.3.0.yml','utf8'));
  const Ajv=require('ajv'),validate=new Ajv({allErrors:true,unknownFormats:'ignore',logger:false,schemaId:'auto'}).compile({components:spec.components,$ref:'#/components/schemas/EnhancedAirTicketRequest'});
  expect(validate(body),JSON.stringify(validate.errors)).toBe(true);
  const repriced=buildEnhancedAirTicket('ABC123','BD01',profile,['1'],{...policy,quoteHandling:'Reprice'});
  expect(validate(repriced),JSON.stringify(validate.errors)).toBe(true);
  expect(repriced.AirTicketRQ.PostProcessing).toMatchObject({acceptPriceChanges:false,acceptNegotiatedFare:false,actionOnPQExpired:'R',actionOnBackDatePrice:'R'});
  expect(sameTicketingExecution(policy,{...policy,quoteHandling:'Reprice'})).toBe(false);
  expect(validate(buildEnhancedReissue('ABC123','BD01',profile,[{id:'2',ticketNumber:'9971234567890',amount:'1000.00',validatingAirlineCode:'BG'}])),JSON.stringify(validate.errors)).toBe(true);
 });
 it('does not assume a commission if the manager has not specified it',()=>{
  const body=buildEnhancedAirTicket('ABC123','BD01',profile,['1'],{...policy,commissionPercent:undefined});
  expect(body.AirTicketRQ.Ticketing[0]).not.toHaveProperty('MiscQualifiers');
 });
 it('retains initial-ticket technical warning tokens after removing booked names and PNR',async()=>{
  const raw={AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{SystemSpecificResults:[{Message:[{code:'ERR.SP.PROVIDER_ERROR',content:'No new tickets have been issued'}]}]}],Warning:[{SystemSpecificResults:[{Message:[{code:'WARN.SP.PROVIDER_ERROR',content:'AirTicketLLSRQ: TKT PRINTER NOT ASSIGNED Synthetic Traveler ABC123 -1496'}]}]}]}}};
  const http=vi.fn(async()=>new Response(JSON.stringify(raw)));
  let failure:any;try{await client(http).issueEnhancedAirTicket('ABC123',profile,selection,policy,['Synthetic','Traveler']);}catch(error){failure=error;}
  expect(failure.diagnostic.warnings[0]).toMatchObject({providerCodes:['1496'],messageTokens:expect.arrayContaining(['PRINTER','NOT','ASSIGNED'])});
  expect(JSON.stringify(failure)).not.toMatch(/Synthetic|Traveler|ABC123/);expect(http).toHaveBeenCalledOnce();
 });
 it.each([['0'],['01'],['1','1'],['1','01'],['-1'],['1.5'],[]].map(records=>({records})))('rejects invalid or duplicate PQ records $records',({records})=>expect(()=>buildEnhancedAirTicket('ABC123','BD01',profile,records,policy)).toThrow());
 it.each([{...policy,quoteHandling:'Override'},{...policy,commitWaitMs:3000},{...policy,commissionPercent:101},{...policy,commissionPercent:-1},{...policy,commissionPercent:7.5},{...policy,ticketingApi:'UNKNOWN'}])('requires an explicit compatible execution policy %j',input=>expect(()=>ticketingExecutionOptions(input)).toThrow());
 it('binds approval to API and commission while retaining historical Booking Management defaults',()=>{
  const old={quoteHandling:'Quit' as const,commitWaitMs:3000};
  expect(sameTicketingExecution(old,{...old,ticketingApi:'BOOKING_MANAGEMENT'})).toBe(true);
  expect(sameTicketingExecution(policy,{...policy,commissionPercent:0})).toBe(false);
  expect(sameTicketingExecution(policy,{...policy,ticketingApi:'BOOKING_MANAGEMENT'})).toBe(false);
 });
 it('sends once with bearer authentication and preserves exact wire evidence',async()=>{
  let wire='';const http=vi.fn(async(url,options)=>{expect(url).toBe('https://api.cert.platform.sabre.com/v1.3.0/air/ticket');expect(options?.headers).toMatchObject({Authorization:'Bearer fixture-token'});wire=String(options?.body);expect(JSON.parse(wire)).not.toHaveProperty('targetPcc');return new Response(JSON.stringify(response()),{status:200,headers:{'x-request-id':'enhanced-fixture'}});});
  const api=client(http as typeof fetch),result=await api.issueEnhancedAirTicket('ABC123',profile,selection,policy);
  expect(result).toMatchObject({complete:true,tickets:[{number:'9971234567890',payment:{total:'6049.00',currencyCode:'BDT'}}]});
  expect(api.dispatchReference(result)).toMatchObject({operation:'enhancedAirTicket',ticketingApi:'ENHANCED_AIR_TICKET',requestSha256:createHash('sha256').update(wire).digest('hex'),supplierPaymentMethod:'CASH',commissionPercent:7,priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'});
  expect(api.responseReference(result)).toBe('enhanced-fixture');expect(http).toHaveBeenCalledOnce();
 });
 it.each(['timeout','disconnect','invalid-json','http-500','http-429','incomplete','pnr-mismatch','not-committed','duplicate'])('holds %s without falling back or issuing twice',async kind=>{
  const http=vi.fn(async()=>{
   if(kind==='timeout')throw Object.assign(Error('private'),{name:'TimeoutError'});
   if(kind==='disconnect')throw Error('private');
   if(kind==='invalid-json')return new Response('private',{status:200});
   const raw=response();
   if(['incomplete','http-500','http-429'].includes(kind))Object.assign(raw.AirTicketRS,{ApplicationResults:{status:'Incomplete',Error:[{type:'Application',SystemSpecificResults:[{Message:[{code:'0316',content:'Private Passenger passport123456789 AirTicketLLSRQ: Unknown host mask-0316'}]}]}]},Summary:[]});
   if(kind==='pnr-mismatch')raw.AirTicketRS.Summary[0]!.Reservation.content='DEF456';
   if(kind==='not-committed')raw.AirTicketRS.Summary[0]!.committed=false;
   if(kind==='duplicate')raw.AirTicketRS.Summary.push(raw.AirTicketRS.Summary[0]!);
   return new Response(JSON.stringify(raw),{status:kind==='http-500'?500:kind==='http-429'?429:200});
  });
  let failure:unknown;try{await client(http as typeof fetch).issueEnhancedAirTicket('ABC123',profile,selection,policy);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(SabreBookingUnknownError);expect(failure).toMatchObject({diagnostic:{dispatch:{operation:'enhancedAirTicket'}}});expect(http).toHaveBeenCalledOnce();
  expect(JSON.stringify(failure)).not.toMatch(/Private Passenger|passport123456789|fixture-token/);
 });
 it.each([{APP_ENV:'production'},{SABRE_ENV:'PROD'}])('blocks live environments before dispatch %j',async override=>{
  const http=vi.fn();await expect(client(http as typeof fetch,override).issueEnhancedAirTicket('ABC123',profile,selection,policy)).rejects.toThrow();expect(http).not.toHaveBeenCalled();
 });
 it('does not reroute an Enhanced policy through Booking Management',async()=>{
  const http=vi.fn();await expect(client(http as typeof fetch).fulfillFlightTickets('ABC123',profile,[],false,selection,policy)).rejects.toThrow();expect(http).not.toHaveBeenCalled();
 });
 it('preserves the unclassified host code and fingerprint without retaining personal text',()=>{
  const raw={AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{type:'Application',SystemSpecificResults:[{Message:[{code:'0316',content:'AirTicketLLSRQ: Private Passenger-0316; TicketingDocumentServicesRQ: No new tickets have been issued'}]}]}]}}};
  expect(enhancedTicketDiagnostics(raw)).toMatchObject({status:'Incomplete',errors:[{providerCodes:['0316'],unclassifiedAirTicketMessage:true,description:'TicketingDocumentServicesRQ: No new tickets have been issued'}]});
  expect(JSON.stringify(enhancedTicketDiagnostics(raw))).not.toMatch(/Private Passenger/);
  expect(readEnhancedAirTicket(raw,'ABC123','BD01').complete).toBe(false);
 });
});
