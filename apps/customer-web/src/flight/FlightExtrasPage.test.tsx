// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { FlightBookingIntent } from '@flyseri/types';
import { FlightExtrasPage } from './FlightExtrasPage';
const api = vi.hoisted(()=>({intent:vi.fn(),bookingForIntent:vi.fn(),validateIntent:vi.fn(),saveAncillarySelections:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/travellerService',()=>({travellerService:{get:vi.fn(async()=>({legalFirstName:'Test',legalLastName:'Traveler'}))}}));
vi.mock('./FlightAirlineServices',()=>({FlightAirlineServices:()=> <div>Available airline choices</div>}));
vi.mock('./FlightSelectedExtras',()=>({FlightSelectedExtras:({requests}:{requests:unknown[]})=><p>{requests.length} saved extras</p>}));
const selection = ():FlightBookingIntent=>({id:'intent',status:'READY_FOR_PAYMENT',validatedAt:'2026-10-10T00:00:00Z',expiresAt:new Date(Date.now()+600000).toISOString(),validatedTotalAmount:'20000',searchTotalAmount:'19000',currency:'BDT',travellerIds:['person'],ancillaryRequests:[],selectedOffer:{airlineCodes:['BG'],currency:'BDT',outbound:{segments:[{origin:'DAC',destination:'BKK'}]}}} as unknown as FlightBookingIntent);
function Review(){const location=useLocation(),navigate=useNavigate();return <><pre data-testid="review">{JSON.stringify(location.state)}</pre><button onClick={()=>navigate(-1)}>Back to extras</button></>;}
function mount(state:Record<string,unknown>|null=null){return render(<MemoryRouter initialEntries={[{pathname:'/app/flights/booking-intents/intent/extras',state}]}><Routes><Route path="/app/flights/booking-intents/:intentId/extras" element={<FlightExtrasPage/>}/><Route path="/app/flights/booking-intents/:intentId" element={<Review/>}/><Route path="/app/bookings/:id" element={<p>Existing booking</p>}/></Routes></MemoryRouter>);}
beforeEach(()=>{vi.resetAllMocks();api.intent.mockResolvedValue(selection());api.bookingForIntent.mockResolvedValue(null);api.validateIntent.mockResolvedValue(selection());});
afterEach(()=>cleanup());
describe('dedicated airline extras step',()=>{
 it('continues without clearing saved extras and preserves reservation contact state',async()=>{
  api.intent.mockResolvedValue({...selection(),ancillaryRequests:[{id:'bag'}]});mount({bookingContact:{contactEmail:'test@example.invalid',contactPhone:'+8801000000000'},passportsCaptured:true});
  await screen.findByText('Available airline choices');fireEvent.click(screen.getByRole('button',{name:/Continue to review/}));
  expect(JSON.parse((await screen.findByTestId('review')).textContent!)).toMatchObject({passportsCaptured:true,bookingContact:{contactEmail:'test@example.invalid'}});expect(api.saveAncillarySelections).not.toHaveBeenCalled();
 });
 it('waits for a confirmed server save before skipping existing extras',async()=>{
  let finish!:()=>void;api.intent.mockResolvedValue({...selection(),ancillaryRequests:[{id:'bag'}]});api.saveAncillarySelections.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));mount();
  await screen.findByText('Available airline choices');fireEvent.click(screen.getByRole('button',{name:'Skip extras'}));
  expect(api.saveAncillarySelections).toHaveBeenCalledWith('intent',[]);expect(screen.queryByTestId('review')).toBeNull();finish();await screen.findByTestId('review');
 });
 it('stays on extras and preserves selections when clearing them fails',async()=>{
  api.intent.mockResolvedValue({...selection(),ancillaryRequests:[{id:'bag'}]});api.saveAncillarySelections.mockRejectedValue(new Error('Could not save choices'));mount();await screen.findByText('Available airline choices');fireEvent.click(screen.getByRole('button',{name:'Skip extras'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not save choices');expect(screen.getByText('1 saved extras')).toBeTruthy();expect(screen.queryByTestId('review')).toBeNull();
 });
 it('does not validate again when returning from review with browser Back',async()=>{
  mount({checkLatestFare:true,passportsCaptured:true});await screen.findByText('Available airline choices');fireEvent.click(screen.getByRole('button',{name:/Continue to review/}));await screen.findByTestId('review');fireEvent.click(screen.getByRole('button',{name:'Back to extras'}));await screen.findByText('Available airline choices');expect(api.validateIntent).toHaveBeenCalledTimes(1);
 });
 it('blocks choices and continuation for an expired fare',async()=>{
  api.intent.mockResolvedValue({...selection(),expiresAt:new Date(0).toISOString()});mount();await screen.findByText(/Your fare check expired/);expect(screen.queryByText('Available airline choices')).toBeNull();expect((screen.getByRole('button',{name:'Skip extras'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('opens an existing reservation instead of offering another extras selection',async()=>{
  api.bookingForIntent.mockResolvedValue({id:'booked'});mount();await screen.findByText('Existing booking');expect(api.validateIntent).not.toHaveBeenCalled();
 });
});
