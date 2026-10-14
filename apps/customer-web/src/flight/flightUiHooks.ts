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
    // Exclude background controls from keyboard and assistive-technology navigation.
    const background: { element: HTMLElement; inert: boolean; ariaHidden: string | null }[] = [];
    let branch: HTMLElement = element;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.classList.contains('flight-filter-backdrop')) continue;
        background.push({ element: sibling, inert: sibling.inert, ariaHidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true; sibling.setAttribute('aria-hidden', 'true');
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); element.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown);
      background.forEach(item => { item.element.inert = item.inert; if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden'); else item.element.setAttribute('aria-hidden', item.ariaHidden); });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, panel, dismiss]);
}

export interface FlightFareGroup { key: string; fares: FlightOffer[] }
export function useStableFlightGroups(groups: FlightFareGroup[], signature: string, restoredKeys: string[] = []) {
  const [restoration] = useState(() => ({ signature, groups, keys: restoredKeys }));
  return useMemo(() => {
    const currentKeys = groups.map(group => group.key);
    // Restore the exact browsing position on return. Any new fares or changed
    // criteria immediately use the latest ranking without a manual refresh.
    if (restoration.groups !== groups || restoration.signature !== signature || !restoration.keys.length) {
      return { groups, keys: currentKeys };
    }
    const byKey = new Map(groups.map(group => [group.key, group]));
    const restored = restoration.keys.filter(key => byKey.has(key));
    const restoredSet = new Set(restored);
    const keys = [...restored, ...currentKeys.filter(key => !restoredSet.has(key))];
    return { groups: keys.map(key => byKey.get(key)!), keys };
  }, [groups, signature, restoration]);
}
