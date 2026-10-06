import { VisaJourneyProgress } from './VisaJourneyProgress';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { DocumentSummary, OrderDetail, TripDetail, VisaApplicationDetail, VisaFieldCondition, VisaFormField, VisaFormSection } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { commerceService } from '../services/commerceService';
import { documentService } from '../services/documentService';
import { tripService } from '../services/tripService';
import { visaService } from '../services/visaService';
import { formatMoney, formatTimestamp, paymentStatus, visaStatus } from '../account/presentation';
import { countryName } from '../trip/tripPresentation';
import { documentLabels, friendlyDate } from '../document/documentPresentation';
import './visa-application.css';

const isDraft = (status: VisaApplicationDetail['status']) => status === 'DRAFT' || status === 'INCOMPLETE';
type VisaStage = 'details' | 'documents' | 'review' | 'payment';
const stages: { id: VisaStage; title: string; caption: string }[] = [
  { id: 'details', title: 'Application', caption: 'Your information' },
  { id: 'documents', title: 'Documents', caption: 'Secure uploads' },
  { id: 'review', title: 'Review', caption: 'Check and submit' },
  { id: 'payment', title: 'Payment', caption: 'After submission' },
];
const valuePresent = (value: unknown) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
const fieldScope = (field: VisaFormField, travellerId: string) => field.applicantScope === 'APPLICATION' ? 'application' : travellerId;
function visible(field: VisaFormField, values: Record<string, unknown>) {
  return conditionsMatch(field.visibleWhen, values);
}
function conditionsMatch(conditions: VisaFieldCondition[] | undefined, values: Record<string, unknown>) {
  return (conditions ?? []).every((condition) => {
    const actual = values[condition.field];
    if (actual === undefined || actual === null || actual === '') return false;
    const options = Array.isArray(condition.value) ? condition.value : [condition.value];
    const matches = Array.isArray(actual) ? actual.some((item) => options.includes(String(item))) : options.includes(String(actual));
    if (condition.operator === 'EQ') return matches;
    if (condition.operator === 'NEQ') return !matches;
    return matches;
  });
}

export function VisaApplicationPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedStage = new URLSearchParams(location.search).get('step');
  const [stage, setStage] = useState<VisaStage>(stages.some((item) => item.id === requestedStage) ? requestedStage as VisaStage : 'details');
  const [application, setApplication] = useState<VisaApplicationDetail | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [dirtyScopes, setDirtyScopes] = useState<string[]>([]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [acceptedDeclaration, setAcceptedDeclaration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkoutAvailable, setCheckoutAvailable] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [notFound, setNotFound] = useState(false);

  async function load(id: string) {
    setLoading(true); setError(''); setNotFound(false);
    try {
      const app = await visaService.detail(id);
      const [journeyResult, documentsResult, orderResult] = await Promise.allSettled([
        tripService.detail(app.tripId), documentService.list(), app.orderId ? commerceService.order(app.orderId) : Promise.resolve(null),
      ]);
      if (journeyResult.status === 'rejected') throw journeyResult.reason;
      setApplication(app); setTrip(journeyResult.value); setAnswers(app.answers ?? {});
      if (!stages.some((item) => item.id === requestedStage)) {
        setStage(isDraft(app.status) ? 'details' : app.status === 'ADDITIONAL_DOCUMENTS_REQUIRED' ? 'documents' : app.status === 'ADDITIONAL_INFORMATION_REQUIRED' ? 'details' : 'payment');
      }
      setDocuments(documentsResult.status === 'fulfilled' ? documentsResult.value : []);
      setOrder(orderResult.status === 'fulfilled' ? orderResult.value : null);
      if (documentsResult.status === 'rejected') setNotice('Your saved files are temporarily unavailable. The rest of your application is safe.');
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 404) setNotFound(true);
      else setError("We couldn't load this application. Please try again.");
    } finally { setLoading(false); }
  }
  useEffect(() => { if (applicationId) void load(applicationId); }, [applicationId]);
  useEffect(() => { if (stages.some((item) => item.id === requestedStage)) setStage(requestedStage as VisaStage); }, [requestedStage]);
  useEffect(() => { void commerceService.paymentCapabilities().then((value) => setCheckoutAvailable(value.checkoutAvailable), () => setCheckoutAvailable(false)); }, []);

  const form = useMemo(() => application?.formSnapshot?.sections ?? [], [application?.formSnapshot]);
  const applicants = trip?.travellers.filter((person) => application?.travellerIds.includes(person.id)) ?? [];
  const actionRequests = application?.reviewRequests?.filter((request) => request.status === 'OPEN') ?? [];
  const correctionMode = application?.status === 'ADDITIONAL_INFORMATION_REQUIRED' || application?.status === 'ADDITIONAL_DOCUMENTS_REQUIRED';
  const canEdit = Boolean(application && (isDraft(application.status) || correctionMode));
  const totalFormFields = form.flatMap((section) => section.fields.filter((field) => field.required)).reduce((count, field) => {
    const scopes = field.applicantScope === 'APPLICATION' ? ['application'] : applicants.map((person) => person.id);
    return count + scopes.filter((scope) => visible(field, { ...(answers.application ?? {}), ...(answers[scope] ?? {}) })).length;
  }, 0);
  const completedFormFields = form.flatMap((section) => section.fields.filter((field) => field.required)).reduce((count, field) => {
    const scopes = field.applicantScope === 'APPLICATION' ? ['application'] : applicants.map((person) => person.id);
    return count + scopes.filter((scope) => visible(field, { ...(answers.application ?? {}), ...(answers[scope] ?? {}) }) && valuePresent(answers[scope]?.[field.key])).length;
  }, 0);
  const requirementApplies = (requirement: VisaApplicationDetail['requirements'][number]) =>
    conditionsMatch(requirement.conditionSnapshot, { ...(answers.application ?? {}), ...(answers[requirement.travellerId] ?? {}) });
  const requiredDocuments = application?.requirements.filter((item) => item.required && item.status !== 'NOT_APPLICABLE' && requirementApplies(item)) ?? [];
  const documentReady = (item: VisaApplicationDetail['requirements'][number]) => item.status === 'ACCEPTED' || item.documents.some((document) =>
    document.uploadState === 'UPLOADED' && document.securityScanStatus === 'CLEAN');
  const completeDocuments = requiredDocuments.filter(documentReady).length;

  function updateAnswer(scope: string, key: string, value: unknown) {
    setAnswers((current) => ({ ...current, [scope]: { ...(current[scope] ?? {}), [key]: value } }));
    setDirtyScopes((current) => current.includes(scope) ? current : [...current, scope]);
    setNotice('');
  }
  async function saveScope(scope: string): Promise<boolean> {
    if (!application || !dirtyScopes.includes(scope)) return true;
    setSaving(true); setError('');
    try {
      const saved = await visaService.saveAnswers(application.id, scope, answers[scope] ?? {});
      setApplication(saved); setAnswers(saved.answers ?? answers);
      setDirtyScopes((current) => current.filter((item) => item !== scope));
      setNotice('Your progress is saved securely.');
      return true;
    } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "We couldn't save this section. Your answers remain on this page; try again."); return false; }
    finally { setSaving(false); }
  }
  async function saveAll(): Promise<boolean> {
    for (const scope of [...dirtyScopes]) if (!await saveScope(scope)) return false;
    return true;
  }

  async function link(requirementId: string) {
    if (!application) return;
    const document = documents.find((item) => item.id === choices[requirementId]);
    if (!document?.currentVersion) return;
    setBusy(true); setError('');
    try { setApplication(await visaService.link(application.id, requirementId, document.id, document.currentVersion.id)); }
    catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "We couldn't attach this document. Check that it belongs to this applicant and try again."); }
    finally { setBusy(false); }
  }
  async function unlink(requirementId: string, documentId: string) {
    if (!application) return;
    setBusy(true); setError('');
    try { setApplication(await visaService.unlink(application.id, requirementId, documentId)); }
    catch { setError("We couldn't remove this file from the checklist."); }
    finally { setBusy(false); }
  }
  async function advanceFromDetails() {
    if (!application || busy) return;
    setError('');
    if (!form.length) { setError('The application form is not configured for this service.'); return; }
    if (completedFormFields !== totalFormFields) { setError('Complete the required application answers before continuing.'); return; }
    if (await saveAll()) { setStage('documents'); setNotice('Application details saved. Add the required documents next.'); }
  }
  function advanceFromDocuments() {
    setError('');
    if (!application?.requirements.length) { setError('Document requirements are not configured for this service.'); return; }
    if (completeDocuments !== requiredDocuments.length) { setError('Attach every required document and wait for its security check before reviewing.'); return; }
    setStage('review');
  }
  async function submitApplication() {
    if (!application || busy) return;
    if (isDraft(application.status) && !acceptedDeclaration) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!await saveAll()) return;
      const submitted = !isDraft(application.status) ? application : await visaService.submit(application.id);
      setApplication(submitted);
      const createdOrder = await commerceService.createVisaOrder(application.id);
      setOrder(createdOrder);
      setStage('payment');
      setNotice('Application submitted. Review the order and choose whether to continue to payment. No payment has been taken.');
    } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "We couldn't continue to payment. Your application details are still saved."); }
    finally { setBusy(false); }
  }
  async function beginPayment() {
    if (!application || !order || !checkoutAvailable || busy) return;
    setBusy(true); setError('');
    try {
      const result = await commerceService.startPayment(order.id, crypto.randomUUID());
      if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
      await load(application.id);
      setNotice('Payment is being checked. The status updates only after the provider confirms it.');
    } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "We couldn't open checkout. No payment has been confirmed."); }
    finally { setBusy(false); }
  }
  async function refreshPayment() {
    if (!application || !order) return;
    setBusy(true);
    try {
      if (order.payment && ['PENDING', 'PROCESSING', 'UNKNOWN'].includes(order.payment.status)) await commerceService.payment(order.payment.id);
      const refreshed = await commerceService.order(order.id);
      setOrder(refreshed); setApplication(await visaService.detail(application.id));
    } catch { setError('We could not refresh payment status.'); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!application || !window.confirm('Archive this draft visa application?')) return;
    setBusy(true); setError('');
    try { await visaService.archive(application.id); navigate(`/app/trips/${application.tripId}/visa`, { replace: true }); }
    catch { setError("We couldn't archive this application."); setBusy(false); }
  }

  if (loading) return <div role="status" className="account-page visa-page"><div className="trip-skeleton trip-skeleton-wide"/>Loading your visa application…</div>;
  if (notFound) return <div className="account-page visa-page"><h1>Application not found</h1><Link to="/app/visa">Back to Visa</Link></div>;
  if (!application || !trip) return <div role="alert" className="account-page visa-page"><h1>We couldn't load this application.</h1><p>{error}</p><button onClick={() => applicationId && void load(applicationId)}>Try again</button></div>;

  const nameFor = (travellerId: string) => applicants.find((item) => item.id === travellerId)?.legalFirstName ?? 'Applicant';
  const editableField = (field: VisaFormField, scope: string) => {
    if (isDraft(application.status)) return true;
    return correctionMode && actionRequests.some((request) => request.fieldKey === field.key && (!request.travellerId || request.travellerId === scope));
  };
  const renderField = (section: VisaFormSection, field: VisaFormField, scope: string) => {
    const scopeAnswers = answers[scope] ?? {};
    const mergedAnswers = { ...(answers.application ?? {}), ...(answers[scope] ?? {}) };
    if (!visible(field, mergedAnswers)) return null;
    const id = `visa-${scope}-${field.key}`;
    const helpId = `${id}-help`;
    const val = scopeAnswers[field.key];
    const disabled = !editableField(field, scope) || busy || saving;
    const shared = { id, name: id, disabled, 'aria-describedby': field.helpText ? helpId : undefined,
      onBlur: () => { void saveScope(scope); } };
    const input = field.type === 'TEXTAREA' || field.type === 'ADDRESS'
      ? <textarea {...shared} value={typeof val === 'string' ? val : ''} placeholder={field.placeholder ?? ''} rows={field.type === 'ADDRESS' ? 3 : 4}
          onChange={(event) => updateAnswer(scope, field.key, event.target.value)} />
      : field.type === 'SELECT' || field.type === 'COUNTRY' && field.options?.length
        ? <select {...shared} value={typeof val === 'string' ? val : ''} onChange={(event) => updateAnswer(scope, field.key, event.target.value)}>
          <option value="">Select an option</option>{(field.options ?? []).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
        : field.type === 'MULTI_SELECT'
          ? <select {...shared} multiple value={Array.isArray(val) ? val as string[] : []} onChange={(event) => updateAnswer(scope, field.key, [...event.target.selectedOptions].map((option) => option.value))}>
            {(field.options ?? []).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
          : field.type === 'RADIO'
            ? <fieldset className="visa-choice-set" aria-describedby={field.helpText ? helpId : undefined}><legend>{field.label}{field.required && <span className="visa-required"> *</span>}</legend>
              {(field.options ?? []).map((option) => <label key={option.value}><input type="radio" name={id} value={option.value} disabled={disabled} checked={val === option.value}
                onChange={() => updateAnswer(scope, field.key, option.value)} />{option.label}</label>)}
            </fieldset>
            : field.type === 'YES_NO'
              ? <div className="visa-choice-row">{[['true', 'Yes'], ['false', 'No']].map(([value, label]) => <label key={value}><input type="radio" name={id} disabled={disabled}
                checked={val === (value === 'true')} onChange={() => updateAnswer(scope, field.key, value === 'true')} />{label}</label>)}</div>
              : field.type === 'CHECKBOX'
                ? <label className="visa-checkbox"><input type="checkbox" disabled={disabled} checked={val === true} onChange={(event) => updateAnswer(scope, field.key, event.target.checked)} />{field.label}</label>
                : <input {...shared} type={field.type === 'DATE' ? 'date' : field.type === 'NUMBER' || field.type === 'YEAR' ? 'number' : 'text'}
                    inputMode={field.type === 'PHONE' || field.type === 'NUMBER' || field.type === 'YEAR' ? 'numeric' : undefined}
                    autoComplete={field.type === 'PASSPORT' ? 'off' : undefined} maxLength={field.type === 'COUNTRY' && !field.options?.length ? 2 : field.validation?.maxLength}
                    autoCapitalize={field.type === 'COUNTRY' ? 'characters' : undefined}
                    value={typeof val === 'string' || typeof val === 'number' ? String(val) : ''}
                    placeholder={field.placeholder ?? (field.type === 'COUNTRY' && !field.options?.length ? '2-letter country code' : '')}
                    onChange={(event) => updateAnswer(scope, field.key, field.type === 'COUNTRY' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value)} />;
    return <div className={`visa-dynamic-field ${field.type === 'RADIO' || field.type === 'CHECKBOX' ? 'visa-field-choice' : ''}`} key={`${scope}-${field.key}`}>
      {field.type !== 'RADIO' && field.type !== 'CHECKBOX' && <label htmlFor={id}>{field.label}{field.required && <span className="visa-required"> *</span>}</label>}
      {input}{field.helpText && <small id={helpId}>{field.helpText}</small>}
      {correctionMode && actionRequests.some((request) => request.fieldKey === field.key && (!request.travellerId || request.travellerId === scope)) &&
        <small className="visa-field-action">Staff requested an update to this answer.</small>}
    </div>;
  };

  const reviewSections = form.map((section) => {
    const rows = section.fields.flatMap((field) => {
      const scopes = field.applicantScope === 'APPLICATION' ? ['application'] : applicants.map((person) => person.id);
      return scopes.flatMap((scope) => {
        const merged = { ...(answers.application ?? {}), ...(answers[scope] ?? {}) };
        const value = answers[scope]?.[field.key];
        if (!visible(field, merged) || !valuePresent(value)) return [];
        const sensitive = field.type === 'PASSPORT' || /(passport|document|identity|national.?id)/i.test(field.key);
        let display = Array.isArray(value) ? value.map((item) => field.options?.find((option) => option.value === item)?.label ?? String(item)).join(', ')
          : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
        if (field.type === 'DATE') display = friendlyDate(display);
        if (sensitive) display = '••••' + display.slice(-4);
        return [{ key: scope + '-' + field.key, label: field.label, applicant: scope === 'application' ? 'Shared details' : nameFor(scope), display }];
      });
    });
    return { key: section.key, label: section.label, rows };
  }).filter((section) => section.rows.length > 0);

  return <div className="account-page visa-page visa-application-page">
    <Link className="trip-back" to={`/app/trips/${trip.id}/visa`}>← Visa services</Link>
    <header className="visa-app-header"><div><p className="account-eyebrow">SERI MECHAN VISA SERVICE</p><h1>{countryName(application.destinationCountryCode)} · {application.visaTypeName}</h1>
      <p className="account-muted">Application {application.applicationReference ?? application.id.slice(0, 8).toUpperCase()} · {applicants.length} {applicants.length === 1 ? 'applicant' : 'applicants'}</p></div>
      <span className={`visa-status-pill status-${application.status.toLowerCase()}`}>{visaStatus(application.status)}</span></header>
    {error && <p role="alert" className="account-error">{error}</p>}{notice && <p role="status" className="visa-notice">{notice}</p>}

    <VisaJourneyProgress current={stage === 'details' ? 'form' : stage} onSelect={step => { if (step !== 'choose') { setStage(step === 'form' ? 'details' : step); setError(''); } }} />
    <div className="visa-flow-layout"><div className="visa-flow-main">
    {canEdit && <section className="visa-progress-panel account-panel" aria-label="Application progress">
      <div className="visa-progress-heading"><div><h2>Your progress</h2><p>{completedFormFields} of {totalFormFields} required answers · {completeDocuments} of {requiredDocuments.length} required documents</p></div>
        <button type="button" className="account-outline-button" disabled={saving || !dirtyScopes.length} onClick={() => { void saveAll(); }}>{saving ? 'Saving…' : dirtyScopes.length ? 'Save progress' : 'Saved'}</button></div>
      <div className="visa-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((completedFormFields + completeDocuments) / Math.max(1, totalFormFields + requiredDocuments.length) * 100)}>
        <span style={{ width: `${Math.round((completedFormFields + completeDocuments) / Math.max(1, totalFormFields + requiredDocuments.length) * 100)}%` }} />
      </div>
    </section>}

    {stage === 'details' && (form.length > 0 ? <div className="visa-dynamic-form"><p className="account-eyebrow">STEP 02 / 05</p><h2>Application details</h2><p className="account-muted">Answer the questions for each applicant. Known traveller details have been filled in where available.</p>
      {form.map((section) => <section className="account-panel visa-form-section" key={section.key}><div className="visa-form-section-heading"><div><p className="account-eyebrow">APPLICATION FORM</p><h3>{section.label}</h3></div><span>{section.fields.filter((field) => field.required).length} required</span></div>
        {section.fields.some((field) => field.applicantScope === 'APPLICATION') && <div className="visa-form-group"><h4>Application contact and shared details</h4><div className="visa-form-grid">{section.fields.filter((field) => field.applicantScope === 'APPLICATION').map((field) => renderField(section, field, 'application'))}</div></div>}
        {applicants.map((person) => {
          const fields = section.fields.filter((field) => field.applicantScope !== 'APPLICATION');
          if (!fields.length) return null;
          return <div className="visa-form-group" key={`${section.key}-${person.id}`}><h4>{person.legalFirstName} {person.legalLastName}</h4><div className="visa-form-grid">{fields.map((field) => renderField(section, field, person.id))}</div></div>;
        })}
      </section>)}
      <div className="visa-stage-actions"><span>{completedFormFields} / {totalFormFields} required answers</span><button type="button" className="btn-primary visa-submit" disabled={busy || saving || !canEdit} onClick={() => void advanceFromDetails()}>{saving ? 'Saving…' : 'Save & continue to documents →'}</button></div>
    </div> : <section className="account-panel visa-unconfigured"><h2>Application form is not configured</h2><p>This service cannot accept an application until its reviewed form is published. Your saved travellers and files remain available.</p></section>)}

    {stage === 'documents' && <section className="visa-documents-section"><div className="visa-section-title"><div><p className="account-eyebrow">STEP 03 / 05 · SECURE DOCUMENT VAULT</p><h2>Upload your documents</h2><p className="account-muted">Add each applicant's required files, then wait for the security check to finish.</p></div><span>{completeDocuments}/{requiredDocuments.length} ready</span></div>
      {application.requirements.length === 0 ? <div className="account-panel visa-unconfigured"><p>No document requirements have been configured for this service. Contact Seri Mechan before submitting.</p></div>
        : applicants.map((person) => <section className="account-panel visa-person-section" key={person.id}><div className="visa-person-heading"><span className="trip-person-avatar">{person.legalFirstName[0]}</span><div><p className="account-eyebrow">APPLICANT CHECKLIST</p><h3>{person.legalFirstName} {person.legalLastName}</h3></div></div>
          <div className="visa-requirement-list">{application.requirements.filter((item) => item.travellerId === person.id && requirementApplies(item)).map((requirement) => {
            const canReplace = correctionMode && actionRequests.some((request) => request.requirementId === requirement.id);
            const editable = isDraft(application.status) || canReplace;
            const received = documentReady(requirement);
            const options = documents.filter((document) => document.currentVersion &&
              (document.travellerId === person.id || (!document.travellerId && !['PASSPORT','NATIONAL_ID','PASSPORT_PHOTO','RESIDENCE_PERMIT','BIRTH_CERTIFICATE','PREVIOUS_VISA','TRAVEL_DOCUMENT'].includes(document.documentType))) &&
              (!requirement.documentType || document.documentType === requirement.documentType));
            return <article className="visa-requirement" key={requirement.id}><div className="visa-requirement-top"><span className={received ? 'visa-mark done' : 'visa-mark'} aria-hidden="true">{received ? '✓' : '○'}</span>
              <div><strong>{requirement.name}</strong><small>{requirement.required ? 'Required' : 'Optional'} · {received ? 'received and security checked' : requirement.documents.length ? 'received · security check pending' : requirement.status.replace(/_/g, ' ').toLowerCase()}{requirement.description ? ` · ${requirement.description}` : ''}</small></div>
            </div>
            {canReplace && <div className="visa-action-required"><strong>Action required</strong><span>{actionRequests.find((request) => request.requirementId === requirement.id)?.reason}</span></div>}
            {requirement.documents.map((document) => {
              const scan = document.securityScanStatus;
              return <div className="visa-linked" key={document.documentVersionId}><span>{document.displayName || documentLabels[document.documentType]} · {document.originalFilename} (v{document.versionNumber})</span>
                {editable && <button type="button" disabled={busy} onClick={() => void unlink(requirement.id, document.documentId)}>Remove</button>}
                {scan !== 'CLEAN' && <small className="visa-scan-unavailable">{scan === 'UNAVAILABLE' ? 'Security scan is unavailable.' : scan === 'FAILED' ? 'Security scan failed.' : 'Security scan is pending.'} This file cannot be submitted yet.</small>}
              </div>;
            })}
            {editable && <div className="visa-reuse"><label>Use a saved document<select aria-label={`Document for ${requirement.name} ${person.legalFirstName}`} value={choices[requirement.id] ?? ''} onChange={(event) => setChoices({ ...choices, [requirement.id]: event.target.value })}><option value="">Choose a saved file</option>
              {options.map((document) => <option value={document.id} key={document.id}>{document.displayName || documentLabels[document.documentType]}{document.expiresOn ? ` · expires ${friendlyDate(document.expiresOn)}` : ''}</option>)}</select></label>
              <button type="button" className="account-outline-button" disabled={busy || !choices[requirement.id]} onClick={() => void link(requirement.id)}>Attach</button>
               <Link to="/app/documents" state={{ returnTo: `/app/visa-applications/${application.id}?step=documents`, travellerId: person.id, documentType: requirement.documentType ?? 'OTHER' }}>Upload a new file →</Link>
            </div>}
          </article>;
        })}</div></section>)}
      {canEdit && <div className="visa-stage-actions"><button type="button" className="account-outline-button" onClick={() => setStage('details')}>← Application details</button><button type="button" className="btn-primary visa-submit" onClick={advanceFromDocuments}>Continue to review →</button></div>}
    </section>}

    {stage === 'review' && <section className="visa-review-panel account-panel"><div><p className="account-eyebrow">STEP 04 / 05 · FINAL CHECK</p><h2>Review your application</h2><p>Check the information and document checklist before sending your application to Seri Mechan for review.</p></div>
      <details className="visa-review-answers"><summary>Review saved answers</summary>{reviewSections.length ? reviewSections.map((section) => <section key={section.key}><h3>{section.label}</h3>{section.rows.map((row) => <div key={row.key}><span>{row.label}<small>{row.applicant}</small></span><b>{row.display}</b></div>)}</section>) : <p>No answers have been entered yet.</p>}</details>
      {requiredDocuments.length > 0 && <p className="visa-checklist-summary">Required files: {completeDocuments} of {requiredDocuments.length} attached. Submitted files must also pass a security scan.</p>}
      {isDraft(application.status) && <label className="visa-declaration"><input type="checkbox" checked={acceptedDeclaration} onChange={(event) => setAcceptedDeclaration(event.target.checked)} />
        <span>I confirm that my answers are accurate, my documents are genuine, and I authorize Seri Mechan to assist with processing this visa application. I understand that the embassy or relevant authority makes the decision and fees/refund terms apply.</span>
      </label>}
      {isDraft(application.status) ? <button type="button" className="btn-primary visa-submit" disabled={busy || saving || !acceptedDeclaration || !form.length || completedFormFields !== totalFormFields || completeDocuments !== requiredDocuments.length} onClick={() => void submitApplication()}>{busy ? 'Submitting securely…' : 'Submit application →'}</button>
        : correctionMode ? <p className="visa-review-wait">Your requested corrections will be reviewed by Seri Mechan before processing continues.</p>
        : <button type="button" className="btn-primary visa-submit" onClick={() => setStage('payment')}>View payment status →</button>}
      <p className="account-muted">Submitting sends your application for review. It does not take a payment or guarantee visa approval.</p>
    </section>}

    {stage === 'payment' && <section className="account-panel visa-payment-panel"><div><p className="account-eyebrow">STEP 05 / 05 · ORDER & PAYMENT</p><h2>{order?.orderNumber ? `Order ${order.orderNumber}` : 'Payment summary'}</h2>
        <p>{application.status === 'PAID' || order?.payment?.status === 'SUCCEEDED' ? 'Payment confirmed by the provider.' : 'Payment status comes from the payment provider. A redirect alone does not confirm payment.'}</p></div>
        {application.feeSnapshot?.map((fee) => <div className="commerce-line" key={fee.code}><span>{fee.label}</span><strong>{formatMoney(fee.amount, fee.currency)}</strong></div>)}
        {order && <div className="commerce-line commerce-total"><strong>Total</strong><strong>{formatMoney(order.totalAmount, order.currency)}</strong></div>}
        {order?.payment && <p>Payment: <strong>{paymentStatus(order.payment.status)}</strong></p>}
        {isDraft(application.status) && <p className="visa-review-wait">Complete the application and document steps, then submit it to unlock payment.</p>}
        {!order && application.status === 'SUBMITTED' && <button type="button" className="btn-primary visa-submit" disabled={busy} onClick={() => void submitApplication()}>Prepare payment order</button>}
        {order && checkoutAvailable && ['PENDING_PAYMENT','PAYMENT_FAILED'].includes(order.status) && (!order.payment || order.payment.status === 'FAILED') &&
          <button type="button" className="btn-primary visa-submit" disabled={busy} onClick={() => void beginPayment()}>{busy ? 'Opening secure checkout…' : 'Continue to secure test checkout'}</button>}
        {order && !checkoutAvailable && <p className="visa-review-wait">Online checkout is currently unavailable. No payment has been taken.</p>}
        {order && <button type="button" className="account-outline-button" disabled={busy} onClick={() => void refreshPayment()}>Refresh payment status</button>}
        {application.status === 'PAID' && <p className="visa-payment-confirmed">Payment is confirmed. Your application is ready for Seri Mechan’s document review.</p>}
        {order && <Link className="account-link" to={`/app/orders/${order.id}`}>View order details →</Link>}
      </section>}

    </div><aside className="visa-flow-aside"><section className="visa-service-summary account-panel"><div><p className="account-eyebrow">YOUR VISA SERVICE</p><h2>{countryName(application.destinationCountryCode)} · {application.visaTypeName}</h2><p>{String(application.serviceSnapshot?.processingTimeText ?? 'Processing time information has not been configured.')}</p>
      {typeof application.serviceSnapshot?.entryType === 'string' && <span>{String(application.serviceSnapshot.entryType)} entry</span>}
      {typeof application.serviceSnapshot?.validityText === 'string' && <span>{String(application.serviceSnapshot.validityText)}</span>}</div>
      <div className="visa-fee-list"><strong>Fee summary</strong>
        {application.feeSnapshot?.length ? application.feeSnapshot.map((fee) => <div key={fee.code}><span>{fee.label}</span><b>{formatMoney(fee.amount, fee.currency)}</b></div>) : <small>Fees are not configured for this service.</small>}
        {order && <div className="visa-aside-total"><strong>Total</strong><b>{formatMoney(order.totalAmount, order.currency)}</b></div>}
      </div>
      <div className="visa-aside-applicants"><strong>Applicants</strong>{applicants.map((person) => <span key={person.id}>{person.legalFirstName} {person.legalLastName}</span>)}</div>
      <p className="visa-disclaimer">Seri Mechan assists with preparing and processing your application. The embassy or authority makes the visa decision. Processing times may change; approval is not guaranteed.</p>
    </section></aside></div>

    {application.customerUpdates?.length ? <section className="account-panel visa-updates"><h2>Updates from Seri Mechan</h2>{application.customerUpdates.map((update) => <article key={update.id}><p>{update.message}</p><small>{formatTimestamp(update.createdAt)}</small></article>)}</section> : null}
    {application.timeline?.length ? <section className="account-panel visa-timeline"><h2>Application timeline</h2><ol>{application.timeline.map((item) => <li key={item.id}><span className="visa-timeline-dot"/><div><strong>{item.label}</strong>{item.customerMessage && <p>{item.customerMessage}</p>}<small>{formatTimestamp(item.createdAt)}</small></div></li>)}</ol></section> : null}
    <footer className="visa-footer"><p className="account-muted">Files remain private in your Secure Document Vault. Submitted applications preserve the form, fees, answers and requirements used at submission.</p>
      {isDraft(application.status) && <button type="button" className="vault-archive" disabled={busy} onClick={() => void archive()}>Archive draft</button>}</footer>
  </div>;
}
