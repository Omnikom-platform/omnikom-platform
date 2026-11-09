// Proof for tools/test/dep-scan.mjs: the verdict functions on fixture osv-scanner JSON (no network), then the whole script against a fake
// osv-scanner (a .mjs standing in for the binary) in a scratch root. Run: node tools/test/test-dep-scan.mjs
// DEP_SCAN_UNDER_TEST points at a mutated copy of dep-scan.mjs (tools/test/mutate-dep-scan.mjs).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUT = process.env.DEP_SCAN_UNDER_TEST || join(HERE, 'dep-scan.mjs');
const { parseOsv, judgeRun, checkAllow, evaluate, denoToPackageLock, LOCKFILES } = await import(pathToFileURL(SUT).href);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + detail}`); if (!ok) failed++; };
const TODAY = '2026-11-09';

// osv-scanner 2.7.0 `--format json`, trimmed to the keys the script reads (a real run on lodash 4.17.15, 2026-11-09; ids and summaries are real)
const osvJson = pkgs => JSON.stringify({ results: pkgs.length ? [{ source: { path: 'package-lock.json', type: 'lockfile' }, packages: pkgs.map(p => ({ package: { name: p.name, version: p.version, ecosystem: 'npm' }, groups: [], vulnerabilities: p.vulns })) }] : [], experimental_config: { licenses: { summary: false, allowlist: null } } });
const LODASH = { name: 'lodash', version: '4.17.15', vulns: [
  { id: 'GHSA-29mw-wpgm-hmr9', summary: 'Regular Expression Denial of Service (ReDoS) in lodash', aliases: ['CVE-2020-28500'] },
  { id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', aliases: ['CVE-2021-23337'] }] };
const ONE = { name: 'lodash', version: '4.17.15', vulns: [LODASH.vulns[1]] };
const MAL = { name: 'evil-pkg', version: '1.0.0', vulns: [{ id: 'MAL-2026-1234', summary: 'Malicious code in evil-pkg (npm)', aliases: [] }] };
const MALALIAS = { name: 'evil-pkg', version: '1.0.0', vulns: [{ id: 'GHSA-aaaa-bbbb-cccc', summary: 'Embedded malware', aliases: ['MAL-2026-9999'] }] };
const run = (stdout, exit = 0, error) => ({ exit, stdout, error });
const ev = (osvs, allow = [], today = TODAY) => evaluate({ runs: osvs.map((o, i) => ({ file: `lock${i + 1}.json`, osv: o })), allow, today });
const allowOf = (over = {}) => ({ id: 'GHSA-35jh-r3h4-6jhm', package: 'lodash', reason: 'dev-only, upgrade queued', until: '2026-11-20', ...over });

// ---- verdicts on fixture JSON
let r = ev([run(osvJson([]))]);
check('clean: exit 0 and the summary line', r.exit === 0 && r.lines.join('\n') === 'dep-scan: 1 lockfile(s), 0 finding(s), 0 allowed', r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)]);
check('one vulnerability: exit 1 and the finding line "<lockfile> <package>@<version> <id> <summary>"', r.exit === 1 && r.lines[0] === 'dep-scan: lock1.json lodash@4.17.15 GHSA-35jh-r3h4-6jhm Command Injection in lodash' && r.lines[1] === 'dep-scan: 1 lockfile(s), 1 finding(s), 0 allowed', r.lines.join(' | '));
r = ev([run(osvJson([LODASH]), 1)]);
check('two vulnerabilities of one package are two lines', r.exit === 1 && r.lines.filter(l => l.includes(' GHSA-')).length === 2 && /2 finding\(s\)/.test(r.lines.at(-1)), r.lines.join(' | '));
r = ev([run(osvJson([{ name: 'p', version: '1.0.0', vulns: [{ id: 'GHSA-x', summary: 'a'.repeat(200), aliases: [] }] }]), 1)]);
check('the summary is cut at 80 characters', r.lines[0].endsWith(' ' + 'a'.repeat(80)), r.lines[0]);
r = ev([run(osvJson([MAL]), 1)]);
check('a MAL- id fails and the line says it is never allowed', r.exit === 1 && /\[MAL: never allowed\]/.test(r.lines[0]), r.lines.join(' | '));
r = ev([run(osvJson([MAL]), 1)], [allowOf({ id: 'MAL-2026-1234', package: 'evil-pkg' })]);
check('a MAL- id is not allowed even with a valid allow entry', r.exit === 1 && /0 allowed/.test(r.lines.at(-1)), r.lines.join(' | '));
r = ev([run(osvJson([MALALIAS]), 1)], [allowOf({ id: 'GHSA-aaaa-bbbb-cccc', package: 'evil-pkg' })]);
check('a MAL- id among the aliases counts as malicious too', r.exit === 1 && /\[MAL: never allowed\]/.test(r.lines[0]), r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf()]);
check('an allowed vulnerability: exit 0, the line shows until and reason, "1 allowed"', r.exit === 0 && /\[allowed until 2026-11-20: dev-only, upgrade queued\]$/.test(r.lines[0]) && r.lines.at(-1) === 'dep-scan: 1 lockfile(s), 1 finding(s), 1 allowed', r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf({ package: 'lodash@4.17.15' })]);
check('an allow entry may name package@version', r.exit === 0, r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf({ package: 'lodash@4.17.16' })]);
check('an allow entry for another version of the package does not allow', r.exit === 1, r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf({ package: 'underscore' })]);
check('an allow entry for another package does not allow', r.exit === 1, r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf({ id: 'GHSA-29mw-wpgm-hmr9' })]);
check('an allow entry for another id does not allow', r.exit === 1, r.lines.join(' | '));
r = ev([run(osvJson([LODASH]), 1)], [allowOf()]);
check('one of two findings allowed: exit 1, "2 finding(s), 1 allowed"', r.exit === 1 && /2 finding\(s\), 1 allowed/.test(r.lines.at(-1)), r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf({ until: '2026-11-08' })]);
check('an expired allow entry does not allow (exit 1)', r.exit === 1 && /0 allowed/.test(r.lines.at(-1)), r.lines.join(' | '));
check('an expired allow entry is printed "allow entry <id> expired <date>"', r.lines.includes('dep-scan: allow entry GHSA-35jh-r3h4-6jhm expired 2026-11-08'), r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1)], [allowOf({ until: TODAY })]);
check('an allow entry whose until is today still allows', r.exit === 0, r.lines.join(' | '));
for (const [why, over] of [['more than 30 days ahead', { until: '2026-12-10' }], ['no reason', { reason: ' ' }], ['a date that is not YYYY-MM-DD', { until: '20-11-2026' }], ['an impossible date', { until: '2026-02-31' }], ['no id', { id: '' }]]) {
  r = ev([run(osvJson([]))], [allowOf(over)]);
  check(`an allow file with ${why} is exit 2`, r.exit === 2 && /allow file ERROR/.test(r.lines[0]), r.lines.join(' | '));
}
check('an allow entry exactly 30 days ahead is valid', checkAllow([allowOf({ until: '2026-12-09' })], TODAY).ok === true);
r = ev([run(osvJson([]))], {});
check('an allow file that is not an array is exit 2', r.exit === 2, r.lines.join(' | '));
r = ev([run(osvJson([]))], 'allow.json is not readable JSON (x)');
check('an unreadable allow file is exit 2 and says why', r.exit === 2 && /allow file ERROR allow\.json is not readable/.test(r.lines[0]), r.lines.join(' | '));

// ---- osv-scanner's own failures are never a pass
r = ev([run('this is not json', 0)]);
check('unparsable output (exit 0) is exit 2', r.exit === 2 && /ERROR osv-scanner its output is not JSON/.test(r.lines[0]), r.lines.join(' | '));
r = ev([run('', 0)]);
check('empty output is exit 2', r.exit === 2, r.lines.join(' | '));
r = ev([run('{"results":{}}', 0)]);
check('JSON without a results array is exit 2', r.exit === 2, r.lines.join(' | '));
r = ev([run('{"results":[{"packages":[{"package":{"name":"p"}}]}]}', 1)]);
check('a package entry without a version is exit 2', r.exit === 2, r.lines.join(' | '));
r = ev([run('', 127)]);
check('osv-scanner exit 127 (a crash) is exit 2', r.exit === 2 && /exited 127/.test(r.lines[0]), r.lines.join(' | '));
r = ev([run('', 128)]);
check('osv-scanner exit 128 (no packages found) is exit 2', r.exit === 2, r.lines.join(' | '));
r = ev([run('', null, 'spawn osv-scanner ENOENT')]);
check('osv-scanner not found is exit 2', r.exit === 2 && /did not run/.test(r.lines[0]), r.lines.join(' | '));
r = ev([run(osvJson([]), 1)]);
check('exit 1 with a JSON that lists nothing is exit 2 (the two disagree)', r.exit === 2, r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 0)]);
check('exit 0 with findings in the JSON is still exit 1 (the JSON is read, not only the code)', r.exit === 1, r.lines.join(' | '));
r = ev([run(osvJson([ONE]), 1), run('garbage', 0)]);
check('one lockfile with a finding and one unreadable result: exit 2, both reported', r.exit === 2 && r.lines.some(l => l.includes('GHSA-35jh')) && r.lines.some(l => l.includes('lock2.json ERROR')), r.lines.join(' | '));
r = evaluate({ runs: [], allow: [], today: TODAY });
check('nothing scanned at all is exit 2', r.exit === 2, r.lines.join(' | '));
r = evaluate({ runs: [{ file: 'deno.lock', notCovered: ['x'] }], allow: [], today: TODAY });
check('only NOT COVERED lockfiles (nothing scanned) is exit 2', r.exit === 2 && r.lines[0] === 'dep-scan: deno.lock NOT COVERED (x)', r.lines.join(' | '));
r = evaluate({ runs: [{ file: 'a.json', fail: 'the lockfile is missing' }, { file: 'b.json', osv: run(osvJson([])) }], allow: [], today: TODAY });
check('a lockfile that failed to prepare is exit 2', r.exit === 2 && r.lines[0] === 'dep-scan: a.json ERROR the lockfile is missing', r.lines.join(' | '));
check('parseOsv: a package with no vulnerabilities key lists none', parseOsv('{"results":[{"packages":[{"package":{"name":"p","version":"1"}}]}]}').findings.length === 0);

// ---- deno.lock -> package-lock.json
const DENO = JSON.stringify({ version: '5', specifiers: {}, npm: { 'postgres@3.4.5': { integrity: 'x' }, '@scope/pkg@1.2.3_peer@2.0.0': {}, 'dup@1.0.0': {}, 'dup@2.0.0': {} }, jsr: { '@std/path@1.0.0': {} }, remote: { 'https://deno.land/x/a.ts': 'h' } });
let d = denoToPackageLock(DENO);
check('deno.lock: npm entries become node_modules/<name> with their version (scoped names, peer suffix dropped)', d.ok && d.lock?.lockfileVersion === 3 && d.lock.packages?.['node_modules/postgres']?.version === '3.4.5' && d.lock.packages['node_modules/@scope/pkg']?.version === '1.2.3' && d.npm === 4, JSON.stringify(d.lock));
check('deno.lock: two versions of one name both survive', Object.entries(d.lock?.packages || {}).filter(([k]) => k.endsWith('/dup')).map(([, v]) => v.version).sort().join() === '1.0.0,2.0.0', JSON.stringify(d.lock?.packages));
check('deno.lock: jsr and https entries are named as NOT COVERED', d.notCovered?.length === 2 && d.notCovered.some(n => n.startsWith('jsr:@std/path@1.0.0')) && d.notCovered.some(n => n.startsWith('https://deno.land/x/a.ts')), d.notCovered.join(' | '));
check('deno.lock: every converted entry carries its registry url as "resolved" (osv-scanner skips an entry without it)', d.lock?.packages?.['node_modules/postgres']?.resolved === 'https://registry.npmjs.org/postgres/-/postgres-3.4.5.tgz' && d.lock.packages['node_modules/@scope/pkg']?.resolved === 'https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz', JSON.stringify(d.lock?.packages));
check('deno.lock: not JSON is refused', denoToPackageLock('{nope').ok === false);
check('deno.lock: an npm key that is not name@version is refused', denoToPackageLock('{"npm":{"nonsense":{}}}').ok === false);
check('deno.lock: no npm section is 0 packages, not an error', (d = denoToPackageLock('{"version":"5"}')).ok && d.npm === 0);

// ---- the script against a fake osv-scanner (a mutant already red above skips this part: it is the slow one)
if (!(process.env.DEP_SCAN_UNDER_TEST && failed)) {
const FAKE = `import { readFileSync, appendFileSync } from 'node:fs';
const a = process.argv.slice(2), mode = process.env.FAKE_MODE || 'clean';
if (a[0] === '--version') { console.log('osv-scanner version: ' + (mode === 'wrongversion' ? '1.0.0' : '9.9.9')); process.exit(mode === 'noversion' ? 3 : 0); }
const lock = a[a.indexOf('--lockfile') + 1], text = readFileSync(lock, 'utf8');
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, text + '\\n');
if (mode === 'garbage') { console.log('not json'); process.exit(0); }
if (mode === 'crash') { console.error('boom'); process.exit(127); }
const bad = text.includes('lodash') && text.includes('"resolved"');   // like the real scanner: an entry without "resolved" is not matched
const vulns = [{ id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', aliases: ['CVE-2021-23337'] }];
console.log(JSON.stringify({ results: bad ? [{ source: { path: lock, type: 'lockfile' }, packages: [{ package: { name: 'lodash', version: '4.17.15', ecosystem: 'npm' }, groups: [], vulnerabilities: vulns }] }] : [] }));
process.exit(bad ? 1 : 0);
`;
const scratch = mkdtempSync(join(tmpdir(), 'dep-scan-test-'));
const fake = join(scratch, 'osv-fake.mjs');
writeFileSync(fake, FAKE);
let n = 0;
const mkRoot = ({ lodashIn, deno, allow } = {}) => {
  const root = join(scratch, `root${++n}`);
  for (const f of LOCKFILES) { mkdirSync(join(root, dirname(f)), { recursive: true }); writeFileSync(join(root, f), f === 'deno.lock' ? (deno || '{"version":"5","specifiers":{},"npm":{"postgres@3.4.5":{}}}') : JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...(lodashIn === f ? { 'node_modules/lodash': { version: '4.17.15', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz' } } : {}) } })); }
  mkdirSync(join(root, 'tools', 'omnikom-cli'), { recursive: true });
  writeFileSync(join(root, 'tools', 'omnikom-cli', 'tools.json'), JSON.stringify({ tools: { 'osv-scanner': { version: '9.9.9' } } }));
  writeFileSync(join(root, 'allow.json'), JSON.stringify(allow || []));
  return root;
};
const go = (root, mode = 'clean', extra = [], env = {}) => {
  const p = spawnSync(process.execPath, [SUT, '--root', root, '--osv', fake, '--allow', join(root, 'allow.json'), ...(extra.includes('--today') ? [] : ['--today', TODAY]), ...extra], { encoding: 'utf8', timeout: 60000, env: { ...process.env, FAKE_MODE: mode, ...env } });
  return { code: p.status, out: (p.stdout || '') + (p.stderr || '') };
};
let g = go(mkRoot());
check('script, clean: exit 0, "4 lockfile(s), 0 finding(s), 0 allowed" (three package-lock.json and deno.lock, all scanned)', g.code === 0 && g.out.trim() === 'dep-scan: 4 lockfile(s), 0 finding(s), 0 allowed', `${g.code} ${g.out}`);
g = go(mkRoot({ lodashIn: 'apps/dashboard/package-lock.json' }));
check('script, a finding in one lockfile: exit 1 and the line names that lockfile', g.code === 1 && g.out.includes('dep-scan: apps/dashboard/package-lock.json lodash@4.17.15 GHSA-35jh-r3h4-6jhm Command Injection in lodash'), `${g.code} ${g.out}`);
g = go(mkRoot({ lodashIn: 'apps/dashboard/package-lock.json', allow: [allowOf()] }));
check('script, the allow file is read: the same finding with an entry is exit 0', g.code === 0 && /1 finding\(s\), 1 allowed/.test(g.out), `${g.code} ${g.out}`);
g = go(mkRoot({ lodashIn: 'factory/runner/package-lock.json', allow: [allowOf({ until: '2026-11-01' })] }));
check('script, an expired entry: exit 1 and the "expired" line', g.code === 1 && g.out.includes('dep-scan: allow entry GHSA-35jh-r3h4-6jhm expired 2026-11-01'), `${g.code} ${g.out}`);
let root = mkRoot({ deno: '{"version":"5","specifiers":{},"npm":{"lodash@4.17.15":{}}}' });
const log = join(scratch, 'scanned.log');
g = go(root, 'clean', [], { FAKE_LOG: log });
check('script, deno.lock: its npm entries are scanned as a package-lock.json and a finding is labelled deno.lock', g.code === 1 && g.out.includes('dep-scan: deno.lock lodash@4.17.15 GHSA-35jh-r3h4-6jhm') && existsSync(log) && readFileSync(log, 'utf8').includes('"node_modules/lodash"'), `${g.code} ${g.out}`);
g = go(mkRoot({ deno: '{"version":"5","npm":{"postgres@3.4.5":{}},"jsr":{"@std/path@1.0.0":{}}}' }));
check('script, a jsr entry in deno.lock is printed NOT COVERED by name and does not fail the run', g.code === 0 && g.out.includes('dep-scan: deno.lock NOT COVERED (jsr:@std/path@1.0.0') && /4 lockfile\(s\)/.test(g.out), `${g.code} ${g.out}`);
g = go(mkRoot(), 'garbage');
check('script, osv-scanner printing garbage: exit 2', g.code === 2 && /ERROR osv-scanner its output is not JSON/.test(g.out), `${g.code} ${g.out}`);
g = go(mkRoot(), 'crash');
check('script, osv-scanner crashing (exit 127): exit 2', g.code === 2 && /exited 127/.test(g.out), `${g.code} ${g.out}`);
g = go(mkRoot(), 'wrongversion');
check('script, osv-scanner of another version than tools.json: exit 2 and nothing scanned', g.code === 2 && /1\.0\.0 is not the pinned 9\.9\.9/.test(g.out) && !/lockfile\(s\)/.test(g.out), `${g.code} ${g.out}`);
g = go(mkRoot(), 'noversion');
check('script, osv-scanner whose --version fails: exit 2', g.code === 2, `${g.code} ${g.out}`);
root = mkRoot();
g = spawnSync(process.execPath, [SUT, '--root', root, '--osv', join(scratch, 'does-not-exist.exe'), '--allow', join(root, 'allow.json'), '--today', TODAY], { encoding: 'utf8', timeout: 60000 });
check('script, no osv-scanner binary: exit 2', g.status === 2, `${g.status} ${g.stdout}`);
root = mkRoot();
rmSync(join(root, 'tools', 'site-backup', 'package-lock.json'));
g = go(root);
check('script, a lockfile that is missing: exit 2 and it is named', g.code === 2 && g.out.includes('dep-scan: tools/site-backup/package-lock.json ERROR the lockfile is missing'), `${g.code} ${g.out}`);
root = mkRoot();
rmSync(join(root, 'allow.json'));
g = go(root);
check('script, the allow file missing: exit 2', g.code === 2 && /allow file ERROR/.test(g.out), `${g.code} ${g.out}`);
g = go(mkRoot(), 'clean', ['--today', '2026-13-45']);
check('script, a --today that is not a date: exit 2', g.code === 2, `${g.code} ${g.out}`);
// the real osv-scanner (the pinned one, found like the script finds it): the converted deno.lock must produce a finding, or the deno route is blind
const realOsv = [process.env.OSV_SCANNER, join(HERE, '..', '..', '.tools', 'bin', 'osv-scanner.exe'), join(HERE, '..', '..', '.tools', 'bin', 'osv-scanner'), 'osv-scanner'].filter(Boolean).find(c => spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 20000 }).status === 0);
if (!realOsv) console.log('skip  the real osv-scanner is not installed here (omnikom tools ensure --only osv-scanner); CI always has it');
else {
  root = mkRoot({ deno: '{"version":"5","specifiers":{},"npm":{"lodash@4.17.15":{}}}' });
  writeFileSync(join(root, 'tools', 'omnikom-cli', 'tools.json'), readFileSync(join(HERE, '..', 'omnikom-cli', 'tools.json')));
  for (const f of LOCKFILES.filter(f => f !== 'deno.lock')) writeFileSync(join(root, f), readFileSync(join(HERE, '..', '..', f)));
  g = spawnSync(process.execPath, [SUT, '--root', root, '--osv', realOsv, '--allow', join(root, 'allow.json'), '--today', TODAY], { encoding: 'utf8', timeout: 170000 });
  check('real osv-scanner: lodash 4.17.15 in a deno.lock is found (exit 1, labelled deno.lock) and the three real package-lock.json files are clean', g.status === 1 && /dep-scan: deno\.lock lodash@4\.17\.15 GHSA-35jh-r3h4-6jhm Command Injection in lodash/.test(g.stdout) && /4 lockfile\(s\), 5 finding\(s\), 0 allowed/.test(g.stdout) && !g.stdout.includes('package-lock.json'), `${g.status} ${g.stdout} ${g.stderr}`.slice(0, 600));
}
check('the lockfile list is the four lockfiles the platform installs from', JSON.stringify(LOCKFILES) === JSON.stringify(['apps/dashboard/package-lock.json', 'factory/runner/package-lock.json', 'tools/site-backup/package-lock.json', 'deno.lock']), LOCKFILES.join());
check('the committed allow file parses and is valid today', (() => { try { return checkAllow(JSON.parse(readFileSync(join(HERE, 'dep-scan-allow.json'), 'utf8')), new Date().toISOString().slice(0, 10)).ok; } catch { return false; } })());

}

console.log(failed ? `FAIL ${failed}` : 'PASS dep-scan');
process.exitCode = failed ? 1 : 0;
