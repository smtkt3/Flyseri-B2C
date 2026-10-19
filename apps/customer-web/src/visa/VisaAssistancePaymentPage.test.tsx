// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {VisaAssistancePaymentPage} from './VisaAssistancePaymentPage';
const api=vi.hoisted(()=>({request:vi.fn(),order:vi.fn(),create:vi.fn(),payment:vi.fn(),capabilities:vi.fn(),submit:vi.fn(),start:vi.fn()}));
vi.mock('../services/visaService',()=>({visaService:{assistanceDetail:api.request,assistanceSubmit:api.submit}}));
vi.mock('../services/commerceService',()=>({commerceService:{createAssistanceOrder:api.create,order:api.order,payment:api.payment,paymentCapabilities:api.capabilities,startPayment:api.start}}));
const request={id:'request-1',requestReference:'FVA-TEST',status:'NEW',destinationCountryCode:'MY',expectedTravelDate:'2099-01-01',purpose:'Tourism',applicants:[],documents:[]};
const order={id:'order-1',status:'PENDING_PAYMENT',paidAt:null,payment:null,totalAmount:'75.00',currency:'MYR',items:[{id:'item-1',description:'Visa assistance service',quantity:1,totalAmount:'75.00',currency:'MYR'}]};
async function open(title='Your service fee'){render(<MemoryRouter initialEntries={['/app/visa/assistance/request-1/payment?checkout=returned']}><Routes><Route path="/app/visa/assistance/:requestId/payment" element={<VisaAssistancePaymentPage/>}/></Routes></MemoryRouter>);await screen.findByRole('heading',{name:title});}
beforeEach(()=>{api.request.mockResolvedValue(request);api.create.mockResolvedValue(order);api.capabilities.mockResolvedValue({checkoutAvailable:true});});afterEach(()=>{cleanup();vi.resetAllMocks();});
describe('visa payment before submission',()=>{
 it('keeps a verified paid application available when checkout capabilities are unavailable',async()=>{
   api.create.mockResolvedValue({...order,status:'PAID',paidAt:'2099-01-01T00:00:00Z',payment:{id:'paid-1',status:'SUCCEEDED'}});
   api.capabilities.mockRejectedValue(new Error('Checkout unavailable'));
   await open('Payment confirmed');
   expect(api.capabilities).not.toHaveBeenCalled();
   expect(screen.getByRole('button',{name:'Submit paid application →'})).toBeTruthy();
   expect(screen.queryByRole('alert')).toBeNull();
 });
 it('reuses the payment attempt key after a launch error',async()=>{
   api.start.mockRejectedValueOnce(new Error('Network interrupted'));
   await open();
   const next=screen.getByRole('button',{name:'Continue to test checkout →'});
   await waitFor(()=>expect(next.hasAttribute('disabled')).toBe(false));
   fireEvent.click(next);fireEvent.click(next);
   await screen.findByRole('alert');expect(api.start).toHaveBeenCalledTimes(1);
   api.start.mockResolvedValue({});fireEvent.click(next);
   await waitFor(()=>expect(api.start).toHaveBeenCalledTimes(2));
   expect(api.start.mock.calls[1][1]).toBe(api.start.mock.calls[0][1]);
 });
 it('offers a new application when the saved travel date has passed',async()=>{
   api.request.mockResolvedValue({...request,expectedTravelDate:'2000-01-01'});
   api.create.mockRejectedValue(new Error('The planned travel date has passed.'));
   await open();
   expect((await screen.findByRole('link',{name:'Start a new application →'})).getAttribute('href')).toContain('country=MY');
   expect(screen.getByRole('button',{name:'Continue to payment'}).hasAttribute('disabled')).toBe(true);
   expect(api.start).not.toHaveBeenCalled();
 });
 it('shows the server total and does not trust a checkout return query',async()=>{await open();fireEvent.click(screen.getByRole('checkbox'));expect(screen.queryByRole('button',{name:'Submit paid application →'})).toBeNull();expect(screen.getAllByText(/75\.00/).length).toBeGreaterThan(0);expect(api.submit).not.toHaveBeenCalled();});
 it('keeps pending payment blocked and allows submission after authoritative refresh',async()=>{api.create.mockResolvedValue({...order,payment:{id:'payment-1',status:'PENDING'}});api.order.mockResolvedValue({...order,payment:{id:'payment-1',status:'PENDING'}});await open();fireEvent.click(screen.getByRole('checkbox'));expect(screen.queryByRole('button',{name:'Submit paid application →'})).toBeNull();api.order.mockResolvedValue({...order,status:'PAID',paidAt:'2099-01-01T00:00:00Z',payment:{id:'payment-1',status:'SUCCEEDED'}});api.submit.mockResolvedValue({...request,status:'IN_REVIEW'});fireEvent.click(screen.getByRole('button',{name:'Refresh payment status'}));await screen.findByRole('heading',{name:'Payment confirmed'});fireEvent.click(screen.getByRole('button',{name:'Submit paid application →'}));await waitFor(()=>expect(api.submit).toHaveBeenCalledWith('request-1'));expect(await screen.findByRole('heading',{name:'Application submitted'})).toBeTruthy();});
 it('shows a recoverable loading error without claiming a fee is missing',async()=>{api.create.mockRejectedValueOnce(new Error('Service temporarily unavailable'));await open();expect(screen.getByRole('alert').textContent).toContain('Service temporarily unavailable');expect(screen.queryByText(/No service fee/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Try again'}));await waitFor(()=>expect(screen.getAllByText(/75\.00/).length).toBeGreaterThan(0));expect(screen.queryByRole('alert')).toBeNull();});

});
