// Tests for sign-site.mjs: three stages, the check, the refusals, tampering caught. Runs the tool as a child process.
// usage: node sign-site.test.mjs            (SIGN_SITE_TOOL=<path> tests another copy of the tool; used by the mutants)
//        node sign-site.test.mjs --mutants  (copies the tool, breaks it 20 ways, expects this test to go red each time)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT = JSON.parse(fs.readFileSync(path.join(HERE, 'wording.json'), 'utf8')).report_email;
const TOOL = process.env.SIGN_SITE_TOOL || path.join(HERE, 'sign-site.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-site-test-'));
const REG = path.join(TMP, 'register.tsv');
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) passed++; else { failed++; console.log(`  FAIL ${name}`); } };
// draft and live need --host; tests that want it missing start with '--nohost'
const run = (...args) => {
  if (args[0] === '--nohost') args = args.slice(1);
  else if ((args.includes('--draft') || args.includes('--live')) && !args.includes('--host')) args.push('--host', 'demo.example.com');
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, SIGN_SITE_REGISTER: REG } });
};
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

function tamperH(src, name, fn) { const d = path.join(TMP, name); fs.cpSync(src, d, { recursive: true }); if (fs.existsSync(`${src}-functions`)) fs.cpSync(`${src}-functions`, `${d}-functions`, { recursive: true }); fn(d); return d; }
function tamper0(src, name) { const d = path.join(TMP, name); fs.cpSync(src, d, { recursive: true }); fs.mkdirSync(path.join(d, '.git'), { recursive: true }); fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'x'); return d; }
function fixture(name, extra = {}) {
  const d = path.join(TMP, name);
  const files = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Home</title><link rel="stylesheet" href="/a.css"></head><body class="home"><h1>Hi</h1><script src="/app.js"></script></body></html>\n',
    'about/index.html': '<!DOCTYPE html>\n<html><head><title>About</title></head><body><p>About</p></body></html>\n',
    '404.html': '<!doctype html><meta charset="utf-8"><title>Page not found</title><p>Gone</p>\n',
    'a.css': '@charset "utf-8";\nbody{color:#000}\n',
    'b.css': 'p{margin:0}',
    'app.js': 'console.log(1);\n',
    'tool.mjs': '#!/usr/bin/env node\nexport const x = 1;\n',
    'data.json': '{"a":1}\n', 'site.webmanifest': '{"name":"x"}\n', 'sitemap.xml': '<urlset></urlset>\n', 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n', 'app.js.map': '{"version":3}\n',
    'robots.txt': 'User-agent: *\nAllow: /\n', 'llms.txt': '# Site\nreal llms\n',
    '.checks/run.mjs': 'internal();\n', '.well-known/security.txt': 'Contact: mailto:x@example.com\n',
    '_headers': '/*\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow\n\n/assets/*\n  Cache-Control: max-age=31536000\n',
    ...extra,
  };
  for (const [f, c] of Object.entries(files)) { if (c === null) continue; fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  fs.writeFileSync(path.join(d, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  return d;
}

// 1. draft
const clean = fixture('clean');
let r = run('--draft', clean, '--out', path.join(TMP, 'draft'), '--site', 'demo');
ok(r.status === 0, `draft signs (exit ${r.status}: ${r.stderr.trim().slice(0, 200)})`);
const D = path.join(TMP, 'draft');
const id = (r.stdout.match(/omk-demo-\d{8}-[0-9a-f]{12}/) || [])[0];
ok(!!id, 'draft prints an ID omk-<site>-<date>-<12 hex>');
if (fs.existsSync(D)) {
  const home = read(D, 'index.html');
  ok(/^<!doctype html><!-- \(c\) /.test(home), 'notice comment directly after the doctype');
  ok((home.match(/<meta\s+name="robots"/g) || []).length === 1 && home.includes('noai, noimageai'), 'exactly one robots meta, the draft one');
  ok(home.includes('class="omk-draft"') && home.includes(`data-omk-sig="${id}"`), 'bar and data-omk-sig on body');
  ok(home.includes(`name="omnikom-signature" content="${id}; stage=draft"`), 'signature meta with stage');
  ok(read(D, '404.html').includes('class="omk-draft"'), 'bar on a page with no <body>');
  ok(home.includes(`report it to ${REPORT}`) && home.includes('not from Omnikom') && read(D, 'a.css').includes(REPORT) && !new RegExp('>[^<]*' + REPORT.replace(/[.]/g, '\\.') + '[^<]*<').test(home.replace(/<!--[^]*?-->/g, '')), 'draft: the stolen-copy notice and report address sit in the code, not in visible text');
  const a = read(D, 'a.css');
  ok(a.startsWith('@charset "utf-8";\n/*! ') && a.endsWith(`:root{--omk-sig:"${id}"}\n`), 'css: notice after @charset, --omk-sig last');
  ok(read(D, 'tool.mjs').startsWith('#!/usr/bin/env node\n/*! '), 'js: notice after the shebang');
  for (const f of ['data.json', 'site.webmanifest', 'sitemap.xml', 'logo.svg', 'app.js.map']) ok(read(D, f) === read(clean, f), `${f} untouched`);
  ok(fs.readFileSync(path.join(D, 'img.png')).equals(fs.readFileSync(path.join(clean, 'img.png'))), 'binary untouched');
  const h = read(D, '_headers');
  ok((h.match(/^\/\*\s*$/gm) || []).length === 1 && h.includes(`X-Omnikom-Signature: ${id}; stage=draft`) && /X-Robots-Tag: noindex, nofollow, noai, noimageai/.test(h), '_headers: lines inside the one /* block');
  ok(read(D, 'robots.txt').includes('User-agent: GPTBot\nDisallow: /') && read(D, 'llms.txt').includes(id), 'robots.txt blocks AI crawlers; llms.txt carries the notice');
  ok(run('--check', D, '--mode', 'draft', '--clean', clean).status === 0, 'check draft passes');
  ok(run('--check', D, '--mode', 'live', '--clean', clean).status === 1, 'a draft fails the live check');
}

// 2. live
r = run('--live', clean, '--out', path.join(TMP, 'live'), '--site', 'demo', '--client', 'Demo "Co", Inc.', '--date', '2026-11-20');
ok(r.status === 0, `live signs (exit ${r.status}: ${r.stderr.trim().slice(0, 200)})`);
const L = path.join(TMP, 'live');
if (fs.existsSync(L)) {
  const all = fs.readdirSync(L, { recursive: true }).filter((f) => fs.statSync(path.join(L, f)).isFile()).map((f) => read(L, f)).join('\n');
  for (const w of ['DRAFT PREVIEW', 'omk-draft', 'noai']) ok(!all.includes(w), `live output holds no "${w}"`);
  ok(read(L, 'robots.txt') === read(clean, 'robots.txt') && read(L, 'llms.txt') === read(clean, 'llms.txt'), 'live ships the site\'s own robots.txt and llms.txt');
  ok(read(L, 'index.html').includes('licensed to Demo &quot;Co&quot;, Inc. for this website from 2026-11-20') && read(L, 'index.html').includes('stage=live'), 'live wording and stage');
  ok(!fs.existsSync(path.join(L, 'ai.txt')) && !fs.existsSync(path.join(L, 'omk-draft.css')), 'live adds no draft files');
  ok(run('--check', L, '--mode', 'live', '--clean', clean).status === 0, 'check live passes');
  ok(run('--check', L, '--mode', 'draft', '--clean', clean).status === 1, 'a live build fails the draft check');
}

// 3. handover
r = run('--handover', clean, '--out', path.join(TMP, 'handover'), '--site', 'demo', '--client', 'Demo Co', '--date', '2027-01-05');
ok(r.status === 0 && read(TMP, 'handover', 'index.html').includes('handed over to Demo Co on 2027-01-05') && !read(TMP, 'handover', 'index.html').includes('All rights reserved'), 'handover signs with the handed-over sentence, no rights claim');
ok(run('--check', path.join(TMP, 'handover'), '--mode', 'handover', '--clean', clean).status === 0, 'check handover passes');
ok(fs.existsSync(L) && read(L, 'index.html').includes(`report it to ${REPORT}`) && !read(TMP, 'handover', 'index.html').includes('unauthorised copy'), 'live keeps the stolen-copy notice; handover drops it');

// the draft lock: files, and the truth table of its pure decide()
if (fs.existsSync(D)) {
  ok(read(D, 'index.html').includes('<script src="/omk-lock.js" defer></script>') && read(D, 'omk-draft.css').includes('html:not(.omk-ok):not(.omk-warn) body{visibility:hidden}') && fs.existsSync(path.join(TMP, 'draft-functions', 'omk-key.js')), 'draft: lock script tag, hiding rule and key function');
  const sandbox = { __OMK_TEST__: {} };
  vm.runInNewContext(read(D, 'omk-lock.js'), sandbox);
  const T = sandbox.__OMK_TEST__, dec = (o) => T.decide({ hosts: T.hosts, id: T.id, ...o });
  ok(typeof T.decide === 'function' && T.hosts[0] === 'demo.example.com', 'lock: decide() and the embedded host list load');
  ok(dec({ hostname: 'demo.example.com', status: 200, body: JSON.stringify({ id: T.id }) }) === 'show', 'lock: listed host + good key -> show');
  ok(dec({ hostname: 'demo.example.com', status: 404, body: '' }) === 'warn', 'lock: listed host + 404 -> warn');
  ok(dec({ hostname: 'demo.example.com', status: 200, body: '<!doctype html><title>x</title>' }) === 'warn', 'lock: listed host + HTML 200 -> warn');
  ok(dec({ hostname: 'demo.example.com', status: 200, body: JSON.stringify({ id: 'omk-other' }) }) === 'warn', 'lock: listed host + another ID -> warn');
  ok(dec({ hostname: 'demo.example.com', error: true }) === 'show', 'lock: listed host + network error -> show');
  ok(dec({ hostname: 'demo.example.com', status: 503, body: '' }) === 'show' && dec({ hostname: 'demo.example.com', status: 429, body: '' }) === 'show', 'lock: listed host + 503/429 -> show');
  ok(dec({ hostname: 'www.demo-site.com', status: 200, body: JSON.stringify({ id: T.id }) }) === 'warn', 'lock: foreign host -> warn even with our key');
  ok(dec({ hostname: '', error: true }) === 'warn', 'lock: file opened from disk (no hostname) -> warn');
  ok(dec({ hostname: 'evilexample.com', status: 200, body: JSON.stringify({ id: T.id }) }) === 'warn', 'lock: a host that only ends like ours -> warn');
  const pd = path.join(TMP, 'pd');
  ok(run('--draft', clean, '--out', pd, '--site', 'demo', '--host', 'demo-site.pages.dev').status === 0, 'draft signs for a pages.dev host');
  const S2 = { __OMK_TEST__: {} }; vm.runInNewContext(read(pd, 'omk-lock.js'), S2);
  ok(S2.__OMK_TEST__.decide({ hosts: S2.__OMK_TEST__.hosts, id: S2.__OMK_TEST__.id, hostname: 'ab12cd34.demo-site.pages.dev', status: 200, body: JSON.stringify({ id: S2.__OMK_TEST__.id }) }) === 'show', 'lock: a deployment alias of the pages.dev host -> show');
  ok(run('--check', tamperH(D, 't5', (d) => fs.writeFileSync(path.join(d, 'omk-lock.js'), '')), '--mode', 'draft', '--clean', clean).status === 1, 'check: an emptied lock fails');
}

// host and dot-paths
ok(fs.existsSync(D) && read(D, 'index.html').includes('only at demo.example.com. If you find this signature at any other address'), 'draft names the one host it is published at');
ok(fs.existsSync(L) && read(L, 'index.html').includes('at demo.example.com only. If you find'), 'live names the host');
ok(fs.existsSync(D) && !fs.existsSync(path.join(D, '.checks')) && fs.existsSync(path.join(D, '.well-known', 'security.txt')), 'dot-folders left out, .well-known kept');
ok(run('--nohost', '--draft', clean, '--out', path.join(TMP, 'x0'), '--site', 'demo').status === 1, 'draft refuses without --host');
ok(fs.existsSync(L) && run('--check', tamper0(L, 't0'), '--mode', 'live', '--clean', clean).status === 1, 'check: a dot-path file in the output fails');

// 4. refusals
ok(run('--live', clean, '--out', path.join(TMP, 'x1'), '--site', 'demo').status === 1, 'live refuses without --client and --date');
ok(run('--draft', clean, '--out', D, '--site', 'demo').status === 1, 'refuses an --out that exists');
ok(run('--draft', clean, '--out', path.join(clean, 'sub'), '--site', 'demo').status === 1, 'refuses an --out inside the clean build');
ok(run('--draft', D, '--out', path.join(TMP, 'x2'), '--site', 'demo').status === 1, 'refuses to sign a signed folder');
const sri = fixture('sri', { 'index.html': '<!doctype html><html><head><link rel="stylesheet" href="/a.css" integrity="sha384-x"></head><body></body></html>' });
r = run('--draft', sri, '--out', path.join(TMP, 'x3'), '--site', 'demo');
ok(r.status === 1 && /index\.html loads a local file with integrity=/.test(r.stderr), 'refuses a local integrity= file, naming the page');
ok(run('--draft', fixture('br', { 'a.css.br': 'x' }), '--out', path.join(TMP, 'x4'), '--site', 'demo').status === 1, 'refuses precompressed siblings');
const nohead = fixture('nohead', { '_headers': null });
ok(run('--draft', nohead, '--out', path.join(TMP, 'nh'), '--site', 'demo').status === 0 && (read(TMP, 'nh', '_headers').match(/^\/\*\s*$/gm) || []).length === 1, 'no _headers: one /* block created');
// the register's place is --register or SIGN_SITE_REGISTER and nothing else: with neither a sign is refused before anything is written; a --check needs none
{
  const env = { ...process.env }; delete env.SIGN_SITE_REGISTER;
  const bare = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60000, env });
  const x = path.join(TMP, 'noreg'), regFile = path.join(TMP, 'given-register.tsv');
  const r0 = bare('--draft', clean, '--out', x, '--site', 'demo', '--host', 'demo.example.com');
  const r1 = bare('--draft', clean, '--out', path.join(TMP, 'withreg'), '--site', 'demo', '--host', 'demo.example.com', '--register', regFile);
  ok(r0.status === 1 && r0.stderr.split('\n').includes("REFUSED: the register's place is not set: give --register <file> or set SIGN_SITE_REGISTER (it is kept outside the repository)")
    && !fs.existsSync(x) && !fs.existsSync(`${x}-functions`) && !fs.existsSync(path.join(path.dirname(TOOL), 'register.tsv'))
    && r1.status === 0 && fs.existsSync(regFile) && read(regFile).trim().split('\n').length === 2
    && fs.existsSync(D) && bare('--check', D, '--mode', 'draft', '--clean', clean).status === 0, 'register: none given is refused before anything is written; --register <file> works; a --check needs none');
}

// a site whose own robots header equals the draft words before noai; a site that already has two "/*" blocks
const own = fixture('ownrobots', { '_headers': '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Frame-Options: DENY\n' });
ok(run('--draft', own, '--out', path.join(TMP, 'own'), '--site', 'demo').status === 0, 'a site\'s own "noindex, nofollow, noarchive" header is extended and stripped back exactly');
const two = fixture('twoblocks', { '_headers': '/*\n  X-Frame-Options: DENY\n\n/*\n  X-Robots-Tag: noindex\n' });
r = run('--draft', two, '--out', path.join(TMP, 'two'), '--site', 'demo');
ok(r.status === 0 && (read(TMP, 'two', '_headers').match(/^\/\*\s*$/gm) || []).length === 2, 'two existing "/*" blocks stay two');

// 5. the check catches tampering
const tamper = (src, name, fn) => { const d = path.join(TMP, name); fs.cpSync(src, d, { recursive: true }); fn(d); return d; };
if (fs.existsSync(D) && fs.existsSync(L)) {
  ok(run('--check', tamper(D, 't1', (d) => fs.writeFileSync(path.join(d, 'about', 'index.html'), read(d, 'about', 'index.html').replace(/<div class="omk-draft"[^]*?<\/div>/, ''))), '--mode', 'draft', '--clean', clean).status === 1, 'check: a page without the bar fails');
  ok(run('--check', tamper(L, 't2', (d) => fs.appendFileSync(path.join(d, 'index.html'), 'DRAFT PREVIEW')), '--mode', 'live', '--clean', clean).status === 1, 'check: a draft word in a live build fails');
  ok(run('--check', tamper(L, 't3', (d) => fs.writeFileSync(path.join(d, 'data.json'), '{"a":2}\n')), '--mode', 'live', '--clean', clean).status === 1, 'check: a changed .json fails');
  ok(run('--check', tamper(L, 't4', (d) => fs.writeFileSync(path.join(d, 'b.css'), read(d, 'b.css').replace('margin:0', 'margin:1px'))), '--mode', 'live', '--clean', clean).status === 1, 'check: a css change beyond the signature fails');
}
// the sealed-draft header rule: "blob:" in script-src is for drafts only, so live and handover refuse it
const H = path.join(TMP, 'handover');
if (fs.existsSync(L) && fs.existsSync(H)) {
  const blobbed = (src, name, directive = "script-src 'self' blob:") => tamper(src, name, (d) => fs.appendFileSync(path.join(d, '_headers'), `  Content-Security-Policy: ${directive}\n`));
  const rl = run('--check', blobbed(L, 't6'), '--mode', 'live', '--clean', clean), rh = run('--check', blobbed(H, 't7'), '--mode', 'handover', '--clean', clean);
  ok(rl.status === 1 && rl.stdout.includes('_headers: holds "blob:" (drafts only)') && rh.status === 1 && rh.stdout.includes('_headers: holds "blob:" (drafts only)'), 'check: "blob:" in a live or handover _headers fails');
  // "blob:" is a problem only inside a directive that lets scripts run (script-src, script-src-elem, default-src), whatever its case
  const imgOnly = fixture('blobimg', { '_headers': "/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: img-src 'self' blob:\n" });
  const ib = path.join(TMP, 'blobimg-live');
  const rs = run('--live', imgOnly, '--out', ib, '--site', 'demo', '--client', 'Demo Co', '--date', '2026-11-20');
  ok(rs.status === 0 && run('--check', ib, '--mode', 'live', '--clean', imgOnly).status === 0, 'check: "blob:" in img-src only passes at live');
  const ru = run('--check', blobbed(L, 't8', "script-src 'self' BLOB:"), '--mode', 'live', '--clean', clean);
  ok(ru.status === 1 && ru.stdout.includes('_headers: holds "blob:" (drafts only)'), 'check: "BLOB:" in script-src fails at live');
  const rd = run('--check', blobbed(L, 't9', "default-src 'self' blob:"), '--mode', 'live', '--clean', clean);
  ok(rd.status === 1 && rd.stdout.includes('_headers: holds "blob:" (drafts only)'), 'check: "blob:" in default-src fails at live');
}
// third-party files: a clean build lists them in third-party.json and every stage copies them byte for byte (names here are invented)
{
  const JS = '/*! examplelib 1.2.3 | BSD-2-Clause */\n!function(){window.ex=1}();\n', CSS = '.ex{margin:0}\n';
  const shaOf = (s) => createHash('sha256').update(s).digest('hex');
  const entry = (p, text, o = {}) => ({ path: p, sha256: shaOf(text), licence: 'vendor/LICENSE.txt', name: 'Examplelib', version: '1.2.3', source: 'https://example.test/examplelib-1.2.3', ...o });
  const good = [entry('vendor/examplelib.min.js', JS), entry('vendor/examplelib.min.css', CSS)];
  const withDecl = (name, list, extra = {}) => fixture(name, { 'vendor/examplelib.min.js': JS, 'vendor/examplelib.min.css': CSS, 'vendor/LICENSE.txt': 'Examplelib licence text\n', 'third-party.json': JSON.stringify({ files: list }), ...extra });
  const same = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));
  const tp = withDecl('tp', good), outs = {};
  for (const [stage, more] of [['draft', []], ['live', ['--client', 'Demo Co', '--date', '2026-11-20']], ['handover', ['--client', 'Demo Co', '--date', '2027-01-05']]]) {
    const o = outs[stage] = path.join(TMP, `tp-${stage}`);
    const rs = run(`--${stage}`, tp, '--out', o, '--site', 'demo', ...more);
    ok(rs.status === 0 && rs.stdout.includes('2 third-party files unchanged'), `third-party ${stage}: signs and says it left 2 files unchanged (exit ${rs.status}: ${rs.stderr.trim().slice(0, 200)})`);
    if (rs.status !== 0) continue;
    ok(['vendor/examplelib.min.js', 'vendor/examplelib.min.css', 'vendor/LICENSE.txt', 'third-party.json'].every((f) => same(path.join(o, f), path.join(tp, f))), `third-party ${stage}: the two declared files, the licence and the declaration are byte for byte the clean ones`);
    ok(read(o, 'app.js').startsWith('/*! ') && read(o, 'a.css').includes(':root{--omk-sig:') && read(o, 'b.css').includes(':root{--omk-sig:'), `third-party ${stage}: an undeclared css or js file is still stamped`);
    ok(run('--check', o, '--mode', stage, '--clean', tp).status === 0, `third-party ${stage}: check passes`);
  }
  if (outs.live && fs.existsSync(outs.live)) {
    const t1 = tamperH(outs.live, 'tp-t1', (d) => fs.writeFileSync(path.join(d, 'vendor', 'examplelib.min.js'), '/*! stamped */\n' + JS));
    const c1 = run('--check', t1, '--mode', 'live', '--clean', tp);
    ok(c1.status === 1 && c1.stdout.includes('vendor/examplelib.min.js: a declared third-party file must equal the clean one byte for byte'), 'third-party: check fails a declared file that was stamped');
    const t2 = tamperH(outs.live, 'tp-t2', (d) => fs.writeFileSync(path.join(d, 'app.js'), read(tp, 'app.js')));
    const c2 = run('--check', t2, '--mode', 'live', '--clean', tp);
    ok(c2.status === 1 && c2.stdout.includes('app.js: notice comment missing'), 'third-party: check fails an undeclared js file that was not stamped');
    const c3 = run('--check', outs.live, '--mode', 'live', '--clean', withDecl('tp-badclean', [entry('vendor/examplelib.min.js', 'other text'), good[1]]));
    ok(c3.status === 1 && c3.stdout.includes('third-party.json: entry 1: the sha256 of "vendor/examplelib.min.js" is not the declared one'), 'third-party: check holds the clean build to its declaration');
  }
  const refused = (name, list, why, extra) => {
    const o = path.join(TMP, `tpx-${name}`);
    const rx = run('--live', withDecl(`tpc-${name}`, list, extra), '--out', o, '--site', 'demo', '--client', 'Demo Co', '--date', '2026-11-20');
    ok(rx.status === 1 && rx.stderr.split('\n').includes(`REFUSED: third-party.json: ${why}`) && !fs.existsSync(o), `third-party refused (${name}): one line, nothing written (exit ${rx.status}: ${rx.stderr.trim().slice(0, 160)})`);
  };
  const pageSha = shaOf(fs.readFileSync(path.join(TMP, 'clean', 'about', 'index.html')));
  refused('no-file', [entry('vendor/none.js', JS)], 'entry 1: "vendor/none.js" is not a file of the build');
  refused('no-licence', [entry('vendor/examplelib.min.js', JS, { licence: 'vendor/NOPE.txt' })], 'entry 1: "vendor/NOPE.txt" is not a file of the build');
  refused('wrong-sha', [entry('vendor/examplelib.min.js', 'other text')], 'entry 1: the sha256 of "vendor/examplelib.min.js" is not the declared one');
  refused('page', [entry('about/index.html', 'x', { sha256: pageSha })], 'entry 1: "about/index.html" is not a css or js file');
  refused('up', [entry('../outside.js', JS)], 'entry 1: "../outside.js" is a dot path, which never ships');
  refused('dot-path', [entry('.checks/run.mjs', 'internal();\n')], 'entry 1: ".checks/run.mjs" is a dot path, which never ships');
  for (const [n, p] of [['absolute', '/vendor/examplelib.min.js'], ['backslash', 'vendor\\examplelib.min.js'], ['case', 'Vendor/examplelib.min.js']]) refused(n, [entry(p, JS)], `entry 1: "${p}" is not a file of the build`);
  refused('twice', [good[0], good[0]], 'entry 2: "vendor/examplelib.min.js" is declared twice');
  refused('no-name', [entry('vendor/examplelib.min.js', JS, { name: '' })], 'entry 1: name must be a non-empty text');
  refused('not-json', [], 'is not valid JSON', { 'third-party.json': '{nope' });
  refused('wrong-shape', [], 'must be {"files": [ ... ]}', { 'third-party.json': '{"files": 3}' });
}
const lines = fs.existsSync(REG) ? read(REG).trim().split('\n') : [];
ok(lines.length >= 5 && lines[0].startsWith('time_utc\tsite\tstage\tid'), 'register: header and one line per signing');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`sign-site tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

// mutants: each must turn this test red
if (process.argv.includes('--mutants')) {
  const MUT = [
    ['no bar on drafts', "(stage === 'draft' ? m.bar : '')", "''"],
    ['bar in every stage', "(stage === 'draft' ? m.bar : '')", 'm.bar'],
    ['json touched', "else if (r === '_headers') fs.writeFileSync", "else if (r.endsWith('.json')) fs.appendFileSync(f, ' ');\n    else if (r === '_headers') fs.writeFileSync"],
    ['check ignores untouched kinds', "} else if (!s.equals(c)) problems.push", "} else if (false) problems.push"],
    ['lock skips the hostname test', "if (!hostOk(i.hostname, i.hosts)) return 'warn';", ''],
    ['a declared file is stamped', '&& !third.set.has(r)', ''],
    ['one declared file unstamps every css and js file', '&& !third.set.has(r)', '&& third.set.size === 0'],
    ['check lets a stamped declared file pass', "if (!s.equals(c)) problems.push(`${r}: a declared third-party file must equal the clean one byte for byte`);", ''],
    ['check treats every css and js file as declared once one is', '} else if (third.set.has(r)) {', '} else if (third.set.size > 0) {'],
    ['check ignores a declaration that does not hold', 'if (third.problem) problems.push(third.problem);', ''],
    ['sign does not refuse a bad declaration', 'if (third.problem) fail(third.problem);', ''],
    ['a declared sha256 is not compared', '!== e.sha256', '=== undefined'],
    ['a licence file is not looked for', 'for (const p of [e.path, e.licence]) {', 'for (const p of [e.path]) {'],
    ['a dot path can be declared', "p.split('/').some((s) => s.startsWith('.'))", 'false'],
    ['a path outside the build list is accepted', 'if (!have.has(p)) return bad(', 'if (false) return bad('],
    ['a page can be declared', 'if (!isCss(e.path) && !isJs(e.path)) return bad(', 'if (false) return bad('],
    ['a path can be declared twice', 'if (set.has(e.path)) return bad(', 'if (false) return bad('],
    ['an empty field is accepted', "if (typeof e?.[k] !== 'string' || !e[k]) return bad(", 'if (false) return bad('],
    ['a declaration that is not JSON is ignored', "catch { return bad('is not valid JSON'); }", 'catch { d = { files: [] }; }'],
    ['a declaration of the wrong shape is read on', 'if (!d || !Array.isArray(d.files)) return bad(', 'if (false) return bad('],
  ];
  let caught = 0;
  for (const [name, from, to] of MUT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-site-mut-'));
    const src = fs.readFileSync(path.join(HERE, 'sign-site.mjs'), 'utf8');
    if (src.split(from).length !== 2) { console.log(`MUTANT TARGET NOT FOUND once: ${name}`); process.exitCode = 1; continue; }
    fs.writeFileSync(path.join(dir, 'sign-site.mjs'), src.split(from).join(to));
    fs.copyFileSync(path.join(HERE, 'wording.json'), path.join(dir, 'wording.json'));
    fs.cpSync(path.join(HERE, 'assets'), path.join(dir, 'assets'), { recursive: true });
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 300000, env: { ...process.env, SIGN_SITE_TOOL: path.join(dir, 'sign-site.mjs') } });
    const red = res.status !== 0;
    if (red) caught++;
    console.log(`mutant "${name}": ${red ? 'caught' : 'MISSED'} (${(res.stdout.trim().split('\n').pop() || '').trim()})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`mutants: ${caught}/${MUT.length} caught`);
  if (caught !== MUT.length) process.exitCode = 1;
}
