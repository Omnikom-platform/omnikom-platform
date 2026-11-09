// Tests for clients/check.mjs on a COPY of clients/ in a temp folder (CLIENTS_DIR), so the real records are never touched.
//   node clients/test/run.mjs    exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// Each case after the first is a mutant: it breaks one thing and expects the check red for that reason.
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = resolve(HERE, '..');
const CHECK = join(REAL, 'check.mjs');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };
const run = (dir) => { const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', timeout: 60000, env: { ...process.env, CLIENTS_DIR: dir } }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'omnikom-clients-')); cpSync(REAL, d, { recursive: true, filter: (s) => !s.includes(`${REAL}${process.platform === 'win32' ? '\\' : '/'}test`) }); return d; };
const edit = (dir, file, from, to) => { const p = join(dir, file); const t = readFileSync(p, 'utf8'); if (!t.includes(from)) throw new Error(`${file}: text not found: ${from.slice(0, 60)}`); writeFileSync(p, t.split(from).join(to), 'utf8'); };

const dirs = [];
try {
  let d = fresh(); dirs.push(d);
  let r = run(d);
  check('the real records pass', r.status === 0 && /^OK: \d+ client record/.test(r.out), r.out);

  d = fresh(); dirs.push(d);
  unlinkSync(join(d, 'elev8', 'sites.md'));
  r = run(d);
  check('mutant: a missing record file fails', r.status === 1 && /elev8: missing sites\.md/.test(r.out), r.out);

  d = fresh(); dirs.push(d);
  mkdirSync(join(d, 'ghost'));
  for (const f of ['profile.md', 'decisions.md', 'sites.md', 'facts.md', 'status.md']) writeFileSync(join(d, 'ghost', f), '| Fact | Value | Source | Verified on |\n|---|---|---|---|\n| x | y | z | w |\n');
  r = run(d);
  check('mutant: a client folder not listed in README fails', r.status === 1 && /ghost: not listed in README\.md/.test(r.out), r.out);

  d = fresh(); dirs.push(d);
  edit(d, 'README.md', '| elev8 | ELEV8 Real Estate Group', '| elev8 | ELEV8 Real Estate Group (x) | real estate |  |\n| zzz-unused | ELEV8 Real Estate Group');
  r = run(d);
  check('mutant: an empty README status line fails', r.status === 1 && /elev8: README\.md row has an empty status line/.test(r.out), r.out);

  d = fresh(); dirs.push(d);
  edit(d, join('elev8', 'facts.md'), '| `facts\\PROFILE.md` "Licence"; https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=02248556 |', '|  |');
  r = run(d);
  check('mutant: a facts row without a source fails', r.status === 1 && /elev8: facts\.md ledger row 1 .* has no source/.test(r.out), r.out);

  d = fresh(); dirs.push(d);
  edit(d, join('elev8', 'status.md'), '# ELEV8 Real Estate Group: status', '# ELEV8 Real Estate Group — status');
  r = run(d);
  check('mutant: an em dash fails', r.status === 1 && /status\.md: contains an em dash/.test(r.out), r.out);
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(`${failed ? 'FAIL' : 'PASS'} clients tests: ${total - failed} of ${total}`);
process.exit(failed ? 1 : 0);
