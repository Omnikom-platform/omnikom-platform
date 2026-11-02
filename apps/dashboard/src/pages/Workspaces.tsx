import { useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useSession } from '../auth';
import { useMemberships, useStaffAal } from '../data';
import { SignOutButton } from './SignOutButton';
import { UNREACHABLE } from '../lib/problems';
import { t } from '../plan';
import css from './Login.module.css';

/**
 * After sign in: one business = straight in (DP-1.2-07); two or more = one row per business with name, role, Open; none = DP-1.2-12;
 * a staff login without the second factor = DP-1.2-11.
 */
export function Workspaces() {
  const { session } = useSession();
  const nav = useNavigate();
  const userId = session?.user.id;
  const mem = useMemberships(userId);
  const aal = useStaffAal(userId);
  const list = mem.data ?? [];
  const needsSecondFactor = Boolean(aal.data?.isStaff && aal.data.level !== 'aal2');

  useEffect(() => { document.title = t('DP-1.2s-09', 'Choose a business'); }, []);
  useEffect(() => {
    const only = list[0];
    if (!needsSecondFactor && list.length === 1 && only) void nav({ to: '/w/$ws/leads', params: { ws: only.workspace.slug }, replace: true });
  }, [list, needsSecondFactor, nav]);

  if (mem.error || aal.error) return <main className={css.page}><p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p><SignOutButton /></main>;
  if (mem.isLoading || aal.isLoading) return <main className={css.page}><p data-plan="DP-1.2s-10">Loading</p></main>;

  if (needsSecondFactor) {
    return (
      <main className={css.page}>
        <p data-plan="DP-1.2-11">This login needs a second factor, which this dashboard does not ask for yet.</p>
        <SignOutButton />
      </main>
    );
  }
  if (list.length === 0) {
    return (
      <main className={css.page}>
        <p data-plan="DP-1.2-12">This login is not part of a business yet. Ask the business owner to invite you.</p>
        <SignOutButton />
      </main>
    );
  }
  if (list.length === 1) return <main className={css.page} />;

  return (
    <main className={css.page}>
      <div className={css.card} data-card="">
      <h1 data-plan="DP-1.2s-09">Choose a business</h1>
      <ul className={css.picker}>
        {list.map(m => (
          <li key={m.workspace.id} data-plan="DP-1.2-07">
            <span>{m.workspace.name}</span> <span>{m.role}</span>{' '}
            <Link to="/w/$ws/leads" params={{ ws: m.workspace.slug }} data-plan="DP-1.2-07" aria-label={`Open ${m.workspace.name}`}>Open</Link>
          </li>
        ))}
      </ul>
      <SignOutButton />
      </div>
    </main>
  );
}
