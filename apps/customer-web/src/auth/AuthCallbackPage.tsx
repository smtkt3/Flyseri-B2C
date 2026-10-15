import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService, CustomerAuthError } from '../services/authService';
import { useAuth } from './AuthProvider';
import { consumeAuthReturn } from './authRedirect';
import { PageLoading } from '../components/PageLoading';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const {acceptSession} = useAuth();
  const [error,setError] = useState('');
  const [directVisit,setDirectVisit] = useState(false);
  const [confirmEmail,setConfirmEmail] = useState(false);
  useEffect(()=>{
    if(authService.emailConfirmationPending&&!confirmEmail)return;
    let active=true;
    const query=new URLSearchParams(window.location.search);
    const hash=new URLSearchParams(window.location.hash.slice(1));
    const denied=query.has('error')||hash.has('error');
    void (async()=>{
      try {
        if(denied) throw new CustomerAuthError('Sign-in was cancelled or could not be completed. Please try again.');
        const session=await authService.completeRedirect();
        if(!active)return;
        window.history.replaceState(window.history.state,'','/auth/callback');
        acceptSession(session);
        navigate(consumeAuthReturn(),{replace:true});
      } catch(cause) {
        if(!active)return;
        consumeAuthReturn();
        window.history.replaceState(window.history.state,'','/auth/callback');
        setError(cause instanceof CustomerAuthError?cause.message:'We could not complete sign-in. Please try again.');
        setDirectVisit(cause instanceof CustomerAuthError&&cause.reason==='missing_callback');
      }
    })();
    return()=>{active=false;};
    // Session acceptance happens once, after Supabase finishes its automatic PKCE exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[navigate,confirmEmail]);
  if(authService.emailConfirmationPending&&!confirmEmail)return <main className="account-auth-page"><section className="account-auth-card"><h1>Confirm your email</h1><p className="account-muted">Confirm your email address to finish creating your Flyseri account.</p><button type="button" className="btn-primary account-submit" onClick={()=>setConfirmEmail(true)}>Confirm email and continue</button></section></main>;
  if(!error)return <PageLoading label="Completing sign in…"/>;
  return <main className="account-auth-page"><section className="account-auth-card"><h1>{directVisit?'Start with sign in':'Let’s try again'}</h1><p role={directVisit?'status':'alert'} className={directVisit?'account-muted':'account-error'}>{error}</p><Link className="account-link" to="/sign-in" replace>{directVisit?'Go to sign in':'Back to sign in'}</Link></section></main>;
}
