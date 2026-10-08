// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { emptyHomeSearch, updateHomeSearch } from './homeSearchDraft';
import { ExploreFareMap } from './ExploreFareMap';
import { flightService } from '../../services/flightService';

vi.mock('../../services/flightService', () => ({ flightService: { popularCachedFares: vi.fn().mockResolvedValue([]) } }));
beforeEach(() => {
  localStorage.clear();
  updateHomeSearch(emptyHomeSearch);
  vi.mocked(flightService.popularCachedFares).mockResolvedValue([]);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup() {
  render(<MemoryRouter><ExploreFareMap /></MemoryRouter>);
  const map = screen.getByRole('group', { name: 'Interactive world destination map' });
  Object.assign(map, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) });
  const origin = map.querySelector('.explore-map-origin') as HTMLElement;
  return { map, origin };
}
describe('interactive fare map', () => {
  it('changes departure airport, clears old quotes, and uses the new origin in flight search', async () => {
    vi.mocked(flightService.popularCachedFares).mockResolvedValueOnce([{ destination: 'BKK', currency: 'BDT', price: '12000', departureDate: '2026-11-12', searchedAt: '2026-10-08T00:00:00Z', expiresAt: '2026-10-08T00:05:00Z' }]);
    setup();
    expect(await screen.findByRole('button', { name: 'Select Bangkok, BDT 12,000' })).toBeTruthy();
    expect(screen.getByText('Travel 2026-11-12').getAttribute('title')).toContain('Checked');
    fireEvent.click(screen.getByRole('button', { name: 'Choose map departure airport' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search map departure airports' }), { target: { value: 'KUL' } });
    fireEvent.click(screen.getByRole('button', { name: /Kuala Lumpur KUL.*Depart here/ }));
    expect(screen.getByRole('button', { name: 'Center map on Kuala Lumpur' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Bangkok, BDT 12,000' })).toBeNull();
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('origin=KUL');
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('currency=BDT');
    await waitFor(() => expect(flightService.popularCachedFares).toHaveBeenLastCalledWith('KUL', 'BDT'));
  });
  it('uses BDT by default and refreshes the map when the customer changes currency', async () => {
    setup();
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('currency=BDT');
    act(() => { localStorage.setItem('flyseri.currency', 'USD'); window.dispatchEvent(new CustomEvent('flyseri:currency', { detail: 'USD' })); });
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('currency=USD');
    await waitFor(() => expect(flightService.popularCachedFares).toHaveBeenLastCalledWith('DAC', 'USD'));
  });
  it('chooses a travel date in the map and carries it into flight search', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Choose dates, choose date' }));
    expect(screen.getByRole('dialog', { name: 'Choose a date for choose dates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Today$/ }));
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain(`departureDate=${date}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('coalesces rapid drag events into one frame without losing movement', () => {
    let renderFrame: FrameRequestCallback = () => {};
    const schedule = vi.fn((callback: FrameRequestCallback) => { renderFrame = callback; return 1; });
    vi.stubGlobal('requestAnimationFrame', schedule);
    const { map, origin } = setup();
    const original = parseFloat(origin.style.left);
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 160, clientY: 100 });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(parseFloat(origin.style.left)).toBe(original);
    act(() => renderFrame(0));
    expect(parseFloat(origin.style.left) - original).toBeCloseTo(60);
    fireEvent.pointerUp(map, { pointerId: 1 });
  });
  it('drags markers with the tiles, supports keyboard movement, and resets the world view', async () => {
    const { map, origin } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show full world map' }));
    const original = { x: parseFloat(origin.style.left), y: parseFloat(origin.style.top) };
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 220, clientY: 160 });
    await waitFor(() => expect(parseFloat(origin.style.left) - original.x).toBeCloseTo(120));
    expect(parseFloat(origin.style.top) - original.y).toBeCloseTo(60);
    fireEvent.pointerUp(map, { pointerId: 1 });
    fireEvent.click(map);
    fireEvent.keyDown(map, { key: 'Home' });
    expect(parseFloat(origin.style.left)).toBeCloseTo(original.x);
    expect(parseFloat(origin.style.top)).toBeCloseTo(original.y);
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(parseFloat(origin.style.left)).toBeCloseTo(original.x - 80);
  });
  it('supports two touch pointers and wheel zoom without changing the selected destination', async () => {
    const { map, origin } = setup();
    const original = origin.style.left;
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(map, { pointerId: 2, button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 300, clientY: 100 });
    await waitFor(() => expect(origin.style.left).not.toBe(original));
    expect(screen.getByRole('heading', { name: 'Bangkok (BKK)' })).toBeTruthy();
    fireEvent.pointerUp(map, { pointerId: 2 });
    fireEvent.pointerCancel(map, { pointerId: 1 });
    fireEvent.click(map);
    fireEvent.keyDown(map, { key: 'Home' });
    fireEvent.wheel(map, { clientX: 400, clientY: 200, deltaY: -100 });
    await waitFor(() => expect(origin.style.left).not.toBe(original));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zoom out map' }).hasAttribute('disabled')).toBe(false));
  });
  it('searches worldwide destinations, focuses the actual airport and opens the correct flight route', () => {
    const { map } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show full world map' }));
    const tokyo = map.querySelector('[data-airport="NRT"]')!;
    expect(Number(tokyo.getAttribute('data-latitude'))).toBeCloseTo(35.77, 1);
    expect(Number(tokyo.getAttribute('data-longitude'))).toBeCloseTo(140.39, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Choose map destination' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search map destinations' }), { target: { value: 'AKL' } });
    fireEvent.click(screen.getByRole('button', { name: /Auckland AKL.*Check fares/ }));
    expect(screen.getByRole('heading', { name: 'Auckland (AKL)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('destination=AKL');
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('origin=DAC');
    expect(screen.getByRole('button', { name: 'Center map on Dhaka' })).toBeTruthy();
    expect(map.querySelector('[data-airport="AKL"]')).toBeTruthy();
    expect(map.querySelector('[data-airport="LHR"]')).toBeNull();
  });
});
