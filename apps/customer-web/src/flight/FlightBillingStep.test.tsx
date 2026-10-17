// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useNavigate} from 'react-router-dom';
import {FlightReservationForm} from './FlightReservationForm';
import {keepCheckoutPassports,clearCheckoutPassports} from './checkoutPassportDraft';
import {clearCheckoutDraft,clearReservationRecovery,reservationRecoveryKey} from './checkoutDrafts';
import type {TravellerProfile} from '@flyseri/types';
const api=vi.hoisted(()=>({bookingCapabilities:vi.fn(),reserve:vi.fn(),bookingForIntent:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:{user:{id:'billing-user',email:'test@example.com'}}})}));
vi.mock('../components/BoundedSelect',()=>({BoundedSelect:({ariaLabel,value,onChange}:{ariaLabel:string;value:string;onChange:(value:string)=>void})=><input aria-label={ariaLabel} value={value} onChange={event=>onChange(event.target.value)}/>}));
const person={id:'person',legalFirstName:'Test',legalLastName:'Traveler'} as TravellerProfile;
beforeEach(()=>{
 vi.resetAllMocks();clearCheckoutDraft('reservation:billing-test');clearReservationRecovery(reservationRecoveryKey('billing-test','billing-user'));
 keepCheckoutPassports('billing-test','billing-user',[{travellerId:'person',documentNumber:'TEST123',expiryDate:'2040-01-01',issuingCountryCode:'BD',residenceCountryCode:'MY'}]);
 api.bookingCapabilities.mockResolvedValue({reservationAvailable:true});api.bookingForIntent.mockResolvedValue(null);
});
afterEach(()=>{cleanup();clearCheckoutPassports('billing-test');});
function LeaveCheckout(){const navigate=useNavigate();return <button onClick={()=>navigate('/help')}>Open help</button>;}
function open(namesConfirmed=true){return render(<MemoryRouter initialEntries={['/app/flights/booking-intents/billing-test']}><LeaveCheckout/><Routes>
 <Route path="/app/flights/booking-intents/:id" element={<FlightReservationForm intentId="billing-test" namesConfirmed={namesConfirmed} people={[person]} passportsCaptured documentValidThrough="2030-01-01" initialContact={{contactEmail:'test@example.com',contactPhone:'+60123456789'}}/>}/>
 <Route path="/app/bookings/:id" element={<h1>Preparing the saved reservation</h1>}/>
 <Route path="/help" element={<h1>Help page</h1>}/>
 </Routes></MemoryRouter>);}
function billing(){for(const [label,value] of [['Billing name','Test Buyer'],['Billing street address','Street'],['Billing city','Dhaka'],['Billing state / region','Dhaka'],['Billing postcode','1200'],['Billing country','BD']])fireEvent.change(screen.getByLabelText(label!),{target:{value}});}
it('collects billing in Review and submits one reservation while repeated clicks are ignored',async()=>{
 let done!:(value:unknown)=>void;api.reserve.mockReturnValue(new Promise(resolve=>{done=resolve;}));open();
 const next=await screen.findByRole('button',{name:'Continue to payment'});
 expect(screen.getByLabelText('Billing name')).toBeTruthy();expect(screen.queryByRole('region',{name:'Payment methods'})).toBeNull();billing();
 const form=(next as HTMLButtonElement).form!;fireEvent.submit(form);fireEvent.submit(form);
 expect(api.reserve).toHaveBeenCalledOnce();
 expect(api.reserve).toHaveBeenCalledWith('billing-test',expect.objectContaining({namesConfirmed:true,contactEmail:'test@example.com',billingAddress:expect.objectContaining({name:'Test Buyer',countryCode:'BD'}),passports:[expect.objectContaining({documentNumber:'TEST123',residenceCountryCode:'MY'})]}));
 expect(screen.getByRole('status',{name:'Preparing secure payment…'})).toBeTruthy();
 await act(async()=>done({id:'booking'}));await screen.findByRole('heading',{name:'Preparing the saved reservation'});
});
it('keeps contact and billing when Review is reopened',async()=>{
 const first=open();await screen.findByLabelText('Billing name');billing();first.unmount();open();
 expect((await screen.findByLabelText('Billing name') as HTMLInputElement).value).toBe('Test Buyer');
 expect((screen.getByLabelText('Booking email') as HTMLInputElement).value).toBe('test@example.com');
 expect(api.reserve).not.toHaveBeenCalled();
});
it('does not reserve before the legal names are confirmed',async()=>{
 open(false);const next=await screen.findByRole('button',{name:'Continue to payment'});billing();
 expect((next as HTMLButtonElement).disabled).toBe(true);fireEvent.submit((next as HTMLButtonElement).form!);expect(api.reserve).not.toHaveBeenCalled();
});
it('keeps an uncertain attempt locked and recovers the existing reservation without resubmitting',async()=>{
 api.reserve.mockRejectedValue(new Error('Connection interrupted'));open();const next=await screen.findByRole('button',{name:'Continue to payment'});billing();fireEvent.submit((next as HTMLButtonElement).form!);
 const recover=await screen.findByRole('button',{name:'Check saved booking'});
 await waitFor(()=>expect((recover as HTMLButtonElement).disabled).toBe(false));
 fireEvent.submit((screen.getByRole('button',{name:'Continue to payment'}) as HTMLButtonElement).form!);expect(api.reserve).toHaveBeenCalledOnce();
 api.bookingForIntent.mockResolvedValue({id:'booking'});fireEvent.click(recover);await screen.findByRole('heading',{name:'Preparing the saved reservation'});expect(api.reserve).toHaveBeenCalledOnce();
});
it('does not redirect a customer who leaves while a reservation response is still arriving',async()=>{
 let done!:(value:unknown)=>void;api.reserve.mockReturnValue(new Promise(resolve=>{done=resolve;}));open();
 const next=await screen.findByRole('button',{name:'Continue to payment'});billing();fireEvent.submit((next as HTMLButtonElement).form!);
 fireEvent.click(screen.getByRole('button',{name:'Open help'}));await screen.findByRole('heading',{name:'Help page'});
 await act(async()=>done({id:'booking'}));expect(screen.getByRole('heading',{name:'Help page'})).toBeTruthy();expect(api.reserve).toHaveBeenCalledOnce();
});
