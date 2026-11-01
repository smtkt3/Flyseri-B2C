import {it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import type {AppConfig} from '@flyseri/config';
import {buildEnhancedAirExtras,readEnhancedAirExtras} from './enhanced-air-ticket.contract.js';
import {SabreBookingManagementClient,SabreBookingUnknownError} from './sabre-booking-management.client.js';
const profile={formOfPayment:'CASH' as const,ticketCountryCode:'BD',hardcopyPrinterAddress:'ABC123'};
const config={APP_ENV:'test',SABRE_ENV:'CERT',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig;
const response=()=>({AirTicketRS:{ApplicationResults:{status:'Complete',Success:[{}]},Summary:[{DocumentType:'EMD',DocumentNumber:'9971234567890',Reservation:{content:'ABCDEF'},IssuingLocation:'TEST',committed:true}]}});
it('validates EMD-only selectors against the official Enhanced 1.3.0 schema without selecting any airfare',()=>{
 const body=buildEnhancedAirExtras('ABCDEF','TEST',profile,['19','21']);
 expect(body.AirTicketRQ.Ticketing).toEqual([{FOP_Qualifiers:{BasicFOP:{Type:'CA'}},MiscQualifiers:{AirExtras:[{itemId:19},{itemId:21}]}}]);
 expect(JSON.stringify(body)).not.toMatch(/PriceQuote|PricingQualifiers|Reissue|Commission/);
 const require=createRequire(realpathSync('../../node_modules/eslint/package.json'));
 const spec=require('js-yaml').load(readFileSync('../../reference/sabre/enhanced-air-ticket-1.3.0.yml','utf8'));
 const Ajv=require('ajv'),validate=new Ajv({allErrors:true,unknownFormats:'ignore',logger:false,schemaId:'auto'}).compile({components:spec.components,$ref:'#/components/schemas/EnhancedAirTicketRequest'});
 expect(validate(body),JSON.stringify(validate.errors)).toBe(true);
 for(const ids of [[],['19','19'],['0'],['01'],['AE1'],['2147483648']])expect(()=>buildEnhancedAirExtras('ABCDEF','TEST',profile,ids)).toThrow();
});
it('requires EMD summaries bound to the exact reservation and issuing agency',()=>{
 expect(readEnhancedAirExtras(response(),'ABCDEF','TEST')).toMatchObject({complete:true,documents:[{number:'9971234567890'}]});
 for(const change of ['TKT','wrong-pnr','wrong-pcc','uncommitted','duplicate']){
  const raw=response(),entry=raw.AirTicketRS.Summary[0]!;
  if(change==='TKT')entry.DocumentType='TKT';if(change==='wrong-pnr')entry.Reservation.content='DIFFER';if(change==='wrong-pcc')entry.IssuingLocation='DIFF';if(change==='uncommitted')entry.committed=false;if(change==='duplicate')raw.AirTicketRS.Summary.push({...entry});
  expect(readEnhancedAirExtras(raw,'ABCDEF','TEST').complete).toBe(false);
 }
});
it('retains only technical EMD warning tokens after removing the known traveler and reservation',()=>{
 const raw={AirTicketRS:{ApplicationResults:{status:'Incomplete',Warning:[{SystemSpecificResults:[{Message:[{code:'WARN.SP.PROVIDER_WARNING',content:'AirTicketLLSRQ: EMD STOCK NOT AUTHORIZED for Open Flight ABCDEF private@example.com'}]}]}]}}};
 const result=readEnhancedAirExtras(raw,'ABCDEF','TEST',['Open Flight','Open','Flight']);
 expect(result.warnings[0]?.messageTokens).toEqual(expect.arrayContaining(['EMD','STOCK','NOT','AUTHORIZED','[REDACTED]']));
 expect(result.warnings[0]?.messageTokens).not.toContain('OPEN');expect(result.warnings[0]?.messageTokens).not.toContain('FLIGHT');
 expect(JSON.stringify(result)).not.toMatch(/Open Flight|ABCDEF|private@example.com/);
});
it('sends exactly one EMD-only request and does not fall back to flight ticketing after an uncertain reply',async()=>{
 const http=vi.fn(async(_url:string|URL|Request,_options?:RequestInit)=>new Response(JSON.stringify({AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{SystemSpecificResults:[{Message:[{code:'0316',content:'Private passenger passport123. No new tickets have been issued'}]}]}]}}}),{status:200}));
 const client=new SabreBookingManagementClient(config,{token:async()=>'fixture-token'} as never,http);
 let failure:unknown;try{await client.issueEnhancedAncillaryDocuments('ABCDEF',profile,['19','21']);}catch(e){failure=e;}
 expect(failure).toBeInstanceOf(SabreBookingUnknownError);expect(http).toHaveBeenCalledTimes(1);
 expect(http.mock.calls[0]?.[0]).toBe('https://api.cert.platform.sabre.com/v1.3.0/air/ticket');
 expect(JSON.parse(String(http.mock.calls[0]?.[1]?.body)).AirTicketRQ.Ticketing[0].MiscQualifiers.AirExtras).toEqual([{itemId:19},{itemId:21}]);
 expect(JSON.stringify(failure)).not.toMatch(/Private passenger|passport123|fixture-token/);
});
it('records an EMD in dispatch diagnostics without treating it as a new flight ticket',async()=>{
 const http=vi.fn(async()=>new Response(JSON.stringify(response()),{status:200}));
 const client=new SabreBookingManagementClient(config,{token:async()=>'fixture-token'} as never,http);
 const result=await client.issueEnhancedAncillaryDocuments('ABCDEF',profile,['19']);
 expect(result).toMatchObject({complete:true,documents:[{number:'9971234567890'}]});
 expect(result).not.toHaveProperty('tickets');expect(client.dispatchReference(result)).toMatchObject({documentCount:1,priceQuoteRecordIds:[]});expect(http).toHaveBeenCalledOnce();
});
