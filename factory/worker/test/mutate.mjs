// Mutants for the site lead endpoint: each removes one rule from a copy of lead-endpoint.mjs; the tests must go red. The draft gate (draft-gate.mjs, B15-b3) too.
//   node factory/worker/test/mutate.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const SRC = readFileSync(join(HERE, '..', 'lead-endpoint.mjs'), 'utf8');
const GATE_SRC = readFileSync(join(HERE, '..', 'draft-gate.mjs'), 'utf8');   // book row B15-b3
const MUTANTS = [
  ['method must be POST', "if (request.method !== 'POST') return json(405", "if (false) return json(405"],
  ['size cap', 'if (body.length > maxBytes) return reply(413', 'if (false) return reply(413'],
  ['honeypot refused', "if (data && typeof data.hp === 'string' && data.hp.trim() !== '') return reply(400", 'if (false) return reply(400'],
  ['not configured answers 503', 'if (!siteId || !signingKey || !platformBase) {', 'if (false) {'],
  ['the site id is in the signed path', 'const path = `/capture-lead?site=${siteId}${visitor ? `', 'const path = `/capture-lead?${visitor ? `'],
  ['the body is what is signed', "const signature = await sign(signingKey, 'POST', path, forward, now());", "const signature = await sign(signingKey, 'POST', path, '', now());"],
  ['the method is in the canonical form', '`${t}\\n${method.toUpperCase()}\\n${pathWithQuery}\\n${body}`', '`${t}\\n${pathWithQuery}\\n${body}`'],
  ['the timestamp is in the header', 'return `t=${t},v1=${', 'return `t=0,v1=${'],
  ['the signature header is sent', "headers: { 'content-type': 'application/json', 'x-site-signature': signature }", "headers: { 'content-type': 'application/json' }"],
  ['only 202 is sent', 'if (res.status === 202) return reply(200, { sent: true });', 'if (res.status === 202 || res.status === 200) return reply(200, { sent: true });'],
  ['400 problems pass through', 'return reply(400, { sent: false, problems: Array.isArray(j.problems) ? j.problems : [', 'return reply(400, { sent: false, problems: ['],
  ['429 says try again', "if (res.status === 429) return reply(429, { sent: false, retry: true, msg: 'Please try again in a minute.' });", ''],
  ['401 is no retry', "if (res.status === 401) { log('platform refused the site signature (key or clock)'); return reply(502, { sent: false, retry: false, msg: CALL_US }); }", ''],
  ['409 (paused or suspended) is no retry, says call us', "if (res.status === 409) { log('platform refused: the site is paused or its workspace suspended'); return reply(409, { sent: false, retry: false, msg: CALL_US }); }", ''],
  ['unreachable keeps the answers', 'return reply(502, { sent: false, retry: true, msg: TRY_AGAIN });\n    }', "return reply(200, { sent: true });\n    }"],
  ['noindex on every answer', "const H = { 'content-type': 'application/json', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };", "const H = { 'content-type': 'application/json' };"],
  // brief 5-L: the plain browser form
  ['the urlencoded branch exists', 'if (fromForm) {\n      data = leadFromForm', 'if (false) {\n      data = leadFromForm'],
  ['the form is forwarded as JSON', 'forward = JSON.stringify(data);', 'forward = body;'],
  ['contact consent needs the tick', "if (p.get('consent') !== 'yes') delete lead.consentText;", ''],
  ['the tick-box itself is not an answer', "if (k === 'consent' || ", 'if (false || '],
  ['marketing consent is carried', 'if (text) lead.marketingConsent = {', 'if (false) lead.marketingConsent = {'],
  ['marketing given follows its box', "given: p.get('marketingConsent') === 'yes'", 'given: true'],
  ['the other fields are answers', 'if (Object.keys(answers).length) lead.answers = answers;', ''],
  ['a form post is answered with a page', '(fromForm ? formAnswer(', '(false ? formAnswer('],
  ['a sent form post is redirected (303), not answered inline', 'if (obj.sent) return new Response(null, { status: 303', 'if (obj.sent) return new Response(null, { status: 200'],
  ['THANKS_PATH overrides the default thank-you GET', 'thanks || `${new URL(request.url).pathname}?sent=1`', '`${new URL(request.url).pathname}?sent=1`'],
  ['the default thank-you page is the GET with sent=1', "if (request.method === 'GET' && new URL(request.url).searchParams.get('sent') === '1') return thankYouPage();", ''],
  ['only the thank-you GET is answered, every other GET is 405', "request.method === 'GET' && new URL(request.url).searchParams.get('sent') === '1'", "request.method === 'GET'"],
  ['the page does not claim the answers are kept', 'obj.msg === TRY_AGAIN ? FORM_TRY_AGAIN : obj.msg', 'obj.msg'],
  ['the redirect carries no JSON type', "headers: { 'x-robots-tag': H['x-robots-tag'], 'cache-control': H['cache-control'], location: thanksTo }", 'headers: { ...H, location: thanksTo }'],
  ['the thank-you path stays on this site', 'const thanks = backPath(thanksPath) === thanksPath ? thanksPath : \'\';', 'const thanks = thanksPath;'],
  ['the page is html',"const HTML_H = { ...H, 'content-type': 'text/html; charset=utf-8' };", 'const HTML_H = { ...H };'],
  ['every problem is named in words', '${q.path ? `${escHtml(FIELD_WORDS[q.path] || q.path)}: ` : \'\'}', ''],
  ['echoed text is escaped', ".replace(/</g, '&lt;')", ''],
  ['the way back stays on this site', '/^\\/(?!\\/)[^\\s"\'<>\\\\]*$/.test(page)', 'true'],
  // product row E5: the visitor in the signed path
  ['the visitor hash is in the signed path', '${visitor ? `&visitor=${visitor}` : \'\'}', ''],
  ['the visitor hash covers the site id', 'enc.encode(`${siteId}:${ip}`)', 'enc.encode(ip)'],
  ['no address gives no visitor', 'if (!ip) return null;', ''],
];
const GATE_MUTANTS = [
  ['draft gate: an expired link still opens', '    if (!(now() < until)) return notFound();\n', ''],
  ['draft gate: any token opens', "hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))) !== sha256", 'false'],
  ['draft gate: the 404 is indexable', "charset=utf-8', 'x-robots-tag': 'noindex, nofollow', ", "charset=utf-8', "],
  ['draft gate: the cookie is readable by scripts', '; Secure; HttpOnly; SameSite=Lax', '; Secure; SameSite=Lax'],
  ['draft gate: the link keeps no cookie', "'set-cookie': `${COOKIE}=", "'x-omk-none': `${COOKIE}="],
  ['draft gate: the cookie is not read', 'const token = link || kept;', 'const token = link;'],
  ['draft gate: the redirect keeps the token', "url.searchParams.delete('k');", ''],
  ['draft gate: the link serves the page', 'if (!link) return next();', 'return next();'],
  ['draft gate: a good cookie lets a wrong link in', 'const token = link || kept;', 'const token = kept || link;'],
  ['draft gate: the redirect leaves the site', ".replace(/^\\/+/, '/')", ''],
  ['draft gate: the redirect drops the other query parts', "'/') + url.search,", "'/'),"],
];

// the tests import ../lead-endpoint.mjs and ../../../supabase/functions/_shared/signature.ts: rebuild that shape in a temp folder
const tmp = mkdtempSync(join(tmpdir(), 'omnikom-lead-mut-'));
mkdirSync(join(tmp, 'factory', 'worker', 'test'), { recursive: true });
mkdirSync(join(tmp, 'supabase', 'functions', '_shared'), { recursive: true });
cpSync(join(ROOT, 'supabase', 'functions', '_shared', 'signature.ts'), join(tmp, 'supabase', 'functions', '_shared', 'signature.ts'));
cpSync(join(HERE, 'run.mjs'), join(tmp, 'factory', 'worker', 'test', 'run.mjs'));
const target = join(tmp, 'factory', 'worker', 'lead-endpoint.mjs');
const gateTarget = join(tmp, 'factory', 'worker', 'draft-gate.mjs');

let failed = 0;
writeFileSync(target, SRC); writeFileSync(gateTarget, GATE_SRC);
const base = spawnSync('node', [join(tmp, 'factory', 'worker', 'test', 'run.mjs')], { encoding: 'utf8', timeout: 60000 });
if (base.status !== 0) { console.log('the unbroken copy must pass first:\n' + base.stdout.slice(-500)); process.exit(1); }
for (const [name, a, b, gate] of [...MUTANTS, ...GATE_MUTANTS.map((m) => [...m, true])]) {
  const src = gate ? GATE_SRC : SRC, into = gate ? gateTarget : target, n = src.split(a).length - 1;
  if (n !== 1) { console.log(`MUTANT TARGET ${n === 0 ? 'MISSING' : 'NOT UNIQUE'}: ${name}`); failed++; continue; }
  writeFileSync(into, src.split(a).join(b));
  const r = spawnSync('node', [join(tmp, 'factory', 'worker', 'test', 'run.mjs')], { encoding: 'utf8', timeout: 60000 });
  writeFileSync(into, src);   // the next fault starts from the unbroken file
  const caught = r.status !== 0;
  if (!caught) failed++;
  const why = (r.stdout.match(/FAIL [^\n]*/) || [''])[0].slice(0, 110);
  console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(40)} ${why}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${(MUTANTS.length + GATE_MUTANTS.length)} mutants, ${(MUTANTS.length + GATE_MUTANTS.length) - failed} caught, ${failed} survived or missing`);
process.exit(failed ? 1 : 0);
