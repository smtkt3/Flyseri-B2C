import {describe,it,expect,vi} from 'vitest';
import type {FlightOffer} from '@flyseri/types';
import {readSabreBookingView} from './sabre-booking-management.client.js';
import {readTicketDocuments,verifyTicketDocuments,type TicketReconciliationExpected} from './ticketing-reconciliation.contract.js';
import {FlightTicketReconciliationService} from './flight-ticket-reconciliation.service.js';
import {readDailySalesEvidence} from './sabre-sales-audit.contract.js';

const offer:FlightOffer={offerId:'fixture',currency:'BDT',totalAmount:'6049.00',airlineCodes:['BG'],baggageSummary:null,inbound:null,outbound:{stops:0,durationMinutes:75,segments:[{origin:'DAC',destination:'CXB',marketingCarrier:'BG',flightNumber:'433',departureAt:'2026-12-10T08:00:00+06:00',arrivalAt:'2026-12-10T09:15:00+06:00',durationMinutes:75}]}};
const expected:TicketReconciliationExpected={pnr:'ABC123',bookingId:'ABC123',passengerNames:['Test Passenger'],offer,currency:'BDT',amount:'6049.00',pcc:'BD01',validatingCarrier:'BG'};
function raw(){return {bookingId:'ABC123',isTicketed:true,allSegments:[{type:'FLIGHT'}],travelers:[{givenName:'Test',surname:'Passenger'}],flights:[{itemId:'1',airlineCode:'BG',flightNumber:433,fromAirportCode:'DAC',toAirportCode:'CXB',departureDate:'2026-12-10',departureTime:'08:00:00',arrivalDate:'2026-12-10',arrivalTime:'09:15:00',flightStatusName:'Confirmed'}],flightTickets:[{number:'9971234567890',travelerIndex:1,airlineCode:'BG',ticketingPcc:'BD01',ticketStatusName:'Issued',flightCoupons:[{itemId:'1',couponStatus:'Okay'}],payment:{total:'6049.00',currencyCode:'BDT'}}]};}
const context=(source:Record<string,unknown>)=>({...readSabreBookingView(source),documents:readTicketDocuments(source)});
describe('read-only ticket document reconciliation',()=>{
 it('independently matches PNR, passenger, every segment, carrier, PCC, status and money',()=>{
  expect(verifyTicketDocuments(context(raw()),expected)).toMatchObject({verification:'VERIFIED',documentCount:1,pccScope:'PCC_CONFIRMED',automaticRetry:false});
 });
 it('verifies Sabre Not Flown / I coupons with all original association and financial checks',()=>{
  const source=raw();Object.assign(source.flightTickets[0]!.flightCoupons[0]!,{couponStatus:'Not Flown',couponStatusCode:'I'});
  Object.assign(source.flightTickets[0]!,{allCoupons:[{itemId:'1',couponStatus:'Not Flown',couponStatusCode:'I'}]});
  expect(verifyTicketDocuments(context(source),expected)).toMatchObject({verification:'VERIFIED',pccScope:'PCC_CONFIRMED'});
  source.flightTickets[0]!.payment.total='6050.00';
  expect(verifyTicketDocuments(context(source),expected).reasons).toContain('DOCUMENT_AMOUNT_OR_CURRENCY_MISMATCH');
 });
 it.each([undefined,'RF','V','IO'])('holds Not Flown with absent or inconsistent code %s',code=>{
  const source=raw();Object.assign(source.flightTickets[0]!.flightCoupons[0]!,{couponStatus:'Not Flown',couponStatusCode:code});
  expect(verifyTicketDocuments(context(source),expected)).toMatchObject({verification:'DOCUMENTS_INCOMPLETE',reasons:['DOCUMENT_SEGMENT_OR_COUPON_STATUS_MISMATCH']});
 });
 it.each(['pnr','passenger','segment','carrier','pcc','number','status','coupon','coupon-id','money','currency','missing-carrier','partial-passenger','duplicate-ticket'])('holds %s mismatches without inferring non-issuance',kind=>{
  const source=raw();let wanted={...expected};
  if(kind==='pnr')source.bookingId='DEF456';
  if(kind==='passenger')source.travelers[0]!.surname='Different';
  if(kind==='segment')source.flights[0]!.toAirportCode='CGP';
  if(kind==='carrier')source.flightTickets[0]!.airlineCode='MH';
  if(kind==='pcc')source.flightTickets[0]!.ticketingPcc='XX01';
  if(kind==='number')source.flightTickets[0]!.number='invalid';
  if(kind==='status')source.flightTickets[0]!.ticketStatusName='Voided';
  if(kind==='coupon')source.flightTickets[0]!.flightCoupons[0]!.couponStatus='Refunded';
  if(kind==='coupon-id')source.flightTickets[0]!.flightCoupons[0]!.itemId='2';
  if(kind==='money')source.flightTickets[0]!.payment.total='6050.00';
  if(kind==='currency')source.flightTickets[0]!.payment.currencyCode='USD';
  if(kind==='missing-carrier')wanted={...wanted,validatingCarrier:undefined};
  if(kind==='partial-passenger'){source.travelers.push({givenName:'Test',surname:'Second'});wanted={...wanted,passengerNames:['Test Passenger','Test Second']};}
  if(kind==='duplicate-ticket')source.flightTickets.push(source.flightTickets[0]!);
  const result=verifyTicketDocuments(context(source),wanted);
  expect(result.verification).not.toBe('VERIFIED');expect(result.automaticRetry).toBe(false);expect(result.reasons.length).toBeGreaterThan(0);
 });
 it.each(['empty','omitted','warnings','malformed-warning','malformed-errors'])('handles %s document response conservatively',kind=>{
  const source:Record<string,unknown>={...raw(),isTicketed:false,flightTickets:[]};
  if(kind==='omitted')delete source.flightTickets;
  if(kind==='warnings')source.warnings=[{category:'PROCESSING_WARNING',type:'UNABLE_TO_RETRIEVE_TICKETS',description:'Private passenger details'}];
  if(kind==='malformed-warning')source.warnings={};
  if(kind==='malformed-errors')source.errors='';
  const result=verifyTicketDocuments(context(source),expected);
  expect(result.verification).toBe(['empty','omitted'].includes(kind)?'NO_TICKETS_REPORTED':'DOCUMENTS_INCOMPLETE');
  expect(result.automaticRetry).toBe(false);
 });
 it('restarts reconciliation without dispatching and accepts later independently verified visibility',async()=>{
  const getIssuedTicketContext=vi.fn().mockResolvedValueOnce(context({...raw(),isTicketed:false,flightTickets:[]})).mockResolvedValueOnce(context(raw()));
  const mutation=vi.fn(()=>{throw Error('Forbidden fixture mutation');});
  const port={getIssuedTicketContext,fulfillFlightTickets:mutation,cancelBooking:mutation,createBooking:mutation};
  expect((await new FlightTicketReconciliationService(port).inspect(expected)).verification).toBe('NO_TICKETS_REPORTED');
  expect((await new FlightTicketReconciliationService(port).inspect(expected)).verification).toBe('VERIFIED');
  expect(getIssuedTicketContext).toHaveBeenCalledTimes(2);expect(mutation).not.toHaveBeenCalled();
 });
 it('recovers delayed document visibility using bounded read-only lookups',async()=>{
  const lookup=vi.fn().mockResolvedValueOnce(context({...raw(),isTicketed:false,flightTickets:[]})).mockResolvedValueOnce(context(raw()));
  const wait=vi.fn(async()=>{});
  const result=await new FlightTicketReconciliationService({getIssuedTicketContext:lookup},wait).recover(expected);
  expect(result).toMatchObject({verification:'VERIFIED',recovery:{lookupCount:2,checks:[{verification:'NO_TICKETS_REPORTED'},{verification:'VERIFIED'}]},automaticRetry:false});
  expect(wait).toHaveBeenCalledExactlyOnceWith(1500);expect(lookup).toHaveBeenCalledTimes(2);
 });
 it('stops after three empty reads and never interprets absence as permission to issue again',async()=>{
  const lookup=vi.fn().mockResolvedValue(context({...raw(),isTicketed:false,flightTickets:[]})),wait=vi.fn(async()=>{});
  const result=await new FlightTicketReconciliationService({getIssuedTicketContext:lookup},wait).recover(expected);
  expect(result).toMatchObject({verification:'NO_TICKETS_REPORTED',reasons:['ABSENCE_DOES_NOT_ESTABLISH_NON_ISSUANCE'],recovery:{lookupCount:3},automaticRetry:false});
  expect(wait.mock.calls).toEqual([[1500],[3000]]);expect(lookup).toHaveBeenCalledTimes(3);
 });
 it.each(['unavailable','identity','partial'])('stops recovery on %s evidence for staff review',async kind=>{
  const source=raw();if(kind==='identity')source.bookingId='DEF456';if(kind==='partial')source.flightTickets[0]!.payment.total='101.00';
  const lookup=kind==='unavailable'?vi.fn().mockRejectedValue(Error('private details')):vi.fn().mockResolvedValue(context(source));
  const wait=vi.fn(async()=>{});
  const result=await new FlightTicketReconciliationService({getIssuedTicketContext:lookup},wait).recover(expected);
  expect(result.verification).not.toBe('VERIFIED');expect(result.recovery?.lookupCount).toBe(1);expect(lookup).toHaveBeenCalledOnce();expect(wait).not.toHaveBeenCalled();
 });
 it.each(['unassociated','refunded'])('retains review for %s all-coupon evidence',kind=>{
  const source=raw();Object.assign(source.flightTickets[0]!,{allCoupons:[{...(kind==='unassociated'?{}:{itemId:'1'}),couponStatus:kind==='refunded'?'Refunded':'Okay'}]});
  expect(verifyTicketDocuments(context(source),expected)).toMatchObject({verification:'DOCUMENTS_INCOMPLETE',automaticRetry:false});
 });
 it('records unavailable lookup without leaking supplier exception data',async()=>{
  const port={getIssuedTicketContext:vi.fn().mockRejectedValue(Error('token secret passenger passport'))};
  const result=await new FlightTicketReconciliationService(port).inspect(expected);
  expect(result).toMatchObject({verification:'LOOKUP_UNAVAILABLE',automaticRetry:false});
  expect(JSON.stringify(result)).not.toMatch(/token|secret|passenger|passport/);
 });
 it('never treats an unscoped sales absence as proof of non-issuance',()=>{
  const sales=readDailySalesEvidence({Header:{Results:{Success:''}},'@_isQueryStillRunning':'false',DailySalesReport:{ReportDate:'2026-10-24',Transaction:[]}},{pcc:'BD01',airline:'BG',date:'2026-10-24',pnr:'ABC123'});
  expect(sales).toMatchObject({complete:false,reasons:['PCC_NOT_CONFIRMED'],matchedDocuments:[],automaticRetryAllowed:false});
 });
});
