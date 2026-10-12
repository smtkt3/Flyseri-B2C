import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import type { CustomerProfile } from '@flyseri/types';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { customerService } from '../services/customerService';
import { useLanguage } from '../travel/language';
import { currencyCodes, preferredCurrency, saveCurrencyPreference } from '../components/LocaleMenu';
import { AccountTabs } from './AccountTabs';
import { ProfilePhoto } from './ProfilePhoto';
import { PageLoading } from '../components/PageLoading';
import { publishProfile } from './profileEvents';
import './account-workspace.css';

const MyDocumentsPage=lazy(()=>import('../document/MyDocumentsPage').then(module=>({default:module.MyDocumentsPage})));
const tabs=[{value:'details',label:'Personal details'},{value:'documents',label:'Documents'},{value:'preferences',label:'Preferences'},{value:'security',label:'Security'}] as const;
const blank:CustomerProfile={displayName:null,phoneCountryCode:null,phoneNumber:null,preferredLanguage:null,preferredCurrency:null};

export function ProfilePage() {
  const {session}=useAuth();
  const {language,setLanguage}=useLanguage();
  const [search,setSearch]=useSearchParams();
  const section=tabs.find(tab=>tab.value===search.get('section'))?.value??'details';
  const [profile,setProfile]=useState<CustomerProfile>(blank);
  const [hasLoaded,setHasLoaded]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [saving,setSaving]=useState(false);
  async function load() {
    setLoading(true);setError('');
    try {const saved=await customerService.me();setProfile({...saved,preferredLanguage:saved.preferredLanguage??language,preferredCurrency:saved.preferredCurrency??preferredCurrency()});setHasLoaded(true);}
    catch{setError("We couldn't load your profile. Please try again.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  async function save(event:FormEvent<HTMLFormElement>,preferences=false) {
    event.preventDefault();if(saving)return;
    setSaving(true);setError('');setNotice('');
    const patch=preferences?{preferredLanguage:profile.preferredLanguage,preferredCurrency:profile.preferredCurrency}:{displayName:profile.displayName?.trim()||null,phoneCountryCode:profile.phoneCountryCode,phoneNumber:profile.phoneNumber};
    try {
      const saved=await customerService.update(patch);
      setProfile(previous=>preferences?{...previous,preferredLanguage:saved.preferredLanguage,preferredCurrency:saved.preferredCurrency}:{...previous,displayName:saved.displayName,phoneCountryCode:saved.phoneCountryCode,phoneNumber:saved.phoneNumber});
      if(session?.user?.id)publishProfile(session.user.id,saved);
      if(preferences){if(saved.preferredLanguage==='en'||saved.preferredLanguage==='bn')setLanguage(saved.preferredLanguage);if(saved.preferredCurrency)saveCurrencyPreference(saved.preferredCurrency);}
      setNotice(preferences?'Your default language and currency have been saved.':'Your personal details have been saved.');
    }catch{setError("We couldn't save your profile. Please check the fields and try again.");}
    finally{setSaving(false);}
  }
  function change(key:keyof CustomerProfile,value:string){setProfile(previous=>({...previous,[key]:value||null}));}
  const name=profile.displayName||session?.user?.email?.split('@')[0]||'Your account';
  return <div className="account-page profile-workspace"><header className="account-workspace-hero"><div><p className="account-eyebrow">MY FLYSERI</p><h1>Profile &amp; settings</h1><p>A little about you. A smoother journey every time.</p></div><Link className="account-outline-button" to="/app/bookings">View my travel</Link></header>
    <AccountTabs label="Profile settings" disabled={saving} items={tabs} value={section} prefix="profile" onChange={value=>{const next=new URLSearchParams(search);next.set('section',value);setSearch(next);setError('');setNotice('');}}/>
    <section id="profile-panel" role="tabpanel" aria-labelledby={`profile-${section}-tab`} tabIndex={0}>
    {section==='documents'?<Suspense fallback={<PageLoading label="Loading your documents…"/>}><MyDocumentsPage embedded/></Suspense>:section==='security'?<div className="profile-settings-grid"><section className="profile-settings-card"><span className="profile-card-symbol" aria-hidden="true">◎</span><h2>Sign-in &amp; security</h2><p>Your sign-in email is managed by Flyseri authentication.</p><dl className="profile-summary"><dt>Sign-in email</dt><dd>{session?.user?.email||'Your account email'}</dd></dl><Link className="account-outline-button" to="/reset-password">Change password</Link></section><section className="profile-settings-card"><h2>Privacy &amp; help</h2><p>Learn how your information is used, or get help with your account.</p><div className="profile-resource-links"><Link to="/help#policies">Policies &amp; privacy <span aria-hidden="true">↗</span></Link><Link to="/app/support">Contact support <span aria-hidden="true">↗</span></Link></div></section></div>:loading?<p role="status" className="account-soft-note">Loading your profile…</p>:!hasLoaded?<div role="alert" className="account-error">{error||"We couldn't load your profile."} <button className="account-outline-button" onClick={()=>void load()}>Retry</button></div>:<>
      {error&&<p role="alert" className="account-error">{error}</p>}{notice&&<p role="status" className="account-notice">{notice}</p>}
      {section==='details'?<><ProfilePhoto name={name}/><div className="profile-settings-grid"><form className="profile-settings-card account-form" onSubmit={event=>void save(event)}><div className="profile-card-heading"><h2>Personal details</h2><p>How we address you and reach you about your journeys.</p></div><label>Display name<input autoComplete="nickname" maxLength={120} value={profile.displayName??''} onChange={event=>change('displayName',event.target.value)} placeholder="Your name"/></label><div className="profile-phone-fields"><label>Phone country code<input autoComplete="tel-country-code" inputMode="tel" pattern="\+[1-9][0-9]{0,3}" value={profile.phoneCountryCode??''} onChange={event=>change('phoneCountryCode',event.target.value)} placeholder="+880"/></label><label>Phone number<input autoComplete="tel-national" inputMode="tel" pattern="[0-9]{4,20}" maxLength={20} value={profile.phoneNumber??''} onChange={event=>change('phoneNumber',event.target.value)} placeholder="Digits only"/></label></div><p className="profile-field-help">Legal names for tickets are saved separately under Travellers.</p><div className="profile-save-row"><button className="btn-primary" type="submit" disabled={saving}>{saving?'Saving…':'Save personal details'}</button></div></form><aside className="profile-settings-card profile-essentials"><h2>Your travel essentials</h2><p>Keep the details you use most close at hand.</p><div className="profile-resource-links"><Link to="/app/profile?section=documents"><span><strong>My documents</strong><small>Passports, visas and travel files</small></span><span aria-hidden="true">↗</span></Link><Link to="/app/travellers"><span><strong>Saved travellers</strong><small>Legal names and passenger details</small></span><span aria-hidden="true">↗</span></Link><Link to="/app/points"><span><strong>Flyseri Points</strong><small>Your balance and rewards activity</small></span><span aria-hidden="true">↗</span></Link></div></aside></div></>:<form className="profile-settings-card account-form profile-preferences" onSubmit={event=>void save(event,true)}><div className="profile-card-heading"><h2>Make Flyseri feel like yours</h2><p>Save the language and currency you prefer to use.</p></div><div className="account-form-grid"><label>Default language<select value={profile.preferredLanguage??'en'} onChange={event=>change('preferredLanguage',event.target.value)}><option value="en">English</option><option value="bn">বাংলা · Bengali</option>{profile.preferredLanguage&&!['en','bn'].includes(profile.preferredLanguage)&&<option value={profile.preferredLanguage}>{profile.preferredLanguage} · Previous preference</option>}</select></label><label>Default currency<select value={profile.preferredCurrency??'BDT'} onChange={event=>change('preferredCurrency',event.target.value)}>{currencyCodes.map(code=><option key={code} value={code}>{code} · {new Intl.DisplayNames(['en'],{type:'currency'}).of(code)}</option>)}{profile.preferredCurrency&&!currencyCodes.includes(profile.preferredCurrency)&&<option value={profile.preferredCurrency}>{profile.preferredCurrency} · Previous preference</option>}</select></label></div><p className="profile-preference-note">Currency preferences apply to displayed prices. Your final payment currency is always shown before you pay. Some content may remain in English.</p><div className="profile-save-row"><button className="btn-primary" type="submit" disabled={saving}>{saving?'Saving…':'Save preferences'}</button></div></form>}
    </>}
    </section>
  </div>;
}
