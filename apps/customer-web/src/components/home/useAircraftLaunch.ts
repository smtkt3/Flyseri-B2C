import { useEffect, useRef, useState, type RefObject, type PointerEvent, type MouseEvent } from 'react';

export const AIRCRAFT_FLIGHT_PATTERNS = ['wide-orbit', 'coastal-sweep', 'sky-wave'] as const;
export type AircraftFlightPattern = typeof AIRCRAFT_FLIGHT_PATTERNS[number];

/** Smooth, viewport-bounded B-splines, sampled by distance rather than control-point time. */
export function aircraftFlightFrames(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, viewport: { width: number; height: number }, pattern: AircraftFlightPattern = 'wide-orbit', boosted = false): Keyframe[] {
  const margin=Math.max(rect.width,rect.height)*.22+12;
  const width=Math.max(0,Math.min(350,rect.left-margin));
  const height=Math.max(0,Math.min(300,rect.top-margin));
  const depth=Math.min(24,Math.max(0,viewport.height-rect.top-rect.height-4));
  type Point = [number,number];
  const routes: Record<AircraftFlightPattern,Point[]> = {
    'wide-orbit': [[0,-.28],[-.15,-.85],[-.65,-1],[-1,-.72],[-1,-.22],[-.7,0]],
    'coastal-sweep': [[0,-.35],[-.35,-.7],[-.95,-.65],[-1,-.3],[-.75,-.08],[-.5,0]],
    'sky-wave': [[0,-.3],[-.25,-.95],[-.7,-1],[-.95,-.65],[-.55,-.43],[-.8,-.16],[-.65,0]],
  };
  const controls: Point[] = [[0,0],...routes[pattern].map(([x,y]):Point=>[x*width,y*height]),[-width*.35,depth],[-depth/Math.sqrt(3),depth],[0,0]];
  const degree=3, count=controls.length;
  const knots=Array.from({length:count+degree+1},(_,i)=> i<=degree ? 0 : i>=count ? 1 : (i-degree)/(count-degree));
  const evaluate=(t:number):Point=>{
    const span=t>=1 ? count-1 : Math.max(degree,knots.findIndex((v,i)=>i>=degree && v>t)-1);
    const d=Array.from({length:degree+1},(_,j):Point=>[...controls[span-degree+j]!] as Point);
    for(let r=1;r<=degree;r++) for(let j=degree;j>=r;j--) {
      const k=span-degree+j, alpha=(t-knots[k]!)/(knots[k+degree-r+1]!-knots[k]!);
      d[j]=[d[j-1]![0]*(1-alpha)+d[j]![0]*alpha,d[j-1]![1]*(1-alpha)+d[j]![1]*alpha];
    }
    return d[degree]!;
  };
  // A tiny lookup table avoids uneven speed and sharp turns at segment boundaries.
  const lookup=Array.from({length:801},(_,i)=>evaluate(i/800));
  const lengths=[0];
  for(let i=1;i<lookup.length;i++) lengths.push(lengths[i-1]!+Math.hypot(lookup[i]![0]-lookup[i-1]![0],lookup[i]![1]-lookup[i-1]![1]));
  const total=lengths.at(-1)!;
  let previous=0;
  return Array.from({length:121},(_,sample)=>{
    const landing=sample>96, progress=(sample-96)/24;
    // Match approach entry speed, then progressively ease to a stop in both modes.
    const power=boosted ? 3.19 : 1.877;
    const distance=total*(landing ? .78+.22*(1-Math.pow(1-progress,power)) : .78*sample/96);
    let low=0,high=800;
    while(low<high){const mid=(low+high)>>1;if(lengths[mid]!<distance)low=mid+1;else high=mid;}
    const index=Math.max(1,low), delta=lengths[index]!-lengths[index-1]!;
    const t=((index-1)+(delta ? (distance-lengths[index-1]!)/delta : 0))/800;
    const [x,y]=evaluate(t);
    const before=evaluate(Math.max(0,t-.00001)),after=evaluate(Math.min(1,t+.00001));
    let rotation=Math.atan2(after[1]-before[1],after[0]-before[0])*180/Math.PI+60;
    while(rotation-previous>180)rotation-=360;
    while(rotation-previous< -180)rotation+=360;
    if(sample<6)rotation*=sample/6;
    previous=rotation;
    const offset=sample<=96 ? sample/96*.72 : .72+(sample-96)/24*.28;
    return {transform:`translate3d(${sample===0||sample===120 ? 0 : x}px,${sample===0||sample===120 ? 0 : y}px,0) rotate(${rotation}deg)`,offset,easing:'linear'};
  });
}
export function useAircraftLaunch(button: RefObject<HTMLButtonElement | null>, open: () => void, disabled = false) {
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'shaking' | 'flying' | 'landing'>('idle');
  const [boosted, setBoosted] = useState(false);
  const charged = useRef(false);
  const lastPattern = useRef<AircraftFlightPattern | null>(null);
  const chargeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef<{ id: number; y: number; distance: number; room: number } | null>(null);
  const locked = useRef(false);
  const suppressClick = useRef(false);
  const animation = useRef<Animation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const openRef = useRef(open); openRef.current = open;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (chargeTimer.current) clearTimeout(chargeTimer.current); animation.current?.cancel(); if (timer.current) clearTimeout(timer.current); };
  }, []);
  function clearCharge() {
    if (chargeTimer.current) clearTimeout(chargeTimer.current);
    chargeTimer.current = null; charged.current = false;
    if (mounted.current) setBoosted(false);
  }
  function reset() {
    clearCharge();
    gesture.current = null;
    button.current?.style.removeProperty('--seri-pull');
    if (mounted.current) setPhase('idle');
  }
  function launch() {
    if (locked.current || disabledRef.current) return;
    const plane = button.current?.querySelector<HTMLElement>('.seri-aircraft-motion');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !plane?.animate) { reset(); openRef.current(); return; }
    const fast = charged.current;
    if (chargeTimer.current) clearTimeout(chargeTimer.current);
    chargeTimer.current = null;
    locked.current = true; setPhase('shaking');
    const shake = plane.animate([
      { transform: 'translate3d(0,0,0) rotate(0deg)' },
      { transform: 'translate3d(-3px,1px,0) rotate(-7deg)' },
      { transform: 'translate3d(3px,-1px,0) rotate(6deg)' },
      { transform: 'translate3d(-2px,0,0) rotate(-4deg)' },
      { transform: 'translate3d(0,0,0) rotate(0deg)' },
    ], { duration: 300, iterations: 1, easing: 'ease-in-out' });
    animation.current = shake;
    const finish = () => {
      if (!locked.current || !mounted.current) return;
      locked.current = false;
      if (timer.current) clearTimeout(timer.current);
      animation.current?.cancel(); animation.current = null;
      reset();
      if (!disabledRef.current) openRef.current();
    };
    // A background tab or browser animation cancellation must not leave chat stuck.
    timer.current = setTimeout(finish, 4000);
    void shake.finished.then(() => {
      if (!mounted.current || !locked.current) return;
      setPhase('flying');
      const choices=AIRCRAFT_FLIGHT_PATTERNS.filter(pattern=>pattern!==lastPattern.current);
      const pattern=choices[Math.floor(Math.random()*choices.length)]!;
      lastPattern.current=pattern;
      const frames = aircraftFlightFrames(plane.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight },pattern,fast);
      const flight = plane.animate(frames.slice(0,97).map(frame=>({...frame,offset:Number(frame.offset)/.72})), { duration: fast ? 1000 : 1700, fill: 'forwards', easing: 'linear' });
      animation.current = flight;
      void flight.finished.then(() => {
        if (!mounted.current || !locked.current) return;
        setPhase('landing'); setBoosted(false);
        // Boost affects only the flight. Both approaches receive the full landing time.
        const landing=plane.animate(frames.slice(96).map(frame=>({...frame,offset:Math.min(1,Math.max(0,(Number(frame.offset)-.72)/.28))})), {duration:900,fill:'forwards',easing:'linear'});
        flight.cancel();
        animation.current=landing;
        void landing.finished.then(()=>{
          if (!mounted.current || !locked.current) return;
          const finalTransform=String(frames.at(-1)!.transform);
          const angle=Number(/rotate\(([-\d.e]+)deg\)/.exec(finalTransform)?.[1] ?? 0);
          const dockTransform=`translate3d(0px,0px,0) rotate(${Math.round(angle/360)*360}deg)`;
          const settle=plane.animate([
            {transform:`${finalTransform} scale(1)`},
            {transform:`${dockTransform} scale(.98)`,offset:.45},
            {transform:`${dockTransform} scale(1)`},
          ], {duration:260,fill:'forwards',easing:'ease-out'});
          landing.cancel(); animation.current=settle;
          void settle.finished.then(finish,finish);
        },finish);
      }, finish);
    }, finish);
  }
  return {
    phase, boosted,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (disabled || locked.current || !event.isPrimary || event.button !== 0) return;
        clearCharge();
        suppressClick.current = false;
        const plane = button.current?.querySelector('.seri-aircraft-motion')?.getBoundingClientRect();
        gesture.current = { id: event.pointerId, y: event.clientY, distance: 0, room: plane ? Math.max(0, window.innerHeight - plane.bottom - 4) : 18 };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        current.distance = event.clientY - current.y;
        if (Math.abs(current.distance) < 5) { clearCharge(); return; }
        suppressClick.current = true;
        setPhase('pulling');
        if (current.distance >= 24 && !chargeTimer.current && !charged.current && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          chargeTimer.current = setTimeout(() => {
            chargeTimer.current = null;
            if (gesture.current === current && current.distance >= 24 && !disabledRef.current) { charged.current = true; setBoosted(true); }
          }, 1200);
        } else if (current.distance < 24) clearCharge();
        event.currentTarget.style.setProperty('--seri-pull', `${Math.min(Math.max(0, current.distance) * .35, 26, current.room)}px`);
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const pulled = current.distance >= 24;
        gesture.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        button.current?.style.removeProperty('--seri-pull');
        if (pulled) { suppressClick.current = true; launch(); } else reset();
      },
      onPointerCancel() { suppressClick.current = true; reset(); },
      onLostPointerCapture() { if (gesture.current) { suppressClick.current = true; reset(); } },
      onClick(event: MouseEvent<HTMLButtonElement>) {
        if (disabled || locked.current) return;
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        openRef.current();
      },
      onKeyDown(event: import('react').KeyboardEvent<HTMLButtonElement>) {
        if (event.key === 'ArrowDown') { event.preventDefault(); launch(); }
      },
    },
  };
}
