import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlightAncillaryDisplayPrices, FlightAncillaryResponse, FlightAncillaryRequest, FlightBookingIntent } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { useAuth } from '../auth/AuthProvider';
import { ApiClientError } from '../lib/api/client';
import { currencyPreferenceEvent, preferredCurrency } from '../components/LocaleMenu';
import { airlineServiceCategories, airlineServiceCategory, type AirlineServiceCategory } from './airlineServiceCategories';
import './FlightAirlineServices.css';
import { ancillaryKey, ancillarySelectionInputs, requestedExtra } from './flightAncillarySelections';
import { FlightSelectedExtras } from './FlightSelectedExtras';
import { BoundedSelect } from '../components/BoundedSelect';

// Owner-scoped, bounded tab memory only. Never persist passenger names or quotes.
const quoteCache = new Map<string, { until: number; pending: boolean; promise: Promise<FlightAncillaryResponse> }>();
function loadQuote(key: string, lookup: () => Promise<FlightAncillaryResponse>, refresh: boolean) {
  for (const [id, entry] of quoteCache) if (entry.until <= Date.now()) quoteCache.delete(id);
  const previous = quoteCache.get(key);
  if (previous && (!refresh || previous.pending)) return previous.promise;
  while (quoteCache.size >= 12) quoteCache.delete(quoteCache.keys().next().value!);
  const entry = { until: Date.now() + 120000, pending: true, promise: lookup() };
  quoteCache.set(key, entry);
  void entry.promise.then(() => { entry.pending = false; }, () => { if (quoteCache.get(key) === entry) quoteCache.delete(key); });
  return entry.promise;
}
const quoteMoney = (amount: string, currency: string) => new Intl.NumberFormat('en-MY', { style: 'currency', currency, currencyDisplay: 'code' }).format(Number(amount));

export function FlightAirlineServices({ searchId = '', offerId = '', intentId, passengers = [], ready, requireNames = true, selectedExtras = [], onSelectedExtrasChange, onSaved, disabled = false, onSavingChange }: {
  searchId?: string; offerId?: string; intentId?: string; passengers?: { givenName: string; surname: string }[]; ready: boolean; requireNames?: boolean; selectedExtras?: FlightAncillaryRequest[]; onSelectedExtrasChange?: (extras: FlightAncillaryRequest[]) => void; onSaved?: (intent: FlightBookingIntent) => void; disabled?: boolean; onSavingChange?: (saving: boolean) => void;
}) {
  const { session } = useAuth();
  const identity = JSON.stringify([session?.user.id ?? 'guest', searchId, offerId, intentId, requireNames ? passengers : passengers.length, requireNames]);
  const section = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [quote, setQuote] = useState<{ key: string; result: FlightAncillaryResponse } | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState<{ key: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [cooldown, setCooldown] = useState<{ key: string; until: number } | null>(null);
  const [clock, setClock] = useState(Date.now);
  const automaticRetries = useRef({ key: '', count: 0 });
  const [category, setCategory] = useState<AirlineServiceCategory | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [traveler, setTraveler] = useState<number | 'ALL'>('ALL');
  const [currency, setCurrency] = useState(preferredCurrency);
  const [converted, setConverted] = useState<{ key: string; data: FlightAncillaryDisplayPrices } | null>(null);
  const [convertingKey, setConvertingKey] = useState('');
  const conversionCache = useRef(new Map<string, FlightAncillaryDisplayPrices>());
  const refreshRef = useRef(0);
  const result = quote?.key === identity ? quote.result : null;
  const busy = ready && busyKey === identity;
  const retrySeconds = cooldown?.key === identity ? Math.max(0, Math.ceil((cooldown.until - clock) / 1000)) : 0;
  const conversionKey = result ? JSON.stringify([identity, result.retrievedAt, currency]) : '';
  const display = converted?.key === conversionKey ? converted.data : null;
  useEffect(() => {
    const update = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      setCurrency(typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : preferredCurrency());
    };
    window.addEventListener(currencyPreferenceEvent, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(currencyPreferenceEvent, update); window.removeEventListener('storage', update); };
  }, []);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setCategory('ALL'); setQuery(''); setTraveler('ALL'); setSelectionNotice(''); automaticRetries.current = { key: identity, count: 0 }; }, [identity]);
  useEffect(() => {
    if (cooldown?.key !== identity) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now < cooldown.until) return;
      window.clearInterval(timer);
      setCooldown(null);
      if (ready && visible && automaticRetries.current.key === identity && automaticRetries.current.count < 1) {
        automaticRetries.current.count++;
        setRefresh(value => value + 1);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown, identity, ready, visible]);
  useEffect(() => { setVisibleCounts({}); }, [identity, category, query, traveler]);
  useEffect(() => {
    if (!ready || !visible || (cooldown?.key === identity && cooldown.until > Date.now())) return;
    let current = true;
    const force = refresh !== refreshRef.current;
    refreshRef.current = refresh;
    setBusyKey(identity); setNotice(null);
    const names = requireNames ? passengers : passengers.map(() => ({ givenName: '', surname: '' }));
    void loadQuote(identity, () => intentId ? flightService.intentAncillaries(intentId) : flightService.ancillaries({ searchId, offerId, passengers: names }), force)
      .then(data => { if (current) setQuote({ key: identity, result: data }); })
      .catch(cause => {
        if (!current) return;
        setNotice({ key: identity, message: cause instanceof Error ? cause.message : 'Airline services could not be loaded. Please try again.' });
        if (cause instanceof ApiClientError && cause.code === 'RATE_LIMITED') {
          const now = Date.now();
          setClock(now);
          setCooldown({ key: identity, until: now + Math.min(300, Math.max(1, cause.retryAfterSeconds ?? 60)) * 1000 });
        }
      })
      .finally(() => { if (current) setBusyKey(''); });
    return () => { current = false; };
    // identity includes the request and owner; passenger array references can change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, ready, visible, refresh]);
  useEffect(() => {
    if (!result || !result.services.some(service => service.currency && service.currency !== currency && service.amount !== null && Number(service.amount) > 0)) return;
    const cached = conversionCache.current.get(conversionKey);
    if (cached) { setConverted({ key: conversionKey, data: cached }); return; }
    let current = true;
    setConvertingKey(conversionKey);
    void flightService.ancillaryDisplayPrices(result.services.map(({ amount, currency }) => ({ amount, currency })), currency)
      .then(data => {
        if (!current) return;
        while (conversionCache.current.size >= 8) conversionCache.current.delete(conversionCache.current.keys().next().value!);
        conversionCache.current.set(conversionKey, data);
        setConverted({ key: conversionKey, data });
      })
      .catch(() => { if (current) setConverted({ key: conversionKey, data: { currency, prices: result.services.map(() => null), provider: null, updatedAt: null } }); })
      .finally(() => { if (current) setConvertingKey(''); });
    return () => { current = false; };
  }, [result, currency, conversionKey]);
  const groups = useMemo(() => airlineServiceCategories.map(group => ({ ...group,
    services: (result?.services ?? []).map((service, index) => ({ service, index })).filter(({ service }) => airlineServiceCategory(service) === group.id),
  })), [result]);
  const term = query.trim().toLocaleLowerCase('en');
  const shown = groups.filter(group => category === 'ALL' || group.id === category).map(group => ({ ...group,
    services: group.services.filter(({ service }) => (traveler === 'ALL' || service.passengerIndexes.includes(traveler)) && (!term || `${service.name} ${service.serviceCode} ${service.segmentLabels.join(' ')}`.toLocaleLowerCase('en').includes(term))),
  })).filter(group => group.services.length);
  const missingConversion = !!result && result.services.some((service, index) => service.amount !== null && Number(service.amount) > 0 && service.currency && service.currency !== currency && !display?.prices[index]);
  const flightGroups = new Map<string, { labels: string[]; groups: typeof shown }>();
  for (const group of shown) for (const entry of group.services) {
    const key = JSON.stringify(entry.service.segmentLabels);
    let flight = flightGroups.get(key);
    if (!flight) { flight = { labels: entry.service.segmentLabels, groups: [] }; flightGroups.set(key, flight); }
    let categoryGroup = flight.groups.find(item => item.id === group.id);
    if (!categoryGroup) { categoryGroup = { ...group, services: [] }; flight.groups.push(categoryGroup); }
    categoryGroup.services.push(entry);
  }
  const travelerIndexes = [...new Set(result?.services.flatMap(service => service.passengerIndexes) ?? [])].sort((a, b) => a - b);
  async function toggleService(service: FlightAncillaryResponse['services'][number]) {
    if (!result || savingRef.current || disabled) return;
    const key = ancillaryKey(service), selected = selectedExtras.some(extra => ancillaryKey(extra) === key);
    const extra = requestedExtra(service);
    let next = selectedExtras.filter(item => ancillaryKey(item) !== key);
    // A baggage allowance or seat option replaces the previous option for the same flight and traveler.
    if (!selected && ['BAGGAGE', 'SEATS'].includes(extra.category)) next = next.filter(item => !(item.category === extra.category && item.segmentLabels.some(label => extra.segmentLabels.includes(label)) && item.passengerIndexes.some(index => extra.passengerIndexes.includes(index))));
    if (!selected) next.push(extra);
    if (next.length > 40) { setSelectionNotice('Choose up to 40 extras for this booking.'); return; }
    setSelectionNotice(''); savingRef.current = true; setSaving(true); onSavingChange?.(true);
    try {
      if (intentId) {
        const updated = await flightService.saveAncillarySelections(intentId, ancillarySelectionInputs(next, result.expiresAt && Date.parse(result.expiresAt) <= Date.now() ? await flightService.intentAncillaries(intentId) : result));
        onSaved?.(updated);
      } else onSelectedExtrasChange?.(next);
    } catch (cause) { setSelectionNotice(cause instanceof Error ? cause.message : 'Your extra could not be saved. Please try again.'); }
    finally { savingRef.current = false; setSaving(false); onSavingChange?.(false); }
  }
  async function clearSelections() {
    if (savingRef.current || disabled) return;
    savingRef.current = true; setSaving(true); onSavingChange?.(true); setSelectionNotice('');
    try {
      if (intentId) onSaved?.(await flightService.saveAncillarySelections(intentId, []));
      else onSelectedExtrasChange?.([]);
    } catch (cause) { setSelectionNotice(cause instanceof Error ? cause.message : 'Selections could not be cleared.'); }
    finally { savingRef.current = false; setSaving(false); onSavingChange?.(false); }
  }
  return <section ref={section} className="flight-airline-services flight-airline-offers" aria-label="Additional airline offers" aria-busy={busy}>
    <div className="flight-airline-offers-heading"><div><h3>Airline extras</h3><p>Explore services for your selected flights.</p></div>
      <button type="button" className="account-outline-button" disabled={!ready || busy || saving || disabled || retrySeconds > 0} onClick={() => { setVisible(true); setRefresh(value => value + 1); }}>{busy ? 'Checking…' : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : result ? 'Refresh offers' : 'Check services'}</button></div>
    {!ready && <p className="guest-checkout-note">Confirm your traveler details to load available services automatically.</p>}
    {requireNames && <p className="guest-checkout-note">Confirmed passenger names are used for the airline service lookup.</p>}
    {notice?.key === identity && <p role="status" className="flight-airline-offers-notice">{notice.message} {retrySeconds > 0 ? <span>Retry available in {retrySeconds}s.</span> : <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Try again</button>}</p>}
    {busy && !result && <div className="flight-airline-offers-loading" role="status"><span>Finding available airline extras…</span><i/><i/><i/></div>}
    {result && <>
      {result.services.length > 0 ? <>
        <div className="flight-airline-offers-filters" role="group" aria-label="Service categories"><button type="button" aria-pressed={category === 'ALL'} onClick={() => setCategory('ALL')}>All services <span>{result.services.length}</span></button>{groups.map(group => <button key={group.id} type="button" aria-pressed={category === group.id} disabled={!group.services.length} onClick={() => setCategory(group.id)}>{group.label} <span>{group.services.length}</span></button>)}</div>
        <label className="flight-airline-offers-search"><span>Find a service</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search meals, bags, seats…" maxLength={120}/></label>
        <div className="flight-airline-offers-currency" role="status">Prices in <strong>{currency}</strong>{missingConversion && convertingKey === conversionKey ? ' · Converting prices…' : missingConversion ? ' · Some converted prices are unavailable.' : display?.provider ? ' · Converted estimates' : ''}</div>
        {travelerIndexes.length > 1 && <label className="flight-airline-offers-traveler">Choose traveler <BoundedSelect ariaLabel="Choose traveler for airline extras" value={String(traveler)} placeholder="Choose traveler" options={[{value:'ALL',label:'All travelers'},...travelerIndexes.map(index=>({value:String(index),label:`Traveler ${index+1}`}))]} onChange={selection=>setTraveler(selection==='ALL'?'ALL':Number(selection))}/></label>}
        {[...flightGroups].map(([flightKey, flight], flightIndex) => <details className="flight-airline-offers-flight" key={flightKey} open={flightIndex === 0 || !!term}><summary><div><strong>{flight.labels.join(' / ') || 'Flight association unavailable'}</strong><small>{flight.groups.reduce((count, group) => count + group.services.length, 0)} offers{flight.labels.length > 1 ? ' · Applies to these flights together' : ''}</small></div><span aria-hidden="true">⌄</span></summary>
          {flight.groups.map(group => {
            const countKey = flightKey + group.id, limit = visibleCounts[countKey] ?? 6;
            return <details className="flight-airline-offers-category" key={group.id}>
              <summary className="flight-airline-offers-category-summary"><span><strong>{group.label}</strong><small>{group.description}</small></span><span className="flight-airline-offers-category-count">{group.services.length}</span><span className="flight-airline-offers-category-chevron" aria-hidden="true">⌄</span></summary>
              <div className="flight-airline-offers-category-body"><div className="flight-airline-service-list">{group.services.slice(0, limit).map(({ service, index }) => {
              const native = service.currency === currency;
              const zero = service.amount !== null && !!service.currency && Number(service.amount) === 0;
              const amount = native ? service.amount : display?.prices[index];
              const price = zero ? 'No charge quoted' : amount !== null && amount !== undefined ? `${native ? '' : '≈ '}${quoteMoney(amount, currency)}` : convertingKey === conversionKey && service.currency && service.currency !== currency ? 'Converting…' : 'Price unavailable';
              const selected = selectedExtras.some(extra => ancillaryKey(extra) === ancillaryKey(service));
              const canSelect = !!result.quoteId && service.segmentLabels.length > 0 && service.passengerIndexes.length > 0 && (!!intentId && !!onSaved || !!onSelectedExtrasChange);
              return <details className={`flight-airline-service${selected ? ' is-selected' : ''}`} key={`${service.offerItemId ?? service.serviceCode}-${index}`}>
                <summary className="flight-airline-service-summary"><span className="flight-airline-service-name"><strong>{service.name}</strong><small>{service.passengerIndexes.length ? `Traveler${service.passengerIndexes.length === 1 ? '' : 's'} ${service.passengerIndexes.map(index => index + 1).join(', ')}` : 'Traveler association unavailable'}</small></span><span className="flight-airline-service-price"><strong title={service.amount !== null && service.currency ? `Airline quote: ${quoteMoney(service.amount, service.currency)}` : undefined}>{price}</strong><small>{selected ? 'Selected' : 'Airline quote'}</small></span><span className="flight-airline-service-chevron" aria-hidden="true">⌄</span></summary>
                <div className="flight-airline-service-details"><button type="button" className="flight-airline-service-select" aria-pressed={selected} disabled={!canSelect || disabled || saving || busy} onClick={event=>{const card=event.currentTarget.closest('details');void toggleService(service).then(()=>{if(card)card.open=true;});}}>{selected ? 'Remove extra' : 'Add to booking request'}</button></div>
              </details>;
            })}</div>{group.services.length > limit && <button type="button" className="flight-airline-offers-more" onClick={() => setVisibleCounts(counts => ({ ...counts, [countKey]: limit + 6 }))}>Show {Math.min(6, group.services.length - limit)} more · {group.services.length - limit} remaining</button>}</div></details>;
          })}
        </details>)}
        {!shown.length && <p className="flight-airline-offers-empty" role="status">No services match your search. <button type="button" onClick={() => { setCategory('ALL'); setQuery(''); }}>Clear filters</button></p>}
      </> : <p className="flight-airline-offers-empty">The airline returned no additional services for this fare. Included baggage and meals are shown in your fare details.</p>}
      <p className="guest-checkout-note">Updated {new Date(result.retrievedAt).toLocaleString('en-MY')}. Choose extras for each flight and traveler. Selections are saved as requests; airline purchase and final charges require confirmation.</p>
      {display?.provider && <p className="flight-airline-offers-attribution">Converted prices are estimates. <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates by ExchangeRate-API</a>{display.updatedAt && ` · ${new Date(display.updatedAt).toLocaleDateString('en-MY')}`}</p>}
    </>}
    {selectionNotice && <p className="flight-airline-offers-notice" role="alert">{selectionNotice}</p>}
    <FlightSelectedExtras requests={selectedExtras}/>
    {!!selectedExtras.length && <button type="button" className="flight-airline-offers-more" disabled={saving || disabled || !ready} onClick={() => void clearSelections()}>Clear selected extras</button>}
  </section>;
}
