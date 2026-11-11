// ci-skill.mjs: the step of the ci.yml job seo-skill: the SEO skill's own test suite, when the change touches the skill.
//   node tools/omnikom-cli/test/ci-skill.mjs
// skills/programmatic-enterprise-web-performance has 28 test-*.mjs and its mutant runners, and no CI gated them (the SEO head, 2026-11-11 03:30;
// head of operations, 03:31). Its runner scripts/run-all-tests.sh runs every scripts/test-*.mjs and scripts/mutants-research.mjs one by one,
// writes one log each and <out>/summary.txt (`<name> exit=<code> secs=<n>` per line, then DONE) and always exits 0: it interprets nothing, so
// this script reads the summary. Same shape as test/ci-team-kit.mjs: the job always starts (`omnikom ci` models no `paths:` or `if:`; land
// expects every ci.yml job by name) and this script decides from the change's files (lib/ci-base.mjs, fetch-depth 0).
//   needed    any changed file under the skill folder, or .github/workflows/ci.yml, or this script, or lib/ci-base.mjs. No usable base means
//             run (fail safe); master itself has nothing changed, so it skips.
//   then      sh scripts/run-all-tests.sh <absolute out dir> in the skill folder (the runner cds there after making the folder, so the path must
//             be absolute), then summary.txt: every line must say exit=0 and the last line must be DONE; at least one test must have run.
//             A failing test's log tail (last 40 lines) is printed. Exit 0 all green, 1 any test red or a broken summary.
//   otherwise prints "ci-skill: not needed (<reason>)" and exits 0 at once.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedSinceBase } from '../lib/ci-base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = 'skills/programmatic-enterprise-web-performance/';
const CI_YML = '.github/workflows/ci.yml';
const OWN = ['tools/omnikom-cli/test/ci-skill.mjs', 'tools/omnikom-cli/lib/ci-base.mjs'];

// -> { needed, reason }   (never throws: anything unreadable means needed)
export function decide({ repo, env = process.env }) {
  const c = changedSinceBase({ repo, env });
  if (!c.ok) return { needed: true, reason: c.reason };
  const hit = c.changed.filter(f => f.startsWith(SKILL_DIR) || f === CI_YML || OWN.includes(f));
  if (hit.length) return { needed: true, reason: hit.slice(0, 5).join(', ') };
  return { needed: false, reason: `${c.changed.length} changed files, none under ${SKILL_DIR}` };
}

// summary.txt -> { ok, ran, failed: [{name, exit}], problems: [] }
export function readSummary(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const problems = [], failed = [];
  if (!lines.length || lines[lines.length - 1] !== 'DONE') problems.push('summary.txt does not end with DONE (the runner stopped early)');
  const rows = lines.filter(l => l !== 'DONE');
  for (const l of rows) {
    const m = /^(\S+) exit=(\d+) secs=\d+$/.exec(l);
    if (!m) { problems.push(`summary.txt line not understood: ${l.slice(0, 120)}`); continue; }
    if (m[2] !== '0') failed.push({ name: m[1], exit: Number(m[2]) });
  }
  if (!rows.length) problems.push('no test ran');
  return { ok: !problems.length && !failed.length, ran: rows.length, failed, problems };
}

// -> the exit code. `spawn` runs the child (a test hands a fake); `log` prints a line; `outDir` is where the logs go. Any argument is usage (2).
export function ciSkill({ repo, env = process.env, spawn = spawnSync, log = console.log, argv = [], outDir } = {}) {
  if (argv.length) { log(`ci-skill: usage: no arguments (got ${argv.join(' ')})`); return 2; }
  const v = decide({ repo, env });
  if (!v.needed) { log(`ci-skill: not needed (${v.reason})`); return 0; }
  log(`ci-skill: needed (${v.reason})`);
  const skill = join(repo, SKILL_DIR);
  const out = outDir || mkdtempSync(join(tmpdir(), 'ci-skill-'));
  const r = spawn('sh', [join(skill, 'scripts', 'run-all-tests.sh'), out], { cwd: skill, env, stdio: 'inherit', timeout: 3 * 3600 * 1000, windowsHide: true });
  if (r.error) { log(`ci-skill: run-all-tests.sh could not start (${r.error.message})`); return 1; }
  const file = join(out, 'summary.txt');
  const s = readSummary(existsSync(file) ? readFileSync(file, 'utf8') : '');
  for (const p of s.problems) log(`ci-skill: FAIL ${p}`);
  for (const f of s.failed) {
    log(`ci-skill: FAIL ${f.name} exit=${f.exit}; the last lines of its log:`);
    const lf = join(out, `${f.name}.log`);
    const tail = existsSync(lf) ? readFileSync(lf, 'utf8').split(/\r?\n/).slice(-40) : ['(no log file)'];
    for (const l of tail) log(`  ${l}`);
  }
  log(s.ok ? `ci-skill: ${s.ran} skill test file(s) passed` : `ci-skill: ${s.failed.length} of ${s.ran} skill test file(s) failed${s.problems.length ? `, ${s.problems.length} summary problem(s)` : ''}`);
  return s.ok ? 0 : 1;
}

const isMain = (() => { try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exitCode = ciSkill({ repo: resolve(HERE, '..', '..', '..'), argv: process.argv.slice(2) });
