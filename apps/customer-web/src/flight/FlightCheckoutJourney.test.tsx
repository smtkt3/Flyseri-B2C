// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
import {FlightIntentPage} from './FlightIntentPage';
import {FlightPaymentPreparation} from './FlightPaymentPreparation';
import {OrderDetailPage} from '../commerce/OrderDetailPage';
import {keepCheckoutPassports,clearCheckoutPassports} from './checkoutPassportDraft';
import {clearCheckoutDraft,clearReservationRecovery,reservationRecoveryKey} from './checkoutDrafts';
import type {FlightBooking,FlightBookingIntent} from '@flyseri/types';
const api=vi.hoisted(()=>({intent:vi.fn(),bookingForIntent:vi.fn(),bookingCapabilities:vi.fn(),reserve:vi.fn(),refreshCheckout:vi.fn(),booking:vi.fn(),validateIntent:vi.fn(),confirmPrice:vi.fn()}));
const commerce=vi.hoisted(()=>({createFlightOrder:vi.fn(),order:vi.fn(),paymentCapabilities:vi.fn()}));
const people=vi.hoisted(()=>({get:vi.fn()}));
const conversion=vi.hoisted(()=>({failed:false}));
vi.mock('../services/flightService',()=>({flightService:api}));
vi.mock('../services/commerceService',()=>({commerceService:commerce}));
vi.mock('../services/travellerService',()=>({travellerService:people}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:{user:{id:'journey-user',email:'test@example.com'}}})}));
vi.mock('./usePreferredDisplayPrices',()=>({usePreferredDisplayPrices:(prices:{amount:string|null}[])=>({currency:conversion.failed?'BDT':'MYR',failed:conversion.failed,prices:prices.map(p=>({amount:conversion.failed?null:p.amount,estimated:conversion.failed}))})}));
vi.mock('../components/BoundedSelect',()=>({BoundedSelect:({ariaLabel,value,onChange}:{ariaLabel:string;value:string;onChange:(value:string)=>void})=><input aria-label={ariaLabel} value={value} onChange={event=>onChange(event.target.value)}/>}));
vi.mock('../commerce/CouponCheckout',()=>({CouponCheckout:()=>null}));
vi.mock('../rewards/PointsCheckout',()=>({PointsCheckout:()=>null}));
vi.mock('../travel/TravelCompanion',()=>({TravelCompanion:()=>null}));
vi.mock('./FlightTicketIssuanceNotice',()=>({FlightTicketIssuanceNotice:()=>null}));
vi.mock('./FlightFareInformation',()=>({FlightBaggageDetails:()=>null,FlightServiceDetails:()=>null}));
vi.mock('./ReviewFlightInclusions',()=>({ReviewFlightInclusions:()=>null}));
const person={id:'traveler',legalFirstName:'Test',legalLastName:'Traveler'};
const offer={airlineCodes:['MH'],currency:'MYR',cabin:'ECONOMY',totalAmount:'100.00',outbound:{stops:0,durationMinutes:120,segments:[{origin:'KUL',destination:'PEN',departureAt:'2030-01-10T08:00:00+08:00',arrivalAt:'2030-01-10T10:00:00+08:00',marketingCarrier:'MH',flightNumber:'100',durationMinutes:120}]},inbound:null};
const selection=()=>({id:'journey',status:'READY_FOR_PAYMENT',selectedOffer:offer,travellerIds:[person.id],currency:'MYR',searchTotalAmount:'100.00',validatedTotalAmount:'100.00',expiresAt:new Date(Date.now()+600000).toISOString(),ancillaryRequests:[]} as unknown as FlightBookingIntent);
const booking={id:'saved',bookingIntentId:'journey',status:'PNR_CREATED',pnr:'ABC123',amount:'100.00',currency:'MYR',passengerNames:['Test Traveler'],ancillaryRequests:[],selectedOffer:offer} as unknown as FlightBooking;
const order={id:'pay',orderNumber:'TRIAL-1',flightBookingId:'saved',status:'PENDING_PAYMENT',payment:null,paidAt:null,totalAmount:'100.00',currency:'MYR',items:[],expiresAt:null};
beforeEach(()=>{
 vi.resetAllMocks();conversion.failed=false;clearCheckoutDraft('reservation:journey');clearReservationRecovery(reservationRecoveryKey('journey','journey-user'));
 keepCheckoutPassports('journey','journey-user',[{travellerId:person.id,documentNumber:'TEST123',expiryDate:'2040-01-01',issuingCountryCode:'MY',residenceCountryCode:'MY'}]);
 api.intent.mockResolvedValue(selection());api.bookingForIntent.mockResolvedValue(null);people.get.mockResolvedValue(person);
 api.bookingCapabilities.mockResolvedValue({reservationAvailable:true,ticketIssuanceAvailable:false});api.reserve.mockResolvedValue(booking);api.booking.mockResolvedValue(booking);api.refreshCheckout.mockResolvedValue(booking);
 commerce.createFlightOrder.mockResolvedValue(order);commerce.order.mockResolvedValue(order);commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:true});
});
afterEach(()=>{cleanup();clearCheckoutPassports('journey');});
function Location(){const l=useLocation();return <output data-testid="route">{l.pathname+l.search}</output>;}
function open(search=''){render(<MemoryRouter initialEntries={[{pathname:'/app/flights/booking-intents/journey',search,state:{passportsCaptured:true,bookingContact:{contactEmail:'test@example.com',contactPhone:'+60123456789'}}}]}><Location/><Routes>
 <Route path="/app/flights/booking-intents/:intentId" element={<FlightIntentPage/>}/>
 <Route path="/app/bookings/:bookingId" element={<FlightPaymentPreparation booking={booking}/>}/>
 <Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/>
 </Routes></MemoryRouter>);}
function billing(){for(const [label,value] of [['Billing name','Test Buyer'],['Billing street address','Test street'],['Billing city','Kuala Lumpur'],['Billing state / region','Kuala Lumpur'],['Billing postcode','50000'],['Billing country','MY']])fireEvent.change(screen.getByLabelText(label!),{target:{value}});}
it('runs Review through verification to one Payment page with one reservation and one order',async()=>{
 open();await screen.findByLabelText('Billing name');billing();
 expect(screen.getByRole('listitem',{name:'Review trip, current step'})).toBeTruthy();expect(screen.queryByRole('region',{name:'Payment methods'})).toBeNull();
 expect((screen.getByRole('button',{name:'Continue to payment'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:/checked these legal names/}));
 fireEvent.submit((screen.getByRole('button',{name:'Continue to payment'}) as HTMLButtonElement).form!);
 await screen.findByRole('region',{name:'Payment methods'});
 expect(screen.getByTestId('route').textContent).toBe('/app/orders/pay');
 expect(screen.getByRole('listitem',{name:'Payment, current step'})).toBeTruthy();
 expect(screen.queryByText('ABC123')).toBeNull();expect(api.reserve).toHaveBeenCalledOnce();expect(api.refreshCheckout).toHaveBeenCalledOnce();expect(commerce.createFlightOrder).toHaveBeenCalledOnce();
});
it('opens legacy payment-details links in Review and uses the quoted currency when conversion fails',async()=>{
 conversion.failed=true;open('?step=payment');await screen.findByLabelText('Billing name');billing();fireEvent.click(screen.getByRole('checkbox',{name:/checked these legal names/}));
 await waitFor(()=>expect(screen.getByTestId('route').textContent).toBe('/app/flights/booking-intents/journey'));
 expect(screen.getByRole('listitem',{name:'Review trip, current step'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'Continue to payment'}) as HTMLButtonElement).disabled).toBe(false);
 expect(screen.getAllByText(/MYR.*100/).length).toBeGreaterThan(0);expect(api.reserve).not.toHaveBeenCalled();
});
it('waits for traveler details before showing the review form',async()=>{
 let done!:(value:unknown)=>void;people.get.mockReturnValue(new Promise(resolve=>{done=resolve;}));open();
 await waitFor(()=>expect(people.get).toHaveBeenCalled());
 expect(screen.getByRole('status',{name:'Loading your flight selection…'})).toBeTruthy();expect(screen.queryByLabelText('Billing name')).toBeNull();
 await act(async()=>done(person));await screen.findByLabelText('Billing name');
});
it('preserves entered billing while the customer accepts a changed fare',async()=>{
 api.intent.mockResolvedValue({...selection(),status:'PRICE_CHANGED',validatedTotalAmount:'110.00'});api.confirmPrice.mockResolvedValue({...selection(),validatedTotalAmount:'110.00'});
 open();await screen.findByLabelText('Billing name');billing();fireEvent.click(screen.getByRole('checkbox',{name:/checked these legal names/}));
 expect((screen.getByRole('button',{name:'Continue to payment'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Accept updated fare'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'Continue to payment'}) as HTMLButtonElement).disabled).toBe(false));
 expect((screen.getByLabelText('Billing name') as HTMLInputElement).value).toBe('Test Buyer');expect(api.reserve).not.toHaveBeenCalled();
});
