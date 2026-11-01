// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {StrictMode} from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {FlightBooking,FlightAncillaryPurchase} from '@flyseri/types';
import {FlightPaymentPreparation} from './FlightPaymentPreparation';
const api=vi.hoisted(()=>({refreshCheckout:vi.fn(),reviewExtras:vi.fn(),confirmExtras:vi.fn(),booking:vi.fn()}));
const commerce=vi.hoisted(()=>({createFlightOrder:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/commerceService',()=>({commerceService:commerce}));
vi.mock('./FlightAncillaryPurchasePanel',()=>({FlightAncillaryPurchasePanel:()=>null}));
vi.mock('./FlightSelectedExtras',()=>({FlightSelectedExtras:()=>null}));
vi.mock('../travel/language',()=>({Translated:({text}:{text:string})=>text,useLanguage:()=>({t:(text:string)=>text})}));
const initial={id:'booking',bookingIntentId:'intent',pnr:'TESTBG',status:'PNR_CREATED',currency:'BDT',amount:'1000',ancillaryRequests:[{id:'bag',amount:'310.00',currency:'BDT'},{id:'meal',amount:'50.00',currency:'BDT'}]} as FlightBooking;
const prepared={id:'review',status:'PREPARED',currency:'BDT',airfareAmount:'1000',extrasAmount:'360',totalAmount:'1360',expiresAt:new Date(Date.now()+120000).toISOString(),items:[{requestId:'bag',airlineAmount:'10.00',airlineCurrency:'MYR',checkoutAmount:'310.00',serviceCharge:'10.00'},{requestId:'meal',airlineAmount:'40.00',airlineCurrency:'BDT',checkoutAmount:'50.00',serviceCharge:'10.00'}]} as FlightAncillaryPurchase;
beforeEach(()=>{vi.resetAllMocks();api.refreshCheckout.mockResolvedValue(initial);api.reviewExtras.mockResolvedValue(prepared);api.confirmExtras.mockResolvedValue({...prepared,status:'CONFIRMED'});commerce.createFlightOrder.mockResolvedValue({id:'order'});});afterEach(cleanup);
function mount(){render(<StrictMode><MemoryRouter><Routes><Route path="/" element={<FlightPaymentPreparation booking={initial}/>}/><Route path="/app/orders/order" element={<h1>Payment checkout</h1>}/></Routes></MemoryRouter></StrictMode>);}
it('proceeds to payment with multiple extras using the selected customer price, including charge and frozen FX',async()=>{
 mount();await screen.findByRole('heading',{name:'Payment checkout'});expect(api.confirmExtras).toHaveBeenCalledExactlyOnceWith('booking','review');expect(commerce.createFlightOrder).toHaveBeenCalledExactlyOnceWith('intent');
});
it('keeps an uncertain ancillary addition on review and never creates a payment order',async()=>{
 api.confirmExtras.mockRejectedValue(new Error('Unknown airline result'));api.booking.mockResolvedValue({...initial,ancillaryPurchase:{...prepared,status:'UNKNOWN'}});
 mount();await screen.findByRole('alert');expect(commerce.createFlightOrder).not.toHaveBeenCalled();expect(api.confirmExtras).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Check selected extras'})).toBeTruthy();
});
it('renews an expired confirmed extra quote by reading the existing attachment before creating an order',async()=>{
 const expired={...prepared,status:'CONFIRMED',expiresAt:new Date(0).toISOString()} as FlightAncillaryPurchase;
 const booking={...initial,ancillaryPurchase:expired};api.refreshCheckout.mockResolvedValue(booking);api.reviewExtras.mockResolvedValue({...prepared,status:'CONFIRMED'});
 render(<MemoryRouter><Routes><Route path="/" element={<FlightPaymentPreparation booking={booking}/>}/><Route path="/app/orders/order" element={<h1>Payment checkout</h1>}/></Routes></MemoryRouter>);
 await screen.findByRole('heading',{name:'Payment checkout'});expect(api.reviewExtras).toHaveBeenCalledWith('booking',true);expect(api.confirmExtras).not.toHaveBeenCalled();
});
