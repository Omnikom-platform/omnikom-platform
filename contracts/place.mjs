// Placement: given a site contract and that site's PUBLISHED rows, decide where every item goes
// (which page sections list it, which item pages exist, what enters the sitemap and the page schema).
// This is the part of Publish that turns "a listing in Fairfield, status active" into
// "on its own page, on the Fairfield guide, on the home page's Our listings, in the sitemap, with RealEstateListing schema".
import { mergeCore } from './validate.mjs';

const routeOf = (route, data) => route.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, f) => data[f]);

function matches(when, data) {
  for (const [f, vals] of Object.entries(when || {})) {
    const v = data[f];
    const have = Array.isArray(v) ? v : [v];
    if (!have.some(x => vals.includes(x))) return false;
  }
  return true;
}

function sorter(spec) {
  if (!spec) return () => 0;
  const desc = spec.startsWith('-');
  const f = desc ? spec.slice(1) : spec;
  const key = d => (d[f] && typeof d[f] === 'object' && 'amount' in d[f]) ? d[f].amount : d[f];
  return (a, b) => {
    const x = key(a.data), y = key(b.data);
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * (desc ? -1 : 1);
  };
}

// What a visitor may see of one row: internal fields removed, and fields whose visibleWhen is not met
// (e.g. a sold price unless "show sold price" is ticked).
export function publicData(contract, collection, data) {
  const c = mergeCore(contract)[collection];
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const f = c.fields[k];
    if (!f || f.internal) continue;
    if (f.visibleWhen && !Object.entries(f.visibleWhen).every(([g, vals]) => vals.includes(data[g]))) continue;
    out[k] = v;
  }
  return out;
}

export function place(contract, rows) {
  const cols = mergeCore(contract);
  const byId = new Map(rows.map(r => [r.id, r]));
  const out = { pages: {}, itemPages: [], sitemap: [], schema: [] };
  for (const pg of contract.pages) out.pages[pg.path] = { type: pg.type, bind: pg.bind, sections: {} };
  const pathOf = new Map();
  for (const r of rows) {
    const c = cols[r.collection];
    if (c && c.route) { const path = routeOf(c.route, r.data); pathOf.set(r.id, path); out.itemPages.push({ path, collection: r.collection, id: r.id }); }
  }
  const noindex = new Set(rows.filter(r => r.collection === 'pages' && r.data.seo && r.data.seo.noindex).map(r => r.data.path));
  for (const pg of contract.pages) if (!noindex.has(pg.path)) out.sitemap.push(pg.path);

  for (const pl of contract.placements) {
    const items = rows.filter(r => r.collection === pl.collection && matches(pl.when, r.data)).sort(sorter(pl.sort));
    const to = pl.to;
    if (to.sitemap) { for (const r of items) out.sitemap.push(pathOf.get(r.id)); continue; }
    if (to.schema) { for (const r of items) out.schema.push({ path: pathOf.get(r.id), type: to.schema, id: r.id }); continue; }
    const targets = to.page !== undefined ? contract.pages.filter(p => p.path === to.page) : contract.pages.filter(p => p.type === to.pageType);
    for (const pg of targets) {
      let list = items;
      if (to.match) list = list.filter(r => [].concat(r.data[to.match] || []).some(ref => {
        const target = byId.get(ref);
        return target && target.data.slug === pg.bind;
      }));
      if (pl.limit) list = list.slice(0, pl.limit);
      const sec = out.pages[pg.path].sections;
      sec[to.section] = [...new Set([...(sec[to.section] || []), ...list.map(r => r.id)])];
    }
  }
  out.sitemap = [...new Set(out.sitemap)].sort();
  return out;
}
