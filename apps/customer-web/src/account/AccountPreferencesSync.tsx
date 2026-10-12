import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLanguage } from '../travel/language';
import { customerService } from '../services/customerService';
import { saveCurrencyPreference } from '../components/LocaleMenu';
import { publishProfile, clearProfileCache } from './profileEvents';

// Load account defaults on sign-in, including sign-in from the public homepage.
// A later navbar choice remains a temporary override until the next sign-in/reload.
export function AccountPreferencesSync() {
  const {session}=useAuth();
  const {setLanguage}=useLanguage();
  useEffect(()=>{
    let active=true;
    if(session?.user?.id)void customerService.me().then(profile=>{
      if(!active)return;
      if(profile.preferredLanguage==='en'||profile.preferredLanguage==='bn')setLanguage(profile.preferredLanguage);
      if(profile.preferredCurrency)saveCurrencyPreference(profile.preferredCurrency);
      publishProfile(session.user.id,profile);
    },()=>undefined);
    else clearProfileCache();
    return()=>{active=false;};
  },[session?.user?.id]);
  return null;
}
