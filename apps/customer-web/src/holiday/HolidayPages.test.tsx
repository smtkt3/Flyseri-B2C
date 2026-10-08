// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HolidayDetailPage } from './HolidayPages';
import { HolidayPackages } from './HolidayPackages';
import { previewHolidayPackages } from '../data/demo/holidayPackages';
const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), book: vi.fn(), session: { user: { email: 'test@example.com' } } as { user: { email: string } } | null }));
vi.mock('./holidayService', async original => ({ ...await original<typeof import('./holidayService')>(), holidayService: { list: mocks.list, detail: mocks.detail, book: mocks.book } }));
vi.mock('../components/PremiumNavbar', () => ({ PremiumNavbar: () => null }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: mocks.session, resolving: false }) }));
const pkg = { ...previewHolidayPackages[0]!, id: '10000000-0000-4000-8000-000000000001', preview: false, published: true, version: 2 };
beforeEach(() => { window.scrollTo = vi.fn(); mocks.session = { user: { email: 'test@example.com' } }; mocks.list.mockResolvedValue([pkg, { ...previewHolidayPackages[2]!, preview: false }]); mocks.detail.mockResolvedValue(pkg); mocks.book.mockResolvedValue({ id: 'booking', reference: 'HOL-123', adults: 2, children: 1, departureDate: pkg.departureDates[0], totalAmount: 33700 }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function detail(id = pkg.id) { render(<MemoryRouter initialEntries={[`/holidays/${id}`]}><Routes><Route path="/holidays/:id" element={<HolidayDetailPage/>}/><Route path="/sign-in" element={<p>Sign in destination</p>}/></Routes></MemoryRouter>); }
describe('holiday customer flow', () => {
  it('switches between Bangladesh and international packages', async () => {
    render(<MemoryRouter><HolidayPackages/></MemoryRouter>);
    expect(await screen.findByText(pkg.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /International/ }));
    expect(await screen.findByText('Bali, beautifully unhurried')).toBeTruthy();
    expect(screen.queryByText(pkg.title)).toBeNull();
  });
  it('calculates passenger totals and sends only quantities, date and contact data', async () => {
    detail(); await screen.findByRole('heading', { name: pkg.title });
    fireEvent.change(screen.getByLabelText('Departure date'), { target: { value: pkg.departureDates[0] } });
    fireEvent.click(screen.getByRole('button', { name: 'Add adults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add children' }));
    expect(screen.getByText('BDT 33,700')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review booking →' }));
    fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Test Customer' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+8801700000000' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: /Request booking ·/ }).closest('form')!);
    await waitFor(() => expect(mocks.book).toHaveBeenCalledOnce());
    expect(mocks.book.mock.calls[0][0]).toMatchObject({ packageId: pkg.id, packageVersion: 2, adults: 2, children: 1, departureDate: pkg.departureDates[0] });
    expect(mocks.book.mock.calls[0][0]).not.toHaveProperty('totalAmount');
    expect(await screen.findByText('Request received')).toBeTruthy();
    expect(screen.getByText(/No payment has been taken/)).toBeTruthy();
  });
  it('requires sign in before placing a request', async () => {
    mocks.session = null; detail(); await screen.findByRole('heading', { name: pkg.title });
    fireEvent.change(screen.getByLabelText('Departure date'), { target: { value: pkg.departureDates[0] } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to book →' }));
    expect(await screen.findByText('Sign in destination')).toBeTruthy(); expect(mocks.book).not.toHaveBeenCalled();
  });
  it('keeps design previews unbookable', async () => {
    detail('preview-cox'); await screen.findByRole('heading', { name: pkg.title });
    expect((screen.getByRole('button', { name: 'Preview only · not bookable' }) as HTMLButtonElement).disabled).toBe(true); expect(mocks.book).not.toHaveBeenCalled();
  });
  it('limits passengers to the admin configured maximum', async () => {
    mocks.detail.mockResolvedValue({ ...pkg, maxPax: 2 }); detail(); await screen.findByRole('heading', { name: pkg.title });
    fireEvent.click(screen.getByRole('button', { name: 'Add children' }));
    expect((screen.getByRole('button', { name: 'Add adults' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add children' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
