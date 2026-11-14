// Tests for site-manifest.mjs: the schema of golive.site.json, one case per rule, the good fixtures, the usage exits.
// usage: node site-manifest.test.mjs            (SITE_MANIFEST_TOOL=<path> tests another copy of the tool; used by the mutants)
//        node site-manifest.test.mjs --mutants  (copies the tool, breaks it 32 ways, expects this test to go red for the broken rule each time)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = process.env.SITE_MANIFEST_TOOL || path.join(HERE, 'site-manifest.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'demo-site.golive.site.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'site-manifest-test-'));
const OTHER = fs.mkdtempSync(path.join(os.tmpdir(), 'site-manifest-other-'));
const F = path.join(TMP, 'golive.site.json');
const USAGE = 'usage: node tools/golive/site-manifest.mjs <file> [--base <folder>]';
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) passed++; else { failed++; console.log(`  FAIL ${name}`); } };
const run = (...args) => spawnSync(process.execPath, ['--max-old-space-size=256', TOOL, ...args], { encoding: 'utf8', timeout: 60000 });
const TOOLMOD = await import(pathToFileURL(TOOL).href).catch(() => null);

const good = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const edit = (fn) => { const m = good(); fn(m); return m; };
const put = (m) => fs.writeFileSync(F, typeof m === 'string' ? m : JSON.stringify(m, null, 1) + '\n');
const L = (p, t) => `REFUSED: ${F}: ${p}: ${t}`;
const out = (r) => (r.stderr || '').split(/\r?\n/).filter(Boolean);
// one run: the manifest m must give exactly the lines exp, exit 1, stdout empty
const refuses = (m, exp, secrets = []) => {
  put(m);
  const r = run(F);
  const got = out(r);
  const same = r.status === 1 && r.stdout === '' && isDeepStrictEqual(got, exp) && !secrets.some((s) => (r.stderr || '').includes(s));
  if (!same) console.log(`    expected ${JSON.stringify(exp)}\n    got      ${JSON.stringify(got)} exit ${r.status}`);
  return same;
};
const passes = (m) => { put(m); const r = run(F); return r.status === 0 && r.stderr === '' && r.stdout === `OK: ${F}: manifest valid\n`; };

// the base tree, listed here and never taken from the tool: no built page, no vendored file, no sitemap
for (const d of ['site-src/proof', 'tools', 'lead/tests', 'functions']) fs.mkdirSync(path.join(TMP, d), { recursive: true });
for (const f of ['site-src/launch.mjs', 'site-src/proof/serve-local.mjs', 'tools/phone-use.mjs', 'lead/tests/run-all.mjs', 'functions/lead.js', 'claims.json', 'old-addresses.txt', '_redirects']) fs.writeFileSync(path.join(TMP, f), '');

const T = {
  id: 'must be an id: lowercase letters and digits, a letter first, words joined by single hyphens, at most 40',
  name: 'must be a variable NAME: capitals and digits in words joined by underscores, at least two words, at most 40',
  secret: (s) => `looks like a secret (${s}); a manifest names a variable, never a value`,
  host: 'must be a host name: lowercase letters, digits, hyphens, at least one dot',
  path: 'must be a relative path: letters, digits, . _ - and single slashes, each part starting and ending with a letter, digit or _, no device names, at most 200',
  page: 'must be "home", or a relative path ending in "/" or ".html" (letters, digits, . _ - and single slashes, no ".." , no device names)',
  cmd: 'must be "node <script> <words>": words of letters, digits and . _ / : = , { } - joined by single spaces, at most 300',
  sel: 'must be one CSS selector: 1 to 200 printable characters with balanced [] () and quotes',
  widths: 'must be 1 to 6 widths, each larger than the one before',
  query: 'must look like ?name=value (letters, digits, underscores)',
  req: 'required, missing',
};
const unk = (list) => `unknown key (allowed: ${list})`;
const ROOT = 'version, site, source, build, serve, pages, widths, wide, motion, menu, selectors, forms, vendored, claims, redirects, lead, deploy, own';
const SELS = 'header, bar, logo, footerBar, legalLinks, sections, menuButton, menuSheet, mega, pageBar';
const MENU = ['menuButton', 'menuSheet', 'mega', 'pageBar'];
const whole = (lo, hi) => `must be a whole number from ${lo} to ${hi}`;
const placeholder = (x, allowed) => `placeholder {${x}} is not allowed here (allowed: ${allowed})`;
const SHAPES = {
  jwt: ['ey', 'J', 'x'.repeat(10), '.', 'y'.repeat(10), '.z'].join(''),
  'supabase-key': 'sb_' + 'secret_' + 'a'.repeat(12),
  'github-token': 'gh' + 'p_' + 'a'.repeat(24),
  'aws-key': 'AK' + 'IA' + 'A'.repeat(16),
  'private-key': '-----' + 'BEGIN KEY-----',
  'url-with-password': 'https://u:p' + 'w@host',
  bearer: 'Bear' + 'er ' + 'a'.repeat(20),
  'hex-run': '0123456789abcdef'.repeat(2),
  'long-token': 'Zz9_'.repeat(11),
};
const R03 = () => ({ m: edit((m) => { delete m.deploy.tokenKey; }), exp: [L('deploy.tokenKey', T.req)] });

try {
  // R01
  {
    const e = [L('(file)', 'cannot be read as one JSON object')];
    const a = refuses('[]', e);
    const b = refuses('{', e);
    fs.rmSync(F, { force: true });
    const r = run(F);
    const c = r.status === 1 && r.stdout === '' && isDeepStrictEqual(out(r), e);
    ok(a && b && c, 'R01: not one JSON object, three runs');
  }
  // R02
  {
    const add = (fn, p, list) => refuses(edit(fn), [L(p, unk(list))]);
    const r = [
      add((m) => { m.selectors.headr = '.x'; }, 'selectors.headr', SELS),
      add((m) => { m.extra = 1; }, 'extra', ROOT),
      add((m) => { m.forms[0].zz = 1; }, 'forms[0].zz', 'flow, page, selector, sheetTab, steps'),
      add((m) => { m.build.proofs[0].zz = 1; }, 'build.proofs[0].zz', 'id, cmd, env'),
      add((m) => { m.pages.samples.zz = 1; }, 'pages.samples.zz', 'deep'),
    ];
    ok(r.every(Boolean), 'R02: unknown key at five depths');
  }
  // R03
  { const c = R03(); ok(refuses(c.m, c.exp), 'R03: a required key missing'); }
  // R04
  ok(refuses(edit((m) => { m.wide = '1366'; m.forms[0].steps = 1; m.own = {}; }),
    [L('wide', 'must be an integer'), L('forms[0].steps', 'must be true or false'), L('own', 'must be an array')]), 'R04: wrong type, sweep of three');
  // R05
  ok(refuses(edit((m) => { m.site = '9Bad'; m.deploy.project = '9Bad'; m.forms[0].flow = '9Bad'; m.vendored[0].name = '9Bad'; m.build.proofs[0].id = '9Bad'; m.own[0].id = '9Bad'; }),
    ['site', 'build.proofs[0].id', 'forms[0].flow', 'vendored[0].name', 'deploy.project', 'own[0].id'].map((p) => L(p, T.id))), 'R05: id form, sweep of six');
  // R06
  ok(refuses(edit((m) => { m.deploy.tokenKey = 'token'; m.build.proofs[1].env = { lower_case: 'all' }; }),
    [L('build.proofs[1].env', T.name), L('deploy.tokenKey', T.name)]), 'R06: NAME form, sweep of two');
  // R07
  {
    const m = good();
    m.build.proofs[0].env = { DEMO_JWT: SHAPES.jwt, DEMO_SB: SHAPES['supabase-key'], DEMO_GH: SHAPES['github-token'], DEMO_AWS: SHAPES['aws-key'], DEMO_PEM: SHAPES['private-key'] };
    m.build.proofs[1].env = { DEMO_URL: SHAPES['url-with-password'], DEMO_BEARER: SHAPES.bearer, DEMO_HEX: SHAPES['hex-run'], DEMO_LONG: SHAPES['long-token'] };
    m.deploy.project = SHAPES['hex-run'];
    const e = [
      ['build.proofs[0].env.DEMO_JWT', 'jwt'], ['build.proofs[0].env.DEMO_SB', 'supabase-key'], ['build.proofs[0].env.DEMO_GH', 'github-token'],
      ['build.proofs[0].env.DEMO_AWS', 'aws-key'], ['build.proofs[0].env.DEMO_PEM', 'private-key'], ['build.proofs[1].env.DEMO_URL', 'url-with-password'],
      ['build.proofs[1].env.DEMO_BEARER', 'bearer'], ['build.proofs[1].env.DEMO_HEX', 'hex-run'], ['build.proofs[1].env.DEMO_LONG', 'long-token'],
      ['deploy.project', 'hex-run'],
    ].map(([p, s]) => L(p, T.secret(s)));
    ok(refuses(m, e, Object.values(SHAPES)), 'R07: nine secret shapes in env values and a project, none printed');
  }
  // R08
  ok(refuses(edit((m) => { m.deploy.host = 'Demo.Example.test'; }), [L('deploy.host', T.host)]), 'R08: host name');
  // R09
  ok(refuses(edit((m) => {
    m.claims = '../x.json'; m.redirects.rules = '/abs.txt'; m.redirects.old = 'a//b'; m.lead.function = 'a b.js'; m.vendored[0].dir = '.hid/';
    m.own[0].cmd = 'node nul.mjs {live} {full}'; m.serve = 'node x. {dir} {port}';
  }), ['serve', 'vendored[0].dir', 'claims', 'redirects.rules', 'redirects.old', 'lead.function', 'own[0].cmd'].map((p) => L(p, T.path))), 'R09: path form, sweep of seven');
  // R10
  {
    const a = refuses(edit((m) => { m.source.dir = 'claims.json'; }), [L('source.dir', 'claims.json is not a folder under the base folder')]);
    const b = refuses(edit((m) => {
      m.claims = 'nope-claims.json'; m.redirects.rules = 'nope-rules'; m.redirects.old = 'nope-old.txt'; m.lead.function = 'nope/lead.js';
      m.build.live = 'node nope/live.mjs --out {out}'; m.build.proofs[0].cmd = 'node nope/proof.mjs --out {out}'; m.serve = 'node nope/serve.mjs {dir} {port}';
      m.lead.tests = 'node nope/tests.mjs'; m.own[0].cmd = 'node nope/own.mjs {live} {full}';
    }), [
      ['build.live', 'nope/live.mjs'], ['build.proofs[0].cmd', 'nope/proof.mjs'], ['serve', 'nope/serve.mjs'], ['claims', 'nope-claims.json'],
      ['redirects.rules', 'nope-rules'], ['redirects.old', 'nope-old.txt'], ['lead.function', 'nope/lead.js'], ['lead.tests', 'nope/tests.mjs'], ['own[0].cmd', 'nope/own.mjs'],
    ].map(([p, rel]) => L(p, `${rel} is not a file under the base folder`)));
    ok(a && b, 'R10: a file or folder missing or of the wrong kind, two runs');
  }
  // R11
  {
    let made = true;
    try {
      fs.writeFileSync(path.join(OTHER, 'claims.json'), '');
      fs.symlinkSync(OTHER, path.join(TMP, 'linked'), 'junction');
    } catch (e) { made = false; ok(false, `R11: junction not made (${e.code})`); }
    if (made) ok(refuses(edit((m) => { m.claims = 'linked/claims.json'; }), [L('claims', 'linked/claims.json resolves outside the base folder')]), 'R11: a junction leaving the base folder');
  }
  // R12
  ok(refuses(edit((m) => { m.pages.list[0] = 'about'; m.pages.extra[0] = '../x.html'; m.pages.samples.deep = '/areas/'; m.forms[0].page = 'con.html'; m.vendored[0].pages[0] = 'a//b/'; }),
    ['pages.list[0]', 'pages.extra[0]', 'pages.samples.deep', 'forms[0].page', 'vendored[0].pages[0]'].map((p) => L(p, T.page))), 'R12: page form, sweep of five');
  // R13
  ok(refuses(edit((m) => { m.widths[0] = 100; m.redirects.waitOwner = -1; m.vendored[0].minWidth = 0; m.wide = 5000; }),
    [L('widths[0]', whole(320, 1024)), L('wide', whole(320, 3840)), L('vendored[0].minWidth', whole(1, 3840)), L('redirects.waitOwner', whole(0, 1000))]), 'R13: integer range, sweep of four');
  // R14
  ok(refuses(edit((m) => { m.widths = [390, 360]; }), [L('widths', T.widths)]), 'R14: widths not rising');
  // R15
  ok(refuses(edit((m) => { m.wide = 430; }), [L('wide', 'must be larger than the largest width (430)')]), 'R15: wide not larger than the last width');
  // R16
  ok(refuses(edit((m) => { m.build.live = 'npm run build {out}'; m.serve = 'node  x.mjs {dir} {port}'; m.lead.tests = 'node lead/tests/run-all.mjs; rm x'; m.own[0].cmd = 'node'; }),
    ['build.live', 'serve', 'lead.tests', 'own[0].cmd'].map((p) => L(p, T.cmd))), 'R16: command form, sweep of four');
  // R17
  ok(refuses(edit((m) => { m.serve += ' {mega}'; m.selectors.logo = 'a{'; m.lead.tests = 'node lead/tests/run-all.mjs {out}'; }),
    [L('serve', placeholder('mega', '{dir}, {port}')), L('selectors.logo', placeholder('', 'none')), L('lead.tests', placeholder('out', 'none'))]), 'R17: placeholder not allowed here');
  // R18
  ok(refuses(edit((m) => { m.build.live = 'node site-src/launch.mjs'; m.serve = 'node site-src/proof/serve-local.mjs {dir}'; m.selectors.mega = '[data-mega]'; }),
    [L('build.live', 'must contain {out}'), L('serve', 'must contain {port}'), L('selectors.mega', 'must contain {id}')]), 'R18: required placeholder missing');
  // R19
  ok(refuses(edit((m) => { m.selectors.header = ''; m.selectors.bar = 'a[b'; m.selectors.logo = 'a("b'; m.forms[0].selector = 'a\nb'; }),
    ['selectors.header', 'selectors.bar', 'selectors.logo', 'forms[0].selector'].map((p) => L(p, T.sel))), 'R19: selector form, sweep of four');
  // R20
  ok(refuses(edit((m) => { m.version = 2; m.pages.from = 'both'; m.menu.kind = 'drop'; }),
    [L('version', 'must be one of: 1'), L('pages.from', 'must be one of: sitemap, list'), L('menu.kind', 'must be one of: sheet+mega, none')]), 'R20: enum value outside its list');
  // R21
  ok(refuses(edit((m) => { m.pages.list.push('home'); m.forms.push(structuredClone(m.forms[0])); m.own.push(structuredClone(m.own[0])); }),
    [L('pages.list[4]', 'duplicate "home"'), L('forms[1].flow', 'duplicate "contact"'), L('own[1].id', 'duplicate "site-phone"')]), 'R21: duplicates in three arrays');
  // R22
  {
    const one = (id) => refuses(edit((m) => { m.own[0].id = id; }), [L('own[0].id', `"${id}" is a platform step id; a site's own check needs another id`)]);
    const a = one('build');
    const b = one('walk');
    ok(a && b, 'R22: an own id equal to a platform step id, two runs');
  }
  // R23
  ok(refuses(edit((m) => { m.lead.testFlow = 'quote'; }), [L('lead.testFlow', 'names flow "quote", which is not in forms')]), 'R23: test flow not in forms');
  // R24
  {
    const a = refuses(edit((m) => { delete m.pages.list; }), [L('pages.list', 'is required when pages.from is "list"')]);
    const b = refuses(edit((m) => { delete m.pages.samples; for (const k of MENU) delete m.selectors[k]; }),
      [L('pages.samples', 'is required when menu.kind is "sheet+mega"'), ...MENU.map((k) => L(`selectors.${k}`, 'is required when menu.kind is "sheet+mega"'))]);
    ok(a && b, 'R24: a conditional key missing, two runs');
  }
  // R25
  {
    const a = refuses(edit((m) => { m.pages.from = 'sitemap'; }), [L('pages.list', 'is not allowed when pages.from is "sitemap"')]);
    const b = refuses(edit((m) => { m.menu.kind = 'none'; }),
      [L('pages.samples', 'is not allowed when menu.kind is "none"'), ...MENU.map((k) => L(`selectors.${k}`, 'is not allowed when menu.kind is "none"'))]);
    ok(a && b, 'R25: a conditional key present when it must not be, two runs');
  }
  // R26
  ok(refuses(edit((m) => { m.forms[0].sheetTab = 'ab '.repeat(14).slice(0, 41); m.own[0].pass = ''; }),
    [L('forms[0].sheetTab', 'must be 1 to 40 printable characters'), L('own[0].pass', 'must be 1 to 80 printable characters')]), 'R26: text length');
  // R27
  ok(refuses(edit((m) => { m.motion.on = 'motion=on'; }), [L('motion.on', T.query)]), 'R27: query form');
  // R28
  ok(refuses(edit((m) => { m.vendored[0].version = '1.9'; }), [L('vendored[0].version', 'must be a version like 1.9.4')]), 'R28: version form');
  // R29
  ok(refuses(edit((m) => { m.build.proofs[1].env.DEMO_EMPTY = 'a b'; }), [L('build.proofs[1].env.DEMO_EMPTY', 'must be 1 to 64 of letters, digits, . _ -')]), 'R29: env value form');
  // R30
  ok(refuses(edit((m) => { m.pages.list = Array.from({ length: 61 }, (_, i) => `p${i + 1}/`); m.forms = []; }),
    [L('pages.list', 'must hold 1 to 60 items'), L('forms', 'must hold 1 to 12 items')]), 'R30: array length');
  // G1
  { fs.copyFileSync(FIXTURE, F); const r = run(F); ok(r.status === 0 && r.stderr === '' && r.stdout === `OK: ${F}: manifest valid\n`, 'G1: the fixture is valid'); }
  // G2
  ok(passes(edit((m) => { m.pages.from = 'sitemap'; delete m.pages.list; })), 'G2: from sitemap, no list, nothing read from disk');
  // G3
  ok(passes(edit((m) => {
    delete m.build.proofs; delete m.vendored; delete m.own; delete m.pages.extra; delete m.forms[0].steps;
    m.menu.kind = 'none'; delete m.pages.samples; for (const k of MENU) delete m.selectors[k];
  })), 'G3: every optional absent, menu none');
  // U1 to U4
  {
    const bad = (r) => r.status === 2 && r.stdout === '' && isDeepStrictEqual(out(r), [USAGE]);
    fs.copyFileSync(FIXTURE, F);
    ok(bad(run()), 'U1: no argument');
    ok(bad(run('--nothing')), 'U2: unknown option');
    ok(bad(run(F, '--base', path.join(TMP, 'no-such-folder'))), 'U3: base is not a folder');
    ok(bad(run(F, '--base')), 'U4: base without a value');
  }
  // A1
  {
    fs.copyFileSync(FIXTURE, F);
    let r = null;
    try { r = TOOLMOD.checkManifest(F, TMP); } catch { r = null; }
    ok(!!r && isDeepStrictEqual(r.faults, []) && isDeepStrictEqual(r.manifest, JSON.parse(fs.readFileSync(F, 'utf8'))), 'A1: checkManifest on the good file');
  }
  // A2
  {
    const c = R03();
    put(c.m);
    let r = null;
    try { r = TOOLMOD.checkManifest(F, TMP); } catch { r = null; }
    ok(!!r && r.manifest === null && isDeepStrictEqual(r.faults, c.exp), 'A2: checkManifest on a refused file');
  }
  // F1
  ok(refuses(edit((m) => { delete m.deploy.tokenKey; m.widths[0] = 100; }), [L('widths[0]', whole(320, 1024)), L('deploy.tokenKey', T.req)]), 'F1: two faults, schema order');
  // F2
  ok(refuses('{"__proto__": {}, ' + fs.readFileSync(FIXTURE, 'utf8').trimStart().slice(1), [L('__proto__', unk(ROOT))]), 'F2: the key __proto__ is an unknown key');
} catch (e) {
  failed++;
  console.log(`  FAIL crash: ${e && e.message}`);
} finally {
  try { fs.unlinkSync(path.join(TMP, 'linked')); } catch { /* not made */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(OTHER, { recursive: true, force: true });
}
console.log(`site-manifest tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

// mutants: each must turn this test red, and for faults 1 to 30 red for the broken rule's own case
if (process.argv.includes('--mutants')) {
  const MUT = [];
  for (let n = 1; n <= 30; n++) {
    const id = 'R' + String(n).padStart(2, '0');
    MUT.push([id, `bad('${id}', `, `bad('${id}', false && `, id]);
  }
  MUT.push(['exit 0 always', 'process.exit(faults.length ? 1 : 0)', 'process.exit(0)', null]);
  MUT.push(['usage exits 1', 'process.exit(2)', 'process.exit(1)', null]);
  let caught = 0;
  for (const [name, from, to, id] of MUT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-manifest-mut-'));
    const src = fs.readFileSync(path.join(HERE, 'site-manifest.mjs'), 'utf8');
    if (src.split(from).length !== 2) { console.log(`MUTANT TARGET NOT FOUND once: ${name}`); process.exitCode = 1; fs.rmSync(dir, { recursive: true, force: true }); continue; }
    fs.writeFileSync(path.join(dir, 'site-manifest.mjs'), src.split(from).join(to));
    const res = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 300000, env: { ...process.env, SITE_MANIFEST_TOOL: path.join(dir, 'site-manifest.mjs') } });
    const red = res.status !== 0 && (id === null ? /FAIL /.test(res.stdout) : res.stdout.includes(`FAIL ${id}:`));
    if (red) caught++;
    console.log(`mutant "${name}": ${red ? 'caught' : 'MISSED'} (${(res.stdout.trim().split('\n').pop() || '').trim()})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`mutants: ${caught}/${MUT.length} caught`);
  if (caught !== MUT.length) process.exitCode = 1;
}
