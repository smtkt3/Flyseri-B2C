// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {FlightOffer} from '@flyseri/types';
import {clearFlightPreferences,normalizeFlightPreferences,readFlightPreferences,saveFlightPreferences} from './searchPreferences';
import {FlightSupportLink,flightHelpContext,readFlightHelp} from './FlightSupportLink';
import {SupportPage} from '../account/SupportPage';
import {FlightSearchPage} from './FlightSearchPage';
import {readSavedHomeSearch,updateHomeSearch,useHomeSearchDraft} from '../components/home/homeSearchDraft';
const support=vi.hoisted(()=>({prepareSupport:vi.fn(),confirm:vi.fn(),cancel:vi.fn()}));
vi.mock('../services/seriService',()=>({seriService:support}));
vi.mock('../travel/SupportTracker',()=>({SupportTracker:()=>null}));
const fare:FlightOffer={offerId:'fare',totalAmount:'125.00',currency:'MYR',airlineCodes:['MH'],baggageSummary:null,cabin:'ECONOMY',inbound:null,outbound:{stops:0,durationMinutes:60,segments:[{origin:'KUL',destination:'PEN',departureAt:'2026-11-25T08:00:00+08:00',arrivalAt:'2026-11-25T09:00:00+08:00',marketingCarrier:'MH',flightNumber:'100',durationMinutes:60}]}};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();clearFlightPreferences();vi.clearAllMocks();support.prepareSupport.mockResolvedValue({conversationId:'support',actionId:'review',summary:'Review selected flight question',expiresAt:new Date(Date.now()+60000).toISOString()});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('validates saved cabin and passenger bounds',()=>{
  expect(normalizeFlightPreferences({adults:8,children:8,infants:8,cabin:'INVALID'})).toEqual({adults:8,children:1,infants:0,cabin:'ECONOMY'});
  saveFlightPreferences({adults:2,children:0,infants:0,cabin:'BUSINESS'});
  expect(readFlightPreferences()?.cabin).toBe('BUSINESS');clearFlightPreferences();expect(readFlightPreferences()).toBeNull();
  expect(readSavedHomeSearch().cabin).toBe('ECONOMY');expect(readSavedHomeSearch().adults).toBe(1);
});
it('keeps homepage passenger controls usable when browser storage is blocked',()=>{
  const {result}=renderHook(useHomeSearchDraft);
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
  act(()=>updateHomeSearch({adults:2,cabin:'BUSINESS'}));
  expect(result.current.adults).toBe(2);expect(result.current.cabin).toBe('BUSINESS');
});
it('lets explicit search passengers and cabin override saved preferences',()=>{
  saveFlightPreferences({adults:2,children:1,infants:1,cabin:'BUSINESS'});
  render(<MemoryRouter initialEntries={['/flights?tripType=ONE_WAY&adults=1&cabin=ECONOMY']}><FlightSearchPage publicSearch/></MemoryRouter>);
  expect(document.querySelector('.flight-query-fields')?.textContent).toContain('1 adultEconomy');
  expect(document.querySelector('.flight-query-fields')?.textContent).not.toContain('children');
});
it('marks the attached fare as a shopping quote and excludes personal information',()=>{
  const context=flightHelpContext(fare,'1 adult');expect(context.text).toContain('KUL → PEN');expect(context.text).toContain('125.00');expect(context.text).toContain('need rechecking');expect(context.text.length).toBeLessThanOrEqual(500);
  expect(readFlightHelp({...context,savedAt:Date.now()-1800001})).toBeNull();
});
function mountHelp(){render(<MemoryRouter initialEntries={['/flights']}><Routes><Route path="/flights" element={<FlightSupportLink offer={fare} passengerLabel="1 adult"/>}/><Route path="/app/support" element={<SupportPage/>}/></Routes></MemoryRouter>);fireEvent.click(screen.getByRole('link',{name:/Ask our team/}));}
it('attaches selected fare details for review without automatically contacting support',async()=>{
  mountHelp();expect(screen.getByLabelText('Attached flight details').textContent).toContain('MH 100');expect(support.prepareSupport).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox',{name:'Details'}),{target:{value:'Please explain the baggage rules.'}});fireEvent.click(screen.getByRole('button',{name:'Review request'}));
  await waitFor(()=>expect(support.prepareSupport).toHaveBeenCalledOnce());
  const reason=support.prepareSupport.mock.calls[0]![0].reason;expect(reason).toContain('Please explain');expect(reason).toContain('KUL → PEN');expect(reason.length).toBeLessThanOrEqual(1000);expect(support.confirm).not.toHaveBeenCalled();
});
it('allows removing attached flight details before preparing support',async()=>{
  mountHelp();fireEvent.click(screen.getByRole('button',{name:'Remove flight details'}));expect(screen.queryByLabelText('Attached flight details')).toBeNull();
  fireEvent.change(screen.getByRole('textbox',{name:'Details'}),{target:{value:'General question'}});fireEvent.click(screen.getByRole('button',{name:'Review request'}));
  await waitFor(()=>expect(support.prepareSupport).toHaveBeenCalledOnce());expect(support.prepareSupport.mock.calls[0]![0].reason).not.toContain('Flight context');
});
