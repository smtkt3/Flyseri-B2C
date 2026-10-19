import { Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import '../flight/booking-progress.css';
import './visa-journey-progress.css';
export type VisaJourneyStep = 'choose' | 'form' | 'documents' | 'review' | 'payment';
const journeySteps: Array<{ id: VisaJourneyStep; label: string; description: string }> = [
  { id: 'choose', label: 'Choose visa', description: 'Country, date & purpose' },
  { id: 'form', label: 'Applicants', description: 'Applicant information' },
  { id: 'documents', label: 'Documents', description: 'Upload supporting files' },
  { id: 'review', label: 'Review', description: 'Check your application' },
  { id: 'payment', label: 'Payment', description: 'Secure service checkout' },
];

/** One ordered progress indicator for every customer visa screen. */
export function VisaJourneyProgress({ current, complete = false, onSelect, links }: {
  current: VisaJourneyStep; complete?: boolean; onSelect?: (step: VisaJourneyStep) => void; links?: Partial<Record<VisaJourneyStep,string>>;
}) {
  const activeIndex = journeySteps.findIndex(step => step.id === current);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollTo?.({left:Math.max(0, item.offsetLeft - nav.offsetLeft - 16),behavior:'smooth'});
  }, [current, complete]);
  return <nav ref={navRef} className="booking-progress booking-stepper visa-application-progress" aria-label="Visa application steps"><ol>{journeySteps.map((step, index) => {
    const done = complete || index < activeIndex;
    const active = !complete && index === activeIndex;
    const content = <><span className="visa-step-number" aria-hidden="true">{done ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong></>;
    return <li key={step.id} className={done ? 'is-complete' : active ? 'is-current' : ''} aria-label={`${step.description}, ${done ? 'completed' : active ? 'current step' : 'upcoming'}`} aria-current={active ? 'step' : undefined}>{links?.[step.id] ? <Link aria-label={`${step.label} · ${step.description}`} className="visa-step-content" to={links[step.id]!}>{content}</Link> : onSelect && (done || active) ? <button aria-label={`${step.label} · ${step.description}`} className="visa-step-content" type="button" onClick={() => onSelect(step.id)}>{content}</button> : <div className="visa-step-content">{content}</div>}</li>;
  })}</ol></nav>;
}
