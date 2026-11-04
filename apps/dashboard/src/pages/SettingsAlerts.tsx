import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveAlerts } from '../api';
import { useSiteAlerts } from '../data';
import { alertsChanged, alertsText, canSaveAlerts, parseAlerts } from '../lib/settings';
import { UNREACHABLE } from '../lib/problems';
import { t } from '../plan';
import { useToast } from '../toast';
import css from './Settings.module.css';

type Typed = { text: string; assignee: boolean };

/**
 * The Lead alerts card (DP-1.6-04, -10, -16, -17): for each site, the addresses one per line and "also email the assigned agent". One Save for
 * the card, on only when something changed and what is typed is valid; `onDirty` tells the screen, which asks once before leaving with a change.
 */
export function SettingsAlerts({ workspace, onDirty }: { workspace: string; onDirty: (dirty: boolean) => void }) {
  const sites = useSiteAlerts(workspace, true);
  const qc = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const list = sites.data ?? [];
  const valueOf = (id: string): Typed => typed[id] ?? (() => { const s = list.find(x => x.id === id); return { text: alertsText(s?.lead_alert_to ?? []), assignee: s?.alert_assignee ?? true }; })();
  const storedOf = (id: string) => { const s = list.find(x => x.id === id); return { to: s?.lead_alert_to ?? [], assignee: s?.alert_assignee ?? true }; };
  const changed = list.filter(s => typed[s.id] && alertsChanged(storedOf(s.id), typed[s.id]!));
  const valid = list.every(s => !typed[s.id] || parseAlerts(typed[s.id]!.text).problem === null);
  const canSave = !busy && changed.length > 0 && valid && changed.every(s => canSaveAlerts(storedOf(s.id), typed[s.id]!));
  const dirty = changed.length > 0;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setFailed(false);
    try {
      for (const s of changed) await saveAlerts(workspace, s.id, parseAlerts(typed[s.id]!.text).addresses, typed[s.id]!.assignee);
      await qc.invalidateQueries({ queryKey: ['site-alerts', workspace] });
      setTyped({});
      toast(t('DP-1.6-17', 'Saved'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="alerts-title" className={css.card}>
      <h2 id="alerts-title" data-plan="DP-1.6-04">Lead alerts</h2>
      {sites.isLoading && <p data-plan="DP-1.2s-10">Loading</p>}
      {sites.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {sites.data && (
        <form onSubmit={e => void save(e)} className={css.form} data-plan="DP-1.6-10">
          {list.map(s => {
            const v = valueOf(s.id);
            const problem = typed[s.id] ? parseAlerts(v.text).problem : null;
            return (
              <fieldset key={s.id} className={css.site} data-plan="DP-1.6-04">
                <legend>{s.preview_host}</legend>
                <label>
                  Addresses, one per line
                  <textarea name={`alerts-${s.id}`} rows={4} spellCheck={false} autoComplete="off" value={v.text} aria-invalid={problem ? true : undefined}
                    onChange={e => setTyped(prev => ({ ...prev, [s.id]: { ...valueOf(s.id), text: e.target.value } }))} />
                </label>
                {problem && (
                  <p role="alert" data-plan="DP-1.6-16">{problem.kind === 'line' ? `Line ${problem.line} is not an email address.` : 'At most 10 addresses.'}</p>
                )}
                <label>
                  <input type="checkbox" name={`assignee-${s.id}`} checked={v.assignee}
                    onChange={e => setTyped(prev => ({ ...prev, [s.id]: { ...valueOf(s.id), assignee: e.target.checked } }))} />
                  Also email the assigned agent
                </label>
              </fieldset>
            );
          })}
          {failed && <p role="alert" data-plan="DP-1.6-17">Not saved. Try again.</p>}
          <button type="submit" disabled={!canSave} className={css.save}>{busy ? t('DP-1.2s-10', 'Saving') : 'Save'}</button>
        </form>
      )}
    </section>
  );
}
