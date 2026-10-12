import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PointsQuote } from '@flyseri/types';
import { pointsService } from '../services/pointsService';
import './points.css';
export function PointsCheckout({orderId,locked,onChanged,onBusy}:{orderId:string;locked:boolean;onChanged:()=>Promise<void>;onBusy:(busy:boolean)=>void}) {
  const [quote,setQuote]=useState<PointsQuote|null>(null),[points,setPoints]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const running=useRef(false);
  useEffect(()=>{let active=true;setQuote(null);setError('');void pointsService.quote(orderId).then(value=>{if(active){setQuote(value);setPoints(String(value.applied||''));}},()=>{if(active)setError('Points could not be checked. Retry or continue without adding points.');});return()=>{active=false;};},[orderId,retry,locked]);
  async function apply(value:number) {
    if(running.current||locked)return;
    if(!Number.isSafeInteger(value)||value<0||value>100000000){setError('Enter a valid whole number of points.');return;}
    running.current=true;setBusy(true);onBusy(true);setError('');
    try {const next=await pointsService.apply(orderId,value);await onChanged();setQuote(next);setPoints(String(next.applied||''));}
    catch(cause){setError(cause instanceof Error?cause.message:'Points could not be applied. Check your latest order total before payment.');try{await onChanged();}catch{/* Payment remains blocked by the parent until its order refresh succeeds. */}}
    finally{running.current=false;setBusy(false);onBusy(false);}
  }
  return <section className="points-checkout" aria-label="Flyseri Points"><header><h3>Flyseri Points</h3><Link to="/app/points">My points</Link></header>
    {!quote&&!error&&<p role="status">Checking your points…</p>}{quote&&<><p>{quote.message}</p>{quote.eligible&&quote.maximum<quote.rules.minimumRedemption&&<p>At least {quote.rules.minimumRedemption} available points and an eligible fare of BDT 1,000 are needed to redeem points.</p>}{quote.eligible&&quote.maximum>=quote.rules.minimumRedemption&&<><p><strong>{quote.available.toLocaleString()} available</strong> · Use up to {quote.maximum.toLocaleString()} points</p><label htmlFor="checkout-points">Points to use</label><div className="points-apply"><input id="checkout-points" type="number" inputMode="numeric" min="100" max={quote.maximum} step="1" value={points} disabled={busy||locked} onChange={e=>setPoints(e.target.value)} aria-describedby="points-checkout-note"/><button type="button" disabled={busy||locked||!points} onClick={()=>void apply(Number(points))}>{busy?'Updating…':'Apply points'}</button></div></>}
    {quote.applied>0&&<p><strong>{quote.applied} points applied · BDT {quote.applied} saved</strong> {quote.eligible&&<button type="button" disabled={busy||locked} onClick={()=>void apply(0)}>Remove</button>}</p>}
    <small id="points-checkout-note">{quote.eligible?`Estimated earning: ${quote.estimatedEarn} points. Available after verified travel.`:'Real points are separate from the demo balance.'}</small></>}
    {error&&<div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setRetry(v=>v+1)}>Check points again</button></div>}
  </section>;
}
