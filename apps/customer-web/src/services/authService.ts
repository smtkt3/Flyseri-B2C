import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { rememberAuthReturn } from '../auth/authRedirect';

export type SocialProvider = 'google' | 'facebook' | 'apple';
export class CustomerAuthError extends Error {
  constructor(message:string, public readonly reason?:'missing_callback'|'verification_unavailable') { super(message); }
}
function authFailure(error: {code?: string; status?: number} | null, fallback: string): CustomerAuthError {
  if (error?.status === 429) return new CustomerAuthError('Too many attempts. Please wait a few minutes and try again.');
  if (error?.code === 'email_not_confirmed') return new CustomerAuthError('Confirm your email before signing in. You can request another verification email below.');
  if (error?.code === 'weak_password') return new CustomerAuthError('Choose a stronger password that meets the account security requirements.');
  return new CustomerAuthError(fallback);
}

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Capture this before the Supabase client removes a successfully exchanged code.
const callbackLocation = new URL(window.location.href);
const callbackHash = new URLSearchParams(callbackLocation.hash.slice(1));
const emailTokenHash=callbackLocation.pathname==='/auth/callback'?callbackLocation.searchParams.get('token_hash'):null;
const emailTokenType=callbackLocation.searchParams.get('type');
const hasAuthCallback = callbackLocation.pathname === '/auth/callback' &&
  (callbackLocation.searchParams.has('code') || callbackHash.has('access_token') || Boolean(emailTokenHash));
if(emailTokenHash){
  // Keep the one-time credential only in memory, out of browser history and referrers.
  callbackLocation.searchParams.delete('token_hash');
  callbackLocation.searchParams.delete('type');
  window.history.replaceState(window.history.state,'',callbackLocation.pathname+callbackLocation.search+callbackLocation.hash);
}
let redirectCompletion:Promise<Session>|undefined;

export const authClient: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
}) : null;

function requiredClient(): SupabaseClient {
  if (!authClient) throw new Error('Sign-in is temporarily unavailable. Please try again later.');
  return authClient;
}

export const authService = {
  configured: Boolean(authClient),
  emailConfirmationPending:Boolean(emailTokenHash),
  async socialProviders(): Promise<SocialProvider[]> {
    if (!authClient) return [];
    const response = await fetch(`${url}/auth/v1/settings`, {headers:{apikey:key}, signal:AbortSignal.timeout(10_000)});
    if (!response.ok) throw new CustomerAuthError('Social sign-in is temporarily unavailable. You can still use email and password.');
    const settings = await response.json() as {external?:Record<string,unknown>};
    return (['google','facebook','apple'] as const).filter(provider=>settings.external?.[provider] === true);
  },
  async signInWithProvider(provider: SocialProvider, returnTo: string): Promise<void> {
    rememberAuthReturn(returnTo);
    const {data,error} = await requiredClient().auth.signInWithOAuth({provider, options:{redirectTo:`${window.location.origin}/auth/callback`, skipBrowserRedirect:true, ...(provider==='facebook'?{scopes:'email'}:{})}});
    if (error || !data.url) throw authFailure(error,'We could not open social sign-in. Please try again.');
    // Supabase generates and validates the provider authorization URL and PKCE verifier.
    window.location.assign(data.url);
  },
  completeRedirect(): Promise<Session> {
    if(!hasAuthCallback) return Promise.reject(new CustomerAuthError('Please sign in to continue to Flyseri.','missing_callback'));
    // Strict Mode and remounts must share the same completion, not repeat verification.
    return redirectCompletion ??= completeAuthRedirect();
  },
  async restore(): Promise<Session | null> {
    if (!authClient) return null;
    const { data, error } = await authClient.auth.getSession();
    if (error) throw new Error('We could not restore your session. Please try again.');
    return data.session;
  },
  onChange(callback: (session: Session | null, event: AuthChangeEvent) => void): () => void {
    if (!authClient) return () => undefined;
    const { data } = authClient.auth.onAuthStateChange((event, session) => callback(session, event));
    return () => data.subscription.unsubscribe();
  },
  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await requiredClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) throw authFailure(error,'Sign-in failed. Check your email and password, then try again.');
    return data.session;
  },
  async signUp(email: string, password: string, returnTo = '/app'): Promise<boolean> {
    rememberAuthReturn(returnTo);
    const { data, error } = await requiredClient().auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (error) throw authFailure(error,'We could not create your account. Please check your details and try again.');
    return Boolean(data.session);
  },
  async resendVerification(email: string): Promise<void> {
    const {error} = await requiredClient().auth.resend({type:'signup',email,options:{emailRedirectTo:`${window.location.origin}/auth/callback`}});
    if (error) throw authFailure(error,'We could not send the verification email. Please try again later.');
  },
  async signOut(): Promise<void> {
    const { error } = await requiredClient().auth.signOut();
    if (error) throw new Error('We could not sign you out. Please try again.');
  },
  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await requiredClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) throw authFailure(error,'We could not send the reset link. Please try again.');
  },
  async updatePassword(password: string): Promise<void> {
    const { error } = await requiredClient().auth.updateUser({ password });
    if (error) throw authFailure(error,'We could not update your password. Please try again.');
  },
  async updateProfilePhoto(documentId:string|null):Promise<void> {
    if(documentId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) throw new Error('Invalid photo reference.');
    const {error}=await requiredClient().auth.updateUser({data:{flyseri_photo_document_id:documentId}});
    if(error) throw new Error('We could not save your profile photo. Please try again.');
  },
  async accessToken(): Promise<string | null> {
    if (!authClient) return null;
    const { data, error } = await authClient.auth.getSession();
    if (error || !data.session) return null;
    if (data.session.expires_at && data.session.expires_at < Math.floor(Date.now() / 1000) + 30) {
      const refreshed = await authClient.auth.refreshSession();
      return refreshed.error ? null : refreshed.data.session?.access_token ?? null;
    }
    return data.session.access_token;
  },
  async refreshToken(): Promise<string | null> {
    if (!authClient) return null;
    const { data, error } = await authClient.auth.refreshSession();
    return error ? null : data.session?.access_token ?? null;
  },
};

async function completeAuthRedirect():Promise<Session> {
  const client=requiredClient();
  const initialized=await client.auth.initialize();
  if(emailTokenHash){
    if(!['email','signup'].includes(emailTokenType??'')||!/^[A-Za-z0-9_-]{20,256}$/.test(emailTokenHash))throw new CustomerAuthError('This email verification link is invalid. Request a new verification email.');
    const result=await client.auth.verifyOtp({token_hash:emailTokenHash,type:emailTokenType as 'email'|'signup'});
    if(result.error||!result.data.session)throw authFailure(result.error,'This email verification link has expired or already been used. Try signing in, or request a new verification email.');
  }
  if(initialized.error||new URL(window.location.href).searchParams.has('code')) throw new CustomerAuthError('This sign-in link has expired or was opened in a different browser. Please sign in again.');
  const {data,error}=await client.auth.getSession();
  if(error||!data.session)throw new CustomerAuthError('We could not finish signing you in. Please try again.');
  const verified=await client.auth.getUser(data.session.access_token);
  if(verified.error?.status===0||(verified.error?.status??0)>=500||verified.error?.name==='AuthRetryableFetchError')throw new CustomerAuthError('We could not reach the sign-in service to verify your session. Check your connection and try signing in again.','verification_unavailable');
  if(verified.error||!verified.data.user||verified.data.user.id!==data.session.user.id)throw new CustomerAuthError('Your sign-in session is no longer valid. Please sign in again.');
  return data.session;
}
