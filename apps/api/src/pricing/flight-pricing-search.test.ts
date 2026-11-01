import {describe,it,expect,vi} from 'vitest';
import {parseConfig} from '@flyseri/config';
import type {FlightOffer} from '@flyseri/types';
import {FlightService} from '../flight/flight.service.js';
import {FlightTelemetry} from '../flight/flight.telemetry.js';
import type {FlightPricingService} from './flight-pricing.service.js';
import type {FlightPricingRule} from './flight-pricing.contract.js';
const rule:FlightPricingRule={id:'bg',name:'BG pricing',enabled:true,priority:10,currency:'BDT',airlines:['BG'],flightNumbers:[],origins:[],destinations:[],cabin:'ANY',travelFrom:null,travelTo:null,incentiveBps:700,fixedAmount:'500',chargeBps:0,chargeBasis:'DISCOUNTED_BASE',fixedUnit:'PASSENGER'};
describe('retail flight search and immutable selection',()=>{
 it('prices search and cached-calendar results while retaining supplier fares and the selected revision server-side',async()=>{
  const day=new Date(Date.now()+86400000*20).toISOString().slice(0,10);
  const offer:FlightOffer={offerId:'11111111-1111-4111-8111-111111111111',totalAmount:'12000',currency:'BDT',priceBreakdown:{baseFareAmount:'10000',taxesAndFeesAmount:'2000',currency:'BDT'},airlineCodes:['BG'],baggageSummary:null,inbound:null,outbound:{durationMinutes:60,stops:0,segments:[{origin:'DAC',destination:'CXB',departureAt:day+'T08:00:00+06:00',arrivalAt:day+'T09:00:00+06:00',marketingCarrier:'BG',flightNumber:'433',durationMinutes:60,bookingClass:'T'}]}};
  let policy={revision:1,rules:[rule]};const pricing={policy:vi.fn(async()=>policy)};
  const provider={search:vi.fn(async()=>[offer])};
  const service=new FlightService(parseConfig({APP_ENV:'test'}),undefined,undefined,provider,new FlightTelemetry({info:vi.fn()} as never),pricing as unknown as FlightPricingService);
  const search={origin:'DAC',destination:'CXB',departureDate:day,adults:1,children:0,infants:0,tripType:'ONE_WAY' as const,cabin:'ECONOMY' as const,currency:'BDT'};
  const first=await service.search(null,'test',search);expect(first.offers[0]?.totalAmount).toBe('11800.00');expect(JSON.stringify(first)).not.toMatch(/incentiveBps|retailPricing|supplierTotal/);
  policy={revision:2,rules:[{...rule,fixedAmount:'1000'}]};
  const selection=await service.selectedOffer(null,first.searchId,first.offers[0]!.offerId);expect(selection.offer.totalAmount).toBe('12000');expect(selection.retailPricing).toMatchObject({revision:1,sellingTotal:'11800.00'});
  const next=await service.search(null,'second',search);expect(next.offers[0]?.totalAmount).toBe('12300.00');expect(provider.search).toHaveBeenCalledOnce();expect(offer.totalAmount).toBe('12000');
  const calendar=await service.calendarCachedFares(search,day.slice(0,7),'departure',false,[day]);expect(calendar[0]?.amount).toBe(12300);
 });
});
