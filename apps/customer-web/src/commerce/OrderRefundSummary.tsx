import type {OrderDetail} from '@flyseri/types';
import {formatMoney,formatTimestamp} from '../account/presentation';

export function OrderRefundSummary({refunds}:Pick<OrderDetail,'refunds'>){
 const visible=refunds?.filter(refund=>refund.status!=='CANCELLED')??[];
 if(!visible.length)return null;
 return <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Refund status" aria-live="polite">
  <h3 className="text-sm font-semibold text-slate-800">Refund status</h3>
  {visible.map((refund,index)=><div key={index} className="mt-3 text-sm">
   {refund.scope==='ANCILLARY'&&<p className="mb-1 text-xs text-slate-600">Extra-service refund · flight retained</p>}
   <div className="flex flex-wrap justify-between gap-2"><strong>{refund.status==='SUCCEEDED'?'Refund completed':refund.status==='FAILED'?'Refund needs attention':'Refund processing'}</strong><strong>{formatMoney(refund.amount,refund.currency)}</strong></div>
   <p className="mt-1 text-xs text-slate-600">{refund.status==='SUCCEEDED'?<>Returned to your original payment method{refund.completedAt?' · '+formatTimestamp(refund.completedAt):''}. Your bank may take additional time to display it.</>:refund.status==='FAILED'?'Contact Flyseri with your order number to check this refund.':'Your refund is being processed. Please wait for confirmation.'}</p>
  </div>)}
 </section>;
}
