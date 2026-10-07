import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useViewportPopover } from '../components/useViewportPopover';
import type {AirportDirectoryEntry} from '@flyseri/types';
import {airportSuggestions,cachedAirportSuggestions} from '../services/airportService';
export {loadAirportDetails} from '../services/airportService';

type IndexedAirport = AirportDirectoryEntry;
type AirportGroup = { city: string; country: string; airports: IndexedAirport[]; center?: { latitude: number; longitude: number }; allAirports?: boolean };
type AirportPickerProps = { label: string; value: string; onChange: (value: string) => void };

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function distanceFromCentre(airport: IndexedAirport, group: AirportGroup) {
  const centre = group.center ?? (airport.cityCenterLatitude !== undefined && airport.cityCenterLongitude !== undefined
    ? { latitude: airport.cityCenterLatitude, longitude: airport.cityCenterLongitude } : undefined);
  if (!centre || airport.latitude === undefined || airport.longitude === undefined) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(airport.latitude - centre.latitude);
  const longitudeDelta = radians(airport.longitude - centre.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(centre.latitude)) * Math.cos(radians(airport.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
export function AirportPicker({ label, value, onChange }: AirportPickerProps) {
  const id = useId();
  const [airports, setAirports] = useState<IndexedAirport[] | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const popoverStyle = useViewportPopover(open, input, { width: 430, height: 430, mobileHeight: 260 });
  const [active, setActive] = useState(0);
  const [loadError, setLoadError] = useState(false);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setAirports(null);setLoadError(false);
    const query=value.trim().match(/\(([A-Z]{3})\)$/)?.[1]??value.trim();
    const cached=cachedAirportSuggestions(query);
    if(cached){setAirports(cached);return()=>controller.abort();}
    const timer=setTimeout(()=>void airportSuggestions(query,controller.signal).then(result=>{if(!controller.signal.aborted)setAirports(result);},()=>{if(!controller.signal.aborted)setLoadError(true);}),query?120:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[open,value]);
  const matches = airports ?? [];
  const cityGroups = useMemo<AirportGroup[]>(() => {
    const groups = new Map<string, AirportGroup>();
    for (const airport of matches) {
      const city = airport.cityCenterName || airport.cityLabel;
      const key = `${city}|${airport.countryName}`;
      const group = groups.get(key) ?? { city, country: airport.countryName, airports: [] };
      group.airports.push(airport);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => {
      const centerAirport = group.airports.find((airport) => airport.cityCenterLatitude !== undefined && airport.cityCenterLongitude !== undefined);
      const center = centerAirport?.cityCenterLatitude !== undefined && centerAirport.cityCenterLongitude !== undefined
        ? { latitude: centerAirport.cityCenterLatitude, longitude: centerAirport.cityCenterLongitude } : undefined;
      const cityTerms = normalize(value).split(/\s+/).filter(Boolean);
      const citySearch = cityTerms.length > 0 && cityTerms.every((term) => normalize(group.city).includes(term));
      return { ...group, center, allAirports: citySearch };
    });
  }, [matches, value]);
  const suggestions = useMemo(() => cityGroups.flatMap((group) => group.airports), [cityGroups]);
  useEffect(() => {
    if (!open || !list.current) return;
    const option = list.current.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!option) return;
    const viewport = list.current;
    const top = option.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const bottom = top + option.offsetHeight;
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (top < viewport.scrollTop) viewport.scrollTo({top,behavior});
    else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTo({top:bottom-viewport.clientHeight,behavior});
  }, [active, open]);

  function show() {
    setOpen(true);
  }

  function select(airport: IndexedAirport) {
    onChange(`${airport.cityLabel} (${airport.code})`);
    setOpen(false);
    setActive(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % Math.max(suggestions.length, 1));
    }
    if (event.key === 'Enter' && open && suggestions.length && value.trim()) {
      event.preventDefault();
      select(suggestions[Math.min(active, suggestions.length - 1)]);
    }
  }

  return <div className="airport-picker">
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} aria-label={`${label} airport`} role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={`${id}-suggestions`} aria-activedescendant={open && suggestions.length ? `${id}-option-${Math.min(active, suggestions.length - 1)}` : undefined}
      autoComplete="off" placeholder="City, airport or code" value={value} required maxLength={120}
      onFocus={show} onBlur={() => setOpen(false)} onKeyDown={handleKeyDown}
      onChange={(event) => { setAirports(null);onChange(event.target.value); setActive(0); setOpen(true); }} />
    {open && createPortal(<div ref={list} id={`${id}-suggestions`} style={popoverStyle} className="airport-suggestions airport-suggestions-portal" role="listbox" aria-label={`${label} airport suggestions`}>
      {!airports && <p className="airport-suggestions-message">{loadError ? 'Airport suggestions are unavailable. Enter a three-letter airport code.' : 'Loading airports…'}</p>}
      {airports && suggestions.length === 0 && <p className="airport-suggestions-message">No matching airport. Try a city, airport name, or three-letter code.</p>}
      {cityGroups.map((group) => {
        const firstIndex = suggestions.findIndex((airport) => airport.code === group.airports[0]?.code);
        return <div className="airport-city-group" role="group" aria-label={`${group.city} airports`} key={`${group.city}|${group.country}`}>
          <div className="airport-city-heading" role="presentation">
            <span className="airport-city-pin" aria-hidden="true">●</span>
            <span><strong>{group.city}{group.allAirports ? ' · All airports' : ''}</strong><small>{group.country}</small></span>
          </div>
          {group.airports.map((airport, groupIndex) => {
            const index = firstIndex + groupIndex;
            return <button id={`${id}-option-${index}`} key={airport.code} type="button" role="option"
              aria-selected={index === active} className={index === active ? 'active' : ''}
              onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => select(airport)}>
              <span className="airport-result-icon" aria-hidden="true">✈</span>
              <span className="airport-result-copy"><strong><b>{airport.code}</b> {airport.name}</strong>
                <small>{distanceFromCentre(airport, group) !== undefined
                  ? `About ${distanceFromCentre(airport, group)} km from city centre`
                  : `${airport.cityLabel} · ${airport.countryName}${airport.scheduled ? '' : ' · Scheduled service not listed'}`}</small></span>
            </button>;
          })}
        </div>;
      })}
    </div>, document.body)}
  </div>;
}
