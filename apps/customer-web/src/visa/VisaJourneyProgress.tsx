import { Link } from 'react-router-dom';
export type VisaJourneyStep = 'choose' | 'form' | 'documents' | 'review' | 'payment';
const journeySteps: Array<{ id: VisaJourneyStep; label: string; description: string }> = [
  { id: 'choose', label: 'Choose visa', description: 'Country, date & purpose' },
  { id: 'form', label: 'Fill in the form', description: 'Applicant information' },
  { id: 'documents', label: 'Upload documents', description: 'Supporting files' },
  { id: 'review', label: 'Review details', description: 'Check your application' },
  { id: 'payment', label: 'Payment', description: 'Secure service checkout' },
];

/** One ordered progress indicator for every customer visa screen. */
export function VisaJourneyProgress({ current, complete = false, onSelect, links, reached = current }: {
  current: VisaJourneyStep; complete?: boolean; onSelect?: (step: VisaJourneyStep) => void; links?: Partial<Record<VisaJourneyStep,string>>; reached?: VisaJourneyStep;
}) {
  const activeIndex = journeySteps.findIndex(step => step.id === current);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollTo?.({left:Math.max(0, item.offsetLeft - nav.offsetLeft - 16),behavior:'smooth'});
  }, [current, complete]);
  return <nav ref={navRef} className="visa-journey-progress" aria-label="Visa application steps"><ol>{journeySteps.map((step, index) => {
    const done = complete || (index < journeySteps.findIndex(item => item.id === reached) && index !== activeIndex);
    const active = !complete && index === activeIndex;
    const content = <><span className="visa-journey-number" aria-hidden="true">{done ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="visa-journey-copy"><strong>{step.label}</strong><small>{step.description}</small><span className="visa-journey-state">{done ? 'Completed' : active ? 'Current step' : 'Upcoming'}</span></span></>;
    return <li key={step.id} className={done ? 'done' : active ? 'active' : ''} aria-current={active ? 'step' : undefined}>{links?.[step.id] ? <Link to={links[step.id]!}>{content}</Link> : onSelect && (done || active) ? <button type="button" onClick={() => onSelect(step.id)}>{content}</button> : <div>{content}</div>}</li>;
  })}</ol></nav>;
}
import { useEffect, useRef } from 'react';
