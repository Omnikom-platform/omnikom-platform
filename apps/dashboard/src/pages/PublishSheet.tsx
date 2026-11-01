import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { publishRows } from '../api';
import type { Site } from '../data';
import { receivedWords } from '../lib/leads';
import { CallFailed } from '../lib/problems';
import { failureLines, progressLines, RUNNING, rowTitle, siteUrl, type Job, type JobEvent } from '../lib/site';
import { useSiteValue } from '../site-context';

type Wrong = { row: string; path: string; msg: string; code?: string };

/**
 * The publish sheet (DP-1.4c-01 to -04): the change list, "Publish these N changes to <site>?", then the progress list live from the job and
 * its events, and a failed check that stops the list with Fix and the plan's sentence. A job that is already running for this site opens
 * on its progress (the same sheet is behind the "Publishing" button, DP-1.4c-05).
 */
export function PublishSheet({ site, jobs, onClose }: { site: Site; jobs: { jobs: Job[]; events: JobEvent[] }; onClose: () => void }) {
  const { contract, rows, drafts, draftsBusy, who } = useSiteValue();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const nav = useNavigate();
  const qc = useQueryClient();
  const [started, setStarted] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<Wrong[]>([]);
  const [notice, setNotice] = useState('');
  const running = jobs.jobs.find(j => j.site_id === site.id && RUNNING.includes(j.state));
  const job = jobs.jobs.find(j => j.id === (started || running?.id));
  const name = site.domain || site.preview_host;
  const nameOfRow = (id: string) => { const r = rows.find(x => x.id === id); return r ? rowTitle(contract, r.collection, r.newest?.data) || contract.collections[r.collection]?.label || '' : ''; };

  const publish = async () => {
    setBusy(true); setNotice(''); setWrong([]);
    try {
      const out = await publishRows(site.id, drafts.map(d => d.row), drafts.map(d => d.newest));
      setStarted(out.job);
      if (!out.dispatched && out.reason) setNotice(out.reason);
      await Promise.all([qc.invalidateQueries({ queryKey: ['jobs'] }), qc.invalidateQueries({ queryKey: ['drafts'] })]);
    } catch (e) {
      if (!(e instanceof CallFailed)) { setNotice(String(e)); return; }
      const fields = e.problem.fields.filter(f => f.row);
      if (e.problem.status === 422 && fields.length) setWrong(fields.map(f => ({ row: f.row ?? '', path: f.path, msg: f.msg, code: f.code })));
      else setNotice(e.problem.message);
    } finally {
      setBusy(false);
    }
  };

  const fix = (rowId: string, path?: string) => {
    const r = rows.find(x => x.id === rowId);
    if (!r) return;
    onClose();
    void nav({ to: '/w/$ws/site/$collection/$row', params: { ws, collection: r.collection, row: r.id }, ...(path ? { search: { field: path } } : {}) });
  };

  const lines = job ? progressLines(jobs.events.filter(e => e.job_id === job.id)) : [];

  return (
    <dialog open data-plan="DP-1.4c-02" aria-labelledby="publish-title">
      {!job && (
        <>
          <h2 id="publish-title">Publish these {drafts.length} changes to {name}?</h2>
          <ul data-plan="DP-1.4c-01">
            {drafts.map(d => (
              <li key={d.row}>
                {nameOfRow(d.row)} {who(d.editedBy)} <time dateTime={d.editedAt}>{receivedWords(d.editedAt)}</time>
              </li>
            ))}
          </ul>
          {wrong.length > 0 && (
            <div data-plan="DP-1.4c-04">
              <ul>
                {wrong.map((w, i) => (
                  <li key={i}>
                    {nameOfRow(w.row)}: {w.msg}{w.code && <> <small>{w.code}</small></>}{' '}
                    <button type="button" onClick={() => fix(w.row, w.path)}>Fix</button>
                  </li>
                ))}
              </ul>
              <p>Nothing went live</p>
            </div>
          )}
          {notice && <p role="alert" data-plan="DP-1.4c-04">{notice}</p>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy || draftsBusy || drafts.length === 0} onClick={() => void publish()}>Publish</button>
        </>
      )}
      {job && (
        <>
          <h2 id="publish-title" hidden>{name}</h2>
          <ol data-plan="DP-1.4c-03" data-state={job.state}>
            {lines.map(l => (
              <li key={l.key}>
                {l.text}
                {l.live && <> <a href={siteUrl(site)} target="_blank" rel="noopener">Open</a></>}
              </li>
            ))}
          </ol>
          {job.state === 'failed' && (
            <div data-plan="DP-1.4c-04">
              <ul>{failureLines(job).map((l, i) => <li key={i}>{l}</li>)}</ul>
              <p>Nothing went live</p>
              <button type="button" onClick={() => fix(job.rows[0] ?? '')}>Fix</button>
            </div>
          )}
          <button type="button" onClick={onClose}>Cancel</button>
        </>
      )}
    </dialog>
  );
}
