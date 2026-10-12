import aircraft from '../../assets/seri-aircraft-render.png';
import { useLayoutEffect, useRef } from 'react';
import './home-loading.css';

// Continue the first HTML paint's flight when React replaces the shell.
// Later page transitions start a fresh flight from the left edge.
const firstPaintAnimations = new Map((typeof document === 'undefined' ? [] :
  document.querySelector('.home-loading-journey')?.getAnimations?.({subtree:true}) ?? [])
  .filter(animation => typeof animation.startTime === 'number')
  .map(animation => [(animation as CSSAnimation).animationName, animation.startTime as number]));
let firstPaintClaimed = false;

/** Keep this fallback in sync with the first-paint markup in index.html. */
export function HomeLoadingScreen({label='Loading Flyseri'}:{label?:string}) {
  const journey = useRef<HTMLDivElement>(null);
  const continueFirstPaint = useRef(!firstPaintClaimed);
  useLayoutEffect(() => {
    if (!continueFirstPaint.current) return;
    firstPaintClaimed = true;
    journey.current?.getAnimations?.({subtree:true}).forEach(animation => {
      const startTime = firstPaintAnimations.get((animation as CSSAnimation).animationName);
      if (startTime !== undefined) animation.startTime = startTime;
    });
  }, []);
  return <div className="home-loading" role="status" aria-live="polite" aria-label={label}>
    <div ref={journey} className="home-loading-journey" aria-hidden="true">
      <div className="home-loading-aircraft">
        <span className="home-loading-smoke"/><span className="home-loading-smoke"/>
        <span className="home-loading-smoke"/><span className="home-loading-smoke"/>
        <img src={aircraft} alt="" width={96} height={96}/>
      </div>
    </div>
  </div>;
}
