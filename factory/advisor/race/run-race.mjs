// R3 matcher race (docs/advisor/r3/HANDOVER-race.md, ADR 003). For each contestant (today's scorer as the reference, then
// MiniSearch and Orama): cp11 through r3/run-cp11.mjs, golden turns changed, a Vite library build (engine + library,
// minified, gzip level 9), and the index build and first reply in Node (median of 5). Fewer graded drops wins, then fewer bytes.
// Usage: node factory/advisor/race/run-race.mjs <outDir> [--only <name>]   (from the repo root; run it through heavy.mjs)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { NAMES, loadScorer } from './scorers.mjs';
import { createAdvisor } from '../engine/index.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const argv = process.argv.slice(2);
const out = resolve(argv[0] ?? 'race-out');
const names = argv.includes('--only') ? [argv[argv.indexOf('--only') + 1]] : NAMES;
const packRaw = readFileSync(join(here, '../packs/omnikom-io/pack.json'));
const pack = JSON.parse(packRaw);
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
for (const name of names) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const cp = spawnSync(process.execPath, ['--import', './factory/advisor/r3/ts-hook.mjs', 'factory/advisor/r3/run-cp11.mjs', 'factory/advisor/race/advisor.mjs', join(dir, 'cp11')],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ADVISOR_SCORER: name }, maxBuffer: 64 << 20, timeout: 1200000 });
  const cpText = (cp.stdout || '') + (cp.stderr || '');
  writeFileSync(join(dir, 'cp11.txt'), cpText);
  const g = spawnSync(process.execPath, ['factory/advisor/test/golden-turns.mjs', ...(name === 'own' ? [] : ['--scorer', name])], { cwd: root, encoding: 'utf8', timeout: 1200000 });
  const gLine = ((g.stdout || '') + (g.stderr || '')).trim().split('\n').pop();
  const bdir = join(dir, 'bytes');
  await build({ configFile: false, logLevel: 'silent', root: here,
    build: { lib: { entry: join(here, 'entry-' + name + '.mjs'), formats: ['es'], fileName: 'advisor' }, outDir: bdir, emptyOutDir: true, minify: true, write: true } });
  const js = readdirSync(bdir).filter((f) => /\.m?js$/.test(f));
  const raw = Buffer.concat(js.map((f) => readFileSync(join(bdir, f))));
  const scorer = loadScorer(name);
  const t = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const a = createAdvisor(pack, { scorer });
    const st = a.initialState();
    const t1 = performance.now();
    a.engine.respond(st, 'how much would it cost for 5 callers');
    t.push([t1 - t0, performance.now() - t1]);
  }
  const row = {
    name, cpExit: cp.status, tally: cpText.match(/\| new (\{[^}]*\})/)?.[1] ?? '?',
    worse: Number(cpText.match(/worse=(\d+)/)?.[1] ?? NaN), failToPass: Number(cpText.match(/FAIL -> PASS \((\d+)\)/)?.[1] ?? NaN),
    textDiff: Number(cpText.match(/reply text differs=(\d+)/)?.[1] ?? NaN), golden: gLine,
    rawBytes: raw.length, gzBytes: gz(raw), buildMs: +median(t.map((x) => x[0])).toFixed(1), firstReplyMs: +median(t.map((x) => x[1])).toFixed(1),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log('pack omnikom-io: ' + packRaw.length + ' B raw, ' + gz(packRaw) + ' B gzip');
const libs = rows.filter((r) => r.name !== 'own').sort((a, b) => a.worse - b.worse || a.gzBytes - b.gzBytes);
for (const r of rows) console.log(`${r.name.padEnd(10)} cp11 ${r.tally} worse=${r.worse} FAIL->PASS=${r.failToPass} textDiff=${r.textDiff} | ${r.golden} | ${r.gzBytes} B gzip (${r.rawBytes} raw) | build ${r.buildMs} ms, first reply ${r.firstReplyMs} ms`);
if (libs.length < 2) console.log('RACE: partial run (' + names.join(', ') + ')');
else if (libs[0].worse === 0) console.log('RACE: winner ' + libs[0].name + ' (graded drops 0, ' + libs[0].gzBytes + ' B gzip); loser ' + libs[1].name + ' (graded drops ' + libs[1].worse + ', ' + libs[1].gzBytes + ' B gzip)');
else console.log('RACE: no library holds zero drops (' + libs.map((r) => r.name + ' ' + r.worse).join(', ') + ')');
