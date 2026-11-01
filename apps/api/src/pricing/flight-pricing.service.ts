import {Inject,Injectable} from '@nestjs/common';
import type {DatabaseConnection} from '@flyseri/database';
import type {FlightBooking,FlightBookingIntent,FlightOffer} from '@flyseri/types';
import {DATABASE_CONNECTION} from '../tokens.js';
import {ApiException} from '../api-exception.js';
import {calculateAncillaryPrice} from './ancillary-pricing.contract.js';
import type {AdminIdentity} from '../admin/admin-auth.js';
import {pricingRules,readRetailPricing,sellingOffer,calculateFlightPrice,priceMinor,priceAmount,type FlightPricingPolicy,type FlightRetailPricing} from './flight-pricing.contract.js';

@Injectable()
export class FlightPricingService{
 constructor(@Inject(DATABASE_CONNECTION) private readonly connection:DatabaseConnection|undefined){}
 async policy():Promise<FlightPricingPolicy&{available:boolean}>{
  if(!this.connection)return {revision:0,rules:[],available:false};
  try{const result=await this.connection.pool.query('SELECT revision,rules FROM flight_pricing_policies ORDER BY revision DESC LIMIT 1');const row=result.rows[0];return {revision:row?.revision??0,rules:pricingRules(row?.rules??[]),available:true};}
  catch(error){if((error as {code?:string}).code==='42P01')return {revision:0,rules:[],available:false};throw new ApiException('DEPENDENCY_UNAVAILABLE','Flight pricing rules could not be verified. Please try again.',503);}
 }
 async save(revision:number,value:unknown,staff:AdminIdentity,requestId:string){
  if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A pricing administrator must publish these rules.',403);
  if(!Number.isInteger(revision)||revision<0)throw new ApiException('VALIDATION_ERROR','Refresh the pricing revision.',400);
  let rules;try{rules=pricingRules(value);}catch(error){throw new ApiException('VALIDATION_ERROR',(error as Error).message,400);}
  if(!this.connection||(await this.policy()).available!==true)throw new ApiException('DEPENDENCY_UNAVAILABLE','The protected pricing migration must be applied before saving rules.',503);
  const client=await this.connection.pool.connect();
  try{
   await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(73188436)");
   const current=(await client.query('SELECT revision FROM flight_pricing_policies ORDER BY revision DESC LIMIT 1')).rows[0]?.revision??0;
   if(current!==revision)throw new ApiException('CONFLICT','Another administrator changed pricing. Reload before publishing.',409);
   const row=(await client.query('INSERT INTO flight_pricing_policies(revision,rules,created_by_staff_id) VALUES($1,$2::jsonb,$3) RETURNING id',[current+1,JSON.stringify(rules),staff.staffUserId])).rows[0];
   await client.query("INSERT INTO admin_audit_events(staff_user_id,staff_role,event,resource_type,resource_id,request_id) VALUES($1,$2,'flight.pricing.published','flight_pricing_policy',$3,$4)",[staff.staffUserId,staff.role,row.id,requestId]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return this.policy();
 }
 async snapshot(customerId:string,intentId:string,supplierTotal:string,currency:string):Promise<FlightRetailPricing|null>{
  if(!this.connection)return null;
  const row=(await this.connection.pool.query('SELECT search_request_snapshot FROM flight_booking_intents WHERE id=$1 AND customer_id=$2',[intentId,customerId])).rows[0];
  return readRetailPricing(row?.search_request_snapshot?.retailPricing,supplierTotal,currency);
 }
 async intent(customerId:string,intent:FlightBookingIntent):Promise<FlightBookingIntent>{
  const pricing=await this.snapshot(customerId,intent.id,intent.validatedTotalAmount??intent.searchTotalAmount,intent.currency);
  if(!pricing)return intent;
  return {...intent,selectedOffer:sellingOffer(intent.selectedOffer,pricing),searchTotalAmount:pricing.sellingTotal,validatedTotalAmount:intent.validatedTotalAmount?pricing.sellingTotal:null};
 }
 async booking(customerId:string,booking:FlightBooking|null):Promise<FlightBooking|null>{
  if(!booking)return null;
  if(booking.ancillaryPurchase&&this.connection){
   const history=await this.connection.pool.query("SELECT c.status,c.result,c.quote FROM flight_servicing_cases c JOIN flight_bookings b ON b.id=c.booking_id WHERE c.booking_id=$1 AND b.customer_id=$2 AND c.result->>'scope'='ANCILLARY' ORDER BY c.updated_at DESC LIMIT 100",[booking.id,customerId]);
   booking={...booking,ancillaryPurchase:{...booking.ancillaryPurchase,items:booking.ancillaryPurchase.items.map(item=>{
    const state=history.rows.find(row=>row.result?.requestId===item.requestId&&row.status!=='CANCELLED');
    return state?{...item,refundStatus:state.status==='COMPLETED'?'REFUNDED' as const:state.result?.airlineCompleted?'PENDING' as const:'REVIEW' as const,...(state.status==='COMPLETED'?{refundedAmount:String(state.quote?.refundAmount??'0.00')}:{})}:item;
   })}};
  }
  const pricing=await this.snapshot(customerId,booking.bookingIntentId,booking.amount,booking.currency);
  if(!pricing)return booking;
  const extra=booking.ancillaryPurchase;
  return {...booking,amount:pricing.sellingTotal,selectedOffer:sellingOffer(booking.selectedOffer,pricing),...(extra?{ancillaryPurchase:{...extra,airfareAmount:pricing.sellingTotal,totalAmount:priceAmount(priceMinor(pricing.sellingTotal)+priceMinor(extra.extrasAmount))}}:{})};
 }
 preview(raw:unknown){
  const value=raw as {rule?:unknown;baseFare?:unknown;taxes?:unknown;passengers?:unknown;currency?:unknown};
  try{const rule=pricingRules([value.rule])[0]!;if(rule.product&&rule.product!=='FLIGHT'){
   if(priceMinor(String(value.taxes??''))!==0n||Number(value.passengers)!==1)throw Error('Preview one selected extra at a time, including its taxes in the airline amount.');
   const result=calculateAncillaryPrice(String(value.baseFare??''),String(value.currency),rule,0);
   return {...result,supplierBase:result.supplierAmount,incentiveAmount:'0.00',discountedBase:result.supplierAmount,supplierTaxes:'0.00'};
  }return calculateFlightPrice({baseFare:String(value.baseFare??''),taxes:String(value.taxes??''),passengers:Number(value.passengers),currency:String(value.currency)},rule);}
  catch(error){throw new ApiException('VALIDATION_ERROR',(error as Error).message,400);}
 }
}
