// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HolidayPackageSlideshow } from './HolidayPackages';
import { previewHolidayPackages } from '../data/demo/holidayPackages';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(reduced = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  return render(<MemoryRouter><HolidayPackageSlideshow items={previewHolidayPackages.filter(p => p.category === 'DOMESTIC')}/></MemoryRouter>);
}
describe('holiday slideshow', () => {
  const active = () => document.querySelector('.holiday-slide.is-active')?.getAttribute('href');
  it('supports keyboard and adjacent-card navigation without preview badges', () => {
    setup();
    expect(active()).toBe('/holidays/preview-kuakata');
    expect(document.querySelector('.holiday-slide-preview')).toBeNull();
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
    expect(active()).toBe('/holidays/preview-sreemangal');
    fireEvent.click(screen.getByRole('link', { name: 'Preview Sundarbans' }));
    expect(active()).toBe('/holidays/preview-sundarbans');
  });
  it('rotates every 1.5 seconds and pauses on interaction or Space', () => {
    vi.useFakeTimers(); setup();
    act(() => vi.advanceTimersByTime(1499));
    expect(active()).toBe('/holidays/preview-kuakata');
    act(() => vi.advanceTimersByTime(1));
    expect(active()).toBe('/holidays/preview-sreemangal');
    fireEvent.keyDown(screen.getByRole('region'), { key: ' ' });
    act(() => vi.advanceTimersByTime(3000));
    expect(active()).toBe('/holidays/preview-sreemangal');
    fireEvent.keyDown(screen.getByRole('region'), { key: ' ' });
    fireEvent.mouseEnter(screen.getByRole('region'));
    act(() => vi.advanceTimersByTime(3000));
    expect(active()).toBe('/holidays/preview-sreemangal');
  });
  it('respects reduced motion while retaining keyboard navigation', () => {
    vi.useFakeTimers(); setup(true);
    act(() => vi.advanceTimersByTime(6000));
    expect(active()).toBe('/holidays/preview-kuakata');
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowLeft' });
    expect(active()).toBe('/holidays/preview-sylhet');
  });
});
