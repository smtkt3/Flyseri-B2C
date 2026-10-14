import { useLayoutEffect } from 'react';

/** Reserve only the space occupied by fixed controls, even when labels wrap. */
export function FixedActionInsets() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let dock: HTMLElement | null = null;
    let navigation: HTMLElement | null = null;
    let dockHeight = 0;
    const previousDock = root.style.getPropertyValue('--checkout-action-height');
    const previousNavigation = root.style.getPropertyValue('--bottom-navigation-height');
    const previousKeyboardInset = root.style.getPropertyValue('--checkout-keyboard-inset');
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    function update() {
      frame = 0;
      const nextDock = document.querySelector<HTMLElement>('.checkout-mobile-bar');
      const nextNavigation = document.querySelector<HTMLElement>('.account-mobile-bottom');
      if (nextDock !== dock) {
        if (dock) resize?.unobserve(dock);
        dock = nextDock;
        if (dock) resize?.observe(dock);
      }
      if (nextNavigation !== navigation) {
        if (navigation) resize?.unobserve(navigation);
        navigation = nextNavigation;
        if (navigation) resize?.observe(navigation);
      }
      const measuredDock = dock?.getBoundingClientRect().height ?? 0;
      // Keep the inset steady during transient layout measurements.
      dockHeight = !dock ? 0 : measuredDock > 0 ? Math.ceil(measuredDock) : dockHeight;
      const navigationHeight = Math.ceil(navigation?.getBoundingClientRect().height ?? 0);
      root.style.setProperty('--checkout-action-height', `${dockHeight}px`);
      root.style.setProperty('--bottom-navigation-height', `${navigationHeight}px`);
      const viewport = window.visualViewport;
      const editing = document.activeElement?.matches('input,textarea,[contenteditable="true"]');
      const keyboardInset = dock && editing && viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      root.style.setProperty('--checkout-keyboard-inset', `${Math.ceil(keyboardInset)}px`);
    }
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      if (previousDock) root.style.setProperty('--checkout-action-height', previousDock);
      else root.style.removeProperty('--checkout-action-height');
      if (previousNavigation) root.style.setProperty('--bottom-navigation-height', previousNavigation);
      else root.style.removeProperty('--bottom-navigation-height');
      if (previousKeyboardInset) root.style.setProperty('--checkout-keyboard-inset', previousKeyboardInset);
      else root.style.removeProperty('--checkout-keyboard-inset');
    };
  }, []);
  return null;
}
