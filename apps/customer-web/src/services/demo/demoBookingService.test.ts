import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBooking, demoBookingReceipt, readDemoBookings, transitionDemoBooking, updateDemoBooking } from './demoBookingService';
const now=Date.parse('2026-10-10T00:00:00Z');
const input={destination:'KUL',city:'Kuala Lumpur',departure:'2026-11-12',travellers:2,amountPerPerson:22500,currency:'BDT'};
let values: Map<string,string>;
const store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
beforeEach(()=>{values=new Map();});
describe('isolated demo booking lifecycle',()=>{
  it('persists one payment, separate ticket evidence, receipt and refund without personal or payment details',()=>{
    const value=createDemoBooking(input,{store,now});
    expect(value.expiresAt-now).toBe(300000);
    expect(()=>demoBookingReceipt(value)).toThrow();
    const paid=updateDemoBooking(value.id,'PAY_SUCCESS',store,now+1);
    expect(paid.status).toBe('PAID');expect(paid.ticket).toBeUndefined();
    expect(()=>updateDemoBooking(value.id,'PAY_SUCCESS',store,now+2)).toThrow();
    const ticketed=updateDemoBooking(value.id,'ISSUE',store,now+3);
    expect(ticketed.ticket).toContain('DEMO-DOCUMENT');
    expect(demoBookingReceipt(ticketed)).toContain('BDT 45000.00');
    expect(demoBookingReceipt(ticketed)).toContain('NOT PROOF OF PAYMENT');
    expect(()=>updateDemoBooking(value.id,'CANCEL',store,now+4)).toThrow();
    expect(updateDemoBooking(value.id,'REFUND',store,now+5).status).toBe('REFUNDED');
    expect(()=>updateDemoBooking(value.id,'REFUND',store,now+6)).toThrow();
    expect(readDemoBookings(store)).toHaveLength(1);
    expect(readDemoBookings(store)[0]?.paymentAttempts).toBe(1);
  });
  it('allows a declined payment to retry and prevents pending duplicate payment or cancellation',()=>{
    const value=createDemoBooking(input,{store,now});
    expect(updateDemoBooking(value.id,'PAY_FAILURE',store,now+1).status).toBe('PAYMENT_FAILED');
    expect(updateDemoBooking(value.id,'PAY_PENDING',store,now+2).status).toBe('PAYMENT_PENDING');
    expect(()=>updateDemoBooking(value.id,'PAY_SUCCESS',store,now+3)).toThrow();
    expect(()=>updateDemoBooking(value.id,'CANCEL',store,now+3)).toThrow();
    const paid=updateDemoBooking(value.id,'RESOLVE_SUCCESS',store,now+4);
    expect(paid.status).toBe('PAID');expect(paid.paymentAttempts).toBe(2);
    expect(()=>updateDemoBooking(value.id,'RESOLVE_SUCCESS',store,now+5)).toThrow();
  });
  it('blocks expiry at action time even without a rendered countdown, and does not renew on reload',()=>{
    const value=createDemoBooking(input,{store,now});
    expect(updateDemoBooking(value.id,'PAY_SUCCESS',store,now+300000).status).toBe('EXPIRED');
    expect(readDemoBookings(store)[0]?.expiresAt).toBe(now+300000);
    expect(()=>updateDemoBooking(value.id,'ISSUE',store,now+300001)).toThrow();
    expect(()=>createDemoBooking(input,{store,now,expiresAt:now})).toThrow();
  });
  it('records approval after expiry but requires review and blocks ticketing',()=>{
    const value=createDemoBooking(input,{store,now});
    updateDemoBooking(value.id,'PAY_PENDING',store,now+1);
    const late=updateDemoBooking(value.id,'RESOLVE_SUCCESS',store,now+300001);
    expect(late.status).toBe('PAYMENT_REVIEW');expect(late.paidAt).toBe(now+300001);
    expect(()=>updateDemoBooking(value.id,'ISSUE',store,now+300002)).toThrow();
    expect(updateDemoBooking(value.id,'REFUND',store,now+300003).status).toBe('REFUNDED');
  });
  it('keeps cancelled bookings closed and isolates missing or corrupt records',()=>{
    const value=createDemoBooking(input,{store,now});
    const cancelled=updateDemoBooking(value.id,'CANCEL',store,now+1);
    expect(()=>transitionDemoBooking(cancelled,'PAY_SUCCESS',now+2)).toThrow();
    expect(()=>updateDemoBooking('missing','PAY_SUCCESS',store,now+2)).toThrow();
    store.setItem('flyseri.demo-bookings.v1','{"not":"a booking"}');
    expect(()=>readDemoBookings(store)).toThrow();
  });
});
