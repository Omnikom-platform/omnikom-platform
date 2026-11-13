// Step 2 of the build: place(contract, rows) and what it means for this site. Only the contract pages that HAVE a row in the `pages`
// collection are built and enter the sitemap (the W2.2 rule: a page nobody has published is not on the site).
import { place, publicData } from '../../contracts/place.mjs';
import { mergeCore } from '../../contracts/validate.mjs';

const routeOf = (route, data) => route.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, f) => data[f]);

// What a template may see of one row: publicData (internal fields and fields whose visibleWhen is not met are gone), plus `_id` and,
// when the collection has public pages, `_path` (the item page address, for links).
export function entryOf(contract, row) {
  const c = mergeCore(contract)[row.collection];
  const entry = { ...publicData(contract, row.collection, row.data), _id: row.id };
  if (c && c.route) entry._path = routeOf(c.route, row.data);
  return entry;
}

export function resolveFeed(contract, byId, ids) {
  return ids.map((id) => entryOf(contract, byId.get(id)));
}

// rows: [{ id, collection, data }]. Returns { placed, built, skipped, items, sitemap }:
//   built    [{ path, type, bind, row }]            contract pages that have a published page row, in contract order
//   skipped  [path]                                  contract pages without one
//   items    [{ path, collection, id, row }]         the item pages of routed collections
//   sitemap  [path]                                  place()'s sitemap minus the pages that are not built
export function planSite(contract, rows) {
  const placed = place(contract, rows);
  const pageRows = new Map();
  for (const r of rows) if (r.collection === 'pages' && !pageRows.has(r.data.path)) pageRows.set(r.data.path, r);
  const built = [], skipped = [];
  for (const pg of contract.pages) {
    const row = pageRows.get(pg.path);
    if (row) built.push({ path: pg.path, type: pg.type, bind: pg.bind, row }); else skipped.push(pg.path);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = placed.itemPages.map((i) => ({ ...i, row: byId.get(i.id) }));
  const gone = new Set(skipped);
  const sitemap = placed.sitemap.filter((p) => !gone.has(p));
  return { placed, built, skipped, items, sitemap };
}

// Book row B12-E: the addresses an older deployment may still answer from Cloudflare's edge. exp.removed is [{ id, collection, version, data, left_at }] (migration 47, service.gone_rows):
// the rows that were on the site in a deployment of the last 7 days and are not in this build, each as the version that was live. Only a routed collection has an address, the same
// one entryOf gives its links. An address this build serves again (a live item with the same address) is never listed; the list has no repeat and is sorted. An item with no value for a
// field its route is made of (routeOf would write "undefined" or nothing) has no address and is skipped; `needs` reads the route with routeOf's own pattern (routeFields in contracts/validate.mjs is not exported).
export function goneAddresses(exp) {
  const cols = mergeCore(exp.contract), routed = (c) => !!(cols[c] && cols[c].route);
  const needs = (route) => [...route.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
  const live = new Set(exp.rows.filter((r) => routed(r.collection)).map((r) => entryOf(exp.contract, r)._path));
  const gone = new Set();
  for (const g of Array.isArray(exp.removed) ? exp.removed : []) {
    if (!g || typeof g.collection !== 'string' || !routed(g.collection) || !g.data || typeof g.data !== 'object') continue;
    if (needs(cols[g.collection].route).some((f) => !g.data[f])) continue;
    const path = entryOf(exp.contract, { collection: g.collection, data: g.data })._path;
    if (typeof path === 'string' && path.startsWith('/') && !live.has(path)) gone.add(path);
  }
  return [...gone].sort();
}
