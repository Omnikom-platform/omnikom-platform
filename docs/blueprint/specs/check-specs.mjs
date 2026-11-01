// Checks the blueprint specs so they cannot silently rot:
//   1. openapi.json: every $ref resolves, operationIds unique, every operation has security, a 2xx and a 401 response, and every
//      deployed function (supabase/functions/<name>/index.ts) has an operation at /<name>; and the other way: an openapi path or a
//      supabase/config.toml [functions.<name>] table with no function folder fails unless marked planned (x-planned / "# planned:").
//   2. traceability: every work order in 05-BUILD-PLAN.md is named by some FR/NFR row in 06-PRD.md, and every FR/NFR row names
//      at least one work order (or "done" for proven parts, or a later milestone M6-M9).
//   node docs/blueprint/specs/check-specs.mjs        exit 0 = all good, 1 = problems printed
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const problems = [];

const api = JSON.parse(readFileSync(join(HERE, 'openapi.json'), 'utf8'));
const resolve = ref => ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : undefined), api);
(function walk(o, path) {
  if (!o || typeof o !== 'object') return;
  if (typeof o.$ref === 'string' && resolve(o.$ref) === undefined) problems.push(`openapi: ${path} -> unresolved ${o.$ref}`);
  for (const [k, v] of Object.entries(o)) walk(v, `${path}/${k}`);
})(api, '');
const ids = new Set();
let ops = 0;
for (const [p, methods] of Object.entries(api.paths)) for (const [m, op] of Object.entries(methods)) {
  if (m.startsWith('x-')) continue;   // a path-level extension (x-planned), not an operation
  ops++;
  if (ids.has(op.operationId)) problems.push(`openapi: duplicate operationId ${op.operationId}`);
  ids.add(op.operationId);
  if (!op.security || !op.security.length) problems.push(`openapi: ${m} ${p} has no security`);
  if (!Object.keys(op.responses || {}).some(c => /^2/.test(c))) problems.push(`openapi: ${m} ${p} has no 2xx response`);
  if (!op.responses['401']) problems.push(`openapi: ${m} ${p} has no 401 response`);
}

// Every deployed function (a folder under supabase/functions with an index.ts; _shared and test are not functions) has an operation at /<name>.
// 2026-11-01: five functions of slice 5.2 shipped with no operation and nothing noticed. The spec may name more paths than there are functions
// (metrics-pull, unpublish are planned); it may not name fewer.
const SUPABASE_DIR = join(HERE, '..', '..', '..', 'supabase');
const FUNCTIONS_DIR = join(SUPABASE_DIR, 'functions');
const deployed =readdirSync(FUNCTIONS_DIR, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'test' && existsSync(join(FUNCTIONS_DIR, e.name, 'index.ts'))).map(e => e.name).sort();
if (!deployed.length) problems.push('openapi: no function folder found under supabase/functions (the check would pass on nothing)');
for (const fn of deployed) if (!api.paths[`/${fn}`]) problems.push(`openapi: the deployed function ${fn} has no operation at /${fn}`);

// The other direction (2026-11-01, follow-on): a path of the spec or a [functions.<name>] table of supabase/config.toml with no function folder is
// drift unless it is marked planned and names the step: openapi `x-planned: "<step>"` on the path item; config.toml a `# planned: <step>` comment line
// directly above the table (a TOML comment: the Supabase CLI and tools/omnikom-cli/commands/status.mjs both ignore it). A planned mark on something
// that HAS a folder is stale and fails too.
const folders = new Set(readdirSync(FUNCTIONS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name));
let plannedCount = 0;
for (const [p, item] of Object.entries(api.paths)) {
  const name = p.replace(/^\//, ''), planned = item['x-planned'];
  if (planned !== undefined) {
    plannedCount++;
    if (typeof planned !== 'string' || !planned.trim()) problems.push(`openapi: ${p} has an x-planned mark that names no step`);
    else if (deployed.includes(name)) problems.push(`openapi: ${p} is marked x-planned but supabase/functions/${name} exists: remove the mark`);
  } else if (!deployed.includes(name)) problems.push(`openapi: ${p} has no function folder supabase/functions/${name}/index.ts and is not marked planned (x-planned: "<step>")`);
}
const cfgLines = readFileSync(join(SUPABASE_DIR, 'config.toml'), 'utf8').split(/\r?\n/);
let tables = 0;
cfgLines.forEach((line, i) => {
  const m = /^\[functions\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$/.exec(line);
  if (!m) return;
  tables++;
  const name = m[1], planned = /^#\s*planned:\s*\S/.test(cfgLines[i - 1] || '');
  if (planned) {
    plannedCount++;
    if (folders.has(name)) problems.push(`config.toml: [functions.${name}] is marked planned but supabase/functions/${name} exists: remove the mark`);
  } else if (!folders.has(name)) problems.push(`config.toml: [functions.${name}] has no folder supabase/functions/${name} and is not marked planned (a "# planned: <step>" line directly above the table)`);
});
if (!tables) problems.push('config.toml: no [functions.<name>] table found (the check would pass on nothing)');

const plan = readFileSync(join(ROOT, '05-BUILD-PLAN.md'), 'utf8');
const prd = readFileSync(join(ROOT, '06-PRD.md'), 'utf8');
const planWOs = new Set([...plan.matchAll(/^\| (W\d+\.\d+) \|/gm)].map(m => m[1]));
const rows = [...prd.matchAll(/^\| ((?:N?FR)-\d+)[^|]*\|(.*)$/gm)].map(m => ({ id: m[1], rest: m[2] }));
const named = new Set();
for (const r of rows) {
  const wos = [...r.rest.matchAll(/W(\d+)\.(\d+)(?:-W?(\d+)\.(\d+))?/g)];
  for (const w of wos) {
    named.add(`W${w[1]}.${w[2]}`);
    if (w[3]) for (let i = +w[2]; i <= +w[4]; i++) named.add(`W${w[1]}.${i}`);
  }
  if (!wos.length && !/\bdone\b|\bM[6-9]\b/.test(r.rest)) problems.push(`trace: ${r.id} names no work order`);
  for (const w of wos) if (!planWOs.has(`W${w[1]}.${w[2]}`)) problems.push(`trace: ${r.id} names ${`W${w[1]}.${w[2]}`}, which is not in the build plan`);
}
for (const w of planWOs) if (!named.has(w)) problems.push(`trace: work order ${w} is not traced to any FR/NFR`);

for (const p of problems) console.log(p);
console.log(`${problems.length ? 'FAIL' : 'OK'}: ${ops} operations, ${ids.size} operationIds, ${deployed.length} deployed functions covered, ${plannedCount} planned marks; ${rows.length} FR/NFR rows, ${planWOs.size} work orders, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
