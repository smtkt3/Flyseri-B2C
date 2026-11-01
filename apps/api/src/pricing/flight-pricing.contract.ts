import type {FlightOffer,FlightSearchRequest} from '@flyseri/types';

export type FlightPricingRule={
 product?:'FLIGHT'|'BAGGAGE'|'SEATS'|'FOOD'|'OTHER';serviceCodes?:string[];refundCharge?:boolean;
 id:string;name:string;enabled:boolean;priority:number;currency:string;
 airlines:string[];flightNumbers:string[];origins:string[];destinations:string[];
 cabin:string;travelFrom:string|null;travelTo:string|null;
 incentiveBps:number;fixedAmount:string;chargeBps:number;
 chargeBasis:'DISCOUNTED_BASE'|'ORIGINAL_BASE'|'DISCOUNTED_TOTAL';fixedUnit:'PASSENGER'|'BOOKING';
};
export type FlightPricingPolicy={revision:number;rules:FlightPricingRule[]};
export type FlightRetailPricing={version:1;revision:number;rule:FlightPricingRule;passengers:number;currency:string;supplierTotal:string;supplierBase:string;supplierTaxes:string;incentiveAmount:string;discountedBase:string;chargeAmount:string;sellingTotal:string};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const priceMinor=(v:unknown):bigint=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(v))throw Error('Use a non-negative amount with up to two decimal places.');const [a,b='']=v.split('.');return BigInt(a!)*100n+BigInt(b.padEnd(2,'0'));};
export const priceAmount=(v:bigint)=>`${v/100n}.${String(v%100n).padStart(2,'0')}`;
const percent=(v:bigint,bps:number)=>(v*BigInt(bps)+5000n)/10000n;
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function pricingRules(value:unknown):FlightPricingRule[]{
 if(!Array.isArray(value)||value.length>200)throw Error('Use at most 200 pricing rules.');
 const ids=new Set<string>();
 return value.map(raw=>{
  const r=object(raw),required=['id','name','enabled','priority','currency','airlines','flightNumbers','origins','destinations','cabin','travelFrom','travelTo','incentiveBps','fixedAmount','chargeBps','chargeBasis','fixedUnit'],allowed=[...required,'product','serviceCodes','refundCharge'];
  if(Object.keys(r).some(key=>!allowed.includes(key))||required.some(key=>!(key in r))||typeof r.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(r.id)||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>100||typeof r.enabled!=='boolean'||!Number.isInteger(r.priority)||Number(r.priority)<0||Number(r.priority)>1000||typeof r.currency!=='string'||!['BDT','MYR','USD','EUR','GBP','SGD','AUD'].includes(r.currency))throw Error('Check the rule name, priority, currency and unique ID.');
  if(r.product!==undefined&&!['FLIGHT','BAGGAGE','SEATS','FOOD','OTHER'].includes(String(r.product))||r.refundCharge!==undefined&&typeof r.refundCharge!=='boolean'||r.serviceCodes!==undefined&&(!Array.isArray(r.serviceCodes)||r.serviceCodes.length>100||r.serviceCodes.some(v=>typeof v!=='string'||!/^[-A-Z0-9]{1,16}$/.test(v))||new Set(r.serviceCodes).size!==r.serviceCodes.length))throw Error('Check the pricing product, service codes and refund policy.');
  if(r.product&&r.product!=='FLIGHT'&&(r.incentiveBps!==0||r.fixedUnit!=='PASSENGER'))throw Error('Extra charges apply per selected service and traveler, without a fare incentive.');
  ids.add(r.id);
  for(const [key,pattern] of [['airlines',/^[A-Z0-9]{2,3}$/],['flightNumbers',/^\d{1,4}$/],['origins',/^[A-Z]{3}$/],['destinations',/^[A-Z]{3}$/]] as const){if(!Array.isArray(r[key])||(r[key] as unknown[]).length>100||(r[key] as unknown[]).some(v=>typeof v!=='string'||!pattern.test(v))||new Set(r[key] as string[]).size!==(r[key] as string[]).length)throw Error('Use unique airline, flight number and airport codes.');}
  if(typeof r.cabin!=='string'||!['ANY','ECONOMY','PREMIUM_ECONOMY','BUSINESS','FIRST'].includes(r.cabin)||r.travelFrom!==null&&!date(r.travelFrom)||r.travelTo!==null&&!date(r.travelTo)||r.travelFrom&&r.travelTo&&String(r.travelFrom)>String(r.travelTo))throw Error('Check cabin and travel dates.');
  if(![r.incentiveBps,r.chargeBps].every(v=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=10000)||!['DISCOUNTED_BASE','ORIGINAL_BASE','DISCOUNTED_TOTAL'].includes(String(r.chargeBasis))||!['PASSENGER','BOOKING'].includes(String(r.fixedUnit)))throw Error('Use percentages from 0 to 100 and a supported calculation basis.');
  priceMinor(r.fixedAmount);
  if((r.flightNumbers as string[]).length&&!(r.airlines as string[]).length)throw Error('Select an airline when targeting flight numbers.');
  return {...r,name:r.name.trim()} as FlightPricingRule;
 });
}
export function flightPricingRule(offer:FlightOffer,search:Pick<FlightSearchRequest,'adults'|'children'|'infants'|'cabin'>,policy:FlightPricingPolicy):FlightPricingRule|undefined{
 const segments=(offer.multiCityLegs??[offer.outbound,...(offer.inbound?[offer.inbound]:[])]).flatMap(leg=>leg.segments),first=segments[0]!,last=offer.outbound.segments.at(-1)!;
 const matching=policy.rules.filter(r=>(!r.product||r.product==='FLIGHT')&&r.enabled&&r.currency===offer.currency&&(!r.airlines.length||segments.every(s=>r.airlines.includes(s.marketingCarrier)))&&(!r.flightNumbers.length||segments.some(s=>r.airlines.includes(s.marketingCarrier)&&r.flightNumbers.some(number=>Number(number)===Number(s.flightNumber))))&&(!r.origins.length||r.origins.includes(first.origin))&&(!r.destinations.length||r.destinations.includes(last.destination))&&(r.cabin==='ANY'||r.cabin===search.cabin)&&(!r.travelFrom||first.departureAt.slice(0,10)>=r.travelFrom)&&(!r.travelTo||first.departureAt.slice(0,10)<=r.travelTo));
 const specificity=(r:FlightPricingRule)=>Number(!!r.serviceCodes?.length)*32+Number(!!r.flightNumbers.length)*16+Number(!!r.airlines.length)*8+Number(!!r.origins.length)*4+Number(!!r.destinations.length)*4+Number(r.cabin!=='ANY')*2+Number(!!r.travelFrom||!!r.travelTo);
 return matching.sort((a,b)=>b.priority-a.priority||specificity(b)-specificity(a)||a.id.localeCompare(b.id))[0];
}
export function calculateFlightPrice(input:{baseFare:string;taxes:string;passengers:number;currency:string},rule:FlightPricingRule,revision=0):FlightRetailPricing{
 const base=priceMinor(input.baseFare),taxes=priceMinor(input.taxes);
 if(rule.currency!==input.currency||!Number.isInteger(input.passengers)||input.passengers<1||input.passengers>9)throw Error('Check pricing currency and passenger count.');
 const incentive=percent(base,rule.incentiveBps),discounted=base-incentive;
 const basis=rule.chargeBasis==='ORIGINAL_BASE'?base:rule.chargeBasis==='DISCOUNTED_TOTAL'?discounted+taxes:discounted;
 const charge=priceMinor(rule.fixedAmount)*BigInt(rule.fixedUnit==='PASSENGER'?input.passengers:1)+percent(basis,rule.chargeBps);
 if(discounted+taxes+charge<=0n)throw Error('The customer flight price must be greater than zero.');
 return {version:1,revision,rule,passengers:input.passengers,currency:input.currency,supplierTotal:priceAmount(base+taxes),supplierBase:priceAmount(base),supplierTaxes:priceAmount(taxes),incentiveAmount:priceAmount(incentive),discountedBase:priceAmount(discounted),chargeAmount:priceAmount(charge),sellingTotal:priceAmount(discounted+taxes+charge)};
}
export function retailFlightPrice(offer:FlightOffer,search:Pick<FlightSearchRequest,'adults'|'children'|'infants'|'cabin'>,policy:FlightPricingPolicy):FlightRetailPricing|null{
 const rule=flightPricingRule(offer,search,policy);if(!rule)return null;
 const parts=offer.priceBreakdown;
 if(!parts||parts.currency!==offer.currency||priceMinor(parts.baseFareAmount)+priceMinor(parts.taxesAndFeesAmount)!==priceMinor(offer.totalAmount))throw Error('A verified base fare and tax breakdown is required for this pricing rule.');
 return calculateFlightPrice({baseFare:parts.baseFareAmount,taxes:parts.taxesAndFeesAmount,passengers:search.adults+search.children+search.infants,currency:offer.currency},rule,policy.revision);
}
export function readRetailPricing(value:unknown,supplierTotal:string,currency:string):FlightRetailPricing|null{
 if(value===undefined||value===null)return null;
 const s=object(value),rule=pricingRules([s.rule])[0]!;
 if(s.version!==1||!Number.isInteger(s.revision)||Number(s.revision)<0||s.currency!==currency||typeof s.supplierBase!=='string'||typeof s.supplierTaxes!=='string')throw Error('The saved pricing snapshot needs review.');
 const verified=calculateFlightPrice({baseFare:s.supplierBase,taxes:s.supplierTaxes,passengers:Number(s.passengers),currency},rule,Number(s.revision));
 if(priceMinor(verified.supplierTotal)!==priceMinor(supplierTotal)||['supplierTotal','incentiveAmount','discountedBase','chargeAmount','sellingTotal'].some(key=>s[key]!==verified[key as keyof FlightRetailPricing]))throw Error('The supplier fare or saved retail calculation changed. Refresh the fare and tax breakdown before booking.');
 return verified;
}
export function sellingOffer(offer:FlightOffer,pricing:FlightRetailPricing|null):FlightOffer{
 if(!pricing)return offer;
 return {...offer,totalAmount:pricing.sellingTotal,priceBreakdown:{baseFareAmount:priceAmount(priceMinor(pricing.sellingTotal)-priceMinor(pricing.supplierTaxes)),taxesAndFeesAmount:pricing.supplierTaxes,currency:pricing.currency}};
}
