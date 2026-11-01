// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrdersPage } from './OrdersPage';
import { OrderDetailPage } from './OrderDetailPage';
import { PaymentsPage } from './PaymentsPage';
import { clearPaymentAttempt, readPaymentAttempt } from './paymentRecovery';
import {ApiClientError} from '../lib/api/client';

const commerce = vi.hoisted(() => ({ orders: vi.fn(), order: vi.fn(), payments: vi.fn(), receipt: vi.fn(),
  paymentCapabilities: vi.fn(), payment: vi.fn(), startPayment: vi.fn() }));
vi.mock('../services/commerceService', () => ({ commerceService: commerce }));
afterEach(() => { cleanup(); clearPaymentAttempt('order-1'); vi.clearAllMocks(); });

commerce.paymentCapabilities.mockResolvedValue({ checkoutAvailable: false });

describe('customer commerce screens', () => {
  it('pays the published exchange amount through its existing order after customer review',async()=>{
    commerce.paymentCapabilities.mockResolvedValueOnce({checkoutAvailable:true});
    commerce.order.mockResolvedValue({id:'order-1',orderNumber:'SMEX-QUOTE',flightServicingCaseId:'case-1',status:'PENDING_PAYMENT',totalAmount:'1000',currency:'BDT',discountAmount:'0',expiresAt:new Date(Date.now()+600000).toISOString(),items:[],payment:null,exchangeQuotation:{id:'case-1',bookingId:'booking-1',orderId:'order-1',orderNumber:'SMEX-QUOTE',amount:'1000',currency:'BDT',sentAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),status:'PAYMENT_REQUIRED',flights:[{airline:'BG',number:'437',origin:'DAC',destination:'CXB',departureDate:'2026-12-11',departureTime:'15:45',arrivalDate:'2026-12-11',arrivalTime:'17:00'}]}});
    commerce.startPayment.mockResolvedValueOnce({payment:{status:'PENDING'},redirectUrl:null});
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByText('Your exchange quotation');
    const pay=screen.getByRole('button',{name:/Pay.*1,000.*securely/}) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));expect(pay.disabled).toBe(false);fireEvent.click(pay);
    await screen.findByText('This checkout has no available payment link. Check the latest status before continuing.');
    expect(commerce.startPayment).toHaveBeenCalledExactlyOnceWith('order-1',expect.any(String));
  });
  it('recovers payment availability on status refresh after a transient capability failure',async()=>{
    commerce.paymentCapabilities.mockRejectedValueOnce(new Error('API restarting')).mockResolvedValueOnce({checkoutAvailable:true});
    commerce.order.mockResolvedValue({id:'order-1',orderNumber:'RECOVER-CAP',status:'PENDING_PAYMENT',totalAmount:'100',currency:'BDT',items:[],payment:null,expiresAt:null});
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByText('Online payment is not available yet. Please contact Flyseri before making a payment.');
    fireEvent.click(screen.getByRole('button',{name:'Check payment status'}));
    await screen.findByRole('checkbox');
    expect(commerce.startPayment).not.toHaveBeenCalled();
  });
  it('explains an unavailable account order without displaying a payment action',async()=>{
    commerce.order.mockRejectedValueOnce(new ApiClientError('NOT_FOUND','Order not found',undefined,404));
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByRole('heading',{name:'Order unavailable in this account'});
    expect(screen.queryByLabelText('Continue payment')).toBeNull();
    expect(screen.getByRole('link',{name:'My orders →'})).toBeTruthy();
  });
  it('identifies exchange collection without offering discounts',async()=>{
    commerce.order.mockResolvedValueOnce({id:'order-1',orderNumber:'SMEX-TEST',flightServicingCaseId:'case-1',status:'PENDING_PAYMENT',totalAmount:'10.00',currency:'BDT',items:[],payment:null,expiresAt:null});
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByRole('heading',{name:'Flight change · additional payment'});
    expect(screen.queryByLabelText(/coupon/i)).toBeNull();
  });
  it('requires a status check after an interrupted payment and reuses its attempt key after remount', async () => {
    commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:true});
    commerce.order.mockResolvedValue({id:'order-1',orderNumber:'RECOVERY-1',status:'PENDING_PAYMENT',totalAmount:'100',currency:'BDT',items:[],payment:null,expiresAt:null});
    commerce.startPayment.mockRejectedValue(new Error('Connection interrupted'));
    const mount = () => render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    const first = mount();await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:/^Pay .*securely/}));
    await screen.findByText('Check your payment before continuing');
    const attemptKey = commerce.startPayment.mock.calls[0]![1];
    expect(screen.queryByRole('button',{name:/^Pay .*securely/})).toBeNull();
    first.unmount();mount();await screen.findByText('RECOVERY-1');
    expect(screen.getByText('Check your payment before continuing')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Check payment status'}));
    await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:/^Pay .*securely/}));
    await screen.findByText('Check your payment before continuing');
    expect(commerce.startPayment.mock.calls[1]![1]).toBe(attemptKey);
    commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:false});
  });
  it('keeps a rejected airline preflight out of the uncertain-payment recovery flow', async () => {
    commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:true});
    commerce.order.mockResolvedValue({id:'order-1',orderNumber:'PREFLIGHT-1',status:'PENDING_PAYMENT',totalAmount:'100',currency:'BDT',items:[],payment:null,expiresAt:null});
    commerce.startPayment.mockRejectedValueOnce(new ApiClientError('CONFLICT','The stored airline fare needs review before payment.',undefined,409));
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:/^Pay .*securely/}));
    await screen.findByText('The stored airline fare needs review before payment.');
    expect(screen.queryByText('Check your payment before continuing')).toBeNull();
    expect(readPaymentAttempt('order-1')).toBeUndefined();
    commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:false});
  });
  it('keeps the payment total in the order currency when display currency differs', async () => {
    localStorage.setItem('flyseri.currency', 'MYR');
    commerce.paymentCapabilities.mockResolvedValueOnce({ checkoutAvailable: true });
    commerce.order.mockResolvedValue({ id: 'order-1', orderNumber: 'CURRENCY-1', status: 'PENDING_PAYMENT', totalAmount: '34997.00', currency: 'BDT', items: [], payment: null, expiresAt: null });
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByText('Payment total · BDT');
    const bar = screen.getByLabelText('Continue payment');
    expect(bar.textContent).toContain('34,997.00');
    expect(bar.textContent).toContain('BDT');
    const pay = within(bar).getByRole('button', { name: /^Pay .*securely/ }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(pay.disabled).toBe(false);
    expect(commerce.startPayment).not.toHaveBeenCalled();
    localStorage.clear();
  });
  it('shows loading and a truthful empty order state', async () => {
    let resolve!: (value: unknown[]) => void;
    commerce.orders.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<MemoryRouter><OrdersPage /></MemoryRouter>);
    expect(screen.getByRole('status')).toBeTruthy();
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
    commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:false});
    commerce.order.mockResolvedValue({ id: 'order-1', orderNumber: 'SMO-123', status: 'PENDING_PAYMENT',
      totalAmount: '1280.50', currency: 'MYR', items: [{ id: 'item-1', description: 'Flight KUL to NRT',
        totalAmount: '1280.50', currency: 'MYR' }], payment: null, expiresAt: null });
    render(<MemoryRouter initialEntries={['/app/orders/order-1']}><Routes>
      <Route path="/app/orders/:orderId" element={<OrderDetailPage />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText('Flight KUL to NRT')).toBeTruthy();
    expect(screen.getByText(/No payment has been confirmed|Online payment is not available/)).toBeTruthy();
    expect(screen.queryByText('Payment receipt')).toBeNull();
  });
  it('shows no payments when there are none', async () => {
    commerce.payments.mockResolvedValue([]);
    render(<MemoryRouter><PaymentsPage /></MemoryRouter>);
    expect(await screen.findByText('No payments yet')).toBeTruthy();
  });
});
