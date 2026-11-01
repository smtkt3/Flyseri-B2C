// @vitest-environment jsdom
import {afterEach,describe,it,expect} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {FlightExchangeQuotation} from '@flyseri/types';
import {FlightExchangeQuotationCard} from './FlightExchangeQuotationCard';
afterEach(cleanup);
const quote:FlightExchangeQuotation={id:'case-1',bookingId:'booking-1',orderId:'order-1',orderNumber:'SMEX-1',amount:'1000',currency:'BDT',sentAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),status:'PAYMENT_REQUIRED',flights:[{airline:'BG',number:'437',origin:'DAC',destination:'CXB',departureDate:'2026-12-11',departureTime:'15:45',arrivalDate:'2026-12-11',arrivalTime:'17:00'}]};
describe('client exchange quotation',()=>{
 it('shows replacement details and links the exact total to its existing owned checkout',()=>{
  render(<MemoryRouter><FlightExchangeQuotationCard quotation={quote}/></MemoryRouter>);
  expect(screen.getByText('DAC → CXB')).toBeTruthy();expect(screen.getByText(/BG 437/)).toBeTruthy();
  expect(screen.getByRole('link',{name:/Review & pay.*1,000/}).getAttribute('href')).toBe('/app/orders/order-1');
 });
 it.each(['PAID','COMPLETED','REVIEW_REQUIRED','EXPIRED'] as const)('does not offer a new payment for %s',status=>{
  render(<MemoryRouter><FlightExchangeQuotationCard quotation={{...quote,status}}/></MemoryRouter>);
  expect(screen.queryByRole('link',{name:/Review & pay/})).toBeNull();
 });
 it('expires a displayed quotation when its payment window has elapsed',()=>{
  render(<MemoryRouter><FlightExchangeQuotationCard quotation={{...quote,expiresAt:new Date(Date.now()-1000).toISOString()}}/></MemoryRouter>);
  expect(screen.getByText('Quotation expired')).toBeTruthy();expect(screen.queryByRole('link',{name:/Review & pay/})).toBeNull();
 });
});
