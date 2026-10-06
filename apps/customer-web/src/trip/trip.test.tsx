// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MyTripsPage } from './MyTripsPage';
import { CreateTripPage } from './CreateTripPage';
import { TripWorkspacePage } from './TripWorkspacePage';
import { ApiClientError } from '../lib/api/client';

const trips = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), addTraveller: vi.fn(), removeTraveller: vi.fn(), addDestination: vi.fn(), updateDestination: vi.fn(), removeDestination: vi.fn() }));
const travellers = vi.hoisted(() => ({ list: vi.fn() }));
const flights = vi.hoisted(() => ({ intentsForTrip: vi.fn(async () => []) }));
vi.mock('../services/tripService', () => ({ tripService: trips }));
vi.mock('../services/travellerService', () => ({ travellerService: travellers }));
vi.mock('../services/flightService', () => ({ flightService: flights }));

const basicTrip = { id: 'trip-1', title: 'Japan family holiday', status: 'PLANNING', startDate: null, endDate: null, primaryDestination: { countryCode: 'JP', cityName: 'Tokyo' }, travellerCount: 1, createdAt: '', updatedAt: '' };
const detail = { ...basicTrip, destinations: [{ id: 'stop-1', countryCode: 'JP', cityName: 'Tokyo', sequence: 1, startDate: null, endDate: null }], travellers: [{ id: 'person-1', legalFirstName: 'Ain', legalLastName: 'Rahman', relationshipType: 'SELF' }] };
const person = { id: 'person-1', legalFirstName: 'Ain', legalLastName: 'Rahman', relationshipType: 'SELF', legalMiddleName: null, dateOfBirth: null, gender: null, nationalityCountryCode: 'MY', isPrimary: true, createdAt: '', updatedAt: '' };
afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

describe('trip planning screens', () => {
  it('shows a loading state and honest empty state', async () => {
    let resolve!: (value: unknown[]) => void;
    trips.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<MemoryRouter><MyTripsPage /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Finding your trips');
    resolve([]);
    expect(await screen.findByText('No trips yet')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Plan a trip' })).toHaveLength(2);
  });

  it('renders real trip data and an open-trip link', async () => {
    trips.list.mockResolvedValue([basicTrip]);
    render(<MemoryRouter><MyTripsPage /></MemoryRouter>);
    expect(await screen.findByText('Japan family holiday')).toBeTruthy();
    expect(screen.getByText('Tokyo, Japan')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Japan family holiday/ }).getAttribute('href')).toBe('/app/trips/trip-1');
  });

  it('shows archived trip history without linking to an unavailable archived detail route', async () => {
    trips.list.mockResolvedValueOnce([]).mockResolvedValueOnce([basicTrip]);
    render(<MemoryRouter><MyTripsPage /></MemoryRouter>);
    await screen.findByText('No trips yet');
    fireEvent.click(screen.getByRole('button', { name: 'Show archived trips' }));
    expect(await screen.findByText('Archived trips are kept for your records.')).toBeTruthy();
    expect(trips.list).toHaveBeenCalledWith({ archived: true });
    expect(screen.queryByRole('link', { name: /Japan family holiday/ })).toBeNull();
  });

  it('selects an existing traveller and creates a trip', async () => {
    travellers.list.mockResolvedValue([person]);
    trips.create.mockResolvedValue(detail);
    render(<MemoryRouter initialEntries={['/app/trips/new']}><Routes><Route path="/app/trips/new" element={<CreateTripPage />} /><Route path="/app/trips/:tripId" element={<div>Created trip route</div>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Ain Rahman')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Destination 1 country'), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText('Destination 1 city'), { target: { value: 'Tokyo' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Create trip/ }));
    expect(await screen.findByText('Created trip route')).toBeTruthy();
    expect(trips.create).toHaveBeenCalledWith(expect.objectContaining({ destinations: [{ countryCode: 'JP', cityName: 'Tokyo' }], travellerIds: ['person-1'] }));
  });

  it('keeps a planning draft when the customer visits travellers', async () => {
    travellers.list.mockResolvedValue([]);
    render(<MemoryRouter><CreateTripPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Trip name'), { target: { value: 'Winter journey' } });
    expect(screen.getByRole('link', { name: '+ Add a traveller' }).getAttribute('href')).toBe('/app/travellers');
    cleanup();
    render(<MemoryRouter><CreateTripPage /></MemoryRouter>);
    expect(screen.getByDisplayValue('Winter journey')).toBeTruthy();
  });

  it('rejects backwards dates and shows creation errors', async () => {
    travellers.list.mockResolvedValue([]);
    trips.create.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><CreateTripPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Departure date'), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Create trip/ }));
    expect(screen.getByRole('alert').textContent).toContain('return date');
    expect(trips.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2026-12-20' } });
    fireEvent.click(screen.getByRole('button', { name: /Create trip/ }));
    expect((await screen.findByRole('alert')).textContent).toContain("couldn't create your trip");
  });

  it('loads the workspace and saves an edit', async () => {
    trips.detail.mockResolvedValue(detail);
    trips.update.mockResolvedValue({ ...detail, title: 'Japan in winter' });
    render(<MemoryRouter initialEntries={['/app/trips/trip-1']}><Routes><Route path="/app/trips/:tripId" element={<TripWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Japan family holiday' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit trip' }));
    fireEvent.change(screen.getByLabelText('Trip name'), { target: { value: 'Japan in winter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Japan in winter' })).toBeTruthy();
    expect(trips.update).toHaveBeenCalledWith('trip-1', expect.objectContaining({ title: 'Japan in winter' }));
  });

  it('keeps a non-owned trip hidden and supports retry after load failure', async () => {
    trips.detail.mockRejectedValueOnce(new ApiClientError('NOT_FOUND', 'Missing', 'id', 404));
    render(<MemoryRouter initialEntries={['/app/trips/trip-1']}><Routes><Route path="/app/trips/:tripId" element={<TripWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Trip not found' })).toBeTruthy();
    cleanup();
    trips.detail.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(detail);
    render(<MemoryRouter initialEntries={['/app/trips/trip-1']}><Routes><Route path="/app/trips/:tripId" element={<TripWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Japan family holiday' })).toBeTruthy());
  });
});
