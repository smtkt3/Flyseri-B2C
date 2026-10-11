import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { createDemoBooking, demoBookingReceipt, readDemoBookings, updateDemoBooking, type DemoBooking, type DemoBookingAction } from '../services/demo/demoBookingService';
import { activeGroupFare } from '../components/home/groupFares';
import { downloadText } from '../lib/downloadText';
import { formatMoney } from '../account/presentation';
import './demo-booking-management.css';

const routes = [{code:'BKK',city:'Bangkok'},{code:'KUL',city:'Kuala Lumpur'},{code:'DPS',city:'Bali'},{code:'DXB',city:'Dubai'},{code:'SIN',city:'Singapore'}];
const labels: Record<DemoBooking['status'], string> = { HELD:'Reserved · demo payment due',PAYMENT_FAILED:'Demo payment declined',PAYMENT_PENDING:'Demo payment pending',PAID:'Demo payment confirmed',PAYMENT_REVIEW:'Demo payment needs review',TICKETED:'Demo document ready',EXPIRED:'Payment window expired',CANCELLED:'Demo reservation cancelled',REFUNDED:'Demo refund complete' };
export function DemoBookingManagement() {
  const { demoId } = useParams(); const navigate = useNavigate();
  const [items, setItems] = useState<DemoBooking[]>([]); const [error,setError] = useState('');
  const [route,setRoute] = useState('KUL'); const [travellers,setTravellers] = useState(1); const [date,setDate] = useState('');
  const [outcome,setOutcome] = useState<'PAY_SUCCESS'|'PAY_FAILURE'|'PAY_PENDING'>('PAY_SUCCESS');
  const [reviewed,setReviewed] = useState(false); const [confirmCancel,setConfirmCancel] = useState(false); const [now,setNow] = useState(Date.now);
  function reload() { try { setItems(readDemoBookings()); setError(''); } catch(cause) { setError(cause instanceof Error ? cause.message : 'Demo data is unavailable.'); } }
  useEffect(() => { reload(); setReviewed(false);setConfirmCancel(false); }, [demoId]);
  const booking = items.find(value => value.id === demoId);
  useEffect(() => {
    const tick = () => {
      const at = Date.now();setNow(at);
      if (booking && ['HELD','PAYMENT_FAILED'].includes(booking.status) && at >= booking.expiresAt) {
        try { updateDemoBooking(booking.id,'EXPIRE');setItems(readDemoBookings()); } catch(cause) { setError(cause instanceof Error ? cause.message : 'Demo data is unavailable.'); }
      }
    };
    tick();const timer=window.setInterval(tick,1000);window.addEventListener('focus',tick);
    return () => { window.clearInterval(timer);window.removeEventListener('focus',tick); };
  },[booking?.id,booking?.status]);
  function act(action: DemoBookingAction) {
    if (!booking) return;
    try { updateDemoBooking(booking.id,action);setItems(readDemoBookings());setReviewed(false);setConfirmCancel(false);setError(''); }
    catch(cause) { reload();setError(cause instanceof Error ? cause.message : 'The demo action could not be completed.'); }
  }
  function create() {
    const selected = routes.find(value=>value.code===route)!;const fare=activeGroupFare(route);
    if (!fare?.demo) { setError('Choose a demo offer to rehearse the booking flow.');return; }
    try { const value=createDemoBooking({destination:route,city:selected.city,departure:date,travellers,amountPerPerson:fare.amountPerPerson,currency:fare.currency ?? 'BDT'});setItems(readDemoBookings());navigate('/demo/bookings/'+value.id); }
    catch(cause) {setError(cause instanceof Error ? cause.message : 'The demo could not be created.');}
  }
  const remaining=booking ? Math.max(0,Math.ceil((booking.expiresAt-now)/1000)) : 0;
  const payable=!!booking && ['HELD','PAYMENT_FAILED'].includes(booking.status) && remaining>0;
  const paid=!!booking && ['PAID','TICKETED','PAYMENT_REVIEW','REFUNDED'].includes(booking.status);
  const fare=activeGroupFare(route);
  return <div className="customer-site-shell"><PremiumNavbar/><main className="demo-booking-page">
    <header className="demo-booking-heading"><div><span className="demo-booking-eyebrow">FLYSERI SANDBOX</span><h1>{demoId ? 'Manage demo booking' : 'Try the complete booking flow'}</h1><p>Reservation, payment, documents and cancellation in one place.</p></div><Link to={demoId ? '/demo/bookings' : '/'}>{demoId ? 'All demo bookings' : 'Back to homepage'}</Link></header>
    <aside className="demo-booking-notice"><strong>Demo only · no money or airline seats</strong><p>All outcomes are simulated in this browser tab. Use sample details. Demo records are separate from My bookings, airline systems and Stripe. Closing the tab clears the session.</p></aside>
    {error && <p className="account-error" role="alert">{error}</p>}
    {!demoId ? <><section className="demo-booking-panel"><h2>Start a demo reservation</h2><p>Choose a sample offer. The five-minute payment window starts when you reserve.</p><form onSubmit={event=>{event.preventDefault();create();}}><div className="demo-booking-fields"><label>Destination<select value={route} onChange={event=>{setRoute(event.target.value);setDate('');}}>{routes.map(value=><option key={value.code} value={value.code}>{value.city} · DAC → {value.code}</option>)}</select></label><label>Travel date<select required value={date} onChange={event=>setDate(event.target.value)}><option value="">Choose a date</option>{fare?.travelDates?.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Travellers<input type="number" required min={1} max={9} value={Number.isNaN(travellers)?'':travellers} onChange={event=>setTravellers(event.target.valueAsNumber)}/></label></div><p className="demo-booking-price">{formatMoney(String((fare?.amountPerPerson??0)*(Number.isFinite(travellers)?travellers:0)),fare?.currency??'BDT')} <small>demo total · taxes included</small></p><button className="btn-primary" type="submit">Reserve demo flight</button></form></section><section aria-label="Saved demo bookings"><h2>Your demo bookings</h2>{items.length ? items.map(value=><Link className="demo-booking-list-card" key={value.id} to={'/demo/bookings/'+value.id}><div><strong>Dhaka → {value.city}</strong><span>{value.departure} · {value.travellers} sample traveller{value.travellers===1?'':'s'}</span><small>{value.id}</small></div><div><strong>{formatMoney(String(value.amountPerPerson*value.travellers),value.currency)}</strong><span>{['HELD','PAYMENT_FAILED'].includes(value.status)&&Date.now()>=value.expiresAt ? labels.EXPIRED : labels[value.status]}</span><b>Manage demo</b></div></Link>) : <p>No demo bookings yet.</p>}</section></> : !booking ? <section className="demo-booking-panel"><h2>Demo booking not found</h2><p>Demo records exist only in the browser tab where you created them.</p><Link to="/demo/bookings">Start a new demo</Link></section> : <>
      <ol className="demo-booking-progress" aria-label="Demo booking progress">{['Reservation','Payment','Documents'].map((value,index)=><li key={value} className={index===0 || index===1&&paid || index===2&&booking.status==='TICKETED' ? 'is-complete' : ''}><span>{index+1}</span>{value}</li>)}</ol>
      <div className="demo-booking-layout"><div><section className="demo-booking-panel"><span className="demo-booking-status" role="status">{labels[booking.status]}</span><h2>Dhaka → {booking.city}</h2><p>DAC → {booking.destination} · One-way · {booking.departure}</p><dl className="demo-booking-facts"><div><dt>Sample passengers</dt><dd>{Array.from({length:booking.travellers},(_,index)=>`Demo traveller ${index+1}`).join(', ')}</dd></div><div><dt>Included baggage</dt><dd>20 kg checked · 7 kg cabin / person · demo allowance</dd></div><div><dt>Demo reference</dt><dd>{booking.id}</dd></div></dl><small>Illustrative offer. No real airline PNR, schedule or ticket is created.</small></section>
      <section className="demo-booking-panel"><h2>{paid ? 'Payment & documents' : 'Demo payment'}</h2>
        {payable && <><p>No card or bank details needed. Choose the payment outcome you want to test.</p><label>Test payment outcome<select value={outcome} onChange={event=>setOutcome(event.target.value as typeof outcome)}><option value="PAY_SUCCESS">Successful payment</option><option value="PAY_FAILURE">Declined payment</option><option value="PAY_PENDING">Pending confirmation</option></select></label><label className="demo-booking-check"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>I reviewed the demo total and sample passengers.</label><button className="btn-primary" disabled={!reviewed} onClick={()=>act(outcome)}>Pay {formatMoney(String(booking.amountPerPerson*booking.travellers),booking.currency)} · demo</button></>}
        {booking.status==='PAYMENT_PENDING' && <><p>Payment is pending. A second payment is blocked until the first outcome is known.</p><div className="demo-booking-actions"><button className="btn-primary" onClick={()=>act('RESOLVE_SUCCESS')}>Simulate approval</button><button className="account-outline-button" onClick={()=>act('RESOLVE_FAILURE')}>Simulate failure</button></div></>}
        {booking.status==='PAID' && <><p>Demo payment approved. Payment and ticket documents are separate steps.</p><button className="btn-primary" onClick={()=>act('ISSUE')}>Prepare demo ticket document</button></>}
        {booking.status==='PAYMENT_REVIEW' && <p role="alert">The simulated payment arrived after the window expired. Ticket preparation is blocked. In the real flow, Flyseri must review the reservation or refund the payment.</p>}
        {booking.status==='TICKETED' && <><p>Your demo document is ready. It is not valid for travel.</p><button className="account-outline-button" onClick={()=>downloadText(booking.ticket+'.txt',`FLYSERI DEMO DOCUMENT · NOT VALID FOR TRAVEL\n${booking.ticket}\n${booking.id}\nDAC → ${booking.destination} · ${booking.departure}\nNo airline reservation or ticket was issued.`)}>Download demo document</button></>}
        {paid && <p><button className="account-outline-button" onClick={()=>downloadText(booking.id+'-demo-receipt.txt',demoBookingReceipt(booking))}>Download demo receipt</button></p>}
        {['EXPIRED','CANCELLED','REFUNDED'].includes(booking.status) && <p>{booking.status==='EXPIRED' ? 'This demo payment window is closed. No payment can be started.' : 'This demo booking is closed.'} <Link to="/demo/bookings">Start another demo</Link></p>}
      </section><section className="demo-booking-panel"><h2>Activity</h2><ol className="demo-booking-timeline">{booking.history.map((event,index)=><li key={index}><strong>{event.text}</strong><time>{new Date(event.at).toLocaleString()}</time></li>)}</ol></section></div>
      <aside><section className="demo-booking-panel demo-booking-summary"><h2>Price summary</h2><p><span>Fare / person</span><strong>{formatMoney(String(booking.amountPerPerson),booking.currency)}</strong></p><p><span>Travellers</span><strong>{booking.travellers}</strong></p><p><span>Taxes</span><strong>Included · demo</strong></p><p className="demo-booking-total"><span>Total</span><strong>{formatMoney(String(booking.amountPerPerson*booking.travellers),booking.currency)}</strong></p>{payable && <div className="demo-booking-timer"><span>Demo payment window</span><strong aria-label="Demo time remaining">{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</strong></div>}<small>Payment attempts: {booking.paymentAttempts}</small></section>
      {(payable || ['PAID','TICKETED','PAYMENT_REVIEW'].includes(booking.status)) && <section className="demo-booking-panel"><h2>Changes & cancellation</h2><p>{paid ? 'Try a simulated full refund. Real bookings require airline rules and staff review.' : 'Cancel this unpaid demo reservation.'}</p><label className="demo-booking-check"><input type="checkbox" checked={confirmCancel} onChange={event=>setConfirmCancel(event.target.checked)}/>I confirm this demo {paid?'refund':'cancellation'}.</label><button className="account-outline-button" disabled={!confirmCancel} onClick={()=>act(paid?'REFUND':'CANCEL')}>{paid?'Simulate refund & cancellation':'Cancel demo reservation'}</button></section>}</aside></div>
    </>}
  </main></div>;
}
