import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { deleteItem, saveItem } from '../api';
import { config } from '../config';
import { fetchVersions, useVersions, type ContentRow, type VersionSign } from '../data';
import { receivedWords } from '../lib/leads';
import { CallFailed } from '../lib/problems';
import {
  canAdd, canDelete, changesBetween, dropDraft, editorCards, keepDraft, loadDraft, overLimits, pathKey, rowTitle, sameData, setAt, slugify, staleLine,
  type Change, type Path,
} from '../lib/site';
import { t } from '../plan';
import css from './Editor.module.css';
import crm from './Crm.module.css';   // the delete sheet looks like the leads' one (DeleteSheet.tsx)
import { useSiteValue } from '../site-context';
import { UNDO, useToast } from '../toast';
import { useWorkspaceValue } from '../workspace-context';
import { NotFound } from './NotFound';
import { AskUs, FieldWidget, type FieldError, type WidgetCtx } from './Widgets';

const AUTOSAVE_MS = 10_000;
const RETRY_MS = [2000, 4000, 8000, 16000, 30000];
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The editor of one item (DP-1.4-08 to -17, -19 to -21, -23): the section cards, Save with the base version, History. It opens on /w/$ws/site/$collection/$row ("new" for an item not made yet). */
export function Editor() {
  const { collection, row } = useParams({ from: '/authed/w/$ws/site/$collection/$row' });
  const { contract, rows, role, teamRow } = useSiteValue();
  const col = contract.collections[collection];
  const current = rows.find(r => r.id === row);
  const hidden = !col || col.kind === 'inbox' || (row === 'new' ? !canAdd(role, col) : !current || current.collection !== collection || !visibleRow(role, teamRow, col.access.member, col.ownerField, current));
  if (hidden) return <NotFound />;
  return <EditorBody key={`${collection}/${row}`} collection={collection} row={row === 'new' ? null : row} current={current} />;
}

function visibleRow(role: string, teamRow: string | null, member: string, ownerField: string | undefined, r: ContentRow): boolean {
  if (role !== 'member') return true;
  if (member === 'none') return false;
  if (member === 'own') return r.owner_team_row === teamRow || (ownerField === 'self' && r.id === teamRow);
  return true;
}

type Stale = { who: string; at: string; version: VersionSign | null };

function EditorBody({ collection, row, current }: { collection: string; row: string | null; current: ContentRow | undefined }) {
  const { workspace } = useWorkspaceValue();
  const { contract, rows, site, who, drafts, role } = useSiteValue();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const search = useSearch({ from: '/authed/w/$ws/site/$collection/$row' });
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const col = contract.collections[collection]!;

  const newest = current?.newest ?? null;
  const [rowId, setRowId] = useState<string | null>(row);
  const [base, setBase] = useState(newest?.n ?? 0);
  const [saved, setSaved] = useState<Record<string, unknown>>(newest?.data ?? {});
  const [data, setData] = useState<Record<string, unknown>>(() => {
    const kept = row ? loadDraft(workspace.id, row) : null;
    return kept && kept.base === (newest?.n ?? 0) ? kept.data : newest?.data ?? {};
  });
  const [errors, setErrors] = useState<Map<string, FieldError>>(new Map());
  const [notice, setNotice] = useState('');
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState<Stale | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState('');
  const [jump, setJump] = useState(search.field ?? '');
  const [showHistory, setShowHistory] = useState(false);
  const [compare, setCompare] = useState<Change[] | null>(null);
  const [asking, setAsking] = useState(false);
  const saving = useRef(false);
  const retries = useRef(0);
  const latest = useRef({ data, base, rowId, saved });
  latest.current = { data, base, rowId, saved };

  const cards = useMemo(() => editorCards(contract, collection, data), [contract, collection, data]);
  const allFields = useMemo(() => cards.flatMap(c => (c.kind === 'fields' ? c.fields : [])), [cards]);
  const over = useMemo(() => overLimits(allFields, data), [allFields, data]);
  const dirty = !sameData(data, saved);
  const published = current?.published_version != null;
  const openId = open || (cards[0]?.id ?? '');
  const versions = useVersions(workspace.id, rowId ?? 'new', showHistory);

  const ctx: WidgetCtx = {
    workspaceId: workspace.id, contract, rows, errors, askEmail: config.askEmail, slugLocked: published,
    pagePath: collection === 'pages' ? str(data.path) : '', host: site ? site.domain || site.preview_host : '',
  };

  const change = useCallback((path: Path, value: unknown) => {
    setData(d => {
      let next = setAt(d, path, value);
      const from = col.slugFrom ?? col.titleField;
      if (from && col.fields.slug && !published && path.length === 1 && path[0] === from) {
        if (!str(d.slug) || str(d.slug) === slugify(str(d[from]))) next = setAt(next, ['slug'], slugify(str(value)) || undefined);
      }
      return next;
    });
    setErrors(prev => { if (!prev.size) return prev; const m = new Map(prev); m.delete(pathKey(path)); return m; });
    setNotice('');
  }, [col, published]);

  // Fix, and the first wrong field after a save: open the card that holds the path, then focus the field.
  useEffect(() => {
    if (!jump) return;
    const card = cards.find(c => c.kind === 'fields' && c.fields.some(f => jump === pathKey(f.path) || jump.startsWith(`${pathKey(f.path)}.`) || jump.startsWith(`${pathKey(f.path)}[`)));
    if (card && card.id !== openId) { setOpen(card.id); return; }
    let key = jump;
    for (;;) {
      const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(key)}"]`);
      if (el) { (el.querySelector<HTMLElement>('input, textarea, select') ?? el).focus(); el.scrollIntoView({ block: 'center' }); break; }
      const cut = Math.max(key.lastIndexOf('.'), key.lastIndexOf('['));
      if (cut <= 0) break;
      key = key.slice(0, cut);
    }
    setJump('');
  }, [jump, cards, openId]);

  const refresh = useCallback(async (id: string) => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['rows', workspace.id] }), qc.invalidateQueries({ queryKey: ['drafts'] }), qc.invalidateQueries({ queryKey: ['versions', workspace.id, id] })]);
  }, [qc, workspace.id]);

  const save = useCallback(async (override?: { data: Record<string, unknown>; base: number; quiet?: boolean }) => {
    if (saving.current) return null;
    saving.current = true;
    setBusy(true);
    const send = override ?? { data: latest.current.data, base: latest.current.base };
    try {
      const out = await saveItem({ workspace: workspace.id, collection, row: latest.current.rowId, base: send.base, data: send.data });
      retries.current = 0;
      setOffline(false); setStale(null); setNotice(''); setErrors(new Map());
      setBase(out.version); setSaved(send.data); setRowId(out.row);
      dropDraft(workspace.id, out.row);
      await refresh(out.row);
      if (!override?.quiet) toast(t('DP-1.4-17', 'Saved'));
      if (!latest.current.rowId) void nav({ to: '/w/$ws/site/$collection/$row', params: { ws, collection, row: out.row }, replace: true });
      return out;
    } catch (e) {
      if (!(e instanceof CallFailed)) { setNotice(String(e)); return null; }
      const p = e.problem;
      if (p.code === 'S-STALE') {
        const list = await qc.fetchQuery({ queryKey: ['versions', workspace.id, latest.current.rowId ?? ''], queryFn: () => fetchVersions(latest.current.rowId ?? ''), staleTime: 0 }).catch(() => [] as VersionSign[]);
        const v = list[0] ?? null;
        setStale({ who: v ? who(v.by) : '', at: v?.at ?? '', version: v });
      } else if (p.status === 422) {
        const map = new Map<string, FieldError>();
        for (const f of p.fields) if (!map.has(f.path)) map.set(f.path, { msg: f.msg, code: f.code });
        setErrors(map);
        const first = p.fields[0]?.path;
        if (first !== undefined) setJump(first);
        if (!map.size) setNotice(p.message);
      } else if (p.status === 0) {
        keepDraft(workspace.id, latest.current.rowId ?? 'new', send.base, send.data);
        setOffline(true);
      } else setNotice(p.message);
      return null;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [workspace.id, collection, ws, nav, qc, refresh, toast, who]);

  // Autosave after 10 s idle, for an item that already exists and has nothing wrong with it; a dropped network retries with a longer wait each time.
  useEffect(() => {
    if (!dirty || busy || !rowId || stale || over.length > 0) return;
    const timer = window.setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [data, dirty, busy, rowId, stale, over.length, save]);
  useEffect(() => {
    if (!offline || busy) return;
    const timer = window.setTimeout(() => { retries.current += 1; void save(); }, RETRY_MS[Math.min(retries.current, RETRY_MS.length - 1)]);
    return () => window.clearTimeout(timer);
  }, [offline, busy, save]);

  const seeTheirs = () => {
    if (!stale?.version) return;
    setCompare(changesBetween(saved, stale.version.data));
    setBase(stale.version.n);
    setSaved(stale.version.data);
    setStale(null);
  };

  const restore = async (v: VersionSign) => {
    const before = { data: saved, base };
    const out = await save({ data: v.data, base, quiet: true });
    if (!out) return;
    setData(v.data);
    setCompare(null);
    toast(`${t('DP-1.4-20', 'Restored the version from')} ${receivedWords(v.at)}.`, { label: UNDO, run: () => { void save({ data: before.data, base: out.version }).then(r => { if (r) setData(before.data); }); } });
  };

  const title = rowTitle(contract, collection, data) || col.label;
  const nameOfVersion = (v: VersionSign) => who(v.by);
  const saveDisabled = !dirty || busy || over.length > 0;
  const closeAsk = useCallback(() => setAsking(false), []);
  const deleted = async () => { dropDraft(workspace.id, rowId ?? ''); toast(`${t('DP-1.4-23', 'Deleted')} ${title}.`); await nav({ to: '/w/$ws/site', params: { ws } });
    await Promise.all([qc.invalidateQueries({ queryKey: ['rows', workspace.id] }), qc.invalidateQueries({ queryKey: ['drafts'] })]); };

  return (
    <section aria-labelledby="editor-title" className={css.editor}>
      {collection === 'pages' ? <h1 id="editor-title" data-plan="DP-1.4-05">{title}</h1> : <h1 id="editor-title" data-plan="DP-1.4-06">{title}</h1>}

      {cards.map(c => {
        const isOpen = c.id === openId;
        return (
          <section key={c.id} className={css.part} data-plan="DP-1.4-08" data-open={isOpen ? 'true' : 'false'}>
            <h2><button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '-' : c.id)}>{c.title}<span aria-hidden="true">{isOpen ? 'Close' : 'Open'}</span></button></h2>
            {isOpen && c.kind === 'fields' && c.fields.map(f => (
              <FieldWidget key={pathKey(f.path)} name={f.name} def={f.def} path={f.path} value={dataAt(data, f.path)} onChange={change} ctx={ctx} />
            ))}
            {isOpen && c.kind === 'feed' && <p data-plan="DP-1.4-14">{c.line}</p>}
            {isOpen && c.kind === 'locked' && (
              <div data-plan="DP-1.4-15" data-locked="true">
                <AskUs email={config.askEmail} />
              </div>
            )}
          </section>
        );
      })}

      <div data-plan="DP-1.4-17" data-saving={busy ? 'true' : 'false'} className={css.bar}>
        <button type="button" disabled={saveDisabled} onClick={() => void save()} className={css.save}>Save</button>
        <button type="button" data-plan="DP-1.4-19" aria-expanded={showHistory} onClick={() => { setShowHistory(s => !s); setCompare(null); }}>History</button>
        {rowId && canDelete(role, collection, col) && <button type="button" data-plan="DP-1.4-21" className={crm.danger} onClick={() => setAsking(true)}>Delete</button>}
        {rowId && drafts.some(d => d.row === rowId) && <mark data-plan="DP-1.4-17">changed</mark>}
        {offline && <p role="status" data-plan="DP-1.4-17">Not saved yet, retrying</p>}
        {stale && (
          <p role="alert" data-plan="DP-1.4-17">
            {staleLine(stale.who, stale.at)} <button type="button" onClick={seeTheirs}>See their changes</button>{','} then save again.
          </p>
        )}
        {notice && <p role="alert" data-plan="DP-1.4-17">{notice}</p>}
      </div>

      {compare && <Changes changes={compare} />}
      {asking && rowId && <DeleteItem row={rowId} title={title} onClose={closeAsk} onDeleted={() => void deleted()} />}

      {showHistory && (
        <div data-plan="DP-1.4-19" className={css.history}>
          <ol>
            {(versions.data ?? []).map((v, i) => (
              <li key={v.n}>
                {nameOfVersion(v)} <time dateTime={v.at}>{receivedWords(v.at)}</time>
                <button type="button" onClick={() => setCompare(changesBetween(v.data, data))}>Compare</button>
                {i > 0 && <button type="button" data-plan="DP-1.4-20" disabled={busy} onClick={() => void restore(v)}>Restore</button>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const dataAt = (data: Record<string, unknown>, path: Path): unknown => path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string | number, unknown>)[k] : undefined), data);

/** Compare (DP-1.4-19): each field that differs, with the two values. The plan gives no heading words for it, so it is the labels and the values only. */
function Changes({ changes }: { changes: Change[] }) {
  return (
    <div data-plan="DP-1.4-19" className={css.compare}>
      <dl>
        {changes.map(c => (
          <div key={c.path}>
            <dt>{c.label}</dt>
            <dd><del>{c.before}</del></dd>
            <dd><ins>{c.after}</ins></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The delete sheet (DP-1.4-23), as DeleteSheet.tsx: Cancel has the focus; Cancel and Esc send nothing; only "Delete this item" calls unpublish. */
function DeleteItem({ row, title, onClose, onDeleted }: { row: string; title: string; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const remove = async () => {
    setBusy(true); setError('');
    try { await deleteItem(row); onDeleted(); } catch (e) { setError(e instanceof CallFailed && e.problem.plain ? e.problem.message : t('DP-1.4-23', 'Could not delete. Nothing was removed. Try again.')); setBusy(false); }
  };
  return (
    <div className={crm.overlay}><div role="dialog" aria-modal="true" aria-labelledby="delete-item-title" data-plan="DP-1.4-23" className={crm.sheet}>
      <h2 id="delete-item-title">Delete {title}?</h2>
      <p>It leaves your Site list now and the live site at your next publish. Its past versions stay in our records, but you cannot open it again here.</p>
      <div className={crm.sheetButtons}><button type="button" className={crm.danger} disabled={busy} onClick={() => void remove()}>Delete this item</button><button type="button" ref={cancel} onClick={onClose}>Cancel</button></div>
      {error && <p role="alert">{error}</p>}
    </div></div>
  );
}
