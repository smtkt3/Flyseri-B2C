import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewportPopover } from './useViewportPopover';
import { useBackStepState } from './useBackStepState';
import './calendar-date-field.css';
import type { CachedCalendarFare, FlightSearchRequest } from '@flyseri/types';
import { flightService } from '../services/flightService';

type CalendarDateFieldProps = {
  label: string;
  value: string;
  minDate?: string;
  maxDate?: string;
  minYear?: number;
  maxYear?: number;
  controlId?: string;
  required?: boolean;
  fareSearch?: FlightSearchRequest;
  fareDateField?: 'departure' | 'return';
  onChange: (value: string) => void;
  className?: string;
  align?: 'start' | 'end';
  error?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  active?: boolean;
};

const today = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

function parseDate(value?: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!match)return null;
  const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
  return dateKey(date)===value?date:null;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDate(value: string) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date) : '';
}

export function HistoryCalendarDateField(props: CalendarDateFieldProps) {
  const [open, setOpen] = useBackStepState(`home-date:${props.label}`, false);
  return <CalendarDateField {...props} open={props.active === false ? false : open} onOpenChange={setOpen} />;
}

export function CalendarDateField({ label, value, minDate, maxDate, minYear=1900, maxYear=new Date().getFullYear()+15, controlId, required=false, fareSearch, fareDateField='departure', onChange, className = '', align = 'start', error, open: controlledOpen, onOpenChange }: CalendarDateFieldProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const errorId = useId();
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(parseDate(value) ?? parseDate(minDate) ?? today()));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const popoverStyle = useViewportPopover(open, trigger, { width: fareSearch?420:360, height: fareSearch?580:480, mobileSheet: true, align });
  const selectedDate = parseDate(value);
  const minimum = parseDate(minDate);
  const minimumKey = minimum ? dateKey(minimum) : '';
  const maximumKey = parseDate(maxDate) ? maxDate! : '';
  const [fares,setFares]=useState<CachedCalendarFare[]>([]);
  const [fareNotice,setFareNotice]=useState('');
  const [now,setNow]=useState(Date.now);
  const fareCriteria=JSON.stringify(fareSearch??null);
  const monthKey=dateKey(visibleMonth).slice(0,7);
  const freshFares=fares.filter(fare=>Date.parse(fare.expiresAt)>now);
  const fareMap=new Map(freshFares.map(fare=>[fare.date,fare]));
  const lowestFare=freshFares.length?Math.min(...freshFares.map(fare=>fare.amount)):null;
  const firstYear=Math.max(minYear,minimum?.getFullYear()??minYear);
  const lastYear=Math.max(firstYear,Math.min(maxYear,parseDate(maxDate)?.getFullYear()??maxYear));
  useEffect(()=>{
    if(!open)return;
    setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),15000);
    return()=>window.clearInterval(timer);
  },[open]);
  useEffect(()=>{
    const expires=fares.map(fare=>Date.parse(fare.expiresAt)).filter(value=>value>now&&Number.isFinite(value));
    if(!open||!expires.length)return;
    const timer=window.setTimeout(()=>setNow(Date.now()),Math.min(2147483647,Math.max(1,Math.min(...expires)-Date.now()+1)));
    return()=>window.clearTimeout(timer);
  },[open,fares,now]);
  useEffect(()=>{
    setFares([]);setFareNotice('');
    if(!open||fareCriteria==='null')return;
    const request=JSON.parse(fareCriteria) as FlightSearchRequest;
    if(!/^[A-Z]{3}$/.test(request.origin)||!/^[A-Z]{3}$/.test(request.destination)||!request.departureDate||request.tripType==='MULTI_CITY')return;
    const abort=new AbortController();setFareNotice('Loading cached fares…');
    void flightService.cachedCalendarFares(request,monthKey,fareDateField,abort.signal).then(values=>{
      if(abort.signal.aborted)return;setFares(values);setNow(Date.now());setFareNotice(values.length?'Cached total fares · prices may change':'No cached fares for this month. Choose any date to search.');
    },()=>{if(!abort.signal.aborted)setFareNotice('Cached fares are temporarily unavailable. You can still choose a date.');});
    return()=>abort.abort();
  },[open,fareCriteria,monthKey,fareDateField]);
  const firstOffset = (new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const dates = useMemo(() => Array.from({ length: Math.ceil((firstOffset + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstOffset + 1;
    return day < 1 || day > daysInMonth ? null : new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
  }), [daysInMonth, firstOffset, visibleMonth]);
  const monthLabel = new Intl.DateTimeFormat('en-MY', { month: 'long', year: 'numeric' }).format(visibleMonth);
  const todayKey = dateKey(today());

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
      if(event.key==='Tab'&&popover.current){
        const controls=[...popover.current.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)')];
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    const frame=requestAnimationFrame(()=>popover.current?.querySelector<HTMLElement>('.calendar-day.selected:not(:disabled),.calendar-day:not(:disabled)')?.focus());
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(frame);document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  function showCalendar() {
    setVisibleMonth(monthStart(selectedDate ?? minimum ?? today()));
    setOpen(true);
  }

  function changeMonth(delta: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return <div ref={root} className={`calendar-date-field${open ? ' is-open' : ''}${align === 'end' ? ' align-end' : ''} ${className}`}>
    <button id={controlId} ref={trigger} type="button" className="calendar-date-trigger" aria-required={required} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} aria-label={`${label}${value ? `, ${formatDate(value)}` : ', choose date'}`} aria-haspopup="dialog" aria-expanded={open} data-value={value} onClick={() => open ? setOpen(false) : showCalendar()}>
      <span className="calendar-date-copy"><span className="calendar-date-label">{label}</span><span className={`calendar-date-value${value ? '' : ' is-empty'}`}>{value ? formatDate(value) : 'Choose date'}</span></span>
      <svg className="calendar-date-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5" /><path d="M7.5 3.5v4M16.5 3.5v4M4 9.5h16M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" /></svg>
    </button>
    {error && <span className="home-field-error" id={errorId}>{error}</span>}
    {open && createPortal(<section ref={popover} style={popoverStyle} className={`calendar-popover calendar-popover-portal${fareSearch?' has-fares':''}`} role="dialog" aria-label={`Choose a date for ${label.toLowerCase()}`}>
      <header className="calendar-popover-header">
        <div><span className="calendar-popover-eyebrow">{label}</span><div className="calendar-period-select"><select aria-label="Calendar month" value={visibleMonth.getMonth()} onChange={event=>setVisibleMonth(new Date(visibleMonth.getFullYear(),Number(event.target.value),1))}>{Array.from({length:12},(_,index)=><option key={index} value={index}>{new Intl.DateTimeFormat('en-MY',{month:'long'}).format(new Date(2026,index,1))}</option>)}</select><select aria-label="Calendar year" value={visibleMonth.getFullYear()} onChange={event=>setVisibleMonth(new Date(Number(event.target.value),visibleMonth.getMonth(),1))}>{Array.from({length:lastYear-firstYear+1},(_,index)=><option key={firstYear+index} value={firstYear+index}>{firstYear+index}</option>)}</select></div></div>
        <div className="calendar-month-controls">
          <button type="button" aria-label="Previous month" disabled={visibleMonth.getFullYear()<=firstYear&&visibleMonth.getMonth()===0||!!minimum&&monthKey<=minimumKey.slice(0,7)} onClick={() => changeMonth(-1)}>‹</button>
          <button type="button" aria-label="Next month" disabled={visibleMonth.getFullYear()>=lastYear&&visibleMonth.getMonth()===11||!!maximumKey&&monthKey>=maximumKey.slice(0,7)} onClick={() => changeMonth(1)}>›</button>
          <button type="button" className="calendar-close" aria-label="Close date picker" onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button>
        </div>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-days" role="group" aria-label={monthLabel}>
        {dates.map((date, index) => {
          if (!date) return <span className="calendar-day-empty" key={`empty-${index}`} aria-hidden="true" />;
          const key = dateKey(date);
          const disabled = !!minimumKey && key < minimumKey || !!maximumKey && key > maximumKey;
          const fare=fareMap.get(key);
          const fareLabel=fare?new Intl.NumberFormat('en-MY',{notation:'compact',maximumFractionDigits:1}).format(fare.amount):'';
          const classes = ['calendar-day', key === value ? 'selected' : '', key === todayKey ? 'today' : ''].filter(Boolean).join(' ');
          return <button key={key} type="button" className={`${classes}${fare&&fare.amount===lowestFare?' is-lowest-fare':''}`} data-calendar-date={key} aria-label={`${formatDate(key)}${key === value ? ', selected' : ''}${fare?`, cached total ${fare.currency} ${fare.amount}`:''}`} title={fare?`${fare.currency} ${fare.amount} total · cached fare`:undefined} aria-current={key === todayKey ? 'date' : undefined} disabled={disabled} onClick={() => { onChange(key); setOpen(false); trigger.current?.focus(); }}><span>{date.getDate()}</span>{fareSearch&&<small className="calendar-day-fare">{fareLabel||'—'}</small>}</button>;
        })}
      </div>
      {fareSearch&&<p className="calendar-fare-notice" role="status">{fareSearch.currency} · {fareSearch.adults+fareSearch.children+fareSearch.infants} traveler{fareSearch.adults+fareSearch.children+fareSearch.infants===1?'':'s'} · {fareNotice}{freshFares.length>0&&<span>Green marks the lowest cached fare. — means no cached price.</span>}</p>}
      <footer className="calendar-popover-footer"><span>{value ? `Selected · ${formatDate(value)}` : 'Choose a date'}</span><button type="button" disabled={!!maximumKey&&todayKey>maximumKey} onClick={() => { const target = minimum && minimumKey > todayKey ? minimum : today(); const key = dateKey(target); onChange(key); setVisibleMonth(monthStart(target)); setOpen(false); trigger.current?.focus(); }}>{minimum && minimumKey > todayKey ? 'Earliest' : 'Today'}</button></footer>
    </section>, document.body)}
  </div>;
}
