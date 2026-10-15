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
export function FlightDateStrip({ departureDate, returnDate, criteriaKey, result, busy, onChoose, searchRequest, compact=false, onEditDates }: {
  departureDate: string; returnDate?: string; criteriaKey: string;
  result: FlightSearchResponse | null; busy: boolean;
  onChoose: (departure: string, returning?: string) => void;
  searchRequest?: FlightSearchRequest;
  compact?: boolean;
  onEditDates?: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const days = useRef<HTMLDivElement>(null);
  const [quotes, setQuotes] = useState<Record<string, { amount: number; currency: string; expiresAt: string }>>({});
  const [now,setNow]=useState(Date.now);
  const [cacheRevision,setCacheRevision]=useState(0);
  const [cacheChecking,setCacheChecking]=useState(false);
  const [checking, setChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { controller.current?.abort(); setChecking(false); setCheckNotice(''); return () => controller.current?.abort(); }, [criteriaKey, departureDate, returnDate]);
  const duration = returnDate ? Math.round((Date.parse(returnDate) - Date.parse(departureDate)) / 86400000) : 0;
  const keyFor = (date: string) => `${criteriaKey}|${date}|${returnDate ? shiftFlightDate(date, duration) : ''}`;
  const cacheRequestKey=searchRequest?JSON.stringify({...searchRequest,tripId:undefined,departureDate,returnDate:returnDate||undefined}):'';
  useEffect(()=>{
    const clock=window.setInterval(()=>setNow(Date.now()),60_000);
    const refresh=()=>{if(document.visibilityState!=='hidden')setCacheRevision(value=>value+1);};
    const timer=window.setInterval(refresh,60_000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{window.clearInterval(clock);window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  useEffect(()=>{
    const expirations=Object.values(quotes).map(quote=>Date.parse(quote.expiresAt)).filter(expiry=>Number.isFinite(expiry)&&expiry>now);
    if(!expirations.length)return;
    const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(1,Math.min(2_147_483_647,Math.min(...expirations)-Date.now()+1)));
    return()=>window.clearTimeout(timer);
  },[quotes,now]);
  useEffect(()=>{
    setCacheChecking(false);
    if(!cacheRequestKey||busy||!shiftFlightDate(departureDate,0)||document.visibilityState==='hidden')return;
    const request=JSON.parse(cacheRequestKey) as FlightSearchRequest;
    const visibleDates=Array.from({length:7},(_,index)=>shiftFlightDate(departureDate,offset+index-3)).filter(date=>date>=new Date().toISOString().slice(0,10));
    const months=[...new Set(visibleDates.map(date=>date.slice(0,7)))];
    if(!months.length)return;
    const abort=new AbortController();setCacheChecking(true);
    void Promise.allSettled(months.map(month=>flightService.cachedCalendarFares(request,month,'departure',abort.signal,{keepTripLength:true,dates:visibleDates.filter(date=>date.startsWith(`${month}-`))}))).then(results=>{
      if(abort.signal.aborted)return;
      const updatedAt=Date.now();setNow(updatedAt);
      setQuotes(previous=>{
        const next=Object.fromEntries(Object.entries(previous).filter(([,quote])=>Date.parse(quote.expiresAt)>updatedAt).slice(-200));
        for(const result of results){
          if(result.status!=='fulfilled')continue;
          for(const quote of result.value){
            if(!visibleDates.includes(quote.date)||quote.currency!==request.currency||!Number.isFinite(quote.amount)||quote.amount<=0||!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=updatedAt)continue;
            const key=`${criteriaKey}|${quote.date}|${returnDate?shiftFlightDate(quote.date,duration):''}`;
            next[key]={amount:quote.amount,currency:quote.currency,expiresAt:quote.expiresAt};
          }
        }
        return next;
      });
    }).finally(()=>{if(!abort.signal.aborted)setCacheChecking(false);});
    return()=>abort.abort();
  },[cacheRequestKey,criteriaKey,departureDate,returnDate,duration,offset,busy,cacheRevision,result?.searchId]);
  useEffect(() => { setOffset(0); }, [departureDate]);
  useEffect(() => {
    const container=days.current;
    if(!container)return;
    const center=()=>{
      const selected=container.querySelector<HTMLButtonElement>('.is-selected');
      if(selected)container.scrollLeft+=selected.getBoundingClientRect().left-container.getBoundingClientRect().left-(container.clientWidth-selected.clientWidth)/2;
    };
    center();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(center);
    observer?.observe(container);
    return()=>observer?.disconnect();
  }, [departureDate,offset,compact]);
  useEffect(() => {
    if (!result?.offers.length) return;
    const amounts = result.offers.map(offer => Number(offer.totalAmount)).filter(amount=>Number.isFinite(amount)&&amount>0);
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
  const nearbyControls=searchRequest&&<div className="travel-date-check"><span role="status">{checkNotice || 'Compare 7 departure dates. Return trips keep the same length.'}</span><button type="button" disabled={busy || checking} onClick={() => void checkNearby()}>{checking ? 'Checking dates…' : 'Find cheaper dates ±3 days'}</button></div>;
  return <><section className={`flight-date-strip${compact?' is-compact':''}`} aria-label="Compare departure dates">
    <button className="flight-date-arrow" type="button" aria-label="Previous seven dates" disabled={busy || shiftFlightDate(departureDate, offset - 3) <= today} onClick={() => setOffset(value => value - 7)}>‹</button>
    <div className="flight-date-days" ref={days}>{Array.from({length:7}, (_, index) => {
      const date = shiftFlightDate(departureDate, offset + index - 3);
      const quote = quotes[keyFor(date)];
      const current = date === departureDate;
      const fresh = quote && Date.parse(quote.expiresAt) > now;
      const priceLoading=!fresh&&(busy&&current||cacheChecking);
      const label = new Intl.DateTimeFormat('en-MY', {weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
      const shortLabel=new Intl.DateTimeFormat('en-MY',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
      const priceLabel=fresh?new Intl.NumberFormat('en-MY',{style:'currency',currency:quote.currency}).format(quote.amount).replace(/\u00a0/g,' '):current?(compact?'Selected':'Selected date'):'Search date';
      return <button type="button" key={date} disabled={busy || date < today} aria-label={`${label} ${date.slice(0,4)}, ${priceLoading?'Checking price':priceLabel}`} aria-pressed={current} className={current?'is-selected':''} onClick={() => {if(!current)onChoose(date,returnDate?shiftFlightDate(date,duration):undefined);}}>
        <strong>{compact?shortLabel:label}</strong><small>{priceLoading?<span className="flight-skeleton-shape skeleton-date-price" aria-label="Checking price"/>:priceLabel}</small>
      </button>;
    })}</div>
    <button className="flight-date-arrow" type="button" aria-label="Next seven dates" disabled={busy} onClick={() => setOffset(value => value + 7)}>›</button>
    {onEditDates&&<button className="flight-date-edit" type="button" aria-label="Choose travel dates" disabled={busy} onClick={onEditDates}><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M7 14h2M12 14h2M7 17h2M12 17h2"/></svg></button>}
    </section>{!compact&&nearbyControls}</>;
}
