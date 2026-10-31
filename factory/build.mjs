// The website factory build (03-FRONTEND A3). One export in, one folder of static files out.
//   node factory/build.mjs --export <export.json> --out <dir> [--design <dir>] [--media <dir>] [--built-at <ISO>] [--force-fail heading]
// Exit 0 = built; 1 = the build stopped (validation, a design or media problem, a gate) and NOTHING was written; 2 = usage.
// Node 20+ built-ins only. The steps are functions in factory/lib/*.mjs (site.mjs runs them in order); README.md has the shapes.
import { buildSite, BuildStop } from './lib/site.mjs';

const USAGE = 'usage: node factory/build.mjs --export <export.json> --out <dir> [--design <dir>] [--media <dir>] [--built-at <ISO datetime>] [--force-fail heading]';
const die = (msg) => { console.error(msg); process.exit(2); };

const opts = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!['--export', '--out', '--design', '--media', '--built-at', '--force-fail'].includes(a)) die(`unknown argument ${a}\n${USAGE}`);
  opts[a.slice(2)] = args[++i];
}
if (!opts.export || !opts.out) die(USAGE);
if (opts['force-fail'] !== undefined && opts['force-fail'] !== 'heading') die(`--force-fail knows only "heading"\n${USAGE}`);
const W3C = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const builtAt = opts['built-at'] ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
if (!W3C.test(builtAt) || Number.isNaN(Date.parse(builtAt))) die(`--built-at must be an ISO datetime with seconds and a timezone, e.g. 2026-10-31T00:30:00Z\n${USAGE}`);

try {
  const r = await buildSite({ exportFile: opts.export, out: opts.out, designDir: opts.design, mediaDir: opts.media, builtAt, forceFail: opts['force-fail'] });
  for (const l of r.skipLines) console.log(l);
  if (opts['force-fail'] === 'heading') console.log('FORCED FAILURE: heading');
  console.log(`BUILT ${r.total} pages (${r.contractPages} contract pages + ${r.itemPages} item pages) -> ${opts.out}`);
  console.log(`preview: ${r.preview}`);
} catch (e) {
  if (e instanceof BuildStop) { for (const l of e.lines) console.error(l); process.exit(e.code); }
  throw e;
}
