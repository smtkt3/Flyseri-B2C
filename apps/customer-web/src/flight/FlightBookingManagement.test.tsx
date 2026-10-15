// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import { MemoryRouter,Route,Routes,useNavigate } from 'react-router-dom';
import { FlightBookingPage } from './FlightBookingsPage';
const api=vi.hoisted(()=>({booking:vi.fn(),bookingCapabilities:vi.fn(),refreshBooking:vi.fn(),cancelBooking:vi.fn()}));
const commerce=vi.hoisted(()=>({createFlightOrder:vi.fn()}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/commerceService',()=>({commerceService:commerce}));
vi.mock('../travel/TravelCompanion',()=>({TravelCompanion:()=>null}));
vi.mock('./FlightAncillaryPurchasePanel',()=>({FlightAncillaryPurchasePanel:()=>null}));
vi.mock('./ReviewFlightInclusions',()=>({ReviewFlightInclusions:()=>null}));
vi.mock('./usePreferredDisplayPrices',()=>({usePreferredDisplayPrices:()=>({currency:'BDT',prices:[{amount:'22500',estimated:false}]})}));
vi.mock('./FlightPaymentPreparation',()=>({FlightPaymentPreparation:()=> <h2>Reservation verification before payment</h2>}));
const value={id:'one',bookingIntentId:'intent',status:'PNR_CREATED',pnr:'ABC123',amount:'22500',currency:'BDT',passengerNames:['Sample Traveller'],passengerNamesSource:'BOOKED_SNAPSHOT',createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z',lastSabreRefreshAt:null,ancillaryRequests:[],serviceRequests:[],selectedOffer:{airlineCodes:['MH'],outbound:{stops:0,durationMinutes:240,segments:[{origin:'DAC',destination:'KUL',departureAt:'2027-01-10T08:00:00+06:00',arrivalAt:'2027-01-10T14:00:00+08:00',marketingCarrier:'MH',flightNumber:'101'}]},inbound:null}};
beforeEach(()=>{vi.resetAllMocks();api.booking.mockResolvedValue(value);api.bookingCapabilities.mockResolvedValue({reservationAvailable:true,ticketIssuanceAvailable:false});});
afterEach(cleanup);
function Switch(){const navigate=useNavigate();return <button onClick={()=>navigate('/app/bookings/two')}>Other booking</button>;}
function open(checkoutBlocked?:string){render(<MemoryRouter initialEntries={[{pathname:'/app/bookings/one',state:checkoutBlocked?{checkoutBlocked}:undefined}]}><Switch/><Routes><Route path="/app/bookings/:bookingId" element={<FlightBookingPage/>}/></Routes></MemoryRouter>);}
it('lets a paused checkout run reservation verification again without creating an order directly',async()=>{
 open('Your reservation needs verification.');
 const retry=await screen.findByRole('button',{name:'Check & continue to payment'});
 expect(screen.queryByText('ABC123')).toBeNull();
 expect(screen.queryByRole('region',{name:'Airline booking reference'})).toBeNull();
 expect(screen.queryByText('Reservation verification before payment')).toBeNull();
 fireEvent.click(retry);
 await screen.findByText('Reservation verification before payment');
 expect(commerce.createFlightOrder).not.toHaveBeenCalled();
});
it('automatically routes a new reservation through payment preparation without creating an order directly',async()=>{
 open();
 await screen.findByText('Reservation verification before payment');expect(commerce.createFlightOrder).not.toHaveBeenCalled();
});
it('blocks payment for uncertain PNRs and does not display a confirmed reservation badge',async()=>{
 api.booking.mockResolvedValue({...value,status:'MANUAL_REVIEW_REQUIRED'});open();await screen.findByText('Needs verification');
 expect(screen.queryByRole('button',{name:'Continue to secure payment →'})).toBeNull();expect(commerce.createFlightOrder).not.toHaveBeenCalled();
});
it('ignores a late airline refresh after the customer opens a different booking',async()=>{
 let resolve!:(value:unknown)=>void;api.refreshBooking.mockReturnValue(new Promise(done=>{resolve=done;}));
 api.booking.mockImplementation(async(id:string)=>({...value,status:'MANUAL_REVIEW_REQUIRED',...(id==='two'?{id:'two',pnr:'XYZ789'}:{})}));
 open();fireEvent.click(await screen.findByRole('button',{name:'Check airline status'}));fireEvent.click(screen.getByRole('button',{name:'Other booking'}));
 await screen.findByText('XYZ789');await act(async()=>resolve({...value,pnr:'LATE01'}));
 expect(screen.getByText('XYZ789')).toBeTruthy();expect(screen.queryByText('LATE01')).toBeNull();
});
