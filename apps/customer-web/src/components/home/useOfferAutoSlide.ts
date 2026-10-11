import { useEffect, type RefObject } from 'react';

/** Auto-advance only while visible and idle; manual browsing gets a two-second rest. */
export function useOfferAutoSlide(viewportRef: RefObject<HTMLDivElement | null>, detailsOpen: boolean) {
  useEffect(() => {
    const viewport = viewportRef.current;
    const section = viewport?.closest<HTMLElement>('.premium-inspiration');
    if (!viewport || !section || detailsOpen) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = typeof IntersectionObserver === 'undefined';
    let hovering = false;
    let touching = false;
    let focused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay = 4000) => {
      clearTimeout(timer);
      if (media.matches || document.hidden || !visible || hovering || touching || focused) return;
      timer = setTimeout(() => {
        const card = viewport.querySelector<HTMLElement>('.journey-card');
        if (!card || viewport.scrollWidth <= viewport.clientWidth + 8) { schedule(); return; }
        const gap = parseFloat(getComputedStyle(viewport.querySelector('.journey-track')!).columnGap) || 0;
        const end = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 8;
        viewport.scrollTo({ left: end ? 0 : viewport.scrollLeft + card.getBoundingClientRect().width + gap, behavior: 'smooth' });
        schedule();
      }, delay);
    };
    const enter = (event: PointerEvent) => { if (event.pointerType === 'mouse') { hovering = true; schedule(); } };
    const leave = (event: PointerEvent) => { if (event.pointerType === 'mouse') { hovering = false; schedule(2000); } };
    const down = () => { touching = true; schedule(); };
    const up = () => { touching = false; schedule(2000); };
    const focus = (event: FocusEvent) => { focused = (event.target as HTMLElement).matches(':focus-visible'); schedule(2000); };
    const blur = (event: FocusEvent) => { if (!section.contains(event.relatedTarget as Node | null)) { focused = false; schedule(2000); } };
    const manual = () => schedule(2000);
    const visibility = () => schedule();
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; schedule(); }, { threshold: 0.2 });
    observer?.observe(section);
    section.addEventListener('pointerenter', enter);
    section.addEventListener('pointerleave', leave);
    section.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    section.addEventListener('focusin', focus);
    section.addEventListener('focusout', blur);
    section.addEventListener('click', manual);
    section.addEventListener('keydown', manual);
    viewport.addEventListener('wheel', manual, { passive: true });
    media.addEventListener('change', visibility);
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => {
      clearTimeout(timer); observer?.disconnect();
      section.removeEventListener('pointerenter', enter);
      section.removeEventListener('pointerleave', leave);
      section.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      section.removeEventListener('focusin', focus);
      section.removeEventListener('focusout', blur);
      section.removeEventListener('click', manual);
      section.removeEventListener('keydown', manual);
      viewport.removeEventListener('wheel', manual);
      media.removeEventListener('change', visibility);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [viewportRef, detailsOpen]);
}
