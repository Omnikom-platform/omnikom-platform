import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { safeNext } from '../auth';

const TYPES: EmailOtpType[] = ['magiclink', 'email', 'recovery', 'invite', 'signup', 'email_change'];

/**
 * /auth/confirm?token_hash=...&type=magiclink (DP-1.2-06): trades the token hash for a session (verifyOtp) and lands on Leads;
 * an expired or used link goes back to the sign-in card with the plan's sentence. Nothing is shown while it works (the plan has no wording for that).
 */
export function AuthConfirm({ tokenHash, type, next }: { tokenHash: string; type: string; next: string }) {
  const router = useRouter();
  const started = useRef(false);   // a token works once: never ask twice

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const expired = () => router.navigate({ to: '/login', search: { expired: true }, replace: true });
    const kind = TYPES.find(x => x === type);
    if (!tokenHash || !kind) { void expired(); return; }
    void (async () => {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: kind });
      if (error) { void expired(); return; }
      router.history.replace(safeNext(next));
    })();
  }, [tokenHash, type, next, router]);

  return <main />;
}
