// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrdersPage } from './OrdersPage';
import { OrderDetailPage } from './OrderDetailPage';
import { PaymentsPage } from './PaymentsPage';

const commerce = vi.hoisted(() => ({ orders: vi.fn(), order: vi.fn(), payments: vi.fn(), receipt: vi.fn(),
  paymentCapabilities: vi.fn(), payment: vi.fn(), startPayment: vi.fn() }));
vi.mock('../services/commerceService', () => ({ commerceService: commerce }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

commerce.paymentCapabilities.mockResolvedValue({ checkoutAvailable: false });

describe('customer commerce screens', () => {
  it('shows loading and a truthful empty order state', async () => {
    let resolve!: (value: unknown[]) => void;
    commerce.orders.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<MemoryRouter><OrdersPage /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    resolve([]);
    expect(await screen.findByText('Your orders will appear here')).toBeTruthy();
  });
  it('excludes expired and cancelled orders from the unpaid filter', async () => {
    commerce.orders.mockResolvedValue(['PENDING_PAYMENT','EXPIRED','CANCELLED'].map((status,index)=>({id:'filter-'+index,orderNumber:'FILTER-'+index,status,totalAmount:'100',currency:'BDT',createdAt:'2026-10-10T00:00:00Z'})));
    render(<MemoryRouter><OrdersPage/></MemoryRouter>);
    await screen.findByText('FILTER-0');
    fireEvent.click(screen.getByRole('button',{name:/^Unpaid$/}));
    expect(screen.getByText('FILTER-0')).toBeTruthy();
    expect(screen.queryByText('FILTER-1')).toBeNull();
    expect(screen.queryByText('FILTER-2')).toBeNull();
  });
  it('renders a real order and no fake payment success', async () => {
    commerce.orders.mockResolvedValue([{ id: 'order-1', orderNumber: 'SMO-123', status: 'PENDING_PAYMENT',
      totalAmount: '1280.50', currency: 'MYR', createdAt: '2026-09-26T00:00:00Z' }]);
    render(<MemoryRouter><OrdersPage /></MemoryRouter>);
    expect(await screen.findByText('SMO-123')).toBeTruthy();
    expect(screen.getByRole('link', { name: /SMO-123/ }).getAttribute('href')).toBe('/app/orders/order-1');
  });
  it('explains unpaid order state and shows a receipt only after verified payment', async () => {
    commerce.order.mockResolvedValue({ id: 'order-1', orderNumber: 'SMO-123', status: 'PENDING_PAYMENT',
      totalAmount: '1280.50', currency: 'MYR', items: [{ id: 'item-1', description: 'Flight KUL to NRT',
        totalAmount: '1280.50', currency: 'MYR' }], payment: null, expiresAt: null });
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes>
      <Route path="/app/orders/:orderId" element={<OrderDetailPage />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText('Flight KUL to NRT')).toBeTruthy();
    expect(screen.getByText(/No charge has been made/)).toBeTruthy();
    expect(screen.queryByText('Payment receipt')).toBeNull();
  });
  it('shows no payments when there are none', async () => {
    commerce.payments.mockResolvedValue([]);
    render(<MemoryRouter><PaymentsPage /></MemoryRouter>);
    expect(await screen.findByText('No payments yet')).toBeTruthy();
  });
});
