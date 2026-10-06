import { SavedVisaJourneyProgress } from './SavedVisaJourneyProgress';
import { VisaAssistanceRequestPage } from './VisaAssistanceRequestPage';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DocumentSummary, DocumentType, VisaAssistanceRequestDetail } from '@flyseri/types';
import { visaService } from '../services/visaService';
import { documentService } from '../services/documentService';
import { VisaApplicantReview, ReviewFields, reviewCountry, reviewDate } from './VisaApplicantReview';
import './visa-application.css';
interface UploadCategory { key: string; type: DocumentType; title: string; description: string; group: string }
export const uploadCategories: UploadCategory[] = [
  { key:'passport', type:'PASSPORT', group:'Identity & immigration', title:'Passport', description:'Passport information page and any relevant stamped or visa pages. Add each page as a separate file or one PDF.' },
  { key:'travel-document', type:'TRAVEL_DOCUMENT', group:'Identity & immigration', title:'Other travel document', description:'Travel document or certificate used instead of a passport, if applicable.' },
  { key:'national-id', type:'NATIONAL_ID', group:'Identity & immigration', title:'National identity card', description:'Clear copies of the front and back of the applicant’s identity card.' },
  { key:'photo', type:'PASSPORT_PHOTO', group:'Identity & immigration', title:'Applicant photograph', description:'A recent photograph. Flyseri will confirm the required background, dimensions and format.' },
  { key:'residence', type:'RESIDENCE_PERMIT', group:'Identity & immigration', title:'Residence permit', description:'Current residence permit, long-term pass or evidence of lawful residence, if applicable.' },
  { key:'previous-visa', type:'PREVIOUS_VISA', group:'Identity & immigration', title:'Previous visas', description:'Previous visas, entry stamps or other travel history you would like our team to review.' },
  { key:'itinerary', type:'OTHER', group:'Travel & accommodation', title:'Flight booking or travel itinerary', description:'Flight reservation, proposed route or travel itinerary. A paid ticket is not requested at this preparation step.' },
  { key:'hotel', type:'OTHER', group:'Travel & accommodation', title:'Accommodation or hotel booking', description:'Hotel reservation, accommodation details or host address for the planned visit.' },
  { key:'insurance', type:'OTHER', group:'Travel & accommodation', title:'Travel insurance', description:'Insurance policy or coverage certificate, if you already have one.' },
  { key:'invitation', type:'OTHER', group:'Travel & accommodation', title:'Invitation or host letter', description:'Invitation from a host, business, event organizer or family member, if applicable.' },
  { key:'bank', type:'BANK_STATEMENT', group:'Finances & sponsorship', title:'Bank statements', description:'Account statements showing the applicant’s financial situation. The period needed will be confirmed by Flyseri.' },
  { key:'income', type:'OTHER', group:'Finances & sponsorship', title:'Income or tax records', description:'Payslips, income evidence, tax records or other financial supporting documents.' },
  { key:'sponsor', type:'OTHER', group:'Finances & sponsorship', title:'Sponsorship documents', description:'Sponsor letter, sponsor identity and financial evidence, where someone else will support the visit.' },
  { key:'employment', type:'EMPLOYMENT_LETTER', group:'Work, business & study', title:'Employment or leave letter', description:'Employment confirmation, employer letter or approved leave for the planned trip.' },
  { key:'business', type:'COMPANY_DOCUMENT', group:'Work, business & study', title:'Business or company documents', description:'Business registration, company records or supporting business correspondence.' },
  { key:'study', type:'OTHER', group:'Work, business & study', title:'Student or education documents', description:'Enrollment letter, admission letter, student ID or relevant academic records.' },
  { key:'marriage', type:'MARRIAGE_CERTIFICATE', group:'Family & dependants', title:'Marriage certificate', description:'Marriage or relationship evidence, if relevant to the visit.' },
  { key:'birth', type:'BIRTH_CERTIFICATE', group:'Family & dependants', title:'Birth certificate', description:'Applicant’s birth certificate or evidence of family relationships, if applicable.' },
  { key:'consent', type:'OTHER', group:'Family & dependants', title:'Parental consent or guardianship', description:'Consent letter, guardianship or custody documents for a child travelling, where applicable.' },
  { key:'cover', type:'OTHER', group:'Additional supporting records', title:'Cover letter or explanation', description:'Explain the purpose of travel, circumstances or details you would like our team to understand.' },
  { key:'translation', type:'OTHER', group:'Additional supporting records', title:'Translations or certified copies', description:'Translations, certified copies or supporting originals associated with another document.' },
  { key:'other', type:'OTHER', group:'Additional supporting records', title:'Other supporting documents', description:'Any additional documents requested by Flyseri or relevant to your application.' },
];
const documentGroups = [...new Set(uploadCategories.map(category => category.group))];
function categoryForDocument(doc: VisaAssistanceRequestDetail['documents'][number], vault: DocumentSummary[]) {
  const name = vault.find(item => item.id === doc.documentId)?.displayName;
  return uploadCategories.find(category => name?.startsWith(category.title + ' · '))?.key
    || uploadCategories.find(category => category.type === doc.documentType && category.type !== 'OTHER')?.key || 'other';
}
function CategoryIcon({ group }: { group: string }) {
  const paths: Record<string,string> = {
    'Identity & immigration': 'M4 5h16v14H4z M8 9h2v3H8z M13 9h4 M13 13h4 M7 16h10',
    'Travel & accommodation': 'M3 12l18-8-7 17-3-7-8-2z M11 14l5-5',
    'Finances & sponsorship': 'M3 9l9-5 9 5 M5 10v9 M10 10v9 M14 10v9 M19 10v9 M3 20h18',
    'Work, business & study': 'M4 8h16v12H4z M9 8V4h6v4 M4 13h16 M10 13v3h4v-3',
    'Family & dependants': 'M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M16 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M3 20v-3a5 5 0 0 1 10 0v3 M15 14a4 4 0 0 1 6 4v2',
    'Additional supporting records': 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[group] || paths['Additional supporting records']} /></svg>;
}
export function VisaAssistanceDocumentsPage() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<VisaAssistanceRequestDetail | null>(null);
  const [policy, setPolicy] = useState<{ maxUploadMb: number; acceptedTypes: string[] } | null>(null);
  const [vault, setVault] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState('');
  const [documentWarning, setDocumentWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const pageStep = searchParams.get('step');
  const savedDetails = pageStep === 'choose' || pageStep === 'form';
  const review = pageStep === 'review';
  function setReview(value: boolean) { const next = new URLSearchParams(searchParams); if (value) next.set('step','review'); else next.delete('step'); setSearchParams(next); }
  const [activeGroups, setActiveGroups] = useState<Record<string,string>>({});
  const [searches, setSearches] = useState<Record<string,string>>({});
  const [savedNote, setSavedNote] = useState('');
  const [noteStatus, setNoteStatus] = useState('');
  const [additionalNote, setAdditionalNote] = useState('');
  const [consent, setConsent] = useState(false);
  const loadVersion = useRef(0);
  useEffect(() => { setConsent(false); }, [review, requestId]);
  const [pending, setPending] = useState<{ travellerId: string; documentId: string; versionId: string } | null>(null);
  async function load() {
    const version = ++loadVersion.current;
    setLoading(true); setError(''); setDocumentWarning('');
    try {
      const [request, uploadPolicy, documents] = await Promise.allSettled([visaService.assistanceDetail(requestId), documentService.policy(), documentService.list()]);
      if (version !== loadVersion.current) return;
      if (request.status === 'rejected') throw request.reason;
      setData(request.value); setAdditionalNote(request.value.customerMessage || ''); setSavedNote(request.value.customerMessage || '');
      setPolicy(uploadPolicy.status === 'fulfilled' ? uploadPolicy.value : null);
      setVault(documents.status === 'fulfilled' ? documents.value : []);
      setDocumentWarning([uploadPolicy.status === 'rejected' ? 'New uploads are temporarily unavailable.' : '', documents.status === 'rejected' ? 'Your saved document library is temporarily unavailable.' : ''].filter(Boolean).join(' '));
    } catch (e) { if (version === loadVersion.current) setError(e instanceof Error ? e.message : 'We could not load your saved application.'); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => {
    setData(null); setPolicy(null); setVault([]); setPending(null); setNoteStatus(''); setActiveGroups({}); setSearches({});
    void load();
    return () => { loadVersion.current++; };
  }, [requestId]);
  async function attach(file: { travellerId: string; documentId: string; versionId: string }) {
    setData(await visaService.assistanceLink(requestId, file.travellerId, file.documentId, file.versionId)); setPending(null);
  }
  async function upload(travellerId: string, category: UploadCategory, files: File[]) {
    if (!files.length || busy || pending || !policy) return;
    setError('');
    if (files.some(file => !policy.acceptedTypes.includes(file.type) || file.size === 0 || file.size > policy.maxUploadMb * 1024 * 1024)) { setError('Choose PDF, JPG or PNG files within the displayed size limit. No files from this selection were uploaded.'); return; }
    setBusy(travellerId + category.key);
    try {
      for (const file of files) {
        const doc = await documentService.create({ travellerId, documentType: category.type, displayName: (category.title + ' · ' + file.name).slice(0,160) });
        const uploaded = await documentService.upload(doc.id, file, crypto.randomUUID());
        if (!uploaded.currentVersion) throw new Error('The upload is not ready. Please try again.');
        const link = { travellerId, documentId: doc.id, versionId: uploaded.currentVersion.id };
        setVault(previous => [...previous.filter(item => item.id !== doc.id), uploaded]);
        setPending(link); await attach(link);
      }
    } catch (e) { setError((e instanceof Error ? e.message : 'Upload failed.') + ' Previously saved files are kept. Retry any remaining files.'); }
    finally { setBusy(''); }
  }
  async function attachExisting(travellerId: string, documentId: string) {
    if (!documentId || busy) return;
    setBusy('existing'); setError('');
    try { const doc = await documentService.detail(documentId); if (!doc.currentVersion) throw new Error('This document has no completed upload.'); await attach({travellerId, documentId, versionId:doc.currentVersion.id}); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not attach this document.'); }
    finally { setBusy(''); }
  }
  async function remove(linkId: string) {
    setBusy(linkId); setError('');
    try { setData(await visaService.assistanceUnlink(requestId, linkId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove this attachment.'); }
    finally { setBusy(''); }
  }
  async function preview(documentId: string, versionId: string, download = false) {
    const windowRef = window.open('', '_blank');
    if (!windowRef) { setError('Your browser blocked the document window. Allow pop-ups for Flyseri and try again.'); return; }
    windowRef.opener = null;
    try { const access = await documentService.access(documentId, versionId, download); if (windowRef) windowRef.location.href = access.url; }
    catch (e) { windowRef?.close(); setError(e instanceof Error ? e.message : 'Preview is unavailable.'); }
  }
  async function saveNote(goToReview = false) {
    if (busy || pending) return;
    setBusy('note'); setError(''); setNoteStatus('');
    try {
      const request = await visaService.assistanceSaveNote(requestId, additionalNote);
      const saved = request.customerMessage || '';
      setData(request); setAdditionalNote(saved); setSavedNote(saved); setNoteStatus('Note saved');
      if (goToReview) setReview(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Your note could not be saved. Please try again.'); }
    finally { setBusy(''); }
  }
  function fileRow(doc: VisaAssistanceRequestDetail['documents'][number], removable = true) {
    return <li className="visa-doc-inline-file" key={doc.id}><div className="visa-doc-inline-file-name"><strong>{doc.filename}</strong><small>{(doc.fileSize / 1024).toFixed(0)} KB · {doc.scanStatus === 'CLEAN' ? 'Security scan passed' : 'Security review not completed'}</small></div><div className="visa-doc-inline-file-actions"><button type="button" aria-label={'Download ' + doc.filename} onClick={() => void preview(doc.documentId, doc.documentVersionId, true)}>Download</button>{removable && <button type="button" className="visa-doc-delete" aria-label={'Delete attachment ' + doc.filename} title="Remove from this application; the original stays in My Documents" disabled={!!busy} onClick={() => void remove(doc.id)}>{busy === doc.id ? 'Removing…' : 'Delete'}</button>}</div></li>;
  }
  if (!loading && data?.status === 'NEW' && pageStep === 'form') return <VisaAssistanceRequestPage key={data.id} savedRequest={data} onSaved={request => { setData(request); setAdditionalNote(request.customerMessage || ''); setSavedNote(request.customerMessage || ''); }}/>;
  return <main className="account-page visa-page visa-assistance-page visa-document-page">
    <Link className="visa-back-link" to="/app/visa">← Visa planning</Link>
    <header className="account-panel visa-assistance-intro"><p className="account-eyebrow">YOUR ASSISTED VISA APPLICATION</p><h1>{data && data.status !== 'NEW' ? 'Your request is with Flyseri' : pageStep === 'choose' ? 'Your visa selection' : pageStep === 'form' ? 'Your saved applicant details' : review ? 'Review your application' : 'Add your documents'}</h1><p>{review ? "Check each applicant’s information and attachments before continuing to payment. Submit to Flyseri after payment is verified." : "Your applicant details are saved. Prepare clear documents for our visa team to review."}</p>
      </header>
    <SavedVisaJourneyProgress requestId={requestId} current={savedDetails ? pageStep as "choose" | "form" : review ? "review" : "documents"} complete={!!data && data.status !== "NEW"} disabled={loading || !!busy || !!pending || additionalNote !== savedNote} />
    {error && <div className="account-panel" role="alert">{error}{!data && <button onClick={() => void load()}>Try again</button>}</div>}
    {documentWarning && <div className="account-panel" role="alert">{documentWarning} Your saved application and attached files remain available. <button disabled={!!busy || !!pending || loading || additionalNote !== savedNote} onClick={() => void load()}>Retry document services</button></div>}
    {loading ? <div className="account-panel" role="status">Loading your saved application…</div> : data && <div className="visa-assistance-layout"><section>
      {savedDetails ? <>
        {pageStep === 'choose' && <section className="account-panel visa-upload-applicant"><h2>Saved visa selection</h2><ReviewFields fields={[
          ['Destination country',reviewCountry(data.destinationCountryCode)],['Visa purpose',data.purpose],['Expected travel date',reviewDate(data.expectedTravelDate)],['Expected return date',reviewDate(data.expectedReturnDate)],['Accommodation / host',data.accommodationOrHost],
        ]}/><p>Your saved application information is shown below. This does not start a new request.</p></section>}
        {pageStep === 'form' && <>{data.applicants.map((person,index)=><article className="account-panel visa-upload-applicant" key={person.travellerId}><VisaApplicantReview person={person} index={index} documents={data.documents}/></article>)}<section className="account-panel visa-upload-applicant"><h2>Contact details</h2><ReviewFields fields={[
          ['Contact name',data.contactName],['Email address',data.contactEmail],['Mobile phone',data.contactPhone],['Note for the visa team',data.customerMessage],
        ]}/></section></>}
        <div className="account-panel visa-stage-actions"><span>Saved application · {data.requestReference}</span><Link className="btn-primary" to={pageStep === 'choose' ? '?step=form' : '/app/visa/assistance/'+requestId+'/documents'}>{pageStep === 'choose' ? 'Applicant details →' : 'Continue to documents →'}</Link></div>
      </> : data.status !== 'NEW' ? <div className="account-panel visa-assistance-success"><span className="visa-assistance-success-mark">✓</span><h2>Request {data.requestReference}</h2><p>Status: {data.status.replace(/_/g, ' ')}</p><p>Your request has been submitted to Flyseri. Our team will review your information and confirm any remaining documents. This status does not mean a visa has been granted or filed with an authority.</p></div> : <>
        {pending && <div className="account-panel" role="status"><p>Your file is saved in My Documents, but still needs to be attached to this request.</p><button className="btn-primary" disabled={!!busy} onClick={async () => { setBusy('retry'); try { await attach(pending); } catch (e) { setError(e instanceof Error ? e.message : 'Attachment failed.'); } finally { setBusy(''); } }}>Retry attachment</button></div>}
        {!review && <div className="visa-upload-notice">Attach the documents you have available under the relevant categories. These are preparation suggestions for Flyseri’s review. Your advisor will confirm the specific documents needed for your destination and purpose. You can continue without files if you need guidance.</div>}
        {data.applicants.map((person, index) => <article className="account-panel visa-upload-applicant" key={person.travellerId}>{!review && <div className="visa-doc-person-header"><span className="visa-doc-person-avatar" aria-hidden="true">{String(index + 1).padStart(2,'0')}</span><div><p className="account-eyebrow">APPLICANT {index + 1}</p><h2>{person.details ? [person.details.firstName, person.details.middleName, person.details.lastName].filter(Boolean).join(' ') : 'Saved applicant'}</h2></div><span className="visa-doc-count">{data.documents.filter(doc => doc.travellerId === person.travellerId).length} files saved</span></div>}
          {review ? <VisaApplicantReview person={person} index={index} documents={data.documents}/> : <div className="visa-doc-workspace">
            <div className="visa-doc-toolbar"><div><h3>Document checklist</h3><p>Choose a category, then add the files you have.</p></div><label className="visa-doc-search"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label={'Search document types for applicant ' + (index + 1)} placeholder="Find a document type" value={searches[person.travellerId] || ''} onChange={event => setSearches(previous => ({...previous,[person.travellerId]:event.target.value}))}/></label></div>
            <nav className="visa-doc-category-nav" aria-label={'Document categories for applicant ' + (index + 1)}>{documentGroups.map(group => {
              const selected = (activeGroups[person.travellerId] || documentGroups[0]) === group;
              const count = data.documents.filter(doc => doc.travellerId === person.travellerId && uploadCategories.find(category => category.key === categoryForDocument(doc,vault))?.group === group).length;
              return <button type="button" className={selected && !searches[person.travellerId] ? 'active' : ''} aria-pressed={selected && !searches[person.travellerId]} key={group} onClick={() => {setActiveGroups(previous => ({...previous,[person.travellerId]:group}));setSearches(previous => ({...previous,[person.travellerId]:''}));}}><CategoryIcon group={group}/><span>{group}</span>{count > 0 && <b>{count}</b>}</button>;
            })}</nav>
            <div className="visa-doc-category-intro"><h3>{searches[person.travellerId] ? 'Search results' : activeGroups[person.travellerId] || documentGroups[0]}</h3><span>Attach where applicable</span></div>
            <div className="visa-document-category-grid">{uploadCategories.filter(category => searches[person.travellerId]?.trim() ? (category.title + ' ' + category.description).toLowerCase().includes(searches[person.travellerId].trim().toLowerCase()) : category.group === (activeGroups[person.travellerId] || documentGroups[0])).map(category => {
              const attached = data.documents.filter(doc => doc.travellerId === person.travellerId && categoryForDocument(doc,vault) === category.key);
              return <section className={'visa-document-category' + (attached.length ? ' has-files' : '')} key={category.key}><div className="visa-document-category-heading"><span className="visa-doc-file-icon"><CategoryIcon group={category.group}/></span><h3>{category.title}</h3>{attached.length > 0 && <span className="visa-doc-saved">✓ {attached.length}</span>}</div><p>{category.description}</p><label className="visa-upload-button">{busy === person.travellerId + category.key ? 'Uploading…' : '+ Add files'}<input aria-label={'Attach ' + category.title + ' for applicant ' + (index + 1)} type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={!!busy || !!pending || !policy} onChange={event => { void upload(person.travellerId, category, Array.from(event.target.files || [])); event.target.value = ''; }} /></label>{attached.length > 0 && <ul className="visa-doc-inline-files">{attached.map(doc => fileRow(doc))}</ul>}</section>;
            })}</div>
            {searches[person.travellerId]?.trim() && !uploadCategories.some(category => (category.title + ' ' + category.description).toLowerCase().includes(searches[person.travellerId].trim().toLowerCase())) && <div className="visa-doc-no-results"><h3>No matching document type</h3><p>Try a different search, or use Other supporting documents.</p><button type="button" onClick={() => {setSearches(previous => ({...previous,[person.travellerId]:''}));setActiveGroups(previous => ({...previous,[person.travellerId]:'Additional supporting records'}));}}>View additional documents →</button></div>}
            <p className="visa-doc-format-note">{policy ? `PDF, JPG or PNG · Up to ${policy.maxUploadMb} MB per file · Multiple files allowed` : 'Upload limits are temporarily unavailable. Please retry before adding files.'}</p>
          </div>}

          {!review && <label className="visa-vault-select">Or use a saved document<select value="" disabled={!!busy || !!pending} onChange={e => void attachExisting(person.travellerId, e.target.value)}><option value="">Choose from My Documents</option>{vault.filter(doc => doc.travellerId === person.travellerId && !data.documents.some(link => link.documentId === doc.id)).map(doc => <option key={doc.id} value={doc.id}>{doc.displayName || doc.documentType.replace(/_/g, ' ')}</option>)}</select></label>}
          {review && <section className="visa-doc-attachment-panel"><div className="visa-doc-attachment-title"><h3>Attached documents</h3><span>{data.documents.filter(doc => doc.travellerId === person.travellerId).length} files</span></div><ul className="visa-doc-inline-files">{data.documents.filter(doc => doc.travellerId === person.travellerId).map(doc => fileRow(doc, false))}</ul>{!data.documents.some(doc => doc.travellerId === person.travellerId) && <p className="visa-upload-empty">No documents attached yet.</p>}</section>}

        </article>)}
        {review && <>
          <section className="account-panel visa-upload-applicant visa-review-trip"><p className="account-eyebrow">YOUR VISIT</p><h2>Travel plans</h2><ReviewFields fields={[
            ['Destination country', reviewCountry(data.destinationCountryCode)], ['Visa purpose', data.purpose],
            ['Expected travel date', reviewDate(data.expectedTravelDate)], ['Expected return date', reviewDate(data.expectedReturnDate)],
            ['Accommodation / host', data.accommodationOrHost],
          ]}/></section>
          <section className="account-panel visa-upload-applicant visa-review-contact"><p className="account-eyebrow">HOW WE WILL REACH YOU</p><h2>Contact details</h2><ReviewFields fields={[
            ['Contact name', data.contactName], ['Email address', data.contactEmail], ['Mobile phone', data.contactPhone],
          ]}/><div className="visa-review-applicant-note"><h3>Note for the visa team</h3><p>{additionalNote.trim() || 'No additional note'}</p></div></section>
          <section className="account-panel visa-review-declaration"><h2>Review & confirmation</h2><p>Please check that names match your travel documents and that all information is accurate.</p><label className="visa-assistance-confirm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I confirm my details and documents are accurate and authorize Flyseri to review this request. I will review the service fee on the payment page before paying. Submission to Flyseri follows verified payment.</span></label></section>
        </>}
        {!review && <section className="account-panel visa-doc-note-panel"><div className="visa-doc-note-heading"><div><p className="account-eyebrow">ANYTHING ELSE TO SHARE?</p><h2>Note for the visa team <span>(optional)</span></h2></div><span className="visa-doc-note-count">{additionalNote.length} / 2,000</span></div><label htmlFor="visa-additional-note" className="visa-doc-note-label">Tell us about your documents or anything we should know.</label><textarea id="visa-additional-note" disabled={!!busy} maxLength={2000} rows={4} value={additionalNote} onChange={event => {setAdditionalNote(event.target.value); setNoteStatus('');}} placeholder="For example, explain a missing document, a name difference, or a document you plan to provide later." aria-describedby="visa-additional-note-help"/><p id="visa-additional-note-help" className="visa-doc-note-help">Your note is saved with this application and shared with the Flyseri visa team when you submit.</p><div className="visa-doc-note-save"><span role="status">{noteStatus || (additionalNote !== savedNote ? 'Unsaved changes' : '')}</span><button type="button" disabled={!!busy || !!pending || additionalNote === savedNote} onClick={() => void saveNote()}>{busy === 'note' ? 'Saving…' : 'Save note'}</button></div></section>}
        <div className="account-panel visa-stage-actions">{review && <button disabled={!!busy} onClick={() => setReview(false)}>← Back to documents</button>}<span>{review ? "Payment before submission" : "Review before payment"}</span><button className="btn-primary" disabled={!!busy || !!pending || (review && !consent)} onClick={() => {window.scrollTo?.({top:0,behavior:'smooth'}); return review ? navigate('/app/visa/assistance/' + requestId + '/payment') : additionalNote !== savedNote ? void saveNote(true) : setReview(true); }}>{busy === 'submit' ? 'Submitting…' : busy === 'note' ? 'Saving note…' : review ? 'Continue to payment →' : 'Continue to review →'}</button></div>
      </>}
    </section><aside className="account-panel visa-document-sidebar"><p className="account-eyebrow">YOUR APPLICATION</p><h2>{data.requestReference}</h2><p>{reviewCountry(data.destinationCountryCode)} · {data.purpose}</p><p>Travel: {reviewDate(data.expectedTravelDate)}</p><div className="visa-doc-summary-stats"><div><strong>{data.applicants.length}</strong><span>Applicants</span></div><div><strong>{data.documents.length}</strong><span>Files attached</span></div></div><div className="visa-doc-advisor-note"><strong>Prepared for Flyseri review</strong><p>Your advisor will confirm any additional documents before processing.</p></div><hr /><h3>What happens next?</h3><p>Review your information, complete the configured service payment, then submit to Flyseri. Our team will review your application and confirm any remaining documents.</p><small>Files stay in your private document vault. Removing an attachment here does not delete the original file.</small></aside></div>}
  </main>;
}
