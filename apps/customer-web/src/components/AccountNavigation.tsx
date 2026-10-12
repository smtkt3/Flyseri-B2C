import { Link, useLocation } from 'react-router-dom';

const links = [
  ['My travel', 'bookings', 'M3 7h18v14H3zM8 7V4h8v3M3 12h18'],
  ['Payments', 'payments', 'M3 5h18v14H3zM3 9h18M7 15h3'],
  ['Flyseri Points', 'points', 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z'],
  ['Visa', 'visa', 'M6 3h12v18H6zM9 7h6M9 17h6M12 10v4M10 12h4'],
  ['Ask Seri', 'seri', 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'],
  ['Price alerts', 'price-alerts', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
  ['Support', 'support', 'M4 14v-3a8 8 0 0 1 16 0v7h-4v-6h4M4 12h4v6H4zM16 21h-4'],
  ['Profile & settings', 'profile', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0'],
  ['Travellers', 'travellers', 'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 21v-3a7 7 0 0 1 14 0v3'],
] as const;

export function accountSectionActive(pathname:string,route:string) {
  if(route==='bookings')return /^\/app\/(bookings|trips|orders)(\/|$)/.test(pathname);
  if(route==='profile')return /^\/app\/(profile|documents)(\/|$)/.test(pathname);
  return pathname===`/app/${route}`||pathname.startsWith(`/app/${route}/`);
}

export function AccountNavigation() {
  const {pathname}=useLocation();
  const order=['bookings','profile','travellers','points','payments','visa','price-alerts','seri','support'];
  return <nav aria-label="Account navigation">{order.map(route=>{
    const [label,,path]=links.find(link=>link[1]===route)!;
    const description=route==='bookings'?'Bookings, trips & orders':route==='profile'?'Details, documents & preferences':null;
    return <Link key={route} to={`/app/${route}`} aria-label={label} className={`${description?'account-menu-feature ':''}${['points','visa','support'].includes(route)?'account-menu-divider':''}`} aria-current={accountSectionActive(pathname,route)?'page':undefined}>
      <span className="account-menu-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg></span>
      <span className="account-menu-label"><strong>{label}</strong>{description&&<small>{description}</small>}</span>
    </Link>;
  })}</nav>;
}
