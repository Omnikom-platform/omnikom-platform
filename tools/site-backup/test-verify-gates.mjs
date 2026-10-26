// Watched-fail test for verify.mjs: copies a good backup, breaks it on purpose in 3 ways, and expects
// verify.mjs to go red for exactly the right gates. Proves the gates measure something.
// Usage: node test-verify-gates.mjs --out <good backup dir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const { out } = parseArgs(process.argv.slice(2));
if (typeof out !== 'string' || !fs.existsSync(path.join(path.resolve(out), 'report.json'))) { console.error('usage: node test-verify-gates.mjs --out <good backup dir with report.json>'); process.exit(2); }
const src = path.resolve(out);
const bad = `${src}.broken-copy`;
const here = path.dirname(fileURLToPath(import.meta.url));
// verify.mjs re-reads the sitemaps (a 429 there waits 90 s, other failures up to 60 s more): 10 min is its ceiling here
const verify = (dir) => {
  const r = spawnSync(process.execPath, ['verify.mjs', '--out', dir, '--no-replay'], { cwd: here, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status === null) { console.error(`verify.mjs did not finish on ${dir}: ${r.error?.code || r.signal}`); process.exit(1); }
  if (r.status === 2) { console.error(`verify.mjs refused ${dir}: ${r.stderr.trim()}`); process.exit(1); }
  return r;
};

// Baseline: the gates on the untouched backup. A gate only proves something if it was GREEN before the
// break and RED after it. A gate already red before the break proves nothing, so the test refuses to pass.
const vj = path.join(src, 'verify.json'), before = fs.existsSync(vj) ? fs.statSync(vj).mtimeMs : 0;
verify(src);
// never read an old verify.json as this run's baseline
if (!fs.existsSync(vj) || fs.statSync(vj).mtimeMs === before) { console.error('verify.mjs wrote no new verify.json for the baseline'); process.exit(1); }
const base = JSON.parse(fs.readFileSync(vj, 'utf8'));
fs.rmSync(bad, { recursive: true, force: true });
fs.cpSync(src, bad, { recursive: true });

const R = JSON.parse(fs.readFileSync(path.join(bad, 'report.json'), 'utf8'));
const first = Object.values(R.pages)[0];
// Break 1 (G3): a missing screenshot.
fs.rmSync(path.join(bad, 'pages', first.slug, 'mobile.png'));
// Break 2 (G1 + G2): the old tool's bug — a script fragment saved as if it were a page.
const junkUrl = new URL('/+imgurl+/', R.site).href;
R.pages[junkUrl] = { url: junkUrl, slug: '+imgurl+', kind: 'page', ok: true, title: 'a.woff2', desktop: { status: 200 } };
fs.mkdirSync(path.join(bad, 'pages', '+imgurl+'), { recursive: true });
fs.writeFileSync(path.join(bad, 'pages', '+imgurl+', 'rendered.html'), '<title>e4af272ccee01ff0-s.p.woff2</title>');
// Break 3 (G6): a page that showed "something went wrong" / never finished loading.
R.pages[first.url].desktop = { ...R.pages[first.url].desktop, errorBanner: true, settled: false, notLoaded: ['https://example.invalid/img.jpg'] };
fs.writeFileSync(path.join(bad, 'report.json'), JSON.stringify(R));

fs.rmSync(path.join(bad, 'verify.json'), { force: true });   // the copy carries the baseline's verify.json
const r = verify(bad);
const v = JSON.parse(fs.readFileSync(path.join(bad, 'verify.json'), 'utf8'));
const expectRed = { G1: true, G2: true, G3: true, G5: false, G6: true };
const rows = Object.entries(expectRed).map(([g, red]) => {
  const before = !base.gates[g].pass, after = !v.gates[g].pass;
  // A gate we break must go green -> red; a gate we leave alone must stay as it was.
  const ok = red ? (!before && after) : (before === after);
  return { gate: g, redBefore: before, redAfter: after, expected: red ? 'green->red' : 'unchanged', ok, firstFailure: (v.gates[g].failures[0] || '').slice(0, 90) };
});
const dirtyBase = Object.entries(base.gates).filter(([, x]) => !x.pass).map(([g]) => g);
if (dirtyBase.length) console.log(`NOTE: baseline already red on ${dirtyBase.join(', ')}; those gates cannot be proven by this run.`);
console.table(rows);
console.log('verify exit code (expect 1):', r.status);
fs.rmSync(bad, { recursive: true, force: true });
const pass = rows.every((x) => x.ok) && r.status === 1;
console.log(pass ? 'WATCHED-FAIL TEST PASS: gates go red for the right reasons' : 'WATCHED-FAIL TEST FAIL');
process.exitCode = pass ? 0 : 1;
