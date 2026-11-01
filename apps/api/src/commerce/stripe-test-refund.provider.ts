import type { AppConfig } from '@flyseri/config';
import { minorAmount } from './stripe-test-payment.provider.js';

export interface RefundInput {
  refundId:string;caseId:string;orderId:string;sessionId:string;
  originalAmount:string;amount:string;currency:string;
}
export interface VerifiedRefund {id:string;status:'succeeded'|'pending'|'requires_action'|'failed'|'canceled'}
export class RefundBeforeSubmissionError extends Error {}
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Original-payment refunds only; accepts no bank/card details from the browser. */
export class StripeTestRefundProvider {
  constructor(private readonly config:AppConfig,private readonly http:typeof fetch=fetch){
    if(!config.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw Error('Stripe test refund configuration is missing');
  }
  private async request(path:string,init:RequestInit={}):Promise<Record<string,unknown>>{
    const response=await this.http('https://api.stripe.com/v1'+path,{...init,redirect:'error',headers:{Authorization:'Bearer '+this.config.STRIPE_SECRET_KEY,'Stripe-Version':'2025-06-30.basil',...init.headers},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Stripe refund verification is unavailable');
    const data=object(await response.json());if(!data)throw Error('Unverified Stripe refund response');return data;
  }
  private async paymentIntent(input:RefundInput){
    if(!/^cs_test_[A-Za-z0-9]+$/.test(input.sessionId))throw Error('A Stripe test checkout session is required');
    const session=await this.request('/checkout/sessions/'+encodeURIComponent(input.sessionId));
    const original=minorAmount(input.originalAmount,input.currency),amount=minorAmount(input.amount,input.currency);
    if(amount>original||session.id!==input.sessionId||session.object!=='checkout.session'||session.livemode!==false||session.mode!=='payment'||session.status!=='complete'||session.payment_status!=='paid'||session.client_reference_id!==input.orderId||session.amount_total!==original||session.currency!==input.currency.toLowerCase()||typeof session.payment_intent!=='string'||!/^pi_[A-Za-z0-9]+$/.test(session.payment_intent))throw Error('The original Stripe test payment does not match this order');
    const intent=await this.request('/payment_intents/'+session.payment_intent);
    if(intent.id!==session.payment_intent||intent.object!=='payment_intent'||intent.livemode!==false||intent.status!=='succeeded'||intent.amount_received!==original||intent.currency!==input.currency.toLowerCase())throw Error('Original payment intent is not verified');
    return {id:session.payment_intent,amount};
  }
  private verify(value:unknown,input:RefundInput,intentId:string):VerifiedRefund{
    const row=object(value),metadata=object(row?.metadata);
    if(!row||row.object!=='refund'||typeof row.id!=='string'||!/^re_[A-Za-z0-9]+$/.test(row.id)||row.amount!==minorAmount(input.amount,input.currency)||row.currency!==input.currency.toLowerCase()||row.payment_intent!==intentId||metadata?.flyseri_refund_id!==input.refundId||metadata.flyseri_case_id!==input.caseId||metadata.flyseri_order_id!==input.orderId||!['succeeded','pending','requires_action','failed','canceled'].includes(String(row.status)))throw Error('Refund evidence does not match this servicing request');
    return {id:row.id,status:row.status as VerifiedRefund['status']};
  }
  async create(input:RefundInput):Promise<VerifiedRefund>{
    let payment:{id:string;amount:number};
    try{payment=await this.paymentIntent(input);}catch{throw new RefundBeforeSubmissionError('The original test payment could not be verified. No refund request was sent.');}
    const form=new URLSearchParams({payment_intent:payment.id,amount:String(payment.amount),reason:'requested_by_customer','metadata[flyseri_refund_id]':input.refundId,'metadata[flyseri_case_id]':input.caseId,'metadata[flyseri_order_id]':input.orderId});
    const data=await this.request('/refunds',{method:'POST',body:form,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'flyseri:flight-refund:'+input.refundId}});
    return this.verify(data,input,payment.id);
  }
  async find(input:RefundInput,providerRefundId:string|null):Promise<VerifiedRefund|null>{
    const payment=await this.paymentIntent(input);
    if(providerRefundId){
      if(!/^re_[A-Za-z0-9]+$/.test(providerRefundId))throw Error('Invalid provider refund identifier');
      const data=await this.request('/refunds/'+providerRefundId),verified=this.verify(data,input,payment.id);
      if(verified.id!==providerRefundId)throw Error('Refund identifier mismatch');return verified;
    }
    // An uncertain POST is reconciled by its durable metadata. Never create a
    // second refund because the first response or identifier was lost.
    let after='';
    for(let page=0;page<5;page++){
      const query=new URLSearchParams({payment_intent:payment.id,limit:'100'});if(after)query.set('starting_after',after);
      const list=await this.request('/refunds?'+query);
      if(list.object!=='list'||!Array.isArray(list.data)||typeof list.has_more!=='boolean')throw Error('Incomplete refund list');
      const matches=list.data.filter(item=>object(object(item)?.metadata)?.flyseri_refund_id===input.refundId);
      if(matches.length>1)throw Error('Ambiguous refund evidence');
      if(matches.length===1)return this.verify(matches[0],input,payment.id);
      if(!list.has_more)return null;
      const last=object(list.data.at(-1));if(typeof last?.id!=='string'||!/^re_[A-Za-z0-9]+$/.test(last.id))throw Error('Invalid refund cursor');after=last.id;
    }
    throw Error('Refund history requires specialist reconciliation');
  }
}
