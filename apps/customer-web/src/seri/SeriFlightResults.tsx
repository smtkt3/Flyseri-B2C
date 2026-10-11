import { Translated } from '../travel/language';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { FlightLeg, FlightOffer, FlightSearchRequest, FlightSearchResponse } from '@flyseri/types';
import { FareWatchControl } from '../travel/FareWatches';
import { flightRecommendations } from '../flight/flightRecommendations';
import { FlightDateStrip } from '../flight/FlightDateStrip';
import { useLanguage } from '../travel/language';
import { AirlineIdentity } from '../flight/AirlineIdentity';
import { flightService } from '../services/flightService';
import { seriReturnPath } from './seriFlightReturn';
import './seri-flight-results.css';

export type ChatFlights = FlightSearchResponse & { searchRequest: FlightSearchRequest; searchFailed?: boolean };
export function chatFlights(payload: Record<string, unknown> | null): ChatFlights | null {
  if (!payload || (payload.source !== 'sabre' && payload.searchFailed !== true) || typeof payload.searchId !== 'string' || !Array.isArray(payload.offers) || !Number.isFinite(Date.parse(String(payload.expiresAt)))) return null;
  const request = payload.searchRequest as FlightSearchRequest | undefined;
  if (!request || !/^[A-Z]{3}$/.test(request.origin) || !/^[A-Z]{3}$/.test(request.destination) || !request.departureDate || !Number.isInteger(request.adults)) return null;
  const validLeg = (leg: FlightLeg) => leg && Array.isArray(leg.segments) && leg.segments.length > 0 && leg.segments.every(segment => segment && typeof segment.departureAt === 'string' && typeof segment.arrivalAt === 'string');
  const offers = (payload.offers as FlightOffer[]).filter(offer => offer && typeof offer.offerId === 'string' && /^[A-Z]{3}$/.test(offer.currency) && Number.isFinite(Number(offer.totalAmount)) && Number(offer.totalAmount) >= 0 && Array.isArray(offer.airlineCodes) && legsOf(offer).every(validLeg));
  return { ...payload, offers, searchRequest: request } as ChatFlights;
}
const legsOf = (offer: FlightOffer) => offer.multiCityLegs?.length ? offer.multiCityLegs : [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
const duration = (minutes: number | null) => minutes === null ? 'Duration unavailable' : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const totalDuration = (offer: FlightOffer) => legsOf(offer).reduce((sum, leg) => sum + (leg.durationMinutes ?? Infinity), 0);
const price = (offer: FlightOffer) => new Intl.NumberFormat('en', { style: 'currency', currency: offer.currency, maximumFractionDigits: 2 }).format(Number(offer.totalAmount));

export function SeriFlightResults({ data, onUpdate }: { data: ChatFlights; onUpdate?: (data: ChatFlights) => void }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState(data);
  const [sort, setSort] = useState('recommended');
  const [direct, setDirect] = useState(false);
  const [cabin, setCabin] = useState<string>(data.searchRequest.cabin);
  const [limit, setLimit] = useState(3);
  const [now, setNow] = useState(Date.now);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { setCurrent(data); setLimit(3); }, [data]);
  useEffect(() => { active.current = true; const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => { active.current = false; window.clearInterval(timer); }; }, []);
  const expired = Date.parse(current.expiresAt) <= now;
  const offers = useMemo(() => {
    const filtered = current.offers.filter(offer => (!direct || legsOf(offer).every(leg => leg.stops === 0)) && (cabin === 'ANY' || !offer.cabin || offer.cabin === cabin));
    if (sort === 'cheapest') filtered.sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount));
    if (sort === 'recommended') { const rank = flightRecommendations(filtered).rank; filtered.sort((a,b) => (rank.get(a.offerId) ?? Infinity) - (rank.get(b.offerId) ?? Infinity)); }
    if (sort === 'fastest') filtered.sort((a, b) => totalDuration(a) - totalDuration(b));
    return filtered;
  }, [current, direct, sort, cabin]);
  async function refresh(searchRequest = current.searchRequest) {
    if (busy.current) return;
    busy.current = true; setRefreshing(true); setError('');
    try {
      const result = await flightService.search(searchRequest);
      if (!active.current) return;
      const next = { ...result, searchRequest };
      setCurrent(next); setNow(Date.now()); setLimit(3); onUpdate?.(next);
    } catch { if (active.current) setError('Could not refresh fares. Please try again.'); }
    finally { busy.current = false; if (active.current) setRefreshing(false); }
  }
  function select(offer: FlightOffer) {
    if (busy.current) return;
    if (Date.parse(current.expiresAt) <= Date.now()) { setNow(Date.now()); setError('These fares have expired. Refresh to continue.'); return; }
    navigate('/flight-checkout', { state: { offer, searchId: current.searchId, searchRequest: current.searchRequest, seriReturnTo: seriReturnPath(location.pathname + location.search) ?? '/#book' } });
  }
  const request = current.searchRequest;
  const recommendations = flightRecommendations(offers);
  const pax = request.adults + request.children + request.infants;
  return <section className="seri-flights" aria-label="Flight options in chat">
    <header><div><strong>{request.origin} <span aria-hidden="true">→</span> {request.destination}</strong><span>{request.departureDate}{request.returnDate ? ` · Return ${request.returnDate}` : ''}</span><span>{pax} traveller{pax > 1 ? 's' : ''} · {request.cabin.toLowerCase().replace(/_/g, ' ')}</span></div><span className="seri-flight-count">{current.searchFailed ? 'Unavailable' : `${offers.length} options`}</span></header>
    <div className="seri-flight-tools"><label><Translated text="Sort" /><select value={sort} onChange={event => { setSort(event.target.value); setLimit(3); }}><option value="recommended"><Translated text="Recommended" /></option><option value="cheapest"><Translated text="Lowest price" /></option><option value="fastest"><Translated text="Shortest journey" /></option></select></label><label><Translated text="Cabin" /><select value={cabin} onChange={event => { setCabin(event.target.value); setLimit(3); }}><option value="ANY">Any cabin</option><option value="ECONOMY"><Translated text="Economy" /></option><option value="PREMIUM_ECONOMY"><Translated text="Premium economy" /></option><option value="BUSINESS"><Translated text="Business" /></option><option value="FIRST"><Translated text="First" /></option><option value="MIXED">Mixed cabin</option></select></label><label className="seri-direct"><input type="checkbox" checked={direct} onChange={event => { setDirect(event.target.checked); setLimit(3); }} /><Translated text="Nonstop" /></label></div>
    {expired && !current.searchFailed && <p role="status">Fares expired. Refresh for current availability.</p>}
    {current.incomplete && <p role="status">Some airline results are still unavailable. Refresh to check again.</p>}
    {!offers.length && !current.searchFailed && <p>{current.offers.length ? 'No flights match these filters. Try another cabin or include connections.' : 'No flights found for these dates. Ask Seri to try another date or airport.'}</p>}
    <div className="seri-flight-cards">{offers.slice(0, limit).map(offer => <article className="seri-flight-card" key={offer.offerId}>
      <AirlineIdentity codes={offer.airlineCodes} />
      {offer.offerId === recommendations.balanced?.offerId && <><span className="travel-badge">{t('Best balance')}</span><small className="travel-fare-reason">Balances total price, journey time and connections.</small></>}
      {offer.offerId === recommendations.cheapest?.offerId && <span className="travel-badge">{t('Cheapest')}</span>}
      {offer.offerId === recommendations.fastest?.offerId && <span className="travel-badge">{t('Fastest')}</span>}
      <div className="seri-flight-fare">{(offer.cabin ?? 'Cabin details at review').toLowerCase().replace(/_/g, ' ')}{offer.fareBrand ? ` · ${offer.fareBrand}` : ''}</div>
      {legsOf(offer).map((leg, index) => { const first = leg.segments[0]!; const last = leg.segments.at(-1)!; const dayChange = Math.round((Date.parse(last.arrivalAt.slice(0, 10)) - Date.parse(first.departureAt.slice(0, 10))) / 86400000); return <div className="seri-flight-leg" key={index}>
        <div><b>{first.departureAt.slice(11, 16)}</b><span>{first.origin}</span><small>{first.departureAt.slice(0, 10)}</small></div>
        <div className="seri-flight-journey"><span>{duration(leg.durationMinutes)}</span><i aria-hidden="true"/><small>{leg.stops === 0 ? 'Nonstop' : `${leg.stops} stop${leg.stops > 1 ? 's' : ''}`} {leg.stops > 0 ? `· ${leg.segments.slice(0, -1).map(segment => segment.destination).join(', ')}` : ''}</small></div>
        <div><b>{last.arrivalAt.slice(11, 16)}{dayChange > 0 && <sup>+{dayChange}</sup>}</b><span>{last.destination}</span><small>{last.arrivalAt.slice(0, 10)}</small></div>
      </div>; })}
      <details><summary><Translated text="Flight & fare details" /></summary><p>{offer.fareBrand ?? request.cabin.replace(/_/g, ' ')} · {offer.baggageSummary ?? 'Baggage: check fare conditions'}</p>{legsOf(offer).flatMap(leg => leg.segments).map((segment, index) => <p key={index}>{segment.marketingCarrier} {segment.flightNumber} · {segment.origin} → {segment.destination}</p>)}<p>{offer.nonRefundable === true ? 'Non-refundable fare' : offer.nonRefundable === false ? 'See refund conditions at fare review' : 'Refund conditions confirmed at fare review'}</p></details>
      <footer><div><strong>{price(offer)}</strong><small>Total for {pax} · {request.tripType === 'ROUND_TRIP' ? 'return' : request.tripType === 'MULTI_CITY' ? 'all legs' : 'one way'}</small></div><button type="button" disabled={expired || refreshing} onClick={() => select(offer)}><Translated text="Select flight" /><span aria-hidden="true">→</span></button></footer>
    </article>)}</div>
    <div className="seri-flight-actions">{offers.length > limit && <button type="button" onClick={() => setLimit(value => value + 3)}>Show more ({offers.length - limit})</button>}<button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Checking fares…' : 'Refresh fares'}</button></div>
    {!current.searchFailed && request.tripType !== 'MULTI_CITY' && <FlightDateStrip searchRequest={request} departureDate={request.departureDate} returnDate={request.returnDate} criteriaKey={JSON.stringify(request)} result={current} busy={refreshing} onChoose={(departureDate, returnDate) => { void refresh({ ...request, departureDate, ...(returnDate ? { returnDate } : {}) }); }} />}
    <FareWatchControl key={JSON.stringify(request)} search={request} initialAmount={recommendations.cheapest ? Number(recommendations.cheapest.totalAmount) : undefined} />
    <p className="seri-flight-note">Select a flight to enter passenger details. Price and availability are checked before booking.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
