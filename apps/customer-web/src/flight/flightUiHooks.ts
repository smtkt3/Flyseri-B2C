import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FlightOffer } from '@flyseri/types';

export function useCurrentCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}

export function useFlightDialog(open: boolean, panel: RefObject<HTMLElement | null>, close: () => void) {
  const dismiss = useCurrentCallback(close);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const element = panel.current;
    const focusable = () => [...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]')].filter(item => item.getClientRects().length);
    (focusable()[0] ?? element).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); element.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, panel, dismiss]);
}

export interface FlightFareGroup { key: string; fares: FlightOffer[] }
export function useStableFlightGroups(groups: FlightFareGroup[], signature: string, restoredKeys: string[] = []) {
  const [order, setOrder] = useState<{ signature: string; keys: string[] }>(() => ({ signature, keys: restoredKeys.length ? restoredKeys : groups.map(group => group.key) }));
  const currentKeys = groups.map(group => group.key);
  const currentSet = new Set(currentKeys);
  const oldKeys = order.signature === signature ? order.keys.filter(key => currentSet.has(key)) : [];
  const oldSet = new Set(oldKeys);
  const nextKeys = [...oldKeys, ...currentKeys.filter(key => !oldSet.has(key))];
  if (order.signature !== signature || order.keys.length !== nextKeys.length || order.keys.some((key, index) => key !== nextKeys[index])) setOrder({ signature, keys: nextKeys });
  const ordered = useMemo(() => {
    const byKey = new Map(groups.map(group => [group.key, group]));
    return nextKeys.map(key => byKey.get(key)!);
  // The stored keys change only for a new group, removal, or intentional reorder.
  }, [groups, order]);
  return { groups: ordered, keys: nextKeys, rankingChanged: nextKeys.some((key, index) => key !== currentKeys[index]) };
}
