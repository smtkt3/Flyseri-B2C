import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@flyseri/config';
import { RefundBeforeSubmissionError, StripeTestRefundProvider, type RefundInput } from './stripe-test-refund.provider.js';
const input:RefundInput={refundId:'fixture-refund',caseId:'fixture-case',orderId:'fixture-order',sessionId:'cs_test_fixture',originalAmount:'100.00',amount:'80.00',currency:'MYR'};
const session={id:input.sessionId,object:'checkout.session',livemode:false,mode:'payment',status:'complete',payment_status:'paid',client_reference_id:input.orderId,amount_total:10000,currency:'myr',payment_intent:'pi_fixture'};
const intent={id:'pi_fixture',object:'payment_intent',livemode:false,status:'succeeded',amount_received:10000,currency:'myr'};
const refund={id:'re_fixture',object:'refund',amount:8000,currency:'myr',payment_intent:'pi_fixture',status:'succeeded',metadata:{flyseri_refund_id:input.refundId,flyseri_case_id:input.caseId,flyseri_order_id:input.orderId}};
const config=parseConfig({APP_ENV:'test',STRIPE_SECRET_KEY:'sk_test_fixture'});
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
describe('original Stripe test payment refund',()=>{
  it('binds the refund to the original verified intent, amount, case and a stable idempotency key',async()=>{
    const http=vi.fn().mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(intent)).mockResolvedValueOnce(json(refund));
    const provider=new StripeTestRefundProvider(config,http);
    expect(await provider.create(input)).toEqual({id:'re_fixture',status:'succeeded'});
    const [url,request]=http.mock.calls[2]!;
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(request).toMatchObject({method:'POST',redirect:'error',headers:{'Idempotency-Key':'flyseri:flight-refund:fixture-refund'}});
    expect(request.body.get('payment_intent')).toBe('pi_fixture');
    expect(request.body.get('amount')).toBe('8000');
    expect(request.body.get('metadata[flyseri_case_id]')).toBe(input.caseId);
  });
  it('sends no refund when the payment is live, belongs to another order or has an incorrect amount',async()=>{
    for(const invalid of [{...session,livemode:true},{...session,client_reference_id:'other-order'},{...session,amount_total:9999}]){
      const http=vi.fn().mockResolvedValue(json(invalid));
      await expect(new StripeTestRefundProvider(config,http).create(input)).rejects.toBeInstanceOf(RefundBeforeSubmissionError);
      expect(http).toHaveBeenCalledOnce();
      expect(http.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
    }
  });
  it('reconciles a lost refund response by GET and never resubmits the refund',async()=>{
    const http=vi.fn().mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(intent)).mockRejectedValueOnce(new Error('Lost POST response'))
      .mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(intent)).mockResolvedValueOnce(json({object:'list',has_more:false,data:[refund]}));
    const provider=new StripeTestRefundProvider(config,http);
    await expect(provider.create(input)).rejects.not.toBeInstanceOf(RefundBeforeSubmissionError);
    expect(await provider.find(input,null)).toEqual({id:'re_fixture',status:'succeeded'});
    expect(http.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
  });
  it('rejects a refund response for a different case or amount',async()=>{
    for(const invalid of [{...refund,amount:8100},{...refund,metadata:{...refund.metadata,flyseri_case_id:'another-case'}}]){
      const http=vi.fn().mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(intent)).mockResolvedValueOnce(json(invalid));
      await expect(new StripeTestRefundProvider(config,http).create(input)).rejects.toThrow('Refund evidence does not match');
    }
  });
});
