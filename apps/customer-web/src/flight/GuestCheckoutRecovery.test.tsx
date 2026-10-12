// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { FlightOffer, FlightSearchRequest } from '@flyseri/types';
import { GuestFlightCheckoutPage } from './GuestFlightCheckoutPage';
import { checkoutJourneyDraftKey, clearCheckoutDraft, keepCheckoutDraft } from './checkoutDrafts';
const api=vi.hoisted(()=>({search:vi.fn(),createIntent:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/travellerService',()=>({travellerService:{list:vi.fn().mockResolvedValue([])}}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:{user:{id:'recovery-test'}}})}));
vi.mock('../components/PremiumNavbar',()=>({PremiumNavbar:()=>null}));
vi.mock('./FlightPriceDetails',()=>({FlightPriceDetails:()=>null}));
vi.mock('../components/BoundedSelect',()=>({BoundedSelect:({ariaLabel,value,onChange}:{ariaLabel:string;value:string;onChange:(value:string)=>void})=><input aria-label={ariaLabel} value={value} onChange={event=>onChange(event.target.value)}/>}));
const request:FlightSearchRequest={origin:'DAC',destination:'CXB',departureDate:'2027-01-24',tripType:'ONE_WAY',adults:1,children:0,infants:0,cabin:'ECONOMY',currency:'BDT'};
const offer:FlightOffer={offerId:'original',totalAmount:'4349.00',currency:'BDT',cabin:'ECONOMY',airlineCodes:['BG'],baggageSummary:null,inbound:null,outbound:{stops:0,durationMinutes:75,segments:[{origin:'DAC',destination:'CXB',departureAt:'2027-01-24T08:00:00+06:00',arrivalAt:'2027-01-24T09:15:00+06:00',marketingCarrier:'BG',flightNumber:'435',bookingClass:'Q',durationMinutes:75}]}};
const draft={passengers:[{kind:'Adult',givenNames:'Demo',surname:'Traveler',gender:'MALE',birthDate:'1990-01-01',nationality:'BD',idType:'PASSPORT',idNumber:'',idExpiryDate:'',issuingCountryCode:'',saveForFuture:false,frequentFlyer:'',confirmed:true}],contact:{name:'Demo Traveler',email:'demo@example.com',dialCode:'+880',phone:'1712345678'},servicePreferences:[{wheelchair:'NONE',meal:'NONE',baggage:'NONE',assistance:'NONE',note:''}],contactNameManuallyEdited:false,submissionKey:'test',submittedAttemptId:null};
afterEach(()=>{cleanup();clearCheckoutDraft(checkoutJourneyDraftKey(request));clearCheckoutDraft('guest:initial:original');clearCheckoutDraft('guest:new-search:new-offer');vi.clearAllMocks();});
it('explains a replacement fare, displays its price and never accepts it automatically',async()=>{
  keepCheckoutDraft('guest:initial:original','recovery-test',draft);
  const replacement={...offer,offerId:'replacement',totalAmount:'5100.00',outbound:{...offer.outbound,segments:[{...offer.outbound.segments[0]!,bookingClass:'Y'}]}};
  api.search.mockResolvedValue({searchId:'fresh',offers:[replacement],expiresAt:new Date(Date.now()+60000).toISOString()});
  render(<MemoryRouter initialEntries={[{pathname:'/flight-checkout',state:{offer,searchRequest:request,searchId:'initial'}}]}><GuestFlightCheckoutPage/></MemoryRouter>);
  const notification=await screen.findByRole('status',{name:'Fare update'});
  expect(notification.textContent).toContain('closest available fare');
  expect(notification.textContent).toContain('5,100.00');
  expect(screen.getAllByRole('button',{name:'Accept updated fare & continue'}).length).toBeGreaterThan(0);
  expect(screen.getByRole('button',{name:'Recheck latest price'})).toBeTruthy();
  expect(api.createIntent).not.toHaveBeenCalled();
});
it('shows a failed recheck only once and keeps the entered traveler details',async()=>{
  keepCheckoutDraft('guest:initial:original','recovery-test',draft);
  api.search.mockResolvedValue({searchId:'fresh',offers:[],expiresAt:new Date(Date.now()+60000).toISOString()});
  render(<MemoryRouter initialEntries={[{pathname:'/flight-checkout',state:{offer,searchRequest:request,searchId:'initial'}}]}><GuestFlightCheckoutPage/></MemoryRouter>);
  await screen.findByText(/latest search did not return a fare/);
  fireEvent.click(screen.getByRole('region',{name:'Checkout total'}).querySelector<HTMLButtonElement>('.guest-checkout-next')!);
  await waitFor(()=>expect(api.search).toHaveBeenCalledTimes(2));
  expect(screen.getAllByText(/latest search did not return a fare/)).toHaveLength(1);
  expect(screen.getByText('Passenger 1: Demo Traveler')).toBeTruthy();
  expect(api.createIntent).not.toHaveBeenCalled();
});
function SearchAgain(){const navigate=useNavigate();return <button onClick={()=>navigate('/flight-checkout',{state:{searchId:'new-search',offer:{...offer,offerId:'new-offer'},searchRequest:request}})}>Choose new quote</button>;}
it('preserves entered people and contact details when choosing a new quote without reusing a booking attempt',async()=>{
  render(<MemoryRouter initialEntries={[{pathname:'/flight-checkout',state:{offer,searchRequest:request,searchId:'initial'}}]}><Routes><Route path="/flight-checkout" element={<GuestFlightCheckoutPage/>}/><Route path="/flights" element={<SearchAgain/>}/></Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/First \/ given names/),{target:{value:'Saved Demo'}});
  fireEvent.change(screen.getByLabelText('Email *'),{target:{value:'saved@example.com'}});
  fireEvent.click(screen.getByRole('link',{name:'Choose another flight'}));
  fireEvent.click(await screen.findByRole('button',{name:'Choose new quote'}));
  await waitFor(()=>expect((screen.getByLabelText(/First \/ given names/) as HTMLInputElement).value).toBe('Saved Demo'));
  expect((screen.getByLabelText('Email *') as HTMLInputElement).value).toBe('saved@example.com');
  expect(screen.getByRole('button',{name:'Confirm passenger'})).toBeTruthy();
  expect(api.createIntent).not.toHaveBeenCalled();
});
