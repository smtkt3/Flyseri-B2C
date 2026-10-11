import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FlightSearchRequest, FlightSearchResponse, HolidayPackage } from '@flyseri/types';
import { holidayService, holidayMoney } from '../holiday/holidayService';
import { flightService } from '../services/flightService';
import { AirportPicker } from '../flight/AirportPicker';
import { AirlineIdentity } from '../flight/AirlineIdentity';
import { money } from '../flight/flightPresentation';
import { useLanguage } from './language';

export function budgetTotals(input: { flights: number; stay: number; nights: number; daily: number; adults: number; children: number; other: number }) {
  return Math.round((input.flights + input.stay * input.nights + input.daily * (input.nights + 1) * (input.adults + input.children) + input.other) * 100) / 100;
}
export function TripBudget({ initial }: { initial?: { total?: number; adults?: number; currency?: string } }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [total, setTotal] = useState(initial?.total ?? 100000);
  const [adults, setAdults] = useState(initial?.adults ?? 2);
  const [children, setChildren] = useState(0);
  const [nights, setNights] = useState(3);
  const [flights, setFlights] = useState(0);
  const [stay, setStay] = useState(0);
  const [daily, setDaily] = useState(0);
  const [other, setOther] = useState(0);
  const [category, setCategory] = useState('ALL');
  const [packages, setPackages] = useState<HolidayPackage[]>([]);
  const [packageError, setPackageError] = useState(false);
  const [origin, setOrigin] = useState('DAC');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [result, setResult] = useState<{ response: FlightSearchResponse; request: FlightSearchRequest } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quoteSelected, setQuoteSelected] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const currency = initial?.currency ?? 'BDT';
  useEffect(() => { const abort = new AbortController(); void holidayService.list(abort.signal).then(setPackages, () => { if (!abort.signal.aborted) setPackageError(true); }); return () => { abort.abort(); controller.current?.abort(); }; }, []);
  useEffect(() => { controller.current?.abort(); setBusy(false); setResult(null); setQuoteSelected(false); }, [origin, destination, departureDate, returnDate, adults, children]);
  const estimated = budgetTotals({ flights, stay, nights, daily, adults, children, other });
  const remaining = Math.round((total - estimated) * 100) / 100;
  const matches = useMemo(() => packages.filter(item => item.published && !item.preview && item.currency === currency && (category === 'ALL' || item.category === category) && adults + children <= item.maxPax && item.departureDates.some(date => date > new Date().toISOString().slice(0, 10)) && item.adultPrice * adults + item.childPrice * children <= total).sort((a, b) => (a.adultPrice * adults + a.childPrice * children) - (b.adultPrice * adults + b.childPrice * children)).slice(0, 4), [packages, category, adults, children, total, currency]);
  const numeric = (label: string, value: number, update: (value: number) => void, max = 999999999, min = 0) => <label>{t(label)}<input aria-label={label} type="number" min={min} max={max} step={max < 100 ? 1 : .01} value={value} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) update(Math.min(max, Math.max(min, value))); }} /></label>;
  return <section className="travel-tool"><h2>{t('Plan your spending')}</h2><div className="travel-grid">
    {numeric('Total budget', total, setTotal)}{numeric('Adults', adults, value => { const count = Math.floor(value); setAdults(count); setChildren(current => Math.min(current, 9 - count)); }, 9, 1)}{numeric('Children', children, value => setChildren(Math.floor(value)), 9 - adults)}{numeric('Nights', nights, value => setNights(Math.floor(value)), 90)}
    {numeric('Flights total', flights, value => { setFlights(value); setQuoteSelected(false); })}{numeric('Stay per night', stay, setStay)}{numeric('Daily spending per person', daily, setDaily)}{numeric('Other costs', other, setOther)}
  </div><div className="travel-budget-total"><div>{t('Estimated total')}<strong>{money(String(estimated), currency)}</strong></div><div className={remaining < 0 ? 'travel-error' : 'travel-success'}>{t(remaining < 0 ? 'Over budget' : 'Remaining budget')}<strong>{money(String(Math.abs(remaining)), currency)}</strong></div></div>
    <p>Flights are {quoteSelected ? 'based on your selected airline shopping quote' : 'your estimate'}. Stay is the whole group’s nightly cost; daily spending covers {nights + 1} days. Unfilled costs are excluded. This budget is not a booking quote.</p>
    <details><summary>{t('Search flights')} · within your budget</summary><form onSubmit={event => {
      event.preventDefault(); if (controller.current && !controller.current.signal.aborted && busy) return;
      const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setResult(null);
      const request: FlightSearchRequest = { origin, destination, departureDate, ...(returnDate ? { returnDate } : {}), tripType: returnDate ? 'ROUND_TRIP' : 'ONE_WAY', adults, children, infants: 0, cabin: 'ECONOMY', currency };
      void flightService.search(request, { signal: abort.signal }).then(response => { if (!abort.signal.aborted) setResult({ response, request }); }, cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not check fares.'); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    }}><label>{t('From')}<AirportPicker value={origin} onChange={setOrigin} label="Budget flight origin" /></label><label>{t('To')}<AirportPicker value={destination} onChange={setDestination} label="Budget flight destination" /></label><label>{t('Departure')}<input type="date" required min={new Date().toISOString().slice(0, 10)} value={departureDate} onChange={event => setDepartureDate(event.target.value)} /></label><label>{t('Return date')}<input type="date" min={departureDate} value={returnDate} onChange={event => setReturnDate(event.target.value)} /></label><div className="travel-actions"><button disabled={busy || children > 0 || !destination || origin === destination} className="travel-primary">{busy ? 'Checking fares…' : t('Search flights')}</button></div>{children > 0 && <p>Live child fares require ages and are not available in this search yet. You can still compare family package prices below.</p>}</form>
      {error && <p role="alert" className="travel-error">{error}</p>}
      {result && result.response.offers.filter(offer => offer.currency === currency && Number(offer.totalAmount) + estimated - flights <= total).sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount)).slice(0, 3).map(offer => <article className="travel-row" key={offer.offerId}><div><AirlineIdentity codes={offer.airlineCodes} /><strong>{money(offer.totalAmount, offer.currency)}</strong><small>Total for {adults} adults · {offer.outbound.stops === 0 ? 'Nonstop' : `${offer.outbound.stops} stop(s)`}</small></div><div className="travel-actions"><button onClick={() => { setFlights(Number(offer.totalAmount)); setQuoteSelected(true); }}>Use in budget</button><button disabled={Date.parse(result.response.expiresAt) <= Date.now()} onClick={() => navigate('/flight-checkout', { state: { offer, searchId: result.response.searchId, searchRequest: result.request } })}>{t('Select flight')} →</button></div></article>)}
      {result && !result.response.offers.some(offer => offer.currency === currency && Number(offer.totalAmount) + estimated - flights <= total) && <p>No returned fares fit the remaining flight budget. Try nearby dates or adjust your costs.</p>}
    </details><details><summary>{t('Explore packages')} · within {money(String(total), currency)}</summary><label>Destination type<select value={category} onChange={event => setCategory(event.target.value)}><option value="ALL">All destinations</option><option value="DOMESTIC">{t('Domestic')}</option><option value="INTERNATIONAL">{t('International')}</option></select></label>
      {packageError ? <p role="status">Package availability could not be loaded. <Link to="/holidays">{t('Explore packages')} →</Link></p> : <div className="travel-package-matches">{matches.map(item => <Link className="travel-package-match" to={`/holidays/${item.id}`} key={item.id}><img src={item.imageUrl} alt="" loading="lazy" /><strong>{item.title}</strong><p>{item.days} days · {holidayMoney(item.adultPrice * adults + item.childPrice * children)} total</p></Link>)}</div>}
      {!packageError && !matches.length && <p>No published packages match this budget and group size.</p>}<p>Package totals follow their listed inclusions. Flights, visa fees, and spending are included only when stated on the package page.</p>
    </details>
  </section>;
}
