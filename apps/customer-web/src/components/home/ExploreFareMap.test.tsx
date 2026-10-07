// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExploreFareMap } from './ExploreFareMap';

vi.mock('../../services/flightService', () => ({ flightService: { popularCachedFares: vi.fn().mockResolvedValue([]) } }));
beforeEach(() => {
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
  it('drags markers with the tiles, supports keyboard movement, and resets the world view', () => {
    const { map, origin } = setup();
    const original = { x: parseFloat(origin.style.left), y: parseFloat(origin.style.top) };
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 220, clientY: 160 });
    expect(parseFloat(origin.style.left) - original.x).toBeCloseTo(120);
    expect(parseFloat(origin.style.top) - original.y).toBeCloseTo(60);
    fireEvent.pointerUp(map, { pointerId: 1 });
    fireEvent.click(map);
    fireEvent.keyDown(map, { key: 'Home' });
    expect(parseFloat(origin.style.left)).toBeCloseTo(original.x);
    expect(parseFloat(origin.style.top)).toBeCloseTo(original.y);
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(parseFloat(origin.style.left)).toBeCloseTo(original.x - 80);
  });
  it('supports two touch pointers and wheel zoom without changing the selected destination', () => {
    const { map, origin } = setup();
    const original = origin.style.left;
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(map, { pointerId: 2, button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 300, clientY: 100 });
    expect(origin.style.left).not.toBe(original);
    expect(screen.getByRole('heading', { name: 'Bangkok (BKK)' })).toBeTruthy();
    fireEvent.pointerUp(map, { pointerId: 2 });
    fireEvent.pointerCancel(map, { pointerId: 1 });
    fireEvent.click(map);
    fireEvent.keyDown(map, { key: 'Home' });
    fireEvent.wheel(map, { clientX: 400, clientY: 200, deltaY: -100 });
    expect(origin.style.left).not.toBe(original);
    expect(screen.getByRole('button', { name: 'Zoom out map' }).hasAttribute('disabled')).toBe(false);
  });
  it('searches worldwide destinations, focuses the actual airport and opens the correct flight route', () => {
    const { map } = setup();
    const tokyo = map.querySelector('[data-airport="NRT"]')!;
    expect(Number(tokyo.getAttribute('data-latitude'))).toBeCloseTo(35.77, 1);
    expect(Number(tokyo.getAttribute('data-longitude'))).toBeCloseTo(140.39, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Explore destinations ⌕' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search map destinations' }), { target: { value: 'AKL' } });
    fireEvent.click(screen.getByRole('button', { name: /Auckland AKL.*Check fares/ }));
    expect(screen.getByRole('heading', { name: 'Auckland (AKL)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View flights' }).getAttribute('href')).toContain('destination=AKL');
    expect(map.querySelector('[data-airport="AKL"]')).toBeTruthy();
    expect(map.querySelector('[data-airport="LHR"]')).toBeNull();
  });
});
