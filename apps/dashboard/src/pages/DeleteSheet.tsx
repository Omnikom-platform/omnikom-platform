import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bulkLeads } from '../api';
import { useExporter } from '../leads-view';
import { CallFailed } from '../lib/problems';
import { t } from '../plan';
import { useToast } from '../toast';
import css from './Crm.module.css';

export const DELETE_FAILED = t('DP-1.3-35', 'Could not delete. Nothing was removed. Try again.');

/**
 * The delete confirm sheet (DP-1.3-35), for the bulk bar and for the open lead (a bulk of one). Only its Delete button sends the confirm flag;
 * Cancel and Esc send nothing. "Export the list first" exports the current view (lead-export reads a view, not ids) and the sheet stays.
 */
export function DeleteSheet({ workspaceId, ids, onClose, onDeleted }: { workspaceId: string; ids: string[]; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const exporter = useExporter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const one = ids.length === 1;

  useEffect(() => { cancel.current?.focus(); }, []);   // once, when the sheet opens: a re-draw of the page behind never moves the focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const n = await bulkLeads({ workspace: workspaceId, ids, action: 'delete', confirm: true });
      void qc.invalidateQueries({ queryKey: ['leadlist', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['leadcounts', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['leads', workspaceId] });
      toast(`${t('DP-1.3-35', 'Deleted')} ${n} ${t('DP-1.3-35', 'leads.')}`);
      onDeleted();
    } catch (e) {
      setError(e instanceof CallFailed && e.problem.plain ? e.problem.message : DELETE_FAILED);
      setBusy(false);
    }
  }

  return (
    <div className={css.overlay}>
      <div role="dialog" aria-modal="true" aria-labelledby="delete-heading" data-plan="DP-1.3-35" className={css.sheet}>
        <h2 id="delete-heading">{one ? t('DP-1.3-35', 'Delete this lead?') : `${t('DP-1.3-35', 'Delete')} ${ids.length} ${t('DP-1.3-35', 'leads?')}`}</h2>
        <p>{t('DP-1.3-35', 'They are removed for good. We keep the record of their consent.')}</p>
        <div className={css.sheetButtons}>
          <button type="button" disabled={exporter.busy || !exporter.ready} onClick={() => void exporter.run()}>{t('DP-1.3-35', 'Export the list first')}</button>
          <button type="button" className={css.danger} disabled={busy} onClick={() => void remove()}>{one ? t('DP-1.3-35', 'Delete this lead') : `${t('DP-1.3-35', 'Delete')} ${ids.length} ${t('DP-1.3-35', 'leads')}`}</button>
          <button type="button" ref={cancel} onClick={onClose}>{t('DP-1.3-35', 'Cancel')}</button>
        </div>
        {exporter.message && <p role={exporter.failed ? 'alert' : 'status'}>{exporter.message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
