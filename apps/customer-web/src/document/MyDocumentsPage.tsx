import { Translated } from '../travel/language';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { DocumentSummary, DocumentType, TravellerProfile } from '@flyseri/types';
import { travellerService } from '../services/travellerService';
import { documentService } from '../services/documentService';
import { documentGroups, documentLabels, documentScanStatus, friendlyDate } from './documentPresentation';

const personBoundTypes: DocumentType[] = ['PASSPORT', 'NATIONAL_ID', 'PASSPORT_PHOTO', 'RESIDENCE_PERMIT', 'BIRTH_CERTIFICATE', 'PREVIOUS_VISA', 'TRAVEL_DOCUMENT'];

interface UploadReturn { returnTo?: string; travellerId?: string; documentType?: DocumentType }
export function MyDocumentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const requested = location.state as UploadReturn | null;
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [travellers, setTravellers] = useState<TravellerProfile[]>([]);
  const [maxMb, setMaxMb] = useState(10);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(!!requested?.returnTo);
  const [type, setType] = useState<DocumentType>(requested?.documentType ?? 'PASSPORT');
  const [travellerId, setTravellerId] = useState(requested?.travellerId ?? '');
  const [displayName, setDisplayName] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(crypto.randomUUID());
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button[aria-label="Close upload"]')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus(); };
  }, [open]);
  async function load() {
    setLoading(true); setLoadError(false);
    try {
      const [items, people, policy] = await Promise.all([documentService.list(), travellerService.list(), documentService.policy()]);
      setDocuments(items); setTravellers(people); setMaxMb(policy.maxUploadMb);
    } catch { setLoadError(true); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function chooseFile(next: File | null) { setFile(next); setUploadKey(crypto.randomUUID()); setError(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!file) { setError('Choose a PDF, JPG or PNG file.'); return; }
    if (file.size < 1 || file.size > maxMb * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { setError(`Choose a PDF, JPG or PNG file up to ${maxMb} MB.`); return; }
    if (personBoundTypes.includes(type) && !travellerId) { setError('Choose the traveller this document belongs to.'); return; }
    setBusy(true);
    try {
      const id = createdId ?? (await documentService.create({ documentType: type, travellerId: travellerId || null, displayName: displayName.trim() || null, expiresOn: expiresOn || null })).id;
      setCreatedId(id);
      await documentService.upload(id, file, uploadKey);
      const returnTo = requested?.returnTo?.startsWith('/app/visa-applications/') ? requested.returnTo : `/app/documents/${id}`;
      navigate(returnTo, { replace: true });
    } catch { setError("We couldn't upload this document. Please try again. If the file was received, retrying will keep the same version."); }
    finally { setBusy(false); }
  }
  return <div className="account-page vault-page"><div className="vault-heading"><div><p className="account-eyebrow">YOUR SECURE VAULT</p><h1><Translated text="My Documents" /></h1><p className="account-muted">Keep travel documents together and reuse them when planning a visa application.</p></div><button className="btn-primary vault-primary" onClick={() => setOpen(true)}>+ Upload document</button></div>
    {loading ? <div role="status" className="vault-loading"><div className="trip-skeleton trip-skeleton-wide"/><div className="trip-skeleton"/>Loading your documents…</div> : loadError ? <div role="alert" className="account-empty"><h2>We couldn't load your documents.</h2><button className="account-outline-button vault-secondary" onClick={() => void load()}><Translated text="Try again" /></button></div> : !documents.length ? <div className="account-empty vault-empty"><span>◇</span><h2>No documents yet</h2><p>Add a passport or other document when you're ready. Your files stay private.</p><button className="btn-primary vault-primary" onClick={() => setOpen(true)}>Upload your first document</button></div> : documentGroups.map((group) => {
      const items = documents.filter((document) => group.types.includes(document.documentType));
      return items.length ? <section className="vault-section" key={group.title}><h2>{group.title}</h2><div className="vault-grid">{items.map((document) => <Link className="vault-card" to={`/app/documents/${document.id}`} key={document.id}><div className="vault-card-icon">▣</div><div><strong>{document.displayName || documentLabels[document.documentType]}</strong><small>{document.travellerName || 'Shared document'}</small><small>{document.currentVersion ? `Received ${friendlyDate(document.currentVersion.uploadedAt?.slice(0, 10) ?? null)}` : 'Awaiting file'}</small>{document.expiresOn && <small>Expires {friendlyDate(document.expiresOn)}</small>}</div><span className="vault-status">{document.currentVersion ? documentScanStatus(document.currentVersion.securityScanStatus) : 'No file yet'}</span></Link>)}</div></section> : null;
    })}
    {open && <div className="vault-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}><div ref={dialogRef} className="vault-dialog" role="dialog" aria-modal="true" aria-labelledby="vault-upload-title"><div className="account-panel-heading"><div><p className="account-eyebrow">ADD TO YOUR VAULT</p><h2 id="vault-upload-title">Upload a document</h2></div><button type="button" disabled={busy} aria-label="Close upload" onClick={() => setOpen(false)}>✕</button></div><p className="account-muted">PDF, JPG or PNG · Up to {maxMb} MB. We receive the file privately; security scanning is not currently available.</p><form className="account-form vault-form" onSubmit={(event) => { void submit(event); }}><div className="account-form-grid"><label>Document type<select value={type} disabled={!!createdId} onChange={(event) => setType(event.target.value as DocumentType)}>{Object.entries(documentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Traveller<select value={travellerId} disabled={!!createdId} onChange={(event) => setTravellerId(event.target.value)}><option value="">Shared or not assigned</option>{travellers.map((person) => <option key={person.id} value={person.id}>{person.legalFirstName} {person.legalLastName}</option>)}</select></label><label>Document name (optional)<input value={displayName} disabled={!!createdId} maxLength={160} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Current passport" /></label><label>Expiry date (optional)<input type="date" value={expiresOn} disabled={!!createdId} onChange={(event) => setExpiresOn(event.target.value)} /></label></div><label className="vault-file-label">Choose file<input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} required /></label>{error && <p role="alert" className="account-error">{error}{createdId && <Link to={`/app/documents/${createdId}`}> Open document</Link>}</p>}<button className="btn-primary account-submit" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload privately'}</button></form></div></div>}
  </div>;
}
