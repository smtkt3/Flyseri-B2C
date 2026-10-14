import { useEffect, useRef } from 'react';
import type { FlightBooking } from '@flyseri/types';
import { flightService } from '../services/flightService';
import { bookingHasIssuedTickets } from './bookingPresentation';

/** Read saved evidence only; polling never submits a reservation or issues a ticket. */
export function useBookingEvidencePoll(booking: FlightBooking | null, enabled: boolean, onChange: (booking: FlightBooking) => void) {
  const update = useRef(onChange); update.current = onChange;
  const currentId = useRef(booking?.id); currentId.current = booking?.id;
  const allowed = useRef(enabled); allowed.current = enabled;
  const issued = booking ? bookingHasIssuedTickets(booking) : false;
  useEffect(() => {
    if (!enabled || !booking || issued || !['BOOKING_IN_PROGRESS','TICKETING_IN_PROGRESS','AWAITING_STAFF_TICKETING','PAID'].includes(booking.status)) return;
    const id = booking.id;
    let active = true, running = false, ticks = 0;
    const poll = () => {
      if (!active || running || document.visibilityState !== 'visible') return;
      running = true;
      void flightService.booking(id).then(value => { if (active && allowed.current && currentId.current === id && value.id === id) update.current(value); }, () => undefined).finally(() => { running = false; });
    };
    // Back off after three minutes, and resume promptly when the customer returns.
    const timer = window.setInterval(() => { ticks++; if (ticks <= 12 || ticks % 4 === 0) poll(); }, 15_000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    return () => {
      active = false; window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', poll);
    };
  }, [booking?.id,booking?.status,enabled,issued]);
}
