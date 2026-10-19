import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { VisaApplicationSummary, VisaAssistanceRequestSummary, VisaType } from '@flyseri/types';
import { isSupportedVisaDestination } from '@flyseri/types';
import { visaService } from '../services/visaService';
import { formatMoney, formatTimestamp, visaStatus } from '../account/presentation';
import { VisaFlag, VisaIcon, visaDestinations, visaDestinationName } from './visa-discovery';
import { visaServiceFees, visaPurposeMatches as purposeMatches } from './visaPricing';
import { VisaFlowActions } from './VisaFlowLayout';
import './visa-discovery.css';
import './visa-start.css';

const purposes = [{ value:'Tourism', label:'Tourist visa' }, { value:'Study', label:'Student visa' }, { value:'Business', label:'Business visa' }, { value:'Family visit', label:'Family visit visa' }];
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthAgo = () => { const date = new Date(); date.setDate(date.getDate()-30); return localDate(date); };

type SavedVisa = {id:string; reference:string; country:string; title:string; status:string; createdAt:string; href:string};
function SavedApplications() {
  const [from,setFrom] = useState(monthAgo);
  const [to,setTo] = useState(localDate());
  const [range,setRange] = useState({from,to});
  const [query,setQuery] = useState('');
  const [items,setItems] = useState<SavedVisa[]>([]);
  const [loading,setLoading] = useState(true);
  const [errors,setErrors] = useState<string[]>([]);
  const [dateError,setDateError] = useState('');
  const version = useRef(0);
  async function load() {
    const current = ++version.current;
    setLoading(true); setErrors([]);
    const results = await Promise.allSettled([visaService.list(),visaService.assistanceList()]);
    if (version.current !== current) return;
    const unavailable:string[] = [];
    const applicationItems = results[0].status === 'fulfilled' ? results[0].value.map((item:VisaApplicationSummary):SavedVisa => ({id:item.id,reference:item.applicationReference || item.id,country:item.destinationCountryCode,title:item.visaTypeName,status:visaStatus(item.status),createdAt:item.createdAt,href:'/app/visa-applications/'+item.id})) : null;
    const requestItems = results[1].status === 'fulfilled' ? results[1].value.map((item:VisaAssistanceRequestSummary):SavedVisa => ({id:item.id,reference:item.requestReference,country:item.destinationCountryCode,title:item.purpose,status:({NEW:'Continue application',IN_REVIEW:'Under review',CONTACTED:'Team update available',CONVERTED:'Application prepared',CLOSED:'Closed'})[item.status],createdAt:item.createdAt,href:'/app/visa/assistance/'+item.id+'/documents'})) : null;
    if (!applicationItems) unavailable.push('Visa applications could not be refreshed.');
    if (!requestItems) unavailable.push('Assisted requests could not be refreshed.');
    // Retain the last successful records when one source temporarily fails.
    setItems(previous => [...(applicationItems || previous.filter(item=>item.href.startsWith('/app/visa-applications/'))),...(requestItems || previous.filter(item=>!item.href.startsWith('/app/visa-applications/')))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
    setErrors(unavailable); setLoading(false);
  }
  useEffect(()=>{ void load(); return ()=>{ version.current++; }; },[]);
  function show(event:FormEvent) {
    event.preventDefault();
    if (from && to && from > to) { setDateError('The From date must be on or before the To date.'); return; }
    setDateError(''); setRange({from,to}); void load();
  }
  const needle=query.trim().toLocaleLowerCase();
  const filtered=items.filter(item=>{ const date=localDate(new Date(item.createdAt)); return (!range.from || date>=range.from) && (!range.to || date<=range.to) && (!needle || [item.id,item.reference,item.title,item.country,visaDestinationName(item.country),item.status].some(value=>value.toLocaleLowerCase().includes(needle))); });
  return <div id="visa-saved-panel" role="tabpanel" aria-labelledby="visa-saved-tab" className="visa-start-content">
    <form className="visa-start-card visa-application-filters" onSubmit={show}>
      <label>From<input type="date" value={from} max={to || undefined} onChange={event=>setFrom(event.target.value)}/></label>
      <label>To<input type="date" value={to} min={from || undefined} onChange={event=>setTo(event.target.value)}/></label>
      <button className="btn-primary" type="submit" disabled={loading}>{loading?'Loading…':'Show applications'}</button>
      <label>Find<input type="search" placeholder="Application ID, reference or country" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      {dateError && <p className="account-error" role="alert">{dateError}</p>}
    </form>
    {errors.length>0 && <div className="visa-start-card visa-list-error" role="alert"><p>{errors.join(' ')} Any previously loaded records remain below.</p><button type="button" className="account-outline-button" disabled={loading} onClick={()=>void load()}>Try again</button></div>}
    <section className="visa-start-card visa-application-results" aria-label="Your visa applications" aria-busy={loading}>
      {loading && !items.length ? <div className="visa-applications-empty" role="status"><VisaIcon name="clock"/><h2>Loading your applications…</h2></div> : filtered.length ? <><p className="visa-results-count">{filtered.length} application{filtered.length===1?'':'s'}</p><div className="visa-application-rows">{filtered.map(item=><Link key={item.href} to={item.href}><VisaFlag code={item.country}/><div><strong>{visaDestinationName(item.country)} · {item.title}</strong><small>{item.reference} · {formatTimestamp(item.createdAt)}</small></div><span className="visa-row-status">{item.status}</span><span aria-hidden="true">→</span></Link>)}</div></> : <div className="visa-applications-empty"><VisaIcon name="documents"/><h2>{errors.length ? 'Application history is temporarily unavailable' : needle ? 'No matching applications' : 'No applications in these dates'}</h2><p>{errors.length ? 'Try refreshing to load your latest applications.' : needle ? 'Try a different reference, application ID or country.' : 'Pick an earlier From date, or start a new application.'}</p>{!errors.length && <Link className="btn-primary" to="?tab=new">New application</Link>}</div>}
    </section>
  </div>;
}

export function VisaStartPage() {
  const [params,setParams] = useSearchParams();
  const countryParam=params.get('country')?.toUpperCase() || '';
  const country=isSupportedVisaDestination(countryParam)?countryParam:'MY';
  const purpose=purposes.some(item=>item.value===params.get('purpose'))?params.get('purpose')!:'Tourism';
  const requestedService=params.get('service') || '';
  const saved=params.get('tab')==='applications';
  const [services,setServices]=useState<VisaType[]>([]);
  const [loadedCountry,setLoadedCountry]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true; setLoading(true); setLoadedCountry(''); setServices([]); setError('');
    void visaService.catalogue(country).then(items=>{if(active){setServices(items);setLoadedCountry(country);}},()=>{if(active)setError('Visa fees could not be loaded. Retry to see the current price, or continue with an assisted request.');}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[country,revision]);
  const available=loadedCountry===country?services:[];
  const selected=available.find(item=>item.id===requestedService&&purposeMatches(item,purpose)) || available.find(item=>purposeMatches(item,purpose)) || (available.length===1 && !/touris|visit|student|study|education|business|family/i.test(available[0]!.name)?available[0]:undefined);
  const fees=visaServiceFees(selected);
  function update(values:Record<string,string>) { const next=new URLSearchParams(params); Object.entries(values).forEach(([key,value])=>value?next.set(key,value):next.delete(key)); setParams(next,{replace:true}); }
  const nextParams=new URLSearchParams({country,purpose,...(selected?{service:selected.id}:{}),chosen:'1'});
  const chooseTab=(tab:string)=>update({tab});
  return <main className="account-page visa-start-page">
    <header className="visa-start-hero"><div><h1><span><VisaIcon name="passport"/></span>Visa application</h1><p>Apply online, upload documents, pay and track your application in one place.</p><small>For Bangladeshi nationals only</small></div>
      <div className="visa-start-tabs" role="tablist" aria-label="Visa applications"><button id="visa-new-tab" role="tab" aria-selected={!saved} aria-controls="visa-new-panel" tabIndex={saved?-1:0} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();chooseTab('applications');document.getElementById('visa-saved-tab')?.focus();}}} onClick={()=>chooseTab('new')}><span aria-hidden="true">⊕</span> New application</button><button id="visa-saved-tab" role="tab" aria-selected={saved} aria-controls="visa-saved-panel" tabIndex={saved?0:-1} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();chooseTab('new');document.getElementById('visa-new-tab')?.focus();}}} onClick={()=>chooseTab('applications')}><VisaIcon name="documents"/> My applications</button></div>
    </header>
    {saved ? <SavedApplications/> : <section id="visa-new-panel" role="tabpanel" aria-labelledby="visa-new-tab" className="visa-start-card visa-choose-card">
      <h2>Choose your visa</h2><p>Pick your destination, visa type and entry option. Review the configured fees before you start.</p>
      <div className="visa-choose-grid"><label>Country<select value={country} onChange={event=>update({country:event.target.value,service:''})}>{visaDestinations.map(item=><option key={item.code} value={item.code}>{visaDestinationName(item.code)}</option>)}</select></label>
        <fieldset className="visa-type-options"><legend>Visa type</legend>{purposes.map(item=><button type="button" key={item.value} aria-pressed={purpose===item.value} onClick={()=>update({purpose:item.value,service:''})}>{item.label}</button>)}</fieldset>
        <label>Entry &amp; stay<select aria-busy={loading} value={selected?.id || ''} disabled={loading || !selected} onChange={event=>update({service:event.target.value})}>{selected ? available.filter(item=>purposeMatches(item,purpose) || item.id===selected.id).map(item=><option key={item.id} value={item.id}>{[item.entryType,item.validityText].filter(Boolean).join(' · ') || item.name}</option>) : <option value="">{loading?'Loading visa options…':'Confirmed with your visa category'}</option>}</select></label>
      </div>
      {error && <div className="visa-start-notice" role="alert">{error} <button type="button" className="visa-text-link" onClick={()=>setRevision(value=>value+1)}>Retry</button></div>}
      <div className="visa-price-panels" aria-live="polite" aria-busy={loading}><div><h3>Visa &amp; service fees</h3>{loading ? <p>Loading configured fees…</p> : fees.items.length ? <dl>{fees.items.map((item,index)=><div key={index}><dt>{item.label}</dt><dd>{formatMoney(item.amount,selected?.currency)}</dd></div>)}</dl> : <><strong>Quote before payment</strong><small>Our visa team will confirm the fee breakdown.</small></>}</div><div className="visa-online-price"><h3>Configured visa price</h3><strong>{loading?'Checking fees…':fees.total!==null?formatMoney(fees.total,selected?.currency):'Quote before payment'}</strong><small>{fees.total!==null?'Configured charges shown here. Review your final service total before payment.':'Your final price will be confirmed before you pay.'}</small></div></div>
      {selected?.processingTimeText && <p className="visa-start-processing"><VisaIcon name="clock"/>Estimated processing: {selected.processingTimeText}</p>}
      <div className="visa-start-how"><h3>How it works</h3><ol><li>Complete your application, add documents and review payment.</li><li>Flyseri’s visa team reviews your information and supporting documents.</li><li>Our team prepares the next submission steps for your visa category.</li><li>Track updates and download your visa document when it is available.</li></ol></div>
      <VisaFlowActions caption="The relevant authority makes the visa decision.">{loading?<button className="btn-primary" disabled>Loading options…</button>:<Link className="btn-primary" to={'/app/visa/new/applicants?'+nextParams.toString()}>Start application <span aria-hidden="true">→</span></Link>}</VisaFlowActions>
    </section>}
  </main>;
}
