import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';

type ServiceKind='flight'|'hotels'|'attractions'|'packages'|'visa'|'esim';
function Icon({kind}:{kind:ServiceKind}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {kind==='flight'&&<><path d="m21 3-8.5 18-2.7-7-6.8-2.5L21 3Z"/><path d="M9.8 14 21 3"/></>}
  {kind==='hotels'&&<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-5h4v5"/></>}
  {kind==='attractions'&&<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z"/>}
  {kind==='packages'&&<><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3 7 9 4 9-4M12 11v10"/></>}
  {kind==='visa'&&<><rect x="4" y="2.5" width="16" height="19" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M8.5 12h7M12 8.5c1.5 2 1.5 5 0 7"/></>}
  {kind==='esim'&&<><rect x="5" y="2" width="14" height="20" rx="3"/><rect x="8" y="7" width="8" height="8" rx="1"/><path d="M10 18h4"/></>}
</svg>}

export function TravelServicesDrawer({open,onClose,onClosed}:{open:boolean;onClose:()=>void;onClosed?:()=>void}){
  const location=useLocation();
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){onClose();onClosed?.();}};
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);};
  },[open,onClose,onClosed]);
  if(!open)return null;
  const services:Array<{name:string;kind:ServiceKind;to?:string;soon?:boolean}>=[
    {name:'Flight',kind:'flight',to:'/app/flights'},
    {name:'Hotels',kind:'hotels',soon:true},
    {name:'Attractions',kind:'attractions',soon:true},
    {name:'Packages',kind:'packages',soon:true},
    {name:'Visa',kind:'visa',to:'/app/visa'},
    {name:'E-SIM',kind:'esim',soon:true},
  ];
  return createPortal(<div className="flyseri-services-overlay" onMouseDown={event=>{if(event.target===event.currentTarget){onClose();onClosed?.();}}}>
    <aside className="flyseri-services-drawer" role="dialog" aria-modal="true" aria-label="Travel services">
      <button type="button" className="premium-service-sidebar-toggle" aria-expanded="true" aria-controls="flyseri-services-drawer-nav" onClick={()=>{onClose();onClosed?.();}}><span className="premium-service-sidebar-toggle-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span><span className="premium-service-sidebar-toggle-text">Travel services</span><span className="premium-service-sidebar-toggle-chevron" aria-hidden="true">‹</span></button>
      <nav id="flyseri-services-drawer-nav" aria-label="Travel services">{services.map(item=>{
        const content=<><span className="premium-service-sidebar-icon"><Icon kind={item.kind}/></span><span className="premium-service-sidebar-label">{item.name}</span>{item.soon&&<small>Soon</small>}</>;
        if(item.soon)return <div key={item.name} className="premium-service-sidebar-item unavailable" aria-label={`${item.name}, coming soon`}>{content}</div>;
        const active=item.kind==='flight'?location.pathname.includes('flight'):location.pathname.startsWith(item.to!);
        return <Link key={item.name} to={item.to!} onClick={()=>{onClose();onClosed?.();}} className={`premium-service-sidebar-item${active?' active':''}`} aria-current={active?'page':undefined}>{content}</Link>;
      })}</nav>
    </aside>
  </div>,document.body);
}
