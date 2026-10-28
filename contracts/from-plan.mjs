// Generate a site contract from an approved SEO plan (the skill's .pewp folder) plus the plan's entity declaration.
//   node from-plan.mjs --plan <.pewp/approved dir> --entities <entities.json> --out <contract.json>
// What comes from the plan: the page list, page types (one per cluster family / page kind), which pages are bound to a
// place (the plan's "location"), the schema types per page type, the industry. What comes from the entity declaration:
// the collections the plan's pages need (type from types.json + extra fields), the approved design's sections per page
// type, the forms and the placement rules that need a business decision (e.g. "sold listings move to Recently sold").
// Derived without being declared: FAQ feeds, "item references the page's place -> it shows on that place's page",
// sitemap + schema for every collection with public pages. Exit 0 = contract written and valid, 1 = invalid, 2 = usage.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, routeRegex, isMain, CORE } from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES = JSON.parse(readFileSync(join(HERE, 'types.json'), 'utf8')).types;
export const slugify = s => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const DEFAULT_FORM = {
  label: 'Contact',
  fields: {
    name: { type: 'text', required: true, max: 120 },
    email: { type: 'email', required: true },
    phone: { type: 'phone' },
    message: { type: 'text', max: 2000 },
  },
  consent: { notice: 'form-consent' },
};

function defaultSections(form) {
  return [
    { id: 'intro', kind: 'fields', fields: { heading: { type: 'text', required: true, max: 90 }, lead: { type: 'text', max: 300 } } },
    { id: 'body', kind: 'fields', fields: { body: { type: 'richtext', required: true } } },
    { id: 'questions', kind: 'feed', accepts: 'faqs' },
    { id: 'contact', kind: 'form', form },
  ];
}

export function generate({ sitemap, business, existing, entities, planDir }) {
  const E = entities;
  const collections = {};
  for (const [id, d] of Object.entries(E.collections || {})) {
    const pack = TYPES[d.type];
    if (!pack) throw new Error(`collection ${id}: unknown type "${d.type}" (add it to types.json)`);
    const c = {
      label: d.label || id, kind: d.kind || 'collection', type: d.type, schemaType: pack.schemaType || undefined,
      titleField: d.titleField || pack.titleField, slugFrom: pack.slugFrom, statusField: pack.statusField,
      access: d.access || { member: 'none' }, ownerField: d.ownerField,
      fields: { ...pack.fields, ...(d.fields || {}) },
    };
    if (d.route) c.route = d.route;
    if (d.onDelete) c.onDelete = d.onDelete;
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    collections[id] = c;
  }
  for (const [id, fields] of Object.entries(E.extend || {})) {
    const { route, ...rest } = fields;
    collections[id] = { extend: true, fields: rest };
    if (route) collections[id].route = route;
  }

  // Pages: the plan's pages, then the kept existing pages, minus paths that a collection's item pages cover.
  const allCols = { ...CORE.collections, ...collections };
  const routes = Object.entries(allCols).map(([id, c]) => c.route && routeRegex(c.route)).filter(Boolean);
  const pages = [];
  const typeSchema = {};
  const boundTypes = new Set();
  const locColl = E.locations && E.locations.collection;
  const seeds = {};
  const bindOf = {};
  for (const p of sitemap.pages) {
    let type = (E.pageTypeOf || {})[p.path];
    let bind;
    const bp = (E.bindPages || {})[p.path];
    if (bp) {
      // a plan page that presents one collection item (e.g. a product guide bound to its product row)
      type = bp.type; bind = bp.key;
      (seeds[bp.collection] ||= new Set()).add(bp.key);
      boundTypes.add(type); bindOf[type] = bp.collection;
    } else if (p.location && locColl) {
      const city = p.location.split(',')[0].trim();
      bind = slugify(city);
      (seeds[locColl] ||= new Set()).add(bind);
      const family = p.cluster ? p.cluster.replace(new RegExp('-' + bind + '(-[a-z]{2})?$'), '') : p.kind;
      type ||= (E.families || {})[family] || family;
      boundTypes.add(type); bindOf[type] = locColl;
    }
    type ||= p.kind;
    pages.push(bind ? { path: p.path, type, bind } : { path: p.path, type });
    (typeSchema[type] ||= new Set());
    for (const s of p.schema || []) typeSchema[type].add(s);
  }
  for (const p of [...((existing && existing.pages) || []), ...(E.extraPages || [])]) {
    if (routes.some(rx => rx.test(p.path)) || pages.some(x => x.path === p.path)) continue;
    const type = (E.pageTypeOf || {})[p.path] || 'page';
    pages.push({ path: p.path, type });
    typeSchema[type] ||= new Set();
  }

  // Page types: the approved design's sections where declared, a plain default otherwise.
  const forms = { ...(E.forms || {}) };
  const pageTypes = {};
  for (const type of Object.keys(typeSchema)) {
    const d = (E.pageTypes || {})[type];
    const t = { label: (d && d.label) || type };
    if (boundTypes.has(type)) t.bind = bindOf[type];
    t.schema = [...typeSchema[type]];
    t.sections = d && d.sections ? d.sections : defaultSections(E.defaultForm || 'contact');
    t.sectionsFrom = d && d.sections ? (d.sectionsFrom || 'entities.json') : 'default (no approved design for this page type yet)';
    pageTypes[type] = t;
  }
  for (const t of Object.values(pageTypes)) for (const s of t.sections)
    if (s.kind === 'form' && !forms[s.form] && s.form === (E.defaultForm || 'contact')) forms[s.form] = DEFAULT_FORM;

  // Placements: declared first, then derived.
  const placements = [...(E.placements || [])];
  const fed = new Set(placements.filter(p => p.to && p.to.section).map(p => `${p.to.pageType || pages.find(x => x.path === p.to.page)?.type}#${p.to.section}`));
  const merged = { ...CORE.collections };
  for (const [id, c] of Object.entries(collections)) merged[id] = c.extend ? { ...merged[id], fields: { ...merged[id].fields, ...c.fields }, route: merged[id].route || c.route } : c;
  for (const [typeId, t] of Object.entries(pageTypes)) for (const s of t.sections) {
    if (s.kind !== 'feed' || fed.has(`${typeId}#${s.id}`)) continue;
    if (s.accepts === 'faqs') { placements.push({ id: `derived:faqs>${typeId}`, collection: 'faqs', when: { topic: [typeId, 'all'] }, to: { pageType: typeId, section: s.id } }); continue; }
    const c = merged[s.accepts];
    const ref = t.bind && c && Object.entries(c.fields).find(([, f]) => f.type === 'reference' && f.to === t.bind);
    if (ref) placements.push({ id: `derived:${s.accepts}>${typeId}`, collection: s.accepts, to: { pageType: typeId, section: s.id, match: ref[0] } });
    else if (t.bind === s.accepts) continue; // a place page listing places: left for the design to declare
  }
  for (const [id, c] of Object.entries(merged)) {
    if (!c.route) continue;
    if (!placements.some(p => p.collection === id && p.to.sitemap)) placements.push({ id: `derived:${id}>sitemap`, collection: id, to: { sitemap: true } });
    if (c.schemaType && !placements.some(p => p.collection === id && p.to.schema)) placements.push({ id: `derived:${id}>schema`, collection: id, to: { schema: c.schemaType } });
  }

  const hash = createHash('sha256').update(JSON.stringify(sitemap)).digest('hex').slice(0, 16);
  return {
    contractVersion: 1,
    core: CORE.coreVersion,
    site: {
      workspace: E.workspace, industry: business && (business.industry || business.kind),
      generatedFrom: { plan: planDir, sitemapSha256: hash, planGeneratedAt: sitemap.generatedAt, entities: E.source || 'entities.json' },
    },
    collections, pageTypes, pages, forms, placements,
    clientWording: E.clientWording || [],
    seeds: Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, [...v].sort()])),
  };
}

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
  return o;
}

if (isMain(import.meta.url)) {
  const o = args();
  if (!o.plan || !o.entities || !o.out) { console.error('usage: node from-plan.mjs --plan <.pewp/approved> --entities <entities.json> --out <contract.json>'); process.exit(2); }
  const read = p => JSON.parse(readFileSync(p, 'utf8'));
  const planDir = existsSync(join(o.plan, 'plan', 'sitemap.json')) ? join(o.plan, 'plan') : o.plan;
  const sitemap = read(join(planDir, 'sitemap.json'));
  const bizPath = [join(o.plan, 'business.json'), join(o.plan, '..', 'business.json')].find(existsSync);
  const exPath = join(planDir, 'existing-pages.json');
  const contract = generate({
    sitemap, business: bizPath && read(bizPath), existing: existsSync(exPath) ? read(exPath) : null,
    entities: read(o.entities), planDir: o.plan.replace(/\\/g, '/'),
  });
  writeFileSync(o.out, JSON.stringify(contract, null, 1) + '\n');
  const problems = validateContract(contract);
  const byType = {};
  for (const p of contract.pages) byType[p.type] = (byType[p.type] || 0) + 1;
  console.log(`wrote ${o.out}: ${contract.pages.length} pages ${JSON.stringify(byType)}, ${Object.keys(contract.collections).length} site collections, ${contract.placements.length} placements`);
  if (problems.length) { for (const p of problems) console.log(`${p.code}  ${p.path}  ${p.msg}`); console.log(`INVALID: ${problems.length} problem(s)`); process.exit(1); }
  console.log('VALID');
}
