import type { ReactNode } from 'react';
import { countryName } from '../trip/tripPresentation';
export const visaDestinationName = (code:string) => code === 'TR' ? 'Turkey' : countryName(code);
export function matchesVisaDestination(code:string,query:string,exact=false) {
  const aliases: Record<string,string[]> = {GB:['UK','United Kingdom'],AE:['UAE','United Arab Emirates'],TR:['Turkey','Türkiye']};
  const terms = [visaDestinationName(code),countryName(code),code,...(aliases[code] || [])];
  const value = query.trim().toLowerCase();
  return terms.some(term => exact ? term.toLowerCase() === value : term.toLowerCase().includes(value));
}
export function VisaIcon({name}: {name: string}) {
  const paths: Record<string,ReactNode> = {
    passport:<><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="4"/><path d="M8 10h8M12 6c-2 2-2 6 0 8 2-2 2-6 0-8M9 17h6"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18"/></>,
    check:<path d="m5 12 4 4L19 6"/>,
    screen:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4m-4-10 3 3 5-6"/></>,
    plane:<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>,
    documents:<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 12h8M8 16h6"/></>,
    person:<><circle cx="10" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 12-5m2 2 2 2 4-5"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.documents}</svg>;
}
export const visaDestinations = [
  {code:'MY',region:'Asia',caption:'Malaysia, made easier',capital:'Kuala Lumpur',currency:'Malaysian ringgit · MYR'},
  {code:'TH',region:'Asia',caption:'Plan your Thai getaway',capital:'Bangkok',currency:'Thai baht · THB'},
  {code:'SG',region:'Asia',caption:'Your next city escape',capital:'Singapore',currency:'Singapore dollar · SGD'},
  {code:'AE',region:'Middle East',caption:'Explore the Emirates',capital:'Abu Dhabi',currency:'UAE dirham · AED'},
  {code:'IN',region:'Asia',caption:'Prepare for your visit',capital:'New Delhi',currency:'Indian rupee · INR'},
  {code:'SA',region:'Middle East',caption:'Start planning your journey',capital:'Riyadh',currency:'Saudi riyal · SAR'},
  {code:'TR',region:'Europe',caption:'Discover something new',capital:'Ankara',currency:'Turkish lira · TRY'},
  {code:'ID',region:'Asia',caption:'An island escape awaits',capital:'',currency:'Indonesian rupiah · IDR'},
  {code:'CN',region:'Asia',caption:'A journey of discovery',capital:'Beijing',currency:'Chinese yuan · CNY'},
  {code:'JP',region:'Asia',caption:'Get ready to explore Japan',capital:'Tokyo',currency:'Japanese yen · JPY'},
  {code:'GB',region:'Europe',caption:'Plan your UK visit',capital:'London',currency:'Pound sterling · GBP'},
  {code:'PK',region:'Asia',caption:'Prepare for your Pakistan visit',capital:'Islamabad',currency:'Pakistani rupee · PKR'},
  {code:'LK',region:'Asia',caption:'Your Sri Lanka getaway',capital:'Sri Jayawardenepura Kotte',currency:'Sri Lankan rupee · LKR'},
  {code:'LA',region:'Asia',caption:'Discover a quieter escape',capital:'Vientiane',currency:'Lao kip · LAK'},
  {code:'KH',region:'Asia',caption:'Your Cambodia adventure',capital:'Phnom Penh',currency:'Cambodian riel · KHR'},
];
export const visaSteps = [
  {icon:'globe',title:'Explore your destination',body:'Choose your country and reason for travel to plan your next steps.'},
  {icon:'documents',title:'Apply & add documents',body:'Complete your applicant details and securely add your supporting documents.'},
  {icon:'person',title:'Get expert guidance',body:'Flyseri reviews your information and confirms requirements, fees and submission steps.'},
  {icon:'passport',title:'Follow your progress',body:'Track updates in your application and view your visa documents when available.'},
];
export function VisaFlag({code}: {code:string}) {
  return <span className="visa-country-mark" aria-hidden="true"><span>{code}</span><img src={`https://flagcdn.com/w80/${code.toLowerCase()}.png`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display='none'; }}/></span>;
}
