import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bulkLeads } from '../api';
import { CallFailed } from '../lib/problems';
import { STATUSES, statusLabel } from '../lib/leads';
import { t } from '../plan';
import { useToast } from '../toast';
import { DeleteSheet } from './DeleteSheet';
import css from './Crm.module.css';

const STATUS_FAILED = t('DP-1.3-32', 'Could not save. Nothing was changed. Try again.');
const OWNER_FAILED = t('DP-1.3-33', 'Could not save. Nothing was changed. Try again.');

/**
 * The bar over the list while one or more leads are selected (DP-1.3-31 to -34): Set status, Set owner and Delete (the last two only for an
 * owner, so an agent never sees them). The call is leads-bulk, all or nothing; there is no Undo for many. Delete opens the confirm sheet.
 */
export function BulkBar({ workspaceId, ids, canOwn, team, onClear }: { workspaceId: string; ids: string[]; canOwn: boolean; team: ReadonlyMap<string, string>; onClear: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function run(action: 'status' | 'owner', value: string | null, said: (n: number) => string, failed: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const n = await bulkLeads({ workspace: workspaceId, ids, action, value });
      void qc.invalidateQueries({ queryKey: ['leadlist', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['leadcounts', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['leads', workspaceId] });
      toast(said(n));
      onClear();
    } catch (e) {
      setError(e instanceof CallFailed && e.problem.plain ? e.problem.message : failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-plan="DP-1.3-31" className={css.bar}>
      <p>{ids.length} {t('DP-1.3-31', 'selected')} <button type="button" onClick={onClear}>{t('DP-1.3-31', 'Clear selection')}</button></p>
      <select data-plan="DP-1.3-32" aria-label="Set status" value="" disabled={busy}
        onChange={e => { const s = e.target.value; if (s) void run('status', s, n => `${n} ${t('DP-1.3-32', 'leads marked')} ${statusLabel(s)}.`, STATUS_FAILED); }}>
        <option value="">{t('DP-1.3-32', 'Set status')}</option>
        {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </select>
      {canOwn && (
        <select data-plan="DP-1.3-33" aria-label="Set owner" value="" disabled={busy}
          onChange={e => {
            const v = e.target.value;
            if (!v) return;
            const to = v === 'none' ? null : v;
            void run('owner', to, n => (to ? `${n} ${t('DP-1.3-33', 'leads given to')} ${team.get(to) ?? ''}.` : `${n} ${t('DP-1.3-33', 'leads unassigned.')}`), OWNER_FAILED);
          }}>
          <option value="">{t('DP-1.3-33', 'Set owner')}</option>
          <option value="none">{t('DP-1.3-33', 'Unassigned')}</option>
          {[...team.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}
      {canOwn && <button type="button" data-plan="DP-1.3-34" onClick={() => setDeleting(true)}>{t('DP-1.3-34', 'Delete')}</button>}
      {error && <p role="alert" data-plan="DP-1.3-32">{error}</p>}
      {deleting && <DeleteSheet workspaceId={workspaceId} ids={ids} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); onClear(); }} />}
    </div>
  );
}
