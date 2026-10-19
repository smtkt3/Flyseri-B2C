import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { AccountNavigation } from './AccountNavigation';
import './account-sidebar.css';

interface Props {
  name:string; photo?:string; open:boolean; onClose:()=>void;
  signingOut:boolean; signOut:()=>void; error:string;
}
export function AccountSidebar({name,photo,open,onClose,signingOut,signOut,error}:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  const {pathname}=useLocation();
  const previousPath=useRef(pathname);
  useEffect(()=>{
    if(previousPath.current!==pathname) onClose();
    previousPath.current=pathname;
  },[pathname,onClose]);
  useEffect(()=>{
    const element=dialog.current;
    if(open && element && !element.open) element.show();
    if(!open && element?.open) element.close();
    if(!open)return;
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape' && !document.querySelector('.flyseri-services-overlay,.premium-service-backdrop[aria-expanded="true"]')) {
        event.preventDefault();onClose();
      }
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);};
  },[open,onClose]);
  const content=<>
    <div className="account-secondary-identity"><span className="account-secondary-avatar" aria-hidden="true">{name[0]?.toUpperCase()}{photo&&<img src={photo} alt="" onError={event=>{event.currentTarget.style.display='none';}}/>}</span><div><small>My Flyseri</small><strong>{name}</strong></div></div>
    <AccountNavigation/>
    <div className="account-secondary-footer"><button type="button" disabled={signingOut} onClick={signOut}>{signingOut?'Signing out…':'Sign out'}</button>{error&&<p role="alert">{error}</p>}</div>
  </>;
  return <>
    {createPortal(<dialog ref={dialog} id="flyseri-profile-menu" className="account-secondary-modal" aria-label="My Flyseri account" onCancel={event=>{event.preventDefault();onClose();}} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
      <div className="account-secondary-drawer" onClick={event=>{const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');if(link && new URL(link.href).pathname===pathname)onClose();}}><div className="account-secondary-drawer-heading"><span>Your account</span><button type="button" aria-label="Close account menu" onClick={onClose}>×</button></div>{content}</div>
    </dialog>,document.body)}
  </>;
}
