import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TravelServiceSidebar } from './TravelServiceSidebar';

export function TravelServicesDrawer({open,onClose,onClosed}:{open:boolean;onClose:()=>void;onClosed?:()=>void}){
  useEffect(()=>{
    if(!open)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){onClose();onClosed?.();}};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[open,onClose,onClosed]);
  if(!open)return null;
  const close=()=>{onClose();onClosed?.();};
  return createPortal(<div className="flyseri-services-overlay services-open" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
    <TravelServiceSidebar expanded compact onToggle={close} navigationId="flyseri-services-drawer-nav"/>
  </div>,document.body);
}
