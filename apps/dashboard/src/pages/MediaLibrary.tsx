import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { manageMedia, putFile, uploadFinish, uploadStart } from '../api';
import { useMediaFiles, useSignedUrl, type MediaFile } from '../data';
import { problemsOf, usesOf, type Problem, type Use } from '../lib/media';
import { CallFailed, plainOr, UNREACHABLE } from '../lib/problems';
import { visibleTo } from '../lib/site';
import { t } from '../plan';
import { useSiteValue } from '../site-context';
import { useToast } from '../toast';
import { useWorkspaceValue } from '../workspace-context';
import css from './Editor.module.css';
import sheet from './Crm.module.css';
import { Sheet } from './Sheet';

/** The media library (book row B14, DP-1.4m-02 to -04): every file newest first (a member: its own uploads), its problems where it is used and a link to each use. */
export function MediaLibrary() {
  const { workspace } = useWorkspaceValue();
  const { contract, rows, role, teamRow, me } = useSiteValue();
  const files = useMediaFiles(workspace.id, role === 'member' ? me.id : null);
  const mayOpen = useMemo(() => rows.filter(r => { const col = contract.collections[r.collection]; return !!col && visibleTo(role, teamRow, col, r); }), [contract, rows, role, teamRow]);
  const all = useMemo(() => usesOf(contract, rows), [contract, rows]);   // every use: a login reads every row of the business
  const uses = useMemo(() => usesOf(contract, mayOpen), [contract, mayOpen]);
  const [ask, setAsk] = useState<Asked | null>(null);
  return (
    <section aria-labelledby="media-title" className={css.editor}>
      <h1 id="media-title" data-plan="DP-1.4m-02">Photos and files</h1>
      {files.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {files.data?.length === 0 && <p data-plan="DP-1.4m-02">No photos yet. Add one in an item's photo slot.</p>}
      <ul>{(files.data ?? []).map(f => <FileRow key={f.id} file={f} uses={uses.get(f.id) ?? []} used={all.get(f.id)?.length ?? 0} onAsk={setAsk} />)}</ul>
      {ask && <Ask ask={ask} onClose={() => setAsk(null)} />}
    </section>
  );
}

function FileRow({ file, uses, used, onAsk }: { file: MediaFile; uses: Use[]; used: number; onAsk: (a: Asked) => void }) {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const thumb = useSignedUrl(file.processed && !file.path.endsWith('.pdf') ? file.path.replace(/\.[^./]+$/, '-800.webp') : undefined);
  const problems = problemsOf(file, uses);
  const { workspace } = useWorkspaceValue();
  const { role } = useSiteValue();
  const manage = role !== 'member';   // Replace and Delete: the owner's and staff's (book row B14; the database refuses a member too)
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  /** Replace: the new photo is uploaded first, as the photo slot does (the rights box not ticked), then the sheet asks. */
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setProblem('');
    try {
      const start = await uploadStart(workspace.id, f);
      await putFile(start.uploadUrl, f); await uploadFinish(start.media, false, '');
      onAsk({ media: file.id, to: start.media, where: [...new Set(uses.map(u => u.title))].join(', ') });
    } catch (e) { setProblem(plainOr(e, UNREACHABLE)); } finally { setBusy(false); }
  };
  return (
    <li data-media={file.id}>
      <p data-plan="DP-1.4m-02">{thumb.data && <img src={thumb.data} alt="" width={96} />}{!file.processed ? t('DP-1.4m-02', 'Preparing sizes') : file.width !== null ? `${file.width} ${t('DP-1.4m-02', 'px wide')}` : ''}</p>
      {problems.length > 0 && <ul data-plan="DP-1.4m-03">{problems.map(p => <li key={`${p.code} ${p.use.row} ${p.use.path}`}>{problemWords(p, file.width)}</li>)}</ul>}
      <p data-plan="DP-1.4m-04">{used ? `${t('DP-1.4m-04', 'Used in')} ${used} ${used === 1 ? t('DP-1.4m-04', 'place') : t('DP-1.4m-04', 'places')}` : t('DP-1.4m-04', 'Not used')}</p>
      {uses.length > 0 && (
        <ul data-plan="DP-1.4m-04">{uses.map(u => <li key={`${u.row} ${u.path}`}><Link to="/w/$ws/site/$collection/$row" params={{ ws, collection: u.collection, row: u.row }} search={{ field: u.path }}>{u.title} ({u.label})</Link></li>)}</ul>
      )}
      {manage && uses.length > 0 && !file.path.endsWith('.pdf') && <label data-plan="DP-1.4m-05">Replace <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>}
      {manage && uses.length === 0 && <button type="button" data-plan="DP-1.4m-07" onClick={() => onAsk({ media: file.id, to: null, where: '' })}>Delete</button>}
      {problem && <p role="alert" data-plan="DP-1.4m-05">{problem}</p>}
    </li>
  );
}

/** One problem in the plan's words (DP-1.4m-03): what is wrong, in which item and field. */
function problemWords(p: Problem, width: number | null): string {
  const where = `${p.use.title} (${p.use.label})`;
  if (p.code === 'no-alt') return `${t('DP-1.4m-03', 'No alt text in')} ${where}`;
  if (p.code === 'no-rights') return `${t('DP-1.4m-03', 'No rights tick in')} ${where}`;
  return `${t('DP-1.4m-03', 'Too small for')} ${where}: ${width} ${t('DP-1.4m-03', 'px wide, needs')} ${p.use.minWidth}`;
}

type Asked = { media: string; to: string | null; where: string };

/** The ask-first sheet (DP-1.4m-06): replace says what changes where; delete is offered only for a file nothing uses, and the database refuses it
 *  otherwise. Only its main button calls media-manage; Cancel and Esc send nothing (as DeleteSheet). "Deleted." only after a 2xx; a refusal shows the
 *  function's own sentence (Storage refused: "Nothing was changed. Try again."), a refused replace also the save's own words. */
export function Ask({ ask, onClose }: { ask: Asked; onClose: () => void }) {
  const { workspace } = useWorkspaceValue();
  const qc = useQueryClient(), toast = useToast(), cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { cancel.current?.focus(); }, []);   // once, when the sheet opens: a re-draw of the page behind never moves the focus
  async function go() {
    if (busy) return; setBusy(true); setError('');
    try {
      const n = await manageMedia(ask.media, ask.to ? { action: 'replace', with: ask.to } : { action: 'delete' });
      for (const queryKey of [['rows', workspace.id], ['media-files', workspace.id], ['drafts']]) void qc.invalidateQueries({ queryKey });
      toast(!ask.to ? t('DP-1.4m-06', 'Deleted.') : n === 1 ? t('DP-1.4m-06', 'Replaced in 1 item.') : `${t('DP-1.4m-06', 'Replaced in')} ${n} ${t('DP-1.4m-06', 'items.')}`);
      onClose();
    } catch (e) {
      const why = e instanceof CallFailed ? e.problem.fields.map(f => f.msg).join(' ') : '';
      setError([plainOr(e, t('DP-1.4m-06', 'Nothing was changed. Try again.')), why].filter(Boolean).join(' ')); setBusy(false);
    }
  }
  return (
    <Sheet onClose={onClose} aria-labelledby="media-ask" data-plan="DP-1.4m-06" className={sheet.sheet}>
        <h2 id="media-ask">{ask.to ? t('DP-1.4m-06', 'Replace this photo everywhere it is used?') : t('DP-1.4m-06', 'Delete this file?')}</h2>
        <p>{ask.to ? t('DP-1.4m-06', 'Each item that uses it gets a new version with the new photo. Your site changes at your next publish.') : t('DP-1.4m-06', 'No item uses it. It is removed for good, with its sizes.')}</p>
        {ask.to && <p>{t('DP-1.4m-06', 'It changes in:')} {ask.where}</p>}
        <div className={sheet.sheetButtons}>
          <button type="button" className={ask.to ? undefined : sheet.danger} disabled={busy} onClick={() => void go()}>{ask.to ? t('DP-1.4m-06', 'Replace everywhere') : t('DP-1.4m-06', 'Delete this file')}</button>
          <button type="button" ref={cancel} onClick={onClose}>{t('DP-1.4m-06', 'Cancel')}</button>
        </div>
        {error && <p role="alert">{error}</p>}
    </Sheet>
  );
}
