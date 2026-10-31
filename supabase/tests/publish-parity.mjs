// Parity of the SQL publish-ready rules with the JS validator (slice 4.6). The publish-ready wall (migration 11,
// private.publish_problems) is a SQL port of the publish-mode REQUIRED rules of contracts/validate.mjs. A port drifts; this script is the
// proof that it has not: for every contract below and every collection it builds a complete item, and for every node of that item a set of
// broken variants (the value removed, null, "", white space, an empty list or object, 0, false, an empty row). For each item it compares
//   the paths of the I-REQUIRED problems of validateItem(contract, collection, data, { mode: 'publish' })   (JS)
//   the paths of private.publish_problems(resolved, collection, data)                                     (SQL, on a throwaway cluster)
// and any difference is a FAIL naming the item and both sets.
//
//   node supabase/tests/publish-parity.mjs [--break <name>] [--keep]
//
// It starts its own throwaway Postgres cluster (initdb, as run-local.mjs does) and applies shim + every migration. No Supabase account.
// --break <name>: apply one deliberate break to migration 11 in memory (never on disk) to watch this script go red for the right reason:
//   seo-description | seo-title | section-required | group | list | empty-string | sourced | open
// Exit 0 = every item agrees, 1 = a difference, 2 = could not run.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateItem, mergeCore, validateContract, CORE } from '../../contracts/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const BREAK = arg('--break');
const PORT = String(55000 + Math.floor(Math.random() * 900));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 512 * 1024 * 1024, ...opts });
const outOf = x => `${x.stdout ?? ''}${x.stderr ?? ''}${x.error ? `\n(${x.error.code || x.error.message})` : ''}`.trim();

// ---------- the deliberate breaks (in memory only) ----------
const BREAKS = {
  'seo-description': ["      if not private.publish_has_text(v -> 'description') then probs := probs || (p_path || '.description required'); end if;", '      null;'],
  'seo-title': ["      if not private.publish_has_text(v -> 'title') then probs := probs || (p_path || '.title required'); end if;", '      null;'],
  'section-required': ["          probs := probs || (p_path || '.' || (x.sec ->> 'id') || ' required');", '          null;'],
  'group': ["      probs := probs || private.publish_problems_object(p_types, p_page_type, p_path, v, coalesce(p_field -> 'of', '{}'::jsonb));", '      null;'],
  'list': ["        probs := probs || private.publish_problems_object(p_types, p_page_type, p_path || '[' || i || ']', v -> i, coalesce(p_field -> 'of', '{}'::jsonb));", '        null;'],
  'empty-string': ["$$ select v is null or v in ('null'::jsonb, '\"\"'::jsonb, '[]'::jsonb) $$;", "$$ select v is null or v in ('null'::jsonb, '[]'::jsonb) $$;"],
  'sourced': ["    v := v -> 'value';", '    null;'],
  'open': ["  elsif t = 'group' and not private.js_truthy(p_field -> 'open') then", "  elsif t = 'group' then"],
};
if (BREAK && !BREAKS[BREAK]) { console.error(`unknown --break "${BREAK}"; one of ${Object.keys(BREAKS).join(', ')}`); process.exit(2); }

// ---------- the contracts ----------
const load = rel => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
// every core collection with public pages must be in the sitemap (C-SITEMAP), in any contract that includes the core
const CORE_PLACEMENTS = Object.entries(CORE.collections).filter(([, c]) => c.route).map(([id]) => ({ id: id + '>sitemap', collection: id, to: { sitemap: true } }));
const STRESS = {   // every shape the rules walk: open and closed groups and lists, nested lists, sourced facts, seo, sections of every kind
  contractVersion: 1,
  collections: {
    stress: { kind: 'collection', access: { member: 'none' }, titleField: 'title', fields: {
      title: { type: 'text', required: true },
      note: { type: 'text' },
      fact: { type: 'text', required: true, sourced: true },
      factGroup: { type: 'group', sourced: true, of: { n: { type: 'text', required: true } } },
      seo: { type: 'seo', required: true },
      seo2: { type: 'seo' },
      cover: { type: 'image', required: true },
      tags: { type: 'list', required: true, of: { name: { type: 'text', required: true }, weight: { type: 'number' } } },
      rooms: { type: 'list', of: { name: { type: 'text', required: true }, beds: { type: 'list', of: { label: { type: 'text', required: true } } }, size: { type: 'group', of: { w: { type: 'number', required: true }, h: { type: 'number' } } } } },
      free: { type: 'group', open: true, of: { x: { type: 'text', required: true } } },
      freeList: { type: 'list', open: true, of: { x: { type: 'text', required: true } } },
      contact: { type: 'group', required: true, of: { phone: { type: 'phone', required: true }, hours: { type: 'list', of: { days: { type: 'text', required: true }, open: { type: 'text' } } }, meta: { type: 'seo' } } },
      count: { type: 'number', required: true },
      flag: { type: 'boolean', required: true },
      sections: { type: 'sections', required: true },
      type: { type: 'text', required: true },
    } },
  },
  pageTypes: {
    home: { sections: [
      { id: 'hero', kind: 'fields', fields: { heading: { type: 'text', required: true }, items: { type: 'list', of: { t: { type: 'text', required: true } } } } },
      { id: 'about', kind: 'fields', fields: { body: { type: 'richtext' } } },
      { id: 'cta', kind: 'fields', fields: { label: { type: 'text', required: true }, box: { type: 'group', required: true, of: { a: { type: 'text', required: true } } } } },
      { id: 'feed', kind: 'feed', accepts: 'stress' },
      { id: 'form', kind: 'form', form: 'contact' } ] },
    plain: { sections: [{ id: 'body', kind: 'fields', fields: { text: { type: 'richtext' } } }] },
  },
  pages: [], forms: { contact: { fields: { name: { type: 'text', required: true } } } },
  placements: [{ id: 'stress>home', collection: 'stress', to: { pageType: 'home', section: 'feed' } }, ...CORE_PLACEMENTS],
};
const CONTRACTS = [
  ['core only', { contractVersion: 1, collections: {}, pageTypes: {}, pages: [], forms: {},
    placements: CORE_PLACEMENTS }],
  ['stress (inline)', STRESS],
  ['sites/test-demo-a', load('sites/test-demo-a/contract.json')],
  ['examples/elev8', load('contracts/examples/elev8/contract.json')],
  ['examples/rainmaker', load('contracts/examples/rainmaker/contract.json')],
  ['examples/vtv', load('contracts/examples/vtv/contract.json')],
];

// ---------- a complete item for a collection, from its field definitions ----------
const IMG = { asset: 'media-1', alt: 'a photo' };
function sampleValue(f, ctx) {
  let v;
  switch (f.type) {
    case 'text': case 'richtext': v = 'Some text'; break;
    case 'slug': v = 'some-slug'; break;
    case 'number': v = typeof f.min === 'number' ? f.min : 1; break;
    case 'money': v = { amount: 1, currency: 'USD' }; break;
    case 'boolean': v = true; break;
    case 'date': v = '2026-01-01'; break;
    case 'datetime': v = '2026-01-01T00:00:00Z'; break;
    case 'enum': v = (f.options || ['x'])[0]; break;
    case 'email': v = 'a@example.com'; break;
    case 'phone': v = '+15555550100'; break;
    case 'url': v = 'https://example.com/x'; break;
    case 'image': v = { ...IMG }; break;
    case 'gallery': v = [{ ...IMG }]; break;
    case 'file': v = { asset: 'media-1' }; break;
    case 'reference': v = f.multiple ? ['row-1'] : 'row-1'; break;
    case 'address': v = { city: 'Alpha' }; break;
    case 'geo': v = { lat: 1, lng: 1 }; break;
    case 'list': v = f.open || !f.of ? [{}] : [sampleObject(f.of, ctx)]; break;
    case 'group': v = f.open || !f.of ? {} : sampleObject(f.of, ctx); break;
    case 'seo': v = { title: 'A title', description: 'A description' }; break;
    case 'sections': {
      const t = ctx.contract.pageTypes[ctx.pageType];
      v = {};
      if (t) for (const s of t.sections) if (s.kind === 'fields') v[s.id] = sampleObject(s.fields, ctx);
      break;
    }
    default: v = 'x';
  }
  return f.sourced ? { value: v, source: 'https://example.com/source', date: '2026-01-01' } : v;
}
function sampleObject(fields, ctx) {
  const o = {};
  for (const [k, f] of Object.entries(fields || {})) o[k] = sampleValue(f, ctx);
  return o;
}

// ---------- broken variants: every node of the complete item, damaged in several ways ----------
const DAMAGE = [['removed', undefined], ['null', null], ['""', ''], ['spaces', '   '], ['nbsp', '\u00a0'], ['[]', []], ['{}', {}], ['[{}]', [{}]], ['0', 0], ['false', false]];
const clone = o => JSON.parse(JSON.stringify(o));
function setAt(root, path, val) {   // path: array of keys / indexes; val undefined = remove
  const r = clone(root);
  let o = r;
  for (const k of path.slice(0, -1)) o = o[k];
  const last = path[path.length - 1];
  if (val === undefined) { if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; } else o[last] = clone(val);
  return r;
}
const fmt = path => path.map(k => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '') || '(root)';
function* variants(root, node = root, path = []) {
  if (path.length) for (const [name, val] of DAMAGE) {
    yield [`${fmt(path)} -> ${name}`, setAt(root, path, val)];
  }
  if (node && typeof node === 'object') for (const k of Object.keys(node)) yield* variants(root, node[k], [...path, Array.isArray(node) ? Number(k) : k]);
}

// ---------- build every item ----------
const items = [];   // { contract: index, coll, why, data }
const seen = new Set();
for (const [ci, [name, contract]] of CONTRACTS.entries()) {
  const problems = validateContract(contract);
  if (problems.length) { console.error(`contract "${name}" does not validate: ${problems[0].code} ${problems[0].msg}`); process.exit(2); }
  const cols = mergeCore(contract);
  const resolved = { ...contract, collections: cols };
  for (const [coll, c] of Object.entries(cols)) {
    const pageTypes = coll === 'pages' || Object.values(c.fields).some(f => f.type === 'sections') ? Object.keys(contract.pageTypes) : [null];
    for (const pt of pageTypes.length ? pageTypes : [null]) {
      const base = sampleObject(c.fields, { contract: resolved, pageType: pt });
      if (pt && 'type' in c.fields) base.type = pt;
      const add = (why, data) => { const key = `${ci}|${coll}|${JSON.stringify(data)}`; if (seen.has(key)) return; seen.add(key); items.push({ ci, coll, why: `${coll}${pt ? `(${pt})` : ''}: ${why}`, data }); };
      add('complete', base);
      add('everything missing', {});
      if (pt) add('only the type', { type: pt });
      for (const [why, data] of variants(base)) add(why, data);
    }
  }
  items.push({ ci, coll: 'nonesuch', why: 'unknown collection', data: {} });
}

// ---------- the JS side ----------
const jsPaths = it => {
  const probs = validateItem(CONTRACTS[it.ci][1], it.coll, it.data, { mode: 'publish' });
  return [...new Set(probs.filter(p => p.code === 'I-REQUIRED').map(p => p.path))].sort();
};
const jsSets = [];
for (const it of items) {
  try { jsSets.push(it.coll === 'nonesuch' ? ['nonesuch unknown collection'] : jsPaths(it)); }
  catch (e) { console.error(`FAIL: the JS validator threw on ${CONTRACTS[it.ci][0]} / ${it.why}: ${e && e.message}`); process.exit(1); }
}

// ---------- the SQL side: a throwaway cluster ----------
const migDir = join(ROOT, 'supabase', 'migrations');
const migFiles = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
let src = migFiles.map(f => `-- >>> ${f}\n` + readFileSync(join(migDir, f), 'utf8')).join('\n');
if (BREAK) {
  const [a, b] = BREAKS[BREAK];
  if (!src.includes(a)) { console.error(`--break ${BREAK}: its target is not in the migrations (the break would apply nothing)`); process.exit(2); }
  src = src.split(a).join(b);
}
const shim = readFileSync(join(HERE, 'local-shim.sql'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'omnikom-parity-'));
const data = join(dir, 'data');
let status = 2, sqlSets = null;
try {
  let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  if (r.status !== 0) throw new Error('initdb failed: ' + outOf(r));
  r = run('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start failed: ' + outOf(r));
  const psql = (file, db = 'parity') => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-f', file]);
  run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-q', '-c', 'create database parity']);
  writeFileSync(join(dir, 'shim.sql'), shim);
  writeFileSync(join(dir, 'migrations.sql'), src);
  for (const f of ['shim.sql', 'migrations.sql']) { const x = psql(join(dir, f)); if (x.status !== 0) throw new Error(`${f} failed: ${outOf(x).slice(-600)}`); }
  sqlSets = new Array(items.length);
  for (const [ci, [name, contract]] of CONTRACTS.entries()) {
    const mine = items.map((it, i) => ({ i, it })).filter(x => x.it.ci === ci);
    const resolved = { ...contract, collections: mergeCore(contract) };
    const payload = JSON.stringify(mine.map(x => ({ i: x.i, coll: x.it.coll, data: x.it.data })));
    const resolvedText = JSON.stringify(resolved);
    if (payload.includes('$j$') || resolvedText.includes('$j$')) throw new Error('a fixture contains the dollar quote $j$');
    writeFileSync(join(dir, `q${ci}.sql`),
      `select coalesce(jsonb_agg(jsonb_build_object('i', t.i, 'p', to_jsonb(private.publish_problems(c.resolved, t.coll, t.data))) order by t.i), '[]'::jsonb)\n` +
      `from (select $j$${resolvedText}$j$::jsonb as resolved) c, jsonb_to_recordset($j$${payload}$j$::jsonb) as t(i int, coll text, data jsonb);\n`);
    const x = psql(join(dir, `q${ci}.sql`));
    if (x.status !== 0) throw new Error(`the SQL side failed on "${name}": ${outOf(x).slice(-800)}`);
    for (const row of JSON.parse(x.stdout)) sqlSets[row.i] = [...new Set(row.p.map(s => s.endsWith(' required') ? s.slice(0, -' required'.length) : s))].sort();
  }
  status = 0;
} catch (e) {
  console.error(`could not run the SQL side: ${e && e.message}`);
  status = 2;
} finally {
  run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
  if (!process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true });
}
if (status !== 0) process.exit(status);

// ---------- compare ----------
let diffs = 0, shown = 0;
const perContract = new Array(CONTRACTS.length).fill(0);
for (const [i, it] of items.entries()) {
  perContract[it.ci]++;
  const js = jsSets[i], sql = sqlSets[i];
  if (!sql) { console.log(`FAIL no SQL answer for ${CONTRACTS[it.ci][0]} / ${it.why}`); diffs++; continue; }
  if (JSON.stringify(js) === JSON.stringify(sql)) continue;
  diffs++;
  if (shown++ < 12) {
    console.log(`FAIL ${CONTRACTS[it.ci][0]} / ${it.why}\n  JS  only: ${JSON.stringify(js.filter(p => !sql.includes(p)))}\n  SQL only: ${JSON.stringify(sql.filter(p => !js.includes(p)))}\n  JS: ${JSON.stringify(js)}\n  SQL: ${JSON.stringify(sql)}\n  item: ${JSON.stringify(it.data).slice(0, 500)}`);
  }
}
for (const [ci, [name]] of CONTRACTS.entries()) console.log(`  ${name}: ${perContract[ci]} items`);
if (diffs) { console.log(`\nFAILED: ${diffs} of ${items.length} items differ between the JS validator and private.publish_problems${BREAK ? ` (deliberate break: ${BREAK})` : ''}`); process.exit(1); }
const withProblems = jsSets.filter(x => x.length).length;   // an item with no required path at all proves little: say how many have one
console.log(`\n  ${withProblems} items have at least one required path, ${items.length - withProblems} are complete`);
console.log(`OK: ${items.length} items, SQL and JS agree on every required path`);
