import {describe,it,expect} from 'vitest';
import {ancillaryPrice,calculateAncillaryPrice,ancillaryRefundAmount,publicAncillaryRequest,verifiedAncillaryPricing} from './ancillary-pricing.contract.js';
import {pricingRules,retailFlightPrice} from './flight-pricing.contract.js';
import type {FlightPricingRule} from './flight-pricing.contract.js';
import type {FlightOffer} from '@flyseri/types';
const bag:FlightPricingRule={id:'bag',name:'Extra bag',enabled:true,priority:10,currency:'BDT',airlines:['BG'],flightNumbers:[],origins:[],destinations:[],cabin:'ANY',travelFrom:null,travelTo:null,chargeBasis:'ORIGINAL_BASE',fixedUnit:'PASSENGER',product:'BAGGAGE',incentiveBps:0,fixedAmount:'50',chargeBps:500,refundCharge:true};
const offer={currency:'BDT',totalAmount:'10000',outbound:{segments:[{origin:'DAC',destination:'CXB',marketingCarrier:'BG',flightNumber:'433',departureAt:'2026-12-10T09:00:00'}]},inbound:null} as FlightOffer;
const service={offerItemId:null,name:'EXTRA BAG',serviceCode:'0AA',groupCode:'BG',amount:'1000',currency:'BDT',segmentLabels:['DAC → CXB · BG 433'],passengerIndexes:[0]};
describe('frozen ancillary charges',()=>{
 it('matches product, airline and service codes separately from airfare',()=>{
  const policy={revision:3,rules:[bag]};expect(ancillaryPrice(service,offer,'ECONOMY',policy)).toMatchObject({supplierAmount:'1000.00',chargeAmount:'100.00',sellingTotal:'1100.00'});
  expect(ancillaryPrice({...service,serviceCode:'0AB'},offer,'ECONOMY',{revision:1,rules:[{...bag,serviceCodes:['0AA']}]})).toBeUndefined();
  expect(retailFlightPrice(offer,{adults:1,children:0,infants:0,cabin:'ECONOMY'},policy)).toBeNull();
 });
 it('keeps free services free, never applies airfare incentives and supports decimal rounding',()=>{
  expect(calculateAncillaryPrice('0','BDT',bag,1).sellingTotal).toBe('0.00');
  expect(calculateAncillaryPrice('0.10','BDT',{...bag,fixedAmount:'0',chargeBps:500},1).chargeAmount).toBe('0.01');
  expect(()=>pricingRules([{...bag,incentiveBps:700}])).toThrow();expect(()=>pricingRules([{...bag,fixedUnit:'BOOKING'}])).toThrow();
 });
 it('refunds the charge with the extra, proportionally for partial supplier refunds',()=>{
  const snapshot=calculateAncillaryPrice('1000','BDT',bag,1);
  expect(ancillaryRefundAmount(snapshot,'1000')).toEqual({supplierRefund:'1000.00',chargeRefund:'100.00',customerRefund:'1100.00'});
  expect(ancillaryRefundAmount(snapshot,'500').customerRefund).toBe('550.00');
  expect(()=>ancillaryRefundAmount(snapshot,'1000.01')).toThrow();
 });
 it('strips private policy metadata and rejects tampering',()=>{
  const snapshot=calculateAncillaryPrice('1000','BDT',bag,1);
  const result=publicAncillaryRequest({...service,id:'one',category:'BAGGAGE',status:'REQUESTED',ancillaryPricing:snapshot} as never);
  expect(result).toMatchObject({amount:'1100.00',serviceCharge:'100.00',chargeRefundable:true});expect(result).not.toHaveProperty('ancillaryPricing');
  expect(()=>verifiedAncillaryPricing({...snapshot,chargeAmount:'0'})).toThrow();
 });
});
