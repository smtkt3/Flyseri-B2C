import { describe, expect, it } from 'vitest';
import type { FlightBookingProviderView } from '@flyseri/types';
import { contactChange, contactModificationComplete, contactModificationRequest, prepareContactPlan, readContactContext } from './flight-contact-modification.contract.js';

function fixture(){
  const view:FlightBookingProviderView={retrievedAt:new Date().toISOString(),cancellationCheckComplete:true,travellers:[{givenName:'Test',surname:'Traveler'}],tickets:[],flights:[{origin:'KUL',destination:'PEN',airlineCode:'MH',flightNumber:'1148',departureDate:'2027-02-18',departureTime:'09:00',arrivalDate:'2027-02-18',arrivalTime:'10:00',status:'Confirmed'}]};
  const data={bookingSignature:'supplier-state-1',travelers:[{givenName:'Test',surname:'Traveler',emails:['old@example.com'],phones:[{number:'+12025550100',label:'M'}],identityDocuments:[{documentNumber:'DO-NOT-COPY'}]}],flights:[{sourceType:'ATPCO'}],allSegments:[{type:'FLIGHT'}]};
  return {data,view,context:readContactContext(data,{bookingId:'TEST01',view})};
}
describe('staff contact modification boundaries',()=>{
  it('accepts contact fields only and never copies identity documents or financial fields into Modify Booking',()=>{
    const {context}=fixture();
    const change=contactChange({travelerIndex:0,email:'new@example.com',phone:'+60123456789'});
    const plan=prepareContactPlan(context,change,'AWAITING_STAFF_TICKETING');
    const request=contactModificationRequest('TEST01',context,plan);
    expect(request).toMatchObject({bookingSignature:'supplier-state-1',before:{travelers:[{emails:['old@example.com']}]},after:{travelers:[{givenName:'Test',surname:'Traveler',emails:['new@example.com'],phones:[{number:'+60123456789',label:'M'}]}]}});
    expect(JSON.stringify(request)).not.toContain('DO-NOT-COPY');
    expect(()=>contactChange({...change,surname:'Replacement'})).toThrow();
    expect(()=>contactChange({...change,phone:'0123456789'})).toThrow();
  });
  it('rejects a changed supplier signature or itinerary before submission',()=>{
    const {context}=fixture(),change=contactChange({travelerIndex:0,email:'new@example.com',phone:'+60123456789'});
    const plan=prepareContactPlan(context,change,'TICKETED');
    expect(()=>contactModificationRequest('TEST01',{...context,signature:'new-state'},plan)).toThrow();
    expect(()=>contactModificationRequest('TEST01',{...context,view:{...context.view,flights:[]}},plan)).toThrow();
    expect(()=>contactModificationRequest('TEST01',context,{...plan,expiresAt:'2020-01-01T00:00:00Z'})).toThrow();
  });
  it('requires the exact new contact and unchanged flight/ticket evidence for completion',()=>{
    const {data,view,context}=fixture(),change=contactChange({travelerIndex:0,email:'new@example.com',phone:'+60123456789'});
    const plan=prepareContactPlan(context,change,'TICKETED');
    const updated=readContactContext({...data,bookingSignature:'after-state',travelers:[{...data.travelers[0],emails:[change.email],phones:[{number:'+60 12 345 6789',label:'M'}]}]},{bookingId:'TEST01',view});
    expect(contactModificationComplete(context,plan)).toBe(false);
    expect(contactModificationComplete(updated,plan)).toBe(true);
    expect(contactModificationComplete({...updated,view:{...view,flights:[{...view.flights[0]!,departureTime:'11:00'}]}},plan)).toBe(false);
    expect(contactModificationComplete({...updated,bookingId:'OTHER1'},plan)).toBe(false);
  });
  it('rejects mixed content, extra services and ambiguous passenger identities',()=>{
    const {data,view}=fixture();
    for(const patch of [{flights:[{sourceType:'NDC'}]},{allSegments:[{type:'HOTEL'}]},{ancillaries:[{id:'service'}]},{travelers:[data.travelers[0],data.travelers[0]]}])expect(()=>readContactContext({...data,...patch},{bookingId:'TEST01',view})).toThrow();
  });
});
