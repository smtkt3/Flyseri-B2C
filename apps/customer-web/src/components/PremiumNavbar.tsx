import { Translated } from '../travel/language';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { authService } from '../services/authService';
import { BrandMark } from './BrandMark';
import { LocaleMenu } from './LocaleMenu';
import { TravelServicesDrawer } from './TravelServicesDrawer';
import { AccountNavigation } from './AccountNavigation';
import { useProfilePhoto } from '../account/ProfilePhoto';
import { cachedProfile, profileEvent } from '../account/profileEvents';
import { useBackStepState } from './useBackStepState';
import './home/premium-home.css';
import './home/premium-reference.css';
import './home/premium-services.css';
import './premium-navbar.css';
export function PremiumNavbar({name,servicesExpanded,onToggleServices}:{name?:string|null;servicesExpanded?:boolean;onToggleServices?:()=>void}={}) {
  const {session}=useAuth();
  const photo=useProfilePhoto();
  const [savedName,setSavedName]=useState<string|null|undefined>(undefined);
  useEffect(()=>{
    setSavedName(cachedProfile(session?.user?.id)?.displayName);
    const update=(event:Event)=>{const detail=(event as CustomEvent<{customerId:string;profile:{displayName:string|null}}>).detail;if(detail.customerId===session?.user?.id)setSavedName(detail.profile.displayName);};
    window.addEventListener(profileEvent,update);return()=>window.removeEventListener(profileEvent,update);
  },[session?.user?.id]);
  const navigate=useNavigate();
  const [profileOpen,setProfileOpen]=useBackStepState('account-menu',false);
  const [signingOut,setSigningOut]=useState(false);
  const [signOutError,setSignOutError]=useState('');
  const profileRef=useRef<HTMLDivElement>(null);
  const profileTrigger=useRef<HTMLButtonElement>(null);
  const menuTrigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!profileOpen)return;
    const dismiss=(event:MouseEvent)=>{if(!profileRef.current?.contains(event.target as Node))setProfileOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setProfileOpen(false);profileTrigger.current?.focus();}};
    document.addEventListener('mousedown',dismiss);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',dismiss);document.removeEventListener('keydown',key);};
  },[profileOpen]);
  async function signOut(){
    if(signingOut)return;
    setSigningOut(true);setSignOutError('');
    try{await authService.signOut();setProfileOpen(false);navigate('/',{replace:true});}
    catch{setSignOutError('We could not sign you out. Please try again.');}
    finally{setSigningOut(false);}
  }
  const [servicesOpen,setServicesOpen]=useBackStepState('services-drawer',false);
  const metadataName=savedName===undefined?session?.user.user_metadata?.full_name:savedName;
  const displayName=name===undefined ? (typeof metadataName==='string' && metadataName.trim() ? metadataName : session?.user.email?.split('@')[0] || null) : name;
  const expanded=onToggleServices ? !!servicesExpanded : servicesOpen;
  const closeServices=useCallback(()=>setServicesOpen(false),[setServicesOpen]);
  const restoreMenuFocus=useCallback(()=>menuTrigger.current?.focus(),[]);
  return <><header className="premium-header flyseri-site-navbar"><button ref={menuTrigger} type="button" className={`premium-mobile-services-toggle${!onToggleServices ? ' is-standalone' : ''}`} onClick={onToggleServices || (()=>setServicesOpen(value=>!value))} aria-label={onToggleServices ? expanded?'Close travel services':'Open travel services' : expanded?'Close travel services':'Open travel services'} aria-expanded={expanded} aria-controls={onToggleServices?'premium-services-nav':'flyseri-services-drawer-nav'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><Link to="/" className="premium-logo" aria-label="Flyseri home"><BrandMark/></Link><nav className="navbar-utility-links" aria-label="Main navigation"><Link className="navbar-app-link" to="/app"><svg viewBox="0 0 16 22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="2" width="10" height="18" rx="1"/><path d="M6 17h4"/></svg>App</Link><Link to="/app/support"><Translated text="Customer support" /></Link><Link to="/app/bookings"><Translated text="Find bookings" /></Link></nav><div className="premium-header-actions"><LocaleMenu/><div className="premium-profile-area" ref={profileRef}>{displayName ? <button type="button" className="premium-profile" ref={profileTrigger} aria-label="My Flyseri account" aria-expanded={profileOpen} aria-controls="flyseri-profile-menu" onClick={()=>setProfileOpen(value=>!value)}><span aria-hidden="true">{displayName[0]?.toUpperCase()}{photo.url&&<img key={photo.url} src={photo.url} alt="" onError={event=>{event.currentTarget.style.display='none';}}/>}</span><span><strong>{displayName}</strong><small><Translated text="My Flyseri" /></small></span></button> : <Link className="navbar-sign-in" to="/sign-in" aria-label="Sign in/register"><Translated text="Sign in" /><span className="navbar-register-label">/register</span></Link>}{displayName && profileOpen && <div className="premium-profile-dropdown" id="flyseri-profile-menu"><div className="account-menu-identity"><span className="account-menu-avatar" aria-hidden="true">{displayName[0]?.toUpperCase()}{photo.url&&<img key={photo.url} src={photo.url} alt="" onError={event=>{event.currentTarget.style.display='none';}}/>}</span><div><small><Translated text="My Flyseri" /></small><strong>{displayName}</strong></div></div><AccountNavigation/><button type="button" disabled={signingOut} onClick={()=>void signOut()}>{signingOut?'Signing out…':'Sign out'}</button>{signOutError && <p role="alert">{signOutError}</p>}</div>}</div></div></header>{!onToggleServices && <TravelServicesDrawer open={servicesOpen} onClose={closeServices} onClosed={restoreMenuFocus} />}</>;
}
