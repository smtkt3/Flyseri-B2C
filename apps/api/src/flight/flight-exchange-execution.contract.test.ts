import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {exchangeVerificationPayload,exchangeRecordId,exchangeBookingRequest,readExchangeContext,readExchangePqrs,reissueComplete,executableExchange,exchangedItineraryOffer,type ExchangeContext} from './flight-exchange-execution.contract.js';
import {readExchangeSearch,type ExchangeOffer} from './flight-exchange-shopping.contract.js';
import type {FlightBookingProviderView,FlightOffer} from '@flyseri/types';
import {hasCurrentIssuedTicketEvidence} from './reservation-evidence.js';
const number='2321234567890';
const view:FlightBookingProviderView={retrievedAt:new Date().toISOString(),cancellationCheckComplete:true,travellers:[{givenName:'TEST',surname:'TRAVELER'}],flights:[{airlineCode:'MH',flightNumber:'1140',origin:'KUL',destination:'PEN',departureDate:'2026-12-11',departureTime:'10:50:00',arrivalDate:'2026-12-11',arrivalTime:'11:50:00',status:'Confirmed'}],tickets:[{number,status:'Issued',travellerIndex:1,couponStatuses:['Open']}]};
const context:ExchangeContext={bookingId:'provider-id',fingerprint:'before',segmentIds:[2],travelers:[{nameAssociationId:1,givenName:'TEST',surname:'TRAVELER'}],tickets:[{number,travelerIndex:1,validatingAirlineCode:'MH'}],pqrIds:[],pqrRecords:[],view};
const offer:ExchangeOffer={id:'offer',reference:'RESHOP:0',airlineExpiresAt:null,priceGuaranteed:true,splitBooking:false,mixedCabins:false,chargeType:'Add collect',amount:'12.50',currency:'MYR',airlineFee:'0.00',flights:[{airline:'MH',number:'1140',origin:'KUL',destination:'PEN',departureDate:'2026-12-11',departureTime:'10:50:00',arrivalDate:'2026-12-11',arrivalTime:'11:50:00',bookingClasses:['M'],cabins:['Economy']}],ticketPrices:[{number,amount:'12.50',currency:'MYR',chargeType:'Add collect',bookingClasses:['M']}]};
describe('verified exchange contracts',()=>{
 it('tolerates only unavailable passenger-code enrichment after a matching committed exchange',()=>{
  const warning={category:'WARNING',type:'RESOURCE_UNAVAILABLE',fieldName:'passengerCode',fieldPath:'GetBookingResponse.travelers'};
  const raw={bookingId:context.bookingId,errors:[warning],travelers:[{nameAssociationId:1,givenName:'TEST',surname:'TRAVELER'}],flightTickets:[{number,travelerIndex:1,airlineCode:'MH'}],fares:[{recordTypeCode:'PQR',recordId:'2',pricingStatusName:'Active'}]};
  expect(exchangeVerificationPayload(raw,context)).toMatchObject({errors:[]});
  expect(raw.errors).toEqual([warning]);
  for(const patch of [{bookingId:'OTHER'},{fares:[]},{flightTickets:[]},{travelers:[{nameAssociationId:1,givenName:'OTHER',surname:'TRAVELER'}]},{errors:[{...warning,fieldName:'flights'}]},{errors:[{...warning,category:'APPLICATION_ERROR'}]}])expect(()=>exchangeVerificationPayload({...raw,...patch},context)).toThrow();
 });
 it('normalizes numeric PQR IDs consistently without changing ticket associations or amounts',()=>{
  expect(exchangeRecordId('02')).toBe('2');
  expect(()=>exchangeRecordId('0')).toThrow();
  expect(()=>exchangeRecordId('2x')).toThrow();
  expect(readExchangePqrs({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[{PQR_Number:'02',PriceComparison:{amountReturned:'12.50'}}]}},offer,context)).toEqual([{id:'2',ticketNumber:number,amount:'12.50'}]);
  expect(()=>readExchangePqrs({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[{PQR_Number:'02',PriceComparison:{amountReturned:'12.50'}}]}},offer,{...context,pqrIds:['2']})).toThrow();
 });
 it('blocks separate change-fee document instructions before opening additional collection',()=>{
  expect(()=>readExchangePqrs({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[{PQR_Number:'2',PriceComparison:{amountReturned:'12.50'},AdditionalText:'FEE TO BE COLLECTED ON SEPARATE DOCUMENT 5.00'}]}},offer,context)).toThrow(/change-fee document/);
 });
 it('requires positive change fees to be verified in the ticket transaction total, not a separate document',()=>{
  const withFee={...offer,airlineFee:'5.00'};
  const response=(amount:string)=>({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[{PQR_Number:'2',PriceComparison:{amountReturned:'12.50'}}],PriceQuoteReissue:[{PQR_Number:'02',PricedItinerary:{AirItineraryPricingInfo:{ExchangeDetails:{DocNumber:number,TransactionInformation:[{Amount:amount,CurrencyCode:'MYR'}]}}}}]}});
  expect(readExchangePqrs(response('12.50'),withFee,context)).toHaveLength(1);
  expect(()=>readExchangePqrs(response('0.00'),withFee,context)).toThrow(/change-fee document/);
  expect(exchangeBookingRequest('TEST01',withFee,context).ExchangeBookingRQ.AutomatedExchanges[0]!.ExchangeComparison.PriceRequestInformation.OptionalQualifiers.PricingQualifiers.ChangeFeeCollectionOptions).toEqual({CollectFee:{InTotal:true}});
 });
 it('validates the exact request against the retained official Exchange Booking 1.1 schema',()=>{
  const require=createRequire(realpathSync('../../node_modules/eslint/package.json'));
  const spec=require('js-yaml').load(readFileSync('../../reference/sabre/exchange-booking-1.1.0.yml','utf8'));
  const Ajv=require('ajv'),validate=new Ajv({allErrors:true,unknownFormats:'ignore',logger:false,schemaId:'auto'}).compile({components:spec.components,$ref:'#/components/schemas/ExchangeBookingRequest'});
  const body=exchangeBookingRequest('TEST01',{...offer,priceGuaranteed:false},context,{pricePolicy:'EXACT_MATCH',nativeCurrency:'MYR',pcc:'TEST'});
  expect(validate(body),JSON.stringify(validate.errors)).toBe(true);
  expect(body.ExchangeBookingRQ.AutomatedExchanges[0]!.ExchangeConfirmation).toEqual({
    DoNotIssueEMDForChangeFee:true,
    OptionalQualifiers:{FOP_Qualifiers:{BasicFOP:[{Type:'CA'}]}},
  });
 });
 it('uses original segment and traveler associations with exact zero price tolerance',()=>{
  const request=exchangeBookingRequest('TEST01',offer,context).ExchangeBookingRQ;
  expect(request.Cancel).toEqual({Segment:[{itemId:2}]});
  expect(request.AutomatedExchanges[0]?.PriceComparison).toMatchObject({amountSpecified:12.5,AcceptablePriceIncrease:{Amount:0,haltOnNonAcceptablePrice:true},AcceptablePriceDecrease:{Amount:0,haltOnNonAcceptablePrice:true}});
  expect(request.AirBook.OriginDestinationInformation.FlightSegment[0]).toMatchObject({Status:'NN',ResBookDesigCode:'M',NumberInParty:'1'});
  expect(request.AutomatedExchanges[0]?.ExchangeComparison).toMatchObject({OriginalTicketNumber:number,PriceRequestInformation:{OptionalQualifiers:{PricingQualifiers:{AutoRedirect:false,NameSelect:{nameAssociationId:1}}}}});
 });
 it.each(['ticketPrices','currency','amount'] as const)('requires complete %s',key=>{expect(()=>executableExchange({...offer,[key]:undefined} as ExchangeOffer,context)).toThrow();});
 it.each([{splitBooking:true},{mixedCabins:true},{priceGuaranteed:false},{amount:'12.51'},{chargeType:'Even'}])('rejects non-executable pricing %j',patch=>expect(()=>executableExchange({...offer,...patch} as ExchangeOffer,context)).toThrow());
 it('requires an explicit exact-price policy for indicative offers and keeps zero tolerances',()=>{
  const indicative={...offer,priceGuaranteed:false};
  expect(()=>exchangeBookingRequest('TEST01',indicative,context)).toThrow();
  const rq=exchangeBookingRequest('TEST01',indicative,context,{pricePolicy:'EXACT_MATCH',nativeCurrency:'MYR',pcc:'TEST'}).ExchangeBookingRQ;
  expect(rq.targetCity).toBe('TEST');
  expect(rq.AutomatedExchanges[0]?.PriceComparison).toEqual({amountSpecified:12.5,AcceptablePriceIncrease:{Amount:0,haltOnNonAcceptablePrice:true},AcceptablePriceDecrease:{Amount:0,haltOnNonAcceptablePrice:true}});
  const pricing=rq.AutomatedExchanges[0]?.ExchangeComparison.PriceRequestInformation.OptionalQualifiers.PricingQualifiers;
  expect(pricing).toMatchObject({AutoRedirect:false});
  expect(pricing).not.toHaveProperty('AlternateCurrencyCode');
  expect(rq.AirBook.HaltOnStatus).toContainEqual({Code:'UC'});
  expect(exchangeBookingRequest('TEST01',offer,context).ExchangeBookingRQ.AutomatedExchanges[0]?.ExchangeComparison.PriceRequestInformation.OptionalQualifiers.PricingQualifiers.AlternateCurrencyCode).toBe('MYR');
  expect(()=>executableExchange({...indicative,mixedCabins:true},context,'EXACT_MATCH')).toThrow();
 });
 it('accepts a documented no-redirect flag but rejects redirected category-16 pricing',()=>{
  const response=(flag:string)=>({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[{PQR_Number:'2',PriceComparison:{amountReturned:'12.50'},AutoRedirect:flag}]}});
  expect(readExchangePqrs(response('N'),offer,context)).toHaveLength(1);
  expect(()=>readExchangePqrs(response('Y'),offer,context)).toThrow();
 });
 it('accepts a new PQR only at the approved exact ticket amount',()=>{
  expect(readExchangePqrs({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[{PQR_Number:'2',PriceComparison:{amountReturned:'12.50'}}]}},offer,context)).toEqual([{id:'2',ticketNumber:number,amount:'12.50'}]);
 });
 it.each([{PQR_Number:'2',PriceComparison:{amountReturned:'13.00'}},{PQR_Number:'2',PriceComparison:{amountReturned:'12.50'},AutoRedirect:'true'},{PQR_Number:'2',PriceComparison:{amountReturned:'12.50'},RefundableAmountOnEMD:'4.00'}])('locks conflicting pricing or residual evidence %j',confirmation=>expect(()=>readExchangePqrs({ExchangeBookingRS:{ApplicationResults:{status:'Complete'},ExchangeConfirmation:[confirmation]}},offer,context)).toThrow());
 it('requires verified original exchanged coupons and unique replacement tickets',()=>{
  const complete={...view,tickets:[{number,status:'Refunded/Exchanged',travellerIndex:1,couponStatuses:['Exchanged']},{number:'2321234567899',status:'Issued',travellerIndex:1,couponStatuses:['Open']}]};
  expect(reissueComplete(complete,offer,context)).toBe(true);
  expect(hasCurrentIssuedTicketEvidence(complete,1)).toBe(true);
  expect(hasCurrentIssuedTicketEvidence({...complete,tickets:[...complete.tickets,complete.tickets[1]!]},1)).toBe(false);
  expect(hasCurrentIssuedTicketEvidence({...complete,tickets:[{...complete.tickets[0]!,couponStatuses:['Refunded']},complete.tickets[1]!] },1)).toBe(false);
  expect(reissueComplete({...complete,tickets:complete.tickets.slice(1)},offer,context)).toBe(false);
  expect(reissueComplete({...complete,tickets:[{...complete.tickets[0]!,couponStatuses:['Refunded']},complete.tickets[1]!] },offer,context)).toBe(false);
  expect(reissueComplete({...complete,flights:[{...view.flights[0]!,status:'Unconfirmed'}]},offer,context)).toBe(false);
 });
 it('reconciles Sabre Issued original documents only when all their coupons are Exchanged',()=>{
  const complete={...view,tickets:[{number,status:'Issued',travellerIndex:1,couponStatuses:['Exchanged']},{number:'2321234567899',status:'Issued',travellerIndex:1}]};
  expect(reissueComplete(complete,offer,context)).toBe(true);
  expect(hasCurrentIssuedTicketEvidence(complete,1)).toBe(true);
  expect(hasCurrentIssuedTicketEvidence({...complete,tickets:[complete.tickets[0]!] },1)).toBe(false);
  for(const couponStatuses of [undefined,[],['Not Flown'],['Exchanged','Not Flown'],['Refunded']]){
   expect(reissueComplete({...complete,tickets:[{...complete.tickets[0]!,couponStatuses},complete.tickets[1]!] },offer,context)).toBe(false);
  }
  expect(reissueComplete({...complete,tickets:[{...complete.tickets[0]!,travellerIndex:2},complete.tickets[1]!] },offer,context)).toBe(false);
  expect(reissueComplete({...complete,tickets:[...complete.tickets,complete.tickets[0]!] },offer,context)).toBe(false);
  expect(reissueComplete({...complete,tickets:[complete.tickets[0]!,{...complete.tickets[1]!,couponStatuses:['Exchanged']}] },offer,context)).toBe(false);
 });
 it('publishes verified replacement routing without old baggage or invented time offsets',()=>{
  const original={offerId:'original',totalAmount:'100.00',currency:'MYR',baggageSummary:'Old allowance',airlineCodes:['OLD'],outbound:{segments:[],stops:0,durationMinutes:null},inbound:null} as FlightOffer;
  const current=exchangedItineraryOffer(original,offer,[{origin:'KUL',destination:'PEN'}]);
  expect(current).toMatchObject({offerId:'original',totalAmount:'100.00',baggageSummary:null,airlineCodes:['MH'],outbound:{segments:[{departureAt:'2026-12-11T10:50:00',bookingClass:'M',durationMinutes:null}]}});
  expect(original.baggageSummary).toBe('Old allowance');
  expect(()=>exchangedItineraryOffer(original,offer,[{origin:'DAC',destination:'PEN'}])).toThrow();
 });
 it('reads only complete source PQR and association evidence',()=>{
  const source={flights:[{sourceType:'ATPCO'}],allSegments:[{id:'2',type:'FLIGHT'}],travelers:[{nameAssociationId:'1',givenName:'TEST',surname:'TRAVELER'}],flightTickets:[{number,travelerIndex:1,airlineCode:'MH'}],fares:[{recordTypeCode:'PQR',recordId:'2',pricingStatusName:'Active',hasValidPricing:true,travelerIndices:[1],totals:{total:'500.00',currencyCode:'MYR'}}]};
  expect(readExchangeContext(source,{bookingId:'provider-id',view})).toMatchObject({segmentIds:[2],pqrRecords:[{id:'2',active:true,travelerIndices:[1]}]});
  expect(()=>readExchangeContext({...source,allSegments:[{id:'2',type:'HOTEL'}]},{bookingId:'provider-id',view})).toThrow();
  expect(()=>readExchangeContext({...source,flightTickets:[{number,travelerIndex:1}]},{bookingId:'provider-id',view})).toThrow(/issuing carrier/);
 });
 it('binds the documented validating-carrier qualifier to each original ticket, never the new marketing carrier',()=>{
  const original={...context,tickets:[{...context.tickets[0]!,validatingAirlineCode:'SQ'}]};
  const pricing=exchangeBookingRequest('TEST01',offer,original).ExchangeBookingRQ.AutomatedExchanges[0]!.ExchangeComparison.PriceRequestInformation.OptionalQualifiers;
  expect(pricing.FlightQualifiers).toEqual({VendorPrefs:{Airline:{Code:'SQ'}}});
  expect(()=>exchangeBookingRequest('TEST01',offer,{...context,tickets:[{...context.tickets[0]!,validatingAirlineCode:''}]})).toThrow();
 });
 it('retains the per-ticket reshop amounts and booking classes',()=>{
  const eligibility={bookingId:'provider-id',fingerprint:'fp',checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),reference:'SABRE',atpcoFlightOnly:true,tickets:[{number,changeable:true,voidable:true,refundable:true,automatedRefundEligible:true,refundTotal:null,refundFee:null}]};
  const response={flights:[{id:'f1',marketingAirlineCode:'MH',marketingFlightNumber:1140,departureAirportCode:'KUL',arrivalAirportCode:'PEN',departureDate:'2026-12-11',departureTime:'10:50:00',arrivalDate:'2026-12-11',arrivalTime:'11:50:00'}],journeys:[{id:'j1',flightRefs:['f1']}],offers:[{id:'offer',source:{distributionModel:'ATPCO'},isPriceGuaranteed:true,journeyRefs:['j1'],totalPriceDifference:{type:'Add collect',grandTotal:'12.50',currencyCode:'MYR',totalFee:'5.00'},items:[{fares:[{travelers:[{ticketNumber:number}],priceDifference:{type:'Add collect',grandTotal:'12.50',currencyCode:'MYR'},fareComponents:[{segmentDetails:[{flightRef:'f1',bookingClassCode:'M',cabinName:'Economy'}]}]}]}]}]};
  expect(readExchangeSearch(response,eligibility,[{origin:'KUL',destination:'PEN',departureDate:'2026-12-11'}]).offers[0]?.ticketPrices).toEqual(offer.ticketPrices);
 });
});
