import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const hintKey='flyseri.aircraft-hint-seen-v4';

/** Keep guidance visible until interaction; pulling instructions remain available on every flight. */
export function AircraftGestureHint({phase,boosted,eligible=true}:{phase:string;boosted:boolean;eligible?:boolean}) {
  const {pathname}=useLocation();
  const anchor=useRef<HTMLSpanElement>(null);
  const [visible,setVisible]=useState(false);
  const [seen,setSeen]=useState(()=>{try{return sessionStorage.getItem(hintKey)==='1';}catch{return false;}});
  const checkout=/checkout|payment|flight-review|flight-extras|flight-intent/.test(pathname);
  useEffect(()=>{
    const button=anchor.current?.closest('button');
    const interacted=()=>{
      setVisible(false);setSeen(true);
      try{sessionStorage.setItem(hintKey,'1');}catch{}
    };
    button?.addEventListener('pointerdown',interacted);
    button?.addEventListener('keydown',interacted);
    button?.addEventListener('click',interacted);
    return()=>{button?.removeEventListener('pointerdown',interacted);button?.removeEventListener('keydown',interacted);button?.removeEventListener('click',interacted);};
  },[]);
  useEffect(()=>{
    if(!eligible||checkout||seen||phase!=='idle') {setVisible(false);return;}
    let show:ReturnType<typeof setTimeout>|undefined;
    const cancel=()=>{clearTimeout(show);setVisible(false);};
    const schedule=()=>{
      cancel();
      if(document.hidden||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return;
      try{if(sessionStorage.getItem(hintKey)==='1')return;}catch{}
      show=setTimeout(()=>{
        setVisible(true);
      },1200);
    };
    schedule();
    document.addEventListener('visibilitychange',schedule);
    document.addEventListener('focusin',schedule);
    document.addEventListener('focusout',schedule);
    return()=>{cancel();document.removeEventListener('visibilitychange',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);};
  },[eligible,checkout,seen,phase]);
  const pulling=phase==='pulling'&&eligible&&!checkout;
  return <span ref={anchor} className="seri-aircraft-hint-anchor">{(visible||pulling)&&<span className={`seri-aircraft-hint${pulling?'':' is-invitation'}`} role="status">
    <strong>{pulling ? boosted ? 'Ready for takeoff!' : 'Release to open chat' : 'Hold, then pull down to fly ↓'}</strong>
    <small>{pulling ? boosted ? 'Release to fly & chat' : 'Hold for a boost' : 'Drag to move · tap to chat'}</small>
  </span>}</span>;
}
