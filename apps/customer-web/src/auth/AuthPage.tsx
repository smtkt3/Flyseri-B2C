import { Translated } from '../travel/language';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { authService, CustomerAuthError, type SocialProvider } from '../services/authService';
import { safeAuthReturn } from './authRedirect';
import './auth-polish.css';
import { BrandMark } from '../components/BrandMark';

type Mode = 'sign-in' | 'create-account' | 'forgot-password' | 'reset-password';
const labels: Record<Mode, { title: string; description: string; action: string }> = {
  'sign-in': { title: 'Welcome back.', description: 'Sign in to keep your travellers and travel details together.', action: 'Sign in' },
  'create-account': { title: 'Your journey starts here.', description: 'Create a Flyseri account to manage your traveller profiles.', action: 'Create account' },
  'forgot-password': { title: 'Reset your password.', description: 'We’ll send a reset link to your email address.', action: 'Send reset link' },
  'reset-password': { title: 'Choose a new password.', description: 'Set a new password for your Flyseri account.', action: 'Update password' },
};

function friendlyAuthError(cause: unknown, mode: Mode): string {
  if(cause instanceof CustomerAuthError)return cause.message;
  const message = cause instanceof Error ? cause.message.toLowerCase() : '';
  if (message.includes('invalid login credentials')) return 'That email and password do not match. Please try again.';
  if (message.includes('email not confirmed')) return 'Please confirm your email, then sign in.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (mode === 'reset-password' && message.includes('reset link')) return 'This reset link is invalid or has expired. Request a new one.';
  return mode === 'sign-in' ? "We couldn't sign you in. Please try again." : "We couldn't complete this request. Please try again.";
}

export function AuthPage({ mode, modal = false, backgroundPath = '/', backgroundState }: { mode: Mode; modal?: boolean; backgroundPath?: string; backgroundState?: unknown }) {
  const navigate = useNavigate();
  const location = useLocation();
  const candidate = (location.state as { from?: unknown } | null)?.from;
  const returnTo = safeAuthReturn(candidate,safeAuthReturn(modal?backgroundPath:'/app'));
  const returnState = modal && returnTo === backgroundPath ? backgroundState : undefined;
  const { session, acceptSession, recovery, resolving } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  const [confirmation,setConfirmation] = useState('');
  const [providers,setProviders] = useState<SocialProvider[]>([]);
  const [providerError,setProviderError] = useState('');
  const [providerLoading,setProviderLoading] = useState(true);
  const [resendAt,setResendAt] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const socialMode=mode==='sign-in'||mode==='create-account';
  useEffect(()=>{
    if(!resendAt)return;
    const timeout=window.setTimeout(()=>setResendAt(0),Math.max(0,resendAt-Date.now()));
    return()=>window.clearTimeout(timeout);
  },[resendAt]);

  useEffect(()=>{
    setError('');setNotice('');setPassword('');setConfirmation('');setShowPassword(false);
  },[mode]);
  useEffect(()=>{
    let active=true;
    if(!socialMode){setProviderLoading(false);return;}
    setProviderLoading(true);
    void authService.socialProviders().then(value=>{if(active)setProviders(value);},()=>{if(active)setProviderError('Social sign-in is temporarily unavailable. Please use email.');}).finally(()=>{if(active)setProviderLoading(false);});
    return()=>{active=false;};
  },[socialMode]);

  useEffect(() => {
    if (!modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(backgroundPath, { replace: true, state: backgroundState });
      if(event.key==='Tab'){
        const elements=Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),[tabindex="0"]')??[]).filter(element=>element.getClientRects().length>0);
        const first=elements[0],last=elements.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onEscape); previouslyFocused?.focus(); };
  }, [modal, backgroundPath, backgroundState, navigate]);

  if (session && mode !== 'reset-password') return <Navigate to={returnTo} replace state={returnState} />;
  const details = labels[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy)return;
    if((mode==='create-account'||mode==='reset-password')&&password!==confirmation){setError('Your passwords do not match.');return;}
    setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'sign-in') {
        const signedInSession = await authService.signIn(email.trim(), password);
        acceptSession(signedInSession);
        navigate(returnTo, { replace: true, state: returnState });
      } else if (mode === 'create-account') {
        const signedIn = await authService.signUp(email.trim(), password, returnTo);
        if (signedIn) navigate(returnTo, { replace: true, state: returnState });
        else setNotice('Check your email to verify your account, then continue to Flyseri.');
      } else if (mode === 'forgot-password') {
        await authService.sendPasswordReset(email.trim());
        setNotice('If this email has an account, a reset link is on its way.');
      } else {
        if (!session||!recovery) throw new CustomerAuthError('This reset link is invalid or has expired. Request a new one.');
        await authService.updatePassword(password);
        setNotice('Your password has been updated.');
        navigate('/app', { replace: true });
      }
    } catch (cause) { setError(friendlyAuthError(cause, mode)); }
    finally { setBusy(false); }
  }

  async function socialSignIn(provider:SocialProvider){
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{await authService.signInWithProvider(provider,returnTo);}
    catch(cause){setError(friendlyAuthError(cause,mode));setBusy(false);}
  }
  async function resend(){
    if(busy||Date.now()<resendAt)return;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Enter your email address above first.');return;}
    setBusy(true);setError('');setNotice('');
    try{await authService.resendVerification(email.trim());setResendAt(Date.now()+60_000);setNotice('If your account needs verification, a new email is on its way. Please check your spam folder too.');}
    catch(cause){setError(friendlyAuthError(cause,mode));}
    finally{setBusy(false);}
  }

  const content = <>
    <Link to="/" className="account-logo"><BrandMark /></Link>
    <div className="account-auth-card">
      {modal && <button type="button" className="account-auth-close" aria-label="Close sign in" onClick={() => navigate(backgroundPath, { replace: true, state: backgroundState })}>×</button>}
      <p className="account-eyebrow">SERI · YOUR TRAVEL COMPANION</p>
      <h1>{details.title}</h1>
      <p className="account-muted">{details.description}</p>
      {!authService.configured && <p role="alert" className="account-error">Sign-in is temporarily unavailable. Please try again later.</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
      {notice && <p role="status" className="account-notice">{notice}</p>}
      {socialMode&&<>
        {providers.length>0&&<div className="auth-social" aria-label="Social sign in">{providers.map(provider=><button key={provider} type="button" disabled={busy} onClick={()=>void socialSignIn(provider)}><ProviderMark provider={provider}/>Continue with {provider==='google'?'Google':provider==='facebook'?'Facebook':'Apple'}</button>)}</div>}
        {providerLoading&&<p className="auth-provider-status" role="status">Loading sign-in options…</p>}
        {providerError&&<p className="auth-provider-status" role="status">{providerError}</p>}
        {providers.length>0&&<div className="auth-divider"><span>or use email</span></div>}
      </>}
      <form onSubmit={(event) => { void submit(event); }} className="account-form">
        {mode !== 'reset-password' && <label>Email address<input type="email" required autoFocus={modal} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {mode !== 'forgot-password' && <label>{mode === 'reset-password' ? 'New password' : 'Password'}<span className="auth-password"><input type={showPassword?'text':'password'} required minLength={mode==='sign-in'?undefined:8} maxLength={128} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode==='sign-in'?'Enter your password':'At least 8 characters'} /><button type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Hide':'Show'}</button></span>{mode!=='sign-in'&&<small className="auth-field-hint">Use at least 8 characters. A long, unique password is best.</small>}</label>}
        {(mode==='create-account'||mode==='reset-password')&&<label>Confirm password<input type={showPassword?'text':'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} placeholder="Re-enter your password"/></label>}
        <button type="submit" className="btn-primary account-submit" disabled={busy || !authService.configured || (mode==='reset-password'&&(resolving||!recovery))}>{busy ? 'Please wait…' : details.action}</button>
      </form>
      {mode==='reset-password'&&!resolving&&!recovery&&<p role="alert" className="account-error">Open the latest password-reset link from your email in the same browser where you requested it. <Link to="/forgot-password">Request a new link</Link></p>}
      <div className="account-auth-links">
        {mode === 'sign-in' && <><Link to="/forgot-password" state={{from:returnTo}}>Forgot password?</Link><span>New to Flyseri? <Link to="/create-account" state={{ from: returnTo }}>Create account</Link></span></>}
        {mode === 'create-account' && <span>Already have an account? <Link to="/sign-in" state={{ from: returnTo }}><Translated text="Sign in" /></Link></span>}
        {(mode === 'forgot-password' || mode === 'reset-password') && <Link to="/sign-in">Back to sign in</Link>}
      </div>
      {socialMode&&<button type="button" className="auth-resend" disabled={busy||!authService.configured||resendAt>0} onClick={()=>void resend()}>{resendAt>0?'Verification email requested · try again in a minute':'Resend verification email'}</button>}
    </div>
    <p className="account-auth-foot">Your trips, travellers and travel details stay together in My Flyseri.</p>
  </>;

  if (modal) return <div className="account-auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) navigate(backgroundPath, { replace: true, state: backgroundState }); }}>
    <section ref={dialog} className="account-auth-dialog" role="dialog" aria-modal="true" aria-label={details.title}>{content}</section>
  </div>;
  return <main className="account-auth-page">{content}</main>;
}

function ProviderMark({provider}:{provider:SocialProvider}) {
  if(provider==='google')return <svg aria-hidden="true" viewBox="0 0 24 24" className="auth-provider-mark"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.51l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"/></svg>;
  if(provider==='facebook')return <svg aria-hidden="true" viewBox="0 0 24 24" className="auth-provider-mark"><path fill="#0866FF" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.4c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.68.23 2.68.23V7.9h-1.51c-1.49 0-1.96.93-1.96 1.89v2.28h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="auth-provider-mark" fill="currentColor"><path d="M17.05 12.54c.03 3.25 2.85 4.33 2.88 4.34-.02.08-.45 1.54-1.48 3.05-.89 1.3-1.82 2.59-3.28 2.62-1.44.04-1.91-.84-3.56-.84-1.65 0-2.17.81-3.54.88-1.41.05-2.49-1.41-3.39-2.7-1.83-2.65-3.23-7.49-1.35-10.76A5.26 5.26 0 0 1 7.78 6.4c1.39-.03 2.7.94 3.55.94.85 0 2.45-1.16 4.13-.99.7.03 2.65.28 3.9 2.11-.1.06-2.33 1.35-2.31 4.08ZM14.37 4.55c.75-.91 1.26-2.17 1.12-3.43-1.08.04-2.39.72-3.16 1.63-.69.79-1.29 2.07-1.13 3.29 1.21.1 2.44-.62 3.17-1.49Z"/></svg>;
}
