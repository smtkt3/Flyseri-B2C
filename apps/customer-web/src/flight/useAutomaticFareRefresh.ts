import { useEffect, useRef } from 'react';
import type { FlightBookingIntent } from '@flyseri/types';

/** One automatic attempt per fare window; a failed check needs an explicit retry. */
export function useAutomaticFareRefresh(intent: FlightBookingIntent | null, expired: boolean, enabled: boolean, refresh: (id:string)=>Promise<void>) {
  const attempted = useRef(new Set<string>());
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!intent || !enabled || !expired || !['CREATED','VALIDATED','PRICE_CHANGED','READY_FOR_PAYMENT','EXPIRED'].includes(intent.status)) return;
    const key = `${intent.id}:${intent.expiresAt ?? 'unchecked'}`;
    function check() {
      if (document.visibilityState !== 'visible' || attempted.current.has(key)) return;
      attempted.current.add(key);
      void refreshRef.current(intent!.id);
    }
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [intent?.id, intent?.expiresAt, intent?.status, expired, enabled]);
}
