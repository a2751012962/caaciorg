import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearCooldowns } from './shared';

// One row of public.members, readable by its owner (members_self_read RLS).
// The browser cannot write it (migration 0014): changes go through /api/*.
export interface MemberRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  tier_id: string | null;
  status: 'pending' | 'active' | 'expired' | 'cancelled' | 'past_due' | null;
  member_since: string | null;
  expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  is_admin: boolean | null;
  household_id: string | null;
  created_at: string | null;
}

interface AuthState {
  /** false until the stored session has been read once */
  ready: boolean;
  session: Session | null;
  user: User | null;
  member: MemberRow | null;
  refreshMember: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<MemberRow | null>(null);

  const loadMember = useCallback(async (uid: string | undefined) => {
    if (!uid) return setMember(null);
    const { data } = await supabase.from('members').select('*').eq('id', uid).maybeSingle();
    setMember((data as MemberRow | null) ?? null);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadMember(data.session?.user.id);
      if (alive) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Don't await Supabase calls inside the callback (it holds the auth lock).
      setTimeout(() => void loadMember(next?.user.id), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMember]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      member,
      refreshMember: () => loadMember(session?.user.id),
      signOut: async () => {
        // The resend countdowns are keyed per recipient and nothing else sweeps
        // them, so on a shared machine they would outlive the session.
        clearCooldowns();
        await supabase.auth.signOut();
        setSession(null);
        setMember(null);
      },
    }),
    [ready, session, member, loadMember],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside <AuthProvider>');
  return ctx;
}

// The sign-in page stays the Tabler /login-3/. It sends a signed-in visitor on
// to ?next= (same-origin paths only), so every "Log in" returns here.
export function loginUrl(next: string = location.pathname + location.search, signup = false) {
  return `/login-3/?${signup ? 'signup=1&' : ''}next=${encodeURIComponent(next)}`;
}
