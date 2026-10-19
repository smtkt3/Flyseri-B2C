import { CustomerSiteLayout } from '../account/CustomerSiteLayout';
import { VisaHubPage } from './VisaHubPage';
import { VisaDestinationPage } from './VisaDestinationPage';

export function PublicVisaPage({guide=false}:{guide?:boolean}) {
  return <CustomerSiteLayout>{guide ? <VisaDestinationPage/> : <VisaHubPage/>}</CustomerSiteLayout>;
}
