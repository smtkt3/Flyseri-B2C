// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AirportPicker } from './AirportPicker';
import type { AirportDirectoryEntry } from '@flyseri/types';

vi.mock('../services/airportService', () => ({
  cachedAirportSuggestions: () => undefined,
  loadAirportDetails: vi.fn(),
  airportSuggestions: async (query: string) => {
    const airports: AirportDirectoryEntry[] = [
      ['KUL', 'Kuala Lumpur', 'Kuala Lumpur International Airport', 'Malaysia'],
      ['SZB', 'Kuala Lumpur', 'Sultan Abdul Aziz Shah Airport', 'Malaysia'],
      ['NRT', 'Tokyo', 'Narita International Airport', 'Japan'],
      ['HND', 'Tokyo', 'Haneda Airport', 'Japan'],
      ['PEN', 'Penang', 'Penang International Airport', 'Malaysia'],
    ].map(([code, city, name, country]) => ({ code: code!, city: city!, cityLabel: city!, name: name!, country: country!, countryName: country!, type: 'large_airport', scheduled: true, keywords: '', latitude: 3, longitude: 102, cityCenterLatitude: 3.1, cityCenterLongitude: 102.1 }));
    return airports.filter(airport => airport.code === query.toUpperCase() || airport.city.toLowerCase() === query.toLowerCase());
  },
}));

describe('AirportPicker', () => {
  afterEach(cleanup);

  it.each([
    { query: 'KUL', city: 'Kuala Lumpur', codes: ['KUL'] },
    { query: 'NRT', city: 'Tokyo', codes: ['NRT'] },
  ])('returns only the exact airport for code search $query', async ({ query, city, codes }) => {
    const view = render(<AirportPicker label="To" value={query} onChange={() => undefined} />);
    fireEvent.focus(view.getByRole('combobox', { name: 'To airport' }));

    expect(await screen.findByText(city)).toBeTruthy();
    const group = screen.getByRole('group', { name: `${city.split(' ·')[0]} airports` });
    const options = within(group).getAllByRole('option');
    expect(options).toHaveLength(codes.length);
    for (const code of codes) expect(group.textContent).toContain(code);
    expect(group.textContent).not.toContain(' · All airports');
  });

  it.each([
    { query: 'Kuala Lumpur', city: 'Kuala Lumpur · All airports', codes: ['KUL', 'SZB'] },
    { query: 'Tokyo', city: 'Tokyo · All airports', codes: ['NRT', 'HND'] },
  ])('shows every matched airport when searching the city $query', async ({ query, city, codes }) => {
    const view = render(<AirportPicker label="To" value={query} onChange={() => undefined} />);
    fireEvent.focus(view.getByRole('combobox', { name: 'To airport' }));

    expect(await screen.findByText(city)).toBeTruthy();
    const group = screen.getByRole('group', { name: `${query} airports` });
    expect(within(group).getAllByRole('option')).toHaveLength(codes.length);
    for (const code of codes) expect(group.textContent).toContain(code);
    expect(group.textContent).toMatch(/About \d+ km from city centre/);
  });

  it('labels the Penang airport group as Penang and shows its city-centre distance', async () => {
    const view = render(<AirportPicker label="To" value="Penang" onChange={() => undefined} />);
    fireEvent.focus(view.getByRole('combobox', { name: 'To airport' }));

    expect(await screen.findByText('Penang · All airports')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Penang airports' });
    expect(group.textContent).toContain('PEN Penang International Airport');
    expect(group.textContent).toMatch(/About \d+ km from city centre/);
  });
});
