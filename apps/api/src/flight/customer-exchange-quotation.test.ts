import {describe,it,expect} from 'vitest';
import {customerExchangeQuotation} from './customer-exchange-quotation.js';
const now=Date.parse('2026-10-29T08:00:00Z');
const fixture=()=>({record:{id:'case-1',bookingId:'booking-1',kind:'EXCHANGE',status:'EXECUTING',result:{collectionOrderId:'order-1',customerQuoteSentAt:'2026-10-29T07:59:00Z',stage:'EXCHANGE_PAYMENT_PENDING',exchangePrepared:{fingerprint:'verified'},pqrs:[{id:'2'}],exchangeOffer:{chargeType:'Add collect',amount:'1000',currency:'BDT',airlineExpiresAt:'2026-10-29T08:20:00Z',flights:[{airline:'BG',number:'437',origin:'DAC',destination:'CXB',departureDate:'2026-12-11',departureTime:'15:45',arrivalDate:'2026-12-11',arrivalTime:'17:00',privateSupplierField:'do not expose'}]},privateNote:'never expose'}},order:{id:'order-1',orderNumber:'SMEX-1',flightServicingCaseId:'case-1',customerId:'customer-1',status:'PENDING_PAYMENT',currency:'BDT',totalAmount:'1000.00',discountAmount:'0.00',paidAt:null,fulfillmentStatus:'NOT_STARTED',expiresAt:new Date('2026-10-29T08:30:00Z')},bookingCustomerId:'customer-1',paymentStatus:null});
const project=(row=fixture())=>customerExchangeQuotation(row as never,now);
describe('customer exchange quotation',()=>{
 it('publishes only the allowed flight, total and checkout identity fields with the earliest deadline',()=>{
  const quote=project()!;expect(quote).toMatchObject({orderId:'order-1',amount:'1000.00',status:'PAYMENT_REQUIRED',expiresAt:'2026-10-29T08:20:00.000Z'});
  expect(JSON.stringify(quote)).not.toMatch(/private|fingerprint|pqrs|customer-1/);
 });
 it('hides unsent quotations and rejects wrong ownership, case, total and currency',()=>{
  const row=fixture();delete (row.record.result as Partial<typeof row.record.result>).customerQuoteSentAt;expect(project(row)).toBeNull();
  for(const change of [{customerId:'other'},{flightServicingCaseId:'other'},{totalAmount:'2000'},{currency:'USD'},{discountAmount:'1'}]){const altered=fixture();Object.assign(altered.order,change);expect(project(altered)).toBeNull();}
 });
 it('does not offer payment for uncertain supplier states, expired fares or existing payment attempts',()=>{
  const row=fixture();row.record.status='OUTCOME_UNKNOWN';expect(project(row)?.status).toBe('REVIEW_REQUIRED');
  row.record.status='EXECUTING';row.order.expiresAt=new Date(now);expect(project(row)?.status).toBe('EXPIRED');
  const pending=fixture();(pending as {paymentStatus:string|null}).paymentStatus='UNKNOWN';expect(project(pending)?.status).toBe('PAYMENT_PROCESSING');
 });
 it('retains paid history after expiry and marks completed reissue without requesting another payment',()=>{
  const row=fixture();Object.assign(row.order,{status:'PAID',paidAt:new Date(now),expiresAt:new Date(now-1)});(row as {paymentStatus:string|null}).paymentStatus='SUCCEEDED';
  expect(project(row)?.status).toBe('PAID');row.record.status='COMPLETED';row.record.result.stage='COMPLETED';row.order.fulfillmentStatus='COMPLETED';expect(project(row)?.status).toBe('COMPLETED');
 });
});
