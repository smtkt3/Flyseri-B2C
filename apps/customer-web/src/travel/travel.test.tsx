// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FlightBooking, FlightOffer } from '@flyseri/types';
import { flightRecommendations } from '../flight/flightRecommendations';
import { bookingCalendar, bookingMilestones, calendarTime } from './TravelCompanion';
import { budgetTotals } from './TripBudget';
import { LanguageProvider, Translated, useLanguage } from './language';
function offer(id: string, price: number, duration: number | null, currency = 'BDT'): FlightOffer {
  return { offerId: id, totalAmount: String(price), currency, airlineCodes: ['MH'], outbound: { durationMinutes: duration, stops: 0, segments: [{ origin: 'DAC', destination: 'KUL', departureAt: '2027-02-10T10:00:00+06:00', arrivalAt: '2027-02-10T16:00:00+08:00', marketingCarrier: 'MH', flightNumber: '103' }] } } as FlightOffer;
}
describe('travel decision helpers', () => {
  it('balances price and duration while keeping cheapest and fastest explicit', () => {
    const recommended = flightRecommendations([offer('cheap', 100, 1200), offer('balanced', 140, 240), offer('fast', 300, 200)]);
    expect(recommended.cheapest?.offerId).toBe('cheap'); expect(recommended.fastest?.offerId).toBe('fast'); expect(recommended.balanced?.offerId).toBe('balanced');
    expect(flightRecommendations([offer('a', 100, 200), offer('b', 1, 200, 'USD')]).balanced).toBeUndefined();
    expect(flightRecommendations([offer('unknown', 100, null)]).fastest).toBeUndefined();
  });
  it('counts all travellers and nights without silently adding unknown costs', () => {
    expect(budgetTotals({ flights: 50000, stay: 3000, nights: 3, daily: 1000, adults: 2, children: 1, other: 2000 })).toBe(73000);
  });
  it('keeps paid and ticketed milestones independent', () => {
    const booking = { pnr: 'ABC123', status: 'AWAITING_STAFF_TICKETING', order: { status: 'PAID', paidAt: '2026-10-10' } } as FlightBooking;
    expect(bookingMilestones(booking)).toEqual([true, true, false]);
    expect(bookingMilestones({ ...booking, status: 'CANCELLED' })).toEqual([false, true, false]);
  });
  it('preserves airport local times and uses UTC only when an offset exists', () => {
    expect(calendarTime('2027-02-10T10:00:00+06:00')).toBe('20270210T040000Z');
    expect(calendarTime('2027-02-10T10:00')).toBe('20270210T100000');
    expect(calendarTime('not a date')).toBeNull();
    const calendar = bookingCalendar({ id: 'booking', status: 'PNR_CREATED', selectedOffer: offer('a', 1, 240) } as FlightBooking);
    expect(calendar).toContain('TRIGGER:-PT24H'); expect(calendar).not.toContain('undefined'); expect(calendar).not.toContain('PNR');
  });
  it('switches language without remounting the booking flow and persists the preference', () => {
    localStorage.clear();
    function Picker() { const { setLanguage } = useLanguage(); return <button onClick={() => setLanguage('bn')}>বাংলা</button>; }
    function Flow() { return <><input aria-label="draft" defaultValue="DAC" /><Translated text="Search flights" /></>; }
    const view = render(<MemoryRouter><LanguageProvider><Picker /><Flow /></LanguageProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'KUL' } }); fireEvent.click(screen.getByText('বাংলা'));
    expect(screen.getByText('ফ্লাইট খুঁজুন')).toBeTruthy(); expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('KUL'); expect(localStorage.getItem('flyseri.language')).toBe('bn');
    view.unmount();
  });
});
