// Work order 32 step 7: 29's sanity checks on the edited files, plus a diff of every source against commit 478a129.
// Run from the repository root: node work/32-lead-types-second-read/sanity.mjs [--mutant]
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = 'work/29-lead-types';
const here = 'work/32-lead-types-second-read';
const files = [['real-estate.json', 'types'], ['insurance-financial.json', 'types'], ['statuses.json', 'statuses']];
const EM = String.fromCharCode(0x2014);
const mutant = process.argv.includes('--mutant');
let bad = 0;
const fail = m => { bad++; console.log('FAIL ' + m); };
const evidence = [];   // page text we hold for a source that changed: the stored windows and the first 1500 characters of the new pages
const q = JSON.parse(readFileSync(`${here}/quotes.json`, 'utf8'));
for (const r of q.rows) if (r.closest) evidence.push([r.url, r.closest]);
for (const f of ['s5-erdman', 's5-chrisbonner', 's5-jotform']) { const j = JSON.parse(readFileSync(`${here}/${f}.json`, 'utf8')); evidence.push([j.url, j.textHead]); }
const collapse = s => s.replace(/\s+/g, ' ').trim();

const changes = [];
for (const [file, key] of files) {
  const now = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  const old = JSON.parse(execFileSync('git', ['show', `478a129:${dir}/${file}`], { encoding: 'utf8', maxBuffer: 1 << 24, timeout: 30000 }));
  let list = now[key];
  if (mutant) list = list.map((e, i) => i === 0 ? { ...e, id: e.id + 'x', sources: [] } : e);
  const withSource = list.filter(e => (e.sources || []).some(s => s.url && s.readAt && s.says)).length;
  console.log(`${file}: ${list.length} ${key}, ${withSource} with at least one source (url, readAt, says)`);
  if (withSource !== list.length) fail(`${file}: entries without a source`);
  const a = old[key].map(e => [e.id, e.name]), b = list.map(e => [e.id, e.name]);
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${file}: ids and names unchanged vs 478a129 (order too): ${same}`);
  if (!same) fail(`${file}: ids or names changed`);
  for (const e of list) {
    const o = old[key].find(x => x.id === e.id); if (!o) continue;
    const k = s => `${s.url}\t${s.says}`;
    const was = new Set(o.sources.map(k)), is = new Set(e.sources.map(k));
    for (const s of o.sources) if (!is.has(k(s))) changes.push({ file, id: e.id, gone: s });
    for (const s of e.sources) if (!was.has(k(s))) changes.push({ file, id: e.id, added: s });
  }
  // nothing but sources and the top-level note may differ
  const strip = o => JSON.stringify(o, (k, v) => (k === 'sources' ? undefined : v));
  const o2 = JSON.parse(strip(old)), n2 = JSON.parse(strip(now)); delete o2.note; delete n2.note;
  if (JSON.stringify(o2) !== JSON.stringify(n2)) fail(`${file}: something other than sources and the note changed`);
  else console.log(`${file}: nothing but sources and the top-level note changed`);
}
console.log('\nchanged sources (' + changes.length + '):');
for (const c of changes) {
  if (c.gone) console.log(`  - ${c.file} ${c.id}: ${c.gone.url} | ${c.gone.says}`);
  else {
    const hit = evidence.some(([u, t]) => u === c.added.url && collapse(t).includes(collapse(c.added.says)));
    console.log(`  + ${c.file} ${c.id}: ${c.added.url} | ${c.added.says} | in the page text held: ${hit}`);
    if (!hit) fail(`${c.file} ${c.id}: new says is not in the page text held for ${c.added.url}`);
  }
}
for (const f of [...files.map(x => `${dir}/${x[0]}`), `${here}/proof.md`, `${here}/check-quotes.mjs`, `${here}/check-quotes.test.mjs`, `${here}/sanity.mjs`]) {
  if (!existsSync(f)) { console.log(`em dashes in ${f}: file not there yet`); continue; }
  const n = readFileSync(f, 'utf8').split(EM).length - 1;
  console.log(`em dashes in ${f}: ${n}`);
  if (n) fail(`${f}: em dashes`);
}
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
