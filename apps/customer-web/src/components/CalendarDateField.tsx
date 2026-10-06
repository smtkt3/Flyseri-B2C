import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewportPopover } from './useViewportPopover';
import './calendar-date-field.css';

type CalendarDateFieldProps = {
  label: string;
  value: string;
  minDate?: string;
  onChange: (value: string) => void;
  className?: string;
  align?: 'start' | 'end';
};

const today = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

function parseDate(value?: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
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

export function CalendarDateField({ label, value, minDate, onChange, className = '', align = 'start' }: CalendarDateFieldProps) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(parseDate(value) ?? parseDate(minDate) ?? today()));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const popoverStyle = useViewportPopover(open, trigger, { width: 336, height: 480, mobileSheet: true, align });
  const selectedDate = parseDate(value);
  const minimum = parseDate(minDate);
  const minimumKey = minimum ? dateKey(minimum) : '';
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
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  function showCalendar() {
    setVisibleMonth(monthStart(selectedDate ?? minimum ?? today()));
    setOpen(true);
  }

  function changeMonth(delta: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return <div ref={root} className={`calendar-date-field${open ? ' is-open' : ''}${align === 'end' ? ' align-end' : ''} ${className}`}>
    <button ref={trigger} type="button" className="calendar-date-trigger" aria-label={`${label}${value ? `, ${formatDate(value)}` : ', choose date'}`} aria-haspopup="dialog" aria-expanded={open} data-value={value} onClick={() => open ? setOpen(false) : showCalendar()}>
      <span className="calendar-date-copy"><span className="calendar-date-label">{label}</span><span className={`calendar-date-value${value ? '' : ' is-empty'}`}>{value ? formatDate(value) : 'Choose date'}</span></span>
      <svg className="calendar-date-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5" /><path d="M7.5 3.5v4M16.5 3.5v4M4 9.5h16M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" /></svg>
    </button>
    {open && createPortal(<section ref={popover} style={popoverStyle} className="calendar-popover calendar-popover-portal" role="dialog" aria-label={`Choose a date for ${label.toLowerCase()}`}>
      <header className="calendar-popover-header">
        <div><span className="calendar-popover-eyebrow">SELECT A DATE</span><h3>{monthLabel}</h3></div>
        <div className="calendar-month-controls">
          <button type="button" aria-label="Previous month" disabled={!!minimum && visibleMonth.getFullYear() === minimum.getFullYear() && visibleMonth.getMonth() <= minimum.getMonth()} onClick={() => changeMonth(-1)}>‹</button>
          <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
          <button type="button" className="calendar-close" aria-label="Close date picker" onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button>
        </div>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-days" role="grid" aria-label={monthLabel}>
        {dates.map((date, index) => {
          if (!date) return <span className="calendar-day-empty" key={`empty-${index}`} aria-hidden="true" />;
          const key = dateKey(date);
          const disabled = !!minimumKey && key < minimumKey;
          const classes = ['calendar-day', key === value ? 'selected' : '', key === todayKey ? 'today' : ''].filter(Boolean).join(' ');
          return <button key={key} type="button" className={classes} data-calendar-date={key} aria-label={`${formatDate(key)}${key === value ? ', selected' : ''}`} aria-current={key === todayKey ? 'date' : undefined} disabled={disabled} onClick={() => { onChange(key); setOpen(false); trigger.current?.focus(); }}>{date.getDate()}</button>;
        })}
      </div>
      <footer className="calendar-popover-footer"><span>{value ? `Selected · ${formatDate(value)}` : 'Choose your travel date'}</span><button type="button" onClick={() => { const target = minimum && minimumKey > todayKey ? minimum : today(); const key = dateKey(target); onChange(key); setVisibleMonth(monthStart(target)); setOpen(false); trigger.current?.focus(); }}>{minimum && minimumKey > todayKey ? 'Earliest' : 'Today'}</button></footer>
    </section>, document.body)}
  </div>;
}
