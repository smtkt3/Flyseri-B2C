import type {AirportDirectoryEntry} from '@flyseri/types';
import {apiClient} from '../lib/api/client';
const suggestions=new Map<string,{expiresAt:number;airports:AirportDirectoryEntry[]}>();
const details=new Map<string,{city:string;name:string}>();
export function cachedAirportSuggestions(query:string){const cached=suggestions.get(query.trim().toLowerCase());return cached&&cached.expiresAt>Date.now()?cached.airports:undefined;}
export async function airportSuggestions(query:string,signal?:AbortSignal){
  const key=query.trim().toLowerCase();const cached=suggestions.get(key);
  if(cached&&cached.expiresAt>Date.now())return cached.airports;
  const airports=(await apiClient.get<AirportDirectoryEntry[]>(`/airports/suggestions?q=${encodeURIComponent(query)}`,{signal,timeoutMs:10000,anonymous:true})).data;
  suggestions.set(key,{expiresAt:Date.now()+3600000,airports});
  while(suggestions.size>100)suggestions.delete(suggestions.keys().next().value!);
  return airports;
}
export async function loadAirportDetails(codes:string[]){
  const unique=[...new Set(codes)].filter(code=>/^[A-Z]{3}$/.test(code));
  const missing=unique.filter(code=>!details.has(code));
  const batches=Array.from({length:Math.ceil(missing.length/60)},(_,index)=>missing.slice(index*60,index*60+60));
  await Promise.all(batches.map(async batch=>{
    const result=(await apiClient.get<Record<string,{city:string;name:string}>>(`/airports/details?codes=${batch.join(',')}`,{timeoutMs:10000,anonymous:true})).data;
    Object.entries(result).forEach(([code,value])=>details.set(code,value));
  }));
  return Object.fromEntries(unique.flatMap(code=>details.has(code)?[[code,details.get(code)!]]:[]));
}
