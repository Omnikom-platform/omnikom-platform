// Checks the blueprint specs so they cannot silently rot:
//   1. openapi.json: every $ref resolves, operationIds unique, every operation has security, a 2xx and a 401 response.
//   2. traceability: every work order in 05-BUILD-PLAN.md is named by some FR/NFR row in 06-PRD.md, and every FR/NFR row names
//      at least one work order (or "done" for proven parts, or a later milestone M6-M9).
//   node docs/blueprint/specs/check-specs.mjs        exit 0 = all good, 1 = problems printed
import { readFileSync } from 'node:fs';
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
  ops++;
  if (ids.has(op.operationId)) problems.push(`openapi: duplicate operationId ${op.operationId}`);
  ids.add(op.operationId);
  if (!op.security || !op.security.length) problems.push(`openapi: ${m} ${p} has no security`);
  if (!Object.keys(op.responses || {}).some(c => /^2/.test(c))) problems.push(`openapi: ${m} ${p} has no 2xx response`);
  if (!op.responses['401']) problems.push(`openapi: ${m} ${p} has no 401 response`);
}

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
console.log(`${problems.length ? 'FAIL' : 'OK'}: ${ops} operations, ${ids.size} operationIds; ${rows.length} FR/NFR rows, ${planWOs.size} work orders, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
