import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** Portal popovers stay outside transformed/glass cards and inside the keyboard viewport. */
export function useViewportPopover(open: boolean, anchor: RefObject<HTMLElement | null>, options: { width: number; height: number; mobileHeight?: number; mobileSheet?: boolean; align?: 'start' | 'end' }) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const { width: preferredWidth, height: preferredHeight, mobileHeight, mobileSheet, align } = options;
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const viewport = window.visualViewport;
    const update = () => {
      if (!anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const mobile = window.innerWidth <= 650;
      const maxPopoverHeight = mobile ? Math.min(mobileHeight ?? preferredHeight, viewportHeight * .48) : preferredHeight;
      const width = Math.min(mobile ? mobileSheet ? 390 : viewportWidth - 24 : preferredWidth, viewportWidth - 24);
      if (mobile && mobileSheet) {
        setStyle({ position: 'fixed', left: x + (viewportWidth - width) / 2, right: 'auto', top: 'auto', bottom: Math.max(12, window.innerHeight - y - viewportHeight + 12), width, maxHeight: Math.max(80, viewportHeight - 24), visibility: 'visible' });
        return;
      }
      const left = Math.max(x + 12, Math.min(align === 'end' ? rect.right - width : rect.left, x + viewportWidth - width - 12));
      const below = Math.max(0, y + viewportHeight - rect.bottom - 20);
      const above = Math.max(0, rect.top - y - 20);
      const useBelow = below >= Math.min(maxPopoverHeight, 160) || below >= above;
      const height = Math.max(60, Math.min(maxPopoverHeight, useBelow ? below : above, viewportHeight - 24));
      const top = Math.max(y + 12, Math.min(useBelow ? rect.bottom + 8 : rect.top - height - 8, y + viewportHeight - height - 12));
      setStyle({ position: 'fixed', left, right: 'auto', top, bottom: 'auto', width, maxHeight: height, visibility: 'visible' });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [open, anchor, preferredWidth, preferredHeight, mobileHeight, mobileSheet, align]);
  return style;
}
