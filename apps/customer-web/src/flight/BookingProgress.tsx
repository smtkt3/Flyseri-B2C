import './booking-checkout.css';

export function BookingProgress({ current, complete = false, stage }: { current: 0 | 1 | 2 | 3; complete?: boolean; stage?: 0 | 1 | 2 | 3 | 4 }) {
  const active = stage ?? (complete ? 4 : current <= 1 ? 0 : current);
  return <nav className="booking-progress" aria-label="Booking progress"><ol>
    {['Travelers', 'Extras', 'Review & reserve', 'Payment', 'Confirmation'].map((label, index) => <li key={label}
      className={index < active ? 'is-complete' : index === active ? 'is-current' : ''}
      aria-current={index === active ? 'step' : undefined}>
      <span aria-hidden="true">{index < active ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{label}</strong>
    </li>)}
  </ol></nav>;
}
