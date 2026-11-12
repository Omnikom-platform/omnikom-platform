// Watched-fail for every rule: make a broken copy of the modules with ONE rule switched off, run the tests against it,
// and require the suite to go red. A rule whose mutant stays green has no test that measures it.
//   node test/mutate.mjs      (exit 0 = the unbroken copy passed and every mutant was caught; 1 = it did not, or a mutant
//                              survived or crashed, or a code is untested)
// The copy holds FILES (what a mutant breaks) and READS (the other files test/run.mjs reads from CONTRACTS_DIR). The
// unbroken copy runs first and must pass. A mutant is caught only when the tests ran to their summary line and it names a
// failed check; a run that died before its summary is CRASHED and counts with the survivors.
// Also checks that every rule code in the source appears in the tests, so a new rule cannot ship without a case.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['validate.mjs', 'store.mjs', 'place.mjs', 'from-plan.mjs', 'core.json', 'types.json', 'richtext.mjs'];
const TEST = join(ROOT, 'test', 'run.mjs');
// the example contracts test/run.mjs reads from CONTRACTS_DIR, one per ex('<folder>') call in it
const READS = [...new Set([...readFileSync(TEST, 'utf8').matchAll(/\bex\('([a-z0-9-]+)'\)/g)].map(m => join('examples', m[1], 'contract.json')))];
const src = Object.fromEntries(FILES.map(f => [f, readFileSync(join(ROOT, f), 'utf8')]));

// 1. every rule code -> one mutant that switches it off at every place it is raised
const mutants = [];
for (const f of ['validate.mjs', 'store.mjs']) {
  const found = new Set([...src[f].matchAll(/(?:err\(\w+, |no\()'([CIS]-[A-Z-]+)'/g)].map(m => m[1]));
  for (const code of found) mutants.push({
    name: `rule ${code} off`, file: f, code,
    apply: t => t
      .replace(new RegExp(`err\\((\\w+), '${code}',`, 'g'), (_, v) => `void (${v}, '${code}',`)
      .replace(new RegExp(`no\\('${code}',`, 'g'), () => `(() => ({ ok: true }))('${code}',`),
  });
}
// 2. behaviour that has no code: placement, the build's read of published rows, derivation
const swap = (file, find, repl, name) => mutants.push({ name, file, apply: t => { if (!t.includes(find)) throw new Error(`mutant "${name}": target not found`); return t.split(find).join(repl); } });
swap('place.mjs', 'if (!have.some(x => vals.includes(x))) return false;', '', 'placement ignores "when" (status)');
swap('place.mjs', 'if (to.match) list = list.filter(', 'if (false) list = list.filter(', 'placement ignores the page\'s place');
swap('place.mjs', 'if (pl.limit) list = list.slice(0, pl.limit);', '', 'placement ignores limit');
swap('store.mjs', 'data: r.versions.find(v => v.n === r.publishedVersion).data', 'data: r.versions[r.versions.length - 1].data', 'build reads drafts instead of the published version');
swap('store.mjs', 'return [...s.rows.values()].filter(r => r.publishedVersion)', 'return Object.values(sites).flatMap(x => [...x.rows.values()]).filter(r => r.publishedVersion)', 'build reads every workspace');
swap('store.mjs', 'if (session.role !== \'staff\') return no(\'S-LOCKED\'', 'if (false) return no(\'S-LOCKED\'', 'locked fields open to clients');
swap('from-plan.mjs', 'if (ref) placements.push(', 'if (false) placements.push(', 'generator stops deriving "on its place\'s page"');
swap('from-plan.mjs', 'if (routes.some(rx => rx.test(p.path))', 'if (false', 'generator keeps pages a collection route covers');
swap('place.mjs', 'if (f.visibleWhen && !Object.entries', 'if (false && !Object.entries', 'public data ignores visibleWhen (sold price leaks)');
swap('place.mjs', 'if (!f || f.internal) continue;', 'if (!f) continue;', 'public data shows internal fields');
swap('validate.mjs', 'img = { ...img, width: rec.width, exifStripped: rec.exifStripped, rightsConfirmed: rec.rightsConfirmed };', '', 'photo facts taken from the row, not the media record');
swap('validate.mjs', "if (merged[id] && c.core) { merged[id] = { ...c, fields: { ...c.fields } }; continue; }", '', 'mergeCore not idempotent (resolved contract loses extensions)');
swap('validate.mjs', 'const forms = consentForms(contract, data && data.slug);', 'const forms = Object.values(contract.forms || {});', 'consent lint runs on notices rows no form names');
swap('validate.mjs', "if (collection === 'notices' && (o.mode || 'draft') === 'publish') checkConsentWording(out, contract, data);", "if (collection === 'notices') checkConsentWording(out, contract, data);", 'consent lint ignores the publish gate (drafts refused)');
swap('validate.mjs', 'if (rec.processed === false) img.exifStripped = false;', '', 'unprocessed photo treated as processed');
swap('validate.mjs', 'const minWidth = o.sample ? 0 : m.minWidth;', 'const minWidth = m.minWidth;', 'sample listings held to the full photo width');
swap('validate.mjs', 'ws.filter(w => w.expects.some(x => g.includes(x))).map(w => w.path)', 'ws.map(w => w.path)', 'waiver widens every group, not just the matching one');
swap('validate.mjs', "    checkFormFields(out, `${p}.fields`, f.fields, cols);", "    checkFields(out, `${p}.fields`, f.fields, cols);", 'forms checked as collection fields (choice refused)');
swap('validate.mjs', "if ((f.type === 'enum' || f.type === 'choice') && (!Array", "if ((f.type === 'enum') && (!Array", 'choice options unchecked');
swap('validate.mjs', "for (const k of ['min', 'max']) if (f[k] !== undefined", "for (const k of []) if (f[k] !== undefined", 'form number min/max not checked as numbers');
swap('validate.mjs', 'column: d.column !== false, editable: d.editable !== false', 'column: d.column === true, editable: d.editable !== false', 'leadColumns: column defaults to false');
swap('validate.mjs', 'column: d.column !== false, editable: d.editable !== false', 'column: d.column !== false, editable: d.editable === true', 'leadColumns: editable defaults to false');
swap('validate.mjs', 'if (CORE_LEAD_FIELDS[k] || !d ||', 'if (!d ||', 'leadColumns lists name/email/phone as industry columns');
swap('validate.mjs', 'for (const o of d.options || []) if (!c.options.includes(o)) c.options.push(o);', 'if (!c.options.length) c.options.push(...(d.options || []));', 'leadColumns: options of the first form only');
swap('from-plan.mjs', '...(E.crm ? { crm: E.crm } : {}),', '', 'generator drops the entities\' crm lists');
swap('validate.mjs', "if (fd.type !== 'reference' && !(fd.options || []).includes(v))", "if (false)", 'leadTypeFrom map keys not checked against the field\'s options');
swap('validate.mjs', "'status', 'owner', 'id', 'created_at', 'updated_at', 'workspace', 'site',\n  'lead_type', 'status_date', 'status_who', 'status_text', 'follow_up', 'duplicate', 'duplicate_of']", "'status', 'owner', 'id', 'created_at', 'updated_at', 'workspace', 'site']", 'lead type and status columns not reserved as form keys');
swap('validate.mjs', "if (empty(v)) { if (publish && f.required)", "if (empty(v)) { if (f.required)", 'required enforced on drafts too');
swap('richtext.mjs', "const NAMES = 'p|h2|h3|ul|ol|li|strong|em';", "const NAMES = 'p|h2|h3|ul|ol|li|strong|em|script';", 'rich text: a script tag passes');
swap('richtext.mjs', '|(${NAMES})|', '|(${NAMES})(?: [^>]*)?|', 'rich text: any attribute passes on an allowed tag');
swap('richtext.mjs', 'if (m[4] !== undefined && !LINK.some(', 'if (false && !LINK.some(', 'rich text: a link to any address passes');
swap('richtext.mjs', 'new RegExp(`^/(?:${SEG})*$`)', 'new RegExp(`^/.*$`)', 'rich text: a link to another host by // passes');
swap('richtext.mjs', 'if (!out.length && open.length) out.push(', 'if (false) out.push(', 'rich text: a tag left open passes');
swap('richtext.mjs', 'if (!m) { out.push(', 'if (!m) { String(', 'rich text: a < that starts no allowed tag passes');
swap('richtext.mjs', 'open.pop(); else out.push(', 'open.pop(); else String(', 'rich text: a closing tag that closes nothing passes');
swap('richtext.mjs', "const SPAN_CLASSES = 'ph|prov';", "const SPAN_CLASSES = 'ph|prov|[a-z]+';", 'rich text: another span class passes');
swap('richtext.mjs', "const A_CLASS = 'ul';", "const A_CLASS = '[a-z]+';", 'rich text: another link class passes');
swap('richtext.mjs', '|(${NAMES})|', '|(${NAMES})(?: class="ul")?|', 'rich text: the class passes on another tag');
swap('richtext.mjs', "const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*/';", "const SEG = '[a-z0-9.%]+(?:-[a-z0-9.%]+)*/';", 'rich text: .. passes inside a path');
swap('richtext.mjs', 'i !== -1 && !out.length;', 'i !== -1;', 'rich text: every < of a long input is a problem');
swap('richtext.mjs', 'const LINK = [/^https?:', 'const LINK = [/https?:', 'rich text: a link pattern is not anchored at its start');
swap('richtext.mjs', 'href="([^"<>]*)")>', 'href="([^"<>]*)"[^>]*)>', 'rich text: attributes after a link\'s href pass');

// 3. coverage: every code raised in the source is named in the tests
const tests = readFileSync(TEST, 'utf8');
const missing = [...new Set(mutants.filter(m => m.code).map(m => m.code))].filter(c => !tests.includes(`'${c}'`));

// one run of the tests against a fresh copy with mutant m applied (no m = the unbroken copy); failed is null when the run
// died before its summary line
function runCopy(m) {
  const dir = mkdtempSync(join(tmpdir(), 'contract-mutant-'));
  try {
    for (const f of [...FILES, ...READS]) { mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(dir, f)); }
    if (m) {
      writeFileSync(join(dir, m.file), m.apply(src[m.file]));
      if (readFileSync(join(dir, m.file), 'utf8') === src[m.file]) throw new Error(`mutant "${m.name}" changed nothing`);
    }
    const r = spawnSync(process.execPath, [TEST], { env: { ...process.env, CONTRACTS_DIR: dir }, encoding: 'utf8', timeout: 60000 });
    const out = r.stdout || '', err = (r.stderr || '').split(/\r?\n/);
    const sum = out.match(/^(\d+) passed, (\d+) failed\s*$/m);
    return { status: r.status, fails: out.split('\n').filter(l => l.startsWith('FAIL')), failed: sum ? Number(sum[2]) : null,
      died: (r.error && r.error.message) || err.find(l => /Error\b/.test(l)) || err.find(Boolean) || `exit ${r.status}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const base = runCopy(null);
if (base.failed !== 0 || base.status !== 0) {
  console.log(`BASELINE FAILS: the unbroken copy does not pass (${base.failed === null ? `died before its summary: ${base.died}` : `${base.failed} failed: ${(base.fails[0] || '').slice(5, 110)}`})`);
  process.exit(1);
}
let caught = 0, survived = 0, crashed = 0;
for (const m of mutants) {
  const r = runCopy(m);
  const verdict = r.failed === null ? 'CRASHED ' : r.failed > 0 && r.fails.length ? 'caught  ' : 'SURVIVED';
  if (verdict === 'CRASHED ') crashed++; else if (verdict === 'SURVIVED') survived++; else caught++;
  const why = r.failed === null ? `died before its summary: ${r.died}` : r.fails[0] ? `${r.fails.length} red: ${r.fails[0].slice(5, 110)}` : '';
  console.log(`${verdict} ${m.name.padEnd(52)} ${why ? `(${why})` : ''}`);
}
if (missing.length) console.log(`codes with no test case: ${missing.join(', ')}`);
console.log(`\n${mutants.length} mutants, ${caught} caught, ${survived} survived, ${crashed} crashed; ${missing.length} codes untested`);
process.exit(survived || crashed || missing.length ? 1 : 0);
