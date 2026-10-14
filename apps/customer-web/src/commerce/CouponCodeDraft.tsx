import { useId, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { keepCheckoutDraft, readCheckoutDraft } from '../flight/checkoutDrafts';
import './coupon-checkout.css';

/** Before a priced order exists, preserve the code without claiming a discount. */
export function CouponCodeDraft({intentId,disabled}:{intentId:string;disabled:boolean}) {
  const {session}=useAuth();
  const id=useId();
  const owner=session?.user.id??null;
  const key=`coupon:${intentId}`;
  const [code,setCode]=useState(()=>readCheckoutDraft<string>(key,owner)??'');
  return <section className="coupon-checkout" aria-label="Discount coupon"><h3>Have a coupon?</h3>
    <label htmlFor={id}>Coupon code <span>(optional)</span></label>
    <div className="coupon-entry"><input id={id} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} value={code} placeholder="Enter coupon code" disabled={disabled} aria-describedby={`${id}-note`} onChange={e=>{const next=e.target.value.toUpperCase();setCode(next);keepCheckoutDraft(key,owner,next);}} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}}/></div>
    <small id={`${id}-note`}>Your code carries to secure payment. Apply it there once the final total is confirmed.</small>
  </section>;
}
