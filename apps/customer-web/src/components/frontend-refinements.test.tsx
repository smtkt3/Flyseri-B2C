// @vitest-environment jsdom
import { useCallback, useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NetworkStatus } from './NetworkStatus';
import { useDialogFocus } from './useDialogFocus';
import { HeroDestinations } from './home/HeroDestinations';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function Sheet() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(open, ref, close);
  return <><button onClick={() => setOpen(true)}>Open price</button>{open && <section ref={ref} role="dialog" tabIndex={-1}><button onClick={close}>Close</button><button>Last control</button><details><summary>More</summary><button>Hidden control</button></details></section>}</>;
}

it('contains focus in the sheet, skips collapsed content and restores focus and scrolling', () => {
  document.body.style.overflow = 'auto';
  render(<Sheet/>);
  const trigger = screen.getByText('Open price');
  trigger.focus(); fireEvent.click(trigger);
  const close = screen.getByText('Close'), last = screen.getByText('More');
  expect(document.activeElement).toBe(close);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});

it('shows offline guidance and removes it when connectivity returns', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  render(<NetworkStatus/>);
  expect(screen.getByRole('status').textContent).toContain('Check your booking status before retrying a payment');
  online.mockReturnValue(true);
  fireEvent(window, new Event('online'));
  expect(screen.queryByRole('status')).toBeNull();
});

it('avoids downloading subsequent hero slides on data saving connections', () => {
  vi.useFakeTimers();
  const network = Object.assign(new EventTarget(), { saveData: true });
  Object.defineProperty(navigator, 'connection', { configurable: true, value: network });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const { container } = render(<HeroDestinations/>);
  fireEvent.load(container.querySelector('.premium-hero-slideshow img')!);
  act(() => vi.advanceTimersByTime(20000));
  expect(container.querySelectorAll('.premium-hero-slideshow img')).toHaveLength(1);
  act(() => { network.saveData = false; network.dispatchEvent(new Event('change')); });
  act(() => vi.advanceTimersByTime(1800));
  expect(container.querySelectorAll('.premium-hero-slideshow img')).toHaveLength(2);
  Reflect.deleteProperty(navigator, 'connection');
  vi.unstubAllGlobals();
});
