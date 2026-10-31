import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { markSignOutByPerson } from '../session-flag';

/** Sign out (DP-1.2-09): the session ends and the sign-in card shows. signOut clears this browser's session even when the server cannot be told. */
export function SignOutButton() {
  const nav = useNavigate();
  const qc = useQueryClient();
  async function signOut() {
    markSignOutByPerson();
    await supabase.auth.signOut();
    qc.clear();
    void nav({ to: '/login', replace: true });
  }
  return <button type="button" data-plan="DP-1.2-09" onClick={() => void signOut()}>Sign out</button>;
}
