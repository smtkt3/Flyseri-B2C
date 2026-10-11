// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, ProtectedRoute } from '../auth/AuthProvider';
import { AuthPage } from '../auth/AuthPage';
import { ProfilePage } from './ProfilePage';
import { TravellersPage } from './TravellersPage';

const auth = vi.hoisted(() => ({ configured: true, restore: vi.fn(), onChange: vi.fn((_callback: (session: Session | null, event: string) => void) => () => undefined), signIn: vi.fn() }));
const customer = vi.hoisted(() => ({ me: vi.fn(), update: vi.fn() }));
const traveller = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn() }));
vi.mock('../services/authService', () => ({ authService: auth }));
vi.mock('../services/customerService', () => ({ customerService: customer }));
vi.mock('../services/travellerService', () => ({ travellerService: traveller }));

const session = { access_token: 'test-access-token' } as Session;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('customer account screens', () => {
  it('shows a resolving state and redirects unauthenticated visitors', async () => {
    let resolve!: (value: Session | null) => void;
    auth.restore.mockReturnValue(new Promise<Session | null>((done) => { resolve = done; }));
    render(<MemoryRouter initialEntries={['/app/profile']}><AuthProvider><Routes>
      <Route path="/app/profile" element={<ProtectedRoute><div>Private profile</div></ProtectedRoute>} />
      <Route path="/sign-in" element={<div>Sign in screen</div>} />
    </Routes></AuthProvider></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Checking your session');
    resolve(null);
    expect(await screen.findByText('Sign in screen')).toBeTruthy();
    expect(screen.queryByText('Private profile')).toBeNull();
  });

  it('keeps the new session when sign-in navigates before the initial restore resolves', async () => {
    let resolveRestore!: (value: Session | null) => void;
    let emitAuthEvent!: (value: Session | null, event: string) => void;
    auth.restore.mockReturnValue(new Promise<Session | null>((done) => { resolveRestore = done; }));
    auth.onChange.mockImplementationOnce((callback) => { emitAuthEvent = callback; return () => undefined; });
    auth.signIn.mockResolvedValue(session);
    render(<MemoryRouter initialEntries={['/sign-in']}><AuthProvider><Routes>
      <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
      <Route path="/app" element={<ProtectedRoute><div>Inside My Flyseri</div></ProtectedRoute>} />
    </Routes></AuthProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ain@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Inside My Flyseri')).toBeTruthy();
    resolveRestore(null);
    await waitFor(() => expect(screen.getByText('Inside My Flyseri')).toBeTruthy());
    emitAuthEvent(null, 'INITIAL_SESSION');
    await waitFor(() => expect(screen.getByText('Inside My Flyseri')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull();
  });

  it('shows a safe sign-in error without exposing provider details', async () => {
    auth.restore.mockResolvedValue(null);
    auth.signIn.mockRejectedValue(new Error('internal provider request 123 failed'));
    render(<MemoryRouter initialEntries={['/sign-in']}><AuthProvider><AuthPage mode="sign-in" /></AuthProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ain@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "We couldn't sign you in. Please try again.");
    expect(screen.queryByText(/provider request 123/)).toBeNull();
  });

  it('loads a signed-in customer profile', async () => {
    auth.restore.mockResolvedValue(session);
    customer.me.mockResolvedValue({ displayName: 'Ain', phoneCountryCode: null, phoneNumber: null, preferredLanguage: 'en', preferredCurrency: 'MYR' });
    render(<MemoryRouter initialEntries={['/app/profile']}><AuthProvider><Routes>
      <Route path="/app/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
    </Routes></AuthProvider></MemoryRouter>);
    expect(await screen.findByDisplayValue('Ain')).toBeTruthy();
    expect(customer.me).toHaveBeenCalledOnce();
  });

  it('renders profile loading failure and retry', async () => {
    customer.me.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('loads travellers and requires legal names before creating', async () => {
    traveller.list.mockResolvedValue([{ id: 'traveller-1', legalFirstName: 'Ain', legalMiddleName: null, legalLastName: 'Rahman', dateOfBirth: null, gender: null, nationalityCountryCode: 'MY', relationshipType: 'SELF', isPrimary: true, createdAt: '', updatedAt: '' }]);
    render(<MemoryRouter><TravellersPage /></MemoryRouter>);
    expect(await screen.findByText('Ain Rahman')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Add traveller'));
    fireEvent.click(screen.getByRole('button', { name: /^Add traveller$/ }));
    await waitFor(() => expect(traveller.create).not.toHaveBeenCalled());
    expect(screen.getByLabelText('Legal first name').getAttribute('required')).not.toBeNull();
    expect(screen.getByLabelText('Legal last name').getAttribute('required')).not.toBeNull();
  });

  it('shows traveller loading failures', async () => {
    traveller.list.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><TravellersPage /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No travellers yet')).toBeNull();
  });

  it('blocks repeat traveller saves and editing while a save is pending', async () => {
    let finish!: () => void;
    traveller.list.mockResolvedValue([]);
    traveller.create.mockReturnValue(new Promise<void>(resolve => {finish=resolve;}));
    render(<MemoryRouter><TravellersPage /></MemoryRouter>);
    await screen.findByText('No travellers yet');
    fireEvent.click(screen.getByRole('button', {name:'+ Add traveller'}));
    fireEvent.change(screen.getByLabelText('Legal first name'), {target:{value:'Sample'}});
    fireEvent.change(screen.getByLabelText('Legal last name'), {target:{value:'Traveller'}});
    const form = screen.getByRole('button', {name:'Add traveller'}).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(traveller.create).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', {name:'Cancel'})).toHaveProperty('disabled',true);
    expect(screen.getByLabelText('Legal first name').closest('fieldset')).toHaveProperty('disabled',true);
    finish();
    expect(await screen.findByText('Traveller added.')).toBeTruthy();
  });
});
