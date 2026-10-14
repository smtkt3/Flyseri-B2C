import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';

const storageKey = 'flyseri.chat-launcher-position.v1';
type Point = { x: number; y: number };
type Gesture = { id: number; start: Point; origin: Point; previous: Point | null; moved: boolean };

export function useDraggableChatLauncher(button: RefObject<HTMLButtonElement | null>, open: () => void, disabled: boolean) {
  const saved = useRef<Point | null | undefined>(undefined);
  if (saved.current === undefined) {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      saved.current = value && Number.isFinite(value.x) && Number.isFinite(value.y)
        ? { x: Math.max(0, Math.min(1, value.x)), y: Math.max(0, Math.min(1, value.y)) } : null;
    } catch { saved.current = null; }
  }
  const [position, setPosition] = useState<Point | null>(null);
  const [hasMoved, setHasMoved] = useState(!!saved.current);
  const [dragging, setDragging] = useState(false);
  const currentPosition = useRef<Point | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  function bounds() {
    const element = button.current!;
    const viewport = window.visualViewport;
    const style = getComputedStyle(element);
    const left = (viewport?.offsetLeft ?? 0) + 12;
    const top = (viewport?.offsetTop ?? 0) + Math.max(12, parseFloat(style.getPropertyValue('--seri-safe-top')) || 0);
    const right = left + (viewport?.width ?? window.innerWidth) - 24;
    let bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - Math.max(12, parseFloat(style.getPropertyValue('--seri-safe-bottom')) || 0);
    // Keep help accessible without covering fixed checkout or account navigation.
    document.querySelectorAll<HTMLElement>('.checkout-mobile-bar,.account-mobile-bottom').forEach(dock => {
      const box = dock.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.top > top && getComputedStyle(dock).position === 'fixed') bottom = Math.min(bottom, box.top - 12);
    });
    return { left, top, right: Math.max(left, right - element.offsetWidth), bottom: Math.max(top, bottom - element.offsetHeight) };
  }
  function move(point: Point) {
    const box = bounds();
    const next = { x: Math.max(box.left, Math.min(box.right, point.x)), y: Math.max(box.top, Math.min(box.bottom, point.y)) };
    currentPosition.current = next;
    setPosition(previous => previous?.x === next.x && previous?.y === next.y ? previous : next);
    return next;
  }
  function remember(point: Point) {
    const box = bounds();
    saved.current = { x: (point.x - box.left) / (box.right - box.left || 1), y: (point.y - box.top) / (box.bottom - box.top || 1) };
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved.current)); } catch { /* Moving remains available when storage is blocked. */ }
  }
  function cancel() {
    const active = gesture.current;
    gesture.current = null;
    if (active?.moved) {
      suppressClick.current = true;
      currentPosition.current = active.previous;
      setPosition(active.previous);
    }
    setDragging(false);
  }
  useLayoutEffect(() => {
    if (disabled) { cancel(); return; }
    let frame = 0;
    const fit = () => {
      frame = 0;
      if (!button.current?.offsetWidth || gesture.current) return;
      const box = bounds();
      if (saved.current) move({ x: box.left + saved.current.x * (box.right - box.left), y: box.top + saved.current.y * (box.bottom - box.top) });
      else {
        const rect = button.current.getBoundingClientRect();
        move(currentPosition.current ?? { x: rect.left, y: rect.top });
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const observe = () => {
      sizes?.disconnect();
      if (button.current) sizes?.observe(button.current);
      document.querySelectorAll('.checkout-mobile-bar,.account-mobile-bottom').forEach(dock => sizes?.observe(dock));
      schedule();
    };
    const changes = new MutationObserver(observe);
    changes.observe(document.body, { childList: true, subtree: true });
    observe();
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); changes.disconnect(); sizes?.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [disabled, button]);

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    if (active.moved && currentPosition.current) remember(currentPosition.current);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return {
    position, dragging, hasMoved,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        suppressClick.current = false;
        gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, previous: currentPosition.current, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const active = gesture.current;
        if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
        if (!active.moved && Math.hypot(dx, dy) < 6) return;
        if (!active.moved) {
          const width = event.currentTarget.offsetWidth;
          active.moved = true;
          flushSync(() => { setDragging(true); setHasMoved(true); });
          // Keep the airplane under the pointer when its invitation compacts.
          active.origin.x += width - event.currentTarget.offsetWidth;
        }
        suppressClick.current = true;
        move({ x: active.origin.x + dx, y: active.origin.y + dy });
      },
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture() { if (gesture.current) cancel(); },
      onClick(event: import('react').MouseEvent<HTMLButtonElement>) {
        if (disabled) return;
        if (suppressClick.current && event.detail !== 0) { event.preventDefault(); return; }
        open();
      },
      onKeyDown(event: import('react').KeyboardEvent<HTMLButtonElement>) {
        if (disabled) return;
        if (event.key === 'Escape' && gesture.current) { cancel(); return; }
        const offsets: Record<string, Point> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        setHasMoved(true);
        const rect = event.currentTarget.getBoundingClientRect();
        remember(move({ x: rect.left + offset.x, y: rect.top + offset.y }));
      },
    },
  };
}
