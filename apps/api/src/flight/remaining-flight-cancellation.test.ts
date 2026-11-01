import {describe,it,expect,vi} from 'vitest';
import type {AppConfig} from '@flyseri/config';
import {SabreBookingManagementClient} from './sabre-booking-management.client.js';
const config={APP_ENV:'test',SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_PCC:'TEST',SABRE_REQUEST_TIMEOUT_MS:12000} as AppConfig;
const number='9971234567890';
const fixture=()=>({bookingId:'ABC123',travelers:[{givenName:'Synthetic',surname:'Test'}],allSegments:[{type:'FLIGHT',id:'12'}],flights:[{itemId:'12',sourceType:'ATPCO',flightStatusName:'Confirmed',airlineCode:'BG',flightNumber:433,fromAirportCode:'DAC',toAirportCode:'CXB',departureDate:'2026-12-10',departureTime:'08:00',arrivalDate:'2026-12-10',arrivalTime:'09:00'}],flightTickets:[{number,ticketingPcc:'TEST',ticketStatusName:'Voided',flightCoupons:[{itemId:'12'}]}]});
const client=(http:typeof fetch)=>new SabreBookingManagementClient(config,{token:async()=>'fixture'} as never,http);
describe('remaining-flight cancellation only',()=>{
 it('verifies terminal tickets and sends only the selected segment cancellation',async()=>{
  const http=vi.fn(async()=>new Response(JSON.stringify(fixture())));const api=client(http);
  const context=await api.getRemainingCancellationContext('ABC123','VOID',[number]);
  expect(context).toMatchObject({bookingId:'ABC123',flightIds:['12']});expect(context.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const wire=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));expect(body).toEqual({confirmationId:'ABC123',targetPcc:'TEST',cancelAll:false,flights:[{itemId:'12'}],retrieveBooking:true,errorHandlingPolicy:'HALT_ON_ERROR',receivedFrom:'Flyseri CERT approved segment recovery'});expect(body).not.toHaveProperty('flightTicketOperation');return new Response('{}');});
  await client(wire).cancelRemainingFlightSegments('ABC123',context.flightIds);expect(wire).toHaveBeenCalledOnce();
 });
 it.each(['ACTIVE_TICKET','OTHER_PCC','OTHER_TICKET','NDC','DUPLICATE_SEGMENT'])('rejects %s before exposing a cancellation plan',async(scenario)=>{
  const raw=fixture();if(scenario==='ACTIVE_TICKET')raw.flightTickets[0]!.ticketStatusName='Issued';
  if(scenario==='OTHER_PCC')raw.flightTickets[0]!.ticketingPcc='OTHR';if(scenario==='OTHER_TICKET')raw.flightTickets[0]!.number='9971234567891';
  if(scenario==='NDC')raw.flights[0]!.sourceType='NDC';if(scenario==='DUPLICATE_SEGMENT'){raw.flights.push(raw.flights[0]!);raw.allSegments.push(raw.allSegments[0]!);}
  const http=vi.fn(async()=>new Response(JSON.stringify(raw)));await expect(client(http).getRemainingCancellationContext('ABC123','VOID',[number])).rejects.toThrow();expect(http).toHaveBeenCalledOnce();
 });
 it('rejects duplicate or injected segment IDs without dispatch',async()=>{
  const http=vi.fn();await expect(client(http).cancelRemainingFlightSegments('ABC123',['12','12'])).rejects.toThrow();await expect(client(http).cancelRemainingFlightSegments('ABC123',['12;ET'])).rejects.toThrow();expect(http).not.toHaveBeenCalled();
 });
});
