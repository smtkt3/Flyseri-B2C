import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { VisaAssistanceAddress, VisaAssistanceRequestDetail } from '@flyseri/types';
import { documentService } from '../services/documentService';
import { countryName } from '../trip/tripPresentation';

export function reviewCountry(code?: string | null) { return code ? countryName(code) : 'Not provided'; }
export function reviewDate(value?: string | null) {
  if (!value) return 'Not provided';
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
export function ReviewFields({ fields }: { fields: Array<[string, ReactNode]> }) {
  return <dl className="visa-review-fields">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>;
}
function Address({ title, address }: { title: string; address?: VisaAssistanceAddress }) {
  return <section className="visa-review-address"><h4>{title}</h4><p>{address ? <>{address.addressLine1}<br />{address.addressLine2 && <>{address.addressLine2}<br /></>}{[address.city, address.region, address.postalCode].filter(Boolean).join(', ')}<br />{reviewCountry(address.countryCode)}</> : 'Not provided'}</p></section>;
}
export function VisaApplicantReview({ person, index, documents }: { person: VisaAssistanceRequestDetail['applicants'][number]; index: number; documents: VisaAssistanceRequestDetail['documents'] }) {
  const details = person.details;
  const name = details ? [details.firstName, details.middleName, details.lastName].filter(Boolean).join(' ') : 'Saved applicant';
  const photo = documents.find(doc => doc.travellerId === person.travellerId && doc.documentType === 'PASSPORT_PHOTO');
  const [photoUrl, setPhotoUrl] = useState('');
  useEffect(() => {
    let active = true;
    setPhotoUrl('');
    if (photo) void (async () => {
      try {
        const doc = await documentService.detail(photo.documentId);
        const version = doc.versions.find(version => version.id === photo.documentVersionId);
        if (!version || !['image/jpeg', 'image/png'].includes(version.mimeType)) return;
        const access = await documentService.access(photo.documentId, photo.documentVersionId);
        if (active) setPhotoUrl(access.url);
      } catch { /* The document remains available in the attachment list. */ }
    })();
    return () => { active = false; };
  }, [photo?.documentId, photo?.documentVersionId]);
  return <>
    <header className="visa-review-person">
      <div className="visa-review-photo">{photoUrl ? <img src={photoUrl} alt={'Applicant photograph of ' + name} onError={() => setPhotoUrl('')} /> : <><svg aria-hidden="true" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="24" cy="17" r="8"/><path d="M9 42v-3a15 15 0 0 1 30 0v3"/></svg><span>{photo ? 'Photo preview unavailable' : 'No photograph attached'}</span></>}</div>
      <div className="visa-review-person-heading"><p className="account-eyebrow">APPLICANT {String(index + 1).padStart(2, '0')}</p><h2>{name}</h2><p>{reviewCountry(details?.nationalityCountryCode)} · {details?.documentType?.replace(/_/g, ' ') || 'Travel document'}</p><span className="visa-review-badge">Details saved · Please check carefully</span></div>
    </header>
    <section className="visa-review-section"><h3>Personal information</h3><ReviewFields fields={[
      ['First / given name', details?.firstName], ['Middle name', details?.middleName], ['Last name / surname', details?.lastName],
      ['Date of birth', reviewDate(details?.dateOfBirth)], ['Gender', details?.gender?.replace(/_/g, ' ')], ['Nationality', reviewCountry(details?.nationalityCountryCode)],
      ['City of birth', details?.birthCity], ['Country of birth', reviewCountry(details?.birthCountryCode)],
    ]}/></section>
    <section className="visa-review-section"><h3>Passport & identity document</h3><ReviewFields fields={[
      ['Document type', details?.documentType?.replace(/_/g, ' ')], ['Document number', details?.documentNumber],
      ['Issuing country', reviewCountry(details?.documentIssuingCountryCode)], ['Date of issue', reviewDate(details?.documentIssuedOn)], ['Expiry date', reviewDate(details?.documentExpiresOn)],
    ]}/></section>
    <section className="visa-review-section"><h3>Residential addresses</h3><div className="visa-review-address-grid"><Address title="Current address" address={details?.currentAddress}/><Address title="Permanent address" address={details?.permanentAddress}/></div></section>
    <section className="visa-review-section"><h3>Employment & background</h3><ReviewFields fields={[
      ['Occupation', details?.occupation], ['Employer / school', details?.employerOrSchool], ['Previous visa refusal', details?.previousVisaRefusal?.replace(/_/g, ' ')],
    ]}/><div className="visa-review-applicant-note"><h4>Applicant notes</h4><p>{details?.notes || 'No additional applicant notes'}</p></div></section>
  </>;
}
