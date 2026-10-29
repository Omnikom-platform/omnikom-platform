// Mutants for the site lead endpoint: each removes one rule from a copy of lead-endpoint.mjs; the tests must go red.
//   node factory/worker/test/mutate.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const SRC = readFileSync(join(HERE, '..', 'lead-endpoint.mjs'), 'utf8');
const MUTANTS = [
  ['method must be POST', "if (request.method !== 'POST') return json(405", "if (false) return json(405"],
  ['size cap', 'if (body.length > maxBytes) return json(413', 'if (false) return json(413'],
  ['honeypot refused', "if (data && typeof data.hp === 'string' && data.hp.trim() !== '') return json(400", 'if (false) return json(400'],
  ['not configured answers 503', 'if (!siteId || !signingKey || !platformBase) {', 'if (false) {'],
  ['the site id is in the signed path', 'const path = `/capture-lead?site=${siteId}`;', "const path = '/capture-lead';"],
  ['the body is what is signed', "const signature = await sign(signingKey, 'POST', path, body, now());", "const signature = await sign(signingKey, 'POST', path, '', now());"],
  ['the method is in the canonical form', '`${t}\\n${method.toUpperCase()}\\n${pathWithQuery}\\n${body}`', '`${t}\\n${pathWithQuery}\\n${body}`'],
  ['the timestamp is in the header', 'return `t=${t},v1=${', 'return `t=0,v1=${'],
  ['the signature header is sent', "headers: { 'content-type': 'application/json', 'x-site-signature': signature }", "headers: { 'content-type': 'application/json' }"],
  ['only 202 is sent', 'if (res.status === 202) return json(200, { sent: true });', 'if (res.status === 202 || res.status === 200) return json(200, { sent: true });'],
  ['400 problems pass through', 'return json(400, { sent: false, problems: Array.isArray(j.problems) ? j.problems : [', 'return json(400, { sent: false, problems: ['],
  ['429 says try again', "if (res.status === 429) return json(429, { sent: false, retry: true, msg: 'Please try again in a minute.' });", ''],
  ['401 is no retry', "if (res.status === 401) { log('platform refused the site signature (key or clock)'); return json(502, { sent: false, retry: false, msg: CALL_US }); }", ''],
  ['unreachable keeps the answers', 'return json(502, { sent: false, retry: true, msg: TRY_AGAIN });\n    }', "return json(200, { sent: true });\n    }"],
  ['noindex on every answer', "const H = { 'content-type': 'application/json', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };", "const H = { 'content-type': 'application/json' };"],
];

// the tests import ../lead-endpoint.mjs and ../../../supabase/functions/_shared/signature.ts: rebuild that shape in a temp folder
const tmp = mkdtempSync(join(tmpdir(), 'omnikom-lead-mut-'));
mkdirSync(join(tmp, 'factory', 'worker', 'test'), { recursive: true });
mkdirSync(join(tmp, 'supabase', 'functions', '_shared'), { recursive: true });
cpSync(join(ROOT, 'supabase', 'functions', '_shared', 'signature.ts'), join(tmp, 'supabase', 'functions', '_shared', 'signature.ts'));
cpSync(join(HERE, 'run.mjs'), join(tmp, 'factory', 'worker', 'test', 'run.mjs'));
const target = join(tmp, 'factory', 'worker', 'lead-endpoint.mjs');

let failed = 0;
writeFileSync(target, SRC);
const base = spawnSync('node', [join(tmp, 'factory', 'worker', 'test', 'run.mjs')], { encoding: 'utf8', timeout: 60000 });
if (base.status !== 0) { console.log('the unbroken copy must pass first:\n' + base.stdout.slice(-500)); process.exit(1); }
for (const [name, a, b] of MUTANTS) {
  const n = SRC.split(a).length - 1;
  if (n !== 1) { console.log(`MUTANT TARGET ${n === 0 ? 'MISSING' : 'NOT UNIQUE'}: ${name}`); failed++; continue; }
  writeFileSync(target, SRC.split(a).join(b));
  const r = spawnSync('node', [join(tmp, 'factory', 'worker', 'test', 'run.mjs')], { encoding: 'utf8', timeout: 60000 });
  const caught = r.status !== 0;
  if (!caught) failed++;
  const why = (r.stdout.match(/FAIL [^\n]*/) || [''])[0].slice(0, 110);
  console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(40)} ${why}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${MUTANTS.length} mutants, ${MUTANTS.length - failed} caught, ${failed} survived or missing`);
process.exit(failed ? 1 : 0);
