import {describe,it,expect} from 'vitest';
import {pricingRules,calculateFlightPrice,retailFlightPrice,readRetailPricing,sellingOffer,type FlightPricingRule} from './flight-pricing.contract.js';
import type {FlightOffer} from '@flyseri/types';
export const rule:FlightPricingRule={id:'bg-default',name:'BG base fare incentive',enabled:true,priority:10,currency:'BDT',airlines:['BG'],flightNumbers:[],origins:[],destinations:[],cabin:'ANY',travelFrom:null,travelTo:null,incentiveBps:700,fixedAmount:'500',chargeBps:0,chargeBasis:'DISCOUNTED_BASE',fixedUnit:'PASSENGER'};
const search={adults:2,children:0,infants:0,cabin:'ECONOMY' as const};
const offer={offerId:'test',currency:'BDT',totalAmount:'24000',priceBreakdown:{baseFareAmount:'20000',taxesAndFeesAmount:'4000',currency:'BDT'},outbound:{segments:[{marketingCarrier:'BG',flightNumber:'433',origin:'DAC',destination:'CXB',departureAt:'2026-12-10T08:00:00+06:00'}]},inbound:null,airlineCodes:['BG']} as FlightOffer;
describe('flight incentive and retail pricing',()=>{
 it('deducts 7 percent only from the untaxed fare and adds BDT 500 per passenger',()=>{
  const result=retailFlightPrice(offer,search,{revision:3,rules:[rule]})!;
  expect(result).toMatchObject({supplierTotal:'24000.00',supplierTaxes:'4000.00',incentiveAmount:'1400.00',discountedBase:'18600.00',chargeAmount:'1000.00',sellingTotal:'23600.00',revision:3});
 });
 it('applies 5 percent to the discounted base, excluding tax, and supports a fixed charge as well',()=>{
  expect(calculateFlightPrice({baseFare:'10000',taxes:'2000',passengers:1,currency:'BDT'},{...rule,fixedAmount:'0',chargeBps:500}).sellingTotal).toBe('11765.00');
  expect(calculateFlightPrice({baseFare:'10000',taxes:'2000',passengers:1,currency:'BDT'},{...rule,chargeBps:500}).sellingTotal).toBe('12265.00');
 });
 it('supports per-booking fixed charges and explicit alternative percentage bases',()=>{
  const input={baseFare:'20000',taxes:'4000',passengers:2,currency:'BDT'};
  expect(calculateFlightPrice(input,{...rule,fixedUnit:'BOOKING'}).sellingTotal).toBe('23100.00');
  expect(calculateFlightPrice(input,{...rule,fixedAmount:'0',chargeBps:500,chargeBasis:'DISCOUNTED_TOTAL'}).chargeAmount).toBe('1130.00');
 });
 it('uses one priority rule, with a specific flight winning at equal priority, without stacking',()=>{
  const specific={...rule,id:'bg433',flightNumbers:['433'],fixedAmount:'200'};
  expect(retailFlightPrice(offer,search,{revision:1,rules:[rule,specific]})?.chargeAmount).toBe('400.00');
  expect(retailFlightPrice(offer,search,{revision:1,rules:[{...rule,priority:20},specific]})?.chargeAmount).toBe('1000.00');
 });
 it('matches bulk airlines, route, cabin and dates; round-trip destination uses the outbound destination',()=>{
  expect(retailFlightPrice(offer,search,{revision:1,rules:[{...rule,airlines:['BG','MH'],origins:['DAC'],destinations:['CXB'],travelFrom:'2026-12-10',travelTo:'2026-12-10'}]})).toBeTruthy();
  expect(retailFlightPrice(offer,search,{revision:1,rules:[{...rule,airlines:['MH']}]})).toBeNull();
  expect(retailFlightPrice(offer,search,{revision:1,rules:[{...rule,travelFrom:'2026-12-11'}]})).toBeNull();
  const roundTrip={...offer,inbound:{segments:[{...offer.outbound.segments[0]!,origin:'CXB',destination:'DAC'}]}} as FlightOffer;
  expect(retailFlightPrice(roundTrip,search,{revision:1,rules:[{...rule,destinations:['CXB']}]})).toBeTruthy();
 });
 it('requires matching base and tax currency and never estimates a missing breakdown',()=>{
  expect(()=>retailFlightPrice({...offer,priceBreakdown:undefined},search,{revision:1,rules:[rule]})).toThrow(/verified base fare/);
  expect(()=>retailFlightPrice({...offer,priceBreakdown:{...offer.priceBreakdown!,taxesAndFeesAmount:'1'}},search,{revision:1,rules:[rule]})).toThrow();
 });
 it('freezes the accepted rule, rejects supplier price changes and detects snapshot tampering',()=>{
  const value=retailFlightPrice(offer,search,{revision:1,rules:[rule]})!;
  expect(readRetailPricing(value,'24000','BDT')).toEqual(value);
  expect(()=>readRetailPricing(value,'25000','BDT')).toThrow();
  expect(()=>readRetailPricing({...value,sellingTotal:'1.00'},'24000','BDT')).toThrow();
  const shown=sellingOffer(offer,value);expect(shown.totalAmount).toBe('23600.00');expect(shown.priceBreakdown?.baseFareAmount).toBe('19600.00');expect(shown).not.toHaveProperty('incentiveAmount');expect(offer.totalAmount).toBe('24000');
 });
 it('validates exact percentages, unique rules, selector codes and explicit calculation options',()=>{
  expect(pricingRules([rule])).toEqual([rule]);
  for(const bad of [{...rule,incentiveBps:10001},{...rule,chargeBps:5.5},{...rule,fixedAmount:'-1'},{...rule,flightNumbers:['433'],airlines:[]},{...rule,airlines:['bg']},{...rule,travelTo:'2026-02-30'}])expect(()=>pricingRules([bad])).toThrow();
  expect(()=>pricingRules([rule,rule])).toThrow();
 });
 it('rejects a zero customer total before an offer reaches checkout',()=>{
  expect(()=>calculateFlightPrice({baseFare:'100',taxes:'0',passengers:1,currency:'BDT'},{...rule,incentiveBps:10000,fixedAmount:'0'})).toThrow(/greater than zero/);
 });
});
