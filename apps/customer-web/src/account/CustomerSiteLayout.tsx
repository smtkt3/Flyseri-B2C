import type { ReactNode } from 'react';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { TravelServiceSidebar } from '../components/TravelServiceSidebar';
import { useTravelServiceMenu } from '../components/useTravelServiceMenu';
import { MobileAccountNavigation } from './MobileAccountNavigation';
import './customer-ux.css';
import '../components/home/service-sidebar.css';
import './customer-service-sidebar.css';

export function CustomerSiteLayout({children}:{children:ReactNode}) {
  const {compact,expanded,setExpanded}=useTravelServiceMenu();
  return <div className={'customer-site-shell customer-service-layout'+(expanded?' services-open':'')}>
    <TravelServiceSidebar compact={compact} expanded={expanded} onToggle={()=>setExpanded(value=>!value)}/>
    <button type="button" className="premium-service-backdrop" aria-expanded={compact && expanded} aria-label="Close travel services" onClick={()=>setExpanded(false)}/>
    <div className="customer-service-main"><PremiumNavbar servicesExpanded={expanded} onToggleServices={()=>setExpanded(value=>!value)}/>
      <div className="account-shell"><div className="account-content">{children}</div><MobileAccountNavigation /></div>
    </div>
  </div>;
}
