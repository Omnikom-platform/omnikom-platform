import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { startPreview } from '../api';
import { usePreviewJob, type Site } from '../data';
import { CallFailed } from '../lib/problems';
import { clock, draftLink, failureLines, leftOutLine, RUNNING, type LeftOut } from '../lib/site';
import { t } from '../plan';
import { useSiteValue } from '../site-context';
import { useWorkspaceValue } from '../workspace-context';

/** The preview site (DP-1.4c-09, book row B15): the saved changes that are ready, at the draft address, by its signed link (B15-b3); the rest named, and why. */
export function PreviewSite({ site }: { site: Site }) {
  const { workspace } = useWorkspaceValue(), { contract, rows } = useSiteValue(), qc = useQueryClient(), job = usePreviewJob(workspace.id, site.id).data;
  const [notice, setNotice] = useState(''), [refused, setRefused] = useState<LeftOut[]>([]), busy = !!job && RUNNING.includes(job.state);
  const link = job?.state === 'done' ? draftLink(site, job) : '', left = refused.length ? refused : (job?.left_out ?? []);
  const start = async () => {
    setNotice(''); setRefused([]);
    try { const out = await startPreview(site.id); if (!out.dispatched && out.reason) setNotice(out.reason); await qc.invalidateQueries({ queryKey: ['jobs', workspace.id] }); }
    catch (e) { setNotice(e instanceof CallFailed ? e.problem.message : String(e)); if (e instanceof CallFailed) setRefused(e.problem.fields.flatMap(f => (f.row ? [{ row: f.row, path: f.path }] : []))); }
  };
  return (
    <div data-plan="DP-1.4c-09">
      <button type="button" disabled={busy} onClick={() => void start()}>Preview site</button>
      <p role="status">
        {busy ? t('DP-1.4c-09', 'Building the preview: every saved change that is ready, nothing goes live.')
          : job?.state === 'done' ? <>{t('DP-1.4c-09', 'Preview from')} {clock(job.finished_at ?? job.created_at)}. {link ? <a href={link} target="_blank" rel="noopener">Open the preview</a> : t('DP-1.4c-09', 'Its link has run out: press Preview site again.')}</>
          : job?.state === 'failed' ? `${t('DP-1.4c-09', 'The preview did not build:')} ${failureLines(job)[0] ?? ''}` : ''}
      </p>
      {notice && <p role="alert">{notice}</p>}
      {left.length > 0 && <><p>{t('DP-1.4c-09', 'Not in the preview:')}</p><ul>{left.map((x, i) => <li key={i}>{leftOutLine(contract, rows.find(r => r.id === x.row), x.path)}</li>)}</ul></>}
    </div>
  );
}
