import { lazy, Suspense, useEffect, useState } from 'react';
import { HomeFeatureBoundary, HomeFeatureLoading } from '../components/home/HomeFeatureBoundary';
import './flight-search-modes.css';

const ExploreFareMap = lazy(() => import('../components/home/ExploreFareMap').then(module => ({ default: module.ExploreFareMap })));
const HomeSeriSearch = lazy(() => import('../components/home/HomeSeriSearch').then(module => ({ default: module.HomeSeriSearch })));
export type FlightSearchMode = 'flights' | 'map' | 'ai';
const modes = [
  { id: 'flights', label: 'Flights', description: 'Search by route & date' },
  { id: 'map', label: 'Map Search', description: 'Explore destinations' },
  { id: 'ai', label: 'AI Search', description: 'Ask Seri to help' },
] as const;

export function FlightSearchModeTabs({ mode, onChange, idPrefix }: { mode: FlightSearchMode; onChange: (mode: FlightSearchMode) => void; idPrefix: string }) {
  return <div className="flight-search-mode-tabs" role="tablist" aria-label="Choose how to search flights">
    {modes.map((item, index) => <button key={item.id} id={`${idPrefix}-tab-${item.id}`} type="button" role="tab" aria-selected={mode === item.id} aria-controls={`${idPrefix}-panel-${item.id}`} tabIndex={mode === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); onChange(modes[next]!.id);
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {item.id === 'flights' ? <><path d="m21 3-8 18-3-7-7-3 18-8ZM10 14 21 3"/></> : item.id === 'map' ? <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6ZM9 3v15M15 6v15"/></> : <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4"/></>}
      </svg><span><strong>{item.label}</strong><small>{item.description}</small></span>
    </button>)}
  </div>;
}

export function FlightAlternateSearch({ mode, idPrefix, context, onEditDetails }: { mode: FlightSearchMode; idPrefix: string; context: string; onEditDetails: () => void }) {
  // Keep visited panels mounted so changing search method preserves map position and chat.
  const [mapRequested, setMapRequested] = useState(false);
  const [aiRequested, setAiRequested] = useState(false);
  useEffect(() => {
    if (mode === 'map') setMapRequested(true);
    if (mode === 'ai') setAiRequested(true);
  }, [mode]);
  return <>
    <div className="flight-alternate-panel flight-map-panel" id={`${idPrefix}-panel-map`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-map`} hidden={mode !== 'map'}>
      <div className="flight-mode-intro"><div><h2>Explore destinations</h2><p>Choose a city on the map, then view flight options.</p></div></div>
      <div className="flight-mode-context"><span>{context}</span><span>Map fares are indicative and subject to availability.</span></div>
      {(mapRequested || mode === 'map') && <HomeFeatureBoundary name="Map search"><Suspense fallback={<HomeFeatureLoading name="map search" />}><ExploreFareMap active={mode === 'map'} onEditRoute={onEditDetails} /></Suspense></HomeFeatureBoundary>}
    </div>
    <div className="flight-alternate-panel flight-ai-panel" id={`${idPrefix}-panel-ai`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-ai`} hidden={mode !== 'ai'}>
      <div className="flight-mode-context"><span>{context}</span><button type="button" onClick={onEditDetails}>Edit trip details <span aria-hidden="true">→</span></button></div>
      {(aiRequested || mode === 'ai') && <HomeFeatureBoundary name="AI search"><Suspense fallback={<HomeFeatureLoading name="AI search" />}><HomeSeriSearch inlineOnly flightSearch /></Suspense></HomeFeatureBoundary>}
    </div>
  </>;
}
