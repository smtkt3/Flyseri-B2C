import { HomeLoadingScreen } from './home/HomeLoadingScreen';

export function PageLoading({ label = 'Opening your page…' }: { label?: string }) {
  return <HomeLoadingScreen label={label}/>;
}
