import { Link } from 'react-router-dom';
import { CustomerSiteLayout } from '../account/CustomerSiteLayout';
import { TripBudget } from './TripBudget';
import { useLanguage } from './language';
export function BudgetPage() {
  const { t } = useLanguage();
  return <CustomerSiteLayout><main className="account-page"><Link to="/">← {t('Home')}</Link><h1>{t('Trip budget')}</h1><TripBudget /></main></CustomerSiteLayout>;
}
