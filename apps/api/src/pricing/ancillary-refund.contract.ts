import type {StoredAncillaryPurchase} from '../flight/ancillary-purchase.contract.js';
import {priceAmount,priceMinor} from './flight-pricing.contract.js';
import {verifiedAncillaryPricing} from './ancillary-pricing.contract.js';
export function extraRefundTotal(item:StoredAncillaryPurchase['items'][number],supplierRefund:string,currency:string){
 const original=priceMinor(item.airlineAmount),refund=priceMinor(supplierRefund);
 if(currency!==item.airlineCurrency||refund>original)throw Error('Extra refund currency or amount exceeds the original supplier price.');
 verifiedAncillaryPricing(item.ancillaryPricing);
 const checkoutSupplier=priceMinor(item.checkoutSupplierAmount??item.checkoutAmount),charge=priceMinor(item.serviceCharge??'0');
 if(checkoutSupplier+charge!==priceMinor(item.checkoutAmount))throw Error('The original extra payment breakdown needs review.');
 const airline=original===0n?0n:(checkoutSupplier*refund+original/2n)/original;
 const fee=item.chargeRefundable!==false&&original>0n?(charge*refund+original/2n)/original:0n;
 return {supplierRefund,airlineRefund:priceAmount(airline),chargeRefund:priceAmount(fee),customerRefund:priceAmount(airline+fee)};
}
export function extraDocument(booking:{travelers:Record<string,unknown>[];documents:Record<string,unknown>[]},item:StoredAncillaryPurchase['items'][number],pcc:string,refunded:boolean|'issued'=false){
 if(item.passengerIndexes.length!==1||item.providerAncillaryIds.length!==1)throw Error('Only one uniquely associated extra document can be refunded at a time.');
 const traveler=item.passengerIndexes[0]!,entries=booking.travelers[traveler]?.ancillaries;
 if(!Array.isArray(entries))throw Error('Extra-service associations are missing.');
 const matching=entries.filter(entry=>String(entry?.itemId)===item.providerAncillaryIds[0]&&entry.commercialName===item.name);
 if(matching.length!==1)throw Error('The purchased extra could not be uniquely identified.');
 const entry=matching[0],document=entry.electronicMiscellaneousDocumentNumber;
 if(typeof document!=='string'||!/^\d{13}$/.test(document))throw Error('The airline has not returned a valid extra-service document. Check existing documents; do not repeat issuance.');
 if(refunded===false&&entry.isRefundable!==true)throw Error('This extra is not verified as refundable by the airline.');
 const docs=booking.documents.filter(doc=>doc.number===document),doc=docs[0];
 if(docs.length!==1||doc!.ticketingPcc!==pcc||doc!.travelerIndex!==traveler+1)throw Error('Extra document ownership or issuing agency differs.');
 const payment=doc!.payment as {total?:unknown;currencyCode?:unknown};
 if(payment?.currencyCode!==item.airlineCurrency||typeof payment.total!=='string'||priceMinor(payment.total)!==priceMinor(item.airlineAmount))throw Error('Extra document cost differs from the purchased service.');
 const coupons=doc!.allCoupons??doc!.flightCoupons;
 if(refunded===true){if(doc!.ticketStatusName!=='Refunded/Exchanged'||!Array.isArray(coupons)||!coupons.length||coupons.some(coupon=>coupon.couponStatus!=='Refunded'))throw Error('The airline extra refund is not independently verified.');}
 else if(doc!.ticketStatusName!=='Issued'||!Array.isArray(coupons)||!coupons.length||coupons.some(coupon=>coupon.couponStatus!=='Okay'&&!(coupon.couponStatus==='Not Flown'&&coupon.couponStatusCode==='I')))throw Error('The extra document is used, changed or needs specialist review.');
 return document;
}
