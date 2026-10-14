import './booking-checkout.css';
import './booking-progress.css';

const steps = [
  { label: 'Travelers', description: 'Travelers' },
  { label: 'Extras', description: 'Extras' },
  { label: 'Review', description: 'Review trip' },
  { label: 'Payment', description: 'Payment' },
  { label: 'Confirm', description: 'Confirmation' },
];

export function BookingProgress({ current, complete = false, stage }: { current: 0 | 1 | 2 | 3; complete?: boolean; stage?: 0 | 1 | 2 | 3 | 4 }) {
  const active = stage ?? (complete ? 4 : current <= 1 ? 0 : current);
  return <nav className="booking-progress booking-stepper" aria-label="Booking progress"><ol>
    {steps.map(({ label, description }, index) => <li key={description}
      className={index < active ? 'is-complete' : index === active ? 'is-current' : ''}
      aria-label={`${description}${index < active ? ', completed' : index === active ? ', current step' : ''}`}
      aria-current={index === active ? 'step' : undefined}>
      <span aria-hidden="true">{index < active ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{label}</strong>
    </li>)}
  </ol></nav>;
}
