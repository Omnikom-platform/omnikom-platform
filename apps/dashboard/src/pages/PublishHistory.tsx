import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { publishRows, saveItem } from '../api';
import { fetchSnapshot, fetchVersionsAt, type Site } from '../data';
import { receivedWords } from '../lib/leads';
import { CallFailed } from '../lib/problems';
import { checksLine, failureLines, restoreSteps, type Job } from '../lib/site';
import { t } from '../plan';
import { useSiteValue } from '../site-context';
import { useWorkspaceValue } from '../workspace-context';
import css from './PublishSheet.module.css';
import { Sheet } from './Sheet';

/** Past publishes (DP-1.4c-07) and putting the site back to one (DP-1.4c-08), book row B11: that publish's content comes back as NEW versions
 *  (`save`) and goes live (`publish`); nothing is deleted. The newest live publish has no button: it is what the site shows. */
export function PublishHistory({ site, jobs, onClose, onStarted }: { site: Site; jobs: Job[]; onClose: () => void; onStarted: () => void }) {
  const { workspace } = useWorkspaceValue(), { rows } = useSiteValue(), qc = useQueryClient();
  const [asking, setAsking] = useState<Job | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const finished = jobs.filter(j => j.site_id === site.id && (j.state === 'done' || j.state === 'failed'));
  const newest = finished.find(j => j.state === 'done'), when = (j: Job) => j.finished_at ?? j.created_at;
  const putBack = async (job: Job) => {
    setBusy(true); setNotice('');
    try {
      const snapshot = await fetchSnapshot(job.id);
      const need = Object.entries(snapshot).filter(([id, n]) => { const r = rows.find(x => x.id === id); return Boolean(r?.newest) && r?.newest?.n !== n; });
      const steps = restoreSteps(snapshot, rows, await fetchVersionsAt(need));
      if (!steps.length) { setNotice(t('DP-1.4c-08', 'The site already shows this publish.')); return; }
      const versions: number[] = []; for (const s of steps) versions.push(s.data ? (await saveItem({ workspace: workspace.id, collection: s.collection, row: s.row, base: s.base, data: s.data })).version : s.base);
      await publishRows(site.id, steps.map(s => s.row), versions);
      await Promise.all([qc.invalidateQueries({ queryKey: ['jobs'] }), qc.invalidateQueries({ queryKey: ['rows', workspace.id] }), qc.invalidateQueries({ queryKey: ['drafts'] })]);
      onStarted();
    } catch (e) { setNotice(`${e instanceof CallFailed ? e.problem.message : String(e)} ${t('DP-1.4c-08', 'Nothing went live.')}`); } finally { setBusy(false); }
  };
  return (
    <Sheet onClose={onClose} data-plan="DP-1.4c-07" aria-labelledby="history-title" className={css.sheet}>
      <h2 id="history-title">Past publishes</h2>
      {asking ? <div data-plan="DP-1.4c-08"><p>Put the site back to the publish of {receivedWords(when(asking))}?</p>
        <p>Each page and item of that publish comes back as a new version and goes live. Nothing is deleted: the versions since stay in History. Items added since stay on the site; deleted items stay deleted; items taken off the site stay off.</p>
        <button type="button" className={css.go} disabled={busy} onClick={() => void putBack(asking)}>Put it back</button><button type="button" onClick={() => { setAsking(null); setNotice(''); }}>Cancel</button></div>
      : <ol>{finished.map(j => <li key={j.id}><time dateTime={when(j)}>{receivedWords(when(j))}</time> {j.state === 'done' ? t('DP-1.4c-07', 'Live') : t('DP-1.4c-07', 'Nothing went live')} {checksLine(j)}
          {j.state === 'failed' && <ul>{failureLines(j).map((l, i) => <li key={i}>{l}</li>)}</ul>}
          {j.state === 'done' && j.id !== newest?.id && <button type="button" data-plan="DP-1.4c-08" onClick={() => setAsking(j)}>Put the site back to this publish</button>}</li>)}</ol>}
      {notice && <p role="alert" data-plan="DP-1.4c-08">{notice}</p>}<button type="button" onClick={onClose}>Close</button>
    </Sheet>
  );
}
