import aircraft from '../../assets/seri-aircraft-render.png';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './home-loading.css';

// Every loader shares one document-timeline origin, including the first HTML paint.
// Swapping route fallbacks or payment loading states must not restart the spin.
let rotationEpoch: number | null = (typeof document === 'undefined' ? [] :
  document.querySelector('.home-loading-journey')?.getAnimations?.({subtree:true}) ?? [])
  .find(animation => typeof animation.startTime === 'number')?.startTime as number | undefined ?? null;

/** Keep this fallback in sync with the first-paint markup in index.html. */
export function HomeLoadingScreen({label='Loading Flyseri',overlay=false}:{label?:string;overlay?:boolean}) {
  const journey = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const syncRotation = () => {
      if (!journey.current || preference?.matches) return;
      const now = typeof document.timeline?.currentTime === 'number' ? document.timeline.currentTime : performance.now();
      rotationEpoch ??= now;
      const animations = journey.current.getAnimations?.({subtree:true}) ?? [];
      if (animations.length) animations.forEach(animation => { animation.startTime = rotationEpoch; });
      else journey.current.style.setProperty('--home-loading-phase', `-${(now - rotationEpoch) % 2400}ms`);
    };
    const motionChanged = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(syncRotation); };
    syncRotation();
    preference?.addEventListener('change',motionChanged);
    return () => { cancelAnimationFrame(frame); preference?.removeEventListener('change',motionChanged); };
  }, [overlay]);
  const content = <div className={`home-loading${overlay ? ' is-overlay' : ''}`} role="status" aria-live="polite" aria-label={label}>
    <div ref={journey} className="home-loading-journey" aria-hidden="true">
      <div className="home-loading-aircraft">
        <span className="home-loading-smoke"/><span className="home-loading-smoke"/>
        <span className="home-loading-smoke"/><span className="home-loading-smoke"/>
        <img src={aircraft} alt="" width={96} height={96}/>
      </div>
    </div>
  </div>;
  return createPortal(content, document.body);
}
