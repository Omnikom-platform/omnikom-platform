// The list's view (search, filters, sort, layout choice) shared with the open lead, so the delete sheet's "Export the list first" can export
// exactly what the list shows (DP-1.3-05, -35). The Leads screen provides it; the panel beside it reads it.
import { createContext, useCallback, useContext, useState } from 'react';
import { exportLeads } from './api';
import { viewQuery, type View } from './lib/crm';
import { CallFailed } from './lib/problems';
import { t } from './plan';

export type LeadsViewValue = { workspaceId: string; view: View; myTeamRow: string | null; template: string };
export const LeadsViewContext = createContext<LeadsViewValue | null>(null);
export const useLeadsView = () => useContext(LeadsViewContext);

/** Hand the browser a text file to save. */
export function saveFile(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const EXPORT_FAILED = t('DP-1.3-05', 'Could not export. Try again.');
export const EXPORT_CAPPED = t('DP-1.3-05', 'The file holds the newest 5000 leads.');

/** The export of the current view, in the chosen layout: the file is saved, and the words that go with it come back for the screen to show. */
export function useExporter() {
  const v = useLeadsView();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const run = useCallback(async () => {
    if (!v || busy) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const q = viewQuery(v.view, v.myTeamRow);
      const out = await exportLeads({
        workspace: v.workspaceId, ...q,
        ...(v.template ? { template: v.template, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
      });
      saveFile(out.csv, out.filename);
      if (out.capped) setMessage(EXPORT_CAPPED);
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof CallFailed && e.problem.plain ? e.problem.message : EXPORT_FAILED);
    } finally {
      setBusy(false);
    }
  }, [v, busy]);
  return { run, busy, message, failed, ready: Boolean(v) };
}
