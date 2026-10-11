// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DemoOfferCheckout } from './DemoOfferCheckout';
import { readOrCreateDemoHold } from './demoOfferHold';
const fare = { amountPerPerson: 22500, currency: 'BDT', demo: true };
const props = { code: 'KUL', city: 'Kuala Lumpur', fare, departure: '2026-11-12', travellers: 1, onBack: vi.fn() };
const key = 'flyseri.demo-offer-hold.KUL.2026-11-12.1';
beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T00:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Special Flight Offers demo checkout', () => {
  it('keeps the original five-minute expiry when reopened and blocks completion at expiry', () => {
    const first = render(<MemoryRouter><DemoOfferCheckout {...props}/></MemoryRouter>);
    expect(screen.getByLabelText('Time remaining').textContent).toBe('5:00');
    const expiry = JSON.parse(sessionStorage.getItem(key)!).expiresAt;
    act(() => vi.advanceTimersByTime(120000)); first.unmount();
    render(<MemoryRouter><DemoOfferCheckout {...props}/></MemoryRouter>);
    expect(screen.getByLabelText('Time remaining').textContent).toBe('3:00');
    expect(JSON.parse(sessionStorage.getItem(key)!).expiresAt).toBe(expiry);
    act(() => vi.advanceTimersByTime(180000));
    expect(screen.getByText('Demo hold expired')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save demo reservation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new demo session' }));
    expect(screen.getByLabelText('Time remaining').textContent).toBe('5:00');
  });
  it('rechecks the actual expiry on submit even before the next timer update', () => {
    render(<MemoryRouter><DemoOfferCheckout {...props}/></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Demo Traveller' } });
    vi.setSystemTime(new Date('2026-10-10T00:05:01Z'));
    fireEvent.submit(screen.getByRole('button', { name: 'Save demo reservation' }).closest('form')!);
    expect(screen.queryByText('Demo reservation saved')).toBeNull();
    expect(screen.getByText('This demo hold has expired. Please start a new demo session.')).toBeTruthy();
  });
  it('completes only the demo and persists no traveller names', () => {
    const first = render(<MemoryRouter><DemoOfferCheckout {...props}/></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sample Traveller' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save demo reservation' }).closest('form')!);
    expect(screen.getByText('Demo reservation saved')).toBeTruthy();
    expect(screen.getByText(/No airline seats were reserved/)).toBeTruthy();
    expect(sessionStorage.getItem(key)).not.toContain('Sample Traveller');
    first.unmount(); render(<MemoryRouter><DemoOfferCheckout {...props}/></MemoryRouter>);
    expect(screen.getByText('Demo reservation saved')).toBeTruthy();
  });
  it('does not auto-renew an expired hold', () => {
    const now = Date.now(); const hold = readOrCreateDemoHold(sessionStorage, key, now - 400000);
    expect(readOrCreateDemoHold(sessionStorage, key, now).expiresAt).toBe(hold.expiresAt);
    render(<MemoryRouter><DemoOfferCheckout {...props}/></MemoryRouter>);
    expect(screen.getByText('Demo hold expired')).toBeTruthy();
  });
});
