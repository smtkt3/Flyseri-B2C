import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackStepState } from '../useBackStepState';
import { ChatAircraftIcon } from './ChatAircraftIcon';
import { HomeFeatureBoundary, HomeFeatureLoading } from './HomeFeatureBoundary';
import './seri-floating-chat.css';
import './home-search-improvements.css';
import './seri-welcome.css';
const HomeSeriSearch = lazy(() => import('./HomeSeriSearch').then(module => ({ default: module.HomeSeriSearch })));
function EntryLauncher({ open, loading = false }: { open: () => void; loading?: boolean }) {
  const launcher = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let frame = 0;
    let fullHeight = window.innerHeight;
    const update = () => {
      frame = 0;
      const editing = !!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
      if (!editing) fullHeight = Math.max(fullHeight, window.innerHeight);
      setHidden(editing || (!!window.visualViewport && fullHeight - window.visualViewport.height > 120));
      const rect = launcher.current?.getBoundingClientRect();
      if (!rect) return;
      const left = rect.right - (window.innerWidth <= 767 ? 214 : 230);
      setCompact(Array.from(document.querySelectorAll<HTMLElement>('main input,main select,main textarea,main button,main [role="combobox"]')).some(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > left && box.top < rect.bottom && box.bottom > rect.top;
      }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update(); document.addEventListener('scroll', schedule, true); document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('scroll', schedule, true); document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); };
  }, []);
  return createPortal(<button ref={launcher} type="button" hidden={hidden} className={'seri-floating-launcher' + (compact ? ' is-compact' : '')} aria-label={loading ? 'Opening Seri chat' : 'Chat with us'} aria-busy={loading} disabled={loading} onClick={open}>{!compact && <span className="seri-launcher-label"><strong>{loading ? 'Opening chat…' : 'Chat with us'}</strong><small>AI & travel support</small></span>}<ChatAircraftIcon/></button>, document.body);
}
export function DeferredHomeSeriSearch({ active }: { active: boolean }) {
  const [floating, setFloating] = useBackStepState('seri-chat', false);
  const [requested, setRequested] = useState(active || floating);
  useEffect(() => { if (active || floating) setRequested(true); }, [active, floating]);
  if (!requested && !active && !floating) return <EntryLauncher open={() => setFloating(true)}/>;
  return <HomeFeatureBoundary name="Seri" fallback={active ? undefined : createPortal(<div className="seri-load-error" role="alert"><strong>Chat could not load</strong><p>Please reload the page to try again.</p><button type="button" onClick={() => window.location.reload()}>Reload page</button><button type="button" onClick={() => { setRequested(false); setFloating(false); }}>Close</button></div>, document.body)}><Suspense fallback={active ? <HomeFeatureLoading name="Seri"/> : <EntryLauncher open={() => undefined} loading/>}><HomeSeriSearch/></Suspense></HomeFeatureBoundary>;
}
