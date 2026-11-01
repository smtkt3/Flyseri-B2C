import {describe,it,expect,vi} from 'vitest';
import {currencyPolicy,normalizeCurrency,pricingCurrencyQualifiers,validateStoredTicketingCurrency,validateTicketingPcc,alternateCurrencyRestriction,sanitizedTicketingErrors} from './ticketing-currency.contract.js';
import {SabreBookingManagementClient,buildSabreCreateBooking} from './sabre-booking-management.client.js';
import type {SabreAuthService} from './sabre-auth.service.js';
import type {AppConfig} from '@flyseri/config';
import {SabreOAuthV3Fetcher} from './sabre-oauth-v3.fetcher.js';
import type {FlightOffer} from '@flyseri/types';
import {createHash} from 'node:crypto';

const policy={pcc:'BD01',countryCode:'BD',localCurrency:'BDT',allowedTicketCurrencies:['BDT'],pricingMode:'LOCAL_DEFAULT' as const,timeZone:'Asia/Dhaka'};
const config={SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000,SABRE_PCC:'BD01',SABRE_USERNAME:'111111-BD01-AA',SABRE_CURRENCY_POLICY:JSON.stringify(policy)} as AppConfig;
const input={pcc:'BD01',username:config.SABRE_USERNAME,policy,requestedCurrency:'BDT',now:new Date('2026-10-21T00:00:00Z')};
it('recovers the exact NEED FOP warning without exposing adjacent private host data',()=>{
 const message='AutomatedExchangesLLSRQ: NEED FOP';
 const fingerprint='c3b1ae7a171e6d4be3ea292610d9c962042f95cb3a2cb7bf58d50374b8bd1784';
 expect(createHash('sha256').update(message).digest('hex')).toBe(fingerprint);
 expect(sanitizedTicketingErrors([{descriptionFingerprint:fingerprint}])).toMatchObject([{description:message,descriptionSource:'PUBLIC_MESSAGE_HASH_MATCH'}]);
 expect(sanitizedTicketingErrors([{description:'PrivatePerson private@example.com '+message}])).toMatchObject([{description:'NEED FOP'}]);
});
it('recovers only an exact public exchange message hash and preserves safe service codes without private text',()=>{
 const known='Unable to perform automated exchanges confirmation step. Comparison step did not generate PQR Number';
 const fingerprint=createHash('sha256').update(known).digest('hex');
 expect(sanitizedTicketingErrors([{descriptionFingerprint:fingerprint}])).toMatchObject([{description:known,descriptionSource:'PUBLIC_MESSAGE_HASH_MATCH'}]);
 expect(sanitizedTicketingErrors([{descriptionFingerprint:'0'.repeat(64)}])[0]).not.toHaveProperty('description');
 const [safe]=sanitizedTicketingErrors([{description:'PrivateName private@example.com AutomatedExchangesLLSRQ: WFRF ENTRY NOT AVAILABLE',providerMessageCodes:['ERR.SP.PROVIDER_ERROR','private@example.com'],supplierOperations:['AutomatedExchangesLLSRQ','PrivateName']}]);
 expect(safe).toMatchObject({description:'WFRF ENTRY NOT AVAILABLE',providerMessageCodes:['ERR.SP.PROVIDER_ERROR'],supplierOperations:['AutomatedExchangesLLSRQ']});
 expect(JSON.stringify(safe)).not.toMatch(/PrivateName|private@example.com/);
});
function stored(base='BDT'){
 return {bookingId:'ABC123',creationDetails:{userWorkPcc:'BD01'},travelers:[{}],flights:[{itemId:'12'}],fares:[{recordId:'1',recordTypeCode:'PQ',pricingStatusName:'Active',creationDetails:{userWorkPcc:'BD01',purchaseDeadlineDate:'2026-10-22'},airlineCode:'BG',travelerIndices:[1],totals:{total:'6049',currencyCode:'BDT'},originalTotalValues:{total:'4824',currencyCode:base},fareConstruction:[{isCurrentItinerary:true,flights:[{itemId:'12'}],baseRate:{currencyCode:base}}]}]};
}
describe('PCC-scoped ticket currency validation',()=>{
 it('selects one fresh verified quote while retaining but excluding an explicitly expired historical PQ',()=>{
  const raw=stored(),old={...raw.fares[0]!,hasValidPricing:false},fresh={...raw.fares[0]!,recordId:'2',hasValidPricing:true};
  raw.fares=[old,fresh];
  expect(validateStoredTicketingCurrency(raw,input).selection.priceQuoteRecordIds).toEqual(['2']);
  raw.fares=[old,{...stored().fares[0]!,recordId:'2'}];
  expect(validateStoredTicketingCurrency(raw,input).selection.priceQuoteRecordIds).toEqual(['2']);
  raw.fares=[fresh,{...fresh,recordId:'3'}];
  expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow(/scope/);
  raw.fares=[old];expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow(/expired/);
 });
 it('permits stale pricing only under approved Reprice and preserves scope and currency guards',()=>{
  const raw=stored();raw.fares[0]!.creationDetails.purchaseDeadlineDate='2026-10-20';Object.assign(raw.fares[0]!,{hasValidPricing:false});
  expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow();
  expect(validateStoredTicketingCurrency(raw,{...input,allowStaleForReprice:true}).selection.totalAmount).toBe('6049.00');
  raw.fares[0]!.travelerIndices=[2];expect(()=>validateStoredTicketingCurrency(raw,{...input,allowStaleForReprice:true})).toThrow();
  raw.fares[0]!.travelerIndices=[1];raw.fares[0]!.totals.currencyCode='USD';expect(()=>validateStoredTicketingCurrency(raw,{...input,allowStaleForReprice:true})).toThrow(/not authorized/);
 });
 it('normalizes codes and omits a redundant local override only for the configured PCC',()=>{
  expect(normalizeCurrency(' bdt ')).toBe('BDT');
  expect(pricingCurrencyQualifiers('BDT','BD01',policy)).toEqual({});
  expect(pricingCurrencyQualifiers('MYR','MY01')).toEqual({currencyPricing:'MYR'});
  expect(()=>pricingCurrencyQualifiers('BDT','OTHER',policy)).toThrow(/another PCC/);
  expect(()=>pricingCurrencyQualifiers('USD','BD01',policy)).toThrow(/not authorized/);
  expect(()=>currencyPolicy(JSON.stringify({...policy,timeZone:'unknown'}))).toThrow();
 });
 it.each(['BDT','USD'])('accepts a legitimate %s base fare when the equivalent/payable quote is BDT',base=>{
  const result=validateStoredTicketingCurrency(stored(base),input);
  expect(result.selection).toEqual({priceQuoteRecordIds:['1'],validatingAirlineCode:'BG',currency:'BDT',totalAmount:'6049.00'});
  expect(result.currencyEvidence.baseCurrencies).toContain(base);
 });
 it('blocks converted BDT display prices when the payable stored currency is unauthorized',()=>{
  const raw=stored();raw.fares[0]!.totals.currencyCode='USD';
  expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow(/payable currency is not authorized/);
 });
 it('rejects credential context mismatch before any OAuth request',async()=>{
  const http=vi.fn();
  const fetcher=new SabreOAuthV3Fetcher({...config,SABRE_AUTH_URL:'https://api.cert.platform.sabre.com/v3/auth/token',SABRE_CLIENT_ID:'private',SABRE_CLIENT_SECRET:'private',SABRE_PASSWORD:'private',SABRE_USERNAME:'111111-US01-AA'},http);
  await expect(fetcher.fetchToken()).rejects.toMatchObject({code:'PCC_CONTEXT_MISMATCH'});
  expect(http).not.toHaveBeenCalled();
 });
 it('requires explicit authorization for cross-PCC stored fares',()=>{
  const raw=stored();raw.fares[0]!.creationDetails.userWorkPcc='US01';
  expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow(/not authorized/);
  expect(validateStoredTicketingCurrency(raw,{...input,policy:{...policy,authorizedBookingPccs:['BD01','US01']}}).selection.currency).toBe('BDT');
  expect(()=>validateTicketingPcc('BD01','111111-US01-AA')).toThrow(/context differ/);
 });
 it.each(['expired','invalid','inactive','wrong-segment','old-itinerary','wrong-passenger'])('blocks %s quotes for controlled repricing/review',kind=>{
  const raw=stored();const fare=raw.fares[0]!;
  if(kind==='expired')fare.creationDetails.purchaseDeadlineDate='2026-10-20';
  if(kind==='invalid')Object.assign(fare,{hasValidPricing:false});
  if(kind==='inactive')fare.pricingStatusName='Inactive';
  if(kind==='wrong-segment')fare.fareConstruction[0]!.flights=[{itemId:'99'}];
  if(kind==='old-itinerary')fare.fareConstruction[0]!.isCurrentItinerary=false;
  if(kind==='wrong-passenger')fare.travelerIndices=[2];
  expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow();
 });
 it('retains non-Bangladesh agency currency behavior',()=>{
  const raw=stored('MYR');raw.fares[0]!.totals.currencyCode='MYR';raw.creationDetails.userWorkPcc='MY01';raw.fares[0]!.creationDetails.userWorkPcc='MY01';
  expect(validateStoredTicketingCurrency(raw,{pcc:'MY01',username:'111111-MY01-AA'}).selection.currency).toBe('MYR');
 });
 it('checks same-day purchase deadlines in the configured agency timezone',()=>{
  const raw=stored();raw.fares[0]!.creationDetails.purchaseDeadlineDate='2026-10-21';Object.assign(raw.fares[0]!.creationDetails,{purchaseDeadlineTime:'05:59'});
  expect(()=>validateStoredTicketingCurrency(raw,input)).toThrow(/expired/);
 });
 it('distinguishes exact 2101 and related supplier restrictions without logging free text',()=>{
  const error={category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'John Doe secret@example.com 1234567890123 TICKETING IN ALTERNATE CURRENCY NOT ALLOWED-2101'};
  expect(alternateCurrencyRestriction([error])).toMatchObject({code:'2101',manualSupportRequired:true});
  expect(alternateCurrencyRestriction([{description:'CANNOT TICKET IN CURRENCY REQUESTED-0106'}])?.code).toBe('0106');
  expect(alternateCurrencyRestriction([{description:'CANNOT TICKET IN CURRENCY REQUESTED'}])).toMatchObject({code:'UNSPECIFIED',messageFamily:'REQUESTED_CURRENCY_RESTRICTED'});
  expect(alternateCurrencyRestriction([{description:'Unrelated service failure-2101'}])).toBeNull();
  expect(JSON.stringify(sanitizedTicketingErrors([error]))).not.toMatch(/John|Doe|secret|1234567890123/);
 });
 it('targets the intended PCC and sends no invented fulfillment currency field or retry',async()=>{
  const http=vi.fn(async(_url:string,_options:RequestInit)=>new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'TICKETING IN ALTERNATE CURRENCY NOT ALLOWED-2101'}]}),{status:200}));
  const client=new SabreBookingManagementClient(config,{token:vi.fn(async()=>'private')} as unknown as SabreAuthService,http as unknown as typeof fetch);
  await expect(client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD',formOfPayment:'CASH'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'})).rejects.toThrow();
  const body=JSON.parse(String(http.mock.calls[0]![1].body));
  expect(body.targetPcc).toBe('BD01');expect(body.fulfillments[0].ticketingQualifiers).toEqual({priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'});
  expect(body).toMatchObject({acceptPriceChanges:false,acceptNegotiatedFare:false,backDatePriceQuoteMethod:'Quit',priceQuoteExpirationMethod:'Quit'});
  expect(JSON.stringify(body)).not.toMatch(/currencyPricing|CurrencyCode|AlternateCurrencyCode|targetCity|PAYMENTCARD/);
  expect(http).toHaveBeenCalledOnce();
 });
 it.each(['PQ EXPIRED','PQ CONTAINS BACK DATE PRICE','NEGOTIATED FARE STORED'])('preserves documented %s reasons alongside the generic no-ticket summary',reason=>{
  const message='UNABLE TO TICKET STORED FARE - '+reason;
  const [result]=sanitizedTicketingErrors([{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'PrivatePerson secret@example.com AirTicketLLSRQ: '+message+'; TicketingDocumentServicesRQ: No new tickets have been issued'}]);
  expect(result?.description).toBe(message+'; TicketingDocumentServicesRQ: No new tickets have been issued');
  expect(result?.descriptionFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toMatch(/PrivatePerson|secret@example/);
 });
 it('retains safe codes and an explicit unknown classification without exposing unrecognized text',()=>{
  const [result]=sanitizedTicketingErrors([{description:'AirTicketLLSRQ: PrivateName account-specific host text-9876; TicketingDocumentServicesRQ: No new tickets have been issued'}]);
  expect(result).toMatchObject({providerCodes:['9876'],unclassifiedAirTicketMessage:true});
  expect(result?.description).toBe('TicketingDocumentServicesRQ: No new tickets have been issued');
  expect(JSON.stringify(result)).not.toMatch(/PrivateName|account-specific/);
 });
 it('keeps saved provider metadata stable when diagnostics are sanitized more than once',()=>{
  const first=sanitizedTicketingErrors([{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'AirTicketLLSRQ: Private host text-0316; TicketingDocumentServicesRQ: No new tickets have been issued'}]);
  expect(sanitizedTicketingErrors(first)).toEqual(first);
  const [invalid]=sanitizedTicketingErrors([{providerCodes:['0316','private text',1234],descriptionFingerprint:'private-value',unclassifiedAirTicketMessage:'private-value'}]);
  expect(invalid).toEqual({providerCodes:['0316']});
 });
 it.each(['PAYMENT_REQUIRED','PAYMENT_NOT_FOUND','PAYMENT_INDEX_OUT_OF_BOUNDS','PAYMENT_CARD_DECLINED','PAYMENT_CARD_EXPIRATION_DATE_INVALID','PENDING_PAYMENT','FAILED_PAYMENT','PRICE_MISMATCH','SECURE_FLIGHT_PASSENGER_DATA_MISSING','INTERNAL_SERVER_TIMEOUT'])('retains documented %s without supplier personal or payment data',type=>{
  const first=sanitizedTicketingErrors([{type,category:'APPLICATION_ERROR',description:'PrivateName ABC123 4111111111111111 secret@example.com'}]);
  expect(first[0]).toMatchObject({type,category:'APPLICATION_ERROR'});
  expect(first[0]?.description).toBeTruthy();
  expect(sanitizedTicketingErrors(first)).toEqual(first);
  expect(JSON.stringify(first)).not.toMatch(/PrivateName|ABC123|4111111111111111|secret@example/);
 });
 it('does not interpret a host 0316 as payment failure or preserve invented error types',()=>{
  const [host,unknown]=sanitizedTicketingErrors([{description:'AirTicketLLSRQ: private cause-0316'},{type:'PRIVATE_CUSTOMER_ERROR',description:'private customer'}]);
  expect(host).toMatchObject({providerCodes:['0316'],unclassifiedAirTicketMessage:true});
  expect(host?.type).toBeUndefined();
  expect(unknown?.type).toBeUndefined();
  expect(JSON.stringify([host,unknown])).not.toMatch(/private cause|PRIVATE_CUSTOMER|private customer/);
 });
 it.each([200,500])('preserves host metadata and known masks beyond the display limit after HTTP %s, with one dispatch',async status=>{
  const description='AirTicketLLSRQ: '+('PrivateName '.repeat(65))+'UNABLE TO TICKET STORED FARE - PQ EXPIRED-0316; TicketingDocumentServicesRQ: No new tickets have been issued';
  const http=vi.fn(async()=>new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description}]}),{status}));
  const client=new SabreBookingManagementClient(config,{token:vi.fn(async()=>'private')} as unknown as SabreAuthService,http as unknown as typeof fetch);
  let failure:any;
  try{await client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD',formOfPayment:'CASH'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'});}catch(error){failure=error;}
  const safe=sanitizedTicketingErrors(failure.diagnostic?.errors??failure.diagnostics);
  expect(safe[0]).toMatchObject({providerCodes:['0316'],descriptionFingerprint:createHash('sha256').update(description).digest('hex')});
  expect(safe[0]?.description).toContain('PQ EXPIRED');
  expect(JSON.stringify(safe)).not.toContain('PrivateName');
  expect(http).toHaveBeenCalledOnce();
 });
 it('retains the observed asynchronous fulfillment warning without its locator or arbitrary provider text',()=>{
  const result=sanitizedTicketingErrors([{category:'PROCESSING_WARNING',type:'UNABLE_TO_RETRIEVE_TICKETS',description:'The fulfillment process has not been completed in the requested time. Verify booking details and/or audit trail reports (DQB) whether tickets were issued successfully (confirmationId: ABC123).'}]);
  expect(result[0]).toMatchObject({category:'PROCESSING_WARNING',type:'UNABLE_TO_RETRIEVE_TICKETS',description:'Tickets may have been issued, but Sabre could not retrieve them. Verify booking details and agency audit records before any further action.'});
  expect(JSON.stringify(result)).not.toContain('ABC123');
 });
 it('preserves the specific failure through the client and persistence sanitizers without replaying fulfillment',async()=>{
  const http=vi.fn(async()=>new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'AirTicketLLSRQ: UNABLE TO TICKET STORED FARE - PQ CONTAINS BACK DATE PRICE; TicketingDocumentServicesRQ: No new tickets have been issued'}]}),{status:200}));
  const client=new SabreBookingManagementClient(config,{token:vi.fn(async()=>'private')} as unknown as SabreAuthService,http as unknown as typeof fetch);
  let failure:any;
  try{await client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD',formOfPayment:'CASH'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'});}catch(error){failure=error;}
  expect(failure).toBeDefined();
  const safe=sanitizedTicketingErrors(failure.diagnostic?.errors??failure.diagnostics);
  expect(safe[0]?.description).toContain('PQ CONTAINS BACK DATE PRICE');
  expect(safe[0]?.description).toContain('No new tickets have been issued');
  expect(http).toHaveBeenCalledOnce();
 });
 it.each(['PQ EXPIRED','PQ CONTAINS BACK DATE PRICE'])('stops after a supplier %s rejection without an implicit repricing or second request',async(message)=>{
  const http=vi.fn(async(_url:string,_options:RequestInit)=>new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'UNABLE TO TICKET STORED FARE - '+message}]}),{status:200}));
  const client=new SabreBookingManagementClient(config,{token:vi.fn(async()=>'private')} as unknown as SabreAuthService,http as unknown as typeof fetch);
  await expect(client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD',formOfPayment:'CASH'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'})).rejects.toThrow();
  expect(http).toHaveBeenCalledOnce();
  const [url,options]=http.mock.calls[0]!;
  expect(url).toBe(config.SABRE_BASE_URL+'/v1/trip/orders/fulfillFlightTickets');
  expect(JSON.parse(String(options.body))).toMatchObject({backDatePriceQuoteMethod:'Quit',priceQuoteExpirationMethod:'Quit',acceptPriceChanges:false});
  expect(String(options.body)).not.toMatch(/Reprice|Override/);
 });
 it('recovers the exact historical validating-carrier warning from its fingerprint',()=>{
  expect(sanitizedTicketingErrors([{descriptionFingerprint:'4e0ba09fc56514f2785fb71cee6174bd08a6d7cb416dca74c790877205cdcd01'}])[0]).toMatchObject({description:'AutomatedExchangesLLSRQ: NEED VALIDATING CARRIER',descriptionSource:'PUBLIC_MESSAGE_HASH_MATCH'});
 });
 it('removes redundant local currency only from the affected Create Booking request',async()=>{
  const http=vi.fn(async(_url:string,_options:RequestInit)=>new Response(JSON.stringify({confirmationId:'ABC123',booking:{bookingId:'ABC123'}}),{status:200}));
  const client=new SabreBookingManagementClient(config,{token:vi.fn(async()=>'private')} as unknown as SabreAuthService,http as unknown as typeof fetch);
  const offer:FlightOffer={offerId:'offer',totalAmount:'6049.00',currency:'BDT',baggageSummary:null,airlineCodes:['BG'],outbound:{stops:0,durationMinutes:null,segments:[{origin:'DAC',destination:'CXB',departureAt:'2026-12-10T08:00:00+06:00',arrivalAt:'2026-12-10T09:15:00+06:00',marketingCarrier:'BG',flightNumber:'433',bookingClass:'Q',durationMinutes:null}]},inbound:null};
  const agency={ticketingPolicy:'TODAY',address:{name:'Test',street:'Test',city:'Test',stateProvince:'Test',postalCode:'00000',countryCode:'BD',freeText:'Test'}};
  const body=buildSabreCreateBooking(offer,[{givenName:'Test',surname:'Test',birthDate:'1990-01-01',passengerCode:'ADT'}],{email:'test@example.invalid',phone:'+12025550100'},agency);
  expect(body.flightDetails.flightPricing[0]!.qualifiers.currencyPricing).toBe('BDT');
  await client.createBooking(body);
  const sent=JSON.parse(String(http.mock.calls[0]![1].body));
  expect(sent.flightDetails.flightPricing[0].qualifiers).toEqual({});
  expect(sent.flightDetails.flightPricing[0].priceComparisons).toEqual(body.flightDetails.flightPricing[0]!.priceComparisons);
  expect(sent.targetPcc).toBe('BD01');
  expect(body.flightDetails.flightPricing[0]!.qualifiers.currencyPricing).toBe('BDT');
 });
});
