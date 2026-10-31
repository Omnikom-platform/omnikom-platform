import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type SessionState = { session: Session | null; loading: boolean };
const Ctx = createContext<SessionState>({ session: null, loading: true });

/** The login of this browser, kept current (sign in, sign out, token refresh). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => { if (live) setState({ session: data.session, loading: false }); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { if (live) setState({ session, loading: false }); });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** The path to go on to after sign in: only a path inside this app ("/w/..."), never another address. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/w(\/[A-Za-z0-9._~-]+)*\/?$/.test(next) ? next : '/w';
}
