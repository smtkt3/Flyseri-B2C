import {and,desc,eq,inArray} from 'drizzle-orm';
import {flightBookings,flightServicingCases,orders,payments,type DatabaseConnection} from '@flyseri/database';
import type {FlightExchangeQuotation} from '@flyseri/types';

type QuotationRow = {
  record: Pick<typeof flightServicingCases.$inferSelect,'id'|'bookingId'|'kind'|'status'|'result'>;
  order: typeof orders.$inferSelect;
  bookingCustomerId: string;
  paymentStatus: string | null;
};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const cents=(value:unknown)=>typeof value==='string'&&/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)?BigInt(value.split('.')[0]!)*100n+BigInt((value.split('.')[1]??'').padEnd(2,'0')):null;
export function customerExchangeQuotation(row:QuotationRow,now=Date.now(),preview=false):FlightExchangeQuotation|null {
  const {record,order}=row,state=object(record.result),offer=object(state.exchangeOffer);
  const paid=order.status==='PAID'&&!!order.paidAt&&row.paymentStatus==='SUCCEEDED';
  const total=cents(order.totalAmount);
  const sentAt=typeof state.customerQuoteSentAt==='string'&&Number.isFinite(Date.parse(state.customerQuoteSentAt))?state.customerQuoteSentAt:null;
  if(record.kind!=='EXCHANGE'||order.flightServicingCaseId!==record.id||order.customerId!==row.bookingCustomerId||state.collectionOrderId!==order.id||!sentAt&&!paid&&!preview||offer.chargeType!=='Add collect'||offer.currency!==order.currency||total===null||total<=0n||cents(offer.amount)!==total||cents(order.discountAmount)!==0n)return null;
  if(!Array.isArray(offer.flights)||!offer.flights.length||offer.flights.length>16)return null;
  const flights:FlightExchangeQuotation['flights']=[];
  for(const raw of offer.flights){
    const flight=object(raw),keys=['airline','number','origin','destination','departureDate','departureTime','arrivalDate','arrivalTime'] as const;
    if(keys.some(key=>typeof flight[key]!=='string')||!/^[A-Z0-9]{2,3}$/.test(String(flight.airline))||!/^\d{1,4}$/.test(String(flight.number))||!['origin','destination'].every(key=>/^[A-Z]{3}$/.test(String(flight[key])))||!['departureDate','arrivalDate'].every(key=>/^\d{4}-\d{2}-\d{2}$/.test(String(flight[key]))&&Number.isFinite(Date.parse(String(flight[key]))))||!['departureTime','arrivalTime'].every(key=>/^\d{2}:\d{2}(:\d{2})?$/.test(String(flight[key]))))return null;
    flights.push(Object.fromEntries(keys.map(key=>[key,flight[key]])) as FlightExchangeQuotation['flights'][number]);
  }
  const deadline=order.expiresAt?.getTime(),airlineDeadline=typeof offer.airlineExpiresAt==='string'?Date.parse(offer.airlineExpiresAt):Infinity;
  const expires=deadline===undefined?NaN:Math.min(deadline,airlineDeadline);
  let status:FlightExchangeQuotation['status']='REVIEW_REQUIRED';
  if(paid)status=record.status==='COMPLETED'&&state.stage==='COMPLETED'&&order.fulfillmentStatus==='COMPLETED'?'COMPLETED':'PAID';
  else if(record.status==='EXECUTING'&&state.stage==='EXCHANGE_PAYMENT_PENDING'&&state.exchangePrepared&&Array.isArray(state.pqrs)&&state.pqrs.length){
    if(!Number.isFinite(expires)||expires<=now||['EXPIRED','CANCELLED'].includes(order.status))status='EXPIRED';
    else if(['CREATED','PENDING','PROCESSING','UNKNOWN'].includes(row.paymentStatus??''))status='PAYMENT_PROCESSING';
    else if(['PENDING_PAYMENT','PAYMENT_FAILED'].includes(order.status))status='PAYMENT_REQUIRED';
  }
  return {id:record.id,bookingId:record.bookingId,orderId:order.id,orderNumber:order.orderNumber,amount:order.totalAmount,currency:order.currency,sentAt,expiresAt:Number.isFinite(expires)?new Date(expires).toISOString():null,status,flights};
}

export async function customerExchangeQuotations(connection:DatabaseConnection,customerId:string,filter:{bookingIds?:string[];orderId?:string}={}) {
  if(filter.bookingIds&&!filter.bookingIds.length)return [];
  const rows=await connection.db.select({record:flightServicingCases,order:orders,bookingCustomerId:flightBookings.customerId,paymentStatus:payments.status})
    .from(orders).innerJoin(flightServicingCases,eq(flightServicingCases.id,orders.flightServicingCaseId))
    .innerJoin(flightBookings,eq(flightBookings.id,flightServicingCases.bookingId)).leftJoin(payments,eq(payments.orderId,orders.id))
    .where(and(eq(orders.customerId,customerId),eq(flightBookings.customerId,customerId),eq(flightServicingCases.kind,'EXCHANGE'),filter.orderId?eq(orders.id,filter.orderId):undefined,filter.bookingIds?inArray(flightBookings.id,filter.bookingIds):undefined))
    .orderBy(desc(orders.createdAt)).limit(100);
  return rows.flatMap(row=>{const quotation=customerExchangeQuotation(row);return quotation?[quotation]:[];});
}
