// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider } from './AuthProvider';
import { AuthRoutes } from './AuthRoutes';

const auth = vi.hoisted(() => ({ configured: true, restore: vi.fn(), onChange: vi.fn(() => () => undefined), signIn: vi.fn() }));
const homeLoad = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock('../services/authService', () => ({ authService: auth }));
vi.mock('../App', () => ({ default: () => {
  if (homeLoad.pending) throw homeLoad.pending;
  return <div>Home behind sign in</div>;
} }));
vi.mock('../flight/PublicFlightPage', () => ({ PublicFlightPage: () => <div>Flights behind sign in <Link to="/sign-in">Sign in</Link> <Link to="/app">My trips</Link></div> }));
vi.mock('../flight/GuestFlightCheckoutPage', () => ({ GuestFlightCheckoutPage: () => {
  const location = useLocation();
  return <div>Checkout behind sign in <span>{(location.state as { booking?: string } | null)?.booking}</span><input aria-label="Passenger name" /><Link to="/sign-in">Sign in</Link></div>;
} }));
vi.mock('../account/CustomerShell', () => ({ CustomerShell: () => <div>My Flyseri account</div> }));

const session = { access_token: 'test-access-token' } as Session;
afterEach(() => { cleanup(); homeLoad.pending = null; vi.clearAllMocks(); document.body.style.overflow = ''; });

describe('sign-in overlay', () => {
  it('shows the branded home loader until the homepage is ready, then removes it immediately', async () => {
    auth.restore.mockResolvedValue(null);
    let finish!: () => void;
    homeLoad.pending = new Promise<void>(resolve => { finish = resolve; });
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><AuthRoutes /></AuthProvider></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toBe('Getting your travel search ready');
    expect(screen.getByRole('img', { name: 'Flyseri' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    await act(async () => { homeLoad.pending = null; finish(); });
    expect(await screen.findByText('Home behind sign in')).toBeTruthy();
    expect(screen.queryByText('Getting your travel search ready')).toBeNull();
  });
  it('opens over the current page and returns there after signing in', async () => {
    auth.restore.mockResolvedValue(null);
    auth.signIn.mockResolvedValue(session);
    render(<MemoryRouter initialEntries={['/flights']}><AuthProvider><AuthRoutes /></AuthProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Flights behind sign in/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ain@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Flights behind sign in/)).toBeTruthy();
  });

  it('keeps the previous page behind sign in when a protected link is opened', async () => {
    auth.restore.mockResolvedValue(null);
    auth.signIn.mockResolvedValue(session);
    render(<MemoryRouter initialEntries={['/flights']}><AuthProvider><AuthRoutes /></AuthProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'My trips' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Flights behind sign in/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ain@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('My Flyseri account')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves checkout route data and entered details when the dialog closes', async () => {
    auth.restore.mockResolvedValue(null);
    render(<MemoryRouter initialEntries={[{ pathname: '/flight-checkout', state: { booking: 'chosen-offer' } }]}><AuthProvider><AuthRoutes /></AuthProvider></MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Passenger name' }), { target: { value: 'Ain Rahman' } });
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Passenger name', hidden: true })).toHaveProperty('value', 'Ain Rahman');
    fireEvent.click(screen.getByRole('button', { name: 'Close sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('chosen-offer')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Passenger name' })).toHaveProperty('value', 'Ain Rahman'));
  });

  it('returns to the selected checkout after signing in', async () => {
    auth.restore.mockResolvedValue(null);
    auth.signIn.mockResolvedValue(session);
    render(<MemoryRouter initialEntries={[{ pathname: '/flight-checkout', state: { booking: 'chosen-offer' } }]}><AuthProvider><AuthRoutes /></AuthProvider></MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Passenger name' }), { target: { value: 'Ain Rahman' } });
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email address' }), { target: { value: 'ain@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('chosen-offer')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Passenger name' })).toHaveProperty('value', 'Ain Rahman'));
  });
});
