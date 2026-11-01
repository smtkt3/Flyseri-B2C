// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {clearPaymentAttempt,keepPaymentAttempt,readPaymentAttempt} from './paymentRecovery';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {OrderDetailPage} from './OrderDetailPage';
const commerce=vi.hoisted(()=>({order:vi.fn(),paymentCapabilities:vi.fn(),payment:vi.fn(),startPayment:vi.fn()}));
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
afterEach(()=>{cleanup();clearPaymentAttempt(order.id);});
function open(query=''){render(<MemoryRouter initialEntries={['/app/orders/pnr-order'+query]}><Routes><Route path="/app/orders/:orderId" element={<OrderDetailPage/>}/></Routes></MemoryRouter>);}
it('hides the PNR in both payment content and its sidebar before the final step',async()=>{
 open();
 expect(await screen.findByText('Flight details & included services')).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Airline booking reference'})).toBeNull();
 expect(screen.queryByText('ABC123')).toBeNull();
 expect(within(screen.getByRole('complementary',{name:'Order summary'})).queryByText('Booking reference (PNR)')).toBeNull();
});
it('shows a real PNR at the final result only after verified payment',async()=>{
 commerce.order.mockResolvedValue({...order,status:'PAID',payment:{id:'payment-one',status:'SUCCEEDED'},paidAt:'2026-10-15T08:00:00Z'});
 open();
 const reference=await screen.findByRole('region',{name:'Airline booking reference'});
 expect(reference.textContent).toContain('ABC123');
 expect(screen.getAllByText('ABC123')).toHaveLength(1);
 expect(within(screen.getByRole('complementary',{name:'Order summary'})).queryByText('ABC123')).toBeNull();
});
it('does not call a booking confirmed from stale issued evidence during servicing review',async()=>{
 commerce.order.mockResolvedValue({...order,status:'PAID',payment:{id:'payment-one',status:'SUCCEEDED'},paidAt:'2026-10-15T08:00:00Z'});
 flights.booking.mockResolvedValue({...booking,status:'MANUAL_REVIEW_REQUIRED',providerView:{tickets:[{number:'9971234567890',status:'Issued',travellerIndex:1}],flights:[],travellers:[]}});
 open();
 await screen.findByText('Booking under review');
 expect(screen.queryByRole('heading',{name:'Your booking is confirmed'})).toBeNull();
 expect(screen.getByText(/your reservation needs attention/)).toBeTruthy();
});
it.each(['PENDING','PROCESSING','UNKNOWN','CREATED','FAILED'])('keeps %s checkout on Payment instead of skipping to booking pending',async status=>{
 commerce.order.mockResolvedValue({...order,status:status==='FAILED'?'PAYMENT_FAILED':'PAYMENT_PROCESSING',payment:{id:'payment-one',status}});
 open();
 await screen.findByText('Flight details & included services');
 expect(screen.getByLabelText('Payment, current step').getAttribute('aria-current')).toBe('step');
 expect(screen.queryByRole('heading',{name:'Booking pending'})).toBeNull();
 expect(screen.queryByText('ABC123')).toBeNull();
 if(['UNKNOWN','CREATED','PROCESSING'].includes(status))expect(screen.getByRole('button',{name:'Payment unavailable'}).hasAttribute('disabled')).toBe(true);
 else {
   fireEvent.click(await screen.findByRole('checkbox'));
   expect(screen.getByRole('button',{name:status==='FAILED'?/^Pay .*securely/:/Resume secure checkout/}).hasAttribute('disabled')).toBe(false);
 }
});
it.each(['returned','cancelled'])('does not trust the checkout=%s URL as payment evidence',async result=>{
 commerce.order.mockResolvedValue({...order,status:'PAYMENT_PROCESSING',payment:{id:'payment-one',status:'PENDING'}});
 open('?checkout='+result);
 await screen.findByText('Flight details & included services');
 expect(screen.getByLabelText('Payment, current step')).toBeTruthy();
 expect(screen.queryByText('Payment verified')).toBeNull();
 expect(screen.getByRole('button',{name:/Resume secure checkout/})).toBeTruthy();
});
it('advances from Payment only after the server verifies success',async()=>{
 commerce.order.mockResolvedValue({...order,status:'PAYMENT_PROCESSING',payment:{id:'payment-one',status:'PENDING'}});
 open();
 await screen.findByText('Flight details & included services');
 expect(screen.getByLabelText('Payment, current step')).toBeTruthy();
 commerce.order.mockResolvedValue({...order,status:'PAID',payment:{id:'payment-one',status:'SUCCEEDED'},paidAt:new Date().toISOString()});
 fireEvent.click(screen.getByRole('button',{name:'Check payment status'}));
 await screen.findByRole('region',{name:'Airline booking reference'});
 expect(screen.queryByLabelText('Payment, current step')).toBeNull();
 expect(screen.queryByRole('button',{name:/Resume secure checkout/})).toBeNull();
});
it('recovers a timed-out browser request when the server already has the pending checkout',async()=>{
 const originalKey=keepPaymentAttempt(order.id,true).key;
 const pendingPayment={id:'payment-one',status:'PENDING'};
 commerce.order.mockResolvedValue({...order,status:'PAYMENT_PROCESSING',payment:pendingPayment});
 commerce.payment.mockResolvedValue(pendingPayment);
 open();
 const confirmation=await screen.findByRole('checkbox');
 expect(screen.queryByText('Check your payment before continuing')).toBeNull();
 expect(readPaymentAttempt(order.id)).toEqual({key:originalKey,uncertain:false});
 expect(commerce.startPayment).not.toHaveBeenCalled();
 fireEvent.click(confirmation);
 const resume=screen.getByRole('button',{name:/Resume secure checkout/});
 expect(resume.hasAttribute('disabled')).toBe(false);
 commerce.startPayment.mockResolvedValue({payment:pendingPayment,redirectUrl:null,actionRequired:false});
 fireEvent.click(resume);
 await waitFor(()=>expect(commerce.startPayment).toHaveBeenCalledOnce());
 expect(commerce.startPayment.mock.calls[0]).toEqual([order.id,originalKey]);
});
it('keeps an unresolved provider state locked until a later status check returns a pending checkout',async()=>{
 const originalKey=keepPaymentAttempt(order.id,true).key;
 commerce.order.mockResolvedValue({...order,status:'PAYMENT_PROCESSING',payment:{id:'payment-one',status:'UNKNOWN'}});
 commerce.payment.mockResolvedValue({id:'payment-one',status:'UNKNOWN'});
 open();
 await screen.findByText('Flight details & included services');
 expect(screen.queryByRole('checkbox')).toBeNull();
 expect(readPaymentAttempt(order.id)?.uncertain).toBe(true);
 commerce.payment.mockResolvedValue({id:'payment-one',status:'PENDING'});
 fireEvent.click(screen.getByRole('button',{name:'Check payment status'}));
 await screen.findByRole('checkbox');
 expect(screen.queryByText('Check your payment before continuing')).toBeNull();
 expect(readPaymentAttempt(order.id)).toEqual({key:originalKey,uncertain:false});
 expect(commerce.startPayment).not.toHaveBeenCalled();
});
it('keeps a closed fare window on Payment and requires a fare recheck for the existing PNR',async()=>{
 commerce.order.mockResolvedValue({...order,status:'EXPIRED',expiresAt:'2020-01-01T00:00:00Z',payment:{id:'payment-one',status:'PENDING'}});
 open();
 await screen.findByText('This payment window has expired');
 expect(screen.getByLabelText('Payment, current step')).toBeTruthy();
 const action=await screen.findByRole('button',{name:'Recheck fare & continue to payment →'});
 expect(action.hasAttribute('disabled')).toBe(true);
 fireEvent.click(await screen.findByRole('checkbox'));
 expect(action.hasAttribute('disabled')).toBe(false);
 expect(screen.queryByRole('heading',{name:'Booking pending'})).toBeNull();
});
it('discards a failed attempt key so a verified failure can be retried',async()=>{
 const previous=keepPaymentAttempt(order.id,true).key;
 commerce.order.mockResolvedValue({...order,status:'PAYMENT_FAILED',payment:{id:'payment-one',status:'FAILED'}});
 commerce.startPayment.mockRejectedValue(new Error('Test interrupted request'));
 open();
 fireEvent.click(await screen.findByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:/^Pay .*securely/}));
 await waitFor(()=>expect(commerce.startPayment).toHaveBeenCalledOnce());
 expect(commerce.startPayment.mock.calls[0]![1]).not.toBe(previous);
 expect(readPaymentAttempt(order.id)?.uncertain).toBe(true);
});
it('shows airline cancellation instead of reserved when a saved PNR now has HX segments',async()=>{
 commerce.order.mockResolvedValue({...order,status:'PAYMENT_PROCESSING',payment:{id:'payment-one',status:'PENDING'}});
 flights.booking.mockResolvedValue({...booking,providerView:{retrievedAt:new Date().toISOString(),cancellationCheckComplete:true,flights:[{status:'Cancelled'}],travellers:[],tickets:[]}});
 open();
 expect(await screen.findByText('The airline has cancelled one or more flights in this reservation. Contact Flyseri to review your travel options before making a payment.')).toBeTruthy();
 expect(screen.queryByText('Reserved')).toBeNull();
 expect(screen.queryByRole('button',{name:/Continue payment/})).toBeNull();
});
