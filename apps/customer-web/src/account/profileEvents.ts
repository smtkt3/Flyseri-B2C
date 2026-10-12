import type { CustomerProfile } from '@flyseri/types';
export const profileEvent='flyseri:profile';
let latest:{customerId:string;profile:CustomerProfile}|null=null;
export function cachedProfile(customerId:string|undefined){return latest?.customerId===customerId?latest?.profile:null;}
export function publishProfile(customerId:string,profile:CustomerProfile){latest={customerId,profile};window.dispatchEvent(new CustomEvent(profileEvent,{detail:latest}));}
export function clearProfileCache(){latest=null;}
