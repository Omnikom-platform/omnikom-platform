// search-gate.mjs: the go-live pipeline's step `search-gate`. Runs the SEO skill's gate, strict, on a built site against the research plan the site manifest names; no plan is BLOCKED, never a pass.
// usage: node tools/golive/search-gate.mjs --manifest <file> --built <folder> --out <folder> [--data <folder>]    (data: the folder that holds site-checks/<host>/.pewp; default the skill's folder)
// exits: 0 PASS; 1 REFUSED manifest or FAIL or ERROR (last line: PASS|FAIL|ERROR search-gate <site>: <the gate's counts>); 2 usage; 3 BLOCKED (last line: BLOCKED: <what> | unblocks: <what>)
// a check that passed because its input was absent is never silent: a NOTHING TO CHECK line says what it found (0 of something); a built site with no sitemap is BLOCKED
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkManifest } from './site-manifest.mjs';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'programmatic-enterprise-web-performance');
const USAGE = 'usage: node tools/golive/search-gate.mjs --manifest <file> --built <folder> --out <folder> [--data <folder>]';
const NONE = [ // [gate check, the start of its own PASS summary, the count printed]: the absence is a true answer, shown with its count
  ['GT-009', 'no programmatic pages planned', '0 template groups planned'],
  ['GT-010', 'no industry rules selected', '0 industry rule items, business.json says industry null'],
  ['GT-014', 'no prompt map in this project', '0 prompt rows, the project has no prompt map'],
];
const slash = (p) => p.split(path.sep).join('/');
const usage = (why) => { console.error(why ? `${why}\n${USAGE}` : USAGE); process.exit(2); };
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
// where a folder is or would be, whatever it is called: the real path of its deepest existing ancestor, then the rest
const real = (p) => { const rest = []; let q = path.resolve(p); while (!fs.existsSync(q)) { rest.unshift(path.basename(q)); q = path.dirname(q); } return path.join(fs.realpathSync.native(q), ...rest); };
const inside = (a, b) => { const r = path.relative(real(b), real(a)); return !(r.startsWith('..') || path.isAbsolute(r)); };

const a = process.argv.slice(2);
const opt = {};
for (let i = 0; i < a.length; i += 2) {
  if (!['--manifest', '--built', '--out', '--data'].includes(a[i]) || a[i + 1] === undefined || a[i + 1].startsWith('--')) usage();
  opt[a[i]] = a[i + 1];
}
for (const k of ['--manifest', '--built', '--out']) if (opt[k] === undefined) usage();
const built = path.resolve(opt['--built']), out = path.resolve(opt['--out']), data = path.resolve(opt['--data'] ?? SKILL);
if (!isDir(built)) usage(`--built is not a folder: ${opt['--built']}`);
if (!isDir(data)) usage(`--data is not a folder: ${data}`);
const { manifest, faults } = checkManifest(path.resolve(opt['--manifest']));
if (!manifest) { console.error(faults.join('\n')); process.exit(1); }
const host = manifest.search.host, pewp = path.join(data, 'site-checks', host, '.pewp');
for (const [what, dir] of [['the built folder', built], ['the plan folder', pewp]]) if (inside(out, dir)) usage(`--out is inside ${what}`);
const seo = `omnikom seo run https://${host}/ --client <slug>, its research steps writing the file`;
for (const [rel, what, fix] of [['targets.json', 'research', seo], ['business.json', 'business definition', seo], ['plan/sitemap.json', 'page plan', `node skills/programmatic-enterprise-web-performance/scripts/plan-site.mjs ${slash(pewp)}`]]) {
  if (!fs.existsSync(path.join(pewp, rel))) { console.log(`BLOCKED: no ${what} for ${host}: ${slash(pewp)}/${rel} is not there | unblocks: ${fix}`); process.exit(3); }
}
const r = spawnSync(process.execPath, ['--max-old-space-size=256', path.join(SKILL, 'scripts', 'gate.mjs'), pewp, built, '--out', out, '--strict'], { encoding: 'utf8', maxBuffer: 1 << 26 }); // no-timeout: the step's clock ends it (the engine's timeoutMinutes, the registry row's 10 minutes)
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
const m = /^(PASS|FAIL|ERROR) gate (.*)$/m.exec(r.stdout ?? '');
const status = r.status === 0 && m && m[1] === 'PASS' ? 'PASS' : m && m[1] === 'ERROR' ? 'ERROR' : 'FAIL';
const lines = (r.stdout ?? '').split(/\r?\n/);
const said = (id, why) => lines.some((l) => l.startsWith(`PASS ${id} ${why}`));
for (const [id, why, count] of NONE) if (said(id, why)) console.log(`NOTHING TO CHECK ${id}: ${count}`);
if (status === 'PASS' && said('GT-013', 'no sitemap in the built site')) { console.log("BLOCKED: no sitemap in the built site: GT-013 had no dates to read | unblocks: the site's build writes sitemap.xml into the built folder"); process.exit(3); }
console.log(m ? `${status} search-gate ${manifest.site}: ${m[2]}` : `FAIL search-gate ${manifest.site}: the gate printed no summary line (its exit was ${r.status})`);
process.exitCode = status === 'PASS' ? 0 : 1;
