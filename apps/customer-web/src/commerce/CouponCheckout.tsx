import { useRef, useState } from 'react';
import type { OrderDetail } from '@flyseri/types';
import { apiClient } from '../lib/api/client';
import { formatMoney } from '../account/presentation';
import { useAuth } from '../auth/AuthProvider';
import { clearCheckoutDraft, readCheckoutDraft } from '../flight/checkoutDrafts';
import './coupon-checkout.css';

export function CouponCheckout({order,locked,onChanged,onBusy}:{order:OrderDetail;locked:boolean;onChanged:()=>Promise<void>;onBusy:(value:boolean)=>void}) {
  const {session}=useAuth();
  const draftKey=order.bookingIntentId?`coupon:${order.bookingIntentId}`:null;
  const [code,setCode]=useState(()=>draftKey?readCheckoutDraft<string>(draftKey,session?.user.id??null)??'':''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const running=useRef(false);
  async function update(value:string|null) {
    if(locked||running.current)return;
    running.current=true;setBusy(true);onBusy(true);setNotice('');
    try {
      await apiClient.post(`/orders/${encodeURIComponent(order.id)}/coupon`,{code:value});
      if(draftKey)clearCheckoutDraft(draftKey);
      await onChanged();setCode('');setNotice(value?'Coupon applied. Review the payment total before continuing.':'Coupon removed. Review the payment total before continuing.');
    } catch(error) {
      setNotice(error instanceof Error?error.message:'The coupon could not be updated. Please try again.');
      await onChanged();
    } finally {running.current=false;setBusy(false);onBusy(false);}
  }
  return <section className="coupon-checkout" aria-label="Discount coupon"><h3>Have a coupon?</h3>
    {order.coupon ? <div className="coupon-applied"><div><strong>{order.coupon.code}</strong><span>You save {formatMoney(order.coupon.discountAmount,order.coupon.currency)}</span></div><button type="button" disabled={locked||busy} onClick={()=>void update(null)}>{busy?'Updating…':'Remove'}</button></div>
      : <><label htmlFor="payment-coupon">Coupon code</label><div className="coupon-entry"><input id="payment-coupon" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} value={code} placeholder="Enter code" disabled={locked||busy} onChange={e=>{setCode(e.target.value.toUpperCase());setNotice('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(code.trim())void update(code.trim());}}}/><button type="button" disabled={locked||busy||!code.trim()} onClick={()=>void update(code.trim())}>{busy?'Applying…':'Apply'}</button></div></>}
    {notice&&<p role="status">{notice}</p>}
    <small>{order.payment?'Discounts are locked because payment has started.':'One coupon per order. Coupons cannot be combined with points.'}</small>
  </section>;
}
