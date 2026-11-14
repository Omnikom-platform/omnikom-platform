import { useCallback, useEffect, useState } from 'react';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth';
import { config } from '../config';
import { useMe, useSites, useTeam } from '../data';
import { UNREACHABLE } from '../lib/problems';
import { t } from '../plan';
import { supabase } from '../supabase';
import { useWorkspaceValue } from '../workspace-context';
import { SettingsAlerts } from './SettingsAlerts';
import { SettingsPeople } from './SettingsPeople';
import css from './Settings.module.css';
import { Sheet } from './Sheet';

/**
 * The Settings screen (DP-1.6-01 to -20; work order 08): one page of cards. The owner sees every card; a member sees only Your account and Sign out
 * everywhere (site settings and the team are hidden from members, docs/product/6-dashboard.md "Roles on screen"). Leaving with an unsaved change on the
 * Lead alerts card asks once, in a sheet of this page (never the browser's own question).
 */
export function Settings() {
  const { workspace, userId } = useWorkspaceValue();
  const me = useMe(workspace.id, userId);
  const [dirty, setDirty] = useState(false);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);
  const leave = useBlocker({ shouldBlockFn: () => dirty, withResolver: true, enableBeforeUnload: false });
  useEffect(() => { document.title = t('DP-1.2s-09', 'Settings'); }, []);

  if (me.isLoading) return <p data-plan="DP-1.2s-10">Loading</p>;
  const owner = me.data ? me.data.role !== 'member' : false;
  return (
    <div className={css.page}>
      <h1 data-plan="DP-1.2s-09">Settings</h1>
      <Account workspace={workspace.id} userId={userId} />
      {owner && <SettingsAlerts workspace={workspace.id} onDirty={onDirty} />}
      {owner && <SettingsPeople workspace={workspace.id} business={workspace.name} me={userId} />}
      {owner && <Websites workspace={workspace.id} />}
      <SignOutEverywhere />
      {leave.status === 'blocked' && (
        <Sheet onClose={() => leave.reset()} data-plan="DP-1.6-18" aria-labelledby="leave-title" className={css.sheet}>
          <h2 id="leave-title">Leave without saving? Your changes to the lead alerts are not saved.</h2>
          <button type="button" onClick={() => leave.reset()}>Stay</button>
          <button type="button" onClick={() => leave.proceed()} className={css.go}>Leave</button>
        </Sheet>
      )}
    </div>
  );
}

/** Your account (DP-1.6-08): the name from your team profile (the line is not shown when you have none) and the login's email. */
function Account({ workspace, userId }: { workspace: string; userId: string }) {
  const { session } = useSession();
  const team = useTeam(workspace);
  const name = team.data?.byUser.get(userId);
  return (
    <section aria-labelledby="account-title" className={css.card}>
      <h2 id="account-title" data-plan="DP-1.6-08">Your account</h2>
      <dl className={css.facts} data-plan="DP-1.6-08">
        {name && (<><dt>Name</dt><dd>{name}</dd></>)}
        <dt>Email</dt><dd>{session?.user.email}</dd>
      </dl>
    </section>
  );
}

/** Websites (DP-1.6-07, -19): each site's preview address, domain and state, as the Site screen reads them; no edit. */
function Websites({ workspace }: { workspace: string }) {
  const sites = useSites(workspace);
  const ask = config.askEmail ? <a href={`mailto:${config.askEmail}`} data-plan="DP-1.6-07">Ask Omnikom</a> : null;
  return (
    <section aria-labelledby="sites-title" className={css.card}>
      <h2 id="sites-title" data-plan="DP-1.6-07">Websites</h2>
      {sites.isLoading && <p data-plan="DP-1.2s-10">Loading</p>}
      {sites.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {sites.data && sites.data.length === 0 && <p data-plan="DP-1.6-19">No website yet. Ask Omnikom to set one up.{ask && <> {ask}</>}</p>}
      {sites.data && sites.data.length > 0 && (
        <>
          <ul className={css.sites} data-plan="DP-1.6-07">
            {sites.data.map(s => (
              <li key={s.id}>
                <dl className={css.facts}>
                  <dt>Preview address</dt><dd>{s.preview_host}</dd>
                  {s.domain && (<><dt>Domain</dt><dd>{s.domain}</dd></>)}
                  <dt>State</dt><dd>{s.state}</dd>
                </dl>
              </li>
            ))}
          </ul>
          {ask && <p>{ask}</p>}
        </>
      )}
    </section>
  );
}

/** Sign out everywhere (DP-1.6-09, -20): ends every session of this login, then the sign-in card with "You were signed out. Sign in again." */
function SignOutEverywhere() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setBusy(true); setFailed(false);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) { setFailed(true); setBusy(false); return; }
    qc.clear();
    void nav({ to: '/login', search: { ended: true }, replace: true });
  }
  return (
    <section aria-labelledby="signout-title" className={css.card}>
      <h2 id="signout-title" data-plan="DP-1.6-09">Sign out everywhere</h2>
      {failed && <p role="alert" data-plan="DP-1.6-20">Could not sign you out everywhere. Try again.</p>}
      <button type="button" data-plan="DP-1.6-09" disabled={busy} onClick={() => void signOut()}>Sign out everywhere</button>
    </section>
  );
}
