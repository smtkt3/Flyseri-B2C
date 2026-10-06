// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingList } from './BookingList';
import { FlightIntentPage } from './FlightIntentPage';
const api = vi.hoisted(() => ({ bookings: vi.fn(), intent: vi.fn(), bookingForIntent: vi.fn(), validateIntent: vi.fn() }));
vi.mock('../services/flightService', () => ({ flightService: api }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const booking = { id: 'booking-1', bookingIntentId: 'intent-1', status: 'PNR_CREATED', pnr: 'TEST01', amount: '100.00', currency: 'MYR',
  passengerNames: ['Test Traveler'], selectedOffer: { airlineCodes: ['MH'], outbound: { segments: [{ origin: 'KUL', destination: 'PEN', departureAt: '2099-01-01T09:00:00+08:00', arrivalAt: '2099-01-01T10:00:00+08:00' }] } } };
describe('booking management', () => {
  it('filters by status and searches existing passenger and PNR references without additional calls', async () => {
    api.bookings.mockResolvedValue([booking, { ...booking, id: 'booking-2', pnr: 'TEST02', status: 'BOOKING_UNKNOWN', passengerNames: ['Another Traveler'] }]);
    render(<MemoryRouter><BookingList /></MemoryRouter>);
    expect(await screen.findByText('TEST01')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }));
    expect(screen.queryByText('TEST01')).toBeNull();
    expect(screen.getByText('TEST02')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Test Traveler' } });
    expect(screen.getByText('TEST01')).toBeTruthy();
    expect(screen.queryByText('TEST02')).toBeNull();
    expect(screen.getByRole('link', { name: /Manage booking/ }).getAttribute('href')).toBe('/app/bookings/booking-1');
    expect(api.bookings).toHaveBeenCalledOnce();
  });
  it('restores an existing attempt instead of revalidating or reserving from the old review URL', async () => {
    api.intent.mockResolvedValue({ id: 'intent-1' });
    api.bookingForIntent.mockResolvedValue(booking);
    render(<MemoryRouter initialEntries={[{ pathname: '/review/intent-1', state: { checkLatestFare: true } }]}><Routes><Route path="/review/:intentId" element={<FlightIntentPage />} /><Route path="/app/bookings/:bookingId" element={<p>Restored booking</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Restored booking')).toBeTruthy();
    expect(api.validateIntent).not.toHaveBeenCalled();
  });
});
