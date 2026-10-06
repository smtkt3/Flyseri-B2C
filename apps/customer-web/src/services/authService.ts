import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authClient: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
}) : null;

function requiredClient(): SupabaseClient {
  if (!authClient) throw new Error('Customer sign-in is being configured. Please try again later.');
  return authClient;
}

export const authService = {
  configured: Boolean(authClient),
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
    if (error || !data.session) throw new Error('Sign-in failed. Check your email and password, then try again.');
    return data.session;
  },
  async signUp(email: string, password: string): Promise<boolean> {
    const { data, error } = await requiredClient().auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/app` } });
    if (error) throw new Error('We could not create your account. Please check your details and try again.');
    return Boolean(data.session);
  },
  async signOut(): Promise<void> {
    const { error } = await requiredClient().auth.signOut();
    if (error) throw new Error('We could not sign you out. Please try again.');
  },
  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await requiredClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) throw new Error('We could not send the reset link. Please try again.');
  },
  async updatePassword(password: string): Promise<void> {
    const { error } = await requiredClient().auth.updateUser({ password });
    if (error) throw new Error('We could not update your password. Please try again.');
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
