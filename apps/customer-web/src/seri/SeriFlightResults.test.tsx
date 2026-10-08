// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { FlightOffer } from '@flyseri/types';
import { chatFlights, SeriFlightResults, type ChatFlights } from './SeriFlightResults';
const search = vi.hoisted(() => vi.fn());
vi.mock('../services/flightService', () => ({ flightService: { search } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
const request: ChatFlights['searchRequest'] = { origin: 'DAC', destination: 'BKK', departureDate: '2027-01-22', tripType: 'ONE_WAY', adults: 2, children: 1, infants: 0, cabin: 'ECONOMY', currency: 'BDT' };
function offer(id: string, price: string, minutes: number, stops = 0): FlightOffer { return { offerId: id, airlineCodes: ['BG'], currency: 'BDT', totalAmount: price, baggageSummary: '20 kg checked baggage', inbound: null, outbound: { durationMinutes: minutes, stops, segments: [{ origin: 'DAC', destination: 'BKK', departureAt: '2027-01-22T12:00:00+06:00', arrivalAt: '2027-01-22T15:30:00+07:00', marketingCarrier: 'BG', flightNumber: id, durationMinutes: minutes }] } }; }
function data(): ChatFlights { return { source: 'sabre', searchId: 'search-1', searchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), searchRequest: request, offers: [offer('recommended', '30000', 200, 1), offer('cheapest', '20000', 220), offer('fastest', '25000', 150)] }; }
function Destination() { const location = useLocation(); return <pre data-testid="selection">{JSON.stringify({ path: location.pathname, ...location.state })}</pre>; }
function mount(result = data()) { return render(<MemoryRouter initialEntries={['/#book']}><Routes><Route path="/" element={<SeriFlightResults data={result} />} /><Route path="/flight-checkout" element={<Destination />} /></Routes></MemoryRouter>); }
describe('flight selection inside Seri', () => {
  it('sorts and filters existing results without making another supplier request', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'cheapest' } });
    expect(screen.getAllByRole('article')[0]!.textContent).toContain('20,000');
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'fastest' } });
    expect(screen.getAllByRole('article')[0]!.textContent).toContain('2h 30m');
    fireEvent.click(screen.getByLabelText('Nonstop'));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(search).not.toHaveBeenCalled();
  });
  it('carries the selected offer, immutable request, search ID and chat return route straight to passenger details', () => {
    const result = data(); mount(result);
    fireEvent.click(within(screen.getAllByRole('article')[1]!).getByRole('button', { name: 'Select flight' }));
    const selected = JSON.parse(screen.getByTestId('selection').textContent!);
    expect(selected).toEqual({ path: '/flight-checkout', offer: result.offers[1], searchId: 'search-1', searchRequest: request, seriReturnTo: '/#book' });
  });
  it('checks expiry at click time even before the periodic UI timer runs', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    const result = data(); result.expiresAt = new Date(Date.now() + 1000).toISOString(); mount(result);
    vi.setSystemTime(new Date(Date.now() + 2000));
    fireEvent.click(screen.getAllByRole('button', { name: 'Select flight' })[0]!);
    expect(screen.getByRole('alert').textContent).toContain('expired');
    expect(screen.queryByTestId('selection')).toBeNull();
  });
  it('refreshes the same trip and uses the new search snapshot for selection', async () => {
    const result = data(); result.expiresAt = new Date(0).toISOString();
    const fresh = { ...data(), searchId: 'search-fresh', offers: [offer('new', '24000', 150)] };
    search.mockResolvedValue(fresh); mount(result);
    expect((screen.getAllByRole('button', { name: 'Select flight' })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh fares' }));
    await screen.findByText('BDT 24,000.00');
    expect(search).toHaveBeenCalledWith(request);
    fireEvent.click(screen.getByRole('button', { name: 'Select flight' }));
    expect(JSON.parse(screen.getByTestId('selection').textContent!).searchId).toBe('search-fresh');
  });
  it('handles no availability and rejects malformed flight cards', () => {
    const result = data(); result.offers = []; mount(result);
    expect(screen.getByText(/No flights found/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select flight' })).toBeNull();
    expect(chatFlights({ ...data(), offers: [{ offerId: 'bad' }] })?.offers).toEqual([]);
    expect(chatFlights({ offers: [] })).toBeNull();
  });
});
