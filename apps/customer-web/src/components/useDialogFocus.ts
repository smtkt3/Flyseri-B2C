import { useEffect, type RefObject } from 'react';

/** Keep keyboard interaction inside an open sheet and return to its trigger. */
export function useDialogFocus(open: boolean, dialog: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open || !dialog.current) return;
    const panel = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]')).filter(element => !element.hidden && !element.closest('[hidden],[inert]') && (!element.closest('details:not([open])') || element.matches('summary')));
    (controls()[0] ?? panel).focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0] ?? panel, last = items.at(-1) ?? panel;
      if (!items.length || !panel.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open, dialog, close]);
}
