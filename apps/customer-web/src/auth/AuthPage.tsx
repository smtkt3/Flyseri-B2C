import { Translated } from '../travel/language';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { authService } from '../services/authService';
import { BrandMark } from '../components/BrandMark';

type Mode = 'sign-in' | 'create-account' | 'forgot-password' | 'reset-password';
const labels: Record<Mode, { title: string; description: string; action: string }> = {
  'sign-in': { title: 'Welcome back.', description: 'Sign in to keep your travellers and travel details together.', action: 'Sign in' },
  'create-account': { title: 'Your journey starts here.', description: 'Create a Flyseri account to manage your traveller profiles.', action: 'Create account' },
  'forgot-password': { title: 'Reset your password.', description: 'We’ll send a reset link to your email address.', action: 'Send reset link' },
  'reset-password': { title: 'Choose a new password.', description: 'Set a new password for your Flyseri account.', action: 'Update password' },
};

function friendlyAuthError(cause: unknown, mode: Mode): string {
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
  const returnTo = typeof candidate === 'string' && /^\/(?:app(?:\/|\?|$)|flights(?:\?|$)|flight-checkout(?:\?|$)|$)/.test(candidate) && !candidate.startsWith('//')
    ? candidate : modal ? backgroundPath : '/app';
  const returnState = modal && returnTo === backgroundPath ? backgroundState : undefined;
  const { session, acceptSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(backgroundPath, { replace: true, state: backgroundState });
    };
    document.addEventListener('keydown', onEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onEscape); };
  }, [modal, backgroundPath, backgroundState, navigate]);

  if (session && mode !== 'reset-password') return <Navigate to={returnTo} replace state={returnState} />;
  const details = labels[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'sign-in') {
        const signedInSession = await authService.signIn(email.trim(), password);
        acceptSession(signedInSession);
        navigate(returnTo, { replace: true, state: returnState });
      } else if (mode === 'create-account') {
        const signedIn = await authService.signUp(email.trim(), password);
        if (signedIn) navigate(returnTo, { replace: true, state: returnState });
        else setNotice('Check your email to verify your account, then sign in.');
      } else if (mode === 'forgot-password') {
        await authService.sendPasswordReset(email.trim());
        setNotice('If this email has an account, a reset link is on its way.');
      } else {
        if (!session) throw new Error('This reset link is invalid or has expired. Request a new one.');
        await authService.updatePassword(password);
        setNotice('Your password has been updated.');
        navigate('/app', { replace: true });
      }
    } catch (cause) { setError(friendlyAuthError(cause, mode)); }
    finally { setBusy(false); }
  }

  const content = <>
    <Link to="/" className="account-logo"><BrandMark /></Link>
    <div className="account-auth-card">
      {modal && <button type="button" className="account-auth-close" aria-label="Close sign in" onClick={() => navigate(backgroundPath, { replace: true, state: backgroundState })}>×</button>}
      <p className="account-eyebrow">SERI · YOUR TRAVEL COMPANION</p>
      <h1>{details.title}</h1>
      <p className="account-muted">{details.description}</p>
      {!authService.configured && <p role="alert" className="account-error">Customer sign-in is being configured. Please try again later.</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
      {notice && <p role="status" className="account-notice">{notice}</p>}
      <form onSubmit={(event) => { void submit(event); }} className="account-form">
        {mode !== 'reset-password' && <label>Email address<input type="email" required autoFocus={modal} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {mode !== 'forgot-password' && <label>{mode === 'reset-password' ? 'New password' : 'Password'}<input type="password" required minLength={8} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>}
        <button type="submit" className="btn-primary account-submit" disabled={busy || !authService.configured}>{busy ? 'Please wait…' : details.action}</button>
      </form>
      <div className="account-auth-links">
        {mode === 'sign-in' && <><Link to="/forgot-password">Forgot password?</Link><span>New to Flyseri? <Link to="/create-account" state={{ from: returnTo }}>Create account</Link></span></>}
        {mode === 'create-account' && <span>Already have an account? <Link to="/sign-in" state={{ from: returnTo }}><Translated text="Sign in" /></Link></span>}
        {(mode === 'forgot-password' || mode === 'reset-password') && <Link to="/sign-in">Back to sign in</Link>}
      </div>
    </div>
    <p className="account-auth-foot">Your trips, travellers and travel details stay together in My Flyseri.</p>
  </>;

  if (modal) return <div className="account-auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) navigate(backgroundPath, { replace: true, state: backgroundState }); }}>
    <section className="account-auth-dialog" role="dialog" aria-modal="true" aria-label={details.title}>{content}</section>
  </div>;
  return <main className="account-auth-page">{content}</main>;
}
