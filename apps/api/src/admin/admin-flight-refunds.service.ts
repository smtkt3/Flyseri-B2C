import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { adminAuditEvents, commerceAuditEvents, flightBookings, flightServicingCases, flightServicingEvents, orders, payments, refunds, type DatabaseConnection } from '@flyseri/database';
import type { AppConfig } from '@flyseri/config';
import { APP_CONFIG, DATABASE_CONNECTION } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import { RefundBeforeSubmissionError, StripeTestRefundProvider, type RefundInput, type VerifiedRefund } from '../commerce/stripe-test-refund.provider.js';
import type { AdminIdentity } from './admin-auth.js';
import type { OperationQuote } from './admin-flight-operations.service.js';

const conflict=(message:string)=>new ApiException('CONFLICT',message,409);
const cents=(value:string)=>{if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw conflict('The recorded financial amount needs review.');const [whole,fraction='']=value.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));};
type State=Record<string,unknown>;

@Injectable()
export class AdminFlightRefundsService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(AdminFlightRefundsService.name);
  private timer:ReturnType<typeof setInterval>|null=null;
  private running=false;
  private stopped=false;
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection:DatabaseConnection|undefined,@Inject(APP_CONFIG) private readonly config:AppConfig){}
  private get db(){if(!this.connection)throw new ApiException('DEPENDENCY_UNAVAILABLE','Refund storage is unavailable.',503);return this.connection.db;}
  available(){return this.config.SABRE_ENV==='CERT'&&this.config.APP_ENV!=='production'&&this.config.FLIGHT_REFUND_SETTLEMENT_ENABLED==='true'&&this.config.PAYMENT_PROVIDER==='STRIPE_TEST'&&Boolean(this.config.STRIPE_SECRET_KEY?.startsWith('sk_test_'));}
  private provider(){if(!this.available())throw new ApiException('DEPENDENCY_UNAVAILABLE','Stripe sandbox refund settlement is disabled.',503);return new StripeTestRefundProvider(this.config);}
  onModuleInit(){if(!this.available()||!this.connection)return;this.timer=setInterval(()=>{void this.scan().catch(()=>this.logger.warn('Flight refund reconciliation is temporarily unavailable'));},30000);this.timer.unref();}
  onModuleDestroy(){this.stopped=true;if(this.timer)clearInterval(this.timer);}
  async settle(id:string,version:number,pnr:string|undefined,staff:AdminIdentity,requestId:string){
    if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must authorize a customer refund.',403);
    const provider=this.provider();
    const [linked]=await this.db.select({booking:flightBookings,orderId:orders.id,paymentId:payments.id}).from(flightServicingCases).innerJoin(flightBookings,eq(flightServicingCases.bookingId,flightBookings.id)).innerJoin(orders,eq(orders.bookingIntentId,flightBookings.bookingIntentId)).innerJoin(payments,eq(payments.orderId,orders.id)).where(eq(flightServicingCases.id,id)).limit(1);
    if(!linked)throw conflict('The original order and payment must be linked to this case.');
    const input=await this.db.transaction(async tx=>{
      // Match commerce lock order: financial records before the booking/case.
      const [order]=await tx.select().from(orders).where(eq(orders.id,linked.orderId)).for('update');
      const [payment]=await tx.select().from(payments).where(eq(payments.id,linked.paymentId)).for('update');
      const [booking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,linked.booking.id)).for('update');
      const [record]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      const state=(record?.result??{}) as State,quote=record?.quote as OperationQuote|null;
      if(!record||record.version!==version||record.status!=='EXECUTING'||!['CANCEL','VOID','REFUND','EXCHANGE'].includes(record.kind)||state.airlineCompleted!==true||!['CUSTOMER_REFUND_PENDING','CUSTOMER_REFUND_FAILED'].includes(String(state.stage))||!record.approval||!quote)throw conflict('A verified airline operation and approved customer refund are required. Refresh this case.');
      if(!booking?.pnrLocator||pnr!==booking.pnrLocator||booking.status!==(record.kind==='EXCHANGE'||state.scope==='ANCILLARY'?'TICKETED':'REFUND_REQUIRED'))throw conflict('Confirm the current PNR and its verified airline outcome.');
      if(!order||!payment||order.customerId!==booking.customerId||payment.customerId!==booking.customerId||payment.orderId!==order.id||order.status!=='PAID'||payment.status!=='SUCCEEDED'||payment.provider!=='STRIPE_TEST'||!payment.providerPaymentId||quote.currency!==order.currency||payment.currency!==order.currency||cents(payment.amount)!==cents(order.totalAmount)||cents(quote.refundAmount)<=0n)throw conflict('The original verified sandbox payment does not match this refund.');
      const previous=await tx.select().from(refunds).where(eq(refunds.paymentId,payment.id));
      if(typeof state.refundId==='string'&&previous.some(item=>item.id===state.refundId&&['REQUESTED','PROCESSING','SUCCEEDED'].includes(item.status)))throw conflict('This refund is already reserved or completed. Verify its outcome before another action.');
      const reserved=previous.filter(item=>['REQUESTED','PROCESSING','SUCCEEDED'].includes(item.status)).reduce((sum,item)=>sum+cents(item.amount),0n);
      if(reserved+cents(quote.refundAmount)>cents(payment.amount))throw conflict('This refund would exceed the original payment after previous or pending refunds.');
      const [refund]=await tx.insert(refunds).values({paymentId:payment.id,orderId:order.id,amount:quote.refundAmount,currency:quote.currency,status:'PROCESSING',reasonCode:state.scope==='ANCILLARY'?'ANCILLARY_SERVICING':'FLIGHT_SERVICING',requestedByStaffId:staff.staffUserId}).returning();
      await tx.update(flightServicingCases).set({version:record.version+1,updatedAt:new Date(),result:{...state,refundId:refund!.id,refundStatus:'PROCESSING',stage:'CUSTOMER_REFUND_SENDING',message:'Customer refund request reserved. Do not submit it again.'}}).where(eq(flightServicingCases.id,id));
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'CUSTOMER_REFUND_CLAIMED',note:quote.currency+' '+quote.refundAmount+' · original payment only'});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.customer_refund_claimed',resourceType:'flight_servicing_case',resourceId:id,requestId});
      return {refundId:refund!.id,caseId:id,orderId:order.id,sessionId:payment.providerPaymentId,originalAmount:payment.amount,amount:quote.refundAmount,currency:quote.currency} satisfies RefundInput;
    });
    try{await this.finish(input,await provider.create(input),false,staff,requestId);}
    catch(error){
      if(error instanceof RefundBeforeSubmissionError){await this.finish(input,null,true,staff,requestId);return;}
      await this.db.transaction(async tx=>{
        const [record]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
        const state=(record?.result??{}) as State;
        if(!record||state.refundId!==input.refundId)return;
        const [refund]=await tx.select().from(refunds).where(eq(refunds.id,input.refundId));
        if(refund?.status!=='PROCESSING')return;
        const message='The customer refund outcome is not confirmed. Verify the existing request; do not create another refund.';
        await tx.update(flightServicingCases).set({status:'OUTCOME_UNKNOWN',version:record.version+1,result:{...state,stage:'CUSTOMER_REFUND_UNKNOWN',message},updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
        await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'CUSTOMER_REFUND_UNKNOWN',note:message});
      });
    }
  }
  async reconcile(id:string,staff?:AdminIdentity,requestId?:string){
    if(staff&&!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must reconcile a customer refund.',403);
    const [record]=await this.db.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).limit(1);
    const state=(record?.result??{}) as State;
    if(!record||state.airlineCompleted!==true||typeof state.refundId!=='string')throw conflict('No customer refund request is attached to this case.');
    const [linked]=await this.db.select({refund:refunds,payment:payments}).from(refunds).innerJoin(payments,eq(refunds.paymentId,payments.id)).where(eq(refunds.id,state.refundId)).limit(1);
    if(!linked||!linked.payment.providerPaymentId||linked.payment.provider!=='STRIPE_TEST')throw conflict('The original Stripe test payment requires reconciliation.');
    if(linked.refund.status==='SUCCEEDED'&&record.status==='COMPLETED')return;
    const input:RefundInput={refundId:linked.refund.id,caseId:id,orderId:linked.refund.orderId,sessionId:linked.payment.providerPaymentId,originalAmount:linked.payment.amount,amount:linked.refund.amount,currency:linked.refund.currency};
    let verified:VerifiedRefund|null;
    try{verified=await this.provider().find(input,linked.refund.providerRefundId);}catch{throw new ApiException('DEPENDENCY_UNAVAILABLE','Stripe could not verify this refund. Its existing reservation remains locked.',503);}
    if(!verified)throw conflict('Stripe has not returned matching refund evidence. Do not submit another refund.');
    await this.finish(input,verified,false,staff,requestId);
  }
  private async finish(input:RefundInput,verified:VerifiedRefund|null,notSent:boolean,staff?:AdminIdentity,requestId?:string){
    const status=notSent?'FAILED':verified?.status==='succeeded'?'SUCCEEDED':verified?.status==='failed'?'FAILED':verified?.status==='canceled'?'CANCELLED':'PROCESSING';
    const [link]=await this.db.select({bookingId:flightServicingCases.bookingId}).from(flightServicingCases).where(eq(flightServicingCases.id,input.caseId)).limit(1);
    if(!link)throw conflict('Refund case not found.');
    await this.db.transaction(async tx=>{
      const [order]=await tx.select().from(orders).where(eq(orders.id,input.orderId)).for('update');
      const [refund]=await tx.select().from(refunds).where(eq(refunds.id,input.refundId)).for('update');
      const [booking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,link.bookingId)).for('update');
      const [record]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,input.caseId)).for('update');
      const state=(record?.result??{}) as State;
      if(!refund||!order||!booking||!record||record.bookingId!==booking.id||order.bookingIntentId!==booking.bookingIntentId||refund.orderId!==input.orderId||state.refundId!==input.refundId||state.airlineCompleted!==true)throw conflict('Refund linkage changed during verification.');
      if(['SUCCEEDED','FAILED','CANCELLED'].includes(refund.status))return;
      const actor=staff?.staffUserId||refund.requestedByStaffId;
      if(!actor)throw conflict('The refund requester needs reconciliation.');
      const complete=status==='SUCCEEDED',failed=['FAILED','CANCELLED'].includes(status);
      const stage=complete?'COMPLETED':failed?'CUSTOMER_REFUND_FAILED':'CUSTOMER_REFUND_PENDING_PROVIDER';
      const message=complete?'Airline '+(state.scope==='ANCILLARY'?'extra-service refund; flight retained':record.kind==='EXCHANGE'?'reissue':'cancellation')+' and the Stripe sandbox customer refund are verified.':notSent?'The original test payment could not be verified. No customer refund was sent.':failed?'Stripe reports that this refund failed or was cancelled. Review its evidence before requesting another refund.':verified?.status==='requires_action'?'Stripe requires further refund action. The customer refund is not complete.':'Stripe is processing the customer refund. This case remains open until completion is verified.';
      const changed=state.stage!==stage||state.refundProviderStatus!==verified?.status;
      await tx.update(refunds).set({status,providerRefundId:verified?.id??null,updatedAt:new Date(),completedAt:complete?new Date():null}).where(eq(refunds.id,input.refundId));
      if(complete&&record.kind!=='EXCHANGE'&&state.scope!=='ANCILLARY')await tx.update(flightBookings).set({status:'CANCELLED',updatedAt:new Date()}).where(and(eq(flightBookings.id,record.bookingId),eq(flightBookings.status,'REFUND_REQUIRED')));
      if(changed||complete||failed){
        await tx.update(flightServicingCases).set({status:complete?'COMPLETED':'EXECUTING',version:record.version+1,updatedAt:new Date(),result:{...state,stage,message,refundStatus:status,refundProviderStatus:verified?.status??'not_sent',providerRefundId:verified?.id??null}}).where(eq(flightServicingCases.id,input.caseId));
        await tx.insert(flightServicingEvents).values({caseId:record.id,staffUserId:actor,event:'CUSTOMER_REFUND_'+status,note:(staff?'Staff verification. ':'System verification of the original staff request. ')+message});
        await tx.insert(commerceAuditEvents).values({actorType:'SYSTEM',orderId:order.id,paymentId:refund.paymentId,event:'flight.refund.'+status.toLowerCase(),requestId:requestId??null});
        if(staff)await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.customer_refund_verified',resourceType:'flight_servicing_case',resourceId:record.id,requestId:requestId??'flight-refund-reconciliation'});
      }
    });
  }
  private async scan(){
    if(this.running||this.stopped||!this.available()||!this.connection)return;this.running=true;
    try{
      const pending=await this.db.select({id:flightServicingCases.id,refundId:refunds.id}).from(flightServicingCases).innerJoin(refunds,sql`${flightServicingCases.result}->>'refundId'=${refunds.id}::text`).where(and(inArray(flightServicingCases.status,['EXECUTING','OUTCOME_UNKNOWN']),eq(refunds.status,'PROCESSING'),lt(refunds.updatedAt,new Date(Date.now()-60000)))).orderBy(asc(refunds.updatedAt)).limit(10);
      for(const record of pending){if(this.stopped)break;try{await this.reconcile(record.id);}catch{await this.db.update(refunds).set({updatedAt:new Date()}).where(and(eq(refunds.id,record.refundId),eq(refunds.status,'PROCESSING')));}}
    }finally{this.running=false;}
  }
}
