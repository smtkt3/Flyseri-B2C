import { useEffect, useMemo, useState } from 'react';
import type { FlightOffer } from '@flyseri/types';
import { countries } from '../trip/tripPresentation';
import { baggageEntryAdvice, flightConnections } from './flightTransfers';
import { connectionTransferAdvice, type ConnectionTransferAdvice } from './airlineTransferPolicy';
import './flight-transfer-notice.css';

let airportCountries:Promise<Map<string,string>>|undefined;
function loadCountries() {
  // Reuse one lazy directory load for all passengers; never download it per card.
  airportCountries??=import('./data/airport-countries.json').then(module=>new Map(Object.entries(module.default))).catch(error=>{airportCountries=undefined;throw error;});
  return airportCountries;
}
function useConnectionCountries(enabled:boolean) {
  const [directory,setDirectory]=useState<Map<string,string>|null>(null);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    void loadCountries().then(value=>{if(active)setDirectory(value);},()=>{if(active)setDirectory(new Map());});
    return()=>{active=false;};
  },[enabled]);
  return directory;
}
function PolicySource({advice}:{advice:ConnectionTransferAdvice}) {
  return advice.source?<small className="flight-transfer-policy-source"><a href={advice.source.url} target="_blank" rel="noreferrer">{advice.source.name} policy ↗</a><span>Checked {advice.checkedAt}</span></small>:null;
}
export function FlightTransferNotice({offer,legIndex}:{offer:FlightOffer;legIndex?:number}) {
  const connections=flightConnections(offer,legIndex);
  const directory=useConnectionCountries(connections.length>0);
  if(!connections.length)return null;
  const assessed=connections.map(connection=>({connection,advice:connectionTransferAdvice(connection,directory)}));
  const required=assessed.filter(item=>item.advice.requiresCollection);
  const kinds=new Set(assessed.map(item=>item.advice.kind));
  const title=required.length ? required.some(item=>item.advice.kind==='SELF_TRANSFER')?'Self-transfer':'Collect & recheck baggage'
    : kinds.size===1?assessed[0]!.advice.title:'Baggage transfer · see details';
  const condition=required.length?'Review connection requirements':kinds.size===1?assessed[0]!.advice.condition:'Conditions vary by connection';
  const airports=[...new Set(connections.map(item=>item.airportChange?`${item.arrivalAirport} → ${item.departureAirport}`:item.arrivalAirport))].join(' · ');
  return <details className={`flight-transfer-notice ${required.length?'needs-recheck':'needs-confirmation'}`}>
    <summary>
      <svg className="flight-transfer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="6" width="14" height="14" rx="3"/><path d="M9 6V3h6v3M9 10v6m6-6v6M8 20v1m8-1v1"/></svg>
      <span className="flight-transfer-label"><strong>{title}</strong><span className="flight-transfer-caption">{airports} · {condition}</span></span>
      <span className="flight-transfer-disclosure"><span>Details</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span>
    </summary>
    <div className="flight-transfer-expanded">{assessed.map(({connection:item,advice})=><div key={item.key}><strong>{item.arrivalAirport}{item.airportChange?` → ${item.departureAirport}`:''} · {advice.title}</strong><p>{advice.detail}</p><PolicySource advice={advice}/></div>)}<p className="flight-transfer-entry-note">Baggage transfer does not confirm visa eligibility. Check transit requirements, and entry permission if you need to pass immigration.</p></div>
  </details>;
}
export function FlightTransferVisaAdvice({offer,nationality,issuingCountry,documentType}:{offer:FlightOffer;nationality:string;issuingCountry:string;documentType:string}) {
  const connections=useMemo(()=>flightConnections(offer),[offer]);
  const directory=useConnectionCountries(connections.length>0);
  if(!connections.length)return null;
  const ready=Boolean(nationality&&issuingCountry&&documentType);
  return <aside className="flight-transfer-visa" aria-label="Connection baggage and visa guidance" aria-live="polite">
    <h3>Connection baggage & visa check</h3>
    {!ready ? <p>Select nationality, document type and passport issuing country to see connection guidance.</p> : connections.map(connection=>{
      const country=directory?.get(connection.arrivalAirport);
      const onwardCountry=directory?.get(connection.departureAirport);
      const advice=baggageEntryAdvice({country,nationality,issuingCountry,documentType,arrivalAt:connection.arrivalAt});
      const onwardAdvice=connection.airportChange&&onwardCountry!==country ? baggageEntryAdvice({country:onwardCountry,nationality,issuingCountry,documentType,arrivalAt:connection.arrivalAt}) : null;
      const countryName=countries.find(item=>item.code===country)?.name;
      const transfer=connectionTransferAdvice(connection,directory);
      return <div key={connection.key}>
        <strong>{connection.arrivalAirport}{connection.airportChange?` → ${connection.departureAirport}`:''}{countryName?` · ${countryName}`:''}</strong>
        <p><strong>{transfer.title}</strong>{transfer.detail}</p>
        <PolicySource advice={transfer}/>
        <b>{!directory?'Checking connection location…':`${!transfer.requiresCollection?'If you pass immigration: ':''}${advice.title}`}</b>
        {directory&&<><p>{advice.detail}</p><a href={advice.source} target="_blank" rel="noreferrer">{advice.sourceLabel} ↗</a>{advice.checkedAt&&<small>Official rule checked {advice.checkedAt}; confirm again before travel.</small>}</>}
        {directory&&onwardAdvice&&<><b>{connection.departureAirport} · {onwardAdvice.title}</b><p>{onwardAdvice.detail}</p><a href={onwardAdvice.source} target="_blank" rel="noreferrer">{onwardAdvice.sourceLabel} ↗</a></>}
      </div>;
    })}
  </aside>;
}
