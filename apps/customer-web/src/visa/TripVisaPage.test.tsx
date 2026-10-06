// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {TripVisaPage} from './TripVisaPage';
const api=vi.hoisted(()=>({detail:vi.fn(),catalogue:vi.fn(),list:vi.fn(),createTrip:vi.fn(),navigate:vi.fn()}));
vi.mock('react-router-dom',async original=>({...await original<typeof import('react-router-dom')>(),useNavigate:()=>api.navigate}));
vi.mock('../services/tripService',()=>({tripService:{detail:api.detail,create:api.createTrip}}));
vi.mock('../services/visaService',()=>({visaService:{list:api.list,catalogue:api.catalogue}}));
const trip={id:'trip-1',title:'Test',primaryDestination:{countryCode:'MY'},startDate:'2099-01-01',destinations:[],travellers:[{id:'saved-1',legalFirstName:'Saved',legalLastName:'Applicant'}]};
beforeEach(()=>{api.detail.mockResolvedValue(trip);api.list.mockResolvedValue([]);api.catalogue.mockResolvedValue([]);});afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();vi.resetAllMocks();});
async function open(){render(<MemoryRouter><TripVisaPage initialTripId="trip-1"/></MemoryRouter>);await screen.findByLabelText('Saved Applicant');await waitFor(()=>expect(screen.getByLabelText('Visa purpose').hasAttribute('disabled')).toBe(false));fireEvent.change(screen.getByLabelText('Visa purpose'),{target:{value:'request:Tourism'}});}
describe('optional saved visa applicants',()=>{
 it('continues with four new applicants without selecting a saved person',async()=>{await open();fireEvent.change(screen.getByLabelText('New applicants'),{target:{value:'4'}});const button=screen.getByRole('button',{name:'Continue to request form →'});expect(button.hasAttribute('disabled')).toBe(false);fireEvent.click(button);await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/app/visa/assistance',expect.objectContaining({state:{visaAssistanceDraft:expect.objectContaining({travellerIds:[],newApplicantCount:4})}})));});
 it('reuses a saved applicant or mixes saved and new applicants',async()=>{await open();fireEvent.click(screen.getByLabelText('Saved Applicant'));expect((screen.getByLabelText('New applicants') as HTMLInputElement).value).toBe('0');fireEvent.change(screen.getByLabelText('New applicants'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'Continue to request form →'}));await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/app/visa/assistance',expect.objectContaining({state:{visaAssistanceDraft:expect.objectContaining({travellerIds:['saved-1'],newApplicantCount:2})}})));});
 it('continues when browser storage is unavailable',async()=>{await open();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage blocked');});fireEvent.click(screen.getByRole('button',{name:'Continue to request form →'}));await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/app/visa/assistance',expect.objectContaining({state:expect.any(Object)})));});

 it('rejects a negative new-applicant count even when saved applicants keep the total positive',async()=>{
  api.detail.mockResolvedValue({...trip,travellers:[...trip.travellers,{id:'saved-2',legalFirstName:'Second',legalLastName:'Applicant'}]});
  await open();fireEvent.click(screen.getByLabelText('Saved Applicant'));fireEvent.click(screen.getByLabelText('Second Applicant'));
  fireEvent.change(screen.getByLabelText('New applicants'),{target:{value:'-1'}});
  expect(screen.getByRole('button',{name:'Continue to request form →'}).hasAttribute('disabled')).toBe(true);
  expect(api.navigate).not.toHaveBeenCalled();
 });
 it('clears stale services and finishes loading when the destination is cleared',async()=>{
  await open();let resolve!:(value:unknown[])=>void;
  api.catalogue.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  fireEvent.change(screen.getByLabelText('Destination country'),{target:{value:'JP'}});
  await waitFor(()=>expect(api.catalogue).toHaveBeenLastCalledWith('JP'));
  fireEvent.change(screen.getByLabelText('Destination country'),{target:{value:''}});
  resolve([{id:'stale-type',name:'Old service',destinationCountryCode:'JP'}]);
  await waitFor(()=>expect(screen.queryByText('Loading published visa services. You can choose a general purpose now.')).toBeNull());
  expect(screen.queryByRole('option',{name:'Old service'})).toBeNull();
  expect(screen.getByLabelText('Visa purpose').hasAttribute('disabled')).toBe(false);
 });
 it('lets general assisted requests continue when the service catalogue is unavailable',async()=>{
  api.catalogue.mockRejectedValue(new Error('Catalogue unavailable'));
  render(<MemoryRouter><TripVisaPage initialTripId="trip-1"/></MemoryRouter>);
  await screen.findByRole('option',{name:'Tourism'});
  fireEvent.change(screen.getByLabelText('Visa purpose'),{target:{value:'request:Tourism'}});
  const button=screen.getByRole('button',{name:'Continue to request form →'});
  expect(button.hasAttribute('disabled')).toBe(false);
  expect((await screen.findByRole('alert')).textContent).toContain('general assisted request');
  fireEvent.click(button);
  await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/app/visa/assistance',expect.objectContaining({state:{visaAssistanceDraft:expect.objectContaining({purpose:'Tourism'})}})));
 });
 it('keeps purpose available before choosing a destination and retains it afterward',async()=>{
  api.detail.mockResolvedValue({...trip,primaryDestination:null,startDate:null});
  render(<MemoryRouter><TripVisaPage initialTripId="trip-1"/></MemoryRouter>);
  const purpose=await screen.findByLabelText('Visa purpose') as HTMLSelectElement;
  expect(purpose.disabled).toBe(false);
  fireEvent.change(purpose,{target:{value:'request:Business'}});
  fireEvent.change(screen.getByLabelText('Destination country'),{target:{value:'MY'}});
  await waitFor(()=>expect(api.catalogue).toHaveBeenCalledWith('MY'));
  await waitFor(()=>expect(purpose.disabled).toBe(false));
  expect(purpose.value).toBe('request:Business');
 });
 it('allows a general purpose during catalogue loading and retains it when published services arrive',async()=>{
  let resolve!:(value:unknown[])=>void;api.catalogue.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  render(<MemoryRouter><TripVisaPage initialTripId="trip-1"/></MemoryRouter>);
  const purpose=await screen.findByLabelText('Visa purpose') as HTMLSelectElement;
  expect(purpose.disabled).toBe(false);
  fireEvent.change(purpose,{target:{value:'request:Tourism'}});
  expect(screen.getByRole('button',{name:'Continue to request form →'}).hasAttribute('disabled')).toBe(false);
  resolve([{id:'type-1',name:'Tourist visa',destinationCountryCode:'MY'}]);
  await screen.findByRole('option',{name:'Tourist visa'});
  expect(purpose.value).toBe('request:Tourism');
  expect(screen.getByRole('option',{name:'Tourism'})).toBeTruthy();
 });
 it('keeps a configured service on the request-form path when adding new applicants',async()=>{
  api.catalogue.mockResolvedValue([{id:'type-1',name:'Tourist visa',destinationCountryCode:'MY'}]);
  render(<MemoryRouter><TripVisaPage initialTripId="trip-1"/></MemoryRouter>);
  await screen.findByRole('option',{name:'Tourist visa'});
  fireEvent.change(screen.getByLabelText('Visa purpose'),{target:{value:'type-1'}});
  fireEvent.click(screen.getByRole('button',{name:'Continue to request form →'}));
  await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/app/visa/assistance',expect.objectContaining({state:{visaAssistanceDraft:expect.objectContaining({purpose:'Tourist visa',newApplicantCount:1})}})));
 });
 it('locks the search and prevents duplicate journeys while preparing',async()=>{
  await open();fireEvent.change(screen.getByLabelText('Expected travel date'),{target:{value:'2099-02-01'}});
  let resolve!:(value:unknown)=>void;api.createTrip.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  const button=screen.getByRole('button',{name:'Continue to request form →'});
  fireEvent.click(button);fireEvent.click(button);
  expect(api.createTrip).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('Destination country') as HTMLSelectElement).matches(':disabled')).toBe(true);
  resolve({...trip,id:'new-trip'});
  await waitFor(()=>expect(api.navigate).toHaveBeenCalledTimes(1));
 });
 it('ignores a late response for a journey that is no longer selected',async()=>{
  let resolve!:(value:unknown)=>void;api.detail.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  const view=render(<MemoryRouter><TripVisaPage initialTripId="trip-1"/></MemoryRouter>);
  api.detail.mockResolvedValue({...trip,id:'trip-2',primaryDestination:{countryCode:'JP'}});
  view.rerender(<MemoryRouter><TripVisaPage initialTripId="trip-2"/></MemoryRouter>);
  await screen.findByRole('heading',{name:'Where are you going?'});
  resolve(trip);
  await waitFor(()=>expect((screen.getByLabelText('Destination country') as HTMLSelectElement).value).toBe('JP'));
  expect(api.list).not.toHaveBeenCalledWith('trip-1');
 });

});
