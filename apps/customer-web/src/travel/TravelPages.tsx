import { Link } from 'react-router-dom';
import { PremiumNavbar } from '../components/PremiumNavbar';
import { TripBudget } from './TripBudget';
import { useLanguage } from './language';
export function BudgetPage() {
  const { t } = useLanguage();
  return <div className="customer-site-shell"><PremiumNavbar /><main className="account-page" style={{ maxWidth: 1000, margin: 'auto' }}><Link to="/">← {t('Home')}</Link><h1>{t('Trip budget')}</h1><TripBudget /></main></div>;
}
