import type {FlightReservationInput} from '@flyseri/types';
// Session memory only: passport values never enter router history or browser storage.
const drafts=new Map<string,{userId:string;expiresAt:number;passports:NonNullable<FlightReservationInput['passports']>}>();
export function keepCheckoutPassports(intentId:string,userId:string,passports:NonNullable<FlightReservationInput['passports']>){
 for(const [id,draft] of drafts)if(draft.expiresAt<=Date.now()||draft.userId!==userId)drafts.delete(id);
 if(drafts.size>=20)drafts.delete(drafts.keys().next().value!);
 drafts.set(intentId,{userId,expiresAt:Date.now()+30*60_000,passports});
}
export function checkoutPassports(intentId:string,userId:string){const draft=drafts.get(intentId);if(!draft||draft.userId!==userId||draft.expiresAt<=Date.now()){drafts.delete(intentId);return [];}return draft.passports;}
export function clearCheckoutPassports(intentId:string){drafts.delete(intentId);}
export function hasCheckoutPassportDraft(intentId:string,userId:string){
 const draft=drafts.get(intentId);
 return !!draft&&draft.userId===userId&&draft.expiresAt>Date.now();
}
