import './booking-checkout.css';
export function BookingLoading({ label }: { label: string }) {
  return <section className="account-panel booking-loading" role="status" aria-live="polite"><p>{label}</p><div aria-hidden="true"><span/><span/><span/></div></section>;
}
