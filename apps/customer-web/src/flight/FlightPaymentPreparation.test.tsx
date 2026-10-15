// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import type {FlightBooking} from '@flyseri/types';
import {FlightPaymentPreparation} from './FlightPaymentPreparation';

const api=vi.hoisted(()=>({refreshCheckout:vi.fn()}));
const commerce=vi.hoisted(()=>({createFlightOrder:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/commerceService',()=>({commerceService:commerce}));
const booking={id:'booking-one',bookingIntentId:'intent-one',status:'PNR_CREATED',pnr:'ABC123',amount:'100.00',currency:'MYR',ancillaryRequests:[]} as unknown as FlightBooking;
beforeEach(()=>{vi.resetAllMocks();api.refreshCheckout.mockReturnValue(new Promise(()=>{}));});
afterEach(cleanup);

it('keeps the airline PNR hidden while the reservation is being checked before the final page',()=>{
  render(<MemoryRouter><FlightPaymentPreparation booking={booking}/></MemoryRouter>);
  expect(screen.queryByRole('region',{name:'Airline booking reference'})).toBeNull();
  expect(screen.queryByText('ABC123')).toBeNull();
  expect(screen.getByRole('listitem',{name:'Review trip, current step'})).toBeTruthy();
  expect(screen.queryByRole('region',{name:'Payment methods'})).toBeNull();
  expect(screen.queryByRole('heading',{name:'Complete your payment'})).toBeNull();
  expect(screen.queryByRole('button',{name:/Preparing payment/})).toBeNull();
  expect(screen.queryByText('Payment confirmed')).toBeNull();
  expect(screen.queryByText('Confirmed')).toBeNull();
  expect(commerce.createFlightOrder).not.toHaveBeenCalled();
  expect(booking.order).toBeUndefined();
});

it('does not invent a reference when the supplier has not returned a PNR',()=>{
  render(<MemoryRouter><FlightPaymentPreparation booking={{...booking,pnr:null}}/></MemoryRouter>);
  expect(screen.queryByRole('region',{name:'Airline booking reference'})).toBeNull();
});

it('continues directly to the single payment page after verification and creates one order',async()=>{
  api.refreshCheckout.mockResolvedValue(booking);
  commerce.createFlightOrder.mockResolvedValue({id:'order-one'});
  render(<MemoryRouter initialEntries={['/app/bookings/booking-one']}><Routes>
    <Route path="/app/bookings/:id" element={<FlightPaymentPreparation booking={booking}/>}/>
    <Route path="/app/orders/:id" element={<h1>Complete your payment</h1>}/>
  </Routes></MemoryRouter>);
  await screen.findByRole('heading',{name:'Complete your payment'});
  expect(screen.queryByRole('heading',{name:'Checking your booking'})).toBeNull();
  expect(api.refreshCheckout).toHaveBeenCalledOnce();
  expect(commerce.createFlightOrder).toHaveBeenCalledOnce();
});

it('opens an existing order without another fare check or order creation',async()=>{
  render(<MemoryRouter initialEntries={['/app/bookings/booking-one']}><Routes>
    <Route path="/app/bookings/:id" element={<FlightPaymentPreparation booking={{...booking,order:{id:'order-one'} as FlightBooking['order']}}/>}/>
    <Route path="/app/orders/:id" element={<h1>Complete your payment</h1>}/>
  </Routes></MemoryRouter>);
  await screen.findByRole('heading',{name:'Complete your payment'});
  expect(api.refreshCheckout).not.toHaveBeenCalled();
  expect(commerce.createFlightOrder).not.toHaveBeenCalled();
});
