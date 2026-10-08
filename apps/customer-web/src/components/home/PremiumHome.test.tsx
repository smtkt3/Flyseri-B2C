// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider } from '../../auth/AuthProvider';
import { PremiumHome } from './PremiumHome';
import { emptyHomeSearch, updateHomeSearch } from './homeSearchDraft';

const auth = vi.hoisted(() => ({ restore: vi.fn(), onChange: vi.fn(() => () => undefined) }));
const customer = vi.hoisted(() => ({ me: vi.fn() }));
const trips = vi.hoisted(() => ({ list: vi.fn() }));
const orders = vi.hoisted(() => ({ orders: vi.fn(), payments: vi.fn() }));
const documents = vi.hoisted(() => ({ list: vi.fn() }));
const visas = vi.hoisted(() => ({ list: vi.fn() }));
const flights = vi.hoisted(() => ({ intentsForTrip: vi.fn(), popularCachedFares: vi.fn<() => Promise<unknown[]>>() }));
const guestSeri = vi.hoisted(() => ({ guestSend: vi.fn().mockResolvedValue({ message: { id: 'guest-1', role: 'ASSISTANT', content: 'Let’s plan your Tokyo trip.', messageType: 'TEXT', payload: null } }) }));
vi.mock('../../services/seriService', () => ({ seriService: guestSeri }));
vi.mock('../../services/authService', () => ({ authService: auth }));
vi.mock('../../services/customerService', () => ({ customerService: customer }));
vi.mock('../../services/tripService', () => ({ tripService: trips }));
vi.mock('../../services/commerceService', () => ({ commerceService: orders }));
vi.mock('../../services/documentService', () => ({ documentService: documents }));
vi.mock('../../services/visaService', () => ({ visaService: visas }));
vi.mock('../../services/flightService', () => ({ flightService: flights }));

function SearchDestination() {
  const { search } = useLocation();
  return <div data-testid="search-destination">{search}</div>;
}
function renderHome(compact = false) {
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: compact && query === '(max-width: 1366px)', media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
  render(<MemoryRouter initialEntries={['/']}><AuthProvider><Routes>
    <Route path="/" element={<PremiumHome />} />
    <Route path="/flights" element={<SearchDestination />} />
    <Route path="/app/seri" element={<SearchDestination />} />
  </Routes></AuthProvider></MemoryRouter>);
}

function chooseDate(label: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
  const dialog = screen.getByRole('dialog', { name: `Choose a date for ${label.toLowerCase()}` });
  const [year, month] = value.split('-').map(Number) as [number, number];
  const targetMonth = new Intl.DateTimeFormat('en-MY', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  while (dialog.querySelector('h3')?.textContent !== targetMonth) {
    const heading = dialog.querySelector('h3')?.textContent ?? '';
    const current = new Date(`${heading} 1`);
    const currentIndex = Number.isNaN(current.valueOf()) ? year * 12 + month - 1 : current.getFullYear() * 12 + current.getMonth();
    fireEvent.click(screen.getByRole('button', { name: currentIndex < year * 12 + month - 1 ? 'Next month' : 'Previous month' }));
  }
  fireEvent.click(dialog.querySelector(`[data-calendar-date="${value}"]`) as HTMLElement);
}

beforeEach(() => flights.popularCachedFares.mockResolvedValue([]));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('premium homepage', () => {
  beforeEach(() => { sessionStorage.clear(); updateHomeSearch(emptyHomeSearch); });
  it('switches compact search modes without losing flight dates or AI drafts', async () => {
    auth.restore.mockResolvedValue(null);
    renderHome(true);
    const flightPanel = screen.getByRole('tabpanel', { name: 'Flights' });
    expect(flightPanel).toBeTruthy();
    const flightSearch = flightPanel.querySelector('.premium-search') as HTMLElement;
    expect(getComputedStyle(flightSearch).overflowY).toBe('visible');
    expect(getComputedStyle(flightSearch).maxHeight).toBe('none');
    expect(screen.queryByRole('region', { name: 'Explore flights on the world map' })).toBeNull();
    chooseDate('Departure', '2026-11-12');
    fireEvent.click(screen.getByRole('button', { name: /^Departure,/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Map Search' }));
    expect(screen.queryByRole('dialog', { name: 'Choose a date for departure' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Explore flights on the world map' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search flights' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Map Search' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'AI Search' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'AI Search' }));
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'Find a beach trip' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Flights' }));
    expect(screen.getByRole('button', { name: /^Departure,/ }).textContent).not.toContain('Choose date');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Search' }));
    expect((screen.getByLabelText('Ask Seri a travel question') as HTMLInputElement).value).toBe('Find a beach trip');
    expect(screen.getByRole('button', { name: 'Ask Seri' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('link', { name: 'Sign in for your saved trips' }).getAttribute('href')).toBe('/sign-in');
  });

  it('answers guest questions on the desktop homepage',async()=>{
    auth.restore.mockResolvedValue(null);renderHome();await screen.findByText('Find your next escape');
    const button=screen.getByRole('button',{name:'Ask Seri'});expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'),{target:{value:'Plan 5 days in Tokyo'}});fireEvent.click(button);
    expect(await screen.findByText('Let’s plan your Tokyo trip.')).toBeTruthy();
    expect(guestSeri.guestSend).toHaveBeenCalledWith('Plan 5 days in Tokyo', [], 'BDT');
  });

  it('expands and closes the travel services menu without presenting future services as live', async () => {
    auth.restore.mockResolvedValue(null);
    renderHome();
    expect(await screen.findByText('Find your next escape')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Expand travel services' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Collapse travel services' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('Soon')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /^Packages$/ }).getAttribute('href')).toBe('/holidays');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Expand travel services' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('shows honest empty states without loading customer data for a guest', async () => {
    auth.restore.mockResolvedValue(null);
    renderHome();
    expect(await screen.findByText('Find your next escape')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Explore flights on the world map' })).toBeTruthy();
    expect(screen.queryByText(/\$1,120|RM 1,120/)).toBeNull();
    expect(trips.list).not.toHaveBeenCalled();
    expect(orders.orders).not.toHaveBeenCalled();
  });

  it('shows many destinations and only displays prices returned by the cached fare service', async () => {
    auth.restore.mockResolvedValue(null);
    flights.popularCachedFares.mockResolvedValue([
      { destination: 'BKK', departureDate: '2026-11-12', price: '499', currency: 'BDT', searchedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z' },
      { destination: 'NRT', departureDate: '2026-11-20', price: '1299', currency: 'BDT', searchedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z' },
    ]);
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Show full world map' }));
    expect(await screen.findByRole('button', { name: 'Select Bangkok, BDT 499' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select Tokyo, BDT 1,299' })).toBeTruthy();
    const map = screen.getByRole('group', { name: 'Interactive world destination map' });
    expect(map.querySelectorAll('.explore-map-place').length).toBeGreaterThan(5);
    expect(map.querySelectorAll('.explore-map-routes g').length).toBeGreaterThan(5);
    expect(screen.queryByRole('complementary', { name: 'Upcoming trip' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Recent fares only' }));
    expect(screen.getByRole('group', { name: 'Interactive world destination map' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select London, Check fares' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select Tokyo, BDT 1,299' }));
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('destination=NRT');
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum cached fare' }), { target: { value: '1000' } });
    expect(screen.getByRole('group', { name: 'Interactive world destination map' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('destination=BKK');
    fireEvent.click(screen.getByRole('switch', { name: 'Show routes' }));
    expect(map.querySelectorAll('.explore-map-routes g')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByRole('group', { name: 'Interactive world destination map' })).toBeTruthy();  });

  it('shows a real trip and sends a valid search to the live flight route', async () => {
    auth.restore.mockResolvedValue({ user: { email: 'ain@example.com' } } as Session);
    customer.me.mockResolvedValue({ displayName: 'Ain' });
    trips.list.mockResolvedValue([{ id: 'trip-1', title: 'Japan family holiday', status: 'PLANNING',
      startDate: null, endDate: null, primaryDestination: { countryCode: 'JP', cityName: 'Tokyo' },
      travellerCount: 2, createdAt: '2026-09-28', updatedAt: '2026-09-28' }]);
    orders.orders.mockResolvedValue([]);
    orders.payments.mockResolvedValue([]);
    documents.list.mockResolvedValue([]);
    visas.list.mockResolvedValue([]);
    flights.intentsForTrip.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText('Ain', {}, { timeout: 5000 })).toBeTruthy();

    expect(screen.getByRole('region', { name: 'Explore flights on the world map' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Passengers and cabin/ }));
    expect(screen.getByRole('dialog', { name: 'Passengers and cabin' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add children' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add infants on lap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('radio', { name: 'One-way' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'From airport' }), { target: { value: 'KUL' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To airport' }), { target: { value: 'NRT' } });
    chooseDate('Departure', '2026-12-12');
    fireEvent.click(screen.getByRole('button', { name: /Search flights/ }));
    await waitFor(() => expect(screen.getByTestId('search-destination').textContent)
      .toContain('origin=KUL&destination=NRT&departureDate=2026-12-12'));
    expect(screen.getByTestId('search-destination').textContent).toContain('autoSearch=1');
    expect(screen.getByTestId('search-destination').textContent).toContain('children=1&infants=1');
    expect(screen.getByTestId('search-destination').textContent).toContain('cabin=ECONOMY');
  }, 10000);
  it('offers a multi-city search and sends its connected legs in order', async () => {
    auth.restore.mockResolvedValue(null);
    renderHome();
    expect(await screen.findByText('Find your next escape')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Multi-city' }));
    const froms = screen.getAllByRole('combobox', { name: 'From airport' });
    const tos = screen.getAllByRole('combobox', { name: 'To airport' });
    fireEvent.change(froms[0]!, { target: { value: 'KUL' } });
    fireEvent.change(tos[0]!, { target: { value: 'NRT' } });
    fireEvent.change(tos[1]!, { target: { value: 'KIX' } });
    chooseDate('Flight 1 date', '2026-12-12');
    chooseDate('Flight 2 date', '2026-12-18');
    fireEvent.click(screen.getByRole('button', { name: /Search flights/ }));
    await waitFor(() => expect(screen.getByTestId('search-destination').textContent).toContain('tripType=MULTI_CITY'));
    const query = new URLSearchParams(screen.getByTestId('search-destination').textContent);
    expect(JSON.parse(query.get('legs') ?? '[]')).toEqual([
      { origin: 'KUL', destination: 'NRT', departureDate: '2026-12-12' },
      { origin: 'NRT', destination: 'KIX', departureDate: '2026-12-18' },
    ]);
  }, 10000);
});
