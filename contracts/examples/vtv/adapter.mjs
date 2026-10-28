// VTV proof run: does the real content of the VTV preview fit its contract? READ ONLY on the VTV project.
//   node examples/vtv/adapter.mjs [--vtv "E:/Francine & Eli/proposals/vtv"]
// 1. builds a stand-in plan from VTV's own sitemap.xml (VTV has no approved SEO plan yet) and generates the contract
//    (written to examples/vtv/contract.json: structure only);
// 2. maps every listing, neighborhood, article and review in its _build/data.json to a contract row and validates it
//    as a draft and for publish;
// 3. places the rows (as if all were published) and counts where they land.
// Prints counts and rule codes only; no VTV content is written into this repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, slugify } from '../../from-plan.mjs';
import { validateContract, validateItem } from '../../validate.mjs';
import { place } from '../../place.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--vtv');
const VTV = i > 0 ? process.argv[i + 1] : 'E:/Francine & Eli/proposals/vtv';
const data = JSON.parse(readFileSync(join(VTV, '_build', 'data.json'), 'utf8'));
const paths = [...readFileSync(join(VTV, 'sitemap.xml'), 'utf8').matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)].map(m => m[1]);

// 1. stand-in plan
const hoods = new Map(data.neighborhoods.map(n => [n.slug, n]));
const itemRoute = /^\/(blog|properties)\/[^/]+\/$/;
const sitemap = { generatedAt: 'from sitemap.xml', pages: paths.filter(p => !itemRoute.test(p)).map(p => {
  const m = p.match(/^\/neighborhoods\/([^/]+)\/$/);
  if (m) return { path: p, kind: 'area', cluster: `c-hood-${m[1]}`, location: `${hoods.get(m[1]).name}, CA`, schema: ['WebPage'] };
  return { path: p, kind: p === '/' ? 'home' : 'page', schema: [] };
}) };
const entities = JSON.parse(readFileSync(join(HERE, 'entities.json'), 'utf8'));
const contract = generate({ sitemap, business: { industry: 'real-estate-agent' }, existing: null, entities, planDir: 'stand-in: proposals/vtv/sitemap.xml (no approved plan)' });
writeFileSync(join(HERE, 'contract.json'), JSON.stringify(contract, null, 1) + '\n');
const cp = validateContract(contract);
console.log(`contract: ${cp.length ? 'INVALID ' + cp.map(p => p.code + ' ' + p.path).join('; ') : 'VALID'}; ${contract.pages.length} pages; ` +
  `sitemap.xml has ${paths.length} URLs = ${contract.pages.length} pages + ${paths.filter(p => /^\/properties\/[^/]+\/$/.test(p)).length} listing pages + ${paths.filter(p => /^\/blog\/[^/]+\/$/.test(p)).length} article pages`);

// 2. rows
const num = s => { const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : undefined; };
const day = s => { const d = new Date(`${s} UTC`); return isNaN(d) ? undefined : d.toISOString().slice(0, 10); };
const money = s => num(s) === undefined ? undefined : { amount: num(s), currency: 'USD' };
const img = x => x && x.file ? { asset: x.file, alt: x.alt } : undefined;
const STATUS = { 'For Sale': 'active', 'Coming Soon': 'coming-soon', Sold: 'sold', Pending: 'pending' };
const TYPE = { Residential: 'single-family', Townhouse: 'townhouse', Condo: 'condo' };
const lot = s => { if (!s) return undefined; const n = num(s); return /acre/i.test(s) ? Math.round(n * 43560) : n; };
const rows = [];
const add = (collection, d) => { const r = { id: `vtv:${collection}:${rows.length + 1}`, collection, data: Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) }; rows.push(r); return r; };

const areaId = {};
for (const n of data.neighborhoods) areaId[n.name.toLowerCase()] = add('areas', {
  name: n.name, slug: n.slug, heroImage: img(n.hero),
  localFacts: Object.entries(n.census || {}).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => ({ label: k, value: String(v) })),
}).id;
for (const l of data.listings) add('listings', {
  street: l.street, slug: l.slug, address: { street: l.street, city: l.city, region: 'CA', postal: l.zip },
  geo: typeof l.lat === 'number' ? { lat: l.lat, lng: l.lng } : undefined, status: STATUS[l.status] || l.status,
  price: money(l.price), beds: num(l.beds), baths: num(l.baths), livingSqft: num(l.living), lotSqft: lot(l.lot),
  yearBuilt: num(l.yearBuilt), propertyType: TYPE[l.type] || 'other', description: l.description, mlsNumber: l.mls || undefined,
  features: (l.amenities || []).map(a => ({ name: String(a.group).slice(0, 80) })), style: l.style || undefined,
  photos: (l.photos || []).map((p, k) => ({ asset: p, alt: k === 0 ? l.cardAlt : undefined })),
  soldOn: l.dateSold ? day(l.dateSold) : undefined, area: areaId[String(l.city).toLowerCase()],
});
for (const b of data.blog) add('posts', {
  title: b.title, slug: b.slug, excerpt: b.description, cover: img(b.hero), body: b.body, publishedOn: day(b.date),
  seo: { title: b.title, description: b.description },
});
for (const t of data.testimonials) add('testimonials', { author: t.name, text: t.text, source: 'other' });

const tally = mode => {
  const by = {}, coll = {};
  for (const r of rows) {
    const errs = validateItem(contract, r.collection, r.data, { mode, exists: (to, id) => rows.some(x => x.id === id && x.collection === to) });
    coll[r.collection] ||= { rows: 0, clean: 0 };
    coll[r.collection].rows++;
    if (!errs.length) coll[r.collection].clean++;
    for (const e of errs) { const k = `${r.collection} ${e.code} ${e.path.replace(/\[\d+\]/g, '[]')}`; by[k] = (by[k] || 0) + 1; }
  }
  return { by, coll };
};
for (const mode of ['draft', 'publish']) {
  const { by, coll } = tally(mode);
  console.log(`\n${mode}: ` + Object.entries(coll).map(([c, x]) => `${c} ${x.clean}/${x.rows} clean`).join(', '));
  for (const [k, n] of Object.entries(by).sort()) console.log(`  ${String(n).padStart(4)} x ${k}`);
}

// 3. placement (every row treated as published)
const out = place(contract, rows);
const onHoodPages = contract.pages.filter(p => p.type === 'neighborhood').map(p => (out.pages[p.path].sections.listings || []).length);
console.log(`\nplacement: home featured ${(out.pages['/'].sections.featured || []).length}, /properties/ for-sale ${(out.pages['/properties/'].sections['for-sale'] || []).length} + sold ${(out.pages['/properties/'].sections.sold || []).length}, ` +
  `listings on neighborhood pages ${onHoodPages.reduce((a, b) => a + b, 0)} (pages with any: ${onHoodPages.filter(Boolean).length}/${onHoodPages.length}), ` +
  `listings with no neighborhood page ${rows.filter(r => r.collection === 'listings' && !r.data.area).length}, sitemap ${out.sitemap.length} URLs, schema ${out.schema.length}`);
const missing = paths.filter(p => !out.sitemap.includes(p));
console.log(`sitemap.xml URLs the contract build would NOT produce: ${missing.length}${missing.length ? ' ' + missing.join(' ') : ''}`);
