import type {FlightAncillaryRequest,FlightAncillaryResponse,FlightOffer} from '@flyseri/types';
import {flightPricingRule,priceAmount,priceMinor,pricingRules,type FlightPricingPolicy,type FlightPricingRule} from './flight-pricing.contract.js';
import {convertCheckoutAmount,type CheckoutFx} from './checkout-fx.contract.js';
export type AncillaryRetailPricing={version:1;revision:number;rule:FlightPricingRule;supplierAmount:string;currency:string;chargeAmount:string;sellingTotal:string;refundCharge:boolean};
export type PricedAncillaryRequest=FlightAncillaryRequest&{ancillaryPricing?:AncillaryRetailPricing;checkoutFx?:CheckoutFx};
export function ancillaryCategory(service:Pick<FlightAncillaryRequest,'name'|'groupCode'>):FlightAncillaryRequest['category']{
 const name=service.name.toUpperCase().replace(/[^A-Z0-9]+/g,' '),group=service.groupCode;
 return group==='BG'?'BAGGAGE':group==='SA'?'SEATS':group==='ML'?'FOOD':group?'OTHER':/\b(BAGGAGE|LUGGAGE|BAG|BAGS|EXCESS WEIGHT|EXTRA WEIGHT|SPORTS EQUIPMENT)\b/.test(name)?'BAGGAGE':/\b(SEAT|SEATS|SEATING|LEGROOM|LEG ROOM)\b/.test(name)?'SEATS':/\b(MEAL|MEALS|FOOD|DRINK|DRINKS|BEVERAGE|BEVERAGES|SNACK|SNACKS|COFFEE|TEA|JUICE|WATER|COCONUTWATER|SODA|COLA|WINE|BEER|SANDWICH|CHICKEN|RICE|NOODLES|PASTA|BREAKFAST|LUNCH|DINNER|VEGETARIAN|VEGAN)\b/.test(name)?'FOOD':'OTHER';
}
export function calculateAncillaryPrice(supplierAmount:string,currency:string,rule:FlightPricingRule,revision:number):AncillaryRetailPricing{
 const original=priceMinor(supplierAmount);
 if(!rule.product||rule.product==='FLIGHT'||rule.currency!==currency||rule.incentiveBps!==0||rule.fixedUnit!=='PASSENGER')throw Error('A matching extra-service pricing rule is required.');
 const charge=original===0n?0n:priceMinor(rule.fixedAmount)+(original*BigInt(rule.chargeBps)+5000n)/10000n;
 return {version:1,revision,rule,supplierAmount:priceAmount(original),currency,chargeAmount:priceAmount(charge),sellingTotal:priceAmount(original+charge),refundCharge:rule.refundCharge!==false};
}
export function ancillaryPrice(service:FlightAncillaryResponse['services'][number],offer:FlightOffer,cabin:string,policy:FlightPricingPolicy){
 if(service.amount===null||!service.currency||service.rules?.requiresWeightConfirmation)return undefined;
 const category=ancillaryCategory(service),all=(offer.multiCityLegs??[offer.outbound,...(offer.inbound?[offer.inbound]:[])]).flatMap(leg=>leg.segments);
 const selected=all.filter(s=>service.segmentLabels.some(label=>label===`${s.origin} → ${s.destination} · ${s.marketingCarrier} ${s.flightNumber}`||label===`${s.origin} → ${s.destination} · ${s.marketingCarrier} ${s.flightNumber} · ${s.departureAt.slice(0,10)}`));
 if(!selected.length)return undefined;
 const scoped={...offer,currency:service.currency,outbound:{...offer.outbound,segments:selected},inbound:null,multiCityLegs:undefined};
 const candidates=policy.rules.filter(r=>r.product===category&&(!r.serviceCodes?.length||r.serviceCodes.includes(service.serviceCode))).map(r=>({...r,product:'FLIGHT' as const}));
 const match=flightPricingRule(scoped,{adults:1,children:0,infants:0,cabin:cabin as 'ECONOMY'},{revision:policy.revision,rules:candidates});
 const rule=match&&policy.rules.find(r=>r.id===match.id);return rule?calculateAncillaryPrice(service.amount,service.currency,rule,policy.revision):undefined;
}
export function verifiedAncillaryPricing(value:AncillaryRetailPricing|undefined){
 if(!value)return undefined;
 const rule=pricingRules([value.rule])[0]!,expected=calculateAncillaryPrice(value.supplierAmount,value.currency,rule,value.revision);
 if(value.version!==1||!Number.isInteger(value.revision)||value.revision<0||expected.sellingTotal!==value.sellingTotal||expected.chargeAmount!==value.chargeAmount||expected.refundCharge!==value.refundCharge)throw Error('The saved extra charge changed. Review the quote again.');
 return expected;
}
export function publicAncillaryRequest(request:FlightAncillaryRequest):FlightAncillaryRequest{
 const {ancillaryPricing,checkoutFx,...rest}=request as PricedAncillaryRequest,pricing=verifiedAncillaryPricing(ancillaryPricing);
 return pricing?{...rest,amount:pricing.sellingTotal,currency:pricing.currency,serviceCharge:pricing.chargeAmount,chargeRefundable:pricing.refundCharge}:checkoutFx&&request.amount!==null&&request.currency?{...rest,amount:convertCheckoutAmount(request.amount,request.currency,checkoutFx.to,checkoutFx),currency:checkoutFx.to}:rest;
}
/** A supplier-confirmed full item refund returns its charge once; partial
 * refunds return a proportional charge, capped by the original customer total. */
export function ancillaryRefundAmount(pricing:AncillaryRetailPricing,supplierRefund:string){
 const saved=verifiedAncillaryPricing(pricing)!,refund=priceMinor(supplierRefund),original=priceMinor(saved.supplierAmount);
 if(refund>original)throw Error('The supplier refund exceeds the purchased extra.');
 const charge=saved.refundCharge&&original>0n?(priceMinor(saved.chargeAmount)*refund+original/2n)/original:0n;
 return {supplierRefund:priceAmount(refund),chargeRefund:priceAmount(charge),customerRefund:priceAmount(refund+charge)};
}
