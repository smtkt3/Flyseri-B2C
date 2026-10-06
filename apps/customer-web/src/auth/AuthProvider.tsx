import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Navigate, useLocation } from 'react-router-dom';
import { authService } from '../services/authService';

interface AuthState { session: Session | null; resolving: boolean; error: string | null; acceptSession: (session: Session) => void }
type AuthSnapshot = Omit<AuthState, 'acceptSession'>;
const AuthContext = createContext<AuthState>({ session: null, resolving: true, error: null, acceptSession: () => undefined });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthSnapshot>({ session: null, resolving: true, error: null });
  const authEventVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const restoreVersion = authEventVersion.current;
    const unsubscribe = authService.onChange((session, event) => {
      if (event === 'INITIAL_SESSION' && authEventVersion.current !== restoreVersion) return;
      authEventVersion.current += 1;
      if (active) setState((current) => ({ ...current, session, resolving: false, error: null }));
    });
    void authService.restore().then(
      (session) => {
        if (active && authEventVersion.current === restoreVersion) setState((current) => ({ ...current, session, resolving: false, error: null }));
      },
      () => {
        if (active && authEventVersion.current === restoreVersion) setState((current) => ({ ...current, session: null, resolving: false, error: 'We could not restore your session. Please try again.' }));
      },
    );
    return () => { active = false; unsubscribe(); };
  }, []);
  const acceptSession = (session: Session) => {
    authEventVersion.current += 1;
    setState({ session, resolving: false, error: null });
  };
  return <AuthContext.Provider value={{ ...state, acceptSession }}>{children}</AuthContext.Provider>;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, resolving, error } = useAuth();
  const location = useLocation();
  if (resolving) return <div role="status" className="account-center">Checking your session…</div>;
  if (error) return <div role="alert" className="account-center">{error}</div>;
  if (!session) return <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <>{children}</>;
}
