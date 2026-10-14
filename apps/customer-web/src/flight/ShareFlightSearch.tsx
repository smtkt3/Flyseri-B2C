import { useEffect, useState } from 'react';
import type { FlightSearchRequest } from '@flyseri/types';
import { sharedFlightSearchQuery, type SharedFlightFilters } from './sharedSearchQuery';

export function ShareFlightSearch({request,filters}:{request:FlightSearchRequest;filters:SharedFlightFilters}) {
  const [copied,setCopied] = useState('');
  const [fallback,setFallback] = useState('');
  const query = sharedFlightSearchQuery(request,filters);
  useEffect(()=>{setCopied('');setFallback('');},[query]);
  async function copy() {
    const url = new URL('/flights'+query,window.location.origin).href;
    try { await navigator.clipboard.writeText(url); setCopied('Search link copied'); setFallback(''); }
    catch { setCopied('Copy the search link below'); setFallback(url); }
  }
  return <div className="flight-share-search"><button type="button" onClick={()=>void copy()} aria-label="Copy search link">Share search ↗</button><span role="status">{copied}</span>{fallback&&<label>Search link<input readOnly value={fallback} onFocus={event=>event.currentTarget.select()}/></label>}</div>;
}
