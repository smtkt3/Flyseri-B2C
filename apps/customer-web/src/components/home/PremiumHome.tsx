import { Chevron } from '../Chevron';
import { Translated } from '../../travel/language';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { CustomerProfile, DocumentSummary, FlightBookingIntent, OrderSummary, PaymentSummary, TripSummary, VisaApplicationSummary } from '@flyseri/types';
import type { HomeAirlineOffer } from './AirlineOfferDetails';
import { GroupFareDetails } from './GroupFareDetails';
import { useOfferAutoSlide } from './useOfferAutoSlide';
import { activeGroupFare, groupFareMoney } from './groupFares';
import { useHomeSearchField } from './homeSearchDraft';
import { HomeFeatureBoundary, HomeFeatureLoading } from './HomeFeatureBoundary';
import { DeferredHomeSeriSearch } from './DeferredHomeSeriSearch';
import { useBackStepState } from '../useBackStepState';
import { HeroDestinations } from './HeroDestinations';
import { useAuth } from '../../auth/AuthProvider';
import { customerService } from '../../services/customerService';
import { tripService } from '../../services/tripService';
import { commerceService } from '../../services/commerceService';
import { documentService } from '../../services/documentService';
import { visaService } from '../../services/visaService';
import { flightService } from '../../services/flightService';
import { AirportPicker } from '../../flight/AirportPicker';
import { HistoryCalendarDateField as CalendarDateField } from '../CalendarDateField';
import { homeSearchValidation } from './homeSearchValidation';
import { useViewportPopover } from '../useViewportPopover';
import { cabinOptions } from '../../flight/flightPresentation';
import { PremiumNavbar } from '../PremiumNavbar';
import { BrandMark } from '../BrandMark';
import { destinations } from './marketingContent';
import { HolidayPackages } from '../../holiday/HolidayPackages';
import { tripGroup } from '../../trip/tripPresentation';
import './premium-home.css';
import './premium-reference.css';
import './premium-services.css';
import './premium-cards.css';
import './search-modes.css';
import './desktop-search-layout.css';
import './service-sidebar.css';
import './premium-footer.css';
import './airline-offers-carousel.css';
import './home-partners.css';
import './home-refinements.css';
import './home-ad-banner.css';
import './homepage-polish.css';
import './flight-inspiration.css';

const ExploreFareMap = lazy(() => import('./ExploreFareMap').then(module => ({ default: module.ExploreFareMap })));

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


function ServiceSidebar({ expanded, compact, onToggle, onNavigate }: { expanded: boolean; compact: boolean; onToggle: () => void; onNavigate: () => void }) {
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded || !compact) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = sidebar.current?.querySelectorAll<HTMLElement>('button, a[href]');
      if (!controls?.length) return;
      const first = controls[0]!, last = controls[controls.length - 1]!;
      if (!sidebar.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', trapFocus);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded, compact]);
  const services: Array<{ name: string; kind: ServiceKind; active?: boolean; soon?: boolean; to?: string }> = [
    { name: 'Flight', kind: 'flight', active: true },
    { name: 'Hotels', kind: 'hotels', soon: true },
    { name: 'Attractions', kind: 'attractions', soon: true },
    { name: 'Packages', kind: 'packages', to: '/holidays' },
    { name: 'Visa', kind: 'visa', to: '/app/visa' },
    { name: 'E-SIM', kind: 'esim', soon: true },
  ];
  function renderService(service: typeof services[number]) {
    const content = <><span className="premium-service-sidebar-icon"><ServiceIcon kind={service.kind} /></span><span className="premium-service-sidebar-label">{service.name}</span>{service.soon && <small>Soon</small>}</>;
    return service.to ? <Link key={service.name} to={service.to} className="premium-service-sidebar-item" aria-label={service.name} title={service.name} onClick={onNavigate}>{content}</Link>
      : service.active ? <a key={service.name} href="#book" className="premium-service-sidebar-item active" aria-label={service.name} title={service.name} aria-current="page" onClick={onNavigate}>{content}</a>
        : <div key={service.name} className="premium-service-sidebar-item unavailable" aria-disabled="true" aria-label={service.name + ', coming soon'} title={service.name + ' · Coming soon'}>{content}</div>;
  }
  return <aside ref={sidebar} className="premium-service-sidebar" role={compact && expanded ? 'dialog' : undefined} aria-modal={compact && expanded ? true : undefined} aria-label="Travel services" onTransitionEnd={event => { if (compact && expanded && event.target === event.currentTarget && event.propertyName === 'transform') sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }}>
    <button type="button" className="premium-service-sidebar-toggle" onClick={onToggle} title={expanded ? 'Collapse travel services' : 'Expand travel services'} aria-label={expanded ? 'Collapse travel services' : 'Expand travel services'} aria-expanded={expanded} aria-controls="premium-services-nav"><span className="premium-service-sidebar-toggle-icon"><MenuIcon /></span><span className="premium-service-sidebar-toggle-text">Travel services</span><svg className="premium-service-sidebar-toggle-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg></button>
    <nav id="premium-services-nav" aria-label="Travel services"><div className="premium-service-group"><p className="premium-service-group-label">Explore</p>{services.filter(service => !service.soon).map(renderService)}</div><details className="premium-service-group is-upcoming"><summary>More services · coming soon</summary>{services.filter(service => service.soon).map(renderService)}</details></nav>
    <div className="premium-service-sidebar-footer"><Link to="/app/support" className="premium-service-sidebar-item" aria-label="Help and support" title="Help and support" onClick={onNavigate}><span className="premium-service-sidebar-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.7-2.5 1.8-2.5 3.5M12 17h.01"/></svg></span><span className="premium-service-sidebar-label">Help & support</span></Link></div>
  </aside>;
}

function SearchPanel({ active = true }: { active?: boolean }) {
  const navigate = useNavigate();
  const [mode, setMode] = useHomeSearchField('mode');
  const [origin, setOrigin] = useHomeSearchField('origin');
  const [destination, setDestination] = useHomeSearchField('destination');
  const [departure, setDeparture] = useHomeSearchField('departure');
  const [returnDate, setReturnDate] = useHomeSearchField('returnDate');
  const [multiLegs, setMultiLegs] = useHomeSearchField('multiLegs');
  const [adults, setAdults] = useHomeSearchField('adults');
  const [children, setChildren] = useHomeSearchField('children');
  const [infants, setInfants] = useHomeSearchField('infants');
  const [cabin, setCabin] = useHomeSearchField('cabin');
  const [passengerPickerOpen, setPassengerPickerOpen] = useBackStepState('home-passengers', false);
  const passengerPicker = useRef<HTMLDivElement>(null);
  const passengerTrigger = useRef<HTMLButtonElement>(null);
  const passengerPopover = useRef<HTMLElement>(null);
  const passengerPopoverStyle = useViewportPopover(passengerPickerOpen, passengerTrigger, { width: 380, height: 480, mobileSheet: true });
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const today = new Date();
  const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const validation = homeSearchValidation({ mode, origin, destination, departure, returnDate, multiLegs }, minimumDate);
  const fieldErrors = attempted ? validation : {};
  const code = (value: string) => value.trim().toUpperCase().match(/\(([A-Z]{3})\)$/)?.[1] ?? value.trim().toUpperCase();
  useEffect(() => {
    if (!passengerPickerOpen || !active) return;
    const dismiss = (event: MouseEvent) => { if (!passengerPicker.current?.contains(event.target as Node) && !passengerPopover.current?.contains(event.target as Node)) setPassengerPickerOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPassengerPickerOpen(false); passengerTrigger.current?.focus(); } };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [passengerPickerOpen, active]);
  const passengerLabel = `${adults} ${adults === 1 ? 'adult' : 'adults'}${children ? ` · ${children} ${children === 1 ? 'child' : 'children'}` : ''}${infants ? ` · ${infants} ${infants === 1 ? 'infant' : 'infants'}` : ''}`;
  function updatePassenger(kind: 'adults' | 'children' | 'infants', delta: number) {
    if (kind === 'adults') { const next = Math.max(1, Math.min(9 - children - infants, adults + delta)); setAdults(next); if (infants > next) setInfants(next); }
    if (kind === 'children') setChildren((count) => Math.max(0, Math.min(8, count + delta, 9 - adults - infants)));
    if (kind === 'infants') setInfants((count) => Math.max(0, Math.min(adults, count + delta, 9 - adults - children)));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setAttempted(true);
    if (Object.keys(validation).length) {
      const form = event.currentTarget;
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
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
      <div className="premium-search-intro"><strong><Translated text="Where would you like to go?" /></strong></div>
      <div className="premium-search-options">
        <fieldset className="premium-trip-types" aria-label="Trip type"><legend className="sr-only">Trip type</legend>{([['ONE_WAY','One-way'],['ROUND_TRIP','Return'],['MULTI_CITY','Multi-city']] as const).map(([value,label]) => <label key={value}><input type="radio" name="home-trip-type" value={value} checked={mode === value} onChange={() => setMode(value)} /><span>{label}</span></label>)}</fieldset>
        <div className="premium-passenger-control" ref={passengerPicker}>
          <button ref={passengerTrigger} type="button" className="premium-passenger-trigger" aria-label={`Passengers and cabin: ${passengerLabel}, ${cabinOptions.find(option => option.value === cabin)?.label ?? 'Economy'}`} aria-haspopup="dialog" aria-expanded={passengerPickerOpen} onClick={() => setPassengerPickerOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.5-4 2.8-6 7-6s6.5 2 7 6"/></svg><span>{passengerLabel}</span><small className="premium-passenger-cabin-label">{cabinOptions.find(option => option.value === cabin)?.label}</small><span className="premium-passenger-arrow" aria-hidden="true"><Chevron/></span>
          </button>
          {active && passengerPickerOpen && createPortal(<section ref={passengerPopover} style={passengerPopoverStyle} className="premium-passenger-popover premium-passenger-portal" role="dialog" aria-label="Passengers and cabin">
            <div className="premium-passenger-popover-head"><span aria-hidden="true">♟</span><strong>{passengerLabel}</strong></div>

            {[{ key: 'adults' as const, label: 'Adults', age: '12+ years old', count: adults, min: 1, max: 9 - children - infants },
              { key: 'children' as const, label: 'Children', age: '2–11 years old', count: children, min: 0, max: Math.min(8, 9 - adults - infants) },
              { key: 'infants' as const, label: 'Infants on lap', age: 'Under 2 years old', count: infants, min: 0, max: Math.min(adults, 9 - adults - children) }].map((item) => <div className="premium-passenger-row" key={item.key}>
              <span className="premium-passenger-description"><strong>{item.label}</strong><small>{item.age}</small></span>
              <div className="premium-passenger-counter"><button type="button" aria-label={`Remove ${item.label.toLowerCase()}`} disabled={item.count <= item.min} onClick={() => updatePassenger(item.key, -1)}>−</button><output aria-label={item.label}>{item.count}</output><button type="button" aria-label={`Add ${item.label.toLowerCase()}`} disabled={item.count >= item.max} onClick={() => updatePassenger(item.key, 1)}>＋</button></div>
            </div>)}
            <label className="premium-passenger-cabin"><Translated text="Cabin" /><select value={cabin} onChange={event => setCabin(event.target.value)}>{cabinOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <button type="button" className="premium-passenger-done" onClick={() => { setPassengerPickerOpen(false); passengerTrigger.current?.focus(); }}>Done</button>
          </section>, document.body)}
        </div>
      </div>
    </div>
    <form noValidate key={String(active)} className={`premium-search-fields${mode === 'MULTI_CITY' ? ' is-multi-city' : ''}`} onSubmit={submit}>
      {mode === 'MULTI_CITY' ? <div className="premium-multi-city-legs" role="group" aria-label="Multi-city flight legs">{multiLegs.map((leg,index) => <div className="premium-multi-city-row" key={index}><span className="premium-leg-number">{index + 1}</span><AirportPicker label="From" error={fieldErrors[`leg-${index}-origin`]} value={leg.origin} onChange={(value) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, origin: value } : item))} /><AirportPicker label="To" error={fieldErrors[`leg-${index}-destination`]} value={leg.destination} onChange={(value) => { const valueCode = code(value); setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, destination: value } : mode === 'MULTI_CITY' && i === index + 1 && valueCode.length === 3 ? { ...item, origin: valueCode } : item)); }} /><CalendarDateField active={active} label={`Flight ${index + 1} date`} error={fieldErrors[`leg-${index}-departure`]} className="premium-leg-date" minDate={index ? multiLegs[index - 1]!.departureDate || minimumDate : minimumDate} value={leg.departureDate} onChange={(departureDate) => setMultiLegs((items) => items.map((item,i) => i === index ? { ...item, departureDate } : item))} />{multiLegs.length > 2 && <button className="premium-remove-leg" type="button" aria-label={`Remove flight ${index + 1}`} onClick={() => setMultiLegs((items) => items.filter((_,i) => i !== index))}>×</button>}</div>)}{multiLegs.length < 6 && <button type="button" className="premium-add-leg" onClick={() => setMultiLegs((items) => [...items, { origin: code(items.at(-1)!.destination), destination: '', departureDate: '' }])}>＋ Add another flight</button>}</div> : <>
      <div className="premium-search-route" role="group" aria-label="Flight route">
        <AirportPicker label="From" value={origin} onChange={setOrigin} error={fieldErrors.origin} />
        <button type="button" className="premium-swap" aria-label="Swap airports" onClick={() => { setOrigin(destination); setDestination(origin); }}>⇄</button>
        <AirportPicker label="To" value={destination} onChange={setDestination} error={fieldErrors.destination} />
      </div>
      <div className={`premium-search-dates${mode === 'ONE_WAY' ? ' one-way' : ''}`}>
        <CalendarDateField active={active} label="Departure" error={fieldErrors.departure} className="premium-home-date-field" minDate={minimumDate} value={departure} onChange={(next) => { setDeparture(next); if (returnDate && returnDate < next) setReturnDate(''); }} />
        {mode === 'ROUND_TRIP' && <CalendarDateField active={active} label="Return" error={fieldErrors.returnDate} className="premium-home-date-field" align="end" minDate={departure || minimumDate} value={returnDate} onChange={setReturnDate} />}
      </div>
      </>}
      <button type="submit" className="premium-primary"><span aria-hidden="true">⌕</span> <Translated text="Search flights" /></button>
    </form>
    {error && <p className="premium-form-error" role="alert">{error}</p>}

  </Glass>;
}

function ExclusiveAirlineOffers() {
  const [selectedOffer, setSelectedOffer] = useState<HomeAirlineOffer | null>(null);
  const offersViewport = useRef<HTMLDivElement>(null);
  useOfferAutoSlide(offersViewport, selectedOffer !== null);
  const [navigation, setNavigation] = useState({ previous: false, next: true });
  useEffect(() => {
    const viewport = offersViewport.current;
    if (!viewport) return;
    const update = () => setNavigation({ previous: viewport.scrollLeft > 8, next: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 8 });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(viewport);
    viewport.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer?.disconnect(); viewport.removeEventListener('scroll', update); };
  }, []);
  const browse = (direction: number) => {
    const viewport = offersViewport.current;
    if (!viewport) return;
    const card = viewport.querySelector<HTMLElement>('.journey-card');
    const step = card ? card.getBoundingClientRect().width + (parseFloat(getComputedStyle(viewport.querySelector('.journey-track')!).columnGap) || 0) : viewport.clientWidth;
    viewport.scrollBy({ left: direction * step, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const routes = [
    { city: 'Bangkok', country: 'Thailand', code: 'BKK', airline: 'TG', name: 'Thai Airways', price: '', mood: 'Culture & city lights', image: 'photo-1563492065599-3520f775eeed' },
    { city: 'Kuala Lumpur', country: 'Malaysia', code: 'KUL', airline: 'MH', name: 'Malaysia Airlines', price: '', mood: 'A vibrant city escape', image: 'photo-1596422846543-75c6fc197f07' },
    { city: 'Bali', country: 'Indonesia', code: 'DPS', airline: 'SQ', name: 'Singapore Airlines', price: '', mood: 'Slow days, island ways', image: 'photo-1537996194471-e657df975ab4' },
    { city: 'Dubai', country: 'United Arab Emirates', code: 'DXB', airline: 'EK', name: 'Emirates', price: '', mood: 'Beyond the skyline', image: 'photo-1512453979798-5ea266f8880c' },
    { city: 'Singapore', country: 'Singapore', code: 'SIN', airline: 'BG', name: 'Biman Bangladesh', price: '', mood: 'Gardens, food & discovery', image: 'photo-1525625293386-3f8f99389edd' },
  ];
  return <Glass className="premium-exclusive-offers premium-inspiration">
    <div className="journey-section-heading">
      <div><span className="journey-eyebrow">FIND YOUR NEXT ESCAPE</span><h2>Special Flight Offers</h2><p>Explore flight offers and find your next journey.</p></div>
      <div className="journey-header-actions"><Link to="/app/price-alerts" className="journey-alert-link">Set a price alert</Link><div className="journey-navigation" aria-label="Browse destinations"><button type="button" aria-label="Previous destinations" disabled={!navigation.previous} onClick={() => browse(-1)}>Previous</button><button type="button" aria-label="Next destinations" disabled={!navigation.next} onClick={() => browse(1)}>Next</button></div></div>
    </div>
    <div ref={offersViewport} className="journey-viewport" role="region" aria-label="Special flight offers" tabIndex={0}>
      <div className="journey-track">{routes.map(route => ({ ...route, fare: activeGroupFare(route.code) })).map(offer => <button type="button" className="journey-card" key={offer.code} onClick={() => setSelectedOffer(offer)} aria-label={'View special flight offer for ' + offer.city}>
        <span className="journey-photo"><img src={'https://images.unsplash.com/' + offer.image + '?w=640&q=75&fit=crop&auto=format'} srcSet={[400, 640, 960].map(width => 'https://images.unsplash.com/' + offer.image + '?w=' + width + '&q=75&fit=crop&auto=format ' + width + 'w').join(', ')} sizes="(max-width: 600px) 86vw, (max-width: 1000px) 46vw, (min-width: 1600px) 24vw, 31vw" width={720} height={420} decoding="async" alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /><span className="journey-country">{offer.country}</span>{offer.fare?.demo && <span className="journey-demo-badge">Demo</span>}<span className="journey-destination"><strong>{offer.city}</strong><span>{offer.mood}</span></span></span>
        <span className="journey-card-content"><span className="journey-route"><span><small>From Dhaka</small><strong>DAC <span aria-hidden="true">—</span> {offer.code}</strong></span><span className="journey-airline"><img src={'/airlines/' + offer.airline + '.png'} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }}/><span>{offer.name}</span></span></span><span className="journey-fare"><span><small>{offer.fare ? 'From / person' : 'Special offer'}</small><strong>{offer.fare ? groupFareMoney(offer.fare!) : 'Quote on request'}</strong></span></span><span className="journey-card-action">View fare details <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></span></span>
      </button>)}</div>
    </div>
    <div className="journey-section-note"><span>Demo offers · illustrative prices and conditions, not bookable airline inventory.</span><span>Offers are subject to airline confirmation</span></div>
    {selectedOffer && <GroupFareDetails offer={selectedOffer} onClose={() => setSelectedOffer(null)} />}
  </Glass>;
}

function HomeAdBanner() {
  const scenes = [
    { city: 'Paris', image: destinations.find(place => place.city === 'Paris')!.image },
    { city: 'Santorini', image: destinations.find(place => place.city === 'Santorini')!.image },
    { city: 'New York', image: destinations.find(place => place.city === 'New York')!.image },
  ];
  const imageUrl = (image: string) => `https://images.unsplash.com/${image}?w=480&q=75&fit=crop&auto=format`;
  return <section className="premium-home-ad" aria-labelledby="home-ad-title">
    <div className="premium-home-ad-brand"><strong>flyseri</strong><span>JOURNEYS AHEAD</span></div>
    <div className="premium-home-ad-copy"><span className="premium-home-ad-eyebrow">A world of possibilities</span><h2 id="home-ad-title">Find your next great escape</h2><p>Discover places to go and plan your next journey with Flyseri.</p><Link to="/flights">Explore flights</Link></div>
    <div className="premium-home-ad-scenes" aria-hidden="true">{scenes.map(scene => <figure key={scene.city} style={{ '--ad-scene-image': `url("${imageUrl(scene.image)}")` } as CSSProperties}><figcaption>{scene.city}</figcaption></figure>)}</div>
    <span className="premium-home-ad-label">AD</span>
  </section>;
}

export function PremiumHome({ embedded = false }: { embedded?: boolean }) {
  const { session } = useAuth();
  const [searchMode, setSearchMode] = useBackStepState<'flights' | 'map' | 'ai'>('home-search', 'flights');
  const compactSearch = true;
  const [mapRequested, setMapRequested] = useState(searchMode === 'map');
  useEffect(() => { if (searchMode === 'map') setMapRequested(true); }, [searchMode]);
  const searchTabs = useRef<HTMLDivElement>(null);
  const [searchPanelHeight, setSearchPanelHeight] = useState(400);
  useLayoutEffect(() => {
    if (!compactSearch) return;
    const root = searchTabs.current?.closest('.premium-home-main');
    const panel = root?.querySelector<HTMLElement>(`#home-search-${searchMode}`);
    if (!panel) return;
    const update = () => {
      const tabs = searchTabs.current;
      if (!tabs) return;
      const headerHeight = root?.querySelector('.premium-header')?.getBoundingClientRect().height ?? 0;
      const panelOffset = panel.getBoundingClientRect().top - tabs.getBoundingClientRect().top;
      setSearchPanelHeight(Math.max(180, Math.floor(window.innerHeight - headerHeight - 24 - panelOffset - 12)));
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    for (const element of root?.querySelectorAll('.premium-hero,.premium-header,.premium-search-mode-switch') ?? []) observer?.observe(element);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [compactSearch, searchMode]);
  function chooseSearchMode(mode: typeof searchMode) {
    setSearchMode(mode);
    const tabs = searchTabs.current;
    if (!tabs) return;
    const headerHeight = tabs.closest('.premium-home-main')?.querySelector('.premium-header')?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: Math.max(0, tabs.getBoundingClientRect().top + window.scrollY - headerHeight - 24), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  const searchModes = [
    { id: 'flights', label: 'Flights', icon: 'flight' },
    { id: 'map', label: 'Map Search', icon: 'map' },
    { id: 'ai', label: 'AI Search', icon: 'ai' },
  ] as const;
  const panelProps = (mode: typeof searchMode) => ({
    id: `home-search-${mode}`,
    role: compactSearch ? 'tabpanel' : undefined,
    'aria-labelledby': compactSearch ? `home-search-tab-${mode}` : undefined,
    hidden: compactSearch && searchMode !== mode,
    className: 'premium-search-view',
    style: compactSearch ? { '--home-search-panel-height': `${searchPanelHeight}px` } as CSSProperties : undefined,
  });
  const [servicesExpanded, setServicesExpanded] = useBackStepState('home-services',
    false,
  );
  useEffect(() => { if (compactSearch) setServicesExpanded(false); }, [compactSearch]);
  useEffect(() => {
    if (!servicesExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setServicesExpanded(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [servicesExpanded]);
  const { data, loading, error, reload } = useOverview(!!session);

  const name = data.profile?.displayName?.trim() || session?.user.email?.split('@')[0] || null;
  const pending = data.payments.filter((payment) => ['CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN'].includes(payment.status)).length;
  return <div className={`premium-site${embedded ? ' premium-embedded' : ''}`}>
    <div className={`premium-home-layout${embedded ? ' is-embedded' : ''}${servicesExpanded ? ' services-open' : ''}`}>{!embedded && <><ServiceSidebar expanded={servicesExpanded} compact={compactSearch} onToggle={() => setServicesExpanded((value) => !value)} onNavigate={() => setServicesExpanded(false)} /><button type="button" className="premium-service-backdrop" aria-label="Close travel services" onClick={() => setServicesExpanded(false)} /></>}<div className="premium-home-main" data-search-mode={compactSearch ? searchMode : 'all'}>
    {!embedded && <PremiumNavbar name={name} servicesExpanded={servicesExpanded} onToggleServices={() => setServicesExpanded((value) => !value)} />}
    <main>
      <section className="premium-hero" id="book"><HeroDestinations /><div className="premium-hero-content"><p className="premium-eyebrow">DISCOVER A BRIGHTER TOMORROW</p><h1>Your Journey<br /><em>Starts with Flyseri</em></h1><p className="premium-hero-full-copy">Beautiful journeys begin with a simple idea. Search flights, shape your plans, and keep every detail close.</p><p className="premium-hero-short-copy"><Translated text="Your next journey, made smarter." /></p><div className="premium-trust"><span>✓ Find your next flight</span><span>✓ Your plans in one place</span><span>✓ Travel documents together</span></div></div><div className="premium-hero-script" aria-hidden="true">More<br />than a Trip <span>↗</span><small>New Places<br />Brighter Stories</small></div></section>
      <div className="premium-container premium-overlap">
        {compactSearch && <div className="premium-search-mode-switch" role="tablist" aria-label="Search your way" ref={searchTabs}>
          {searchModes.map((mode, index) => <button key={mode.id} type="button" role="tab" id={`home-search-tab-${mode.id}`} aria-controls={`home-search-${mode.id}`} aria-selected={searchMode === mode.id} tabIndex={searchMode === mode.id ? 0 : -1} onClick={() => chooseSearchMode(mode.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % searchModes.length : event.key === 'ArrowLeft' ? (index + searchModes.length - 1) % searchModes.length : event.key === 'Home' ? 0 : event.key === 'End' ? searchModes.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            chooseSearchMode(searchModes[next]!.id);
            searchTabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {mode.icon === 'flight' ? <><path d="m21 3-8.5 18-2.7-7-6.8-2.5L21 3Z"/><path d="M9.8 14 21 3"/></> : mode.icon === 'map' ? <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></> : <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/><path d="M20 2v4M18 4h4"/></>}
          </svg><span>{mode.label}</span></button>)}
        </div>}
        <div {...panelProps('flights')}><SearchPanel active={!compactSearch || searchMode === 'flights'} /></div>
      </div>
      <div className="premium-container premium-main">
        <div {...panelProps('ai')}><DeferredHomeSeriSearch active={searchMode === 'ai'} /></div>
        {session && error && <div className="premium-inline-error" role="alert">Some of your travel details could not be loaded. <button onClick={reload}><Translated text="Try again" /></button></div>}
        <div className="premium-journey-grid"><div {...panelProps('map')}>{(mapRequested || searchMode === 'map') && <HomeFeatureBoundary name="Map search"><Suspense fallback={<HomeFeatureLoading name="map search"/>}><ExploreFareMap active={searchMode === 'map'}/></Suspense></HomeFeatureBoundary>}</div><ExclusiveAirlineOffers /></div>
        <HomeAdBanner />

        <div id="deals"><HolidayPackages /></div>
        <section className="premium-partners" aria-labelledby="home-partners-title">
          <h2 id="home-partners-title">Airlines & travel technology</h2>
          <ul className="premium-partner-grid">
            {[
              { name: 'Sabre', logo: '/partners/sabre.png' },
              { name: 'Malaysia Airlines', logo: '/airlines/MH.png' },
              { name: 'US-Bangla Airlines', logo: '/airlines/BS.png' },
              { name: 'Biman Bangladesh Airlines', logo: '/airlines/BG.png' },
              { name: 'Singapore Airlines', logo: '/airlines/SQ.png' },
              { name: 'Qatar Airways', logo: '/airlines/QR.svg' },
              { name: 'AirAsia', logo: '/airlines/AK.svg' },
              { name: 'Batik Air', logo: '/airlines/OD.svg' },
            ].map(partner => <li key={partner.name}><img src={partner.logo} alt={partner.name} loading="lazy" decoding="async" width={145} height={60} onError={event => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling?.removeAttribute('hidden'); }} /><span className="partner-logo-fallback" hidden>{partner.name}</span></li>)}
          </ul>
        </section>        {session && !loading && (data.orders.length > 0 || pending > 0) && <section className="premium-commerce"><Heading eyebrow="YOUR ACCOUNT" title="Orders & payments" action="View orders" to="/app/orders" /><Glass><div><strong>{loading ? 'Loading your account…' : `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}`}</strong><span>{loading ? 'Checking payment status…' : pending ? `${pending} payment${pending === 1 ? '' : 's'} awaiting an update` : 'No pending payment updates'}</span></div><Link className="premium-outline" to="/app/payments">View payments →</Link></Glass></section>}

      </div>
    </main>{!embedded && <footer className="premium-footer premium-footer-refined">
      <div className="premium-container premium-footer-content">
        <div className="premium-footer-brand"><Link to="/" className="premium-logo" aria-label="Flyseri home"><BrandMark /></Link><p><Translated text="Your next journey, made smarter." /></p><small className="premium-footer-brand-attribution">Flyseri <span aria-hidden="true">—</span> A brand of Seri Mechan Travel</small></div>
        <nav aria-label="Footer travel navigation"><h2>Explore</h2><Link to="/flights">Find flights</Link><Link to="/holidays">Holiday packages</Link><Link to="/plan-budget"><Translated text="Trip budget" /></Link><Link to="/app/visa">Visa assistance</Link><Link to="/app/trips"><Translated text="My trips" /></Link></nav>
        <nav aria-label="Footer account navigation"><h2>Your Flyseri</h2><Link to="/app/orders">My orders</Link><Link to="/app/documents">Travel documents</Link><Link to="/app/travellers"><Translated text="Travellers" /></Link><Link to="/app/profile"><Translated text="Profile" /></Link></nav>
        <div className="premium-footer-help"><span className="premium-footer-help-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1M5 12H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2v-6H5Zm14 0h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2v-6h1ZM18 18c0 2-2 3-5 3h-1"/></svg></span><h2>Here to help</h2><p>Questions about your trip? Send our team a support request.</p><Link to="/app/support">Contact support <span aria-hidden="true">↗</span></Link></div>
      </div>
      <div className="premium-container premium-booking-guidance">
        <section className="premium-footer-info-group" aria-labelledby="footer-travel-info">
          <header><h2 id="footer-travel-info">Travel information</h2><p>Get to know Flyseri and find help with your booking.</p></header>
          <details><summary>About Flyseri</summary><div className="premium-footer-detail-content"><p>Flyseri is a brand of Seri Mechan Travel. Explore destinations, plan your journey and manage your travel details in one place.</p></div></details>
          <details><summary>Payments, changes & refunds</summary><div className="premium-footer-detail-content"><p>Review the total, payment details and applicable airline fare rules before confirming a booking. Change, cancellation and refund conditions depend on your selected fare.</p><Link to="/app/support">Ask the support team</Link></div></details>
        </section>
        <section className="premium-footer-info-group" aria-labelledby="footer-demo-policies">
          <header><h2 id="footer-demo-policies">Demo policies <span>Preview</span></h2><p>For Special Flight Offers demos only. Full service policies are pending publication.</p></header>
          <details><summary>Privacy notice · demo</summary><div className="premium-footer-detail-content"><p>Use sample traveller names in demo checkout. Demo booking records and countdowns are stored in this browser tab’s session. Entered names are not sent to an airline or payment provider.</p></div></details>
          <details><summary>Booking, cancellation & refunds · demo</summary><div className="premium-footer-detail-content"><p>Demo bookings, payments, documents, cancellations and refunds are simulated. No airline seat is reserved or money collected. The five-minute payment window expires automatically. Check the approved booking terms before using live services.</p></div></details>
        </section>
      </div>
      <div className="premium-container premium-footer-bottom"><small>© {new Date().getFullYear()} Flyseri. All rights reserved.</small><a href="#book">Back to top <span aria-hidden="true">↑</span></a></div>
    </footer>}</div></div></div>;
}
