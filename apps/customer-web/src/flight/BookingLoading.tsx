import { HomeLoadingScreen } from '../components/home/HomeLoadingScreen';
export function BookingLoading({ label, heading, description }: { label: string; heading?: string; description?: string }) {
  return <HomeLoadingScreen label={label} overlay message={heading || description ? <>{heading && <strong>{heading}</strong>}{description && <p>{description}</p>}</> : undefined}/>;
}
