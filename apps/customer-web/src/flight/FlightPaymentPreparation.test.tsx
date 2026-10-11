// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
import type {FlightBooking} from '@flyseri/types';
import {ApiClientError} from '../lib/api/client';
import {FlightPaymentPreparation} from './FlightPaymentPreparation';
const api=vi.hoisted(()=>({booking:vi.fn(),refreshCheckout:vi.fn(),reviewExtras:vi.fn(),skipExtras:vi.fn(),confirmExtras:vi.fn()}));
const order=vi.hoisted(()=>vi.fn());
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/commerceService',()=>({commerceService:{createFlightOrder:order}}));
vi.mock('./FlightAncillaryPurchasePanel',()=>({FlightAncillaryPurchasePanel:()=>null}));
vi.mock('./FlightSelectedExtras',()=>({FlightSelectedExtras:()=>null}));
const booking={id:'booking',bookingIntentId:'intent',ancillaryRequests:[{id:'extra',amount:'50',currency:'BDT'}],ancillaryPurchase:{id:'purchase',status:'UNAVAILABLE',items:[]}} as unknown as FlightBooking;
function Status(){const location=useLocation();return <p>{location.state?.checkoutBlocked}</p>;}
function mount(){render(<MemoryRouter initialEntries={['/prepare']}><Routes><Route path="/prepare" element={<FlightPaymentPreparation booking={booking}/>}/><Route path="/app/bookings/:id" element={<Status/>}/><Route path="/app/orders/:id" element={<p>Payment order</p>}/></Routes></MemoryRouter>);}
beforeEach(()=>{vi.resetAllMocks();api.booking.mockResolvedValue(booking);api.refreshCheckout.mockResolvedValue(booking);api.skipExtras.mockResolvedValue({...booking.ancillaryPurchase,status:'SKIPPED'});order.mockResolvedValue({id:'order'});});
afterEach(cleanup);
it('saves ticket-only choice and opens payment after reservation verification',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Continue without extras'}));
 await screen.findByText('Payment order');expect(api.skipExtras).toHaveBeenCalledWith('booking');expect(order).toHaveBeenCalledWith('intent');
});
it('shows reservation status when verification fails instead of offering an ineffective skip',async()=>{
 api.refreshCheckout.mockRejectedValue(new ApiClientError('CONFLICT','Your reservation needs airline verification before payment. Contact Flyseri.'));
 mount();await screen.findByText('Your reservation needs airline verification before payment. Contact Flyseri.');
 expect(screen.queryByRole('button',{name:'Continue without extras'})).toBeNull();expect(api.skipExtras).not.toHaveBeenCalled();expect(order).not.toHaveBeenCalled();
});
it('does not open payment when skipping extras fails',async()=>{
 api.skipExtras.mockRejectedValue(new Error('Could not save ticket-only choice'));
 mount();fireEvent.click(await screen.findByRole('button',{name:'Continue without extras'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Could not save ticket-only choice'));
 expect(order).not.toHaveBeenCalled();
});
