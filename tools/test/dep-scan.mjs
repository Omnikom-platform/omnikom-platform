// Dependency scan (hardening step H2-10, book row E17): runs the pinned osv-scanner over every lockfile the platform installs from and
// fails when a package in one has a known vulnerability or is malicious. Fails closed: a scanner that is missing, is not the pinned
// version, crashes, or prints something that does not parse is exit 2, never a pass.
//   node tools/test/dep-scan.mjs [--osv <path>] [--allow <file>] [--root <dir>] [--today YYYY-MM-DD]
// Exit 0 = no finding that is not allowed; 1 = a finding; 2 = the scan could not be trusted. The binary is, in order: --osv, the
// OSV_SCANNER variable, <root>/.tools/bin/osv-scanner (omnikom tools ensure), then osv-scanner on PATH.
// Allowed findings: tools/test/dep-scan-allow.json, [{ "id", "package", "reason", "until": "YYYY-MM-DD" }], at most 30 days ahead; a MAL- id is never allowed.
// The verdict is the pure functions below (tests: tools/test/test-dep-scan.mjs, mutants: tools/test/mutate-dep-scan.mjs).
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const LOCKFILES = ['apps/dashboard/package-lock.json', 'factory/runner/package-lock.json', 'tools/site-backup/package-lock.json', 'deno.lock'];
export const MAX_ALLOW_DAYS = 30;
const DAY_MS = 86400000;
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// osv-scanner's `--format json` output -> { ok, findings: [{ package, version, id, summary, mal }] } or { ok: false, reason }
export function parseOsv(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, reason: 'its output is not JSON' }; }
  if (!j || typeof j !== 'object' || !Array.isArray(j.results)) return { ok: false, reason: 'its JSON has no "results" array' };
  const findings = [];
  for (const r of j.results) {
    if (!r || !Array.isArray(r.packages)) return { ok: false, reason: 'a result has no "packages" array' };
    for (const p of r.packages) {
      const pk = p && p.package;
      if (!pk || typeof pk.name !== 'string' || typeof pk.version !== 'string') return { ok: false, reason: 'a package entry has no name or version' };
      const vulns = p.vulnerabilities === undefined ? [] : p.vulnerabilities;
      if (!Array.isArray(vulns)) return { ok: false, reason: `the vulnerabilities of ${pk.name} are not a list` };
      for (const v of vulns) {
        if (!v || typeof v.id !== 'string' || !v.id) return { ok: false, reason: `a vulnerability of ${pk.name} has no id` };
        const ids = [v.id, ...(Array.isArray(v.aliases) ? v.aliases.filter(a => typeof a === 'string') : [])];
        findings.push({ package: pk.name, version: pk.version, id: v.id, summary: typeof v.summary === 'string' ? v.summary : '', mal: ids.some(i => i.startsWith('MAL-')) });
      }
    }
  }
  return { ok: true, findings };
}

// One osv-scanner run { exit, stdout, error }. It exits 1 when it finds something, so the JSON is read, not only the code.
export function judgeRun(run) {
  if (run.error) return { ok: false, reason: `osv-scanner did not run: ${run.error}` };
  if (run.exit !== 0 && run.exit !== 1) return { ok: false, reason: `osv-scanner exited ${run.exit}` };
  const p = parseOsv(run.stdout);
  if (!p.ok) return { ok: false, reason: `osv-scanner ${p.reason}` };
  if (run.exit === 1 && p.findings.length === 0) return { ok: false, reason: 'osv-scanner exited 1 (it found something) but its JSON lists nothing' };
  return { ok: true, findings: p.findings };
}

export function checkAllow(allow, today) {
  if (typeof allow === 'string') return { ok: false, reason: allow };
  if (!Array.isArray(allow)) return { ok: false, reason: 'the allow file must be a JSON array' };
  const latest = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_ALLOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const [i, e] of allow.entries()) {
    const at = `allow entry ${i + 1}`;
    if (!e || typeof e !== 'object') return { ok: false, reason: `${at} is not an object` };
    for (const k of ['id', 'package', 'reason']) if (typeof e[k] !== 'string' || !e[k].trim()) return { ok: false, reason: `${at} has no ${k}` };
    if (!validDate(e.until)) return { ok: false, reason: `${at} (${e.id}) has no until date as YYYY-MM-DD` };
    if (e.until > latest) return { ok: false, reason: `${at} (${e.id}) runs to ${e.until}, more than ${MAX_ALLOW_DAYS} days after ${today}` };
  }
  return { ok: true, entries: allow };
}

// runs: [{ file, osv: { exit, stdout, error } | null, fail?: reason, notCovered?: [reason] }]; allow: the parsed array, or a string saying why it could not be read
export function evaluate({ runs, allow, today }) {
  const lines = [];
  let errors = 0, findings = 0, allowed = 0, notAllowed = 0, scanned = 0;
  const a = checkAllow(allow, today);
  if (!a.ok) { errors++; lines.push(`dep-scan: allow file ERROR ${a.reason}`); }
  const entries = a.ok ? a.entries : [];
  for (const e of entries) if (e.until < today) lines.push(`dep-scan: allow entry ${e.id} expired ${e.until}`);
  for (const r of runs) {
    for (const reason of r.notCovered || []) lines.push(`dep-scan: ${r.file} NOT COVERED (${reason})`);
    if (r.fail) { errors++; lines.push(`dep-scan: ${r.file} ERROR ${r.fail}`); continue; }
    if (!r.osv) continue;
    const j = judgeRun(r.osv);
    if (!j.ok) { errors++; lines.push(`dep-scan: ${r.file} ERROR ${j.reason}`); continue; }
    scanned++;
    for (const f of j.findings) {
      findings++;
      const hit = f.mal ? null : entries.find(e => e.id === f.id && e.until >= today && (e.package === f.package || e.package === `${f.package}@${f.version}`));
      if (hit) allowed++; else notAllowed++;
      const tag = f.mal ? ' [MAL: never allowed]' : hit ? ` [allowed until ${hit.until}: ${hit.reason}]` : '';
      lines.push(`dep-scan: ${r.file} ${f.package}@${f.version} ${f.id} ${f.summary.replace(/\s+/g, ' ').slice(0, 80)}${tag}`);
    }
  }
  if (scanned === 0) { errors++; lines.push('dep-scan: ERROR no lockfile was scanned'); }
  lines.push(`dep-scan: ${scanned} lockfile(s), ${findings} finding(s), ${allowed} allowed`);
  return { lines, exit: errors ? 2 : notAllowed ? 1 : 0 };
}

// deno.lock is not a format osv-scanner reads. Its npm entries become a minimal package-lock.json (one node_modules/<name> per package);
// jsr and https entries cannot be scanned and are named as NOT COVERED.
export function denoToPackageLock(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, reason: 'deno.lock is not JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, reason: 'deno.lock is not a JSON object' };
  const packages = { '': { name: 'deno-lock', version: '0.0.0' } };
  const seen = new Set();
  let npm = 0;
  for (const key of Object.keys(j.npm || {})) {
    const m = /^(@[^/@]+\/[^@]+|[^@]+)@([^_@]+)/.exec(key);   // name@version, an optional _peer suffix is dropped
    if (!m) return { ok: false, reason: `deno.lock npm entry '${key}' is not name@version` };
    const [, name, version] = m;
    // osv-scanner reads a package-lock.json entry that has no "resolved" as a local link and reports nothing for it (measured with 2.7.0:
    // lodash 4.17.15 without it: 0 findings, with it: 5), so every entry carries the registry url npm would have written
    const resolved = `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
    packages[seen.has(name) ? `node_modules/_deno${npm}/node_modules/${name}` : `node_modules/${name}`] = { version, resolved };
    seen.add(name);
    npm++;
  }
  const notCovered = [];
  for (const key of Object.keys(j.jsr || {})) notCovered.push(`jsr:${key}: osv-scanner has no reader for jsr packages`);
  for (const key of Object.keys(j.remote || {})) notCovered.push(`${key}: osv-scanner has no reader for https imports`);
  return { ok: true, npm, lock: { name: 'deno-lock', lockfileVersion: 3, requires: true, packages }, notCovered };
}

export function runOsv(osv, args, cwd) {
  const js = /\.m?js$/.test(osv);   // a .mjs stands in for the binary in the tests
  const r = spawnSync(js ? process.execPath : osv, js ? [osv, ...args] : args, { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { exit: r.status, stdout: r.stdout || '', error: r.error ? String(r.error.message).slice(0, 120) : r.signal ? `killed by ${r.signal}` : undefined };
}

function findOsv(argv, root) {
  const flag = argv.indexOf('--osv');
  if (flag >= 0) return argv[flag + 1] || '';
  if (process.env.OSV_SCANNER) return process.env.OSV_SCANNER;
  for (const n of ['osv-scanner.exe', 'osv-scanner']) { const p = join(root, '.tools', 'bin', n); if (existsSync(p)) return p; }
  return 'osv-scanner';
}

export function main(argv) {
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(opt('--root') || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const today = opt('--today') || new Date().toISOString().slice(0, 10);
  if (!validDate(today)) { console.log(`dep-scan: ERROR --today ${today} is not YYYY-MM-DD`); return 2; }
  const osv = findOsv(argv, root);
  let want = '';
  try { want = JSON.parse(readFileSync(join(root, 'tools', 'omnikom-cli', 'tools.json'), 'utf8')).tools['osv-scanner'].version; } catch { /* reported below */ }
  if (!want) { console.log('dep-scan: ERROR tools.json names no osv-scanner version'); return 2; }
  const v = runOsv(osv, ['--version'], root);
  const have = (/osv-scanner version:\s*(\S+)/.exec(v.stdout) || [])[1];
  if (v.error || v.exit !== 0 || have !== want) { console.log(`dep-scan: ERROR osv-scanner ${have || 'did not answer --version'}${v.error ? ` (${v.error})` : ''} is not the pinned ${want} (omnikom tools ensure osv-scanner)`); return 2; }

  let allow;
  const allowFile = resolve(opt('--allow') || join(root, 'tools', 'test', 'dep-scan-allow.json'));
  try { allow = JSON.parse(readFileSync(allowFile, 'utf8')); } catch (e) { allow = `${allowFile} is not readable JSON (${String(e.message).slice(0, 80)})`; }

  const tmp = mkdtempSync(join(tmpdir(), 'dep-scan-'));
  const runs = [];
  try {
    for (const file of LOCKFILES) {
      const abs = join(root, file);
      if (!existsSync(abs)) { runs.push({ file, fail: 'the lockfile is missing' }); continue; }
      if (file !== 'deno.lock') { runs.push({ file, osv: runOsv(osv, ['scan', 'source', '--lockfile', abs, '--format', 'json'], root) }); continue; }
      const d = denoToPackageLock(readFileSync(abs, 'utf8'));
      if (!d.ok) { runs.push({ file, fail: d.reason }); continue; }
      if (d.npm === 0) { runs.push({ file, notCovered: [...d.notCovered, 'it holds no npm package'] }); continue; }
      const dir = mkdtempSync(join(tmp, 'deno-'));
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(d.lock));
      runs.push({ file, notCovered: d.notCovered, osv: runOsv(osv, ['scan', 'source', '--lockfile', join(dir, 'package-lock.json'), '--format', 'json'], dir) });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const res = evaluate({ runs, allow, today });
  console.log(res.lines.join('\n'));
  return res.exit;
}

// main only when run directly; realpaths, because a junction or symlink would make a plain compare false and the script would exit 0 silently
const direct = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1] || '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (direct) process.exitCode = main(process.argv.slice(2));
