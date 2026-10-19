import { useCallback, useEffect, useState, useSyncExternalStore, type SetStateAction } from 'react';
import { useBackStepState } from './useBackStepState';

const preferenceKey='flyseri.travel-services.expanded';
const preferenceEvent='flyseri:travel-services-preference';
let fallbackExpanded=true;
let memoryPreference=false;
function snapshot(){if(memoryPreference)return fallbackExpanded;try{return localStorage.getItem(preferenceKey)!=='false';}catch{return fallbackExpanded;}}
function subscribe(update:()=>void){
  window.addEventListener(preferenceEvent,update);window.addEventListener('storage',update);
  return ()=>{window.removeEventListener(preferenceEvent,update);window.removeEventListener('storage',update);};
}
export function useTravelServiceMenu(enabled=true){
  const [compact,setCompact]=useState(()=>window.matchMedia('(max-width:1100px)').matches);
  const desktopExpanded=useSyncExternalStore(subscribe,snapshot,()=>true);
  const [drawerExpanded,setDrawerExpanded]=useBackStepState('travel-services',false);
  useEffect(()=>{
    const media=window.matchMedia('(max-width:1100px)');
    const update=()=>setCompact(media.matches);
    media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  const expanded=compact?drawerExpanded:desktopExpanded;
  const setExpanded=useCallback((action:SetStateAction<boolean>)=>{
    if(compact){setDrawerExpanded(action);return;}
    const next=typeof action==='function'?action(snapshot()):action;
    fallbackExpanded=next;
    try{localStorage.setItem(preferenceKey,String(next));}catch{memoryPreference=true;}
    window.dispatchEvent(new Event(preferenceEvent));
  },[compact,setDrawerExpanded]);
  useEffect(()=>{
    if(!enabled||!expanded)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented)setExpanded(false);};
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[enabled,expanded,setExpanded]);
  return {compact,expanded,setExpanded};
}
