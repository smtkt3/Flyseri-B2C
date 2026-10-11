import { useEffect, useRef, useState } from 'react';
import './locale-menu.css';
import { useLanguage } from '../travel/language';

const codes = ['USD','AED','AUD','AZN','BDT','BHD','BRL','BYN','CAD','CHF','CLP','CNY','COP','DKK','EGP','EUR','GBP','HKD','IDR','ILS','INR','ISK','JPY','KRW','KWD','LKR','MAD','MXN','MYR','NOK','NZD','OMR','PHP','PKR','PLN','QAR','RON','RUB','SAR','SEK','SGD','THB','TRY','TWD','UAH','VND','ZAR'];
const names = new Intl.DisplayNames(['en'], { type: 'currency' });
const labels: Record<string,string> = { USD:'United States Dollar ($)', AUD:'Australian Dollar (AU$)', EUR:'Euro (€)', GBP:'British Pound (£)', HKD:'Hong Kong Dollar (HK$)', MYR:'Malaysian Ringgit (RM)' };
export function preferredCurrency(): string {
  try { const value = localStorage.getItem('flyseri.currency'); return value && codes.includes(value) ? value : 'BDT'; } catch { return 'BDT'; }
}
export const currencyPreferenceEvent = 'flyseri:currency';

export function LocaleMenu() {
  const { language, setLanguage } = useLanguage();
  const [currency, setCurrency] = useState(preferredCurrency);
  const [tab, setTab] = useState<'language'|'currency'>('currency');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<string>).detail; setCurrency(typeof value === 'string' && codes.includes(value) ? value : preferredCurrency()); };
    window.addEventListener('storage', update); window.addEventListener(currencyPreferenceEvent, update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener(currencyPreferenceEvent, update); };
  }, []);
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  function select(code: string) {
    setCurrency(code);
    try { localStorage.setItem('flyseri.currency', code); } catch { /* Preference still applies for this page. */ }
    window.dispatchEvent(new CustomEvent(currencyPreferenceEvent, { detail: code })); close();
  }
  const choice = (code: string) => <button type="button" key={code} className={currency === code ? 'is-selected' : ''} aria-pressed={currency === code} onClick={() => select(code)} title={`${code} - ${labels[code] ?? names.of(code) ?? code}`}><strong>{code}</strong> - {labels[code] ?? names.of(code) ?? code}</button>;
  return <><button type="button" ref={trigger} className="navbar-locale-trigger" aria-label={`Language and currency, ${currency}`} aria-haspopup="dialog" onClick={() => {setTab('currency'); dialog.current?.showModal();}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg><span>{currency}</span></button>
    <dialog className="locale-dialog" ref={dialog} aria-label="Language and currency preferences" onClick={event => {if (event.target === event.currentTarget) close();}} onCancel={() => trigger.current?.focus()}>
      <div className="locale-dialog-heading"><div role="tablist" aria-label="Preferences">{([['language','Languages'],['currency','Currency']] as const).map(([value,label]) => <button key={value} type="button" id={`locale-${value}-tab`} role="tab" aria-selected={tab === value} aria-controls={`locale-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {event.preventDefault(); const next = event.key === 'Home' ? 'language' : event.key === 'End' ? 'currency' : tab === 'currency' ? 'language' : 'currency'; setTab(next); document.getElementById(`locale-${next}-tab`)?.focus();}}}>{label}</button>)}</div><button className="locale-close" type="button" aria-label="Close language and currency menu" onClick={close}>×</button></div>
      {tab === 'currency' ? <div id="locale-currency-panel" role="tabpanel" aria-labelledby="locale-currency-tab" className="locale-dialog-body"><h3>Top currencies</h3><div className="locale-choice-grid">{['BDT','USD','INR','EUR','SGD','MYR'].map(choice)}</div><h3>All currencies</h3><div className="locale-choice-grid">{codes.map(choice)}</div></div> : <div id="locale-language-panel" role="tabpanel" aria-labelledby="locale-language-tab" className="locale-dialog-body"><h3>Languages</h3><div className="locale-choice-grid"><button type="button" className={language === 'en' ? 'is-selected' : ''} aria-pressed={language === 'en'} onClick={() => { setLanguage('en'); close(); }}><strong>English</strong> - English</button><button type="button" className={language === 'bn' ? 'is-selected' : ''} aria-pressed={language === 'bn'} onClick={() => { setLanguage('bn'); close(); }}><strong>বাংলা</strong> - Bengali</button></div></div>}
    </dialog></>;
}
