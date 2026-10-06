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
async function open(){render(<MemoryRouter initialEntries={['/app/visa/assistance/request-1/payment?checkout=returned']}><Routes><Route path="/app/visa/assistance/:requestId/payment" element={<VisaAssistancePaymentPage/>}/></Routes></MemoryRouter>);await screen.findByRole('heading',{name:'Your service fee'});}
beforeEach(()=>{api.request.mockResolvedValue(request);api.create.mockResolvedValue(order);api.capabilities.mockResolvedValue({checkoutAvailable:true});});afterEach(()=>{cleanup();vi.resetAllMocks();});
describe('visa payment before submission',()=>{
 it('shows the server total and does not trust a checkout return query',async()=>{await open();fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Submit paid application →'}).hasAttribute('disabled')).toBe(true);expect(screen.getAllByText(/75\.00/).length).toBeGreaterThan(0);expect(api.submit).not.toHaveBeenCalled();});
 it('keeps pending payment blocked and allows submission after authoritative refresh',async()=>{api.create.mockResolvedValue({...order,payment:{id:'payment-1',status:'PENDING'}});api.order.mockResolvedValue({...order,payment:{id:'payment-1',status:'PENDING'}});await open();fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Submit paid application →'}).hasAttribute('disabled')).toBe(true);api.order.mockResolvedValue({...order,status:'PAID',paidAt:'2099-01-01T00:00:00Z',payment:{id:'payment-1',status:'SUCCEEDED'}});api.submit.mockResolvedValue({...request,status:'IN_REVIEW'});fireEvent.click(screen.getByRole('button',{name:'Refresh payment status'}));await screen.findByRole('heading',{name:'Payment confirmed'});fireEvent.click(screen.getByRole('button',{name:'Submit paid application →'}));await waitFor(()=>expect(api.submit).toHaveBeenCalledWith('request-1'));expect(await screen.findByRole('heading',{name:'Application submitted'})).toBeTruthy();});
 it('shows a recoverable loading error without claiming a fee is missing',async()=>{api.create.mockRejectedValueOnce(new Error('Service temporarily unavailable'));await open();expect(screen.getByRole('alert').textContent).toContain('Service temporarily unavailable');expect(screen.queryByText(/No service fee/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Try again'}));await waitFor(()=>expect(screen.getAllByText(/75\.00/).length).toBeGreaterThan(0));expect(screen.queryByRole('alert')).toBeNull();});

});
