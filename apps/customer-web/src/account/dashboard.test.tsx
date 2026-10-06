// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomerDashboard } from './CustomerDashboard';
import { formatMoney } from './presentation';

const api = vi.hoisted(() => ({ profile: vi.fn(), trips: vi.fn(), travellers: vi.fn(), orders: vi.fn(), payments: vi.fn(), documents: vi.fn(), visas: vi.fn(), intents: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { email: 'ain@example.com' } } }) }));
vi.mock('../services/customerService', () => ({ customerService: { me: api.profile } }));
vi.mock('../services/tripService', () => ({ tripService: { list: api.trips } }));
vi.mock('../services/travellerService', () => ({ travellerService: { list: api.travellers } }));
vi.mock('../services/commerceService', () => ({ commerceService: { orders: api.orders, payments: api.payments } }));
vi.mock('../services/documentService', () => ({ documentService: { list: api.documents } }));
vi.mock('../services/visaService', () => ({ visaService: { list: api.visas } }));
vi.mock('../services/flightService', () => ({ flightService: { intentsForTrip: api.intents } }));

beforeEach(() => {
  api.profile.mockResolvedValue({ displayName: 'Ain Rahman', phoneCountryCode: null, phoneNumber: null, preferredLanguage: 'en', preferredCurrency: 'MYR' });
  api.trips.mockResolvedValue([]); api.travellers.mockResolvedValue([]); api.orders.mockResolvedValue([]);
  api.payments.mockResolvedValue([]); api.documents.mockResolvedValue([]); api.visas.mockResolvedValue([]); api.intents.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('authenticated customer dashboard', () => {
  it('loads real account sections and shows honest empty states', async () => {
    render(<MemoryRouter><CustomerDashboard /></MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Loading your dashboard' })).toBeTruthy();
    expect(await screen.findByText('No upcoming trip yet')).toBeTruthy();
    expect(screen.getByText('No orders yet')).toBeTruthy();
    expect(screen.getByText('No flight selected')).toBeTruthy();
    expect(screen.queryByText('Ticket issued')).toBeNull();
  });

  it('shows actions from actual payment, fare, visa, and document states', async () => {
    api.trips.mockResolvedValue([{ id: 'trip-1', title: 'Japan trip', status: 'PLANNING', startDate: '2027-01-05', endDate: '2027-01-15', primaryDestination: { countryCode: 'JP', cityName: 'Tokyo' }, travellerCount: 2, createdAt: '2026-09-01', updatedAt: '2026-09-01' }]);
    api.orders.mockResolvedValue([{ id: 'order-1', orderNumber: 'SMO-101', tripId: 'trip-1', bookingIntentId: 'intent-1', status: 'PENDING_PAYMENT', fulfillmentStatus: 'NOT_STARTED', currency: 'MYR', totalAmount: '1234.50', expiresAt: null, paidAt: null, createdAt: '2026-09-28T00:00:00Z' }]);
    api.payments.mockResolvedValue([{ id: 'payment-1', orderId: 'order-1', status: 'FAILED', reconciliationState: 'NONE', amount: '1234.50', currency: 'MYR', createdAt: '2026-09-28T00:00:00Z', paidAt: null }]);
    api.documents.mockResolvedValue([{ id: 'document-1', travellerId: null, documentType: 'PASSPORT', displayName: 'Passport copy', status: 'REVIEW_REQUIRED' }]);
    api.visas.mockResolvedValue([{ id: 'visa-1', tripId: 'trip-1', visaTypeId: 'type-1', visaTypeName: 'Visitor visa', destinationCountryCode: 'JP', status: 'INCOMPLETE', travellerIds: [], requiredCompleted: 0, requiredTotal: 2, createdAt: '', updatedAt: '' }]);
    api.intents.mockResolvedValue([{ id: 'intent-1', tripId: 'trip-1', status: 'PRICE_CHANGED', createdAt: '2026-09-28T00:00:00Z' }]);
    render(<MemoryRouter><CustomerDashboard /></MemoryRouter>);
    expect(await screen.findByText('Your selected fare changed')).toBeTruthy();
    expect(screen.getByText('Check a payment')).toBeTruthy();
    expect(screen.getByText('2 visa checklist items to complete')).toBeTruthy();
    expect(screen.getByText('Review a travel document')).toBeTruthy();
    expect(screen.getByText('Payment failed')).toBeTruthy();
    expect(screen.getByText('MYR 1,234.50')).toBeTruthy();
    expect(api.visas).toHaveBeenCalledWith('trip-1');
    expect(api.intents).toHaveBeenCalledWith('trip-1');
  });

  it('does not turn unavailable trip data into an all-clear claim', async () => {
    api.trips.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><CustomerDashboard /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Trips are unavailable right now')).toBeTruthy();
    expect(screen.queryByText('Nothing needs your attention right now')).toBeNull();
  });

  it('formats backend currency strings without float arithmetic or MYR assumptions', () => {
    expect(formatMoney('1234567.89', 'USD')).toBe('USD 1,234,567.89');
    expect(formatMoney('88.00', 'BDT')).toBe('BDT 88.00');
    expect(formatMoney('not-a-price', 'MYR')).toBe('Amount unavailable');
  });
});
