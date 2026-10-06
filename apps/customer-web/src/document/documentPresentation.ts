import type { DocumentType } from '@flyseri/types';

export function documentScanStatus(status: string): string {
  const labels: Record<string, string> = { PENDING: 'Scan pending', CLEAN: 'Scanned', FAILED: 'Scan failed', UNAVAILABLE: 'Scan unavailable' };
  return labels[status] ?? 'Status unavailable';
}

export const documentLabels: Record<DocumentType, string> = {
  PASSPORT: 'Passport', NATIONAL_ID: 'National ID', PASSPORT_PHOTO: 'Passport photo', RESIDENCE_PERMIT: 'Residence permit', BANK_STATEMENT: 'Bank statement', EMPLOYMENT_LETTER: 'Employment letter', MARRIAGE_CERTIFICATE: 'Marriage certificate', BIRTH_CERTIFICATE: 'Birth certificate', COMPANY_DOCUMENT: 'Company document', PREVIOUS_VISA: 'Previous visa', TRAVEL_DOCUMENT: 'Travel document', OTHER: 'Other document',
};
export const documentGroups: { title: string; types: DocumentType[] }[] = [
  { title: 'Travel documents', types: ['PASSPORT', 'PREVIOUS_VISA', 'TRAVEL_DOCUMENT', 'RESIDENCE_PERMIT'] },
  { title: 'Identity', types: ['NATIONAL_ID', 'PASSPORT_PHOTO'] },
  { title: 'Financial & work', types: ['BANK_STATEMENT', 'EMPLOYMENT_LETTER', 'COMPANY_DOCUMENT'] },
  { title: 'Family', types: ['MARRIAGE_CERTIFICATE', 'BIRTH_CERTIFICATE'] },
  { title: 'Other', types: ['OTHER'] },
];
export const friendlyDate = (date: string | null): string => date ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : 'Not set';
