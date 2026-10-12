import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PointsWallet } from '@flyseri/types';
import { pointsService } from '../services/pointsService';
import { PageLoading } from '../components/PageLoading';
import './points.css';

export function PointsWalletView({wallet,onPage,busy=false,demo=false,children}:{wallet:PointsWallet;onPage?:(page:number)=>void;busy?:boolean;demo?:boolean;children?:ReactNode}) {
  const rules=wallet.rules;
  const noPoints=wallet.available===0&&wallet.pending===0&&wallet.reserved===0;
  return <div className="points-content"><section className="points-hero" aria-label="Points balance">
    <div><span className="points-eyebrow">A LITTLE BACK FOR YOUR NEXT JOURNEY</span><h1>{demo?'Demo Flyseri Points':'Flyseri Points'}</h1><p>{noPoints?'Your next journey can be your first reward.':'Earn as you travel. Save on your next flight.'}</p></div>
    <div className="points-balances"><div><span>Available points</span><strong>{wallet.available.toLocaleString()}</strong><small>Worth BDT {wallet.available.toLocaleString()}</small></div><div><span>Pending points</span><strong>{wallet.pending.toLocaleString()}</strong><small>Awaiting verified completed travel</small></div></div>
    {!!wallet.reserved&&<p>{wallet.reserved.toLocaleString()} points reserved for checkout.</p>}
    {!!wallet.adjustmentDue&&<p role="status">A {wallet.adjustmentDue.toLocaleString()} point refund adjustment will be offset against your balance and future earnings.</p>}
    {noPoints&&<div className="points-start"><h2>No points yet. Your journey starts here.</h2><p>Earn 1 point for every BDT {rules.earnSpend.toLocaleString()} of eligible ticket fare. Your rewards become available after your completed journey is verified.</p></div>}
    {wallet.available===0&&wallet.pending>0&&<p>Your points are on their way. They’ll become available after your completed journey is verified.</p>}
    <Link className="btn-primary" to="/flights">{noPoints?'Find a flight & start earning':'Find your next flight'}</Link>
  </section>
  {children}
  {wallet.expiring&&<p className="points-expiry">{wallet.expiring.points.toLocaleString()} points expire on {new Date(wallet.expiring.expiresAt).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}.</p>}
  <section className="points-rules" aria-labelledby="points-rules-heading"><h2 id="points-rules-heading">Simple rewards. Clear rules.</h2><div>
    <article><span aria-hidden="true">01</span><h3>Earn on your ticket</h3><p>1 point for every BDT {rules.earnSpend.toLocaleString()} of eligible fare paid after discounts. Taxes, fees and extras are excluded.</p></article>
    <article><span aria-hidden="true">02</span><h3>Available after you travel</h3><p>Points become available {rules.releaseDays} days after your completed journey is verified. They expire {rules.expiryMonths} months after release.</p></article>
    <article><span aria-hidden="true">03</span><h3>Save on your next flight</h3><p>1 point = BDT {rules.pointValue}. Use at least {rules.minimumRedemption} points, up to {rules.maximumRedemptionPercent}% of an eligible BDT fare.</p></article>
  </div><p className="points-note">Refunds adjust earned points and restore eligible redeemed points. Points cannot be transferred or exchanged for cash. Demo and sandbox bookings do not earn real points.</p></section>
  <section className="points-activity" aria-labelledby="points-activity-heading" aria-busy={busy}><header><h2 id="points-activity-heading">Points activity</h2><span>Page {wallet.page}</span></header>
    {!wallet.activity.length?<div className="points-empty"><h3>Your journeys will appear here</h3><p>Eligible ticket purchases earn pending points. You’ll see every award, redemption and adjustment here.</p></div>:<ul>{wallet.activity.map(item=><li key={item.id}><div><strong>{item.description}</strong><span>{new Date(item.createdAt).toLocaleDateString()} · {item.kind.toLowerCase().replace(/_/g,' ')}</span>{item.orderId&&<Link to={demo?'/demo/bookings':`/app/orders/${item.orderId}`}>View booking</Link>}</div><b className={item.points>0?'points-positive':''}>{item.points===0?'Updated':`${item.points>0?'+':''}${item.points.toLocaleString()}`}{item.points!==0&&<small>pts</small>}</b></li>)}</ul>}
    {onPage&&<nav aria-label="Points activity pages"><button type="button" disabled={busy||wallet.page<=1} onClick={()=>onPage(wallet.page-1)}>Previous</button><button type="button" disabled={busy||!wallet.hasMore} onClick={()=>onPage(wallet.page+1)}>Next</button></nav>}
  </section></div>;
}
export function PointsPage() {
  const [wallet,setWallet]=useState<PointsWallet|null>(null),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[error,setError]=useState(false),[busy,setBusy]=useState(true);
  useEffect(()=>{let active=true;setBusy(true);setError(false);void pointsService.wallet(page).then(value=>{if(active)setWallet(value);},()=>{if(active)setError(true);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[page,retry]);
  return <main className="account-page points-page"><Link className="account-link" to="/app">My Flyseri</Link>{busy&&!wallet&&<PageLoading/>}
    {error&&<section className="points-unavailable" role="alert"><span className="points-eyebrow">FLYSERI POINTS</span><h1>Your rewards are temporarily unavailable</h1><p>We couldn’t check your balance. Please try again in a moment.</p><button type="button" className="account-outline-button" onClick={()=>setRetry(v=>v+1)}>Try again</button></section>}
    {wallet&&!error&&<PointsWalletView wallet={wallet} onPage={setPage} busy={busy}/>}<p className="points-note">Want to try the rewards journey? <Link to="/demo/points">Open the separate points demo</Link>.</p>
  </main>;
}
