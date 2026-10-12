// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { FlightOffer, FlightSearchRequest, FlightSearchResponse } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { useCheckoutShoppingFare } from './useCheckoutShoppingFare';
vi.mock('../services/flightService',()=>({flightService:{search:vi.fn()}}));
afterEach(cleanup);
beforeEach(()=>{vi.mocked(flightService.search).mockReset();});
const offer:FlightOffer={offerId:'original',totalAmount:'200.00',currency:'MYR',airlineCodes:['TR'],baggageSummary:null,outbound:{segments:[],stops:0,durationMinutes:60},inbound:null};
const request:FlightSearchRequest={origin:'KUL',destination:'SIN',departureDate:'2026-11-18',tripType:'ONE_WAY',adults:1,children:0,infants:0,cabin:'ECONOMY',currency:'MYR'};
const response=()=>({searchId:'owned-search',offers:[{...offer,offerId:'owned-offer'}],expiresAt:new Date(Date.now()+60_000).toISOString(),source:'sabre'}) as FlightSearchResponse;

it('automatically checks only after details are ready and reuses the result on Continue',async()=>{
  vi.mocked(flightService.search).mockResolvedValue(response());
  const view=renderHook(({ready})=>useCheckoutShoppingFare(offer,request,'customer',ready,false),{initialProps:{ready:false}});
  expect(flightService.search).not.toHaveBeenCalled();
  view.rerender({ready:true});
  await waitFor(()=>expect(view.result.current.selection?.searchId).toBe('owned-search'));
  await act(async()=>{await view.result.current.ensure();await view.result.current.ensure();});
  expect(flightService.search).toHaveBeenCalledTimes(1);
});

it('shares an in-flight check instead of sending duplicate searches',async()=>{
  let finish!:(value:FlightSearchResponse)=>void;
  vi.mocked(flightService.search).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const view=renderHook(()=>useCheckoutShoppingFare(offer,request,'customer',false,false));
  let first!:Promise<unknown>,second!:Promise<unknown>;
  act(()=>{first=view.result.current.ensure();second=view.result.current.ensure();});
  expect(flightService.search).toHaveBeenCalledTimes(1);
  await act(async()=>{finish(response());await Promise.all([first,second]);});
  expect(view.result.current.checking).toBe(false);
});

it('accepts duplicate matching fare rows instead of claiming the fare is unavailable',async()=>{
  const result=response();result.offers.push({...result.offers[0]!,offerId:'duplicate'});
  vi.mocked(flightService.search).mockResolvedValue(result);
  const view=renderHook(()=>useCheckoutShoppingFare(offer,request,'customer',false,false));
  await act(async()=>{await view.result.current.ensure();});
  expect(view.result.current.selection?.replacement).toBe(false);
  expect(view.result.current.error).toBe('');
});

it('offers the nearest returned fare on the same flights when the selected class disappears',async()=>{
  const segment={origin:'DAC',destination:'CXB',departureAt:'2026-10-24T08:00:00+06:00',arrivalAt:'2026-10-24T09:15:00+06:00',marketingCarrier:'BG',flightNumber:'435',durationMinutes:75,bookingClass:'Q'};
  const original:FlightOffer={...offer,currency:'BDT',cabin:'ECONOMY',outbound:{...offer.outbound,segments:[segment]}};
  const alternative:FlightOffer={...original,offerId:'alternative',totalAmount:'260.00',outbound:{...original.outbound,segments:[{...segment,bookingClass:'Y'}]}};
  vi.mocked(flightService.search).mockResolvedValue({...response(),offers:[alternative]});
  const view=renderHook(()=>useCheckoutShoppingFare(original,request,'customer',false,false));
  await act(async()=>{await view.result.current.ensure();});
  expect(view.result.current.selection).toMatchObject({replacement:true,offer:{offerId:'alternative',totalAmount:'260.00'}});
});

it('does not silently substitute another flight and allows an explicit price recheck',async()=>{
  vi.mocked(flightService.search).mockResolvedValueOnce(response()).mockResolvedValueOnce({...response(),offers:[{...offer,cabin:'BUSINESS'}]});
  const view=renderHook(()=>useCheckoutShoppingFare(offer,request,'customer',false,false));
  await act(async()=>{await view.result.current.ensure();});
  await act(async()=>{await expect(view.result.current.ensure(true)).rejects.toThrow('latest search did not return');});
  expect(flightService.search).toHaveBeenCalledTimes(2);
  expect(view.result.current.selection).toBeNull();
});

it('stops automatic retries after an error and allows Continue to retry',async()=>{
  vi.mocked(flightService.search).mockRejectedValueOnce(new Error('Search unavailable'));
  const view=renderHook(({ready})=>useCheckoutShoppingFare(offer,request,'customer',ready,false),{initialProps:{ready:true}});
  await waitFor(()=>expect(view.result.current.error).toBe('Search unavailable'));
  view.rerender({ready:false});view.rerender({ready:true});
  expect(flightService.search).toHaveBeenCalledTimes(1);
  vi.mocked(flightService.search).mockResolvedValueOnce(response());
  await act(async()=>{await view.result.current.ensure();});
  expect(view.result.current.selection?.searchId).toBe('owned-search');
  expect(flightService.search).toHaveBeenCalledTimes(2);
});
