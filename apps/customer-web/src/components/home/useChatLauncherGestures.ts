import { useEffect, useRef, type PointerEvent } from 'react';
import type { useAircraftLaunch } from './useAircraftLaunch';
import type { useDraggableChatLauncher } from './useDraggableChatLauncher';

// An immediate drag moves help; a deliberate hold keeps the original pull-to-fly gesture.
export function useChatLauncherGestures(
  movable: ReturnType<typeof useDraggableChatLauncher>['handlers'],
  aircraft: ReturnType<typeof useAircraftLaunch>['handlers'],
  disabled: boolean,
) {
  const mode = useRef<'pending' | 'armed' | 'drag' | 'flight'>('pending');
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => { if (disabled) { clear(); start.current = null; } return clear; }, [disabled]);
  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (disabled || !event.isPrimary || event.button !== 0) return;
      clear(); mode.current = 'pending';
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      movable.onPointerDown(event); aircraft.onPointerDown(event);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!start.current || mode.current !== 'pending') return;
        mode.current = 'armed';
      }, 400);
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      if (!start.current || start.current.id !== event.pointerId) return;
      const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y;
      if ((mode.current === 'pending' || mode.current === 'armed') && Math.hypot(dx, dy) >= 6) {
        clear();
        if (mode.current === 'armed' && dy >= 6 && dy > Math.abs(dx) * 1.3) {
          mode.current = 'flight'; movable.onPointerCancel();
        } else { mode.current = 'drag'; aircraft.onPointerCancel(); }
      }
      if (mode.current === 'flight') aircraft.onPointerMove(event);
      else if (mode.current === 'drag') movable.onPointerMove(event);
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      if (!start.current || start.current.id !== event.pointerId) return;
      clear(); start.current = null;
      if (mode.current === 'flight') aircraft.onPointerUp(event);
      else { movable.onPointerUp(event); aircraft.onPointerCancel(); }
    },
    onPointerCancel() { clear(); start.current = null; movable.onPointerCancel(); aircraft.onPointerCancel(); },
    onLostPointerCapture() {
      if (!start.current) return;
      clear(); start.current = null; movable.onLostPointerCapture(); aircraft.onLostPointerCapture();
    },
    onClick(event: import('react').MouseEvent<HTMLButtonElement>) {
      if (mode.current === 'flight') aircraft.onClick(event); else movable.onClick(event);
    },
    onKeyDown(event: import('react').KeyboardEvent<HTMLButtonElement>) {
      if (event.altKey && event.key === 'ArrowDown') aircraft.onKeyDown(event);
      else movable.onKeyDown(event);
    },
  };
}
