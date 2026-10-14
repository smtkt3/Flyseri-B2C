import { HomeLoadingScreen } from '../components/home/HomeLoadingScreen';
export function BookingLoading({ label }: { label: string }) {
  return <HomeLoadingScreen label={label} overlay/>;
}
