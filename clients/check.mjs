// Clients record check (Clients department, docs/departments/clients.md "Proof").
//   node clients/check.mjs            exit 0 = every record complete; exit 1 = problems listed, one per line, prefixed "FAIL ".
// Checks: every clients/<slug>/ (not TEMPLATE) has profile.md, decisions.md, sites.md, facts.md, status.md; every slug is a row
// of clients/README.md with a non-empty status line; every row of the facts.md ledger has a source cell; no em dash (U+2014)
// in any file under clients/; no private individual's name outside the git-ignored clients/<slug>/private/ (rules below).
// CLIENTS_DIR overrides the folder (the tests run on a copy).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.CLIENTS_DIR ? resolve(process.env.CLIENTS_DIR) : dirname(fileURLToPath(import.meta.url));
const FILES = ['profile.md', 'decisions.md', 'sites.md', 'facts.md', 'status.md'];
const problems = [];

const readme = existsSync(join(DIR, 'README.md')) ? readFileSync(join(DIR, 'README.md'), 'utf8') : '';
if (!readme) problems.push('README.md missing');
const readmeRows = new Map();
for (const line of readme.split('\n')) {
  const m = /^\|\s*([a-z0-9][a-z0-9-]*)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(line);
  if (m && m[1] !== 'slug') readmeRows.set(m[1], m[4].trim());
}

const slugs = readdirSync(DIR).filter((n) => n !== 'TEMPLATE' && n !== 'test' && statSync(join(DIR, n)).isDirectory());
for (const slug of slugs) {
  for (const f of FILES) if (!existsSync(join(DIR, slug, f))) problems.push(`${slug}: missing ${f}`);
  if (!readmeRows.has(slug)) problems.push(`${slug}: not listed in README.md`);
  else if (!readmeRows.get(slug)) problems.push(`${slug}: README.md row has an empty status line`);
  const factsPath = join(DIR, slug, 'facts.md');
  if (existsSync(factsPath)) {
    const lines = readFileSync(factsPath, 'utf8').split('\n');
    let inLedger = false, n = 0;
    for (const line of lines) {
      if (/^\|\s*Fact\s*\|/.test(line)) { inLedger = true; continue; }
      if (inLedger && /^\|\s*-+/.test(line)) continue;
      if (inLedger && !line.startsWith('|')) { inLedger = false; continue; }
      if (!inLedger) continue;
      n++;
      const cells = line.split('|').map((c) => c.trim());
      // cells[0] is '' before the first pipe: fact = 1, value = 2, source = 3, verified = 4
      if (!cells[3]) problems.push(`${slug}: facts.md ledger row ${n} ("${(cells[1] || '').slice(0, 40)}") has no source`);
    }
    if (n === 0) problems.push(`${slug}: facts.md ledger has no rows`);
  }
}
for (const slug of readmeRows.keys()) if (!slugs.includes(slug) && readmeRows.get(slug) && !/NOT WRITTEN/.test(readmeRows.get(slug))) problems.push(`README.md lists ${slug} but clients/${slug}/ does not exist (say "NOT WRITTEN" in its status or create it)`);

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'test' ? [] : walk(p)) : [p]; });
for (const p of walk(DIR)) if (p.endsWith('.md') && readFileSync(p, 'utf8').includes('—')) problems.push(`${p.slice(DIR.length + 1)}: contains an em dash`);

// Private individuals (head of operations ruling 2026-11-11): their names live only in clients/<slug>/private/, which is git-ignored.
// 1. clients/.gitignore must ignore */private/. 2. No file under a private/ folder is tracked by git (when this is a git checkout).
// 3. Every name listed in a local private/people.md ("- Name" lines under "## Names") appears in no other file under clients/.
const ignore = existsSync(join(DIR, '.gitignore')) ? readFileSync(join(DIR, '.gitignore'), 'utf8') : '';
if (!/^\*\/private\/\s*$/m.test(ignore)) problems.push('.gitignore: must hold the line */private/ (a client\'s people stay off the public repository)');
const tracked = spawnSync('git', ['-C', DIR, 'ls-files', '--', '*/private/*'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
if (tracked.status === 0) for (const f of tracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) problems.push(`${f}: a private file is tracked by git (git rm --cached it)`);
for (const slug of slugs) {
  const pf = join(DIR, slug, 'private', 'people.md');
  if (!existsSync(pf)) continue;
  const sec = (readFileSync(pf, 'utf8').split(/^## Names\s*$/m)[1] || '').split(/^## /m)[0];
  const names = sec.split('\n').map((l) => (/^-\s+(.+?)\s*$/.exec(l) || [])[1]).filter((n) => n && n.length >= 4);
  for (const p of walk(DIR)) {
    if (p.split(/[\\/]/).includes('private') || !/\.(md|json|txt|csv|html)$/i.test(p)) continue;
    const text = readFileSync(p, 'utf8').toLowerCase();
    for (const n of names) if (text.includes(n.toLowerCase())) problems.push(`${p.slice(DIR.length + 1)}: names a person listed in ${slug}/private/people.md (write the role instead)`);
  }
}

// People rows in every folder not on the dated legacy list (clients/legacy-people.json): a check cannot recognise a person's name
// in free text, so the rows built to hold people must point at private/people.md or say unknown/none. 1. profile.md "People" and
// "Contact used for the work". 2. facts.md ledger rows whose Fact names a kind of person. 3. the folder's README row: no person in
// parentheses after the business name (quoted names such as a trading name do not count).
const legacyFile = join(DIR, 'legacy-people.json');
let legacy = null;
try { legacy = JSON.parse(readFileSync(legacyFile, 'utf8')); } catch { problems.push('legacy-people.json: missing or not JSON (the dated list of folders exempt from the people rules)'); }
const exempt = new Set((legacy && Array.isArray(legacy.folders)) ? legacy.folders : []);
if (legacy && !/^\d{4}-\d{2}-\d{2}$/.test(legacy.date || '')) problems.push('legacy-people.json: needs its ruling date');
// Says unknown/none or points at the private file, AND holds no capitalised word pair ("Jane Doe") outside quotes and backticks
// (a value that names a person and also mentions the private file still fails; quoted labels such as "View History" do not count).
const pointsAway = (v) => (/^\s*(unknown|none)\b/i.test(v) || /private\/people\.md/.test(v))
  && !/\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(v.replace(/"[^"]*"|`[^`]*`/g, ''));
const PERSON_FACT = /\b(person|people|agent|owner|manager|contact|testimonial|founder|staff|officer|member|director|partner|employee)s?\b/i;
for (const slug of slugs.filter((s) => !exempt.has(s))) {
  const pf = join(DIR, slug, 'profile.md');
  if (existsSync(pf)) for (const line of readFileSync(pf, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length > 3 && /^(People|Contact used for the work)\b/.test(cells[1]) && !pointsAway(cells[2])) problems.push(`${slug}/profile.md: the "${cells[1].slice(0, 30)}" row must say unknown or none, or point at private/people.md (no names in the public record)`);
  }
  const ff = join(DIR, slug, 'facts.md');
  if (existsSync(ff)) for (const line of readFileSync(ff, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length > 4 && cells[1] !== 'Fact' && !/^-+$/.test(cells[1]) && PERSON_FACT.test(cells[1]) && !pointsAway(cells[2])) problems.push(`${slug}/facts.md: the row "${cells[1].slice(0, 40)}" names a kind of person: its value must say unknown or none, or point at private/people.md`);
  }
  for (const line of readme.split('\n')) {
    const m = /^\|\s*([a-z0-9][a-z0-9-]*)\s*\|([^|]*)\|/.exec(line);
    if (!m || m[1] !== slug) continue;
    for (const par of m[2].match(/\(([^)]*)\)/g) || []) if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(par.replace(/"[^"]*"/g, ''))) problems.push(`README.md: the ${slug} row names a person in parentheses (${par.slice(0, 40)}): write the business only`);
  }
}

// Profile passes (owner 2026-11-11): every status.md (the template included) has the section with at least one dated row.
for (const slug of [...slugs, 'TEMPLATE']) {
  const sp = join(DIR, slug, 'status.md');
  if (!existsSync(sp)) continue;
  const sec = (readFileSync(sp, 'utf8').split(/^## Profile passes\s*$/m)[1] || '').split(/^## /m)[0];
  const passRows = sec.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*(Date|-+)\s*\|/.test(l));
  if (!passRows.length) problems.push(`${slug}/status.md: no "## Profile passes" section with a dated row (RESUME or RE-EVALUATE)`);
  else if (slug !== 'TEMPLATE' && !passRows.every((l) => /\|\s*(RESUME|RE-EVALUATE|not recorded)/.test(l))) problems.push(`${slug}/status.md: a profile pass without its mode (RESUME or RE-EVALUATE)`);
}

if (problems.length) { for (const p of problems) console.log('FAIL ' + p); process.exit(1); }
console.log(`OK: ${slugs.length} client record(s) complete: ${slugs.join(', ')}`);
