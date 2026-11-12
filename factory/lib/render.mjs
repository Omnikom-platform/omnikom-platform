// One page of a site as markup (03-FRONTEND A3 step 4), moved here from lib/site.mjs: the build and the dashboard's instant frame (book row B15,
// apps/dashboard/src/lib/frame-render.ts, in a browser worker) run this same code. No file, network or process use: every input is passed in.
import { planSite, resolveFeed, entryOf } from './plan.mjs';
import { raw, markup } from './html.mjs';
import { referenceOptions } from './fields.mjs';
import { publicData } from '../../contracts/place.mjs';
import { mergeCore } from '../../contracts/validate.mjs';

const fileOf = (path) => (path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1));
/** What every page of one build shares; the notice rows it reads join `used`. */
export function baseOf({ contract, rows, plan, settingsRow, used, site, workspace, origin, builtAt, preview, media, assets }) {
  const notices = {};
  for (const r of rows) if (r.collection === 'notices') { notices[r.data.slug] = entryOf(contract, r); used.add(r.id); }
  const nav = plan.built.map((b) => ({ path: b.path, type: b.type, title: b.row.data.title }));
  return { site, workspace, settings: publicData(contract, 'settings', settingsRow.data), origin, built_at: builtAt, preview, media, nav, notices, assets };
}
/** The pages of the rows only(id) accepts (all, for the build); mark(sectionId, markup) may change a section's markup (the frame outlines a changed one). */
export async function renderPages({ contract, rows, plan, design, base, used, only = () => true, mark = (id, s) => s }) {
  const cols = mergeCore(contract), byId = new Map(rows.map((r) => [r.id, r])), pages = [];
  const wrap = (page, main) => markup(design.shell({ page, main, ctx: { ...base, page, path: page.path } }), 'shell.mjs');
  for (const b of plan.built) {
    if (!only(b.row.id)) continue;
    const d = b.row.data, t = contract.pageTypes[b.type];
    used.add(b.row.id);
    let bound = null;
    if (b.bind) { const br = rows.find((r) => r.collection === t.bind && r.data.slug === b.bind); if (br) { bound = entryOf(contract, br); used.add(br.id); } }
    const seo = d.seo || {};
    const page = { kind: 'page', path: b.path, file: fileOf(b.path), type: b.type, bind: b.bind, title: d.title, seo, description: seo.description || '', noindex: seo.noindex === true, bound };
    const ctx = { ...base, page, path: b.path };
    const parts = [];
    for (const s of t.sections) {
      const render = await design.section(s.id);
      const feedIds = s.kind === 'feed' ? (plan.placed.pages[b.path].sections[s.id] || []) : [];
      feedIds.forEach((id) => used.add(id));
      parts.push(mark(s.id, markup(await render({
        section: s,
        data: s.kind === 'notice' ? (base.notices[s.notice] || {}) : ((d.sections || {})[s.id] || {}),
        feed: resolveFeed(contract, byId, feedIds),
        form: s.kind === 'form' ? contract.forms[s.form] : undefined,
        choices: s.kind === 'form' ? referenceOptions(contract.forms[s.form], contract, rows) : undefined,
        ctx,
      }), `sections/${s.id}.mjs`)));
    }
    page.html = wrap(page, raw(parts.join('\n')));
    pages.push(page);
  }
  for (const it of plan.items) {
    if (!only(it.id)) continue;
    used.add(it.id);
    const c = cols[it.collection];
    const entry = entryOf(contract, it.row);
    const seo = it.row.data.seo || {};
    const page = { kind: 'item', path: it.path, file: fileOf(it.path), type: it.collection, collection: it.collection, title: String(it.row.data[c.titleField] || ''), seo, description: seo.description || '', noindex: seo.noindex === true, bound: null };
    const render = await design.item(it.collection);
    page.html = wrap(page, raw(markup(await render({ row: entry, ctx: { ...base, page, path: it.path } }), `item/${it.collection}.mjs`)));
    pages.push(page);
  }
  return pages;
}
/** The one page the frame shows for a row: its own, else the home page (for a row with no page, like the business details). */
export async function renderRow({ contract, rows, design, row, mark, ...shared }) {
  const plan = planSite(contract, rows), settingsRow = rows.find((r) => r.collection === 'settings'), used = new Set();
  if (!settingsRow) throw new Error('the site has no business details row');
  const own = plan.built.some((b) => b.row.id === row) || plan.items.some((it) => it.id === row);
  const show = own ? row : (plan.built.find((b) => b.path === '/') || plan.built[0])?.row.id;
  const [page] = await renderPages({ contract, rows, plan, design, base: baseOf({ contract, rows, plan, settingsRow, used, ...shared }), used, only: (id) => id === show, mark });
  if (!page) throw new Error('the site has no page to show yet');
  return page;
}
