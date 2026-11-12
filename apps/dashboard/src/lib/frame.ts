// The instant frame's parts the page itself uses (book row B15). The renderer is never loaded here: it runs in the worker (frame-render.ts).
import { changesBetween } from './site';

export type FrameRow = { id: string; collection: string; data: Record<string, unknown> };
export type FrameInput = { n: number; slug: string; contract: unknown; rows: FrameRow[]; row: string; site: unknown; workspace: { slug: string; name: string }; origin: string; css: string[]; media: Record<string, { url: string; width: number | null; height: number | null }>; changed: string[] };
/** The page sections a draft changed (paths sections.<id>...), each once (DP-1.5-04). */
export const changedSections = (saved: unknown, draft: unknown): string[] => [...new Set(changesBetween(saved, draft).flatMap(c => { const m = /^sections\.([^.[]+)/.exec(c.path); return m?.[1] ? [m[1]] : []; }))];
/** Every photo the rows point at ({ asset: <media id> }, as factory/lib/launch.mjs referencedMedia reads them), sorted. */
export function assetsIn(rows: FrameRow[]): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown): void => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { const a = (v as { asset?: unknown }).asset; if (typeof a === 'string') ids.add(a); Object.values(v).forEach(walk); } };
  rows.forEach(r => walk(r.data));
  return [...ids].sort();
}
const CSS = import.meta.glob<string>('../../../../sites/*/design/*.css', { query: '?url', import: 'default', eager: true });
/** The design's stylesheets as addresses on the dashboard's own host (the frame's CSP allows only those): tokens, then base. */
export const cssOf = (slug: string): string[] => ['tokens', 'base'].flatMap(n => CSS[`../../../../sites/${slug}/design/${n}.css`] ?? []);
