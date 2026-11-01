import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {commerceService} from './commerceService';

vi.mock('./authService',()=>({authService:{accessToken:async()=>undefined}}));
beforeEach(()=>{
 vi.useFakeTimers();
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{
  const controller=new AbortController();
  setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),ms);
  return controller.signal;
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function delayedResponse(delay:number,data:unknown){
 const transport=vi.fn((_url:unknown,options?:RequestInit)=>new Promise<Response>((resolve,reject)=>{
  const timer=setTimeout(()=>resolve(new Response(JSON.stringify({success:true,data,requestId:'fixture-request'}),{status:200})),delay);
  options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal?.reason);},{once:true});
 }));
 vi.stubGlobal('fetch',transport);
 return transport;
}
it('waits for a normal Sabre and Stripe checkout that takes longer than eight seconds',async()=>{
 const transport=delayedResponse(12000,{payment:{id:'payment',status:'PENDING'},redirectUrl:'https://checkout.stripe.com/c/pay/cs_test_existing',actionRequired:true});
 const result=commerceService.startPayment('order','same-attempt');
 await vi.advanceTimersByTimeAsync(12000);
 expect((await result).redirectUrl).toContain('cs_test_existing');
 expect(transport).toHaveBeenCalledOnce();
 expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({idempotencyKey:'same-attempt'});
});
it('still times out a stuck checkout without replaying the payment POST',async()=>{
 const transport=delayedResponse(100000,{});
 const result=expect(commerceService.startPayment('order','same-attempt')).rejects.toMatchObject({code:'TIMEOUT'});
 await vi.advanceTimersByTimeAsync(90000);
 await result;
 expect(transport).toHaveBeenCalledOnce();
});
it('allows provider reconciliation longer than the general API request timeout',async()=>{
 const transport=delayedResponse(12000,{id:'payment',status:'PENDING'});
 const result=commerceService.payment('payment');
 await vi.advanceTimersByTimeAsync(12000);
 expect((await result).status).toBe('PENDING');
 expect(transport).toHaveBeenCalledOnce();
});
