// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {useState} from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import type {FlightAncillaryRequest,FlightAncillaryResponse} from '@flyseri/types';
import {FlightAirlineServices} from './FlightAirlineServices';
import {requestedExtra} from './flightAncillarySelections';
const api=vi.hoisted(()=>({intentAncillaries:vi.fn(),saveAncillarySelections:vi.fn(),ancillaryDisplayPrices:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:{user:{id:'fixture'}}})}));
vi.mock('../components/LocaleMenu',()=>({preferredCurrency:()=> 'BDT',currencyPreferenceEvent:'test-currency'}));
vi.mock('../travel/language',()=>({Translated:({text}:{text:string})=>text}));
vi.mock('./FlightSelectedExtras',()=>({FlightSelectedExtras:({requests}:{requests:FlightAncillaryRequest[]})=><p data-testid="selected">{requests.map(r=>r.name).join(', ')}</p>}));
let quote:FlightAncillaryResponse;
let fixtureId=0;
const service=(name:string,serviceCode:string,groupCode='BG')=>({offerItemId:null,sellable:true,name,serviceCode,groupCode,amount:'110',currency:'BDT',segmentLabels:['DAC → CXB · BG 433'],passengerIndexes:[0]});
function Fixture(){const [extras,setExtras]=useState<FlightAncillaryRequest[]>([]);return <FlightAirlineServices intentId={'intent-'+fixtureId} ready selectedExtras={extras} onSaved={intent=>setExtras(intent.ancillaryRequests||[])}/>;}
beforeEach(()=>{vi.resetAllMocks();fixtureId++;quote={quoteId:'fixture',retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),bookingAvailable:false,services:[service('Bag one','0AA'),service('Sports bag','0AB')]};api.intentAncillaries.mockImplementation(async()=>quote);api.saveAncillarySelections.mockImplementation(async(_id,selections)=>({ancillaryRequests:selections.map((s:{serviceIndex:number})=>requestedExtra(quote.services[s.serviceIndex]!))}));});
afterEach(cleanup);
describe('multiple extras selection',()=>{
 it('keeps two distinct baggage services selected and allows removing just one',async()=>{
  render(<Fixture/>);fireEvent.click(await screen.findByRole('button',{name:'Add Bag one'}));
  await waitFor(()=>expect(screen.getByTestId('selected').textContent).toBe('Bag one'));
  fireEvent.click(screen.getByRole('button',{name:'Add Sports bag'}));
  await waitFor(()=>expect(screen.getByTestId('selected').textContent).toBe('Bag one, Sports bag'));
  expect(api.saveAncillarySelections.mock.calls[1]?.[1]).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Remove Bag one'}));await waitFor(()=>expect(screen.getByTestId('selected').textContent).toBe('Sports bag'));
 });
 it('replaces the seat for the same traveler and flight without accumulating conflicting seats',async()=>{
  quote.services=[service('Seat 1A','S1','SA'),service('Seat 2A','S2','SA')];render(<Fixture/>);
  fireEvent.click(await screen.findByRole('button',{name:'Add Seat 1A'}));await waitFor(()=>expect(screen.getByTestId('selected').textContent).toBe('Seat 1A'));
  fireEvent.click(screen.getByRole('button',{name:'Add Seat 2A'}));await waitFor(()=>expect(screen.getByTestId('selected').textContent).toBe('Seat 2A'));
  expect(api.saveAncillarySelections.mock.calls[1]?.[1]).toHaveLength(1);
 });
 it('does not offer online purchase for display-only or weight-quote entries',async()=>{
  quote.services=[{...service('Assisted bag','0XX'),sellable:false}];render(<Fixture/>);await screen.findByText('Assisted bag');expect(screen.queryByRole('button',{name:'Add Assisted bag'})).toBeNull();
 });
});
