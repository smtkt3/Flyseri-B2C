import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { CustomerProfile, DocumentSummary, FlightBookingIntent, OrderSummary, PaymentSummary, TripSummary, VisaApplicationSummary } from '@flyseri/types';
import type { PopularCachedFlightFare } from '@flyseri/types';
import { useAuth } from '../../auth/AuthProvider';
import { customerService } from '../../services/customerService';
import { tripService } from '../../services/tripService';
import { commerceService } from '../../services/commerceService';
import { documentService } from '../../services/documentService';
import { visaService } from '../../services/visaService';
import { flightService } from '../../services/flightService';
import { AirportPicker } from '../../flight/AirportPicker';
import { CalendarDateField } from '../CalendarDateField';
import { useViewportPopover } from '../useViewportPopover';
import { cabinOptions } from '../../flight/flightPresentation';
import { PremiumNavbar } from '../PremiumNavbar';
import { BrandMark } from '../BrandMark';
import { destinations, stories } from './marketingContent';
import { destinationLabel, displayDate, displayTripTitle, tripGroup } from '../../trip/tripPresentation';
import './premium-home.css';
import './premium-reference.css';
import './premium-services.css';
import './premium-cards.css';

const photo = (id: string, width = 800) => `https://images.unsplash.com/${id}?w=${width}&q=82&fit=crop&auto=format`;
const tripPhotos: Record<string, string> = {
  JP: 'photo-1492571350019-22de08371fd3', GR: 'photo-1570077188670-e3a8d69ac5ff',
  ID: 'photo-1537996194471-e657df975ab4', FR: 'photo-1502602898657-3e91760cbb34',
  AE: 'photo-1512453979798-5ea266f8880c', TH: 'photo-1563492065599-3520f775eeed',
};
type Overview = { profile: CustomerProfile | null; trips: TripSummary[]; orders: OrderSummary[]; payments: PaymentSummary[];
  documents: DocumentSummary[]; visas: VisaApplicationSummary[]; intent: FlightBookingIntent | null };
const empty: Overview = { profile: null, trips: [], orders: [], payments: [], documents: [], visas: [], intent: null };
async function safe<T>(promise: Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try { return { value: await promise, failed: false }; } catch { return { value: fallback, failed: true }; }
}
function relevantTrip(trips: TripSummary[]) {
  const rank = (trip: TripSummary) => tripGroup(trip) === 'Upcoming' ? 0 : tripGroup(trip) === 'Planning' ? 1 : 2;
  return [...trips].sort((a, b) => rank(a) - rank(b) || (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'))[0];
}
function useOverview(enabled: boolean) {
  const [data, setData] = useState<Overview>(empty);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) { setData(empty); setLoading(false); setError(false); return; }
    let active = true;
    setLoading(true); setError(false);
    void (async () => {
      const [profile, trips, orders, payments, documents] = await Promise.all([
        safe(customerService.me(), null), safe(tripService.list(), [] as TripSummary[]),
        safe(commerceService.orders(), [] as OrderSummary[]), safe(commerceService.payments(), [] as PaymentSummary[]),
        safe(documentService.list(), [] as DocumentSummary[]),
      ]);
      const trip = relevantTrip(trips.value);
      const [visas, intents] = trip ? await Promise.all([
        safe(visaService.list(trip.id), [] as VisaApplicationSummary[]),
        safe(flightService.intentsForTrip(trip.id), [] as FlightBookingIntent[]),
      ]) : [{ value: [] as VisaApplicationSummary[], failed: false }, { value: [] as FlightBookingIntent[], failed: false }];
      if (!active) return;
      const intent = [...intents.value].filter((item) => !['CANCELLED', 'EXPIRED'].includes(item.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
      setData({ profile: profile.value, trips: trips.value, orders: orders.value, payments: payments.value,
        documents: documents.value, visas: visas.value, intent });
      setError([profile, trips, orders, payments, documents, visas, intents].some((item) => item.failed));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [enabled, attempt]);
  return { data, loading, error, reload: () => setAttempt((value) => value + 1) };
}

function Glass({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`premium-glass ${className}`}>{children}</div>; }
function Heading({ eyebrow, title, action, to }: { eyebrow?: string; title: string; action?: string; to?: string }) {
  return <div className="premium-heading"><div>{eyebrow && <span className="premium-eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action && to && <Link to={to}>{action} →</Link>}</div>;
}
function MenuIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

type ServiceKind = 'flight' | 'hotels' | 'attractions' | 'packages' | 'visa' | 'esim';
function ServiceIcon({ kind }: { kind: ServiceKind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'flight' && <><path d="m21 3-8.5 18-2.7-7-6.8-2.5L21 3Z" /><path d="M9.8 14 21 3" /></>}
    {kind === 'hotels' && <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-5h4v5" /></>}
    {kind === 'attractions' && <path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z" />}
    {kind === 'packages' && <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10" /></>}
    {kind === 'visa' && <><rect x="4" y="2.5" width="16" height="19" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M8.5 12h7M12 8.5c1.5 2 1.5 5 0 7" /></>}
    {kind === 'esim' && <><rect x="5" y="2" width="14" height="20" rx="3" /><rect x="8" y="7" width="8" height="8" rx="1" /><path d="M10 18h4" /></>}
  </svg>;
}


function ServiceSidebar({ expanded, onToggle, onNavigate }: { expanded: boolean; onToggle: () => void; onNavigate: () => void }) {
  const services: Array<{ name: string; kind: ServiceKind; active?: boolean; soon?: boolean; to?: string }> = [
    { name: 'Flight', kind: 'flight', active: true },
    { name: 'Hotels', kind: 'hotels', soon: true },
    { name: 'Attractions', kind: 'attractions', soon: true },
    { name: 'Packages', kind: 'packages', soon: true },
    { name: 'Visa', kind: 'visa', to: '/app/visa' },
    { name: 'E-SIM', kind: 'esim', soon: true },
  ];
  return <aside className="premium-service-sidebar" aria-label="Travel services"><button type="button" className="premium-service-sidebar-toggle" onClick={onToggle} aria-label={expanded ? 'Collapse travel services' : 'Expand travel services'} aria-expanded={expanded} aria-controls="premium-services-nav"><span className="premium-service-sidebar-toggle-icon"><MenuIcon /></span><span className="premium-service-sidebar-toggle-text">{expanded ? 'Travel services' : 'Menu'}</span><span className="premium-service-sidebar-toggle-chevron" aria-hidden="true">‹</span></button><nav id="premium-services-nav" aria-label="Travel services">{services.map((service) => {
    const content = <><span className="premium-service-sidebar-icon"><ServiceIcon kind={service.kind} /></span><span className="premium-service-sidebar-label">{service.name}</span>{service.soon && <small>Soon</small>}</>;
    return service.to ? <Link key={service.name} to={service.to} className="premium-service-sidebar-item" aria-label={service.name} title={service.name} onClick={onNavigate}>{content}</Link>
      : service.active ? <a key={service.name} href="#book" className="premium-service-sidebar-item active" aria-label={service.name} title={service.name} aria-current="page" onClick={onNavigate}>{content}</a>
        : <div key={service.name} className="premium-service-sidebar-item unavailable" aria-label={service.name + ', coming soon'} title={service.name + ' · Coming soon'}>{content}</div>;
  })}</nav></aside>;
}

function SeriQuickInput() {
  const navigate=useNavigate();
  const {session}=useAuth();
  const [question,setQuestion]=useState('');
  function openSeri(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!question.trim())return;
    navigate('/app/seri?'+new URLSearchParams({draft:question.trim()}).toString());
  }
  return <section className="premium-seri-entry" aria-labelledby="premium-seri-entry-title"><div className="premium-seri-entry-heading"><span className="premium-seri-entry-icon" aria-hidden="true">✦</span><div><h2 id="premium-seri-entry-title">Plan your journey with Seri</h2><p>Your AI travel assistant · {session ? 'Ask about flights, trips and travel plans.' : 'Sign in to continue your conversation.'}</p></div></div><form onSubmit={openSeri}><label className="sr-only" htmlFor="premium-seri-question">Ask Seri a travel question</label><input id="premium-seri-question" type="text" maxLength={4000} value={question} onChange={event=>setQuestion(event.target.value)} placeholder="Where shall we go?"/><button type="submit" disabled={!question.trim()}>Ask Seri <span aria-hidden="true">↗</span></button></form></section>;
}

function SearchPanel() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY'>('ROUND_TRIP');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departure, setDeparture] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [multiLegs, setMultiLegs] = useState([{ origin: '', destination: '', departureDate: '' }, { origin: '', destination: '', departureDate: '' }]);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabin, setCabin] = useState('ECONOMY');
  const [passengerPickerOpen, setPassengerPickerOpen] = useState(false);
  const passengerPicker = useRef<HTMLDivElement>(null);
  const passengerTrigger = useRef<HTMLButtonElement>(null);
  const passengerPopover = useRef<HTMLElement>(null);
  const passengerPopoverStyle = useViewportPopover(passengerPickerOpen, passengerTrigger, { width: 380, height: 480, mobileSheet: true });
  const [error, setError] = useState('');
  const today = new Date();
  const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const code = (value: string) => value.trim().toUpperCase().match(/\(([A-Z]{3})\)$/)?.[1] ?? value.trim().toUpperCase();
  useEffect(() => {
    if (!passengerPickerOpen) return;
    const dismiss = (event: MouseEvent) => { if (!passengerPicker.current?.contains(event.target as Node) && !passengerPopover.current?.contains(event.target as Node)) setPassengerPickerOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPassengerPickerOpen(false); passengerTrigger.current?.focus(); } };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [passengerPickerOpen]);
  const passengerLabel = `${adults} ${adults === 1 ? 'adult' : 'adults'}${children ? ` · ${children} ${children === 1 ? 'child' : 'children'}` : ''}${infants ? ` · ${infants} ${infants === 1 ? 'infant' : 'infants'}` : ''}`;
  function updatePassenger(kind: 'adults' | 'children' | 'infants', delta: number) {
    if (kind === 'adults') { const next = Math.max(1, Math.min(9 - children - infants, adults + delta)); setAdults(next); if (infants > next) setInfants(next); }
    if (kind === 'children') setChildren((count) => Math.max(0, Math.min(8, count + delta, 9 - adults - infants)));
    if (kind === 'infants') setInfants((count) => Math.max(0, Math.min(adults, count + delta, 9 - adults - children)));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const from = code(origin), to = code(destination);
    if (mode === 'MULTI_CITY') {
      const legs = multiLegs.map((leg) => ({ origin: code(leg.origin), destination: code(leg.destination), departureDate: leg.departureDate }));
      const valid = legs.length >= 2 && legs.length <= 6 && legs.every((leg, index) => /^[A-Z]{3}$/.test(leg.origin) && /^[A-Z]{3}$/.test(leg.destination) && leg.origin !== leg.destination && !!leg.departureDate && leg.departureDate >= minimumDate && (!index || (legs[index - 1]!.destination === leg.origin && legs[index - 1]!.departureDate <= leg.departureDate)));
      if (!valid) { setError('Complete each flight leg. Connect each city to the next and choose dates in order.'); return; }
      const params = new URLSearchParams({ origin: legs[0]!.origin, destination: legs.at(-1)!.destination, departureDate: legs[0]!.departureDate, tripType: mode,
        legs: JSON.stringify(legs), adults: String(adults), children: String(children), infants: String(infants), cabin, autoSearch: '1' });
      navigate(`/flights?${params}`); return;
    }
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to || !departure || departure < minimumDate ||
      (mode === 'ROUND_TRIP' && (!returnDate || returnDate < departure))) {
      setError('Choose two different airports and valid dates from today onward.'); return;
    }
    const params = new URLSearchParams({ origin: from, destination: to, departureDate: departure, tripType: mode,
      adults: String(adults), children: String(children), infants: String(infants), cabin, autoSearch: '1' });
    if (mode === 'ROUND_TRIP') params.set('returnDate', returnDate);
    navigate(`/flights?${params}`);
  }
  return <Glass className="premium-search">
    <div className="premium-search-top">
      <div className="premium-search-intro"><span className="premium-eyebrow">FLIGHT SEARCH</span><strong>Where would you like to go?</strong></div>
      <div className="premium-search-options">
        <fieldset className="premium-trip-types" aria-label="Trip type"><legend className="sr-only">Trip type</legend>{([['ONE_WAY','One-way'],['ROUND_TRIP','Return'],['MULTI_CITY','Multi-city']] as const).map(([value,label]) => <label key={value}><input type="radio" name="home-trip-type" value={value} checked={mode === value} onChange={() => setMode(value)} /><span>{label}</span></label>)}</fieldset>
        <div className="premium-passenger-control" ref={passengerPicker}>
          <button ref={passengerTrigger} type="button" className="premium-passenger-trigger" aria-label={`Passengers and cabin: ${passengerLabel}, ${cabinOptions.find(option => option.value === cabin)?.label ?? 'Economy'}`} aria-haspopup="dialog" aria-expanded={passengerPickerOpen} onClick={() => setPassengerPickerOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.5-4 2.8-6 7-6s6.5 2 7 6"/></svg><span>{passengerLabel}</span><small className="premium-passenger-cabin-label">{cabinOptions.find(option => option.value === cabin)?.label}</small><span className="premium-passenger-arrow" aria-hidden="true">⌄</span>
          </button>
          {passengerPickerOpen && createPortal(<section ref={passengerPopover} style={passengerPopoverStyle} className="premium-passenger-popover premium-passenger-portal" role="dialog" aria-label="Passengers and cabin">
            <div className="premium-passenger-popover-head"><span aria-hidden="true">♟</span><strong>{passengerLabel}</strong></div>
            <p className="premium-passenger-hint">Please select the exact number of passengers to view the best prices.</p>
            {[{ key: 'adults' as const, label: 'Adults', age: '12+ years old', count: adults, min: 1, max: 9 - children - infants },
              { key: 'children' as const, label: 'Children', age: '2–11 years old', count: children, min: 0, max: Math.min(8, 9 - adults - infants) },
              { key: 'infants' as const, label: 'Infants on lap', age: 'Under 2 years old', count: infants, min: 0, max: Math.min(adults, 9 - adults - children) }].map((item) => <div className="premium-passenger-row" key={item.key}>
              <span className="premium-passenger-description"><strong>{item.label}</strong><small>{item.age}</small></span>
              <div className="premium-passenger-counter"><button type="button" aria-label={`Remove ${item.label.toLowerCase()}`} disabled={item.count <= item.min} onClick={() => updatePassenger(item.key, -1)}>−</button><output aria-label={item.label}>{item.count}</output><button type="button" aria-label={`Add ${item.label.toLowerCase()}`} disabled={item.count >= item.max} onClick={() => updatePassenger(item.key, 1)}>＋</button></div>
            </div>)}
            <label className="premium-passenger-cabin">Cabin<select value={cabin} onChange={event => setCabin(event.target.value)}>{cabinOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <button type="button" className="premium-passenger-done" onClick={() => { setPassengerPickerOpen(false); passengerTrigger.current?.focus(); }}>Done</button>
          </section>, document.body)}
        </div>
      </div>
    </div>
    <form className={`premium-search-fields${mode === 'MULTI_CITY' ? ' is-multi-city' : ''}`} onSubmit={submit}>
      {mode === 'MULTI_CITY' ? <div className="premium-multi-city-legs" role="group" aria-label="Multi-city flight legs">{multiLegs.map((leg,index) => <div className="premium-multi-city-row" key={index}><span className="premium-leg-number">{index + 1}</span><AirportPicker label="From" value={leg.origin} onChange={(value) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, origin: value } : item))} /><AirportPicker label="To" value={leg.destination} onChange={(value) => { const valueCode = code(value); setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, destination: value } : mode === 'MULTI_CITY' && i === index + 1 && valueCode.length === 3 ? { ...item, origin: valueCode } : item)); }} /><CalendarDateField label={`Flight ${index + 1} date`} className="premium-leg-date" minDate={index ? multiLegs[index - 1]!.departureDate || minimumDate : minimumDate} value={leg.departureDate} onChange={(departureDate) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, departureDate } : item))} />{multiLegs.length > 2 && <button className="premium-remove-leg" type="button" aria-label={`Remove flight ${index + 1}`} onClick={() => setMultiLegs((items) => items.filter((_,i) => i !== index))}>×</button>}</div>)}{multiLegs.length < 6 && <button type="button" className="premium-add-leg" onClick={() => setMultiLegs((items) => [...items, { origin: code(items.at(-1)!.destination), destination: '', departureDate: '' }])}>＋ Add another flight</button>}</div> : <>
      <div className="premium-search-route" role="group" aria-label="Flight route">
        <AirportPicker label="From" value={origin} onChange={setOrigin} />
        <button type="button" className="premium-swap" aria-label="Swap airports" onClick={() => { setOrigin(destination); setDestination(origin); }}>⇄</button>
        <AirportPicker label="To" value={destination} onChange={setDestination} />
      </div>
      <div className={`premium-search-dates${mode === 'ONE_WAY' ? ' one-way' : ''}`}>
        <CalendarDateField label="Departure" className="premium-home-date-field" minDate={minimumDate} value={departure} onChange={(next) => { setDeparture(next); if (returnDate && returnDate < next) setReturnDate(''); }} />
        {mode === 'ROUND_TRIP' && <CalendarDateField label="Return" className="premium-home-date-field" align="end" minDate={departure || minimumDate} value={returnDate} onChange={setReturnDate} />}
      </div>
      </>}
      <button type="submit" className="premium-primary"><span aria-hidden="true">⌕</span> Search flights</button>
    </form>
    {error && <p className="premium-form-error" role="alert">{error}</p>}
    <p className="premium-disclaimer">Search live fares. Sign in to book. Prices are confirmed at fare check.</p>
  </Glass>;
}

function TripCard({ trip, loading, signedIn }: { trip?: TripSummary; loading: boolean; signedIn: boolean }) {
  const tripPhoto = trip && tripPhotos[trip.primaryDestination?.countryCode ?? ''];
  return <Glass className="premium-trip-card"><Heading title="Upcoming trip" action="View all" to="/app/trips" />{loading ? <div className="premium-skeleton premium-trip-skeleton" role="status" aria-label="Loading trips" /> : trip ? <><div className="premium-trip-photo" style={tripPhoto ? { backgroundImage: `url(${photo(tripPhoto)})` } : undefined}><span>{tripGroup(trip)}</span>{!tripPhoto && <svg className="premium-trip-illustration" viewBox="0 0 500 160" fill="none" aria-hidden="true"><circle cx="390" cy="44" r="27" fill="white" fillOpacity=".25"/><path d="M0 130 90 70l75 48 70-75 110 76 62-34 93 45v30H0Z" fill="white" fillOpacity=".22"/><path d="M58 104c90-100 216 72 372-44" stroke="white" strokeOpacity=".75" strokeWidth="2" strokeDasharray="6 7"/><path d="m291 65 28-10-11 27-5-12-12-5Z" fill="white"/></svg>}</div><div className="premium-trip-body"><h3>{displayTripTitle(trip)}</h3><p>{destinationLabel(trip)}</p><small>{trip.startDate ? `${displayDate(trip.startDate)}${trip.endDate ? ` – ${displayDate(trip.endDate)}` : ''}` : 'Dates to be decided'} · {trip.travellerCount} {trip.travellerCount === 1 ? 'traveller' : 'travellers'}</small><Link className="premium-circle-link" to={`/app/trips/${trip.id}`} aria-label={`Open ${displayTripTitle(trip)}`}>→</Link></div><div className="premium-trip-actions"><Link to={`/app/trips/${trip.id}`}>✧ Manage</Link><Link to={`/app/trips/${trip.id}`}>▦ Itinerary</Link><Link to={`/app/trips/${trip.id}/visa`}>◇ Visa</Link></div></> : <div className="premium-trip-empty"><div className="premium-trip-empty-photo" aria-hidden="true" /><div className="premium-trip-empty-copy"><h3>No trips yet</h3><p>{signedIn ? 'Start with a destination. Dates and companions can come later.' : 'Sign in to see your journeys in one place.'}</p><Link to={signedIn ? '/app/trips/new' : '/sign-in'}>{signedIn ? 'Plan a trip' : 'Sign in'} →</Link></div></div>}</Glass>;
}
const fareMapDestinations: Record<string, { city: string; country: string; lat: number; lon: number; group: 'Popular with Malaysians' | 'Worker routes' }> = {
  BKK:{city:'Bangkok',country:'Thailand',lat:13.69,lon:100.75,group:'Popular with Malaysians'}, SIN:{city:'Singapore',country:'Singapore',lat:1.36,lon:103.99,group:'Popular with Malaysians'},
  CGK:{city:'Jakarta',country:'Indonesia',lat:-6.13,lon:106.66,group:'Popular with Malaysians'}, DPS:{city:'Bali',country:'Indonesia',lat:-8.75,lon:115.17,group:'Popular with Malaysians'},
  SGN:{city:'Ho Chi Minh City',country:'Vietnam',lat:10.82,lon:106.65,group:'Popular with Malaysians'}, NRT:{city:'Tokyo',country:'Japan',lat:35.77,lon:140.39,group:'Popular with Malaysians'},
  KIX:{city:'Osaka',country:'Japan',lat:34.43,lon:135.24,group:'Popular with Malaysians'}, TPE:{city:'Taipei',country:'Taiwan',lat:25.08,lon:121.23,group:'Popular with Malaysians'},
  MNL:{city:'Manila',country:'Philippines',lat:14.51,lon:121.02,group:'Popular with Malaysians'}, DAC:{city:'Dhaka',country:'Bangladesh',lat:23.84,lon:90.40,group:'Worker routes'},
  CGP:{city:'Chattogram',country:'Bangladesh',lat:22.25,lon:91.81,group:'Worker routes'}, KTM:{city:'Kathmandu',country:'Nepal',lat:27.70,lon:85.36,group:'Worker routes'},
  CMB:{city:'Colombo',country:'Sri Lanka',lat:7.18,lon:79.88,group:'Worker routes'}, KHI:{city:'Karachi',country:'Pakistan',lat:24.91,lon:67.16,group:'Worker routes'},
  CCU:{city:'Kolkata',country:'India',lat:22.65,lon:88.45,group:'Worker routes'}, MAA:{city:'Chennai',country:'India',lat:12.99,lon:80.17,group:'Worker routes'},
};
type MapSize = { width: number; height: number };
function projectMapPoint(lon: number, lat: number, size: MapSize, zoom = 2) {
  const world = 256 * 2 ** zoom;
  const centerX = (95 + 180) / 360 * world;
  const centerLat = 19 * Math.PI / 180;
  const centerY = (1 - Math.asinh(Math.tan(centerLat)) / Math.PI) / 2 * world;
  const y = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  return { x: (lon + 180) / 360 * world - centerX + size.width / 2,
    y: (1 - Math.asinh(Math.tan(y)) / Math.PI) / 2 * world - centerY + size.height / 2 };
}
function RouteCard() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapSize>({width:600,height:220});
  const [fares, setFares] = useState<PopularCachedFlightFare[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void flightService.popularCachedFares().then((items) => { if (mounted) { setFares(items.filter((item) => fareMapDestinations[item.destination])); setActive(0); } }).catch(() => { if (mounted) setFares([]); }); };
    refresh(); const id = window.setInterval(refresh, 45_000);
    return () => { mounted = false; window.clearInterval(id); };
  }, []);
  useEffect(() => {
    const element = mapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({width:Math.max(1,entry.contentRect.width),height:Math.max(1,entry.contentRect.height)}); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (fares.length < 2) return;
    const id = window.setInterval(() => setActive((value) => (value + 1) % fares.length), 6500);
    return () => window.clearInterval(id);
  }, [fares.length]);
  const zoom=2, world=256*2**zoom, centerX=(95+180)/360*world, centerLat=19*Math.PI/180, centerY=(1-Math.asinh(Math.tan(centerLat))/Math.PI)/2*world;
  const left=centerX-size.width/2, top=centerY-size.height/2, firstX=Math.floor(left/256), lastX=Math.floor((left+size.width)/256), firstY=Math.max(0,Math.floor(top/256)), lastY=Math.min(2**zoom-1,Math.floor((top+size.height)/256));
  const tiles=[];
  for(let y=firstY;y<=lastY;y++)for(let x=firstX;x<=lastX;x++){const wrapped=((x%(2**zoom))+(2**zoom))%(2**zoom);tiles.push({x:wrapped,y,left:x*256-left,top:y*256-top});}
  const selected=fares.length?fares[active%fares.length]:undefined, origin=projectMapPoint(101.7,2.75,size,zoom), target=selected?projectMapPoint(fareMapDestinations[selected.destination]!.lon,fareMapDestinations[selected.destination]!.lat,size,zoom):undefined;
  const searchUrl=selected?`/flights?${new URLSearchParams({origin:'KUL',destination:selected.destination,departureDate:selected.departureDate,tripType:'ONE_WAY',adults:'1',children:'0',infants:'0',cabin:'ECONOMY',currency:selected.currency})}`:'/flights';
  return <Glass className="premium-route-card premium-fare-map-card"><div className="premium-real-map" ref={mapRef} role="group" aria-label={`Map showing cached one-way fares from Kuala Lumpur${selected?` to ${fareMapDestinations[selected.destination]!.city}, MYR ${selected.price}`:''}`}>
    <div className="premium-map-tiles" aria-hidden="true">{tiles.map((tile)=><img key={`${tile.x}-${tile.y}`} alt="" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} style={{left:tile.left,top:tile.top}} />)}</div>
    <svg className="premium-fare-routes" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">{target&&<path d={`M ${origin.x} ${origin.y} Q ${(origin.x+target.x)/2} ${Math.min(origin.y,target.y)-28} ${target.x} ${target.y}`} />}</svg>
    {fares.map((fare,index)=>{const point=projectMapPoint(fareMapDestinations[fare.destination]!.lon,fareMapDestinations[fare.destination]!.lat,size,zoom);return <span key={fare.destination} className={`premium-fare-dot${index===active?' is-active':''}`} style={{left:point.x,top:point.y}} title={`${fareMapDestinations[fare.destination]!.city}: RM ${fare.price}`} />;})}
    <span className="premium-kul-dot" style={{left:origin.x,top:origin.y}} aria-hidden="true"><i/>KUL</span>
    {selected&&target&&<Link className="premium-map-fare-popup" to={searchUrl} style={{left:target.x,top:target.y}} aria-label={`Check one-way cached fare to ${fareMapDestinations[selected.destination]!.city}, MYR ${selected.price}`}><span>{fareMapDestinations[selected.destination]!.city}</span><strong>MYR {Number(selected.price).toFixed(0)}</strong><small>{displayDate(selected.departureDate)} · Check ↗</small></Link>}
    <a className="premium-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
  </div></Glass>;
}
function ExclusiveAirlineOffers() {
  const offers = [
    { route: 'Kuala Lumpur → Dhaka', code: 'KUL → DAC', price: 'MYR 699', note: 'Group fare example' },
    { route: 'Kuala Lumpur → Bangkok', code: 'KUL → BKK', price: 'MYR 499', note: 'Group fare example' },
    { route: 'Kuala Lumpur → Bali', code: 'KUL → DPS', price: 'MYR 599', note: 'Group fare example' },
  ];
  return <Glass className="premium-selection-card premium-exclusive-offers">
    <Heading title="Exclusive Airline Offers" />
    <p className="premium-offers-caption">Sample group fares · not bookable</p>
    <div className="premium-offers-window" aria-label="Example group fares" role="region">
      <p className="premium-visually-hidden">Demo prices: Kuala Lumpur to Dhaka MYR 699, Kuala Lumpur to Bangkok MYR 499, and Kuala Lumpur to Bali MYR 599. These are examples, not available offers.</p>
      <div className="premium-offers-track" aria-hidden="true">
        {[...offers, ...offers].map((offer, index) => <article className="premium-offer-item" key={`${offer.code}-${index}`}>
          <span className="premium-offer-plane" aria-hidden="true">✈</span>
          <div className="premium-offer-route"><strong>{offer.route}</strong><small>{offer.code} · {offer.note}</small></div>
          <strong className="premium-offer-price">{offer.price}</strong>
        </article>)}
      </div>
    </div>
    <p className="premium-offers-note">Prices shown are demo content. Exclusive group tickets will appear here when published.</p>
  </Glass>;
}

export function PremiumHome({ embedded = false }: { embedded?: boolean }) {
  const { session } = useAuth();
  const [servicesExpanded, setServicesExpanded] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 761px)').matches,
  );
  useEffect(() => {
    if (!servicesExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setServicesExpanded(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [servicesExpanded]);
  const { data, loading, error, reload } = useOverview(!!session);
  const trip = relevantTrip(data.trips);
  const name = data.profile?.displayName?.trim() || session?.user.email?.split('@')[0] || null;
  const pending = data.payments.filter((payment) => ['CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN'].includes(payment.status)).length;
  const review = data.documents.filter((document) => document.status === 'REVIEW_REQUIRED').length;
  return <div className={`premium-site${embedded ? ' premium-embedded' : ''}`}>
    <div className={`premium-home-layout${embedded ? ' is-embedded' : ''}${servicesExpanded ? ' services-open' : ''}`}>{!embedded && <><ServiceSidebar expanded={servicesExpanded} onToggle={() => setServicesExpanded((value) => !value)} onNavigate={() => setServicesExpanded(false)} /><button type="button" className="premium-service-backdrop" aria-label="Close travel services" onClick={() => setServicesExpanded(false)} /></>}<div className="premium-home-main">
    {!embedded && <PremiumNavbar name={name} servicesExpanded={servicesExpanded} onToggleServices={() => setServicesExpanded((value) => !value)} />}
    <main>
      <section className="premium-hero" id="book"><div className="premium-hero-photo" role="img" aria-label="White buildings and blue domes above the sea in Santorini"/><div className="premium-hero-content"><p className="premium-eyebrow">DISCOVER A BRIGHTER TOMORROW</p><h1>Travel Farther<br /><em>With Flyseri</em></h1><p>Beautiful journeys begin with a simple idea. Search flights, shape your plans, and keep every detail close.</p><div className="premium-trust"><span>✓ Live flight search</span><span>✓ Your plans in one place</span><span>✓ Travel documents together</span></div></div><div className="premium-hero-script" aria-hidden="true">More<br />than a Trip <span>↗</span><small>New Places<br />Brighter Stories</small></div><div className="premium-hero-note"><img src={photo('photo-1560703649-e3055f28bcf8', 100)} alt="" /><span>Santorini, Greece</span><b>›</b></div></section>
      <div className="premium-container premium-overlap"><SearchPanel /></div>
      <div className="premium-container premium-main">
        <SeriQuickInput />
        {session && error && <div className="premium-inline-error" role="alert">Some of your travel details could not be loaded. <button onClick={reload}>Try again</button></div>}
        <div className="premium-journey-grid"><TripCard trip={trip} loading={loading && !!session} signedIn={!!session} /><RouteCard /><ExclusiveAirlineOffers /></div>
        <section className="premium-featured"><Heading title="Featured flight options" action="View all flights" to="/flights" /><div className="premium-flight-steps">
          <Link to="/flights"><span>✈</span><div><strong>Search your route</strong><small>Choose airports and dates</small></div><b>›</b></Link>
          <Link to="/flights"><span>⌁</span><div><strong>Compare live flights</strong><small>See current fares and stops</small></div><b>›</b></Link>
          <Link to="/flights"><span>◇</span><div><strong>Review your selection</strong><small>Check the fare before an order</small></div><b>›</b></Link>
        </div><p className="premium-editorial-note">Flight options appear after a live search. No sample fares are shown.</p></section>
        <section id="explore"><Heading eyebrow="PLACES TO IMAGINE" title="Top destinations" action="Plan a trip" to="/app/trips/new" /><div className="premium-destination-grid">{destinations.map((place) => <Link className="premium-destination" key={place.city} to={`/flights?destination=${place.code}`}><img src={photo(place.image, 500)} alt={`Travel scenery in ${place.city}`} loading="lazy" /><div><strong>{place.city}</strong><small>{place.country}</small><span aria-hidden="true">↗</span></div></Link>)}</div><p className="premium-editorial-note">Destination ideas are editorial. Flight prices appear only after a live search.</p></section>
        <div className="premium-two-grid premium-market-grid" id="deals">
          <section className="premium-deals"><Heading title="Deals & travel ideas" action="Search live fares" to="/flights" />
            <div className="premium-story-grid">{stories.map((story) => <Link to={`/flights?destination=${story.code}`} className="premium-story" key={story.title}><img src={photo(story.image, 600)} alt="" loading="lazy" /><div><strong>{story.title}</strong><small>Editorial inspiration</small><span aria-hidden="true">›</span></div></Link>)}</div>
            <p className="premium-editorial-note">No promotions are currently announced.</p>
          </section>
        </div>
        <div className="premium-two-grid premium-help-grid"><section><Heading eyebrow="TRAVEL PREPARED" title="Visa, documents & travel help" /><div className="premium-help-cards"><Link to="/app/visa"><span>◇</span><strong>Visa assistance</strong><small>{session ? loading ? 'Loading your visa plans…' : `${data.visas.length} application${data.visas.length === 1 ? '' : 's'} for your current trip` : 'Sign in to plan applications'}</small></Link><Link to="/app/documents"><span>▤</span><strong>Travel documents</strong><small>{session ? loading ? 'Loading your documents…' : review ? `${review} need${review === 1 ? 's' : ''} review` : `${data.documents.length} saved document${data.documents.length === 1 ? '' : 's'}` : 'Your private document space'}</small></Link><Link to="/app/trips"><span>♡</span><strong>Travel guidance</strong><small>Keep requirements with your trip</small></Link><Link to="/app/travellers"><span>♧</span><strong>Travellers</strong><small>Manage your travel party</small></Link></div></section><section><Heading eyebrow="YOUR JOURNEY, YOUR WAY" title="Why travel with Flyseri" /><Glass className="premium-trust-card"><div>✦</div><p>Search flights, plan trips, choose travellers and keep visa and document details in one calm workspace.</p><span>Built around the journey you are planning.</span></Glass></section></div>
        <div className="premium-two-grid premium-bottom-grid"><section id="membership"><Glass className="premium-membership"><div><p className="premium-eyebrow">A LITTLE MORE TO LOOK FORWARD TO</p><h2>Flyseri<span>+</span></h2><p>A future home for rewards and member benefits. Membership is not live yet.</p><span className="premium-preview-badge">Preview</span></div><div className="premium-membership-art">✧</div></Glass></section><section><Glass className="premium-ai"><div className="premium-ai-orb">✦</div><div><p className="premium-eyebrow">YOUR TRAVEL COMPANION</p><h2>Meet Seri, your travel companion</h2><p>Ask about your trips, travel documents, payments and flight options in your Flyseri account.</p><Link className="premium-outline" to="/app/seri">Ask Seri →</Link></div></Glass></section></div>
        {session && <section className="premium-commerce"><Heading eyebrow="YOUR ACCOUNT" title="Orders & payments" action="View orders" to="/app/orders" /><Glass><div><strong>{loading ? 'Loading your account…' : `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}`}</strong><span>{loading ? 'Checking payment status…' : pending ? `${pending} payment${pending === 1 ? '' : 's'} awaiting an update` : 'No pending payment updates'}</span></div><Link className="premium-outline" to="/app/payments">View payments →</Link></Glass></section>}
        <section className="premium-support" id="support"><div><span className="premium-eyebrow">NEED A HAND?</span><h2>Your journey, all in one place.</h2><p>Manage plans, travellers and documents from your Flyseri account.</p></div><div><Link to="/app/trips">My Trips →</Link><Link to="/app/documents">Documents →</Link><Link to="/app/profile">My profile →</Link></div></section>
      </div>
    </main>{!embedded && <footer className="premium-footer"><div className="premium-container"><div><Link to="/" className="premium-logo" aria-label="Flyseri home"><BrandMark /></Link><p>Explore today. A brighter tomorrow.</p></div><div><strong>Explore</strong><Link to="/flights">Flights</Link><Link to="/app/trips">Trips</Link><Link to="/app/visa">Visa</Link></div><div><strong>Your account</strong><Link to="/app/documents">Documents</Link><Link to="/app/orders">Orders</Link><Link to="/app/profile">Profile</Link></div><div><strong>Support</strong><a href="#support">Travel help</a><Link to="/sign-in">Sign in</Link></div></div></footer>}</div></div></div>;
}
