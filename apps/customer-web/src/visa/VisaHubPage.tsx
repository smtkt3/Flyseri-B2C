import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { VisaApplicationSummary, VisaAssistanceRequestSummary } from '@flyseri/types';
import { isSupportedVisaDestination } from '@flyseri/types';
import { visaService } from '../services/visaService';
import { countries, countryName } from '../trip/tripPresentation';
import { visaStatus } from '../account/presentation';
import { useAuth } from '../auth/AuthProvider';
import { VisaFlag, VisaIcon, visaDestinations, visaSteps, matchesVisaDestination, visaDestinationName } from './visa-discovery';
import './visa-discovery.css';

export function VisaHubPage() {
  const {session,resolving} = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchForm = useRef<HTMLFormElement>(null);
  const [region, setRegion] = useState('All destinations');
  const [requests, setRequests] = useState<VisaAssistanceRequestSummary[]>([]);
  const [applications, setApplications] = useState<VisaApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const version = useRef(0);
  async function load() {
    const current = ++version.current;
    if (!session) { setRequests([]); setApplications([]); setLoading(false); setError(''); return; }
    setLoading(true); setError('');
    const results = await Promise.allSettled([visaService.assistanceList(), visaService.list()]);
    if (version.current !== current) return;
    if (results[0].status === 'fulfilled') setRequests(results[0].value);
    if (results[1].status === 'fulfilled') setApplications(results[1].value);
    if (results.some(item => item.status === 'rejected')) setError('Some applications could not be loaded. Please try again.');
    setLoading(false);
  }
  useEffect(() => {
    setRequests([]); setApplications([]); setError('');
    if (resolving) setLoading(true); else void load();
    return () => { version.current++; };
  }, [session?.user.id,resolving]);
  function search(event: FormEvent) {
    event.preventDefault();
    const value = query.trim().toLowerCase();
    const match = countries.find(item => isSupportedVisaDestination(item.code) && matchesVisaDestination(item.code,value,true));
    if (match) navigate('/app/visa/guide/' + match.code);
    else { setSearchError('Choose a country from the suggestions below.'); setSuggestionsOpen(true); }
  }
  const matches = countries.filter(item => isSupportedVisaDestination(item.code) && matchesVisaDestination(item.code,query));
  const suggestions = (query.trim() ? matches : visaDestinations).slice(0,6);
  const destinations = visaDestinations.filter(item => region === 'All destinations' || item.region === region);
  return <main className="account-page visa-discovery-page visa-hub-refined">
    <header className="visa-discovery-hero"><div><span className="visa-kicker"><VisaIcon name="passport"/> FLYSERI VISA SERVICES</span>
      <h1>Your next destination.<br/><em>A simpler visa journey.</em></h1><p>Visa assistance for Bangladeshi nationals. Explore your options, prepare your documents, and let Flyseri guide you through the next steps.</p>
      <form ref={searchForm} className="visa-destination-search" onSubmit={search} onFocusCapture={()=>setSuggestionsOpen(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node | null))setSuggestionsOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();searchForm.current?.querySelector<HTMLInputElement>('input')?.focus();setSuggestionsOpen(false);}}}><label htmlFor="visa-country-search">Where are you travelling?</label><div><span aria-hidden="true"><VisaIcon name="globe"/></span><input id="visa-country-search" value={query} onChange={event => { setQuery(event.target.value); setSearchError(''); setSuggestionsOpen(true); }} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();if(suggestionsOpen)searchForm.current?.querySelector<HTMLAnchorElement>('.visa-country-suggestions a')?.focus();else setSuggestionsOpen(true);}}} placeholder="Search a country, e.g. Malaysia" autoComplete="off" aria-controls={suggestionsOpen ? 'visa-country-suggestions' : undefined} aria-describedby={searchError ? 'visa-search-error' : undefined} aria-invalid={Boolean(searchError)}/><button className="btn-primary" type="submit">Check requirements <span aria-hidden="true">→</span></button></div>
        {searchError && <p id="visa-search-error" role="alert">{searchError}</p>}{suggestionsOpen && <ul id="visa-country-suggestions" className="visa-country-suggestions" aria-label={query.trim()?'Matching destinations':'Popular destinations'} onKeyDown={event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const links=Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a'));const index=links.indexOf(document.activeElement as HTMLAnchorElement);if(event.key==='ArrowUp'&&index===0)searchForm.current?.querySelector<HTMLInputElement>('input')?.focus();else links[(index+(event.key==='ArrowDown'?1:-1)+links.length)%links.length]?.focus();}}>{!query.trim() && <li className="visa-suggestions-label">Popular destinations</li>}{suggestions.map(item => <li key={item.code}><Link to={'/app/visa/guide/' + item.code}><VisaFlag code={item.code}/>{visaDestinationName(item.code)}<span aria-hidden="true">→</span></Link></li>)}{!suggestions.length && <li className="visa-suggestions-empty">No matching country. Try another name.</li>}</ul>}
      </form><div className="visa-hero-assurances"><span><VisaIcon name="check"/> Personal document guidance</span><span><VisaIcon name="check"/> Track your application</span></div></div>
      <div className="visa-hero-visual" aria-hidden="true"><div className="visa-orbit visa-orbit-one"/><div className="visa-orbit visa-orbit-two"/><div className="visa-passport-illustration"><VisaIcon name="globe"/><span>FLYSERI</span><strong>Ready for your<br/>next chapter.</strong><div><VisaIcon name="passport"/> VISA ASSISTANCE</div></div><span className="visa-visual-stamp"><VisaIcon name="check"/> With you, every step</span></div>
    </header>
    <section className="visa-discovery-section" aria-labelledby="visa-popular-heading"><div className="visa-section-heading"><div><span className="visa-kicker">EXPLORE YOUR OPTIONS</span><h2 id="visa-popular-heading">Where would you like to go?</h2><p>Choose a destination to start planning your visa.</p></div><div className="visa-hub-primary-actions"><Link to="/app/visa/new?tab=applications" className="visa-text-link">My applications ↗</Link><Link to="/app/visa/new" className="btn-primary">Start application <span aria-hidden="true">→</span></Link></div></div>
      <div className="visa-filter-tabs" role="group" aria-label="Filter destinations">{['All destinations','Asia','Middle East','Europe'].map(item => <button key={item} type="button" aria-pressed={region === item} onClick={() => setRegion(item)}>{item}</button>)}</div>
      <div className="visa-destination-grid">{destinations.map(item => <Link key={item.code} to={'/app/visa/guide/' + item.code} className="visa-destination-card"><VisaFlag code={item.code}/><strong>{visaDestinationName(item.code)}</strong><small>{item.caption}</small><span><span>Check requirements</span><b aria-hidden="true">→</b></span></Link>)}</div>
      <p className="visa-directory-help">15 destinations · For Bangladeshi nationals only. <Link to="/app/visa/new">Start your visa request →</Link></p>
    </section>
    <section className="visa-discovery-section visa-format-section" aria-labelledby="visa-formats-heading"><div className="visa-section-heading"><div><h2 id="visa-formats-heading">Understand your visa options</h2><p>The right route depends on your passport, destination and reason for travel.</p></div></div><div className="visa-format-grid">{[
      ['screen','e-Visa','An electronic visa issued through an online application. Keep a copy of the approval with your travel documents.'],
      ['passport','Sticker visa','A visa placed in your passport. An appointment, original documents or biometrics may be part of the process.'],
      ['plane','Visa on arrival','Available at the border only for eligible travellers. Check eligibility and required documents before travelling.'],
    ].map(([icon,title,body]) => <article key={title}><span className="visa-icon-tile"><VisaIcon name={icon}/></span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section className="visa-discovery-section visa-how-section" aria-labelledby="visa-how-heading"><div className="visa-section-heading"><div><span className="visa-kicker">FROM PLANNING TO PROGRESS</span><h2 id="visa-how-heading">A little guidance. A clearer journey.</h2><p>Here’s how Flyseri helps with your visa application.</p></div></div><ol className="visa-how-grid">{visaSteps.map((step,index) => <li key={step.title}><span className="visa-step-number">0{index+1}</span><VisaIcon name={step.icon}/><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol><div className="visa-section-actions"><Link className="btn-primary" to="/app/visa/new">Start my application →</Link><Link className="account-outline-button" to="/app/support">Ask the visa team</Link></div></section>
    <section id="visa-my-applications" className="visa-discovery-section" aria-labelledby="visa-applications-heading"><div className="visa-section-heading"><div><h2 id="visa-applications-heading">My visa applications</h2><p>Your saved applications and requests, together in one place.</p></div>{session && <button type="button" className="account-outline-button" disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</button>}</div>
      {!session ? <div className="visa-saved-empty"><VisaIcon name="passport"/><div><h3>Your applications, in one place</h3><p>Browse destinations without an account. Sign in when you’re ready to apply or view your saved applications.</p><Link className="visa-text-link" to="/app/visa/new?tab=applications">Sign in to view applications →</Link></div></div> : <>{error && <p className="visa-discovery-error" role="alert">{error}</p>}{loading && !requests.length && !applications.length ? <p role="status">Loading your applications…</p> : <div className="visa-saved-list">{requests.map(item => <Link key={item.id} to={'/app/visa/assistance/' + item.id + '/documents'}><VisaFlag code={item.destinationCountryCode}/><div><strong>{countryName(item.destinationCountryCode)} · {item.requestReference}</strong><small>{({NEW:'Continue application',IN_REVIEW:'Under review',CONTACTED:'Team update available',CONVERTED:'Application prepared',CLOSED:'Closed'})[item.status]}</small></div><span aria-hidden="true">→</span></Link>)}{applications.map(item => <Link key={item.id} to={'/app/visa-applications/' + item.id}><VisaFlag code={item.destinationCountryCode}/><div><strong>{countryName(item.destinationCountryCode)} · {item.visaTypeName}</strong><small>{visaStatus(item.status)}</small></div><span aria-hidden="true">→</span></Link>)}{!requests.length && !applications.length && !error && <div className="visa-saved-empty"><VisaIcon name="passport"/><div><h3>Your next journey starts here</h3><p>Choose a country above. Your applications will appear here once you begin.</p></div></div>}</div>}</>}
    </section><p className="visa-discovery-footnote">Flyseri provides visa application assistance. Visa approval and entry decisions are made by the relevant authorities.</p>
  </main>;
}
