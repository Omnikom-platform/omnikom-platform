// The instant frame's renderer (book row B15, DP-1.5-01): the factory's own code draws one page from the rows with the draft in place, with the site's design
// modules (sites/<slug>/design/, bundled with the dashboard, loaded on demand). A worker runs it (B15-a2); Vitest runs it in Node.
import { renderRow } from '../../../../factory/lib/render.mjs';
import type { FrameInput } from './frame';

type Part = (a: unknown) => unknown;
const MODULES = import.meta.glob<{ default: Part }>('../../../../sites/*/design/{shell,sections/*,item/*}.mjs');
const load = async (slug: string, part: string): Promise<Part> => {
  const get = MODULES[`../../../../sites/${slug}/design/${part}.mjs`];
  if (!get) throw new Error(`the design has no ${part}.mjs`);
  return (await get()).default;
};
/** The page of input.row as the build draws it, each changed section's first tag marked data-changed (frame.css outlines it). */
export async function frameHtml(i: FrameInput): Promise<string> {
  const design = { shell: await load(i.slug, 'shell'), section: (id: string) => load(i.slug, `sections/${id}`), item: (c: string) => load(i.slug, `item/${c}`) };
  const media = (asset: string) => { const m = i.media[asset]; if (!m) throw new Error(`no media row "${asset}"`); return m; };
  const mark = (id: string, html: string) => (i.changed.includes(id) ? html.replace(/^(\s*<[a-zA-Z][\w-]*)/, '$1 data-changed') : html);
  return (await renderRow({ contract: i.contract, rows: i.rows, design, site: i.site, workspace: i.workspace, origin: i.origin, preview: true, builtAt: new Date().toISOString(), media, assets: { css: [...i.css, '/frame.css'], js: [] }, row: i.row, mark })).html;
}
