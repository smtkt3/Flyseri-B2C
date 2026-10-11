import { CheckoutPageHeader } from '../flight/CheckoutPageHeader';
import { Translated } from '../travel/language';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerProfile } from '@flyseri/types';
import { Link } from 'react-router-dom';
import { customerService } from '../services/customerService';

const blank: CustomerProfile = { displayName: null, phoneCountryCode: null, phoneNumber: null, preferredLanguage: null, preferredCurrency: null };

export function ProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile>(blank);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try { setProfile(await customerService.me()); setHasLoaded(true); }
    catch { setError("We couldn't load your profile. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try { setProfile(await customerService.update(profile)); setNotice('Your profile has been saved.'); }
    catch { setError("We couldn't save your profile. Please check the fields and try again."); }
    finally { setSaving(false); }
  }

  const field = (key: keyof CustomerProfile) => (event: React.ChangeEvent<HTMLInputElement>) => setProfile((previous) => ({ ...previous, [key]: event.target.value || null }));
  return <div className="account-page"><CheckoutPageHeader title="My profile" description="Manage your contact details and preferences."/>
    {loading ? <p role="status" className="account-soft-note">Loading your profile…</p> : error && !hasLoaded ? <div role="alert" className="account-error">{error} <button onClick={() => { void load(); }}><Translated text="Retry" /></button></div> : <>
      {error && <p role="alert" className="account-error">{error}</p>}{notice && <p role="status" className="account-notice">{notice}</p>}
      <form className="account-panel account-form" onSubmit={(event) => { void save(event); }}>
        <h2>Account details</h2><div className="account-form-grid">
          <label>Display name<input maxLength={120} value={profile.displayName ?? ''} onChange={field('displayName')} placeholder="Your name" /></label>
          <label>Phone country code<input pattern="\+[1-9][0-9]{0,3}" value={profile.phoneCountryCode ?? ''} onChange={field('phoneCountryCode')} placeholder="+60" /></label>
          <label>Phone number<input inputMode="tel" pattern="[0-9]{4,20}" value={profile.phoneNumber ?? ''} onChange={field('phoneNumber')} placeholder="Digits only" /></label>
          <label>Preferred language<input pattern="[a-z]{2,3}(-[A-Z]{2})?" value={profile.preferredLanguage ?? ''} onChange={field('preferredLanguage')} placeholder="en or en-MY" /></label>
          <label>Preferred currency<input pattern="[A-Z]{3}" maxLength={3} value={profile.preferredCurrency ?? ''} onChange={field('preferredCurrency')} placeholder="BDT" /></label>
        </div><button className="btn-primary account-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form><div className="account-panel account-security"><h2>Security</h2><p>Your password and sign-in are managed through Flyseri authentication.</p><Link to="/reset-password">Change password →</Link></div>
    </>}
  </div>;
}
