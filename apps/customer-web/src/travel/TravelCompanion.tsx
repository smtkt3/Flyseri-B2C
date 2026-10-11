import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FlightBooking } from '@flyseri/types';
import { bookingLegs } from '../flight/bookingPresentation';
import { downloadText } from '../lib/downloadText';
import { useLanguage } from './language';

export function bookingMilestones(booking: FlightBooking) {
  const cancelled = booking.status === 'CANCELLED';
  const reserved = !!booking.pnr && !cancelled;
  const paid = booking.order?.status === 'PAID' && !!booking.order.paidAt;
  const ticketed = booking.status === 'TICKETED' || !!booking.providerView?.tickets.some(ticket => ticket.status === 'Issued');
  return [reserved, paid, ticketed];
}
const escapeCalendar = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
/** Offset-less airline times stay floating local times; never guess a timezone. */
export function calendarTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value); if (!Number.isFinite(parsed.valueOf())) return null;
    return parsed.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  return value.replace(/[-:]/g, '') + (value.length === 16 ? '00' : '');
}
export function bookingCalendar(booking: FlightBooking, now = new Date()): string {
  const stamp = calendarTime(now.toISOString().replace(/\.\d{3}/, ''))!;
  const events = bookingLegs(booking).flatMap(leg => leg.segments).flatMap((segment, index) => {
    const start = calendarTime(segment.departureAt); const end = calendarTime(segment.arrivalAt);
    if (!start || !end) return [];
    return ['BEGIN:VEVENT', `UID:${booking.id}-${index}@flyseri`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`,
      `SUMMARY:${escapeCalendar(`${segment.marketingCarrier}${segment.flightNumber} ${segment.origin} → ${segment.destination}`)}`,
      `LOCATION:${escapeCalendar(segment.origin)}`, 'DESCRIPTION:Check airline schedule and ticket status before travel. Times without an offset use airport local time.',
      ...(booking.status === 'CANCELLED' ? ['STATUS:CANCELLED'] : ['STATUS:TENTATIVE']),
      'BEGIN:VALARM', 'TRIGGER:-PT24H', 'ACTION:DISPLAY', 'DESCRIPTION:Review your flight and airline check-in options', 'END:VALARM', 'END:VEVENT'];
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flyseri//Travel companion//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}
function downloadCalendar(booking: FlightBooking) {
  const url = URL.createObjectURL(new Blob([bookingCalendar(booking)], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Flyseri-flights-${booking.id}.ics`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TravelCompanion({ booking }: { booking: FlightBooking }) {
  const { t } = useLanguage();
  const [includePrivate, setIncludePrivate] = useState(false);
  const done = bookingMilestones(booking);
  const labels = ['Reservation', 'Payment received', 'Ticket issued'];
  const current = done.findIndex(value => !value);
  return <section className="travel-tool"><h2>{t('Booking progress')}</h2><ol className="travel-stage-list">{labels.map((label, index) => <li key={label} className={done[index] ? 'is-complete' : index === current ? 'is-current' : ''} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{done[index] ? '✓' : index + 1}</span><strong>{t(label)}</strong><span>{done[index] ? 'Confirmed' : 'Not confirmed'}</span></li>)}</ol>
    <p>{booking.status === 'CANCELLED' ? 'This reservation is cancelled. Contact support about any payment or refund.' : !done[0] ? 'Next: wait for reservation verification before paying or trying again.' : !done[1] ? 'Next: review your order and complete payment when available.' : !done[2] ? 'Next: wait for airline ticket issuance. A payment receipt is not an airline ticket.' : 'Your ticket is issued. Review your airline details and travel documents before departure.'}</p>
    <details><summary>{t('Travel companion')}</summary><p>Save your itinerary and add flights to your calendar with a reminder 24 hours before departure. Calendar reminders depend on your calendar app; live delay or gate alerts are not included.</p>
      <label style={{ display: 'flex', alignItems: 'center', margin: '12px 0' }}><input style={{ width: 18, minHeight: 18 }} type="checkbox" checked={includePrivate} onChange={event => setIncludePrivate(event.target.checked)} />Include PNR and passenger names in the downloaded summary</label>
      <div className="travel-actions"><button onClick={() => downloadText(`Flyseri-itinerary-${booking.id}.txt`, ['Flyseri travel itinerary', `Saved: ${new Date().toISOString()}`, `Booking status: ${booking.status}`, ...(includePrivate ? [`PNR: ${booking.pnr ?? 'Not confirmed'}`, ...booking.passengerNames] : []), ...bookingLegs(booking).flatMap(leg => leg.segments.map(segment => `${segment.marketingCarrier}${segment.flightNumber}: ${segment.origin} → ${segment.destination}\n${segment.departureAt} — ${segment.arrivalAt}`)), 'This saved summary is not an airline ticket. Confirm current schedule and ticket status before travel.'].join('\n\n'))}>{t('Save offline summary')}</button><button disabled={booking.status === 'CANCELLED'} onClick={() => downloadCalendar(booking)}>{t('Add flights to calendar')}</button><Link to={`/app/support?bookingId=${encodeURIComponent(booking.id)}`}>{t('Support')} →</Link></div>
    </details>
  </section>;
}
