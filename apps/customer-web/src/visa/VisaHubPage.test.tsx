// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VisaHubPage } from './VisaHubPage';

const api = vi.hoisted(() => ({ trips: vi.fn(), requests: vi.fn(), detail: vi.fn(), applications: vi.fn(), catalogue: vi.fn(), travellers: vi.fn() }));
vi.mock('../services/tripService', () => ({ tripService: { list: api.trips, detail: api.detail } }));
vi.mock('../services/visaService', () => ({ visaService: { assistanceList: api.requests, list: api.applications, catalogue: api.catalogue } }));
vi.mock('../services/travellerService', () => ({ travellerService: { list: api.travellers } }));

const trip = { id: 'trip-1', title: 'Japan', primaryDestination: { countryCode: 'JP' }, startDate: '2099-01-01', destinations: [], travellers: [] };
const request = { id: 'request-1', requestReference: 'FVA-TEST', destinationCountryCode: 'MY', status: 'NEW' };
beforeEach(() => {
  api.trips.mockResolvedValue([trip]); api.requests.mockResolvedValue([request]); api.detail.mockResolvedValue(trip);
  api.applications.mockResolvedValue([]); api.catalogue.mockResolvedValue([]); api.travellers.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('visa hub recovery', () => {
  it('keeps saved trips available when saved requests fail', async () => {
    api.requests.mockRejectedValue(new Error('Requests unavailable'));
    render(<MemoryRouter><VisaHubPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Where are you going?' });
    expect((screen.getByLabelText('Destination country') as HTMLSelectElement).value).toBe('JP');
    expect(screen.getByRole('alert').textContent).toContain('Saved visa requests are temporarily unavailable');
    expect(api.detail).toHaveBeenCalledWith('trip-1');
  });
  it('keeps saved requests available when trips fail', async () => {
    api.trips.mockRejectedValue(new Error('Trips unavailable'));
    render(<MemoryRouter><VisaHubPage /></MemoryRouter>);
    expect((await screen.findByRole('link', { name: /FVA-TEST/ })).getAttribute('href')).toBe('/app/visa/assistance/request-1/documents');
    expect(await screen.findByRole('heading', { name: 'Where are you going?' })).toBeTruthy();
  });
  it('preserves the entered search when retrying saved journeys', async () => {
    api.requests.mockRejectedValueOnce(new Error('Requests unavailable'));
    render(<MemoryRouter><VisaHubPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Where are you going?' });
    await waitFor(() => expect(screen.getByLabelText('Visa purpose').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByLabelText('Expected travel date'), { target: { value: '2099-05-01' } });
    fireEvent.change(screen.getByLabelText('Visa purpose'), { target: { value: 'request:Business' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved journeys' }));
    await screen.findByRole('link', { name: /FVA-TEST/ });
    expect((screen.getByLabelText('Expected travel date') as HTMLInputElement).value).toBe('2099-05-01');
    expect((screen.getByLabelText('Visa purpose') as HTMLSelectElement).value).toBe('request:Business');
  });
});
