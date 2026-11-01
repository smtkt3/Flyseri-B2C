import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isSupportedVisaDestination } from '@flyseri/types';

const visited = new Set<string>();
const key = (country: string, purpose: string) => `flyseri.visa-guide.${country}.${purpose}`;

export function rememberVisaRequirements(country: string, purpose: string) {
  visited.add(key(country, purpose));
  try { sessionStorage.setItem(key(country, purpose), '1'); } catch { /* Keep the current page session usable when storage is blocked. */ }
}

export function hasVisitedVisaRequirements(country: string, purpose: string) {
  if (visited.has(key(country, purpose))) return true;
  try { return sessionStorage.getItem(key(country, purpose)) === '1'; } catch { return false; }
}

export function visaRequirementsUrl(country: string, purpose: string) {
  return isSupportedVisaDestination(country)
    ? `/app/visa/guide/${country}?${new URLSearchParams({ purpose })}`
    : '/app/visa';
}

// Check before authentication so a direct new-application URL starts with the public guide.
// Saved applications retain their existing access and authentication flow.
export function VisaRequirementsGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const isNew = /^\/app\/visa\/new(?:\/applicants)?\/?$/.test(location.pathname);
  const saved = /\/new\/?$/.test(location.pathname) && params.get('tab') === 'applications';
  const country = params.get('country')?.toUpperCase() || '';
  const purpose = params.get('purpose') || 'Tourism';
  if (isNew && !saved && (!isSupportedVisaDestination(country) || !hasVisitedVisaRequirements(country, purpose))) {
    return <Navigate to={visaRequirementsUrl(country, purpose)} replace />;
  }
  return children;
}
