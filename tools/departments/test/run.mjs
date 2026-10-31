// Tests for the department tools: check.mjs (the wall) and new-department.mjs (the scaffold), on a COPY of docs/departments in
// a temp folder (OMNIKOM_DEPT_DIR), so the real charters are never touched.
//   node tools/departments/test/run.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_DEPT_TOOLS points at a copy of the tools (test/mutate.mjs runs one broken copy at a time).
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_DEPT_TOOLS ? resolve(process.env.OMNIKOM_DEPT_TOOLS) : resolve(HERE, '..');
const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(HERE, '..', '..', '..');
const REAL = join(REPO, 'docs', 'departments');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };
const run = (script, args, dir) => { const r = spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, OMNIKOM_DEPT_DIR: dir, OMNIKOM_REPO_ROOT: REPO } }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'omnikom-depts-')); cpSync(REAL, d, { recursive: true }); return d; };
const edit = (dir, file, from, to) => { const p = join(dir, file); const t = readFileSync(p, 'utf8'); if (!t.includes(from)) throw new Error(`${file}: text not found: ${from.slice(0, 60)}`); writeFileSync(p, t.split(from).join(to), 'utf8'); };

const dirs = [];
try {
  // the real charters pass
  let d = fresh(); dirs.push(d);
  let r = run('check.mjs', [], d);
  check('check: the real charters are valid', r.status === 0 && /^OK: \d+ charter/.test(r.out), r.out);

  // a missing required section is a problem
  d = fresh(); dirs.push(d);
  edit(d, 'cli-and-testing.md', '## Proof', '## Proofs');
  r = run('check.mjs', [], d);
  check('check: a missing required section fails', r.status === 1 && /missing section "## Proof"/.test(r.out), r.out);

  // a path owned by two charters is a problem
  d = fresh(); dirs.push(d);
  edit(d, 'platform-build.md', '- `factory/`', '- `factory/`\n- `tools/omnikom-cli/`');
  r = run('check.mjs', [], d);
  check('check: a path owned by two charters fails', r.status === 1 && /tools\/omnikom-cli\/ is owned by both/.test(r.out), r.out);

  // a child path under another department's parent, without an exception, is a problem
  d = fresh(); dirs.push(d);
  edit(d, 'platform-build.md', '- `docs/blueprint/` except `docs/blueprint/26-PLATFORM-CLI.md`', '- `docs/blueprint/`');
  r = run('check.mjs', [], d);
  check('check: a child path under another department without an "except" fails', r.status === 1 && /lies under docs\/blueprint/.test(r.out), r.out);

  // a charter missing from the README table, and a README row without a charter
  d = fresh(); dirs.push(d);
  edit(d, 'README.md', '| cli-and-testing |', '| cli-and-tests |');
  r = run('check.mjs', [], d);
  check('check: README table and charters must match both ways', r.status === 1 && /no row for cli-and-testing/.test(r.out) && /lists cli-and-tests but/.test(r.out), r.out);

  // an unknown model, an empty position log, an em dash
  d = fresh(); dirs.push(d);
  edit(d, 'platform-build.md', '- Model: opus (DECISIONS 40). A standing head from step 4', '- Model: gpt. A standing head from step 4');
  { const p = join(d, 'cli-and-testing.md'); const t = readFileSync(p, 'utf8'); writeFileSync(p, t.replace(/(## Position log[^\n]*\n)[\s\S]*$/, '$1- department created.\n'), 'utf8'); }   // the whole log, undated
  edit(d, 'head-of-operations.md', 'Never build.', 'Never build ' + String.fromCharCode(0x2014) + ' ever.');
  r = run('check.mjs', [], d);
  check('check: unknown model, undated log, em dash are each a problem', r.status === 1 && /unknown head model gpt/.test(r.out) && /position log has no dated line/.test(r.out) && /contains an em dash/.test(r.out), r.out);

  // a head that names nobody to report to, builders without the finding line
  d = fresh(); dirs.push(d);
  edit(d, 'cli-and-testing.md', 'reports to the head of\n  operations in two lines', 'reports in two lines');
  edit(d, 'platform-build.md', '"anything outside this brief is a finding you send back, not a fix"', '"stay inside the brief"');
  r = run('check.mjs', [], d);
  edit(d, 'seo-and-audits.md', 'haiku', 'hayku');
  check('check: a head with nobody to report to, builders without the finding line, builders without a haiku runner, each fail', r.status === 1 && /does not say whom it reports to/.test(r.out) && /finding you send back/.test(r.out) && (run('check.mjs', [], d).out.includes('does not name haiku')), r.out);

  // new-department: dry run writes nothing
  d = fresh(); dirs.push(d);
  r = run('new-department.mjs', ['--slug', 'design-lab', '--name', 'Design lab', '--mission', 'Audit gates.', '--owns', 'tools/design-lab/', '--dry-run'], d);
  check('new-department: --dry-run prints the row and writes nothing', r.status === 0 && /DRY RUN/.test(r.out) && !existsSync(join(d, 'design-lab.md')), r.out);

  // new-department: a real scaffold passes the check and lands in the README
  r = run('new-department.mjs', ['--slug', 'design-lab', '--name', 'Design lab', '--mission', 'Audit gates.', '--owns', 'tools/design-lab/', '--rules', 'Public data only.', '--open', 'first slice: heading structure gate'], d);
  const written = existsSync(join(d, 'design-lab.md')) ? readFileSync(join(d, 'design-lab.md'), 'utf8') : '';
  check('new-department: writes the charter from the template with every placeholder filled', r.status === 0 && written.includes('# Department: Design lab (`design-lab`)') && !/\{\{[A-Z_]+\}\}/.test(written) && written.includes('- `tools/design-lab/`') && written.includes('- Public data only.') && written.includes('first slice: heading structure gate'), r.out);
  check('new-department: adds the README row and the tree passes the check', /\| seo-and-audits \| SEO and audits \| opus \| sonnet per slice \|/.test(readFileSync(join(d, 'README.md'), 'utf8')) && run('check.mjs', [], d).status === 0);
  // the same slug again is refused; a path owned elsewhere is refused and nothing is written
  r = run('new-department.mjs', ['--slug', 'design-lab', '--name', 'x', '--mission', 'x', '--owns', 'x/'], d);
  check('new-department: an existing slug is refused', r.status === 1 && /exists already/.test(r.out), r.out);
  r = run('new-department.mjs', ['--slug', 'other', '--name', 'x', '--mission', 'x', '--owns', 'tools/omnikom-cli/'], d);
  check('new-department: a path owned by another charter is refused before writing', r.status === 1 && /owned by cli-and-testing/.test(r.out) && !existsSync(join(d, 'other.md')), r.out);
  // a child of another department's path passes the pre-check but fails the full check: the file is removed again
  r = run('new-department.mjs', ['--slug', 'other', '--name', 'x', '--mission', 'x', '--owns', 'supabase/functions/'], d);
  check('new-department: a charter the check refuses is removed again, README restored', r.status === 1 && /check failed, nothing kept/.test(r.out) && !existsSync(join(d, 'other.md')) && !/\| other \|/.test(readFileSync(join(d, 'README.md'), 'utf8')), r.out);
  r = run('new-department.mjs', ['--slug', 'Bad Slug', '--name', 'x', '--mission', 'x', '--owns', 'x/'], d);
  check('new-department: a bad slug is a usage error (exit 2)', r.status === 2);
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
