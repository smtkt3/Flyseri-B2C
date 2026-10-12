import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TravelServiceNavigation } from './TravelServiceNavigation';

export function TravelServicesDrawer({open,onClose,onClosed}:{open:boolean;onClose:()=>void;onClosed?:()=>void}){
  const drawerRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){onClose();onClosed?.();return;}
      if(event.key!=='Tab')return;
      const controls=drawerRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),summary');
      const first=controls?.[0],last=controls?.[controls.length-1];
      if(!first||!last)return;
      if(event.shiftKey && (document.activeElement===first || !drawerRef.current?.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !drawerRef.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);};
  },[open,onClose,onClosed]);
  if(!open)return null;
  return createPortal(<div className="flyseri-services-overlay" onMouseDown={event=>{if(event.target===event.currentTarget){onClose();onClosed?.();}}}>
    <aside ref={drawerRef} className="flyseri-services-drawer" role="dialog" aria-modal="true" aria-label="Travel services">
      <button type="button" className="premium-service-sidebar-toggle" aria-expanded="true" aria-controls="flyseri-services-drawer-nav" onClick={()=>{onClose();onClosed?.();}}><span className="premium-service-sidebar-toggle-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span><span className="premium-service-sidebar-toggle-text">Travel services</span><svg className="premium-service-sidebar-toggle-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg></button>
      <TravelServiceNavigation id="flyseri-services-drawer-nav"/>
    </aside>
  </div>,document.body);
}
