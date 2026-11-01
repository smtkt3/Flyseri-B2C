import { HomeLoadingScreen } from './home/HomeLoadingScreen';

export function PageLoading({ label = 'Opening your page…', inline=false, compact=false }: { label?: string;inline?:boolean;compact?:boolean }) {
  return <HomeLoadingScreen label={label} inline={inline} compact={compact}/>;
}
