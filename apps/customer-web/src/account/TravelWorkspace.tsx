import { Suspense, useLayoutEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AccountTabs } from './AccountTabs';
import { PageLoading } from '../components/PageLoading';
import './account-workspace.css';

const tabs=[{value:'bookings',label:'Bookings'},{value:'trips',label:'Trips'},{value:'orders',label:'Orders'}] as const;
export function TravelWorkspace({tab,children}:{tab:typeof tabs[number]['value'];children:ReactNode}) {
  const navigate=useNavigate();
  const location=useLocation();
  useLayoutEffect(()=>{if(location.state?.focusTravelTab)document.getElementById(`travel-${tab}-tab`)?.focus({preventScroll:true});},[tab,location.key]);
  const descriptions={bookings:'Your flight reservations, airline references and ticket updates.',trips:'Your plans, itineraries and travelling companions, together.',orders:'Your checkouts, payment status and receipts.'};
  return <div className="account-page travel-workspace"><header className="account-workspace-hero"><div><p className="account-eyebrow">MY FLYSERI</p><h1>My travel</h1><p>From the first plan to your next departure. Everything in one place.</p></div><span className="account-workspace-mark" aria-hidden="true">✈</span></header><AccountTabs label="My travel" items={tabs} value={tab} onChange={value=>navigate(`/app/${value}`,{state:{focusTravelTab:true}})} prefix="travel"/><section id="travel-panel" role="tabpanel" aria-labelledby={`travel-${tab}-tab`} tabIndex={0}><p className="account-tab-description">{descriptions[tab]}</p><Suspense fallback={<PageLoading label={`Loading your ${tab}…`}/>}>{children}</Suspense></section></div>;
}
