// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {OrderDetailPage} from './OrderDetailPage';
const commerce=vi.hoisted(()=>({order:vi.fn(),paymentCapabilities:vi.fn(),payment:vi.fn()}));
const flights=vi.hoisted(()=>({booking:vi.fn(),bookingCapabilities:vi.fn()}));
vi.mock('../services/commerceService',()=>({commerceService:commerce}));
vi.mock('../services/flightService',()=>({flightService:flights}));
vi.mock('./CouponCheckout',()=>({CouponCheckout:()=>null}));
vi.mock('../rewards/PointsCheckout',()=>({PointsCheckout:()=>null}));
vi.mock('../travel/TravelCompanion',()=>({TravelCompanion:()=>null}));
vi.mock('../flight/FlightTicketIssuanceNotice',()=>({FlightTicketIssuanceNotice:()=>null}));
vi.mock('../flight/FlightFareInformation',()=>({FlightBaggageDetails:()=>null,FlightServiceDetails:()=>null}));
vi.mock('../flight/usePreferredDisplayPrices',()=>({usePreferredDisplayPrices:()=>({currency:'MYR',prices:[{amount:'100.00',estimated:false}]})}));
const booking={id:'pnr-booking',pnr:'ABC123',status:'PNR_CREATED',passengerNames:['Test Traveler'],selectedOffer:{airlineCodes:['MH'],outbound:{durationMinutes:240,segments:[{origin:'DAC',destination:'KUL',departureAt:'2027-01-24T08:00:00+06:00',arrivalAt:'2027-01-24T14:00:00+08:00',marketingCarrier:'MH',flightNumber:'197'}]}},ancillaryRequests:[],serviceRequests:[]};
const order={id:'pnr-order',orderNumber:'ORDER-1',flightBookingId:booking.id,status:'PENDING_PAYMENT',payment:null,paidAt:null,totalAmount:'100.00',currency:'MYR',items:[],expiresAt:null};
beforeEach(()=>{vi.resetAllMocks();flights.booking.mockResolvedValue(booking);flights.bookingCapabilities.mockResolvedValue({ticketIssuanceAvailable:false});commerce.paymentCapabilities.mockResolvedValue({checkoutAvailable:true});commerce.order.mockResolvedValue(order);});
afterEach(cleanup);
function open(){render(<MemoryRouter initialEntries={['/app/orders/pnr-order']}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);}
it('hides the PNR in both payment content and its sidebar before the final step',async()=>{
 open();
 expect(await screen.findByText('Flight details & included services')).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Airline booking reference'})).toBeNull();
 expect(screen.queryByText('ABC123')).toBeNull();
 expect(within(screen.getByRole('complementary',{name:'Order summary'})).queryByText('Booking reference (PNR)')).toBeNull();
});
it.each(['PAID','PAYMENT_PROCESSING','PAYMENT_FAILED'])('shows a real PNR at the final result for %s',async status=>{
 const payment=status==='PAID'?{id:'payment-one',status:'SUCCEEDED'}:status==='PAYMENT_PROCESSING'?{id:'payment-one',status:'PROCESSING'}:{id:'payment-one',status:'FAILED'};
 commerce.order.mockResolvedValue({...order,status,payment,paidAt:status==='PAID'?'2026-10-15T08:00:00Z':null});
 open();
 const reference=await screen.findByRole('region',{name:'Airline booking reference'});
 expect(reference.textContent).toContain('ABC123');
 expect(screen.getAllByText('ABC123')).toHaveLength(1);
 expect(within(screen.getByRole('complementary',{name:'Order summary'})).queryByText('ABC123')).toBeNull();
});
