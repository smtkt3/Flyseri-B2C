// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { FixedActionInsets } from './FixedActionInsets';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('measures wrapped actions and clears the inset when navigating away', async () => {
  let height = 82;
  let resized!: () => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { height: this.classList.contains('checkout-mobile-bar') ? height : 0 } as DOMRect;
  });
  const { rerender } = render(<><FixedActionInsets/><div className="checkout-mobile-bar"/></>);
  expect(document.documentElement.style.getPropertyValue('--checkout-action-height')).toBe('82px');
  height = 126; resized();
  await waitFor(() => expect(document.documentElement.style.getPropertyValue('--checkout-action-height')).toBe('126px'));
  height = 0; resized();
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.documentElement.style.getPropertyValue('--checkout-action-height')).toBe('126px');
  rerender(<FixedActionInsets/>);
  await waitFor(() => expect(document.documentElement.style.getPropertyValue('--checkout-action-height')).toBe('0px'));
});

it('supports webviews without ResizeObserver and restores previous insets on cleanup', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  document.documentElement.style.setProperty('--checkout-action-height', '91px');
  const { unmount } = render(<FixedActionInsets/>);
  expect(document.documentElement.style.getPropertyValue('--checkout-action-height')).toBe('0px');
  unmount();
  expect(document.documentElement.style.getPropertyValue('--checkout-action-height')).toBe('91px');
  document.documentElement.style.removeProperty('--checkout-action-height');
});
