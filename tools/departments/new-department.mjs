// Creates a department charter from docs/departments/TEMPLATE.md and adds its row to docs/departments/README.md.
//   node tools/departments/new-department.mjs --slug <slug> --name "<Name>" --mission "<one sentence>" --owns <path> [--owns <path>...]
//        [--head-model fable] [--builder-model sonnet] [--rules "<line>"]... [--proof "<line>"] [--decisions "<line>"] [--open "<line>"]
//        [--dry-run]
// Refuses: a slug that is not lowercase-dashed, a charter that already exists, an owned path already owned by another charter
// (tools/departments/check.mjs is run after writing; a failing check removes the new file again, so the tree stays valid).
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, DEPT_DIR, parseCharters } from './lib.mjs';

//        [--from <file.json>]   the same fields from a JSON file ({ slug, name, mission, owns: [], rules: [], proof: [], decisions: [], open: [], headModel, builderModel }); command-line flags add to it
const argv = process.argv.slice(2);
const flags = {}; const lists = { owns: [], rules: [], proof: [], decisions: [], open: [] };
const fromIdx = argv.indexOf('--from');
if (fromIdx >= 0) {
  const f = argv[fromIdx + 1];
  if (!f) { console.error('--from needs a file'); process.exit(2); }
  let j;
  try { j = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.error(`--from: cannot read ${f}: ${e.message}`); process.exit(2); }
  for (const k of ['slug', 'name', 'mission']) if (j[k]) flags[k] = String(j[k]);
  if (j.headModel) flags['head-model'] = String(j.headModel);
  if (j.builderModel) flags['builder-model'] = String(j.builderModel);
  for (const k of Object.keys(lists)) if (Array.isArray(j[k])) lists[k].push(...j[k].map(String));
  argv.splice(fromIdx, 2);
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { console.error(`unexpected argument ${a}`); process.exit(2); }
  const k = a.slice(2);
  if (k === 'dry-run') { flags[k] = true; continue; }
  const v = argv[++i];
  if (v === undefined) { console.error(`--${k} needs a value`); process.exit(2); }
  if (k in lists) lists[k].push(v); else flags[k] = v;
}
const need = k => { if (!flags[k]) { console.error(`--${k} is required`); process.exit(2); } return flags[k]; };
const slug = need('slug'), name = need('name'), mission = need('mission');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { console.error('--slug must be lowercase words joined with dashes'); process.exit(2); }
if (lists.owns.length === 0) { console.error('at least one --owns <path> is required'); process.exit(2); }
const headModel = flags['head-model'] || 'fable', builderModel = flags['builder-model'] || 'sonnet';
const file = join(DEPT_DIR, `${slug}.md`);
if (existsSync(file)) { console.error(`${file} exists already: edit it, or pick another slug`); process.exit(1); }

// ownership must be unique before anything is written
const existing = parseCharters();
for (const p of lists.owns) {
  const owner = existing.find(c => c.owns.includes(p));
  if (owner) { console.error(`refusing: ${p} is owned by ${owner.slug}`); process.exit(1); }
}

const date = new Date().toISOString().slice(0, 10);
const bullets = (list, empty) => (list.length ? list.map(l => `- ${l}`) : [`- ${empty}`]).join('\n');
const fill = {
  NAME: name, SLUG: slug, DATE: date, MISSION: mission, HEAD_MODEL: headModel, BUILDER_MODEL: builderModel,
  OWNS: lists.owns.map(p => `- \`${p}\``).join('\n'),
  RULES: lists.rules.map(l => `- ${l}`).join('\n'),
  PROOF: bullets(lists.proof, 'to be written by the head session in its first turn: the gate command and what its green output says.'),
  DECISIONS: bullets(lists.decisions, 'DECISIONS 33 (departments).'),
  OPEN: bullets(lists.open, 'none yet.'),
};
let text = readFileSync(join(DEPT_DIR, 'TEMPLATE.md'), 'utf8');
for (const [k, v] of Object.entries(fill)) text = text.split(`{{${k}}}`).join(v);
text = text.replace(/\n{3,}/g, '\n\n');
const row = `| ${slug} | ${name} | ${headModel} | ${builderModel} per slice | ${lists.owns.join(', ')} |`;

if (flags['dry-run']) { console.log(`DRY RUN: would write ${file} and add the row:\n${row}`); process.exit(0); }
writeFileSync(file, text, 'utf8');
const readmePath = join(DEPT_DIR, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
writeFileSync(readmePath, readme.replace(/\s*$/, '\n') + row + '\n', 'utf8');

const check = spawnSync(process.execPath, [join(ROOT, 'tools', 'departments', 'check.mjs')], { encoding: 'utf8', timeout: 60000, env: process.env });
if (check.status !== 0) {
  unlinkSync(file);
  writeFileSync(readmePath, readme, 'utf8');
  console.error(`check failed, nothing kept:\n${(check.stdout + check.stderr).trim()}`);
  process.exit(1);
}
console.log(`OK: wrote docs/departments/${slug}.md and its README row; check passed`);
