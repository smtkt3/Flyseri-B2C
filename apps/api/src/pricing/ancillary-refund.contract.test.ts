import {describe,it,expect} from 'vitest';
import {extraDocument,extraRefundTotal} from './ancillary-refund.contract.js';
import type {StoredAncillaryPurchase} from '../flight/ancillary-purchase.contract.js';
const item:StoredAncillaryPurchase['items'][number]={requestId:'one',name:'Bag',segmentLabels:['DAC → CXB'],passengerIndexes:[0],airlineAmount:'10',airlineCurrency:'MYR',checkoutSupplierAmount:'300',serviceCharge:'30',checkoutAmount:'330',chargeRefundable:true,providerAncillaryIds:['2']};
const booking=()=>({travelers:[{ancillaries:[{itemId:'2',commercialName:'Bag',electronicMiscellaneousDocumentNumber:'9971234567890',isRefundable:true}]}],documents:[{number:'9971234567890',ticketingPcc:'TEST',travelerIndex:1,payment:{total:'10',currencyCode:'MYR'},ticketStatusName:'Issued',allCoupons:[{couponStatus:'Okay'}]}]});
describe('extra refund scope',()=>{
 it('uses the original frozen conversion for a partial refund and returns the matching charge',()=>{
  expect(extraRefundTotal(item,'5','MYR')).toEqual({supplierRefund:'5',airlineRefund:'150.00',chargeRefund:'15.00',customerRefund:'165.00'});
  expect(()=>extraRefundTotal(item,'11','MYR')).toThrow();expect(()=>extraRefundTotal(item,'5','BDT')).toThrow();
 });
 it('requires exact document, traveler, issuing PCC and original amount',()=>{
  expect(extraDocument(booking(),item,'TEST')).toBe('9971234567890');
  const wrong=booking();wrong.documents[0]!.travelerIndex=2;expect(()=>extraDocument(wrong,item,'TEST')).toThrow();
  expect(()=>extraDocument(booking(),item,'DIFF')).toThrow();const price=booking();price.documents[0]!.payment.total='11';expect(()=>extraDocument(price,item,'TEST')).toThrow();
  const missing=booking();missing.travelers[0]!.ancillaries[0]!.electronicMiscellaneousDocumentNumber='';expect(()=>extraDocument(missing,item,'TEST','issued')).toThrow('do not repeat issuance');
  const unused=booking();Object.assign(unused.documents[0]!.allCoupons[0]!,{couponStatus:'Not Flown',couponStatusCode:'I'});expect(extraDocument(unused,item,'TEST','issued')).toBe('9971234567890');
  Object.assign(unused.documents[0]!.allCoupons[0]!,{couponStatusCode:'F'});expect(()=>extraDocument(unused,item,'TEST','issued')).toThrow();
 });
 it('never treats an issued, used or merely cancelled document as a verified refund',()=>{
  expect(()=>extraDocument(booking(),item,'TEST',true)).toThrow();
  const refunded=booking();refunded.documents[0]!.ticketStatusName='Refunded/Exchanged';refunded.documents[0]!.allCoupons[0]!.couponStatus='Refunded';expect(extraDocument(refunded,item,'TEST',true)).toBe('9971234567890');
  refunded.documents[0]!.allCoupons[0]!.couponStatus='Used';expect(()=>extraDocument(refunded,item,'TEST',true)).toThrow();
 });
});
