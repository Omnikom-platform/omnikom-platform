import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { inviteMember, removeMember } from '../api';
import { useTeam, useTeamList } from '../data';
import { CallFailed, UNREACHABLE } from '../lib/problems';
import { canRemove, memberName, onlyYou, validEmail, type Member } from '../lib/settings';
import { t } from '../plan';
import css from './Settings.module.css';
import { Sheet } from './Sheet';

const LAST_OWNER = t('DP-1.6-13', 'A business needs at least one owner. Add another owner first.');
const GONE = t('DP-1.6-13', 'That person is no longer a member.');

const joinedOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * The People card (DP-1.6-01 to -03, -11 to -15): the members (owners first), Invite (which sends the mail) and Remove behind the confirm sheet.
 * Owner only: the screen does not render it for a member, and team-list refuses anyone else.
 */
export function SettingsPeople({ workspace, business, me }: { workspace: string; business: string; me: string }) {
  const list = useTeamList(workspace, true);
  const profiles = useTeam(workspace);
  const qc = useQueryClient();
  const roleId = useId(), teamId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [teamRow, setTeamRow] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const reload = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['team-list', workspace] }), qc.invalidateQueries({ queryKey: ['team', workspace] })]); };

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setResult(''); setError('');
    const address = email.trim().toLowerCase();
    if (!validEmail(address)) { setError(t('DP-1.6-15', 'Enter a full email address.')); return; }
    setBusy(true);
    try {
      const out = await inviteMember(workspace, address, role, teamRow);
      setResult(out.emailSent ? t('DP-1.6-14', `Invite sent to ${address}.`) : t('DP-1.6-14', `${address} is a member now, but the email could not be sent. Ask them to sign in at the login page.`));
      setEmail(''); setTeamRow('');
      await reload();
    } catch (err) {
      setError(err instanceof CallFailed && err.problem.plain ? err.problem.message : UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!asking || removing) return;
    setRemoving(true); setRemoveError('');
    try {
      await removeMember(workspace, asking.user);
      setAsking(null);
      await reload();
    } catch (err) {
      if (err instanceof CallFailed && err.problem.code === 'S-LAST-OWNER') setRemoveError(LAST_OWNER);
      else if (err instanceof CallFailed && err.problem.status === 404) { setRemoveError(GONE); await reload(); }
      else setRemoveError(UNREACHABLE);
    } finally {
      setRemoving(false);
    }
  }

  const members = list.data ?? [];
  return (
    <section aria-labelledby="people-title" className={css.card}>
      <h2 id="people-title" data-plan="DP-1.6-01">People</h2>
      {list.isLoading && <p data-plan="DP-1.2s-10">Loading</p>}
      {list.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {list.data && (
        <ul className={css.people} data-plan="DP-1.6-01">
          {members.map(m => (
            <li key={m.user}>
              <strong>{memberName(m)}</strong>
              <span>{m.email}</span>
              <span>{m.role === 'owner' ? 'Owner' : 'Member'}</span>
              <time dateTime={m.joined}>{joinedOn(m.joined)}</time>
              {canRemove(m, me) && <button type="button" data-plan="DP-1.6-03" onClick={() => { setRemoveError(''); setAsking(m); }}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {list.data && onlyYou(members, me) && <p data-plan="DP-1.6-11">Only you so far. Invite someone to share this business.</p>}
      <form onSubmit={e => void invite(e)} className={css.form} data-plan="DP-1.6-02" noValidate>
        <label>
          Email
          <input type="email" name="invite-email" autoComplete="off" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <div className={css.field}>
          <label htmlFor={roleId}>Role</label>
          <select id={roleId} name="invite-role" value={role} onChange={e => setRole(e.target.value === 'owner' ? 'owner' : 'member')}>
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div className={css.field}>
          <label htmlFor={teamId}>Team profile</label>
          <select id={teamId} name="invite-team" value={teamRow} onChange={e => setTeamRow(e.target.value)}>
            <option value="">Optional</option>
            {[...(profiles.data?.names ?? new Map<string, string>()).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy} className={css.save}>{busy ? t('DP-1.2s-10', 'Sending') : 'Send invite'}</button>
        {error && <p role="alert" data-plan="DP-1.6-15">{error}</p>}
        {result && <p role="status" data-plan="DP-1.6-14">{result}</p>}
      </form>
      {asking && (
        <Sheet onClose={() => setAsking(null)} data-plan="DP-1.6-12" aria-labelledby="remove-title" className={css.sheet}>
          <h2 id="remove-title">Remove {memberName(asking)} from {business}? They lose access to this business now. Their leads and edits stay.</h2>
          {removeError && <p role="alert" data-plan="DP-1.6-13">{removeError}</p>}
          <button type="button" onClick={() => setAsking(null)}>Cancel</button>
          <button type="button" disabled={removing} onClick={() => void remove()} className={css.go}>{removing ? t('DP-1.2s-10', 'Removing') : 'Remove'}</button>
        </Sheet>
      )}
    </section>
  );
}
