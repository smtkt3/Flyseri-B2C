import { describe, expect, it } from 'vitest';
import type { FlightOffer } from '@flyseri/types';
import { orderOverview, type OrderOverviewBooking } from './order-overview.js';

const offer: FlightOffer = { offerId:'offer-1',totalAmount:'34997.00',currency:'BDT',airlineCodes:['MH'],baggageSummary:null,inbound:null,cabin:'ECONOMY',
  outbound:{stops:0,durationMinutes:240,segments:[{origin:'DAC',destination:'KUL',departureAt:'2026-12-10T08:00:00+06:00',arrivalAt:'2026-12-10T14:00:00+08:00',marketingCarrier:'MH',flightNumber:'197',durationMinutes:240}]}};
const order = {status:'PENDING_PAYMENT' as const,bookingIntentId:'intent-1',flightServicingCaseId:null,visaApplicationId:null};
const booking: OrderOverviewBooking = {status:'TICKETED',pnr:'ABCDEF',offer,search:{tripType:'ONE_WAY',adults:1},passengerNames:['Test Traveler'],providerView:null};
const items=[{itemType:'FLIGHT',descriptionSnapshot:'Flight DAC to KUL',quantity:1}];
describe('owned order history overview',()=>{
  it('maps saved travel details without exposing a PNR before payment or inferring issuance from status',()=>{
    expect(orderOverview(order,items,booking)).toMatchObject({kind:'FLIGHT',title:'DAC → KUL',travelDate:'2026-12-10',travelerCount:1,airlineCodes:['MH'],cabin:'ECONOMY',ticketIssued:false});
    expect(orderOverview(order,items,booking).reference).toBeUndefined();
  });
  it('requires complete current document evidence and keeps prices outside the presentation mapper',()=>{
    const paid={...order,status:'PAID' as const};
    const verified={...booking,providerView:{tickets:[{number:'2321234567890',status:'Issued',travellerIndex:1}]}};
    expect(orderOverview(paid,items,verified)).toMatchObject({reference:{label:'PNR',value:'ABCDEF'},ticketIssued:true});
    expect(orderOverview(paid,items,{...verified,passengerNames:['One Person','Another Person']})).toMatchObject({travelerCount:2,ticketIssued:false});
    expect(orderOverview(paid,items,verified)).not.toHaveProperty('totalAmount');
  });
  it('does not present the original itinerary as an unpublished flight-change quotation',()=>{
    const summary=orderOverview({...order,bookingIntentId:null,flightServicingCaseId:'case-1'},items,booking);
    expect(summary).toMatchObject({kind:'FLIGHT_EXCHANGE',title:'Flight change'});
    expect(summary.journeys).toBeUndefined();
  });
  it('uses the published exchange itinerary instead of the original flight date',()=>{
    const summary=orderOverview({...order,bookingIntentId:null,flightServicingCaseId:'case-1'},items,booking,undefined,{id:'case-1',bookingId:'booking-1',orderId:'order-1',orderNumber:'SMEX-1',amount:'1000',currency:'BDT',sentAt:null,expiresAt:null,status:'PAYMENT_REQUIRED',flights:[{airline:'BG',number:'433',origin:'DAC',destination:'CXB',departureDate:'2026-12-11',departureTime:'12:00',arrivalDate:'2026-12-11',arrivalTime:'13:00'}]});
    expect(summary).toMatchObject({kind:'FLIGHT_EXCHANGE',title:'DAC → CXB',travelDate:'2026-12-11',airlineCodes:['BG']});
  });
  it('keeps historical orders readable when saved travel detail is incomplete',()=>{
    expect(orderOverview(order,items,{...booking,offer:{},search:{},passengerNames:null})).toMatchObject({kind:'FLIGHT',title:'Flight DAC to KUL'});
    expect(orderOverview({...order,bookingIntentId:null},[{itemType:'VISA_SERVICE',descriptionSnapshot:'Visa service',quantity:1}],undefined,{destinationCountryCode:'MY',travelDate:'2026-12-10',reference:'FVA-123',travelerCount:2})).toMatchObject({kind:'VISA',destinationCountryCode:'MY',travelDate:'2026-12-10',travelerCount:2,reference:{label:'Application',value:'FVA-123'}});
  });
});
