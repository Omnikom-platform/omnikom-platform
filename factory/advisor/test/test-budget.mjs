// The byte budget on open (ADR 008, R2 section 10): what loads when the visitor presses the chat button is at most 125,324 B gzip,
// no more than today's live chat. Measured the R3 race's way: a Vite library build of engine/index.mjs (minified), gzip level 9.
// Our engine code at most 20,000 B; XState is what the full build adds; the UI counts at its 15,000 B target until it exists.
// Run: node factory/advisor/test/test-budget.mjs  -> "BUDGET TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { main, checker, mkTmp, rmTmp } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const adv = path.join(here, '..');
const LINE = 125324, UI = 15000, OURS_MAX = 20000;
const gz = (b) => gzipSync(b, { level: 9 }).length;
const PACK_FILE = path.join(adv, 'packs/omnikom-io/pack.json');

async function bundle(entry, external) {
  const out = mkTmp('budget');
  try {
    await build({ configFile: false, logLevel: 'silent', root: adv, resolve: { alias: { xstate: path.join(adv, 'node_modules/xstate') } },
      build: { lib: { entry, formats: ['es'], fileName: 'advisor' }, outDir: out, emptyOutDir: true, minify: true, write: true,
        rollupOptions: { external } } });
    return gz(Buffer.concat(readdirSync(out).filter((f) => /\.m?js$/.test(f)).map((f) => readFileSync(path.join(out, f)))));
  } finally { rmTmp(out); }
}

const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const entry = path.join(dir, 'index.mjs');
  const full = await bundle(entry, []);
  const ours = await bundle(entry, ['xstate']);
  const pack = gz(readFileSync(PACK_FILE));
  const total = UI + full + pack;
  console.log('BUDGET: engine ' + ours + ' + XState ' + (full - ours) + ' = ' + full + ' B; pack ' + pack + ' B; UI ' + UI + ' B (target); total ' + total + ' of ' + LINE + ' B');
  check('our engine code is at most ' + OURS_MAX + ' B gzip (' + ours + ')', ours <= OURS_MAX, ours);
  check('the engine bundle carries XState (' + (full - ours) + ' B)', full - ours > 5000, full - ours);
  check('the total on open is at most ' + LINE + ' B gzip (' + total + ')', total <= LINE, total);
  return results;
};
const MUTANTS = [
  { name: 'the pack bundled into the engine', patches: [{ file: 'index.mjs', from: 'export const PACK_FORMAT',
    to: 'import PACK_COPY from ' + JSON.stringify(PACK_FILE.replace(/\\/g, '/')) + ';\nexport const BUNDLED = PACK_COPY;\nexport const PACK_FORMAT' }], expect: [/total on open/] },
];
process.exit(await main({ label: 'BUDGET', scenarios, MUTANTS, scriptsDir: path.join(here, '../engine'), argv: process.argv.slice(2) }));
