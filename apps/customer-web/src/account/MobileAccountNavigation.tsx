import { Link, useLocation } from 'react-router-dom';
import './mobile-account-navigation.css';

const items=[
  {label:'Home',to:'/app',match:(path:string)=>path==='/app',icon:'M3 10.5 12 3l9 7.5M5 9v12h5v-7h4v7h5V9'},
  {label:'Search',to:'/app/flights',match:(path:string)=>/^\/app\/flights(\/|$)/.test(path),icon:'M21 21l-5.2-5.2M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z'},
  {label:'My travel',to:'/app/bookings',match:(path:string)=>/^\/app\/(bookings|trips|orders|payments)(\/|$)/.test(path),icon:'M4 7h16a1 1 0 0 1 1 1v12H3V8a1 1 0 0 1 1-1ZM8 7V4h8v3M3 12h18M9 12v3h6v-3'},
  {label:'Rewards',to:'/app/points',match:(path:string)=>/^\/app\/points(\/|$)/.test(path),icon:'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z'},
  {label:'Account',to:'/app/profile',match:(path:string)=>/^\/app\/(profile|documents|travellers)(\/|$)/.test(path),icon:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2'},
];
export function MobileAccountNavigation(){
  const {pathname}=useLocation();
  return <nav className="account-mobile-bottom" aria-label="Quick navigation">{items.map(item=>{
    const active=item.match(pathname);
    return <Link key={item.to} to={item.to} className={active?'active':''} aria-current={active?'page':undefined}><span className="account-bottom-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon}/></svg></span><span className="account-bottom-label">{item.label}</span></Link>;
  })}</nav>;
}
