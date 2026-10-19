import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isSupportedVisaDestination, type VisaType } from '@flyseri/types';
import { visaService } from '../services/visaService';
import { formatMoney } from '../account/presentation';
import { useAuth } from '../auth/AuthProvider';
import { visaServiceFees, visaPurposeMatches } from './visaPricing';
import { VisaFlag, VisaIcon, visaDestinations, visaDestinationName, matchesVisaDestination } from './visa-discovery';
import { countryGuides, guideContacts, guideDocuments, guideSamples, officialVisaSources, professionDescriptions, professionOptions, malaysiaDocumentSources } from './visa-guide-content';
import { VisaCountryMap } from './VisaCountryMap';
import { VisaHeroSlideshow } from './VisaHeroSlideshow';
import { MalaysiaTravelRules } from './MalaysiaTravelRules';
import { DestinationTravelRules } from './DestinationTravelRules';
import { destinationGuidance, destinationPurposeSource } from './destination-guidance';
import { visaReferenceFacts } from './visa-reference-facts';
import './visa-discovery.css';
import './visa-reference-guide.css';
import './visa-reference-mobile.css';
import { VisaDocumentChecklist } from './VisaDocumentChecklist';

const sections = [['overview','Overview'],['documents','Documents'],['fees','Fees'],['process','Process'],['samples','Samples'],['destination','About'],['travel','Travel rules'],['embassy','Embassy']];
const purposeLabels:Record<string,string> = {Tourism:'Tourist',Study:'Student',Business:'Business','Family visit':'Family visit'};
export function VisaDestinationPage() {
  const {session} = useAuth();
  const {countryCode=''} = useParams<{countryCode:string}>();
  const code = countryCode.toUpperCase();
  const valid = isSupportedVisaDestination(code);
  const name = visaDestinationName(code);
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const purpose = Object.keys(purposeLabels).includes(params.get('purpose') || '') ? params.get('purpose')! : 'Tourism';
  const purposeLabel = purposeLabels[purpose];
  const [countrySearch,setCountrySearch] = useState(name);
  const [countryError,setCountryError] = useState('');
  const [profession,setProfession] = useState(professionOptions[0]);
  const [services,setServices] = useState<VisaType[]>([]);
  const [serviceId,setServiceId] = useState('');
  const [loading,setLoading] = useState(true);
  const [serviceError,setServiceError] = useState(false);
  const [revision,setRevision] = useState(0);
  const [active,setActive] = useState('overview');
  const [sample,setSample] = useState<typeof guideSamples[number] | null>(null);
  const sampleDialog = useRef<HTMLDialogElement>(null);
  const sectionNav = useRef<HTMLElement>(null);
  const guidePage = useRef<HTMLElement>(null);
  const [downloadBusy,setDownloadBusy] = useState(false);
  const [downloadError,setDownloadError] = useState('');
  const [copied,setCopied] = useState(false);

  useEffect(() => {
    if (!window.matchMedia('(max-width:760px)').matches) return;
    const nav = sectionNav.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current]');
    if (nav && link) nav.scrollTo({left:Math.max(0,link.offsetLeft-(nav.clientWidth-link.offsetWidth)/2),behavior:'instant'});
  },[active]);

  useEffect(() => {
    setCountrySearch(name);setCountryError('');
    const section=window.location.hash.replace('#visa-guide-','');
    setActive(sections.some(([id])=>id===section) ? section : 'overview');
    setCopied(false);setDownloadError('');
  },[name]);
  useEffect(() => {
    let current = true;
    setServices([]);setServiceId('');setLoading(true);setServiceError(false);
    if(!valid){setLoading(false);return;}
    void visaService.publicCatalogue(code).then(items => {if(current) setServices(items);},() => {if(current) setServiceError(true);}).finally(() => {if(current) setLoading(false);});
    return () => {current=false;};
  },[code,valid,revision]);
  useEffect(() => {
    setServiceId(services.find(item=>visaPurposeMatches(item,purpose))?.id || '');
  },[services,purpose]);
  useEffect(() => {
    const dialog=sampleDialog.current;
    if(sample && dialog && !dialog.open) dialog.showModal();
    if(!sample && dialog?.open) dialog.close();
  },[sample]);
  useEffect(() => {
    if(!valid) return;
    let frame = 0;
    const measureActive = () => {
      frame = 0;
      const anchor = (sectionNav.current?.getBoundingClientRect().bottom || 0) + 32;
      const candidates = [...document.querySelectorAll<HTMLElement>('.visa-reference-page section[id^="visa-guide-"]')]
        .map(element => ({element,rect:element.getBoundingClientRect()}))
        .filter(item => item.rect.top <= anchor && item.rect.bottom > anchor)
        .sort((a,b) => b.rect.top-a.rect.top);
      if(candidates[0]) setActive(candidates[0].element.id.replace('visa-guide-',''));
    };
    const schedule = () => {if(!frame) frame=requestAnimationFrame(measureActive);};
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    schedule();
    return () => {
      window.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',schedule);
      cancelAnimationFrame(frame);
    };
  },[code,valid,purpose]);
  useEffect(() => {
    if(!valid) return;
    const header=document.querySelector<HTMLElement>('.flyseri-site-navbar');
    const measure=()=>{
      // Desktop's header scrolls away; the mobile header stays sticky.
      const headerPosition=header ? getComputedStyle(header).position : '';
      const headerBottom=header && (headerPosition==='sticky' || headerPosition==='fixed') ? Math.max(0,Math.round(header.getBoundingClientRect().bottom)) : 0;
      const stripHeight=sectionNav.current?.getBoundingClientRect().height || 54;
      const pageScrollPadding=Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      sectionNav.current?.style.setProperty('--visa-sections-top',`${headerBottom}px`);
      guidePage.current?.style.setProperty('--visa-anchor-offset',`${Math.max(0,headerBottom+stripHeight+20-pageScrollPadding)}px`);
    };
    const schedule=measure;
    const observer=typeof ResizeObserver==='undefined' ? null : new ResizeObserver(schedule);
    if(header) observer?.observe(header);
    if(sectionNav.current) observer?.observe(sectionNav.current);
    window.addEventListener('resize',schedule);
    window.addEventListener('scroll',schedule,{passive:true});
    measure();
    return ()=>{observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule);};
  },[code,valid]);

  const destination=visaDestinations.find(item=>item.code===code);
  const about=countryGuides[code];
  const source=officialVisaSources[code];
  const contacts=valid ? guideContacts(code,name,purpose) : [];
  const purposeServices=services.filter(item=>visaPurposeMatches(item,purpose));
  const service=purposeServices.find(item=>item.id===serviceId);
  const documents=guideDocuments(code,purpose,profession);
  const countryGuidance=destinationGuidance[code];
  const purposeSource=destinationPurposeSource(code,purpose);
  const student=purpose==='Study';
  const documentSource = code==='MY' ? student ? malaysiaDocumentSources.student : malaysiaDocumentSources.tourist : purposeSource?.url || source?.url || '';
  const title=`${name} ${purposeLabel} Visa`;
  const applyUrl='/app/visa/new?'+new URLSearchParams({country:code,purpose,...(service ? {service:service.id} : {})}).toString();
  const malaysiaTourist=code==='MY' && purpose==='Tourism';
  const malaysiaStudent=code==='MY' && purpose==='Study';
  const reference=visaReferenceFacts(code,purpose);
  const processing=service?.processingTimeText || reference?.processingEstimate || 'Processing depends on the application route and any additional review. Check the official category guidance before planning travel.';
  const pricing = visaServiceFees(service);
  const fees = pricing.items;
  const processingLabel = service?.processingTimeText ? 'Published processing estimate' : 'Authority processing';
  const facts = malaysiaStudent ? [
    {label:'Approval route',value:'Institution & EMGS',help:'Initial student-pass application'},
    {label:'Entry visa',value:'After eVAL approval',help:'Follow the Visa With Reference route'},
    {label:'Student pass',value:'Endorsement after arrival',help:'Follow your institution’s instructions'},
    {label:'Processing',value:service?.processingTimeText || 'Confirm with institution',help:'Separate approval and entry-visa stages'},
  ] : student && countryGuidance ? [
    {label:'Visa route',value:'Study / student permission',help:'Separate from a tourist visit'},
    {label:'Before applying',value:'Institution admission',help:'Confirm required sponsor approvals'},
    {label:'After arrival',value:'Follow study formalities',help:'Registration or residence where required'},
    {label:processingLabel,value:service?.processingTimeText || 'Confirm with institution',help:'Allow for approval and visa stages'},
  ] : reference ? reference.facts : [
    {label:'Visa category',value:purposeLabel+' visit',help:'Choose the official route for this purpose'},
    {label:'Purpose evidence',value:purpose==='Business'?'Business invitation':'Host & relationship documents',help:'Follow the destination’s category checklist'},
    {label:'Entry conditions',value:'Set in the issued permission',help:'Read entries, validity and stay separately'},
    {label:processingLabel,value:service?.processingTimeText || 'Category-specific review',help:'Appointments and additional checks can add time'},
  ];
  const overviewParagraphs = malaysiaStudent ? [
    'Bangladeshi students need an offer from a Malaysian institution and the student-pass approval process through EMGS. Prepare the initial application before arranging the later entry-visa stage.',
    'After eVAL approval, follow the applicable Visa With Reference / e-Visa route. Your entry visa and your student pass are separate documents; the institution guides the pass endorsement after arrival.',
  ] : service?.description ? [service.description] : malaysiaTourist ? [
    'Malaysia’s social-visit e-Visa provides an online route for eligible Bangladeshi passport holders visiting for tourism.',
    'A standard Single Entry Visa can be used for one journey within six months of issuance, with a stay of up to 30 days. Your issued visa and the authority’s decision determine the conditions of your visit.',
  ] : [
    countryGuidance ? student ? countryGuidance.studyRoute : purpose==='Tourism' ? countryGuidance.visitorRoute : `This guide helps Bangladeshi passport holders prepare for a ${purposeLabel.toLowerCase()} visit to ${name}. Confirm the category and invitation requirements for this purpose.` : `Prepare for your visit to ${name}.`,
    'The correct visa route and supporting evidence depend on your purpose, residence and applicant circumstances. Confirm the applicable category with the official authority before arranging travel.',
  ];
  function search(event:FormEvent) {
    event.preventDefault();
    const match=visaDestinations.find(item=>matchesVisaDestination(item.code,countrySearch,true));
    if(!match){setCountryError('Choose one of our 15 visa destinations.');return;}
    if(match.code===code){setCountryError('');return;}
    const nextPurpose=match.code==='MY'&&!['Tourism','Study'].includes(purpose)?'Tourism':purpose;
    navigate('/app/visa/guide/'+match.code+'?'+new URLSearchParams({purpose:nextPurpose}));
  }
  async function download() {
    if(downloadBusy) return;
    setDownloadBusy(true);setDownloadError('');
    try {
      const {createVisaChecklistPdf}=await import('./visaChecklistPdf');
      const pdf=await createVisaChecklistPdf({title,profession:student?'Student applicant':profession,documents,source:documentSource,additionalSources:code==='MY'&&purpose==='Study'?[malaysiaDocumentSources.tourist]:[]});
      pdf.save(`Flyseri-${code}-${purposeLabel.replace(/\s/g,'-')}-checklist.pdf`);
    } catch {setDownloadError('We couldn’t prepare your checklist. Please try again.');}
    finally {setDownloadBusy(false);}
  }
  async function copyLink() {
    try {await navigator.clipboard.writeText(window.location.origin+window.location.pathname+window.location.search);setCopied(true);}
    catch {setDownloadError('Copy the page address from your browser to share this guide.');}
  }
  if(!valid) return <main className="account-page visa-discovery-page"><h1>Choose a visa destination</h1><p>This destination is not currently offered.</p><Link className="btn-primary" to="/app/visa">View visa destinations →</Link></main>;

  return <main ref={guidePage} className="account-page visa-discovery-page visa-guide-page visa-reference-page">
    <header className="visa-reference-hero has-photo-slideshow">
      <VisaHeroSlideshow key={code} countryCode={code}/>
      <nav className="visa-breadcrumb" aria-label="Breadcrumb"><Link to="/app/visa">Visa</Link><span aria-hidden="true">›</span><span>{name}</span><span aria-hidden="true">›</span><strong>{purposeLabel} Visa</strong></nav>
      <div className="visa-reference-heading-row"><div className="visa-reference-title"><VisaFlag code={code}/><div><h1>{title}</h1><p>For Bangladeshi passport holders · {name.toUpperCase()}</p></div></div><div className="visa-reference-header-action"><div className="visa-reference-header-price"><span>Visa assistance price</span><strong aria-live="polite">{loading ? 'Checking fees…' : pricing.total!==null ? formatMoney(pricing.total,service?.currency) : 'Quote before payment'}</strong>{pricing.total!==null && <small>Per applicant · configured fees included</small>}</div><Link className="btn-primary" to={applyUrl}>Apply online <span aria-hidden="true">→</span></Link><small>{session ? 'Next: choose your visa option' : 'Sign in or create an account to apply'}</small></div></div>
      <div className="visa-reference-controls">
      <span className="visa-reference-format"><VisaIcon name="passport"/>{code==='MY' ? purpose==='Study' ? 'Student visa · approval required' : malaysiaTourist ? 'e-Visa' : 'Visa assistance' : 'Visa assistance'}</span>
      <form className="visa-reference-country-search" onSubmit={search}><label className="visa-visually-hidden" htmlFor="visa-guide-country">Destination country</label><VisaIcon name="globe"/><input id="visa-guide-country" list="visa-guide-destinations" value={countrySearch} onChange={event=>{setCountrySearch(event.target.value);setCountryError('');}} autoComplete="off" aria-invalid={Boolean(countryError)} aria-describedby={countryError ? 'visa-guide-country-error' : undefined}/><datalist id="visa-guide-destinations">{visaDestinations.map(item=><option key={item.code} value={visaDestinationName(item.code)}/>)}</datalist><button className="btn-primary" type="submit">Go <span aria-hidden="true">→</span></button></form>
      {countryError && <p className="visa-discovery-error" id="visa-guide-country-error" role="alert">{countryError}</p>}
      <div className="visa-reference-purpose" role="group" aria-label="Visa purpose">{(code==='MY' ? ['Tourism','Study'] : ['Tourism','Study','Business','Family visit']).map(item=><button key={item} type="button" aria-pressed={purpose===item} onClick={()=>setParams({purpose:item},{replace:true})}>{purposeLabels[item]}</button>)}</div>
      </div>
      {reference && <p className="visa-reference-facts-note"><strong>Reference visa: {reference.category}</strong></p>}
      <dl className="visa-reference-quick-facts">{facts.map(fact=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd><small>{fact.help}</small></div>)}</dl>
      <p className="visa-reference-facts-note">{reference ? <>{reference.note || 'Published reference terms; your issued visa and the immigration decision control your actual conditions.'} {reference.sources.map((item,index)=><span key={item.url}>{index>0?' · ':''}<a href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a></span>)} · Reviewed 19 October 2026</> : <>Conditions depend on your visa category and the authority’s decision. <a href={malaysiaStudent ? malaysiaDocumentSources.student : purposeSource?.url || source.url} target="_blank" rel="noreferrer">Official guidance ↗</a></>}</p>
    </header>
    <nav ref={sectionNav} className="visa-reference-nav" aria-label="Visa guide sections">{sections.map(([id,label])=><a key={id} href={'#visa-guide-'+id} aria-current={active===id ? 'location' : undefined} onClick={()=>setActive(id)}>{id==='destination' ? 'About '+name : label}</a>)}</nav>

    <section id="visa-guide-overview" className="visa-discovery-section visa-reference-overview">
      <h2>Overview</h2>
      <div className="visa-reference-overview-copy">
      {overviewParagraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}
      <p>Complete your applicant information and supporting documents through Flyseri. Our team reviews your details and advises on the submission steps. You can follow your application and view available documents in your account.</p>
      </div>
      {purposeServices.length>0 && <label className="visa-service-select">Visa service<select value={serviceId} onChange={event=>setServiceId(event.target.value)}><option value="">Help me choose the right visa service</option>{purposeServices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {malaysiaStudent ? <div className="visa-reference-eligibility"><h3><VisaIcon name="person"/> Who can apply</h3><div><span className="visa-reference-check"><VisaIcon name="check"/></span><div><h4>New international students</h4><p>Bangladeshi applicants holding an offer from a Malaysian university or college and meeting its admission requirements.</p><ul><li>Prepare the initial EMGS documents, including academic and health-declaration records.</li><li>Obtain the required approval before the entry-visa stage.</li><li>Complete the arrival and student-pass endorsement steps with your institution.</li></ul></div></div></div> : student ? <div className="visa-reference-eligibility"><h3><VisaIcon name="person"/> Who can apply</h3><div><span className="visa-reference-check"><VisaIcon name="check"/></span><div><h4>Students with institution support</h4><p>{countryGuidance?.studyRoute}</p><ul><li>Confirm admission, the applicable study category and sponsor approvals before applying.</li><li>Prepare the institution and authority’s study checklist, including funding and academic evidence where required.</li><li>Follow the conditions on your entry permission and complete the required arrival formalities.</li></ul></div></div></div> : <div className="visa-reference-eligibility"><h3><VisaIcon name="person"/> Who can apply</h3><div><span className="visa-reference-check"><VisaIcon name="check"/></span><div><h4>Basic eligibility</h4><p>Bangladeshi passport holders applying for the appropriate visa category, with valid travel documents and the required supporting evidence.</p><ul><li>Have a genuine purpose for the visit and accurate applicant details.</li><li>Be able to explain your itinerary, accommodation and how the visit will be funded.</li><li>Meet the relevant authority’s current requirements. Approval is not guaranteed.</li></ul></div></div></div>}
      <div className="visa-reference-overview-actions"><Link className="btn-primary" to={applyUrl}>Apply online <span aria-hidden="true">→</span></Link><div><button type="button" disabled={downloadBusy} onClick={()=>void download()}>{downloadBusy ? 'Preparing PDF…' : 'Download checklist PDF'}</button><span aria-hidden="true"> · </span><button type="button" onClick={()=>void copyLink()}>{copied ? 'Link copied ✓' : 'Share guide'}</button></div><p>Questions? <Link to="/app/support">Ask the Flyseri visa team →</Link></p>{downloadError && <p role="alert" className="visa-discovery-error">{downloadError}</p>}</div>
    </section>

    <div className="visa-reference-layout"><div className="visa-reference-column visa-reference-left">
      <section id="visa-guide-documents" className="visa-discovery-section"><h2>Required documents</h2><p className="visa-reference-muted">{code==='MY'&&purpose==='Study' ? 'New student-pass checklist for Bangladeshi applicants. Initial EMGS documents and the later eVAL / entry-visa stage are identified separately. This is not a renewal checklist.' : student ? 'Study preparation checklist for Bangladeshi applicants. Confirm institution approvals, entry permission and later residence formalities for this destination.' : 'Choose the applicant’s profession. Core documents and conditional supporting evidence are labelled below; occupation examples are not universal requirements.'}</p>{!student && <><div className="visa-reference-professions" role="group" aria-label="Applicant profession">{professionOptions.map(item=><button key={item} type="button" aria-pressed={profession===item} onClick={()=>setProfession(item)}>{item}</button>)}</div><p className="visa-reference-profession-caption">{professionDescriptions[profession]}</p></>}<VisaDocumentChecklist key={code+purpose} documents={documents}/><p className="visa-reference-source-note">The final checklist depends on your visa category and circumstances. <a href={documentSource} target="_blank" rel="noreferrer">{code==='MY'&&purpose==='Study'?'EMGS student-pass requirements ↗':'Official requirements ↗'}</a>{code==='MY'&&purpose==='Study' && <> · <a href={malaysiaDocumentSources.tourist} target="_blank" rel="noreferrer">MYVISA e-Visa stage ↗</a></>}{code==='MY' ? <> · Checked 18 October 2026</> : <> · Destination guidance reviewed 19 October 2026</>}</p></section>
      <section id="visa-guide-fees" className="visa-discovery-section"><h2>Fees & charges</h2>{loading ? <p role="status">Loading fee details…</p> : serviceError ? <div><p>Fee details are temporarily unavailable.</p><button className="account-outline-button" type="button" onClick={()=>setRevision(value=>value+1)}>Try again</button></div> : fees.length ? <><p>Visa and processing fees for {service?.name}:</p><dl className="visa-reference-fees">{fees.map((item,index)=><div key={index}><dt>{item.label}</dt><dd>{formatMoney(item.amount,service?.currency)}</dd></div>)}</dl></> : <><p>Visa and processing fees for Bangladeshi applicants:</p><dl className="visa-reference-fees"><div><dt>Government / embassy fee</dt><dd>Confirmed with your visa category</dd></div><div><dt>Flyseri processing & service fee</dt><dd>Quote before payment</dd></div></dl><Link className="visa-text-link" to="/app/support">Request a fee quote →</Link></>}<p className="visa-reference-source-note">Review the complete breakdown and applicable refund terms before payment. Fees may vary by category, entry type and authority charges.</p>{service?.notes && <p>{service.notes}</p>}</section>
      <section id="visa-guide-process" className="visa-discovery-section"><h2>Processing time & steps</h2><div className="visa-reference-timing-stages"><div><span>Flyseri review & preparation</span><strong>Confirmed after document review</strong><p>Our team checks your documents and confirms the preparation and submission schedule.</p></div><div><span>{processingLabel}</span><strong>{processing}</strong><p>{malaysiaTourist && !service?.processingTimeText ? 'Starts after complete submission and payment. Excludes Flyseri preparation, holidays, additional-document requests and interviews.' : reference?.processingEstimate && !service?.processingTimeText ? 'The official estimate starts at the stage specified above. Flyseri preparation, appointment waiting and additional authority checks can add time.' : 'Confirm whether this estimate includes preparation. Authority timing depends on complete documents, appointments and workload.'}</p></div></div><p className="visa-reference-source-note">Processing estimates are not guaranteed. Allow extra time before travel.</p><ol className="visa-reference-process">{(malaysiaStudent ? [
        ['Offer & EMGS application','Prepare the institution offer, academic records and initial student-pass documents. Confirm the submission route with your institution.'],
        ['Student approval / eVAL','Follow EMGS and immigration review through your institution. Respond to requests before proceeding to the entry visa.'],
        ['Entry-visa stage','After eVAL approval, follow the applicable MYVISA Visa With Reference route and check your issued documents before travel.'],
        ['Arrival & student-pass endorsement','Follow the institution’s arrival instructions, complete the required medical screening and arrange student-pass endorsement.'],
      ] : student ? [
        ['Admission & category','Confirm the institution offer, study route and sponsor or authority approvals.'],
        ['Prepare & review documents','Add your study documents for Flyseri review and confirm the submission arrangements.'],
        ['Approval & entry permission','Follow the institution and authority’s approval sequence, appointments and visa requirements.'],
        ['Arrival & study formalities','Check issued permission before travelling and complete required registration or residence formalities.'],
      ] : [
        ['Apply online with Flyseri','Complete the application, add documents and review the service fee before payment.'],
        ['Document & information review','The Flyseri visa team checks your information and requests any missing items.'],
        ['Application submission','Follow the confirmed submission route, including appointments or original documents where required.'],
        ['Decision & visa documents','Follow the updates in your application and view the available decision or visa documents.'],
      ]).map(([heading,body],index)=><li key={heading}><span>{index+1}</span><div><h3>{heading}</h3><p>{body}</p></div></li>)}</ol></section>
      <section id="visa-guide-samples" className="visa-discovery-section"><h2>Sample documents & photos</h2><div className="visa-reference-samples">{guideSamples.map(item=><figure key={item.id}><button type="button" onClick={()=>setSample(item)} aria-label={'Preview '+item.title.toLowerCase()+' sample'}><img src={item.src} alt={item.title+' layout illustration'} loading="lazy"/><span aria-hidden="true">⌕</span></button><figcaption><strong>{item.title}</strong><span>{item.caption}</span></figcaption></figure>)}</div><p className="visa-reference-source-note">Illustrations show document layout and scan quality. They are not issued visas or travel documents.</p></section>
    </div><div className="visa-reference-column visa-reference-right">
      <section id="visa-guide-destination" className="visa-discovery-section"><h2>About {name}</h2><VisaCountryMap key={code} code={code} name={name}/><p>{about.description}</p><dl className="visa-reference-country-facts">{[
        [code==='ID' ? 'Major travel hub' : 'Capital',destination?.capital || (code==='ID' ? 'Jakarta' : '—'),'globe'],['Currency',destination?.currency || '—','documents'],['Language',about.language,'documents'],['Calling code',about.callingCode,'person'],['Time zone',about.timeZone,'clock'],['Region',destination?.region || '—','globe'],
      ].map(([label,value,icon])=><div key={label}><dt><VisaIcon name={icon}/>{label}</dt><dd>{value}</dd></div>)}</dl><h3 className="visa-reference-subheading"><VisaIcon name="globe"/> Major cities</h3><div className="visa-reference-city-list">{about.cities.map(city=><span key={city}>{city}</span>)}</div><h3 className="visa-reference-subheading"><VisaIcon name="globe"/> Weather</h3><p>{about.weather}</p></section>
      <section id="visa-guide-travel" className="visa-discovery-section"><h2>Travel rules</h2>{code==='MY' ? <MalaysiaTravelRules student={malaysiaStudent}/> : <DestinationTravelRules code={code} student={student}/>}</section>
      <section id="visa-guide-embassy" className="visa-discovery-section"><h2>Embassy & contacts</h2><div className="visa-reference-contacts">{contacts.map(contact=><article key={contact.title}><h3>{contact.title}</h3>{contact.description && <p>{contact.description}</p>}{contact.address && <p className="visa-contact-detail"><VisaIcon name="globe"/>{contact.address}</p>}{contact.phone && <a className="visa-contact-detail" href={'tel:'+contact.phone.replace(/\s/g,'')}><VisaIcon name="person"/>{contact.phone}</a>}{contact.email && <a className="visa-contact-detail" href={'mailto:'+contact.email}><VisaIcon name="documents"/>{contact.email}</a>}{contact.hours && <p className="visa-contact-detail"><VisaIcon name="clock"/>{contact.hours}</p>}<div className="visa-contact-actions">{contact.address && <a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(contact.address)} target="_blank" rel="noreferrer">Directions ↗</a>}<a href={contact.url} target="_blank" rel="noreferrer">Official website ↗</a></div></article>)}</div></section>
      <section className="visa-discovery-section visa-reference-notes"><h2>Important notes</h2><p>Visa approval, refusal, requests for additional documents and processing times are determined by the relevant authority. Flyseri assists with the application and cannot guarantee approval or entry.</p><p>Keep your information accurate and respond promptly to any document or interview request. Check current requirements before travel.</p>{service?.disclaimers?.map((text,index)=><p key={index}>{text}</p>)}</section>
    </div></div>
    <p className="visa-reference-bottom-note">For Bangladeshi nationals only. Requirements can change; confirm the current checklist with the Flyseri visa team and the official authority before applying.</p>
    <div className="visa-guide-mobile-action"><div><small>{name} · {purposeLabel}</small><strong aria-live="polite">{loading ? 'Checking fees…' : pricing.total!==null ? formatMoney(pricing.total,service?.currency) : 'Quote before payment'}</strong></div><Link className="btn-primary" to={applyUrl}>Apply online →</Link></div>
    <dialog ref={sampleDialog} className="visa-sample-dialog" onClose={()=>setSample(null)} onCancel={()=>setSample(null)}><div><h2>{sample?.title}</h2><button type="button" onClick={()=>setSample(null)} aria-label="Close sample preview">×</button></div>{sample && <><img src={sample.src} alt={sample.title+' layout illustration'}/><p>{sample.caption}. Illustration only; not a valid travel document.</p></>}</dialog>
  </main>;
}
