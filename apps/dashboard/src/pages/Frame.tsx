import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFrameMedia } from '../data';
import { assetsIn, changedSections, cssOf, type FrameInput } from '../lib/frame';
import { siteUrl } from '../lib/site';
import { t } from '../plan';
import css from './Editor.module.css';
import { useSiteValue } from '../site-context';
import { useWorkspaceValue } from '../workspace-context';

/** The instant frame (DP-1.5-01, -02, -04; book row B15): this item's page drawn by the factory's renderer in a worker with the draft as typed, in a
 *  sandboxed frame (no script runs), photos through 5-minute signed links. It saves and publishes nothing. */
export function Frame({ rowId, data, saved, onClose }: { rowId: string; data: Record<string, unknown>; saved: Record<string, unknown>; onClose: () => void }) {
  const { workspace } = useWorkspaceValue(), { contract, rows, site } = useSiteValue();
  const [wide, setWide] = useState(false), [shown, setShown] = useState({ html: '', error: '' }), worker = useRef<Worker | null>(null), sent = useRef(0);
  const all = useMemo(() => rows.flatMap(r => (r.id === rowId ? [{ id: r.id, collection: r.collection, data }] : r.newest ? [{ id: r.id, collection: r.collection, data: r.newest.data }] : [])), [rows, rowId, data]);
  const ids = useMemo(() => assetsIn(all), [all]);
  const media = useQuery({ queryKey: ['frame-media', workspace.id, ids.join(',')], staleTime: 240_000, queryFn: () => fetchFrameMedia(ids) });
  useEffect(() => {
    const w = new Worker(new URL('../lib/frame.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ n: number; html?: string; error?: string }>) => { if (e.data.n === sent.current) setShown(s => ({ html: e.data.html ?? s.html, error: e.data.error ?? '' })); };
    worker.current = w;
    return () => w.terminate();
  }, []);
  useEffect(() => {   // 300 ms after the last change, one render; only the newest answer (n) is shown
    const photos = media.data;
    if (!site || !photos) return;
    const timer = window.setTimeout(() => worker.current?.postMessage({ n: ++sent.current, slug: workspace.slug, contract, rows: all, row: rowId, site, workspace: { slug: workspace.slug, name: workspace.name }, origin: siteUrl(site), css: cssOf(workspace.slug), media: photos, changed: changedSections(saved, data) } satisfies FrameInput), 300);
    return () => window.clearTimeout(timer);
  }, [all, media.data, site, contract, rowId, workspace.slug, workspace.name, saved, data]);
  const problem = shown.error || (media.error ? String(media.error) : '');
  return (
    <div data-plan="DP-1.5-01" className={css.frame}>
      <div data-plan="DP-1.5-02" className={css.frameBar}>
        <button type="button" aria-pressed={!wide} onClick={() => setWide(false)}>Phone</button>
        <button type="button" aria-pressed={wide} onClick={() => setWide(true)}>Laptop</button>
        <button type="button" data-plan="DP-1.5-01" onClick={onClose}>Close</button>
      </div>
      {problem && <p role="alert">{t('DP-1.5-01', 'The preview cannot show this draft yet:')} {problem}</p>}
      <div className={css.frameView}><iframe data-plan="DP-1.5-04" title="Preview" sandbox="" srcDoc={shown.html} width={wide ? 1366 : 390} /></div>
    </div>
  );
}
