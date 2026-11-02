import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useSession } from '../auth';
import { useMemberships, useWorkspace } from '../data';
import { WorkspaceContext } from '../workspace-context';
import { UNREACHABLE } from '../lib/problems';
import { NotFound } from './NotFound';
import { JobWatcher } from './JobWatcher';
import { SignOutButton } from './SignOutButton';
import s from './Shell.module.css';

/**
 * The shell (DP-1.2s-01 to -03, -06, -07): the business name, Leads, Site, a switcher when there is more than one business, Sign out.
 * A workspace in the address that this login cannot read shows "Not found" and renders nothing below it, so no page under it asks for
 * data: the database decides (Row-Level Security), the screen only reports. Settings is not shown: its screen is slice 5.6.
 */
export function Shell() {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const { session } = useSession();
  const userId = session?.user.id;
  const nav = useNavigate();
  const q = useWorkspace(ws, userId);
  const mem = useMemberships(userId);
  const workspace = q.data;

  if (q.isLoading) return <main className={s.bare}><p data-plan="DP-1.2s-10">Loading</p></main>;
  if (q.error) return <main className={s.bare}><p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p></main>;
  if (!workspace || !userId) return <main className={s.bare}><NotFound /></main>;

  const others = mem.data ?? [];
  return (
    <WorkspaceContext.Provider value={{ workspace, userId }}>
      <header className={s.rail}>
        <nav className={s.nav}>
          <p data-plan="DP-1.2s-01"><strong>{workspace.name}</strong></p>
          {others.length > 1 && (
            <select data-plan="DP-1.2s-02" aria-label="Workspace switcher" value={workspace.slug} onChange={e => void nav({ to: '/w/$ws/leads', params: { ws: e.target.value } })}>
              {others.map(m => <option key={m.workspace.id} value={m.workspace.slug}>{m.workspace.name}</option>)}
            </select>
          )}
          <div className={s.tabs}>
            <Link to="/w/$ws/leads" params={{ ws }} data-plan="DP-1.2s-03" activeProps={{ 'aria-current': 'page' }} className={s.tab}>Leads</Link>
            <Link to="/w/$ws/site" params={{ ws }} data-plan="DP-1.2s-04" activeProps={{ 'aria-current': 'page' }} className={s.tab}>Site</Link>
          </div>
          <SignOutButton />
        </nav>
      </header>
      <main className={s.main}>
        <Outlet />
      </main>
      <JobWatcher />
    </WorkspaceContext.Provider>
  );
}
