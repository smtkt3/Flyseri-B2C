import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { HolidayBooking, HolidayPackage } from '@flyseri/types';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { useAuth } from '../auth/AuthProvider';
import { randomUUID } from '../lib/randomUUID';
import { previewHolidayPackages } from '../data/demo/holidayPackages';
import { HolidayPackages, HolidayPhotoCredit } from './HolidayPackages';
import { holidayMoney, holidayService } from './holidayService';
import './holiday.css';

export function HolidayCataloguePage() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return <div className="customer-site-shell holiday-page"><PremiumNavbar/><main className="holiday-page-main"><div className="holiday-breadcrumb"><Link to="/">Home</Link><span>/</span>Holidays</div><HolidayPackages full/><Link to="/holidays/bookings" className="holiday-bookings-link">View my holiday bookings →</Link></main></div>;
}
function PaxControl({ label, note, value, min, max, disabled, onChange }: { label: string; note: string; value: number; min: number; max: number; disabled?: boolean; onChange: (n: number) => void }) {
  return <div className="holiday-pax-row"><div><strong>{label}</strong><small>{note}</small></div><div className="holiday-stepper"><button type="button" aria-label={`Remove ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button><output aria-label={`${label} quantity`}>{value}</output><button type="button" aria-label={`Add ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button></div></div>;
}
export function HolidayDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { session, resolving } = useAuth();
  const [item, setItem] = useState<HolidayPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adults, setAdults] = useState(() => Math.min(50, Math.max(1, Math.floor(Number(params.get('adults')) || 1))));
  const [children, setChildren] = useState(() => Math.min(49, Math.max(0, Math.floor(Number(params.get('children')) || 0))));
  const [departureDate, setDepartureDate] = useState(params.get('date') || '');
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState<HolidayBooking | null>(null);
  const requestKey = useRef(randomUUID());
  const requestSignature = useRef('');
  useEffect(() => {
    window.scrollTo(0, 0);
    const controller = new AbortController(); setLoading(true); setItem(null); setError(''); setBooking(null); setReview(false);
    const preview = previewHolidayPackages.find(p => p.id === id);
    const request = preview ? Promise.resolve(preview) : holidayService.detail(id, controller.signal);
    request.then(p => { if (!controller.signal.aborted) setItem(p); }).catch(() => { if (!controller.signal.aborted) setError('This package could not be loaded. Please return to all packages and try again.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => { requestKey.current = randomUUID(); setReview(false); }, [id, adults, children, departureDate]);
  const dates = item?.departureDates.filter(date => date > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) || [];
  const total = item ? (Math.round(item.adultPrice * 100) * adults + Math.round(item.childPrice * 100) * children) / 100 : 0;
  function beginReview(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!item || !dates.includes(departureDate) || adults + children > item.maxPax) return;
    setParams({ adults: String(adults), children: String(children), date: departureDate }, { replace: true });
    if (!session) { navigate('/sign-in', { state: { from: `/holidays/${id}?adults=${adults}&children=${children}&date=${departureDate}` } }); return; }
    setReview(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!item || item.preview || saving) return;
    const form = new FormData(event.currentTarget); setSaving(true); setError('');
    try {
      const input = { packageId: item.id, packageVersion: item.version, departureDate, adults, children, contactName: String(form.get('contactName')).trim(), email: String(form.get('email')).trim(), phone: String(form.get('phone')).trim() };
      const signature = JSON.stringify(input);
      if (requestSignature.current && requestSignature.current !== signature) requestKey.current = randomUUID();
      requestSignature.current = signature;
      const result = await holidayService.book({ ...input, idempotencyKey: requestKey.current });
      setBooking(result); setReview(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Your booking could not be sent. Please try again.'); }
    finally { setSaving(false); }
  }
  return <div className="customer-site-shell holiday-page"><PremiumNavbar/><main className="holiday-page-main"><div className="holiday-breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/holidays">Holidays</Link>{item && <><span>/</span>{item.location}</>}</div>
    {loading ? <p role="status">Opening your getaway…</p> : !item ? <div className="holiday-empty"><p role="alert">{error}</p><Link to="/holidays">All holiday packages →</Link></div> : <>
      <header className="holiday-detail-hero"><img src={item.imageUrl} alt={item.location}/><div><span className="holiday-tag">{item.category === 'DOMESTIC' ? 'Explore Bangladesh' : 'International escape'}</span><h1>{item.title}</h1><p>{item.location} <span>·</span> {item.days} days / {item.nights} nights</p></div></header>
      <HolidayPhotoCredit id={item.id}/>
      {item.preview && <p className="holiday-preview-note">Design preview · Images, itinerary and prices are illustrative. This package cannot be booked.</p>}
      <div className="holiday-detail-grid"><div className="holiday-detail-content"><section><span className="holiday-eyebrow">YOUR NEXT GOOD MEMORY</span><h2>A holiday to look forward to</h2><p>{item.summary}</p></section><section><h2>Your itinerary</h2><ol className="holiday-itinerary">{item.itinerary.map((day, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>Day {index + 1}</h3><p>{day}</p></div></li>)}</ol></section><div className="holiday-inclusions"><section><h2>What’s included</h2><ul>{item.inclusions.map(t => <li key={t}><span aria-hidden="true">✓</span>{t}</li>)}</ul></section><section><h2>Not included</h2><ul>{item.exclusions.map(t => <li key={t}><span aria-hidden="true">−</span>{t}</li>)}</ul></section></div><section><h2>Before you book</h2><p>Adult: 12 years and above. Child: 2–11 years at departure. For infants or special arrangements, contact our team before booking.</p><h3>Cancellation policy</h3><p>{item.cancellationPolicy}</p></section></div>
      <aside className="holiday-booking-panel" aria-label="Plan your package booking">
        {booking ? <div className="holiday-success" role="status"><span aria-hidden="true">✓</span><h2>Request received</h2><p>Your reference</p><strong>{booking.reference}</strong><p>{booking.adults + booking.children} travellers · {booking.departureDate}</p><p>{holidayMoney(booking.totalAmount)}</p><p>Pending confirmation. Our team will contact you to confirm availability and payment arrangements. No payment has been taken.</p><Link to="/holidays/bookings">View my bookings →</Link></div> : <>
        <span className="holiday-eyebrow">{item.preview ? 'SAMPLE PACKAGE PRICE' : 'MAKE IT YOUR HOLIDAY'}</span><div className="holiday-booking-price"><strong>{holidayMoney(item.adultPrice)}</strong><span>/ adult</span></div><p className="holiday-small">Prices include the items listed in this package.</p>
        <form onSubmit={beginReview}><label className="holiday-field">Departure date<select required value={departureDate} disabled={saving} onChange={e => setDepartureDate(e.target.value)}><option value="">Choose your departure</option>{dates.map(date => <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</option>)}</select></label><PaxControl disabled={saving} label="Adults" note={`12+ years · ${holidayMoney(item.adultPrice)} each`} value={adults} min={1} max={item.maxPax - children} onChange={setAdults}/><PaxControl disabled={saving} label="Children" note={`2–11 years · ${holidayMoney(item.childPrice)} each`} value={children} min={0} max={item.maxPax - adults} onChange={setChildren}/><div className="holiday-total"><span>Total for {adults + children} pax</span><strong>{holidayMoney(total)}</strong></div><button className="holiday-primary" disabled={!!item.preview || saving || resolving || !dates.length || adults + children > item.maxPax} type="submit">{item.preview ? 'Preview only · not bookable' : session ? 'Review booking →' : 'Sign in to book →'}</button></form>
        {!item.preview && <p className="holiday-small">Subject to availability. Your request is confirmed by our team before payment.</p>}
        {review && <form className="holiday-contact-form" onSubmit={submit}><h3>Complete your booking request</h3><p className="holiday-small">{departureDate} · {adults} adult{adults !== 1 ? 's' : ''}{children ? ` · ${children} children` : ''}</p><label className="holiday-field">Contact name<input name="contactName" required minLength={2} maxLength={120} autoComplete="name" disabled={saving}/></label><label className="holiday-field">Email address<input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={session?.user.email || ''} disabled={saving}/></label><label className="holiday-field">Phone number<input name="phone" type="tel" required pattern="[+0-9 ()\-]{7,24}" autoComplete="tel" placeholder="+880" disabled={saving}/></label><label className="holiday-consent"><input required type="checkbox" disabled={saving}/>I have reviewed the itinerary, inclusions and cancellation policy. I understand this is a request awaiting confirmation.</label><button type="submit" className="holiday-primary" disabled={saving}>{saving ? 'Sending request…' : `Request booking · ${holidayMoney(total)}`}</button></form>}
        {error && <p role="alert" className="holiday-error">{error}</p>}
        </>}
        <Link className="holiday-help" to="/app/support">Need help planning? Contact our team ↗</Link>
      </aside></div>
    </>}
  </main></div>;
}
export function HolidayBookingsPage() {
  const [items, setItems] = useState<HolidayBooking[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; holidayService.bookings().then(value => { if (active) setItems(value); }).catch(() => { if (active) setError('Your holiday bookings could not be loaded. Please try again later.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return <div className="customer-site-shell holiday-page"><PremiumNavbar/><main className="holiday-page-main"><div className="holiday-section-heading"><div><span className="holiday-eyebrow">YOUR GETAWAYS</span><h1>My holiday bookings</h1></div><Link to="/holidays">Explore packages ↗</Link></div>{loading ? <p role="status">Loading bookings…</p> : error ? <p role="alert">{error}</p> : !items.length ? <div className="holiday-empty"><h2>Your next escape starts here</h2><p>You haven’t requested a holiday package yet.</p><Link to="/holidays">Find a holiday →</Link></div> : <div className="holiday-booking-list">{items.map(b => <article key={b.id}><span className="holiday-tag">{b.status.replace(/_/g, ' ')}</span><h2>{b.packageTitle}</h2><p>{b.departureDate} · {b.adults} adults · {b.children} children</p><strong>{holidayMoney(b.totalAmount)}</strong><small>Reference: {b.reference}</small>{b.status === 'PENDING_CONFIRMATION' && <p>Awaiting availability confirmation. No payment has been taken.</p>}</article>)}</div>}</main></div>;
}


