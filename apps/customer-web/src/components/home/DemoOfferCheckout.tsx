import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createDemoBooking } from '../../services/demo/demoBookingService';
import type { GroupFare } from './groupFares';
import { groupFareMoney } from './groupFares';
import { demoHoldRemaining, finishDemoHold, readOrCreateDemoHold } from './demoOfferHold';
function holdStorage() { try { return window.sessionStorage; } catch { return undefined; } }
export function DemoOfferCheckout({ code, city, fare, departure, travellers, onBack }: { code: string; city: string; fare: GroupFare; departure: string; travellers: number; onBack: () => void }) {
  const key = `flyseri.demo-offer-hold.${code}.${departure}.${travellers}`;
  const [hold, setHold] = useState(() => readOrCreateDemoHold(holdStorage(), key));
  const [now, setNow] = useState(Date.now);
  const [names, setNames] = useState(() => Array.from({ length: travellers }, () => ''));
  const [error, setError] = useState('');
  const remaining = demoHoldRemaining(hold, now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hold.completedAt) return;
    if (names.some(name => !name.trim())) { setError('Enter a name for each traveller.'); return; }
    const submittedAt = Date.now();
    if (submittedAt >= hold.expiresAt) { setNow(submittedAt);setError('This demo hold has expired. Please start a new demo session.');return; }
    let booking;
    try { booking = createDemoBooking({destination:code,city,departure,travellers,amountPerPerson:fare.amountPerPerson,currency:fare.currency??'BDT'},{expiresAt:hold.expiresAt,now:submittedAt}); }
    catch (cause) {setError(cause instanceof Error ? cause.message : 'The demo reservation could not be saved.');return;}
    const completed = finishDemoHold(holdStorage(), key, hold, submittedAt);
    if (!completed) { setNow(Date.now()); setError('This demo hold has expired. Please start a new demo session.'); return; }
    const saved = {...completed,bookingId:booking.id};
    try {holdStorage()?.setItem(key,JSON.stringify(saved));} catch { /* The saved demo remains available in this session. */ }
    setHold(saved); setError('');
  }
  if (hold.completedAt) return <div className="demo-offer-result" role="status"><span aria-hidden="true">✓</span><h3>Demo reservation saved</h3><p>{travellers} traveller{travellers === 1 ? '' : 's'} · Dhaka → {city} · {departure}</p><strong>{groupFareMoney({ ...fare, amountPerPerson: fare.amountPerPerson * travellers })}</strong><p>No airline seats were reserved, no ticket was issued, and no payment was taken.</p><Link className="home-offer-search" to={hold.bookingId ? '/demo/bookings/'+hold.bookingId : '/demo/bookings'}>Continue to demo payment</Link><button type="button" className="account-outline-button" onClick={onBack}>Back to offer details</button></div>;
  return <div className="demo-offer-checkout">
    <p className="special-offer-demo-label">Demo checkout · no real reservation or payment</p>
    <div className={`demo-hold-timer${remaining <= 60 ? ' is-urgent' : ''}`}><div><strong>{remaining ? 'Demo selection held' : 'Demo hold expired'}</strong><span>{remaining ? 'Complete this demo within five minutes.' : 'Start a new demo session to continue.'}</span></div><time aria-label={remaining ? 'Time remaining' : 'Hold expired'}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</time></div>
    <div className="demo-offer-summary"><span>DAC → {code} · {departure} · {travellers} traveller{travellers === 1 ? '' : 's'}</span><strong>{groupFareMoney({ ...fare, amountPerPerson: fare.amountPerPerson * travellers })}<small>Total · demo fare</small></strong></div>
    {remaining > 0 ? <form onSubmit={complete}><p className="group-fare-hint">Use sample names while trying the demo.</p>{names.map((name, index) => <label key={index}>Traveller {index + 1} · full name<input required maxLength={120} autoComplete="off" value={name} onChange={event => setNames(values => values.map((value, position) => position === index ? event.target.value : value))}/></label>)}<button className="home-offer-search" type="submit">Save demo reservation</button></form> : <button type="button" className="home-offer-search" onClick={() => { try { holdStorage()?.removeItem(key); } catch {} setHold(readOrCreateDemoHold(holdStorage(), key)); setNow(Date.now()); setError(''); }}>Start a new demo session</button>}
    {error && <p role="alert" className="home-offer-sample">{error}</p>}
    <button className="demo-back-link" type="button" onClick={onBack}>Back to offer details</button>
  </div>;
}
