import { Link, useLocation } from 'react-router-dom';
import './travel-service-navigation.css';
type ServiceKind='flight'|'hotels'|'attractions'|'packages'|'visa'|'esim';
function Icon({kind}:{kind:ServiceKind}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {kind==='flight'&&<><path d="m21 3-8.5 18-2.7-7-6.8-2.5L21 3Z"/><path d="M9.8 14 21 3"/></>}
  {kind==='hotels'&&<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-5h4v5"/></>}
  {kind==='attractions'&&<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z"/>}
  {kind==='packages'&&<><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3 7 9 4 9-4M12 11v10"/></>}
  {kind==='visa'&&<><rect x="4" y="2.5" width="16" height="19" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M8.5 12h7M12 8.5c1.5 2 1.5 5 0 7"/></>}
  {kind==='esim'&&<><rect x="5" y="2" width="14" height="20" rx="3"/><rect x="8" y="7" width="8" height="8" rx="1"/><path d="M10 18h4"/></>}
</svg>}


const services:Array<{name:string;kind:ServiceKind;to?:string;soon?:boolean}>=[
 {name:'Flight',kind:'flight',to:'/flights'},
 {name:'Packages',kind:'packages',to:'/holidays'},
 {name:'Visa',kind:'visa',to:'/app/visa'},
 {name:'Hotels',kind:'hotels',soon:true},
 {name:'Attractions',kind:'attractions',soon:true},
 {name:'E-SIM',kind:'esim',soon:true},
];
export function serviceIsActive(path:string,kind:ServiceKind){
 if(kind==='flight')return path==='/'||path==='/app'||/^\/(app\/)?flights(\/|$)/.test(path);
 if(kind==='packages')return /^\/holidays(\/|$)/.test(path);
 if(kind==='visa')return /^\/app\/(visa|visa-applications)(\/|$)/.test(path);
 return false;
}
export function TravelServiceNavigation({id}:{id:string}){
 const {pathname}=useLocation();
 const render=(item:typeof services[number])=>{
  const content=<><span className="premium-service-sidebar-icon"><Icon kind={item.kind}/></span><span className="premium-service-sidebar-label">{item.name}</span>{item.soon&&<small>Soon</small>}</>;
  if(item.soon)return <div key={item.kind} className="premium-service-sidebar-item unavailable" aria-disabled="true" aria-label={item.name+', coming soon'} title={item.name+' · Coming soon'}>{content}</div>;
  const active=serviceIsActive(pathname,item.kind);
  return <Link key={item.kind} to={item.kind==='flight'&&(pathname==='/'||pathname==='/app')?'#book':item.to!} className={'premium-service-sidebar-item'+(active?' active':'')} aria-label={item.name} title={item.name} aria-current={active?'page':undefined}>{content}</Link>;
 };
 return <><nav id={id} aria-label="Travel services"><div className="premium-service-group"><p className="premium-service-group-label">Explore</p>{services.filter(item=>!item.soon).map(render)}</div><details className="premium-service-group is-upcoming"><summary aria-label="More services, coming soon"><span className="service-more-full">More services · coming soon</span><span className="service-more-short" aria-hidden="true">More</span></summary>{services.filter(item=>item.soon).map(render)}</details></nav><div className="premium-service-sidebar-footer"><Link to="/app/support" className={'premium-service-sidebar-item'+(pathname.startsWith('/app/support')?' active':'')} aria-label="Help and support" title="Help and support" aria-current={pathname.startsWith('/app/support')?'page':undefined}><span className="premium-service-sidebar-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.7-2.5 1.8-2.5 3.5M12 17h.01"/></svg></span><span className="premium-service-sidebar-label">Help & support</span></Link></div></>;
}
