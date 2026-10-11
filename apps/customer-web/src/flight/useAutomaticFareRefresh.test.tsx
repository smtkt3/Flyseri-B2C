// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,renderHook} from '@testing-library/react';
import type {FlightBookingIntent} from '@flyseri/types';
import {useAutomaticFareRefresh} from './useAutomaticFareRefresh';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const intent=(expiresAt='2026-10-10T00:00:00Z',status='READY_FOR_PAYMENT')=>({id:'intent',expiresAt,status} as FlightBookingIntent);
it('checks once per expired fare window, without looping after failure',()=>{
 const refresh=vi.fn(async()=>{});
 const {rerender}=renderHook(({value,expired,enabled})=>useAutomaticFareRefresh(value,expired,enabled,refresh),{initialProps:{value:intent(),expired:true,enabled:true}});
 expect(refresh).toHaveBeenCalledTimes(1);
 rerender({value:intent(),expired:true,enabled:false});rerender({value:intent(),expired:true,enabled:true});
 expect(refresh).toHaveBeenCalledTimes(1);
 rerender({value:intent('2026-10-10T00:10:00Z'),expired:false,enabled:true});
 expect(refresh).toHaveBeenCalledTimes(1);
 rerender({value:intent('2026-10-10T00:10:00Z'),expired:true,enabled:true});
 expect(refresh).toHaveBeenCalledTimes(2);
});
it('waits for a visible tab and never refreshes cancelled selections',()=>{
 const refresh=vi.fn(async()=>{});const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
 const {rerender}=renderHook(({value})=>useAutomaticFareRefresh(value,true,true,refresh),{initialProps:{value:intent()}});
 expect(refresh).not.toHaveBeenCalled();visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));
 expect(refresh).toHaveBeenCalledTimes(1);
 rerender({value:intent('2026-10-10T00:20:00Z','CANCELLED')});
 expect(refresh).toHaveBeenCalledTimes(1);
});
