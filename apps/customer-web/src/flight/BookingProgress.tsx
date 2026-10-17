import './booking-checkout.css';
import './booking-progress.css';
import type { BookingOutcome } from './bookingPresentation';

const steps = [
  { label: 'Travelers', description: 'Travelers' },
  { label: 'Extras', description: 'Extras' },
  { label: 'Review', description: 'Review trip' },
  { label: 'Payment', description: 'Payment' },
  { label: 'Confirm', description: 'Confirmation' },
];

export function BookingProgress({ current, complete = false, stage, outcome, paymentComplete=false, onEditTravelers, onEditExtras, disabled=false }: { current: 0 | 1 | 2 | 3; complete?: boolean; stage?: 0 | 1 | 2 | 3 | 4; outcome?: BookingOutcome; paymentComplete?: boolean; onEditTravelers?:()=>void; onEditExtras?:()=>void; disabled?:boolean }) {
  const active = outcome ? 4 : stage ?? (complete ? 4 : current <= 1 ? 0 : current);
  return <nav className="booking-progress booking-stepper" aria-label="Booking progress"><ol>
    {steps.map(({ label, description }, index) => <li key={description}
      className={outcome && index === 3 && !paymentComplete ? 'is-unconfirmed' : index === 4 && outcome ? `is-current is-result result-${outcome}` : index < active ? 'is-complete' : index === active ? 'is-current' : ''}
      aria-label={outcome && index === 3 && !paymentComplete ? 'Payment, not confirmed' : outcome ? index === 4 ? `Booking result: ${outcome}. Result step reached.` : `${description}, booking result reached; see status summary for confirmation` : `${description}${index < active ? ', completed' : index === active ? ', current step' : ''}`}
      aria-current={index === active ? 'step' : undefined}>
      {index<active&&(index===0?onEditTravelers:index===1?onEditExtras:undefined)?<button type="button" className="booking-step-edit" disabled={disabled} onClick={index===0?onEditTravelers:onEditExtras} aria-label={index===0?'Edit traveler details':'Edit airline extras'}><span aria-hidden="true">✓</span><strong>{label}</strong></button>:<><span aria-hidden="true">{outcome && index === 3 && !paymentComplete ? '—' : index < active || index === 4 && outcome ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{index === 4 && outcome ? {confirmed:'Confirmed',pending:'Pending',unsuccessful:'Unsuccessful'}[outcome] : label}</strong></>}
    </li>)}
  </ol></nav>;
}
