import { useEffect, useRef, useState } from 'react';
import type { FlightSearchRequest, FlightSearchResponse } from '@flyseri/types';
import { flightService } from '../services/flightService';

export function shiftFlightDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.valueOf())) return '';
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Only display prices already returned for the same search criteria and dates. */
export function FlightDateStrip({ departureDate, returnDate, criteriaKey, result, busy, onChoose, searchRequest }: {
  departureDate: string; returnDate?: string; criteriaKey: string;
  result: FlightSearchResponse | null; busy: boolean;
  onChoose: (departure: string, returning?: string) => void;
  searchRequest?: FlightSearchRequest;
}) {
  const [offset, setOffset] = useState(0);
  const days = useRef<HTMLDivElement>(null);
  const [quotes, setQuotes] = useState<Record<string, { amount: number; currency: string; expiresAt: string }>>({});
  const [checking, setChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { controller.current?.abort(); setChecking(false); setCheckNotice(''); return () => controller.current?.abort(); }, [criteriaKey, departureDate, returnDate]);
  const duration = returnDate ? Math.round((Date.parse(returnDate) - Date.parse(departureDate)) / 86400000) : 0;
  const keyFor = (date: string) => `${criteriaKey}|${date}|${returnDate ? shiftFlightDate(date, duration) : ''}`;
  useEffect(() => { setOffset(0); }, [departureDate]);
  useEffect(() => {
    const container=days.current;
    const selected=container?.querySelector<HTMLButtonElement>('.is-selected');
    if(container&&selected)container.scrollLeft=selected.offsetLeft-container.offsetLeft-(container.clientWidth-selected.clientWidth)/2;
  }, [departureDate,offset]);
  useEffect(() => {
    if (!result?.offers.length) return;
    const amounts = result.offers.map(offer => Number(offer.totalAmount)).filter(Number.isFinite);
    if (!amounts.length || new Set(result.offers.map(offer => offer.currency)).size !== 1) return;
    const key = keyFor(departureDate);
    setQuotes(previous => ({ ...previous, [key]: {amount: Math.min(...amounts), currency: result.offers[0]!.currency, expiresAt: result.expiresAt} }));
  // Results belong to the submitted search; changing criteria clears them in the parent.
  }, [result]);
  if (!shiftFlightDate(departureDate,0)) return null;
  const today = new Date().toISOString().slice(0, 10);
  async function checkNearby() {
    if (!searchRequest || checking || busy) return;
    const abort = new AbortController(); controller.current = abort; setChecking(true); setCheckNotice('Checking nearby dates…');
    let failed = 0; let checked = 0;
    for (const days of [-3, -2, -1, 1, 2, 3]) {
      const date = shiftFlightDate(departureDate, days);
      if (abort.signal.aborted) return;
      if (date < today) continue;
      try {
        const response = await flightService.search({ ...searchRequest, departureDate: date, ...(returnDate ? { returnDate: shiftFlightDate(date, duration) } : {}) }, { signal: abort.signal });
        if (abort.signal.aborted) return;
        const values = response.offers.filter(offer => offer.currency === searchRequest.currency).map(offer => Number(offer.totalAmount)).filter(value => Number.isFinite(value) && value > 0);
        if (values.length) setQuotes(previous => ({ ...previous, [keyFor(date)]: { amount: Math.min(...values), currency: searchRequest.currency, expiresAt: response.expiresAt } }));
        checked++;
      } catch { if (abort.signal.aborted) return; failed++; }
      setCheckNotice(`Checked ${checked} nearby dates${failed ? ` · ${failed} unavailable` : ''}`);
    }
    setChecking(false);
  }
  return <><section className="flight-date-strip" aria-label="Compare departure dates">
    <button className="flight-date-arrow" type="button" aria-label="Previous seven dates" disabled={busy || shiftFlightDate(departureDate, offset - 3) <= today} onClick={() => setOffset(value => value - 7)}>‹</button>
    <div className="flight-date-days" ref={days}>{Array.from({length:7}, (_, index) => {
      const date = shiftFlightDate(departureDate, offset + index - 3);
      const quote = quotes[keyFor(date)];
      const current = date === departureDate;
      const fresh = quote && Date.parse(quote.expiresAt) > Date.now();
      const label = new Intl.DateTimeFormat('en-MY', {weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
      return <button type="button" key={date} disabled={busy || date < today} aria-pressed={current} className={current?'is-selected':''} onClick={() => {if(!current)onChoose(date,returnDate?shiftFlightDate(date,duration):undefined);}}>
        <strong>{label}</strong><small>{busy&&current&&!fresh?<span className="flight-skeleton-shape skeleton-date-price" aria-label="Checking fare"/>:fresh ? new Intl.NumberFormat('en-MY',{style:'currency',currency:quote.currency}).format(quote.amount) : current ? 'Selected date' : 'Search date'}</small>
      </button>;
    })}</div>
    <button className="flight-date-arrow" type="button" aria-label="Next seven dates" disabled={busy} onClick={() => setOffset(value => value + 7)}>›</button>
    </section>{searchRequest && <div className="travel-date-check"><span role="status">{checkNotice || 'Compare 7 departure dates. Return trips keep the same length.'}</span><button type="button" disabled={busy || checking} onClick={() => void checkNearby()}>{checking ? 'Checking dates…' : 'Find cheaper dates ±3 days'}</button></div>}</>;
}
