// Validates every department charter in docs/departments/ (the wall behind DECISIONS 33 and docs/departments/README.md rule 1).
//   node tools/departments/check.mjs          exit 0 = every charter valid, 1 = problems (one line each)
// Checks: the required sections exist; "Owns" lists at least one path in backticks; no path is owned by two charters; a path is
// not owned together with one of its parents by different charters; the head and builder models are named and known; the
// position log has at least one dated line; the README table lists every charter and no charter is missing from it; no em dash.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEPT_DIR, ROOT, REQUIRED_SECTIONS, MODELS, parseCharters } from './lib.mjs';

const problems = [];
const charters = parseCharters();
if (charters.length === 0) problems.push('no charters in docs/departments/');
const ownersByPath = new Map();
const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '');
for (const c of charters) {
  for (const s of REQUIRED_SECTIONS) if (!c.sections.has(s)) problems.push(`${c.file}: missing section "## ${s}"`);
  if (c.owns.length === 0) problems.push(`${c.file}: "Owns" lists no path (one per line, in backticks)`);
  if (!c.headModel) problems.push(`${c.file}: Head session has no "Model:" line`);
  else if (!MODELS.includes(c.headModel)) problems.push(`${c.file}: unknown head model ${c.headModel}`);
  if (!c.builderModel) problems.push(`${c.file}: Builders has no "Model:" line`);
  else if (!MODELS.includes(c.builderModel)) problems.push(`${c.file}: unknown builder model ${c.builderModel}`);
  if (c.log.length === 0) problems.push(`${c.file}: the position log has no dated line`);
  // every session type has someone to talk to: the head says whom it reports to, the builders say they report to the head
  if (!/reports? to (the owner|the head of operations)/i.test((c.sections.get('Head session') || '').replace(/\s+/g, ' '))) problems.push(`${c.file}: Head session does not say whom it reports to (the owner, or the head of operations)`);
  if (!/finding/i.test(c.sections.get('Builders') || '')) problems.push(`${c.file}: Builders does not carry the "finding you send back" line`);
  if (c.text.includes(String.fromCharCode(0x2014))) problems.push(`${c.file}: contains an em dash`);
  for (const p of c.owns) {
    const n = norm(p);
    if (ownersByPath.has(n) && ownersByPath.get(n) !== c.slug) problems.push(`${p} is owned by both ${ownersByPath.get(n)} and ${c.slug}`);
    ownersByPath.set(n, c.slug);
  }
}
// a child path under another department's parent path
const paths = [...ownersByPath.entries()];
for (const [a, ownerA] of paths) for (const [b, ownerB] of paths) {
  if (a !== b && ownerA !== ownerB && b.startsWith(a + '/') && !paths.some(([x, ox]) => ox === ownerA && x === b)) {
    // allowed only when the parent's owner lists an explicit exception "except <child>" in its Owns text
    const parent = charters.find(c => c.slug === ownerA);
    const owns = parent ? parent.sections.get('Owns') : '';
    const excepted = [`except \`${b}\``, `except \`${b}/\``, `except ${b}`].some(s => owns.includes(s));
    if (!excepted) problems.push(`${b} (${ownerB}) lies under ${a} (${ownerA}); add "except \`${b}\`" to ${ownerA}'s Owns line or move it`);
  }
}
// the README table
const readmePath = join(DEPT_DIR, 'README.md');
if (!existsSync(readmePath)) problems.push('docs/departments/README.md is missing');
else {
  const readme = readFileSync(readmePath, 'utf8');
  const rows = [...readme.matchAll(/^\| ([a-z0-9-]+) \|/gm)].map(m => m[1]).filter(s => s !== 'Slug');
  for (const c of charters) if (!rows.includes(c.slug)) problems.push(`README table has no row for ${c.slug}`);
  for (const r of rows) if (!charters.some(c => c.slug === r)) problems.push(`README table lists ${r} but docs/departments/${r}.md does not exist`);
}
if (problems.length) { for (const p of problems) console.log(`PROBLEM ${p}`); console.log(`${problems.length} problem(s)`); process.exit(1); }
console.log(`OK: ${charters.length} charter(s) valid: ${charters.map(c => c.slug).join(', ')}`);
