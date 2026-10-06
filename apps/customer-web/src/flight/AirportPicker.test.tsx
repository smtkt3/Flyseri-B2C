// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AirportPicker } from './AirportPicker';

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
