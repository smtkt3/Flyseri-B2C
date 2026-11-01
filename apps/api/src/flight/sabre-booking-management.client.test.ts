import { describe, expect, it, vi } from 'vitest';
import {createHash} from 'node:crypto';
import type { AppConfig } from '@flyseri/config';
import type { FlightOffer } from '@flyseri/types';
import type { SabreAuthService } from './sabre-auth.service.js';
import type {ServicingContext} from './flight-servicing.contract.js';

describe('bounded servicing transport',()=>{
 it('keeps mutation authentication unchanged and does not replay an uncertain mutation',async()=>{
  const token=vi.fn(async()=>'oauth-token'),close=vi.fn(async()=>{throw Error('Close response lost');}),session=vi.fn(async()=>({token:'ath-fixture',close}));
  const http=vi.fn(async(_url:unknown,options?:RequestInit)=>{expect((options?.headers as Record<string,string>).Authorization).toBe('Bearer oauth-token');throw Error('Supplier response lost');});
  const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:12000} as AppConfig,{token} as never,http,session);
  await expect(client.issueEnhancedAncillaryDocuments('ABC123',{formOfPayment:'CASH',ticketCountryCode:'BD',hardcopyPrinterAddress:'ABC123'},['19'])).rejects.toMatchObject({reason:'NETWORK_OR_TIMEOUT'});
  expect(http).toHaveBeenCalledOnce();expect(session).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(token).toHaveBeenCalledOnce();
 });
 it('does not let session cleanup failure hide a successful read',async()=>{
  const close=vi.fn(async()=>{throw Error('Close failed');}),http=vi.fn(async()=>new Response(JSON.stringify({bookingId:'ABC123',isTicketed:false,flights:[],allSegments:[],travelers:[]})));
  const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:12000} as AppConfig,{} as never,http,async()=>({token:'ath-fixture',close}));
  await expect(client.getBookingView('ABC123')).resolves.toMatchObject({bookingId:'ABC123'});expect(close).toHaveBeenCalledOnce();expect(http).toHaveBeenCalledOnce();
 });
 it('retains redacted technical reissue text and host codes without retaining traveler identity or retrying',async()=>{
  const number='9971234567890';
  const http=vi.fn(async()=>new Response(JSON.stringify({AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{SystemSpecificResults:[{Message:[{code:'ERR.SP.PROVIDER_ERROR',content:'Reissue failed'}]}]}],Warning:[{SystemSpecificResults:[{Message:[{code:'WARN.SP.PROVIDER_ERROR',content:'AirTicketLLSRQ: INVALID REISSUE Synthetic Traveler ABC123 9971234567890-1139'}]}]}]}}}),{status:200}));
  const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:12000} as AppConfig,{token:async()=>'fixture-token'} as never,http);
  let failure:any;
  try{await client.fulfillExchange('ABC123',[{id:'2',ticketNumber:number,amount:'1000',validatingAirlineCode:'BG'}],{formOfPayment:'CASH',ticketCountryCode:'BD',hardcopyPrinterAddress:'ABC123'},['Synthetic','Traveler']);}catch(error){failure=error;}
  expect(failure.diagnostic.warnings[0]).toMatchObject({providerCodes:['1139'],messageTokens:expect.arrayContaining(['INVALID','REISSUE'])});
  expect(JSON.stringify(failure)).not.toMatch(/Synthetic|Traveler|ABC123|9971234567890/);
  expect(http).toHaveBeenCalledOnce();
 });
 it('uses a separate long mutation timeout and leaves read lookups bounded',async()=>{
  const timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>new AbortController().signal);
  try{
   const http=vi.fn(async(_url:unknown,_options?:RequestInit)=>new Response(JSON.stringify({bookingId:'ABC123',isTicketed:false,flights:[],allSegments:[],travelers:[]}),{status:200}));
   const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:12000,SABRE_SERVICING_TIMEOUT_MS:150000} as AppConfig,{token:async()=>'fixture-token'} as never,http);
   await client.getBookingView('ABC123');
   await client.cancelUnticketedBooking('ABC123');
   expect(timeout.mock.calls.map(call=>call[0])).toEqual([12000,150000]);
   expect(http).toHaveBeenCalledTimes(2);
   expect(JSON.parse(String(http.mock.calls[1]?.[1]?.body))).toMatchObject({targetPcc:'TEST',confirmationId:'ABC123',cancelAll:true});
  }finally{timeout.mockRestore();}
 });
 it('preserves safe exchange failure evidence without resubmitting or retaining host private text',async()=>{
  const http=vi.fn(async()=>new Response(JSON.stringify({ExchangeBookingRS:{ApplicationResults:{status:'NotProcessed',Error:[{SystemSpecificResults:[{Message:[{code:'0001',content:'SECRETNAME host details'}]}]}]}}}),{status:200,headers:{'x-request-id':'exchange-fixture'}}));
  const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',SABRE_TICKETING_PROFILE:JSON.stringify({formOfPayment:'CASH'}),APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:12000} as AppConfig,{token:async()=>'fixture-token'} as never,http);
  const number='9971234567890';
  const offer={priceGuaranteed:false,splitBooking:false,mixedCabins:false,chargeType:'Add collect',amount:'1000',currency:'BDT',flights:[{number:'437',airline:'BG',origin:'DAC',destination:'CXB',departureDate:'2026-12-11',arrivalDate:'2026-12-11',departureTime:'15:45',arrivalTime:'17:00'}],ticketPrices:[{number,amount:'1000',currency:'BDT',chargeType:'Add collect',bookingClasses:['G']}]};
  const context={tickets:[{number,travelerIndex:1,validatingAirlineCode:'BG'}],travelers:[{nameAssociationId:1}],segmentIds:[12]};
  let failure:unknown;
  try{await client.exchangeBooking('ABC123',offer as never,context as never,'EXACT_MATCH');}catch(error){failure=error;}
  expect(failure).toMatchObject({diagnostic:{classification:'PQR_NOT_VERIFIED',supplierStatus:'NotProcessed',supplierRequestId:'exchange-fixture',automaticRetry:false,errors:[{providerCodes:['0001']}]}});
  expect(JSON.stringify(failure)).not.toContain('SECRETNAME');
  expect(http).toHaveBeenCalledOnce();
  const request=JSON.parse(String((http.mock.calls as unknown as [string,RequestInit][])[0]![1].body));
  expect(request.ExchangeBookingRQ.AutomatedExchanges[0].ExchangeConfirmation).toEqual({DoNotIssueEMDForChangeFee:true,OptionalQualifiers:{FOP_Qualifiers:{BasicFOP:[{Type:'CA'}]}}});
 });
 it.each([
  {SABRE_ENV:'PROD',APP_ENV:'test',SABRE_TICKETING_PROFILE:JSON.stringify({formOfPayment:'CASH'})},
  {SABRE_ENV:'CERT',APP_ENV:'production',SABRE_TICKETING_PROFILE:JSON.stringify({formOfPayment:'CASH'})},
  {SABRE_ENV:'CERT',APP_ENV:'test'},
  {SABRE_ENV:'CERT',APP_ENV:'test',SABRE_TICKETING_PROFILE:JSON.stringify({formOfPayment:'PAYMENTCARD'})},
  {SABRE_ENV:'CERT',APP_ENV:'test',SABRE_TICKETING_PROFILE:'invalid'},
 ])('blocks unapproved exchange FOP or production before authentication or dispatch %j',async config=>{
  const http=vi.fn(),token=vi.fn();
  const client=new SabreBookingManagementClient(config as AppConfig,{token} as never,http);
  await expect(client.exchangeBooking('ABC123',{} as never,{} as never)).rejects.toThrow('approved CERT CASH');
  expect(token).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
 });
});

describe('document-scoped ticket eligibility',()=>{
 const context=(numbers=['9971234567890']):ServicingContext=>({bookingId:'ABC123',atpcoFlightOnly:true,atpcoUnticketedFlightOnly:false,ticketNumbers:numbers,ticketingPccs:['TEST'],view:{retrievedAt:new Date().toISOString(),cancellationCheckComplete:true,tickets:[],flights:[],travellers:[]}});
 const make=(http:typeof fetch)=>new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:async()=>'fixture-token'} as SabreAuthService,http);
 it('sends ticket numbers and target PCC without the incompatible PNR selector',async()=>{
  const http=vi.fn(async(_url:unknown,options?:RequestInit)=>{expect(JSON.parse(String(options?.body))).toEqual({targetPcc:'TEST',tickets:[{number:'9971234567890'}]});return new Response(JSON.stringify({tickets:[{number:'9971234567890',isVoidable:true,isChangeable:true,isRefundable:true,isAutomatedRefundsEligible:true,refundTotals:{total:'6049',currencyCode:'BDT'}}]}),{status:200});});
  expect(await make(http).checkFlightTickets('ABC123',context())).toMatchObject({tickets:[{number:'9971234567890',voidable:true,changeable:true,refundable:true,refundTotal:{amount:'6049',currency:'BDT'}}]});
  expect(http).toHaveBeenCalledOnce();expect(http.mock.calls[0]?.[0]).toBe('https://api.cert.platform.sabre.com/v1/trip/orders/checkFlightTickets');
 });
 it.each([{numbers:[]},{numbers:['9971234567890','9971234567890']},{numbers:['invalid']},{numbers:['99712345678900']}])('rejects invalid or ambiguous ticket selection %j',async({numbers})=>{
  const http=vi.fn();await expect(make(http).checkFlightTickets('ABC123',context(numbers))).rejects.toThrow();expect(http).not.toHaveBeenCalled();
 });
 it('retains HTTP 200 validation failures as safe provider errors without replay',async()=>{
  const http=vi.fn(async()=>new Response(JSON.stringify({errors:[{category:'BAD_REQUEST',type:'INVALID_FLAGS_COMBINATION',description:'Properties confirmationId and tickets cannot be combined.',fieldPath:'CheckTicketsRequest'}]}),{status:200}));
  await expect(make(http).checkFlightTickets('ABC123',context())).rejects.toMatchObject({httpStatus:200,diagnostics:[{category:'BAD_REQUEST',type:'INVALID_FLAGS_COMBINATION',fieldPath:'CheckTicketsRequest'}]});expect(http).toHaveBeenCalledOnce();
 });
});
import { buildBookingFlightCheck, buildSabreCreateBooking, buildSabreCreateNdcBooking, buildSabreGetBooking,
  readSabreCreateBooking, readSabreGetBooking, SabreBookingManagementClient, SabreBookingUnknownError,
  selectCheckedAtpcoOffer } from './sabre-booking-management.client.js';

describe('partial GetBooking refresh',()=>{
  const warning={category:'WARNING',type:'RESOURCE_UNAVAILABLE',fieldPath:'GetBookingResponse',fieldName:'fareRules'};
  const source={bookingId:'ABC123',isTicketed:false,flights:[{airlineCode:'QR',flightNumber:641,fromAirportCode:'DAC',toAirportCode:'DOH',flightStatusName:'Cancelled',flightStatusCode:'HX'}],allSegments:[{type:'FLIGHT'}],travelers:[],errors:[warning]};
  const make=(data:unknown)=>new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'fixture-token')} as unknown as SabreAuthService,vi.fn(async()=>new Response(JSON.stringify(data),{status:200})) as unknown as typeof fetch);
  it('shows cancelled segments despite unavailable optional fare rules without permitting ticketing',async()=>{
    const client=make(source);
    const current=await client.getBookingView('ABC123');
    expect(current.view.flights[0]?.status).toBe('Cancelled');
    expect(current.view.cancellationCheckComplete).toBe(true);
    expect(()=>readSabreGetBooking(source)).toThrow('booking errors');
    await expect(client.getTicketingContext('ABC123')).rejects.toThrow('booking errors');
  });
  it('exposes a voided ticket with active flights despite the exact terminal-ticket fare-rule warning',async()=>{
    const terminal={...source,isTicketed:true,flights:source.flights.map(f=>({...f,flightStatusName:'Confirmed',flightStatusCode:'HK'})),flightTickets:[{number:'9971234567890',ticketStatusName:'Voided',travelerIndex:1}],errors:[{category:'WARNING',type:'RESOURCE_UNAVAILABLE',fieldName:'number',fieldPath:'GetBookingResponse.flightTickets',description:'FareRules can not be populated because the ticket is voided, refunded or exchanged.'}]};
    expect((await make(terminal).getBookingView('ABC123')).view).toMatchObject({flights:[{status:'Confirmed'}],tickets:[{status:'Voided'}]});
    await expect(make(terminal).getTicketingContext('ABC123')).rejects.toThrow();
    await expect(make({...terminal,errors:[{...terminal.errors[0],description:'Ticket details are missing'}]}).getBookingView('ABC123')).rejects.toThrow();
  });
  it.each([{...warning,category:'APPLICATION_ERROR'},{...warning,fieldName:'flightTickets'},{...warning,fieldName:'flights'},{...warning,type:'UNABLE_TO_RETRIEVE_TICKETS'}])('rejects incomplete essential resources or other errors: %j',async error=>{
    await expect(make({...source,errors:[error]}).getBookingView('ABC123')).rejects.toThrow('booking errors');
  });
});

const offer = { offerId: 'offer', totalAmount: '650.00', currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { stops: 0, durationMinutes: 90, segments: [{ origin: 'KUL', destination: 'PEN',
    departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T10:30:00+08:00',
    marketingCarrier: 'MH', operatingCarrier: 'MH', flightNumber: '1122', bookingClass: 'K', durationMinutes: 90 }] },
  inbound: null } satisfies FlightOffer;
const agency = { address: { name: 'Configured Agency', street: 'Street', city: 'City', stateProvince: 'State',
  postalCode: '00000', countryCode: 'MY', freeText: 'Configured Agency' }, agencyCustomerNumber: '123', ticketingPolicy: 'TODAY' };

describe('Booking Management 2026.08 ATPCO boundary', () => {
  it.each(['UC','INVALID_VALUE'])('preserves the supplier trace for HTTP-200 creation failure %s without retrying',async(type)=>{
    const body=buildSabreCreateBooking(offer,[{givenName:'PRIVATEFIRST',surname:'PRIVATELAST',birthDate:'1990-01-01',passengerCode:'ADT'}],{email:'private@example.com',phone:'+12025550123'},agency);
    const http=vi.fn(async()=>new Response(JSON.stringify({errors:[{category:type==='UC'?'APPLICATION_ERROR':'BAD_REQUEST',type:type==='UC'?'UNABLE_TO_BOOK_FLIGHTS_WRONG_STATUS_CODE':type,description:'PRIVATEFIRST PRIVATELAST private@example.com'}],warnings:[{category:'PROCESSING_WARNING',type:'TEST_WARNING',description:'PRIVATEFIRST PRIVATELAST'}]}),{status:200,headers:{'x-request-id':'creation-trace-123'}}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'secret-test-token')} as never,http as typeof fetch);
    let failure:unknown;try{await client.createBooking(body);}catch(error){failure=error;}
    expect(http).toHaveBeenCalledOnce();
    if(type==='UC'){
      expect(failure).toBeInstanceOf(SabreBookingUnknownError);
      expect(failure).toMatchObject({reason:'UNREADABLE_CONFIRMATION',diagnostic:{supplierRequestId:'creation-trace-123',errors:[{type:'UNABLE_TO_BOOK_FLIGHTS_WRONG_STATUS_CODE'}],warnings:[{type:'TEST_WARNING'}]}});
    }else expect(failure).toMatchObject({supplierRequestId:'creation-trace-123'});
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATEFIRST|PRIVATELAST|private@example.com|secret-test-token/);
  });
  it.each(['missing-tickets','empty-tickets','missing-errors','warnings-only','timeout','disconnect','http-500','invalid-json'])('keeps %s fulfillment ambiguous and records the exact serialized request hash',async(kind)=>{
    let wire='';
    const http=vi.fn(async(_url:string,options:RequestInit)=>{
      wire=String(options.body);
      if(kind==='timeout')throw Object.assign(new Error('private-token passenger'),{name:'TimeoutError'});
      if(kind==='disconnect')throw new TypeError('private-token passenger');
      if(kind==='invalid-json')return new Response('not-json',{status:200});
      const payload={...(kind!=='missing-errors'?{errors:[]}:{}),warnings:[{category:'PROCESSING_WARNING',type:'UNABLE_TO_RETRIEVE_TICKETS',description:'private-token passenger'}],...(kind==='empty-tickets'?{tickets:[]}:{} )};
      return new Response(JSON.stringify(payload),{status:kind==='http-500'?500:200,headers:{'x-request-id':'safe-supplier-reference'}});
    });
    const client=new SabreBookingManagementClient({APP_ENV:'test',SABRE_ENV:'CERT',SABRE_PCC:'BD01',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'private-token')} as never,http as typeof fetch);
    let caught:SabreBookingUnknownError|undefined;
    try{await client.fulfillFlightTickets('ABC123',{formOfPayment:'CASH',hardcopyPrinterAddress:'ABC123'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'},{quoteHandling:'Reprice',commitWaitMs:3000});}catch(error){caught=error as SabreBookingUnknownError;}
    expect(caught).toBeInstanceOf(SabreBookingUnknownError);
    expect(caught?.diagnostic?.dispatch).toMatchObject({operation:'fulfillFlightTickets',environment:'CERT',targetPcc:'BD01',requestSha256:createHash('sha256').update(wire).digest('hex'),quoteHandling:'Reprice',commitWaitMs:3000,supplierPaymentMethod:'CASH',priceQuoteRecordIds:['1'],validatingAirlineCode:'BG',acceptPriceChanges:false,acceptNegotiatedFare:false,printerDesignationRequested:true});
    expect(http).toHaveBeenCalledOnce();expect(JSON.parse(wire)).toMatchObject({acceptPriceChanges:false,acceptNegotiatedFare:false});
    expect(JSON.stringify(caught?.diagnostic?.dispatch)).not.toMatch(/private-token|passenger|cardNumber/);
  });
  it('uses the approved policy directly on the wire and preserves warning trace IDs',async()=>{
    const http=vi.fn(async(_url:string,_options:RequestInit)=>new Response(JSON.stringify({warnings:[{category:'PROCESSING_WARNING',type:'UNABLE_TO_RETRIEVE_TICKETS',description:'Private ABC123 not completed'}]}),{status:200,headers:{'x-request-id':'supplier-trace-123'}}));
    const auth={token:vi.fn(async()=>'test-token')} as unknown as SabreAuthService;
    const client=new SabreBookingManagementClient({APP_ENV:'test',SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,auth,http as unknown as typeof fetch);
    await expect(client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',formOfPayment:'CASH'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'},{quoteHandling:'Reprice',commitWaitMs:3000})).rejects.toMatchObject({diagnostic:{supplierRequestId:'supplier-trace-123',warnings:[{type:'UNABLE_TO_RETRIEVE_TICKETS'}]}});
    expect(JSON.parse(String(http.mock.calls[0]![1].body))).toMatchObject({backDatePriceQuoteMethod:'Reprice',priceQuoteExpirationMethod:'Reprice',commitTicketToBookingWaitTime:3000,acceptPriceChanges:false,acceptNegotiatedFare:false});
    await expect(client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',formOfPayment:'CASH'},[],false,undefined,{quoteHandling:'Override',commitWaitMs:3000} as never)).rejects.toThrow();
    expect(http).toHaveBeenCalledOnce();expect(auth.token).toHaveBeenCalledOnce();
  });
  it('uses stored active PQ associations and carrier rather than inferring ticket stock from marketing flights',async()=>{
    const source={bookingId:'ABC123',flights:[],allSegments:[],flightTickets:[],travelers:[{givenName:'Test',surname:'One'},{givenName:'Test',surname:'Two'}],fares:[{recordId:'1',recordTypeCode:'PQ',pricingStatusName:'Active',airlineCode:'AA',travelerIndices:[1],totals:{total:'100',currencyCode:'BDT'}},{recordId:'2',recordTypeCode:'PQ',pricingStatusName:'Active',airlineCode:'AA',travelerIndices:[2],totals:{total:'200',currencyCode:'BDT'}}]};
    const http=vi.fn(async()=>new Response(JSON.stringify(source),{status:200}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'test-token')} as unknown as SabreAuthService,http as unknown as typeof fetch);
    expect((await client.getTicketingContext('ABC123')).selection).toEqual({priceQuoteRecordIds:['1','2'],validatingAirlineCode:'AA',currency:'BDT',totalAmount:'300.00'});
    source.fares[1]!.travelerIndices=[1];
    await expect(client.getTicketingContext('ABC123')).rejects.toThrow(/scope/);
  });
  it('requires verified current PQ pricing before tolerating unavailable optional fareOffers',async()=>{
    const source={bookingId:'ABC123',errors:[{category:'WARNING',type:'RESOURCE_UNAVAILABLE',fieldName:'fareOffers',fieldPath:'GetBookingResponse'}],flights:[],allSegments:[],flightTickets:[],travelers:[{givenName:'Test',surname:'One'}],fares:[{recordId:'2',recordTypeCode:'PQ',pricingStatusName:'Active',airlineCode:'BG',travelerIndices:[1],totals:{total:'6349',currencyCode:'BDT'}}]};
    const http=vi.fn(async()=>new Response(JSON.stringify(source),{status:200}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:async()=>'fixture-token'} as never,http);
    expect((await client.getTicketingContext('ABC123')).selection).toMatchObject({priceQuoteRecordIds:['2'],totalAmount:'6349.00'});
    source.errors[0]!.fieldName='flightTickets';await expect(client.getTicketingContext('ABC123')).rejects.toThrow('booking errors');
    source.errors[0]!.fieldName='fareOffers';source.fares=[];await expect(client.getTicketingContext('ABC123')).rejects.toThrow(/Quote/);
  });
  it('reissues stored PQRs through Enhanced Air Ticket without repeating initial issuance',async()=>{
    const http=vi.fn(async()=>new Response(JSON.stringify({AirTicketRS:{ApplicationResults:{status:'Complete',Success:[{}]},Summary:[{DocumentType:'TKT',DocumentNumber:'0011234567891',IssuingLocation:'TEST',Reservation:{content:'ABC123'},committed:true}]}}),{status:200}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'test-token')} as unknown as SabreAuthService,http as unknown as typeof fetch);
    await client.fulfillExchange('ABC123',[{id:'2',ticketNumber:'0011234567890',amount:'10.00',validatingAirlineCode:'AA'}],{hardcopyPrinterAddress:'47C591',ticketCountryCode:'BD',formOfPayment:'CASH'});
    const body=JSON.parse(String((http.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.AirTicketRQ.Ticketing).toEqual([{PricingQualifiers:{PriceQuote:[{Record:[{Number:2,Reissue:true}]}]}}]);
    expect(body.AirTicketRQ.Ticketing[0]).not.toHaveProperty('FOP_Qualifiers');
    expect(body.AirTicketRQ.DesignatePrinter.Printers.Ticket).toEqual({CountryCode:'BD'});
    expect((http.mock.calls[0] as unknown as [string])[0]).toBe('https://api.cert.platform.sabre.com/v1.3.0/air/ticket');expect(http).toHaveBeenCalledOnce();
  });
  it('retains a sanitized fulfillment diagnostic without repeating the request',async()=>{
    const http=vi.fn(async()=>new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'TICKETING_FAILURE',description:'Stock rejected for ABC123; test@example.com'}]}),{status:200}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'test-token')} as unknown as SabreAuthService,http as unknown as typeof fetch);
    try{await client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'47C591',formOfPayment:'CASH'});throw Error('Expected uncertainty');}catch(error){expect(error).toBeInstanceOf(SabreBookingUnknownError);expect(JSON.stringify((error as SabreBookingUnknownError).diagnostic)).not.toContain('ABC123');expect(JSON.stringify((error as SabreBookingUnknownError).diagnostic)).not.toContain('test@example.com');}
    expect(http).toHaveBeenCalledOnce();
  });
  it('sends CASH only as the CERT agency form of payment and blocks production or NDC cash issuance',async()=>{
    const http=vi.fn(async(_url:string,_options:RequestInit)=>new Response(JSON.stringify({tickets:[{number:'9971234567890',isCommitted:true}]}),{status:200}));
    const config={APP_ENV:'test',SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig;
    const auth={token:vi.fn(async()=> 'fixture-token')} as unknown as SabreAuthService;
    const profile={hardcopyPrinterAddress:'ABC123',formOfPayment:'CASH' as const};
    const client=new SabreBookingManagementClient(config,auth,http as unknown as typeof fetch);
    await client.fulfillFlightTickets('ABC123',profile);
    const body=JSON.parse(String(http.mock.calls[0]![1].body));
    expect(body.formsOfPayment).toEqual([{type:'CASH'}]);
    expect(body.designatePrinters).toEqual([{hardcopy:{address:'ABC123'}}]);
    expect(body.fulfillments).toEqual([{payment:{primaryFormOfPayment:1}}]);
    expect(JSON.stringify(body)).not.toMatch(/sk_test_|cardNumber|stripe/i);
    await expect(client.fulfillFlightTickets('ABC123',profile,[],true)).rejects.toThrow('ATPCO CERT staff tests');
    await expect(new SabreBookingManagementClient({...config,APP_ENV:'production'},auth,http as unknown as typeof fetch).fulfillFlightTickets('ABC123',profile)).rejects.toThrow('ATPCO CERT staff tests');
    expect(http).toHaveBeenCalledOnce();
  });
  it('fulfills with the verified hardcopy printer without inventing a ticket stock country',async()=>{
    const http=vi.fn(async(_url:string,_options:RequestInit)=>new Response(JSON.stringify({tickets:[{number:'9971234567890',isCommitted:true}]}),{status:200}));
    const config={SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig;
    const auth={token:vi.fn(async()=> 'fixture-token')} as unknown as SabreAuthService;
    const client=new SabreBookingManagementClient(config,auth,http as unknown as typeof fetch);
    await client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',formOfPayment:'INVOICE',invoiceDescription:'Fixture only'});
    const body=JSON.parse(String(http.mock.calls[0]![1].body));
    expect(body.designatePrinters).toEqual([{hardcopy:{address:'ABC123'}}]);
    expect(body.formsOfPayment).toEqual([{type:'INVOICE',invoiceDescription:'Fixture only',addInvoiceDescriptionPrefix:false}]);
    expect(body.acceptPriceChanges).toBe(false);
    expect(body).toMatchObject({acceptNegotiatedFare:false,backDatePriceQuoteMethod:'Quit',priceQuoteExpirationMethod:'Quit'});
    await client.fulfillFlightTickets('ABC123',{hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD',formOfPayment:'INVOICE',invoiceDescription:'Fixture only'});
    expect(JSON.parse(String(http.mock.calls[1]![1].body)).designatePrinters).toEqual([{hardcopy:{address:'ABC123'}},{ticket:{countryCode:'BD'}}]);
  });
  it('preserves NDC traveler gender, assistance and infant associations with priced passenger IDs', () => {
    const context = { offerId:'priced-offer', offerItemIds:['priced-item'], expiresAt:new Date(Date.now()+60000).toISOString(),
      passengers:[{passengerId:'adult-id',passengerTypeCode:'ADT' as const},{passengerId:'infant-id',passengerTypeCode:'INF' as const}] };
    const body = buildSabreCreateNdcBooking(context, [
      {givenName:'Adult',surname:'Traveler',birthDate:'1990-01-01',passengerCode:'ADT',gender:'X',infantTravelerIndex:2,specialServices:[{code:'WCHR',flightIndices:[1]}]},
      {givenName:'Infant',surname:'Traveler',birthDate:'2026-01-01',passengerCode:'INF',gender:'FEMALE'},
    ], {email:'test@example.invalid',phone:'+60123456789'}, agency);
    expect(body.travelers[0]).toMatchObject({id:'adult-id',gender:'UNDEFINED',infantTravelerIndex:2,specialServices:[{code:'WCHR',flightIndices:[1]}],identityDocuments:[{gender:'UNDEFINED'}]});
    expect(body.travelers[1]).toMatchObject({id:'infant-id',gender:'FEMALE'});
    expect(body.travelers[1]).not.toHaveProperty('infantTravelerIndex');
    expect(body).not.toHaveProperty('payment');
    expect(()=>buildSabreCreateNdcBooking({...context,expiresAt:'invalid'},[],{email:'test@example.invalid',phone:'+60123456789'},agency)).toThrow();
  });

  it('translates profile gender X to the documented Sabre identity-document value', () => {
    const body = buildSabreCreateBooking(offer, [{givenName:'Test',surname:'Traveler',birthDate:'1990-01-01',passengerCode:'ADT',
      identityDocuments:[{documentType:'PASSPORT',documentNumber:'TEST00001',expiryDate:'2030-01-01',issuingCountryCode:'MY',residenceCountryCode:'MY',givenName:'Test',surname:'Traveler',birthDate:'1990-01-01',gender:'X'}]}],
      {email:'test@example.invalid',phone:'+60123456789'},agency);
    expect(body.travelers[0]?.identityDocuments?.[0]?.gender).toBe('UNDEFINED');
  });

  it('maps the supplied FlightCheck and CreateBooking shapes without claiming a ticket', () => {
    expect(buildBookingFlightCheck(offer, 1)).toEqual({ journeys: [{ flights: [{ departureAirportCode: 'KUL',
      departureDate: '2026-12-10', departureTime: '09:00', arrivalAirportCode: 'PEN', arrivalDate: '2026-12-10',
      arrivalTime: '10:30', operatingAirlineCode: 'MH', operatingFlightNumber: 1122,
      marketingAirlineCode: 'MH', marketingFlightNumber: 1122 }] }], travelers: [{ passengerTypeCode: 'ADT' }] });
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);
    expect(body.flightDetails).toEqual({ flights: [{ flightNumber: 1122, airlineCode: 'MH', fromAirportCode: 'KUL',
      toAirportCode: 'PEN', departureDate: '2026-12-10', departureTime: '09:00', bookingClass: 'K', flightStatusCode: 'NN' }],
      flightPricing: [{qualifiers:{currencyPricing:'MYR'},priceComparisons:[
        {desiredAmount:'650.00',comparisonType:'INCREASE_BY_AMOUNT',amount:'0.00'},
        {desiredAmount:'650.00',comparisonType:'DECREASE_BY_AMOUNT',amount:'0.00'},
      ]}] });
    expect(body).not.toHaveProperty('ticketing');
    expect(body).not.toHaveProperty('payment');
    const repriced = buildSabreCreateBooking(offer,[{givenName:'Test',surname:'Flyer',birthDate:'1990-01-01',passengerCode:'ADT'}],
      {email:'test@example.invalid',phone:'+60123456789'},agency,{currency:'BDT',totalAmount:'10198.00'});
    expect(repriced.flightDetails.flightPricing[0]?.qualifiers.currencyPricing).toBe('BDT');
    expect(repriced.flightDetails.flightPricing[0]?.priceComparisons.every(comparison => comparison.desiredAmount==='10198.00')).toBe(true);
    expect(readSabreCreateBooking({ confirmationId: 'ABC123', booking: { bookingId: 'booking-123' } }))
      .toEqual({ confirmationId: 'ABC123', sabreBookingId: 'booking-123' });
    expect(buildSabreGetBooking('ABC123')).toEqual({ confirmationId: 'ABC123' });
    expect(readSabreGetBooking({ bookingId: 'booking-123' })).toEqual({ bookingId: 'booking-123' });
  });

  it('rejects unknown codeshare flight numbers and missing PNR confirmations', () => {
    expect(() => buildBookingFlightCheck({ ...offer, outbound: { ...offer.outbound,
      segments: [{ ...offer.outbound.segments[0]!, operatingCarrier: 'FY' }] } }, 1)).toThrow(/Operating flight number/);
    expect(() => readSabreCreateBooking({ booking: { bookingId: 'booking-123' } })).toThrow();
    expect(() => buildSabreGetBooking('arbitrary locator')).toThrow();
    expect(() => buildSabreGetBooking('ABCDE')).toThrow();
    expect(() => readSabreCreateBooking({ confirmationId: 'ABCDE', booking: { bookingId: 'booking-123' } })).toThrow();
  });

  it('sends CreateBooking only once on timeout and treats the outcome as unknown', async () => {
    const http = vi.fn(async () => { throw new Error('timeout'); });
    const config = { SABRE_ENV: 'CERT', SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig;
    const auth = { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService;
    const client = new SabreBookingManagementClient(config, auth, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);
    await expect(client.createBooking(body)).rejects.toBeInstanceOf(SabreBookingUnknownError);
    expect(http).toHaveBeenCalledOnce();
  });

  it.each([408, 429, 500, 503, 200])('preserves uncertainty without a second supplier submission for HTTP %s failure', async status => {
    const http = vi.fn(async () => new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'SABRE_COMMAND_FAILURE',description:'General problem with SabreCommandLLSRQ service.'}]}),{status}));
    const client = new SabreBookingManagementClient({SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,
      {token:vi.fn(async ()=>'test-token')} as unknown as SabreAuthService, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer,[{givenName:'Test',surname:'Traveler',birthDate:'1990-01-01',passengerCode:'ADT'}],{email:'test@example.invalid',phone:'+60123456789'},agency);
    await expect(client.createBooking(body)).rejects.toBeInstanceOf(SabreBookingUnknownError);
    expect(http).toHaveBeenCalledOnce();
  });

  it('uses the collection FlightCheck endpoint with a server OAuth token', async () => {
    const http = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ journeys: [] }), { status: 200 }));
    const config = { SABRE_ENV: 'CERT', SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig;
    const auth = { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService;
    const client = new SabreBookingManagementClient(config, auth, http as unknown as typeof fetch);
    await client.flightCheck(offer, 1);
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0]?.[0]).toBe('https://api.cert.platform.sabre.com/v1/offers/flightCheck');
    expect(auth.token).toHaveBeenCalledOnce();
  });

  it('maps successful mocked CreateBooking and GetBooking without a payment or ticketing operation', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const http = vi.fn(async (url: string, options: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(options.body)) });
      return new Response(JSON.stringify(url.endsWith('/createBooking') ?
        { confirmationId: 'ABC123', booking: { bookingId: 'booking-123' } } : { bookingId: 'booking-123' }), { status: 200 });
    });
    const config = { SABRE_ENV: 'CERT', SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig;
    const auth = { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService;
    const client = new SabreBookingManagementClient(config, auth, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);
    const created = await client.createBooking(body);
    const refreshed = await client.getBooking(created.confirmationId);
    expect(created).toEqual({ confirmationId: 'ABC123', sabreBookingId: 'booking-123' });
    expect(refreshed).toEqual({ bookingId: 'booking-123' });
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.cert.platform.sabre.com/v1/trip/orders/createBooking',
      'https://api.cert.platform.sabre.com/v1/trip/orders/getBooking',
    ]);
    expect(requests[0]?.body).not.toHaveProperty('fulfillFlightTickets');
  });

  it('sends the created PNR locator, never the booking ID, through GetBooking and FulfillFlightTickets', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const http = vi.fn(async (url: string, options: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(options.body)) as Record<string, unknown> });
      const response = url.endsWith('/createBooking')
        ? { confirmationId: 'QJIQIN', booking: { bookingId: 'different-provider-booking-id' } }
        : url.endsWith('/getBooking')
          ? { bookingId: 'different-provider-booking-id' }
          : { tickets: [{ number: '9971234567890' }] };
      return new Response(JSON.stringify(response), { status: 200 });
    });
    const client = new SabreBookingManagementClient({ APP_ENV: 'test', SABRE_ENV: 'CERT', SABRE_PCC: '73H8',
      SABRE_BASE_URL: 'https://api.cert.platform.sabre.com', SABRE_REQUEST_TIMEOUT_MS: 1000 } as AppConfig,
    { token: vi.fn(async () => 'test-token') } as unknown as SabreAuthService, http as unknown as typeof fetch);
    const body = buildSabreCreateBooking(offer, [{ givenName: 'Test', surname: 'Flyer', birthDate: '1990-01-01', passengerCode: 'ADT' }],
      { email: 'test@example.invalid', phone: '+60123456789' }, agency);

    const created = await client.createBooking(body);
    const fetched = await client.getBooking(created.confirmationId);
    await client.fulfillFlightTickets(created.confirmationId,
      { formOfPayment: 'CASH', hardcopyPrinterAddress: '47C591', ticketCountryCode: 'BD' },
      [], false, { priceQuoteRecordIds: ['1'], validatingAirlineCode: 'MH' },
      { quoteHandling: 'Quit', commitWaitMs: 3000 });

    expect(created).toEqual({ confirmationId: 'QJIQIN', sabreBookingId: 'different-provider-booking-id' });
    expect(fetched).toEqual({ bookingId: 'different-provider-booking-id' });
    expect(requests.map(request => new URL(request.url).pathname)).toEqual([
      '/v1/trip/orders/createBooking', '/v1/trip/orders/getBooking', '/v1/trip/orders/fulfillFlightTickets',
    ]);
    expect(requests[0]?.body).toMatchObject({ targetPcc: '73H8' });
    expect(requests[1]?.body).toEqual({ confirmationId: 'QJIQIN', targetPcc: '73H8' });
    expect(requests[2]?.body).toMatchObject({ confirmationId: 'QJIQIN', targetPcc: '73H8',
      fulfillments: [{ ticketingQualifiers: { priceQuoteRecordIds: ['1'], validatingAirlineCode: 'MH' },
        payment: { primaryFormOfPayment: 1 } }], formsOfPayment: [{ type: 'CASH' }] });
    expect(requests.flatMap(request => Object.values(request.body))).not.toContain('different-provider-booking-id');
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('selects the exact booking class from CERT FlightCheck rather than its misleading validation label', () => {
    const selected = { ...offer, outbound: { ...offer.outbound,
      segments: [{ ...offer.outbound.segments[0]!, bookingClass: 'Q' }] } };
    const response = { offers: [
      { id: 'higher-class', source: { distributionModel: 'ATPCO' }, applicableToPseudoCityCodes: ['TEST'],
        validUntil: '2026-12-31T00:00:00Z', totalPrice: { amount: '43312', currencyCode: 'BDT' },
        items: [{ fares: [{ fareComponents: [{ segmentDetails: [{ bookingClassCode: 'Y' }] }] }] }] },
      { id: 'selected-class', source: { distributionModel: 'ATPCO' }, applicableToPseudoCityCodes: ['TEST'],
        validUntil: '2026-12-31T00:00:00Z', totalPrice: { amount: '9270', currencyCode: 'BDT' },
        items: [{ fares: [{ fareComponents: [{ segmentDetails: [{ bookingClassCode: 'Q' }] }] }] }] },
    ], offerValidationResults: [
      { bookingClassCodeValidation: 'Matched', offerRef: 'higher-class' },
      { bookingClassCodeValidation: 'Same cabin', offerRef: 'selected-class' },
    ] };
    expect(selectCheckedAtpcoOffer(response, selected, 'TEST', Date.parse('2026-09-30T00:00:00Z')))
      .toEqual({ offerId: 'selected-class', totalAmount: '9270', currency: 'BDT', validUntil: '2026-12-31T00:00:00Z' });
    expect(() => selectCheckedAtpcoOffer(response, selected, 'OTHER', Date.parse('2026-09-30T00:00:00Z'))).toThrow();
  });

  it('preserves warning-only fulfillment diagnostics and never interprets HTTP 200 as ticket issuance', async () => {
    const warning={category:'PROCESSING_WARNING',type:'DOWNLINE_SERVICE_WARNING',description:'AirTicketLLSRQ: UNABLE TO TICKET STORED FARE - PQ EXPIRED'};
    const http=vi.fn(async()=>new Response(JSON.stringify({timestamp:'2026-10-24T03:16:45',warnings:[warning]}),{status:200}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'test-token')} as unknown as SabreAuthService,http as unknown as typeof fetch);
    await expect(client.fulfillFlightTickets('ABC123',{formOfPayment:'CASH',hardcopyPrinterAddress:'ABC123'},[],false,{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'})).rejects.toMatchObject({reason:'UNREADABLE_CONFIRMATION',diagnostic:{warnings:[{category:warning.category,type:warning.type,description:'UNABLE TO TICKET STORED FARE - PQ EXPIRED'}],responseKeys:['timestamp','warnings']}});
    expect(http).toHaveBeenCalledOnce();
  });

  it('allows warnings alongside returned documents for the separate ticket reconciliation step', async () => {
    const response={tickets:[{number:'9971234567890',isCommitted:true}],warnings:[{category:'PROCESSING_WARNING',description:'Document retrieval warning'}]};
    const http=vi.fn(async()=>new Response(JSON.stringify(response),{status:200}));
    const client=new SabreBookingManagementClient({SABRE_ENV:'CERT',APP_ENV:'test',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:vi.fn(async()=>'test-token')} as unknown as SabreAuthService,http as unknown as typeof fetch);
    await expect(client.fulfillFlightTickets('ABC123',{formOfPayment:'CASH',hardcopyPrinterAddress:'ABC123'})).resolves.toEqual(response);
    expect(http).toHaveBeenCalledOnce();
  });
});
