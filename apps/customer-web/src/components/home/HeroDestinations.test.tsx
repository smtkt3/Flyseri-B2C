// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HeroDestinations } from './HeroDestinations';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(reduced = false) {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable:true, value:false });
  Object.defineProperty(window, 'matchMedia', { configurable:true, value:() => ({matches:reduced,addEventListener:vi.fn(),removeEventListener:vi.fn()}) });
  const view = render(<HeroDestinations />);
  expect(view.container.querySelectorAll('.premium-hero-slideshow img')).toHaveLength(1);
  view.container.querySelectorAll('.premium-hero-slideshow img').forEach(image => fireEvent.load(image));
  return view;
}
it('rotates loaded destinations and pauses on request or when hidden', () => {
  const view = setup();
  act(() => vi.advanceTimersByTime(1800));
  expect(view.container.querySelectorAll('.premium-hero-slideshow img')).toHaveLength(2);
  fireEvent.load(view.container.querySelectorAll('.premium-hero-slideshow img')[1]!);
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole('img', {name:'Bali, Indonesia'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Pause destination slideshow'}));
  act(() => vi.advanceTimersByTime(16000));
  expect(screen.getByRole('img', {name:'Bali, Indonesia'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Play destination slideshow'}));
  Object.defineProperty(document, 'hidden', {configurable:true,value:true});
  fireEvent(document, new Event('visibilitychange'));
  act(() => vi.advanceTimersByTime(16000));
  expect(screen.getByRole('img', {name:'Bali, Indonesia'})).toBeTruthy();
});
it('keeps the hero still for reduced motion', () => {
  setup(true);
  act(() => vi.advanceTimersByTime(24000));
  expect(screen.getByRole('img', {name:'Santorini, Greece'})).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
