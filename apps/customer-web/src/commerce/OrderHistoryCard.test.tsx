// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrderSummary } from '@flyseri/types';
import { OrderHistoryCard } from './OrderHistoryCard';

const order: OrderSummary={id:'order-1',orderNumber:'SMO-123',tripId:null,bookingIntentId:'intent-1',status:'PAID',fulfillmentStatus:'NOT_STARTED',currency:'BDT',totalAmount:'34997.00',expiresAt:null,paidAt:'2026-10-29T10:00:00Z',createdAt:'2026-10-29T08:00:00Z',overview:{kind:'FLIGHT',title:'DAC → KUL',airlineCodes:['MH'],travelDate:'2026-12-10',travelerCount:2,tripType:'ONE_WAY',cabin:'ECONOMY',reference:{label:'PNR',value:'ABCDEF'},bookingStatus:'AWAITING_STAFF_TICKETING',extrasCount:2}};
afterEach(cleanup);
it('makes the service identifiable while keeping payment distinct from ticket issuance',()=>{
  render(<MemoryRouter><OrderHistoryCard order={order}/></MemoryRouter>);
  expect(screen.getByRole('heading',{name:'DAC → KUL'})).toBeTruthy();
  expect(document.querySelector('time[datetime="2026-12-10"]')?.textContent).toContain('2026');
  for(const text of ['2 travelers','Economy','Malaysia Airlines','2 extras','Payment confirmed','Ticket not yet confirmed','ABCDEF','BDT 34,997.00'])expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('/app/orders/order-1');
  expect(screen.queryByText('Ticket issued')).toBeNull();
});
it('hides airline references and ticket claims for an unpaid order even if old summary data is present',()=>{
  render(<MemoryRouter><OrderHistoryCard order={{...order,status:'PENDING_PAYMENT',overview:{...order.overview!,ticketIssued:true}}}/></MemoryRouter>);
  expect(screen.queryByText('ABCDEF')).toBeNull();
  expect(screen.queryByText('Ticket issued')).toBeNull();
  expect(screen.getByText('Continue payment')).toBeTruthy();
});
it('identifies an exchange as an additional payment and keeps expired orders out of the payment action',()=>{
  render(<MemoryRouter><OrderHistoryCard order={{...order,status:'EXPIRED',bookingIntentId:null,flightServicingCaseId:'case-1',overview:{...order.overview!,kind:'FLIGHT_EXCHANGE'}}}/></MemoryRouter>);
  expect(screen.getByText('Flight change')).toBeTruthy();
  expect(screen.getByText('Additional payment')).toBeTruthy();
  expect(screen.getByText('Order expired')).toBeTruthy();
  expect(screen.queryByText('Continue payment')).toBeNull();
});
