import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { demoPointsTransition, initialDemoPoints } from '../services/demo/demoPointsService';
import { PointsWalletView } from './PointsPage';
export function DemoPointsPage() {
  const [state,setState]=useState(initialDemoPoints),[points,setPoints]=useState('100'),[error,setError]=useState('');
  function act(action:Parameters<typeof demoPointsTransition>[1]) {setError('');try{setState(demoPointsTransition(state,action,Number(points)));}catch(cause){setError(cause instanceof Error?cause.message:'Check the demo step.');}}
  function redeem(){setError('');try{const next=demoPointsTransition(state,'REDEEM',Number(points));setState(next);}catch(cause){setError(cause instanceof Error?cause.message:'Check your points.');}}
  return <div className="customer-site-shell"><PremiumNavbar/><main className="points-demo-page"><Link to="/">Back to homepage</Link><PointsWalletView wallet={state.wallet} demo><section className="points-demo-controls" aria-label="Points demo controls">
    <h2>Try the rewards journey</h2><p><strong>Demo only.</strong> Start with 500 sample points. This rehearsal resets when you leave or reload. No money, real points, airline tickets or customer accounts are involved.</p>
    <p>Sample eligible fare: <strong>BDT 25,000</strong> · Earning after discount: <strong>{Math.floor((state.fare-state.redeemed)/1000)} points</strong></p>
    <label htmlFor="demo-redeem-points">Points to use on the sample ticket (optional)<input id="demo-redeem-points" type="number" inputMode="numeric" min="100" max={Math.min(2500,state.wallet.available)} step="1" disabled={state.stage!=='READY'} value={points} onChange={event=>setPoints(event.target.value)}/></label>
    <div><button type="button" disabled={state.stage!=='READY'} onClick={redeem}>1. Simulate redemption</button>
      <button type="button" disabled={!['READY','REDEEMED'].includes(state.stage)} onClick={()=>act('PURCHASE')}>2. Simulate paid ticket</button>
      <button type="button" disabled={state.stage!=='PENDING'} onClick={()=>act('COMPLETE')}>3. Simulate travel + 7 days</button>
      <button type="button" disabled={!['PENDING','AVAILABLE'].includes(state.stage)} onClick={()=>act('REFUND')}>Simulate full refund</button>
      <button type="button" onClick={()=>{setState(initialDemoPoints());setPoints('100');setError('');}}>Reset demo</button>
    </div>
    <p role="status">{state.stage==='REDEEMED'?`Demo ticket total: BDT ${(state.fare-state.redeemed).toLocaleString()} after ${state.redeemed} points. Continue with the simulated payment.`:state.stage==='REFUNDED'?'Demo refund reconciled. Your sample balance has been restored.':state.stage==='AVAILABLE'?'Your completed journey points are now available. Try a full refund to see the adjustment.':state.stage==='PENDING'?'Points are pending. Simulate completed travel to release them.':'Ready to try earning points. Apply points first or continue with the full sample fare.'}</p>
    {error&&<p role="alert">{error}</p>}
  </section></PointsWalletView></main></div>;
}
