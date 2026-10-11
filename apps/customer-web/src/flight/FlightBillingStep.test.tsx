// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {FlightReservationForm} from './FlightReservationForm';
const api=vi.hoisted(()=>({bookingCapabilities:vi.fn(async()=>({reservationAvailable:true})),reserve:vi.fn(async()=>({id:'booking'})),bookingForIntent:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:{user:{id:'billing-user',email:'test@example.com'}}})}));
vi.mock('../components/BoundedSelect',()=>({BoundedSelect:({ariaLabel,value,onChange}:{ariaLabel:string;value:string;onChange:(value:string)=>void})=><input aria-label={ariaLabel} value={value} onChange={event=>onChange(event.target.value)}/>}));
afterEach(()=>cleanup());
it('collects billing only at payment and retains contact and billing when going back',async()=>{
 render(<MemoryRouter initialEntries={['/app/flights/booking-intents/billing-test']}><FlightReservationForm intentId="billing-test" namesConfirmed initialContact={{contactEmail:'test@example.com',contactPhone:'+60123456789'}}/></MemoryRouter>);
 const next=await screen.findByRole('button',{name:'Continue to payment'});
 expect(screen.queryByLabelText('Billing name')).toBeNull();
 fireEvent.submit(next.closest('form')!);
 const billing=await screen.findByLabelText('Billing name');
 expect(api.reserve).not.toHaveBeenCalled();
 expect(screen.queryByLabelText('Booking email')).toBeNull();
 fireEvent.change(billing,{target:{value:'Test Buyer'}});
 fireEvent.click(screen.getByRole('button',{name:/Back to review/}));
 expect((await screen.findByLabelText('Booking email') as HTMLInputElement).value).toBe('test@example.com');
 fireEvent.submit(screen.getByRole('button',{name:'Continue to payment'}).closest('form')!);
 expect((await screen.findByLabelText('Billing name') as HTMLInputElement).value).toBe('Test Buyer');
 for(const [label,value] of [['Billing street address','Street'],['Billing city','Dhaka'],['Billing state / region','Dhaka'],['Billing postcode','1200'],['Billing country','BD']])fireEvent.change(screen.getByLabelText(label!),{target:{value}});
 fireEvent.submit(screen.getByRole('button',{name:'Continue to secure payment'}).closest('form')!);
 await waitFor(()=>expect(api.reserve).toHaveBeenCalledWith('billing-test',expect.objectContaining({contactEmail:'test@example.com',billingAddress:expect.objectContaining({name:'Test Buyer',countryCode:'BD'})})));
});
