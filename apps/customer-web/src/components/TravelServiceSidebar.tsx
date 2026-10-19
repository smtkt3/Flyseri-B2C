import { useEffect, useRef } from 'react';
import { TravelServiceNavigation } from './TravelServiceNavigation';
import './home/service-sidebar.css';
import './travel-service-sidebar.css';

function MenuIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

export function TravelServiceSidebar({ expanded, compact, onToggle, navigationId='premium-services-nav' }: { expanded: boolean; compact: boolean; onToggle: () => void; navigationId?:string }) {
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded || !compact) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = sidebar.current?.querySelectorAll<HTMLElement>('button, a[href], summary');
      if (!controls?.length) return;
      const first = controls[0]!, last = controls[controls.length - 1]!;
      if (!sidebar.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', trapFocus);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded, compact]);
  return <aside ref={sidebar} className={'premium-service-sidebar travel-service-rail'+(expanded?' is-expanded':' is-collapsed')} role={compact && expanded ? 'dialog' : undefined} aria-modal={compact && expanded ? true : undefined} aria-label="Travel services" onTransitionEnd={event => { if (compact && expanded && event.target === event.currentTarget && event.propertyName === 'transform') sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }}>
    <button type="button" className="premium-service-sidebar-toggle" onClick={onToggle} title={expanded ? 'Collapse travel services' : 'Expand travel services'} aria-label={expanded ? 'Collapse travel services' : 'Expand travel services'} aria-expanded={expanded} aria-controls={navigationId}><span className="premium-service-sidebar-toggle-icon"><MenuIcon /></span><span className="premium-service-sidebar-toggle-text">Travel services</span><svg className="premium-service-sidebar-toggle-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg></button>
    <TravelServiceNavigation id={navigationId}/>
  </aside>;
}

