// The content contract validator. Two jobs:
//   validateContract(contract)            -> is the site contract itself well formed (structure, references, placements)?
//   validateItem(contract, coll, data, o) -> is one content row valid for its collection (draft or publish)?
// Every problem is { code, path, msg }. Codes are listed in README.md; each one has a test that watches it fail.
// CLI: node validate.mjs <site-contract.json>   (exit 0 = valid, 1 = errors printed, 2 = usage)
import { readFileSync, realpathSync } from 'node:fs';
import CORE_JSON from './core.json' with { type: 'json' };
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// JSON module import (not a runtime file read) so bundlers (Vite, the Supabase functions bundler) include it.
export const CORE = CORE_JSON;

export const FIELD_TYPES = ['text', 'richtext', 'slug', 'number', 'money', 'boolean', 'date', 'datetime', 'enum', 'email',
  'phone', 'url', 'image', 'gallery', 'file', 'reference', 'address', 'geo', 'list', 'group', 'seo', 'sections'];
const KINDS = ['collection', 'singleton', 'inbox'];
const SECTION_KINDS = ['fields', 'feed', 'form', 'notice'];
const MEMBER_ACCESS = ['own', 'all', 'none'];
const PLACEHOLDER = /\[client to|\bTODO\b|lorem ipsum|\bTBD\b/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const err = (out, code, path, msg) => { out.push({ code, path, msg }); };

// Core collections merged with the site's own; a site may extend a core collection with new fields only.
export function mergeCore(contract, problems = []) {
  const merged = {};
  for (const [id, c] of Object.entries(CORE.collections)) merged[id] = { ...c, fields: { ...c.fields }, core: true };
  for (const [id, c] of Object.entries(contract.collections || {})) {
    if (merged[id] && c.core) { merged[id] = { ...c, fields: { ...c.fields } }; continue; }   // already resolved: keep its extensions (idempotent)
    if (merged[id]) {
      if (!c.extend) { err(problems, 'C-CORE', `collections.${id}`, `"${id}" is a core collection: use "extend": true and add fields only`); continue; }
      for (const [f, def] of Object.entries(c.fields || {})) {
        if (merged[id].fields[f]) err(problems, 'C-CORE', `collections.${id}.fields.${f}`, `core field "${f}" cannot be redefined`);
        else merged[id].fields[f] = def;
      }
      if (c.onDelete) merged[id].onDelete = c.onDelete;
      if (c.route) {
        if (merged[id].route) err(problems, 'C-CORE', `collections.${id}.route`, `core route "${merged[id].route}" cannot be redefined`);
        else merged[id].route = c.route;
      }
    } else {
      if (c.extend) err(problems, 'C-CORE', `collections.${id}`, `"extend" used on "${id}", which is not a core collection`);
      merged[id] = { ...c };
    }
  }
  return merged;
}

function routeFields(route) { return [...String(route).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]); }
export function routeRegex(route) {
  const esc = String(route).split(/\{[a-zA-Z0-9_]+\}/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^' + esc.join('[a-z0-9-]+') + '$');
}

function checkFields(out, path, fields, collections, { allowEmpty = false } = {}) {
  if (!fields || typeof fields !== 'object' || (!allowEmpty && !Object.keys(fields).length)) {
    err(out, 'C-FIELDS', path, 'fields must be a non-empty object'); return;
  }
  for (const [name, f] of Object.entries(fields)) {
    const p = `${path}.${name}`;
    if (!f || !FIELD_TYPES.includes(f.type)) { err(out, 'C-FIELD-TYPE', p, `unknown field type "${f && f.type}"`); continue; }
    if (f.type === 'enum' && (!Array.isArray(f.options) || !f.options.length || new Set(f.options).size !== f.options.length))
      err(out, 'C-ENUM', p, 'enum needs a non-empty list of unique options');
    if (f.type === 'reference' && !collections[f.to]) err(out, 'C-REF', p, `reference to unknown collection "${f.to}"`);
    if ((f.type === 'list' || f.type === 'group') && !f.open) checkFields(out, `${p}.of`, f.of, collections);
    if (f.locked !== undefined && !(f.locked && typeof f.locked.reason === 'string' && f.locked.reason.trim()))
      err(out, 'C-LOCK', p, 'a locked field must say why ({ "reason": "..." })');
    if (typeof f.min === 'number' && typeof f.max === 'number' && f.min > f.max) err(out, 'C-RANGE', p, 'min is greater than max');
    if (f.media && !['image', 'gallery', 'file'].includes(f.type)) err(out, 'C-MEDIA', p, 'media rules only apply to image, gallery or file fields');
    for (const [k, vals] of Object.entries(f.visibleWhen || {})) {
      const g = fields[k];
      if (!g || !['boolean', 'enum'].includes(g.type) || !Array.isArray(vals) || !vals.length
        || vals.some(v => g.type === 'boolean' ? typeof v !== 'boolean' : !g.options.includes(v)))
        err(out, 'C-VISIBLE', p, `visibleWhen.${k} must name a sibling boolean or enum field and valid values`);
    }
  }
}

// Lead forms (D2, A24): what a lead form collects, typed, and how the CRM shows it. name, email and phone go to the lead's own
// columns; every other key is an industry field kept in leads.answers under that key. service.capture_lead and
// service.lead_set_fields read the same declaration from the active contract, so each rule here is one the database holds too.
// "enum" is a select (one value), "choice" is radio buttons, or tick boxes with "multi": true; "phone" is a tel field,
// "boolean" a tick; "reference" picks a row of a site collection (stored as its slug).
export const FORM_FIELD_TYPES = ['text', 'email', 'phone', 'number', 'enum', 'choice', 'date', 'boolean', 'reference'];
export const CORE_LEAD_FIELDS = { name: 'text', email: 'email', phone: 'phone' };
// Names the lead endpoint and the CRM already use (factory/worker/lead-endpoint.mjs TOP, the consent ticks, the lead's own columns).
const RESERVED_FORM_KEYS = new Set(['form', 'flow', 'page', 'cta', 'assignee', 'consentText', 'hp', 'idempotencyKey', 'consent',
  'marketingConsent', 'marketingConsentText', 'smsConsent', 'status', 'owner', 'id', 'created_at', 'updated_at', 'workspace', 'site']);
const FORM_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const FORM_FLAGS = ['required', 'column', 'editable', 'multi'];

function checkFormFields(out, path, fields, collections) {
  if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) { err(out, 'C-FIELDS', path, 'fields must be a non-empty object'); return; }
  for (const [name, f] of Object.entries(fields)) {
    const p = `${path}.${name}`;
    if (!f || !(FIELD_TYPES.includes(f.type) || FORM_FIELD_TYPES.includes(f.type))) { err(out, 'C-FIELD-TYPE', p, `unknown field type "${f && f.type}"`); continue; }
    if (!FORM_FIELD_TYPES.includes(f.type)) { err(out, 'C-FORM-TYPE', p, `a lead form cannot collect a "${f.type}" field (it can: ${FORM_FIELD_TYPES.join(', ')})`); continue; }
    if (!FORM_KEY.test(name) || RESERVED_FORM_KEYS.has(name))
      err(out, 'C-FORM-KEY', p, `"${name}" cannot name a form field (letters, digits and _, up to 40, not a name the lead already uses)`);
    if (CORE_LEAD_FIELDS[name] && f.type !== CORE_LEAD_FIELDS[name])
      err(out, 'C-FORM-CORE', p, `"${name}" is the lead's own column: its type must be "${CORE_LEAD_FIELDS[name]}"`);
    if ((f.type === 'enum' || f.type === 'choice') && (!Array.isArray(f.options) || !f.options.length
      || new Set(f.options).size !== f.options.length || f.options.some(o => typeof o !== 'string' || !o.trim() || o.length > 120)))
      err(out, 'C-ENUM', p, `${f.type} needs a non-empty list of unique options`);
    if (f.type === 'reference' && !collections[f.to]) err(out, 'C-REF', p, `reference to unknown collection "${f.to}"`);
    for (const k of ['min', 'max']) if (f[k] !== undefined && !(typeof f[k] === 'number' && Number.isFinite(f[k])))
      err(out, 'C-RANGE', p, `${k} must be a number`);
    if (typeof f.min === 'number' && typeof f.max === 'number' && f.min > f.max) err(out, 'C-RANGE', p, 'min is greater than max');
    for (const k of FORM_FLAGS) if (f[k] !== undefined && typeof f[k] !== 'boolean') err(out, 'C-FORM-FLAG', p, `${k} must be true or false`);
    if (f.multi !== undefined && f.type !== 'choice') err(out, 'C-FORM-FLAG', p, '"multi" applies to a choice field only');
    if (f.label !== undefined && !(typeof f.label === 'string' && f.label.trim() && f.label.length <= 80))
      err(out, 'C-FORM-LABEL', p, 'label must be text of 1 to 80 characters');
  }
}

// The same key in two forms is one CRM column, so it needs one type and the same flags in both.
const columnSig = d => `${d.type}${d.multi === true ? ' (multi)' : ''}${d.column === false ? ', not a column' : ''}${d.editable === false ? ', not editable' : ''}`;
function checkFormKeysAgree(out, forms) {
  const seen = {};
  for (const [id, f] of Object.entries(forms)) for (const [k, d] of Object.entries((f && f.fields) || {})) {
    if (!d || !FORM_FIELD_TYPES.includes(d.type)) continue;
    const sig = columnSig(d);
    if (!seen[k]) seen[k] = { sig, form: id };
    else if (seen[k].sig !== sig) err(out, 'C-FORM-SAME-KEY', `forms.${id}.fields.${k}`, `"${k}" is ${sig} here and ${seen[k].sig} in form "${seen[k].form}": one CRM column has one type`);
  }
}

// The CRM's industry columns: every form field key that is not one of the lead's own columns, in form order, typed, with the
// options of every form that declares it. column/editable default to true. The database builds the same list (M14).
export function leadColumns(contract) {
  const cols = {};
  for (const f of Object.values((contract && contract.forms) || {})) for (const [k, d] of Object.entries((f && f.fields) || {})) {
    if (CORE_LEAD_FIELDS[k] || !d || !FORM_FIELD_TYPES.includes(d.type)) continue;
    const c = cols[k] ||= { key: k, type: d.type, label: d.label || k, multi: d.multi === true, column: d.column !== false, editable: d.editable !== false, options: [] };
    for (const o of d.options || []) if (!c.options.includes(o)) c.options.push(o);
    if (d.type === 'number') { if (c.min === undefined && typeof d.min === 'number') c.min = d.min; if (c.max === undefined && typeof d.max === 'number') c.max = d.max; }
    if (d.type === 'reference') c.to = d.to;
  }
  return Object.values(cols);
}

export function validateContract(contract) {
  const out = [];
  if (!contract || contract.contractVersion !== 1 || typeof contract.collections !== 'object' || typeof contract.pageTypes !== 'object'
    || !Array.isArray(contract.pages) || typeof contract.forms !== 'object' || !Array.isArray(contract.placements)) {
    err(out, 'C-SHAPE', '', 'needs contractVersion 1, collections, pageTypes, pages[], forms, placements[]');
    return out;
  }
  const cols = mergeCore(contract, out);

  for (const [id, c] of Object.entries(cols)) {
    const p = `collections.${id}`;
    if (!KINDS.includes(c.kind)) err(out, 'C-KIND', p, `kind must be one of ${KINDS.join(', ')}`);
    checkFields(out, `${p}.fields`, c.fields, cols);
    const fields = c.fields || {};
    if (c.titleField && !fields[c.titleField]) err(out, 'C-TITLE', p, `titleField "${c.titleField}" is not a field`);
    if (c.slugFrom && !fields[c.slugFrom]) err(out, 'C-TITLE', p, `slugFrom "${c.slugFrom}" is not a field`);
    if (c.route) for (const rf of routeFields(c.route)) if (!fields[rf] || fields[rf].type !== 'slug')
      err(out, 'C-ROUTE', p, `route "${c.route}" uses "{${rf}}", which must be a slug field`);
    if (c.sampleField && (!fields[c.sampleField] || fields[c.sampleField].type !== 'boolean'))
      err(out, 'C-SAMPLE', p, `sampleField "${c.sampleField}" must be a boolean field`);
    if (c.statusField && (!fields[c.statusField] || fields[c.statusField].type !== 'enum'))
      err(out, 'C-STATUS', p, `statusField "${c.statusField}" must be an enum field`);
    const member = c.access && c.access.member;
    if (!MEMBER_ACCESS.includes(member)) err(out, 'C-ACCESS', p, `access.member must be one of ${MEMBER_ACCESS.join(', ')}`);
    if (member === 'own') {
      const of = c.ownerField;
      if (!(of === 'self' && id === 'team') && !(fields[of] && fields[of].type === 'reference' && fields[of].to === 'team'))
        err(out, 'C-OWNER', p, 'member access "own" needs ownerField: a reference to team (or "self" on team)');
    }
    if (c.onDelete) {
      const via = c.onDelete.redirectToPageOf;
      if (!fields[via] || fields[via].type !== 'reference') err(out, 'C-ONDELETE', p, 'onDelete.redirectToPageOf must be a reference field');
      if (!c.route) err(out, 'C-ONDELETE', p, 'onDelete redirect needs the collection to have a route');
      const t = contract.pageTypes[c.onDelete.pageType];
      if (!t || !fields[via] || t.bind !== fields[via].to) err(out, 'C-ONDELETE', p, `onDelete.pageType must be a page type bound to ${fields[via] ? fields[via].to : '?'}`);
    }
  }

  // Page types and their sections
  for (const [id, t] of Object.entries(contract.pageTypes)) {
    const p = `pageTypes.${id}`;
    if (t.bind && !cols[t.bind]) err(out, 'C-BIND', p, `bind to unknown collection "${t.bind}"`);
    if (!Array.isArray(t.sections) || !t.sections.length) { err(out, 'C-SECTION', p, 'needs at least one section'); continue; }
    const seen = new Set();
    for (const s of t.sections) {
      const sp = `${p}.sections.${s.id}`;
      if (!s.id || seen.has(s.id)) err(out, 'C-SECTION', sp, 'section ids must be present and unique');
      seen.add(s.id);
      if (!SECTION_KINDS.includes(s.kind)) { err(out, 'C-SECTION', sp, `section kind must be one of ${SECTION_KINDS.join(', ')}`); continue; }
      if (s.kind === 'fields') checkFields(out, `${sp}.fields`, s.fields, cols);
      if (s.kind === 'feed' && !cols[s.accepts]) err(out, 'C-FEED', sp, `feed accepts unknown collection "${s.accepts}"`);
      if (s.kind === 'form' && !contract.forms[s.form]) err(out, 'C-FORM-REF', sp, `unknown form "${s.form}"`);
      if (s.kind === 'notice' && !(typeof s.notice === 'string' && SLUG.test(s.notice))) err(out, 'C-NOTICE', sp, 'notice section needs the slug of a notices row');
    }
  }

  // Page list (from the approved SEO plan)
  const paths = new Set();
  const routed = Object.entries(cols).filter(([, c]) => c.route).map(([id, c]) => [id, routeRegex(c.route)]);
  for (const [i, pg] of contract.pages.entries()) {
    const p = `pages[${i}]`;
    const t = contract.pageTypes[pg.type];
    if (!t) { err(out, 'C-PAGE-TYPE', p, `unknown page type "${pg.type}"`); continue; }
    if (typeof pg.path !== 'string' || !pg.path.startsWith('/')) err(out, 'C-PATH', p, 'path must start with /');
    if (paths.has(pg.path)) err(out, 'C-PATH', p, `duplicate path "${pg.path}"`);
    paths.add(pg.path);
    for (const [cid, rx] of routed) if (rx.test(pg.path)) err(out, 'C-PATH', p, `path "${pg.path}" collides with the ${cid} route`);
    if (t.bind && !(typeof pg.bind === 'string' && SLUG.test(pg.bind))) err(out, 'C-PAGE-BIND', p, `page type "${pg.type}" is bound to ${t.bind}: page needs bind (a slug)`);
    if (!t.bind && pg.bind !== undefined) err(out, 'C-PAGE-BIND', p, `page type "${pg.type}" is not bound; remove bind`);
  }

  // Forms
  for (const [id, f] of Object.entries(contract.forms)) {
    const p = `forms.${id}`;
    checkFormFields(out, `${p}.fields`, f.fields, cols);
    const personal =Object.values(f.fields || {}).some(x => x && ['email', 'phone'].includes(x.type));
    if (personal && !(f.consent && typeof f.consent.notice === 'string' && SLUG.test(f.consent.notice)))
      err(out, 'C-CONSENT', p, 'a form that asks for email or phone needs consent.notice (slug of a locked notices row)');
    for (const k of Object.keys(f.crm || {})) if (!(f.fields || {})[k]) err(out, 'C-CRM', p, `crm map names unknown form field "${k}"`);
  }
  checkFormKeysAgree(out, contract.forms);

  // Placements: where each published item goes
  const fed = new Set();
  for (const [i, pl] of contract.placements.entries()) {
    const p = `placements[${i}]${pl.id ? ' ' + pl.id : ''}`;
    const c = cols[pl.collection];
    if (!c) { err(out, 'C-PLACE-COLL', p, `unknown collection "${pl.collection}"`); continue; }
    for (const [f, vals] of Object.entries(pl.when || {})) {
      const fd = c.fields[f];
      if (!fd) { err(out, 'C-PLACE-WHEN', p, `when names unknown field "${f}"`); continue; }
      if (!Array.isArray(vals) || !vals.length) err(out, 'C-PLACE-WHEN', p, `when.${f} must be a non-empty list`);
      else if (fd.type === 'enum') for (const v of vals) if (!fd.options.includes(v)) err(out, 'C-PLACE-WHEN', p, `"${v}" is not an option of ${f}`);
    }
    const to = pl.to || {};
    const targets = ['page', 'pageType', 'sitemap', 'schema'].filter(k => to[k] !== undefined);
    if (targets.length !== 1) { err(out, 'C-PLACE-TARGET', p, 'to needs exactly one of page, pageType, sitemap, schema'); continue; }
    if (to.sitemap || to.schema) {
      if (!c.route) err(out, 'C-PLACE-ROUTE', p, `${pl.collection} has no route, so it cannot be in the sitemap or carry page schema`);
      if (to.schema && to.schema !== c.schemaType) err(out, 'C-PLACE-ROUTE', p, `schema "${to.schema}" differs from the collection's schemaType "${c.schemaType}"`);
      continue;
    }
    let typeId = to.pageType;
    if (to.page !== undefined) {
      const pg = contract.pages.find(x => x.path === to.page);
      if (!pg) { err(out, 'C-PLACE-TARGET', p, `no page "${to.page}" in the page list`); continue; }
      typeId = pg.type;
    }
    const t = contract.pageTypes[typeId];
    if (!t) { err(out, 'C-PLACE-TARGET', p, `unknown page type "${typeId}"`); continue; }
    const s = (t.sections || []).find(x => x.id === to.section);
    if (!s || s.kind !== 'feed' || s.accepts !== pl.collection) {
      err(out, 'C-PLACE-SECTION', p, `section "${to.section}" of ${typeId} is not a feed accepting ${pl.collection}`); continue;
    }
    if (to.match !== undefined) {
      const mf = c.fields[to.match];
      if (!t.bind || !mf || mf.type !== 'reference' || mf.to !== t.bind)
        err(out, 'C-PLACE-MATCH', p, `match "${to.match}" must be a reference from ${pl.collection} to ${t.bind || '(page type not bound)'}`);
    }
    fed.add(`${typeId}#${s.id}`);
  }
  for (const [id, t] of Object.entries(contract.pageTypes)) for (const s of t.sections || [])
    if (s.kind === 'feed' && !fed.has(`${id}#${s.id}`)) err(out, 'C-FEED-ORPHAN', `pageTypes.${id}.sections.${s.id}`, 'feed section has no placement, it would always be empty');
  for (const [id, c] of Object.entries(cols)) if (c.route && !contract.placements.some(pl => pl.collection === id && pl.to && pl.to.sitemap))
    err(out, 'C-SITEMAP', `collections.${id}`, `${id} has public pages (route) but no sitemap placement`);

  // Gate waivers: a kept live URL stands in for a path a gate rule expects (e.g. /privacy_policy for RE-DISC-001's /privacy/).
  // Each names the rule, the kept page (must be in the page list), the paths it stands in for, why, and who approved it.
  if (contract.gateWaivers !== undefined && !Array.isArray(contract.gateWaivers)) err(out, 'C-WAIVER', 'gateWaivers', 'must be a list');
  for (const [i, w] of (contract.gateWaivers || []).entries()) {
    const p = `gateWaivers[${i}]`;
    const okRule = w && typeof w.rule === 'string' && /^[A-Z]{2,}(-[A-Z]+)?-\d{3}$/.test(w.rule);
    const okPath = w && contract.pages.some(pg => pg.path === w.path);
    const okExpects = w && Array.isArray(w.expects) && w.expects.length && w.expects.every(x => typeof x === 'string' && x.startsWith('/'));
    const okWhy = w && typeof w.reason === 'string' && w.reason.trim() && typeof w.approvedBy === 'string' && w.approvedBy.trim();
    if (!(okRule && okPath && okExpects && okWhy)) err(out, 'C-WAIVER', p, 'needs rule (e.g. RE-DISC-001), path (a page in the list), expects [paths], reason, approvedBy');
  }

  // Client wording still to confirm: each entry must point at something that exists in this contract (or a notices slug).
  if (contract.clientWording !== undefined && !Array.isArray(contract.clientWording)) err(out, 'C-WORDING', 'clientWording', 'must be a list');
  for (const [i, w] of (contract.clientWording || []).entries()) {
    const p = `clientWording[${i}]`;
    const where = String((w && w.where) || '');
    const notice = where.match(/^notices:([a-z0-9-]+)$/);
    const found = notice ? true : where.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), { ...contract, collections: cols });
    if (!where || found === undefined || !(typeof w.status === 'string' && w.status.trim())) err(out, 'C-WORDING', p, `"${where}" is not in this contract, or status is missing`);
  }
  return out;
}

// ---- content rows ----
const isStr = v => typeof v === 'string';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const checks = {
  text: v => isStr(v), richtext: v => isStr(v), slug: v => isStr(v), boolean: v => typeof v === 'boolean',
  number: v => typeof v === 'number' && Number.isFinite(v), enum: v => isStr(v),
  email: v => isStr(v) && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v), phone: v => isStr(v) && /^\+?[0-9 ().-]{7,20}$/.test(v),
  url: v => isStr(v) && /^https?:\/\/\S+$/.test(v), date: v => isStr(v) && DATE.test(v) && !isNaN(Date.parse(v)),
  datetime: v => isStr(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && !isNaN(Date.parse(v)),
  money: v => v && typeof v.amount === 'number' && v.amount >= 0 && /^[A-Z]{3}$/.test(v.currency || ''),
  geo: v => v && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180, address: v => v && isStr(v.city) && v.city.length > 0,
  image: v => v && isStr(v.asset), file: v => v && isStr(v.asset), gallery: v => Array.isArray(v),
  reference: v => isStr(v) || Array.isArray(v), list: v => Array.isArray(v), group: v => v && typeof v === 'object' && !Array.isArray(v),
  seo: v => v && typeof v === 'object', sections: v => v && typeof v === 'object',
};
const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

// o.media(asset) -> { width, exifStripped, rightsConfirmed } from the platform's media record. When it is given (the save and
// publish functions always give it), those facts come from the record, never from the row's own JSON (dry run 3.3).
function checkImage(out, p, img, f, publish, o = {}) {
  const m = f.media || {};
  if (typeof o.media === 'function') {
    const rec = o.media(img.asset);
    if (!rec) { err(out, 'I-MEDIA-UNKNOWN', p, `no uploaded file "${img.asset}" in this workspace`); return; }
    img = { ...img, width: rec.width, exifStripped: rec.exifStripped, rightsConfirmed: rec.rightsConfirmed };
    if (rec.processed === false) img.exifStripped = false;   // not processed yet = not proven stripped (N12)
  }
  if (publish && !(isStr(img.alt) && img.alt.trim())) err(out, 'I-ALT', p, 'image needs alt text');
  const minWidth = o.sample ? 0 : m.minWidth;   // sample/placeholder items (preview only) may use smaller photos
  if (minWidth && typeof img.width === 'number' && img.width < minWidth) err(out, 'I-MEDIA-SIZE', p, `image is ${img.width}px wide; needs ${minWidth}px`);
  if (publish && minWidth && typeof img.width !== 'number') err(out, 'I-MEDIA-SIZE', p, 'image width unknown (upload pipeline sets it)');
  if (publish && m.rightsConfirm && img.rightsConfirmed !== true) err(out, 'I-RIGHTS', p, 'tick "we have the right to publish this photo"');
  if (publish && img.exifStripped !== true) err(out, 'I-EXIF', p, 'location/EXIF data not stripped by the upload pipeline');
}

function checkValue(out, p, v, f, o) {
  const publish = o.mode === 'publish';
  if (empty(v)) { if (publish && f.required) err(out, 'I-REQUIRED', p, 'required'); return; }
  if (f.sourced) {
    if (!(v && typeof v === 'object' && 'value' in v && isStr(v.source) && v.source && isStr(v.date) && DATE.test(v.date))) {
      err(out, 'I-SOURCE', p, 'a client-facing fact needs { value, source, date }'); return;
    }
    v = v.value;
  }
  if (!checks[f.type](v)) { err(out, 'I-TYPE', p, `not a valid ${f.type}`); return; }
  if (f.type === 'reference' && Array.isArray(v) && !f.multiple) { err(out, 'I-TYPE', p, 'one reference expected'); return; }
  if (isStr(v)) {
    if (typeof f.max === 'number' && ['text', 'richtext'].includes(f.type) && v.length > f.max) err(out, 'I-MAX', p, `longer than ${f.max} characters`);
    if (publish && PLACEHOLDER.test(v)) err(out, 'I-PLACEHOLDER', p, 'placeholder text cannot be published');
  }
  if (f.type === 'enum' && !f.options.includes(v)) err(out, 'I-ENUM', p, `"${v}" is not one of ${f.options.join(', ')}`);
  if (f.type === 'slug' && !SLUG.test(v)) err(out, 'I-SLUG', p, 'lowercase words joined by single hyphens');
  if (f.type === 'number') {
    if (f.integer && !Number.isInteger(v)) err(out, 'I-TYPE', p, 'whole number expected');
    if (typeof f.min === 'number' && v < f.min) err(out, 'I-MIN', p, `below ${f.min}`);
    if (typeof f.max === 'number' && v > f.max) err(out, 'I-MAX', p, `above ${f.max}`);
  }
  if (['list', 'gallery'].includes(f.type)) {
    if (typeof f.min === 'number' && v.length < f.min && publish) err(out, 'I-MIN', p, `needs at least ${f.min}`);
    if (typeof f.max === 'number' && v.length > f.max) err(out, 'I-MAX', p, `at most ${f.max}`);
  }
  if (f.type === 'image') checkImage(out, p, v, f, publish, o);
  if (f.type === 'gallery') v.forEach((img, i) => {
    if (!checks.image(img)) err(out, 'I-TYPE', `${p}[${i}]`, 'not a valid image'); else checkImage(out, `${p}[${i}]`, img, f, publish, o);
  });
  if (f.type === 'reference' && o.exists) for (const id of [].concat(v)) if (!o.exists(f.to, id)) err(out, 'I-REF', p, `no ${f.to} item "${id}" in this workspace`);
  if (f.type === 'list' && !f.open) v.forEach((row, i) => checkObject(out, `${p}[${i}]`, row, f.of, o));
  if (f.type === 'group' && !f.open) checkObject(out, p, v, f.of, o);
  if (f.type === 'seo') {
    if (publish && !(isStr(v.title) && v.title.trim())) err(out, 'I-REQUIRED', `${p}.title`, 'SEO title required');
    if (publish && !(isStr(v.description) && v.description.trim())) err(out, 'I-REQUIRED', `${p}.description`, 'SEO description required');
    if (isStr(v.title) && v.title.length > 60) err(out, 'I-MAX', `${p}.title`, 'SEO title over 60 characters');
    if (isStr(v.description) && v.description.length > 160) err(out, 'I-MAX', `${p}.description`, 'SEO description over 160 characters');
    for (const s of [v.title, v.description]) if (publish && isStr(s) && PLACEHOLDER.test(s)) err(out, 'I-PLACEHOLDER', p, 'placeholder text cannot be published');
  }
  if (f.type === 'sections') {
    const t = o.contract && o.contract.pageTypes[o.pageType];
    if (!t) { err(out, 'I-TYPE', p, `unknown page type "${o.pageType}"`); return; }
    for (const [sid, sv] of Object.entries(v)) {
      const s = t.sections.find(x => x.id === sid);
      if (!s || s.kind !== 'fields') { err(out, 'I-UNKNOWN', `${p}.${sid}`, `page type ${o.pageType} has no editable section "${sid}"`); continue; }
      checkObject(out, `${p}.${sid}`, sv, s.fields, o);
    }
    if (publish) for (const s of t.sections) if (s.kind === 'fields' && !v[s.id] && Object.values(s.fields).some(x => x.required))
      err(out, 'I-REQUIRED', `${p}.${s.id}`, 'section has required fields');
  }
}

function checkObject(out, path, data, fields, o) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) { err(out, 'I-TYPE', path, 'object expected'); return; }
  for (const k of Object.keys(data)) if (!fields[k]) err(out, 'I-UNKNOWN', `${path}.${k}`, 'field not in the contract');
  for (const [k, f] of Object.entries(fields)) checkValue(out, path ? `${path}.${k}` : k, data[k], f, o);
}

// o: { mode: 'draft'|'publish', exists?(collection, id) -> bool }
export function validateItem(contract, collection, data, o = {}) {
  const out = [];
  const cols = mergeCore(contract);
  const c = cols[collection];
  if (!c) { err(out, 'I-COLLECTION', collection, 'unknown collection'); return out; }
  const sample = !!(c.sampleField && data && data[c.sampleField] === true);
  // o.live: the row is about to go to a live (indexed) site. Samples are for previews only.
  if (sample && o.live && o.mode === 'publish') err(out, 'I-SAMPLE-LIVE', c.sampleField, 'sample/placeholder items cannot be published to a live site');
  checkObject(out, '', data, c.fields, { mode: 'draft', ...o, contract, pageType: data && data.type, sample });
  if (collection === 'notices' && (o.mode || 'draft') === 'publish') checkConsentWording(out, contract, data);
  return out;
}

// The consent wording lint (24-GAP-HUNT D, TCPA 47 CFR 64.1200(f) written consent; CTIA): a notices row that a form names as its
// consent notice must say, in the words the visitor reads, what the person agrees to. Checked at publish, on the row's text:
//  - every channel the form can use is named: a phone field means "call" or "text", an email field means "email";
//  - when calls or texts are named: consent is "not a condition of purchase" (the TCPA written-consent element);
//  - when texts are named: how to stop ("reply STOP" or "opt out") and that "message and data rates may apply".
// The contract knows which notices rows are consent notices (forms.<id>.consent.notice), so a privacy policy row is not linted.
const consentForms = (contract, slug) => Object.values(contract.forms || {}).filter(f => f.consent && f.consent.notice === slug);
function checkConsentWording(out, contract, data) {
  const forms = consentForms(contract, data && data.slug);
  if (!forms.length) return;
  const text = isStr(data.text) ? data.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase() : '';
  const wantsPhone = forms.some(f => Object.values(f.fields || {}).some(x => x && x.type === 'phone'));
  const wantsEmail = forms.some(f => Object.values(f.fields || {}).some(x => x && x.type === 'email'));
  const saysCall = /\b(call|calls|phone)\b/.test(text), saysText = /\b(text|texts|sms|text message|text messages)\b/.test(text);
  if (wantsPhone && !saysCall && !saysText) err(out, 'I-CONSENT-CHANNEL', 'text', 'the form asks for a phone number: the consent wording must say "call" or "text"');
  if (wantsEmail && !/\be-?mail\b/.test(text)) err(out, 'I-CONSENT-CHANNEL', 'text', 'the form asks for an email: the consent wording must say "email"');
  if ((saysCall || saysText) && !/not (a )?condition of (any )?purchase/.test(text)) err(out, 'I-CONSENT-TCPA', 'text', 'calls or texts are named: the wording must say consent is "not a condition of purchase"');
  if (saysText && !/\bstop\b|opt[ -]out/.test(text)) err(out, 'I-CONSENT-STOP', 'text', 'texts are named: the wording must say how to stop ("reply STOP" or "opt out")');
  if (saysText && !/data rates/.test(text)) err(out, 'I-CONSENT-RATES', 'text', 'texts are named: the wording must say "message and data rates may apply"');
}

// For the factory's gate runner: widen a rule's required-path groups with the contract's approved waivers.
// groups: [[path, path], ...] as in the skill's rules (e.g. RE-DISC-001 anyOf). A waiver whose expects overlap a group adds its path.
export function applyWaivers(contract, ruleId, groups) {
  const ws = (contract.gateWaivers || []).filter(w => w.rule === ruleId);
  return groups.map(g => [...new Set([...g, ...ws.filter(w => w.expects.some(x => g.includes(x))).map(w => w.path)])]);
}

// True when the given module was started directly (realpaths, so a junction or symlink still matches).
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl)); }
  catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(metaUrl).toLowerCase(); }
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node validate.mjs <site-contract.json>'); process.exit(2); }
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  const problems = validateContract(contract);
  if (!problems.length) {
    const cols = mergeCore(contract);
    console.log(`VALID ${file}: ${Object.keys(cols).length} collections (${Object.keys(contract.collections).length} site), ` +
      `${Object.keys(contract.pageTypes).length} page types, ${contract.pages.length} pages, ${Object.keys(contract.forms).length} forms, ` +
      `${contract.placements.length} placements`);
    process.exit(0);
  }
  for (const pr of problems) console.log(`${pr.code}  ${pr.path}  ${pr.msg}`);
  console.log(`INVALID ${file}: ${problems.length} problem(s)`);
  process.exit(1);
}
