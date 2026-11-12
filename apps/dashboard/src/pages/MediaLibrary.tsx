import { useMemo } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMediaFiles, useSignedUrl, type MediaFile } from '../data';
import { problemsOf, usesOf, type Problem, type Use } from '../lib/media';
import { UNREACHABLE } from '../lib/problems';
import { visibleTo } from '../lib/site';
import { t } from '../plan';
import { useSiteValue } from '../site-context';
import { useWorkspaceValue } from '../workspace-context';
import css from './Editor.module.css';

/** The media library (book row B14, DP-1.4m-02 to -04): every file newest first (a member: its own uploads), its problems where it is used and a link to each use. */
export function MediaLibrary() {
  const { workspace } = useWorkspaceValue();
  const { contract, rows, role, teamRow, me } = useSiteValue();
  const files = useMediaFiles(workspace.id, role === 'member' ? me.id : null);
  const mayOpen = useMemo(() => rows.filter(r => { const col = contract.collections[r.collection]; return !!col && visibleTo(role, teamRow, col, r); }), [contract, rows, role, teamRow]);
  const all = useMemo(() => usesOf(contract, rows), [contract, rows]);   // every use: a login reads every row of the business
  const uses = useMemo(() => usesOf(contract, mayOpen), [contract, mayOpen]);
  return (
    <section aria-labelledby="media-title" className={css.editor}>
      <h1 id="media-title" data-plan="DP-1.4m-02">Photos and files</h1>
      {files.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {files.data?.length === 0 && <p data-plan="DP-1.4m-02">No photos yet. Add one in an item's photo slot.</p>}
      <ul>{(files.data ?? []).map(f => <FileRow key={f.id} file={f} uses={uses.get(f.id) ?? []} used={all.get(f.id)?.length ?? 0} />)}</ul>
    </section>
  );
}

function FileRow({ file, uses, used }: { file: MediaFile; uses: Use[]; used: number }) {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const thumb = useSignedUrl(file.processed && !file.path.endsWith('.pdf') ? file.path.replace(/\.[^./]+$/, '-800.webp') : undefined);
  const problems = problemsOf(file, uses);
  return (
    <li data-media={file.id}>
      <p data-plan="DP-1.4m-02">{thumb.data && <img src={thumb.data} alt="" width={96} />}{!file.processed ? t('DP-1.4m-02', 'Preparing sizes') : file.width !== null ? `${file.width} ${t('DP-1.4m-02', 'px wide')}` : ''}</p>
      {problems.length > 0 && <ul data-plan="DP-1.4m-03">{problems.map(p => <li key={`${p.code} ${p.use.row} ${p.use.path}`}>{problemWords(p, file.width)}</li>)}</ul>}
      <p data-plan="DP-1.4m-04">{used ? `${t('DP-1.4m-04', 'Used in')} ${used} ${used === 1 ? t('DP-1.4m-04', 'place') : t('DP-1.4m-04', 'places')}` : t('DP-1.4m-04', 'Not used')}</p>
      {uses.length > 0 && (
        <ul data-plan="DP-1.4m-04">{uses.map(u => <li key={`${u.row} ${u.path}`}><Link to="/w/$ws/site/$collection/$row" params={{ ws, collection: u.collection, row: u.row }} search={{ field: u.path }}>{u.title} ({u.label})</Link></li>)}</ul>
      )}
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
