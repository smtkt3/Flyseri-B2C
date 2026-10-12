import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlightOffer, FlightSearchRequest } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { closestCheckoutFare, sameCheckoutFare } from './checkoutContinuation';

interface ShoppingSelection { searchId:string; offer:FlightOffer; expiresAt:string; customerId:string; replacement:boolean }
export function useCheckoutShoppingFare(offer:FlightOffer, request:FlightSearchRequest, customerId:string|null, ready:boolean, disabled:boolean) {
  const [selection,setSelection]=useState<ShoppingSelection|null>(null);
  const [checking,setChecking]=useState(false);
  const [error,setError]=useState('');
  const owner=useRef(customerId);
  owner.current=customerId;
  const selected=useRef(selection);
  const pending=useRef<{customerId:string;promise:Promise<ShoppingSelection>;token:symbol}|null>(null);
  const clear=useCallback(()=>{selected.current=null;setSelection(null);setError('');},[]);
  useEffect(()=>{clear();setChecking(false);},[customerId,clear]);

  const ensure=useCallback(async(force=false)=>{
    if(!customerId)throw new Error('Sign in to continue.');
    if(!force&&selected.current?.customerId===customerId&&Date.parse(selected.current.expiresAt)>Date.now())return selected.current;
    if(pending.current?.customerId===customerId)return pending.current.promise;
    setChecking(true);setError('');
    const token=Symbol();
    const promise=(async()=>{
      try{
        // An owned search is required before creating this account's booking intent.
        const result=await flightService.search(request);
        const match=closestCheckoutFare(offer,result.offers);
        if(!match)throw new Error('The latest search did not return a fare for this flight. Recheck the price or choose another flight below. Your traveler details are kept in this tab.');
        if(owner.current!==customerId)throw new Error('Your account changed. Please continue again.');
        const next={searchId:result.searchId,offer:match,expiresAt:result.expiresAt,customerId,replacement:!sameCheckoutFare(offer,match)};
        selected.current=next;setSelection(next);return next;
      }catch(cause){
        if(owner.current===customerId){selected.current=null;setSelection(null);setError(cause instanceof Error?cause.message:'We could not check the fare. Continue to try again.');}
        throw cause;
      }finally{
        if(pending.current?.token===token){pending.current=null;if(owner.current===customerId)setChecking(false);}
      }
    })();
    pending.current={customerId,promise,token};
    return promise;
  },[customerId,offer,request]);

  useEffect(()=>{
    if(!customerId||!ready||disabled||checking||error||selection&&selection.customerId===customerId&&Date.parse(selection.expiresAt)>Date.now())return;
    const timer=window.setTimeout(()=>{void ensure().catch(()=>undefined);},600);
    return()=>window.clearTimeout(timer);
  },[customerId,ready,disabled,checking,error,selection,ensure]);
  return {selection,checking,error,ensure,clear};
}
