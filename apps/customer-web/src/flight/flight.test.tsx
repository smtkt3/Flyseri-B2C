// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiClientError } from '../lib/api/client';
import { FlightSearchPage } from './FlightSearchPage';
import { FlightIntentPage } from './FlightIntentPage';
import { GuestFlightCheckoutPage } from './GuestFlightCheckoutPage';

const flightApi = vi.hoisted(() => ({ search: vi.fn(), searchProgressively: vi.fn(), createIntent: vi.fn(), intent: vi.fn(), validateIntent: vi.fn(), confirmPrice: vi.fn(), cancelIntent: vi.fn(), bookingForIntent: vi.fn(), bookingCapabilities: vi.fn(), reserve: vi.fn() }));
const tripApi = vi.hoisted(() => ({ detail: vi.fn() }));
const travellerApi = vi.hoisted(() => ({ list: vi.fn() }));
const commerceApi = vi.hoisted(() => ({ createFlightOrder: vi.fn() }));
vi.mock('../services/flightService', () => ({ flightService: flightApi }));
vi.mock('../services/tripService', () => ({ tripService: tripApi }));
vi.mock('../services/travellerService', () => ({ travellerService: travellerApi }));
vi.mock('../services/commerceService', () => ({ commerceService: commerceApi }));
beforeEach(() => {
  flightApi.searchProgressively.mockImplementation(async (input, publish, options) => { const response = await flightApi.search(input, options); publish(response); return response; });
  flightApi.bookingForIntent.mockResolvedValue(null); flightApi.bookingCapabilities.mockResolvedValue({reservationAvailable: false, environment: 'CERT', message: 'Reservation creation is awaiting approved agency configuration.'});
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
const offer = (id: string, price: string, stops = 0, duration = 420) => ({ offerId: id, totalAmount: price, currency: 'MYR', airlineCodes: ['MH'], baggageSummary: null,
  outbound: { stops, durationMinutes: duration, segments: [{ origin: 'KUL', destination: 'NRT', departureAt: '2026-12-10T09:00:00+08:00', arrivalAt: '2026-12-10T16:00:00+09:00', marketingCarrier: 'MH', flightNumber: '70', bookingClass: 'K', aircraftTypeCode: '738', durationMinutes: duration }] }, inbound: null });
const result = { searchId: 'search-id', offers: [offer('high', '1200.00', 0, 350), offer('low', '900.00', 1, 600)], source: 'sabre', searchedAt: new Date().toISOString(), expiresAt: new Date().toISOString() };
function page(path = '/app/flights') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/app/flights" element={<FlightSearchPage />} /><Route path="/app/flights/booking-intents/:intentId" element={<FlightIntentPage />} /></Routes></MemoryRouter>); }
function publicPage(path = '/flights') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/flights" element={<FlightSearchPage publicSearch />} /><Route path="/flight-checkout" element={<GuestFlightCheckoutPage />} /><Route path="/sign-in" element={<p>Sign in to continue</p>} /></Routes></MemoryRouter>); }
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
function selectFare(cardIndex = 0, fareIndex = 0) {
  fireEvent.click(screen.getAllByRole('button', { name: 'View fare details' })[cardIndex]!);
  fireEvent.click(screen.getAllByRole('button', { name: 'Select fare' })[fareIndex]!);
}
function fill() {
  fireEvent.change(screen.getByLabelText('From airport'), { target: { value: 'KUL' } });
  fireEvent.change(screen.getByLabelText('To airport'), { target: { value: 'NRT' } });
  chooseDate('Departure', '2026-12-10');
  chooseDate('Return', '2026-12-20');
}
describe('live flight search screen', () => {
  it('shows usable first fares before the search finishes and retains them if the remaining search fails', async () => {
    let fail!: (error: unknown) => void;
    flightApi.searchProgressively.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    publicPage('/flights?origin=KUL&destination=NRT&departureDate=2026-12-10&tripType=ONE_WAY&autoSearch=1');
    await waitFor(() => expect(flightApi.searchProgressively).toHaveBeenCalledOnce());
    await act(async () => { flightApi.searchProgressively.mock.calls[0]![1](result); });
    expect(screen.getByText('2 flight options')).toBeTruthy();
    expect(screen.getByText(/Flights are ready to choose/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'View fare details' })[0]!);
    expect((screen.getAllByRole('button', { name: 'Select fare' })[0] as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fail(new ApiClientError('DEPENDENCY_UNAVAILABLE', 'Unavailable')); });
    expect(screen.getByText('2 flight options')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('You can choose a fare below');
    expect(screen.queryByText(/Flights are ready to choose/)).toBeNull();
  });
  it('opens the custom calendar from anywhere in a date field and updates the chosen date', () => {
    publicPage('/flights');
    const field = screen.getByRole('button', { name: /^Departure/ });
    fireEvent.click(within(field).getByText('Choose date'));
    const calendar = screen.getByRole('dialog', { name: 'Choose a date for departure' });
    const availableDay = calendar.querySelector('.calendar-day:not(:disabled)') as HTMLButtonElement;
    const chosenDate = availableDay.dataset.calendarDate;
    fireEvent.click(availableDay);
    expect(calendar.isConnected).toBe(false);
    expect(field.getAttribute('data-value')).toBe(chosenDate);
  });

  it('opens guest review from the fare drawer and offers no card-level selection action', async () => {
    flightApi.search.mockResolvedValue(result);
    publicPage('/flights?origin=KUL&destination=NRT&departureDate=2026-12-10&tripType=ONE_WAY&autoSearch=1');
    expect(await screen.findByText('2 flight options')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select flight' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'View fare details' })[0]!);
    expect(screen.queryByText('Baggage')).toBeNull();
    expect(screen.getByText(/Aircraft 738/)).toBeTruthy();
    expect(screen.queryByText(/Booking class K/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Select fare' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Complete your traveler details' })).toBeTruthy();
    expect(travellerApi.list).not.toHaveBeenCalled();
    expect(flightApi.createIntent).not.toHaveBeenCalled();
  });
  it('confirms a guest passenger into a summary and uses the name for booking contact', async () => {
    flightApi.search.mockResolvedValue(result);
    publicPage('/flights?origin=KUL&destination=NRT&departureDate=2026-12-10&tripType=ONE_WAY&autoSearch=1');
    await screen.findByText('2 flight options');
    selectFare();
    expect(await screen.findByRole('heading', { name: 'Complete your traveler details' })).toBeTruthy();
    const checkoutTotal = screen.getByRole('region', { name: 'Checkout total' });
    expect(within(checkoutTotal).getByText(/1,200\.00/)).toBeTruthy();
    fireEvent.click(screen.getByText('Select / enter'));
    expect(screen.getByText('Promo codes are not available for this fare yet.')).toBeTruthy();
    fireEvent.click(within(checkoutTotal).getByRole('button', { name: 'Sign in to continue' }));
    expect(screen.getByText('Confirm every passenger before continuing.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send verification code' })).toBeNull();
    fireEvent.change(screen.getByLabelText(/First \/ given names/), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Last name \(surname\)/), { target: { value: 'Flyer' } });
    fireEvent.change(screen.getByLabelText(/Gender on ID/), { target: { value: 'FEMALE' } });
    fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText(/Nationality/), { target: { value: 'MY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm passenger' }));
    expect(screen.getByText('Passenger 1: Test Flyer')).toBeTruthy();
    expect((screen.getByLabelText(/Contact name/) as HTMLInputElement).value).toBe('Test Flyer');
    fireEvent.click(screen.getByRole('button', { name: /Completed · Edit/ }));
    expect(screen.getByLabelText(/First \/ given names/)).toBeTruthy();
  });
  it('keeps a chosen outbound while showing only compatible return flights', async () => {
    const outboundA = offer('a', '400').outbound;
    const outboundB = { ...outboundA, segments: [{ ...outboundA.segments[0]!, flightNumber: '71' }] };
    const returnX = { ...outboundA, segments: [{ ...outboundA.segments[0]!, origin: 'NRT', destination: 'KUL', departureAt: '2026-12-20T09:00:00+09:00', arrivalAt: '2026-12-20T16:00:00+08:00', flightNumber: '80' }] };
    const returnY = { ...returnX, segments: [{ ...returnX.segments[0]!, flightNumber: '81' }] };
    flightApi.search.mockResolvedValue({ ...result, offers: [
      { ...offer('a-x', '400'), outbound: outboundA, inbound: returnX, baggageAllowances: [
        { type: 'CHECKED', availability: 'INCLUDED', description: '15 kg', segmentIndexes: [0] },
        { type: 'CHECKED', availability: 'INCLUDED', description: '20 kg', segmentIndexes: [1] },
      ] },
      { ...offer('a-y', '430'), outbound: outboundA, inbound: returnY },
      { ...offer('b-y', '450'), outbound: outboundB, inbound: returnY },
    ] });
    publicPage('/flights?origin=KUL&destination=NRT&departureDate=2026-12-10&returnDate=2026-12-20&tripType=ROUND_TRIP&autoSearch=1');
    expect(await screen.findByText('2 flight options')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'View fare details' })[0]!);
    expect(screen.queryByRole('button', { name: 'Select fare' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose this flight · next flight' }));
    expect(await screen.findByText('2 flight options')).toBeTruthy();
    expect(screen.getByText(/2 complete-trip fares/)).toBeTruthy();
    expect(screen.getByText('RETURN FLIGHTS · SABRE')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'View fare details' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Select fare' })).toHaveLength(1);
    expect(screen.getAllByText('Outbound').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Return').length).toBeGreaterThan(0);
    const baggageLegs = document.querySelectorAll('.flight-fare-baggage-leg');
    expect(baggageLegs).toHaveLength(2);
    expect(baggageLegs[0]?.textContent).toContain('15 kg');
    expect(baggageLegs[1]?.textContent).toContain('20 kg');
    fireEvent.click(screen.getByRole('button', { name: 'Select fare' }));
    expect(await screen.findByRole('heading', { name: 'Complete your traveler details' })).toBeTruthy();
    expect(screen.getByText('KUL → NRT · NRT → KUL')).toBeTruthy();
    expect(flightApi.search).toHaveBeenCalledTimes(1);
  });
  it('advances through every multi-city flight before showing fare choices', async () => {
    const leg1 = offer('first', '500').outbound;
    const leg2 = { ...leg1, segments: [{ ...leg1.segments[0]!, origin: 'NRT', destination: 'SIN', departureAt: '2026-12-14T09:00:00+09:00', arrivalAt: '2026-12-14T16:00:00+08:00', flightNumber: '90' }] };
    const leg2Alternative = { ...leg2, segments: [{ ...leg2.segments[0]!, flightNumber: '91' }] };
    const leg3 = { ...leg1, segments: [{ ...leg1.segments[0]!, origin: 'SIN', destination: 'KUL', departureAt: '2026-12-18T09:00:00+08:00', arrivalAt: '2026-12-18T10:00:00+08:00', flightNumber: '100' }] };
    flightApi.search.mockResolvedValue({ ...result, offers: [
      { ...offer('first-combination', '500'), multiCityLegs: [leg1, leg2, leg3] },
      { ...offer('second-combination', '530'), multiCityLegs: [leg1, leg2Alternative, leg3] },
    ] });
    const legs = [{ origin: 'KUL', destination: 'NRT', departureDate: '2026-12-10' }, { origin: 'NRT', destination: 'SIN', departureDate: '2026-12-14' }, { origin: 'SIN', destination: 'KUL', departureDate: '2026-12-18' }];
    publicPage(`/flights?origin=KUL&destination=KUL&departureDate=2026-12-10&tripType=MULTI_CITY&legs=${encodeURIComponent(JSON.stringify(legs))}&autoSearch=1`);
    expect(await screen.findByText('1 flight option')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View fare details' }));
    expect(screen.queryByRole('button', { name: 'Select fare' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose this flight · next flight' }));
    expect(await screen.findByText('2 flight options')).toBeTruthy();
    expect(screen.getByText('FLIGHT 2 FLIGHTS · SABRE')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'View fare details' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Choose this flight · next flight' }));
    expect(await screen.findByText('1 flight option')).toBeTruthy();
    expect(screen.getByText('FLIGHT 3 FLIGHTS · SABRE')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View fare details' }));
    expect(screen.getAllByRole('button', { name: 'Select fare' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Select fare' }));
    expect(await screen.findByRole('heading', { name: 'Complete your traveler details' })).toBeTruthy();
    expect(flightApi.search).toHaveBeenCalledTimes(1);
  });
  it('runs a homepage search immediately and opens results without a second search form', async () => {
    flightApi.search.mockResolvedValue(result);
    page('/app/flights?origin=KUL&destination=NRT&departureDate=2026-12-10&tripType=ONE_WAY&adults=1&cabin=ECONOMY&autoSearch=1');
    expect(await screen.findByText('2 flight options')).toBeTruthy();
    expect(flightApi.search).toHaveBeenCalledTimes(1);
    expect(flightApi.search.mock.calls[0]?.[0]).toMatchObject({ origin: 'KUL', destination: 'NRT', tripType: 'ONE_WAY' });
    expect((screen.getByLabelText('From airport') as HTMLInputElement).value).toBe('KUL');
    expect((screen.getByLabelText('To airport') as HTMLInputElement).value).toBe('NRT');
    expect(document.querySelector('.flight-search-form')).not.toBeNull();
  });
  it('validates locally before calling the API', () => {
    page(); fill();
    fireEvent.change(screen.getByLabelText('To airport'), { target: { value: 'KUL' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(screen.getByRole('alert').textContent).toContain('Check your airports');
    expect(flightApi.search).not.toHaveBeenCalled();
  });
  it('explains that child fares need age details before a live search', () => {
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /1 adult/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add children' }));
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(screen.getByRole('alert').textContent).toContain('need age details');
    expect(flightApi.search).not.toHaveBeenCalled();
  });
  it('uses local airport suggestions and sends their IATA codes without a lookup request', async () => {
    flightApi.search.mockResolvedValue({ ...result, offers: [] });
    page(); fill();
    expect(screen.getByLabelText('To airport').getAttribute('role')).toBe('combobox');
    fireEvent.change(screen.getByLabelText('From airport'), { target: { value: 'Kuala Lumpur (KUL)' } });
    fireEvent.change(screen.getByLabelText('To airport'), { target: { value: 'Tokyo (NRT)' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('No flights matched this search');
    expect(flightApi.search).toHaveBeenCalledTimes(1);
    expect(flightApi.search.mock.calls[0]?.[0]).toMatchObject({ origin: 'KUL', destination: 'NRT' });
  });
  it('shows loading, prevents duplicate submission, and renders real response only', async () => {
    let resolve!: (value: unknown) => void;
    flightApi.search.mockReturnValue(new Promise((done) => { resolve = done; }));
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(screen.getByRole('status').textContent).toContain('Checking flights');
    expect((document.querySelector('.flight-search-form button[type="submit"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(flightApi.search).toHaveBeenCalledTimes(1);
    resolve(result);
    expect(await screen.findByText('2 flight options')).toBeTruthy();
    expect(screen.getAllByText(/Shopping fares/)).toHaveLength(2);
    expect(screen.getAllByText(/9:00 am UTC\+08:00/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4:00 pm UTC\+09:00/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fares and availability may change until confirmed/).length).toBeGreaterThan(0);
  });
  it('shows the stop airport, overnight layover and onward operating airline from the offer segments', async () => {
    const connecting = { ...offer('connection', '950.00', 1, 780), airlineCodes: ['MH', 'SQ'], outbound: {
      stops: 1, durationMinutes: 780, segments: [
        { origin: 'KUL', destination: 'SIN', departureAt: '2026-12-10T22:45:00+08:00', arrivalAt: '2026-12-10T23:45:00+08:00', marketingCarrier: 'MH', flightNumber: '601', durationMinutes: 60 },
        { origin: 'SIN', destination: 'NRT', departureAt: '2026-12-11T02:15:00+08:00', arrivalAt: '2026-12-11T10:15:00+09:00', marketingCarrier: 'SQ', operatingCarrier: 'TR', flightNumber: '120', durationMinutes: 420 },
      ],
    } };
    flightApi.search.mockResolvedValue({ ...result, offers: [connecting] });
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'View fare details' }));
    expect(await screen.findByText('Layover in Singapore (SIN)')).toBeTruthy();
    expect(await screen.findByText('Singapore Changi Airport')).toBeTruthy();
    expect(screen.getByText('Layover 2h 30m')).toBeTruthy();
    expect(screen.getByText(/Next: Singapore Airlines \(SQ\) 120 · Operated by Scoot \(TR\)/)).toBeTruthy();
    expect(flightApi.search).toHaveBeenCalledTimes(1);
  });
  it('compares priced cabins from one search and shows only supplied fare details', async () => {
    const economy = { ...offer('economy', '125.00'), itineraryKey: '0:7', cabin: 'ECONOMY', fareBrand: 'Super Saver',
      baggageSummary: '0 kg checked baggage', baggageCharge: { amount: '81.00', currency: 'MYR', description: 'UP TO 15 KG' },
      baggageAllowances: [{ type: 'PERSONAL_ITEM', availability: 'INCLUDED', description: null, segmentIndexes: [0] },
        { type: 'CARRY_ON', availability: 'INCLUDED', description: '1 piece', segmentIndexes: [0] },
        { type: 'CHECKED', availability: 'INCLUDED', description: '15 kg', segmentIndexes: [0] }],
      penalties: [{ type: 'REFUND', applicability: 'BEFORE', allowed: false, amount: null, currency: null },
        { type: 'CHANGE', applicability: 'BEFORE', allowed: false, amount: null, currency: null }],
      amenities: [{ category: 'WIFI', name: 'Wi-Fi', availability: 'INCLUDED' }, { category: 'MEALS', name: 'Meal', availability: 'FOR_FEE' }] };
    const business = { ...offer('business', '350.00'), outbound: { ...offer('business', '350.00').outbound, segments: [{ ...offer('business', '350.00').outbound.segments[0]!, bookingClass: 'C' }] }, itineraryKey: '0:7', cabin: 'BUSINESS', fareBrand: 'Flexible',
      baggageSummary: '2 checked bags', amenities: [] };
    flightApi.search.mockResolvedValue({ ...result, offers: [economy, business] });
    travellerApi.list.mockResolvedValue([]);
    page(); fill(); fireEvent.click(screen.getByRole('radio', { name: 'One-way' })); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByText('1 flight option')).toBeTruthy();
    expect(screen.getByText('· 2 complete-trip fares')).toBeTruthy();
    expect(flightApi.search).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'View fare details' }));
    expect(screen.getByText('Super Saver')).toBeTruthy();
    expect(screen.queryByText(/Additional baggage listed/)).toBeNull();
    expect(screen.getByText('Wi-Fi:').closest('p')?.textContent).toContain('Included');
    expect(screen.getByText('Meal:').closest('p')?.textContent).toContain('Available for a fee');
    expect(screen.queryByText('Not provided by Sabre')).toBeNull();
    expect(screen.getAllByText('Personal item:').length).toBeGreaterThan(0);
    expect(screen.getByText(/Included.*1 piece/)).toBeTruthy();
    expect(screen.getByText(/Included.*15 kg/)).toBeTruthy();
    expect(screen.getByText(/Non-refundable.*before departure/)).toBeTruthy();
    expect(screen.getByText(/Changes not permitted.*before departure/)).toBeTruthy();
    expect(screen.getByText('Flexible')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Select fare' })[1]!);
    const selection = await screen.findByLabelText('Select flight travellers');
    expect(selection.textContent).toContain('350');
    expect(flightApi.search).toHaveBeenCalledTimes(1);
  });
  it('sorts and filters locally without another backend request', async () => {
    flightApi.search.mockResolvedValue(result);
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('2 flight options');
    fireEvent.click(screen.getByRole('button', { name: /Cheapest/ }));
    expect(document.querySelector('.flight-offer .flight-price')?.textContent).toContain('900');
    fireEvent.click(screen.getByText('Nonstop'));
    expect(screen.getAllByText(/Shopping fares/)).toHaveLength(1);
    expect(flightApi.search).toHaveBeenCalledTimes(1);
  });
  it('shows the selected fare before the results and guides customers without travellers', async () => {
    flightApi.search.mockResolvedValue(result);
    travellerApi.list.mockResolvedValue([]);
    page(); fill(); fireEvent.click(screen.getByRole('radio', { name: 'One-way' })); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('2 flight options');
    selectFare();
    const selection = await screen.findByLabelText('Select flight travellers');
    await screen.findByText('Add a traveller profile to check this fare.');
    const list = document.querySelector('.flight-offer-list');
    expect(list).not.toBeNull();
    expect(selection.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(selection.textContent).toContain('Malaysia Airlines(MH)');
    expect(selection.textContent).toContain('KUL → NRT · RM');
    expect(screen.getByRole('button', { name: 'Check latest fare' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('link', { name: '+ Add a traveller' })).toBeTruthy();
  });
  it('shows no-results and provider errors without sample fares', async () => {
    flightApi.search.mockResolvedValueOnce({ ...result, offers: [] }).mockRejectedValueOnce(new ApiClientError('DEPENDENCY_UNAVAILABLE', 'No provider'));
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByText('No flights matched this search')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('The airline connection is temporarily unavailable. Please try your search again.');
    expect(screen.getByRole('button', { name: 'Retry search' })).toBeTruthy();
    expect(screen.queryByText(/sample Bali itinerary/i)).toBeNull();
  });
  it('prefills confirmed trip dates without assuming every trip traveller is an adult passenger', async () => {
    tripApi.detail.mockResolvedValue({ id: 'trip-1', title: 'Japan', startDate: '2026-12-10', endDate: '2026-12-20', travellerCount: 3, primaryDestination: { cityName: 'Tokyo', countryCode: 'JP' }, travellers: [] });
    page('/app/flights?tripId=trip-1');
    expect(await screen.findByText(/Searching for Japan/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Departure/ }).getAttribute('data-value')).toBe('2026-12-10'));
    expect(screen.getByRole('button', { name: /^Return/ }).getAttribute('data-value')).toBe('2026-12-20');
    expect(screen.getByRole('button', { name: /1 adult/ }).textContent).toContain('1 adult');
    expect((screen.getByLabelText('To airport') as HTMLInputElement).value).toBe('');
  });
  it('renders a large response in bounded batches without another search call', async () => {
    flightApi.search.mockResolvedValue({ ...result, offers: Array.from({ length: 500 }, (_, n) => ({ ...offer(`offer-${n}`, String(500 + n)), outbound: { ...offer(`offer-${n}`, String(500 + n)).outbound, segments: [{ ...offer(`offer-${n}`, String(500 + n)).outbound.segments[0]!, flightNumber: String(n) }] } })) });
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('500 flight options');
    expect(screen.getAllByText(/Shopping fares/)).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: 'Show more flights' }));
    expect(screen.getAllByText(/Shopping fares/)).toHaveLength(60);
    expect(flightApi.search).toHaveBeenCalledTimes(1);
  });
  it('cancels an obsolete search when the route changes', async () => {
    let resolve!: (value: unknown) => void;
    flightApi.search.mockReturnValue(new Promise((done) => { resolve = done; }));
    page(); fill(); fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    const signal = flightApi.search.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.change(screen.getByLabelText('To airport'), { target: { value: 'HND' } });
    await waitFor(() => expect(signal.aborted).toBe(true));
    resolve(result);
    await waitFor(() => expect(screen.queryByText('2 flight options')).toBeNull());
  });
  it('selects saved travellers once, never sends browser price, and shows unavailable live validation honestly', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
    flightApi.search.mockResolvedValue(result);
    travellerApi.list.mockResolvedValue([
      { id: 'traveller-a', legalFirstName: 'Ain', legalMiddleName: null, legalLastName: 'Rahman' },
      { id: 'traveller-b', legalFirstName: 'Ali', legalMiddleName: null, legalLastName: 'Rahman' },
    ]);
    const saved = { id: 'intent-1', tripId: null, status: 'CREATED', selectedOffer: result.offers[0], travellerIds: ['traveller-a', 'traveller-b'], currency: 'MYR', searchTotalAmount: '1200.00', validatedTotalAmount: null, priceChanged: false, validatedAt: null, expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    flightApi.createIntent.mockResolvedValue(saved);
    flightApi.intent.mockResolvedValue(saved);
    flightApi.validateIntent.mockRejectedValue(new ApiClientError('DEPENDENCY_UNAVAILABLE', 'No repricing contract'));
    page(); fill(); fireEvent.click(screen.getByRole('radio', { name: 'One-way' })); fireEvent.click(screen.getByRole('button', { name: /1 adult/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add adults' }));
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('2 flight options');
    selectFare();
    await screen.findAllByText('Ain Rahman');
    const proceed = screen.getByRole('button', { name: 'Check latest fare' });
    fireEvent.click(proceed); fireEvent.click(proceed);
    expect(await screen.findByText('No repricing contract')).toBeTruthy();
    expect(flightApi.createIntent).toHaveBeenCalledTimes(1);
    expect(flightApi.createIntent.mock.calls[0]?.[0]).toMatchObject({ searchId: 'search-id', offerId: 'high', travellerIds: ['traveller-a', 'traveller-b'] });
    expect(JSON.stringify(flightApi.createIntent.mock.calls[0]?.[0])).not.toContain('1200.00');
    expect(flightApi.validateIntent).toHaveBeenCalledTimes(1);
  });
  it('reloads a saved selection without repeating live validation', async () => {
    travellerApi.list.mockResolvedValue([]);
    flightApi.intent.mockResolvedValue({ id: 'intent-1', tripId: null, status: 'CREATED', selectedOffer: offer('high', '1200.00'), travellerIds: ['traveller-a'], currency: 'MYR', searchTotalAmount: '1200.00', validatedTotalAmount: null, priceChanged: false, validatedAt: null, expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    page('/app/flights/booking-intents/intent-1');
    expect(await screen.findByText(/Shopping fare · availability/)).toBeTruthy();
    expect(flightApi.validateIntent).not.toHaveBeenCalled();
    expect(screen.getByText(/No flight has been booked/)).toBeTruthy();
  });
  it('requires a customer to accept a changed fare before showing ready state', async () => {
    travellerApi.list.mockResolvedValue([]);
    const changed = { id: 'intent-1', tripId: null, status: 'PRICE_CHANGED', selectedOffer: offer('high', '1200.00'), travellerIds: ['traveller-a'],
      currency: 'MYR', searchTotalAmount: '1200.00', validatedTotalAmount: '1300.00', priceChanged: true,
      validatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 180000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    flightApi.intent.mockResolvedValue(changed);
    flightApi.confirmPrice.mockResolvedValue({ ...changed, status: 'READY_FOR_PAYMENT' });
    page('/app/flights/booking-intents/intent-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Accept MYR 1,300.00' }));
    expect(await screen.findByText(/Fare check valid for/)).toBeTruthy();
    expect(flightApi.confirmPrice).toHaveBeenCalledWith('intent-1');
  });
  it('requires legal-name review before requesting a reservation', async () => {
    travellerApi.list.mockResolvedValue([{ id: 'traveller-a', legalFirstName: 'Ain', legalMiddleName: null, legalLastName: 'Rahman' }]);
    flightApi.intent.mockResolvedValue({ id: 'intent-1', tripId: null, status: 'READY_FOR_PAYMENT', selectedOffer: offer('high', '1200.00'), travellerIds: ['traveller-a'], currency: 'MYR', searchTotalAmount: '1200.00', validatedTotalAmount: '1200.00', priceChanged: false, validatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 180000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    flightApi.bookingCapabilities.mockResolvedValue({reservationAvailable: true, environment: 'CERT', message: ''});
    flightApi.reserve.mockResolvedValue({id: 'booking-1'});
    page('/app/flights/booking-intents/intent-1');
    const button = await screen.findByRole('button', { name: 'Create test reservation' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await screen.findAllByText('Ain Rahman');
    fireEvent.click(screen.getByRole('checkbox', { name: /checked these legal names/ }));
    expect(button.hasAttribute('disabled')).toBe(false);
    for (const [label,value] of [['Booking email','ain@example.com'], ['Booking phone','+60123456789'], ['Billing name','Ain Rahman'], ['Billing street address','Test Street'], ['Billing city','Kuala Lumpur'], ['Billing state / region','Kuala Lumpur'], ['Billing postcode','50000'], ['Billing country','MY']]) fireEvent.change(screen.getByLabelText(label!),{target:{value}});
    fireEvent.click(button);
    await waitFor(() => expect(flightApi.reserve).toHaveBeenCalledOnce());
    expect(flightApi.reserve).toHaveBeenCalledWith('intent-1',expect.objectContaining({namesConfirmed: true, contactEmail:'ain@example.com'}));
    expect(commerceApi.createFlightOrder).not.toHaveBeenCalled();
  });
});
