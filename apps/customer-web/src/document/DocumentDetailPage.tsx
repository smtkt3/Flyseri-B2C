import { Translated } from '../travel/language';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DocumentDetail } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { documentService } from '../services/documentService';
import { documentLabels, friendlyDate } from './documentPresentation';

export function DocumentDetailPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(crypto.randomUUID());
  const [secureUrl, setSecureUrl] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [maxMb, setMaxMb] = useState(10);
  async function load(id: string) {
    setLoading(true); setError(''); setNotFound(false); setSecureUrl('');
    try { const [item, policy] = await Promise.all([documentService.detail(id), documentService.policy().catch(() => null)]); setDocument(item); if (policy) setMaxMb(policy.maxUploadMb); }
    catch (cause) { if (cause instanceof ApiClientError && cause.status === 404) setNotFound(true); else setError("We couldn't load this document. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (documentId) void load(documentId); }, [documentId]);
  async function replace() {
    if (!document || !file) return;
    if (file.size < 1 || file.size > maxMb * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { setError(`Choose a PDF, JPG or PNG file up to ${maxMb} MB.`); return; }
    setBusy(true); setError(''); setSecureUrl('');
    try { setDocument(await documentService.upload(document.id, file, key)); setFile(null); setKey(crypto.randomUUID()); }
    catch { setError("We couldn't upload this file. Please try again."); }
    finally { setBusy(false); }
  }
  async function access(versionId?: string, download = false) {
    if (!document) return;
    setBusy(true); setError(''); setSecureUrl('');
    try { setSecureUrl((await documentService.access(document.id, versionId, download)).url); }
    catch { setError("We couldn't open this document. Please try again."); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!document || !window.confirm('Archive this document? It will leave your active vault.')) return;
    setBusy(true); setError('');
    try { await documentService.archive(document.id); navigate('/app/documents', { replace: true }); }
    catch { setError("We couldn't archive this document. Please try again."); setBusy(false); }
  }
  if (loading) return <div role="status" className="account-page vault-page"><div className="trip-skeleton trip-skeleton-wide"/>Opening document…</div>;
  if (notFound) return <div className="account-page vault-page"><h1>Document not found</h1><Link to="/app/documents">Back to My Documents</Link></div>;
  if (!document) return <div className="account-page vault-page" role="alert"><h1>We couldn't load this document.</h1><button onClick={() => documentId && void load(documentId)}><Translated text="Try again" /></button></div>;
  return <div className="account-page vault-page"><Link className="trip-back" to="/app/documents">← My Documents</Link><p className="account-eyebrow">PRIVATE DOCUMENT</p><h1>{document.displayName || documentLabels[document.documentType]}</h1><p className="account-muted">{document.travellerName || 'Shared document'} · {documentLabels[document.documentType]}</p>{error && <p role="alert" className="account-error">{error}</p>}
    <div className="vault-detail-grid"><section className="account-panel"><h2>Current file</h2>{document.currentVersion ? <><p className="vault-filename">▣ {document.currentVersion.originalFilename}</p><p className="account-muted">Received {friendlyDate(document.currentVersion.uploadedAt?.slice(0, 10) ?? null)} · {Math.ceil(document.currentVersion.fileSize / 1024)} KB</p><p className="vault-scan">Security scan: {document.currentVersion.securityScanStatus === 'UNAVAILABLE' ? 'not available yet' : document.currentVersion.securityScanStatus.toLowerCase()}. {document.currentVersion.securityScanStatus === 'CLEAN' ? 'This file has not been reviewed.' : 'This file has not been verified.'}</p><div className="vault-actions"><button className="btn-primary vault-primary" disabled={busy} onClick={() => void access()}>Request secure view</button><button className="account-outline-button vault-secondary" disabled={busy} onClick={() => void access(undefined, true)}>Download</button></div></> : <p className="account-muted">No file uploaded yet. Add one below.</p>}{secureUrl && <p className="vault-access"><a href={secureUrl} target="_blank" rel="noopener noreferrer">Open secure document →</a><small>This link expires shortly. Request a new one when needed.</small></p>}</section><aside className="account-panel"><h2><Translated text="Details" /></h2><dl className="vault-details"><div><dt>Issued</dt><dd>{friendlyDate(document.issuedOn)}</dd></div><div><dt>Expires</dt><dd>{friendlyDate(document.expiresOn)}</dd></div><div><dt>Country</dt><dd>{document.issuingCountryCode || 'Not set'}</dd></div></dl></aside></div>
    <section className="account-panel vault-replace"><h2>{document.currentVersion ? 'Replace this file' : 'Upload a file'}</h2><p className="account-muted">A replacement keeps the previous file in your history. PDF, JPG and PNG · Up to {maxMb} MB.</p><div className="vault-actions"><input aria-label="Choose replacement file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setKey(crypto.randomUUID()); }} /><button className="btn-primary vault-primary" disabled={!file || busy} onClick={() => void replace()}>{busy ? 'Working…' : document.currentVersion ? 'Replace file' : 'Upload file'}</button></div></section>
    {document.versions.length > 1 && <section className="account-panel"><button className="vault-history-toggle" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide' : 'View'} previous versions</button>{showHistory && <ul className="vault-history">{document.versions.slice(1).map((version) => <li key={version.id}><span>Version {version.versionNumber} · {version.originalFilename}</span><button disabled={busy} onClick={() => void access(version.id)}>Request secure view</button></li>)}</ul>}</section>}
    <button className="vault-archive" disabled={busy} onClick={() => void archive()}>Archive document</button>
  </div>;
}
