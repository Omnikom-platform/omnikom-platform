// Tests for search-gate.mjs: the go-live step that holds a built site to the signed research plan its manifest names, with the SEO skill's gate, strict.
// usage: node search-gate.test.mjs            (SEARCH_GATE_TOOL=<path> tests another copy of the tool; used by the mutants)
//        node search-gate.test.mjs --mutants  (copies the tool, breaks it 27 ways, expects this test to go red for the broken rule each time)
// The plan, the built site and the signing are the skill's own fixtures, made in one temp folder that is removed at the end. No network, no browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_REAL = path.join(HERE, '..', '..', 'skills', 'programmatic-enterprise-web-performance');
const TOOL = process.env.SEARCH_GATE_TOOL || path.join(HERE, 'search-gate.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'demo-site.golive.site.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'search-gate-test-'));
const HOST = 'demo-old.example.test';
const USAGE = 'usage: node tools/golive/search-gate.mjs --manifest <file> --built <folder> --out <folder> [--data <folder>]';
let passed = 0, failed = 0;
const ok = (cond, name, why) => { if (cond) passed++; else { failed++; console.log(`  FAIL ${name}`); if (why) console.log(`    ${String(why).slice(0, 600)}`); } };

const node = (script, args, timeout = 120000) => spawnSync(process.execPath, ['--max-old-space-size=256', script, ...args], { encoding: 'utf8', timeout, maxBuffer: 1 << 26 });
const lines = (s) => (s || '').split(/\r?\n/).filter(Boolean);
const last = (s) => lines(s).pop() ?? '';
const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const there = (p) => fs.existsSync(p);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const snap = (dir) => {
  const rows = [];
  const walk = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else { const s = fs.statSync(p); rows.push(`${path.relative(dir, p)}|${s.size}|${s.mtimeMs}`); }
    }
  };
  walk(dir);
  return rows.sort();
};
let nn = 0;
const fresh = (label) => path.join(TMP, `${label}-${++nn}`);
const patch = (file, from, to) => {
  const src = fs.readFileSync(file, 'utf8');
  if (src.split(from).length !== 2) throw new Error(`patch never applied (not exactly one): ${from.slice(0, 60)}`);
  fs.writeFileSync(file, src.split(from).join(to));
};

// a repo of its own: the tool under test and a copy of the manifest checker; the skill is a junction to the real one, or a fake with only a gate
const FAKE_HEAD = "import fs from 'node:fs';\nimport path from 'node:path';\nconst o = process.argv[process.argv.indexOf('--out') + 1];\nfs.mkdirSync(o, { recursive: true });\nfs.writeFileSync(path.join(o, 'argv.json'), JSON.stringify({ a: process.argv.slice(2), e: process.execArgv }));\n";
const repo = (fakeGate) => {
  const d = fresh('repo');
  fs.mkdirSync(path.join(d, 'tools', 'golive'), { recursive: true });
  try { fs.copyFileSync(TOOL, path.join(d, 'tools', 'golive', 'search-gate.mjs')); } catch { /* the tool is absent: the run exits 1 */ }
  fs.copyFileSync(path.join(HERE, 'site-manifest.mjs'), path.join(d, 'tools', 'golive', 'site-manifest.mjs'));
  const sk = path.join(d, 'skills', 'programmatic-enterprise-web-performance');
  if (fakeGate === undefined) { fs.mkdirSync(path.dirname(sk), { recursive: true }); fs.symlinkSync(SKILL_REAL, sk, 'junction'); }
  else { fs.mkdirSync(path.join(sk, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(sk, 'scripts', 'gate.mjs'), FAKE_HEAD + fakeGate); }
  return d;
};
const run = (d, ...args) => node(path.join(d, 'tools', 'golive', 'search-gate.mjs'), args);

const page = (name, slug) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${name} | Sample Valley Realty</title><meta name="description" content="${name}: Sample Valley Realty."><link rel="canonical" href="https://sample-valley-realty.test/${slug}/"></head>\n<body><main><h1>${name}</h1><p>${name} at Sample Valley Realty, in plain words.</p></main>\n<footer><p>Jane Sample, Real Estate Salesperson. DRE #01234567. Broker: Sample Valley Brokerage Inc. &copy; 2026 Sample Valley Realty</p></footer></body></html>\n`;
const PATHS = ['/', '/rocklin-ca/', '/lincoln-ca/', '/sell/cost-of-a-realtor/', '/home-value/', '/guides/sell-my-house-without-a-realtor-california/', '/privacy/', '/accessibility/'];
const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PATHS.map((p, i) => `<url><loc>https://sample-valley-realty.test${p}</loc><lastmod>2026-09-0${i + 1}T09:00:00Z</lastmod></url>`).join('\n')}\n</urlset>\n`;
const HOME_FOOT = '<a href="/privacy/">Privacy policy</a> <a href="/accessibility/">Accessibility statement</a></footer>';

try {
  // setup: the manifest tree, the unsigned and the signed plan, the good built site
  const M = path.join(TMP, 'm');
  for (const d of ['site-src/proof', 'tools', 'lead/tests', 'functions']) fs.mkdirSync(path.join(M, d), { recursive: true });
  for (const f of ['site-src/launch.mjs', 'site-src/proof/serve-local.mjs', 'tools/phone-use.mjs', 'lead/tests/run-all.mjs', 'functions/lead.js', 'claims.json', 'old-addresses.txt', '_redirects']) fs.writeFileSync(path.join(M, f), '');
  const MAN = path.join(M, 'golive.site.json');
  fs.copyFileSync(FIXTURE, MAN);
  const { PLAN_FLAGS } = await import(pathToFileURL(path.join(SKILL_REAL, 'fixtures', 'build-fixtures.mjs')).href);
  const UNS = path.join(TMP, 'unsigned');
  const UPEWP = path.join(UNS, 'site-checks', HOST, '.pewp');
  fs.cpSync(path.join(SKILL_REAL, 'fixtures', 'pewp'), UPEWP, { recursive: true });
  const pr = node(path.join(SKILL_REAL, 'scripts', 'plan-site.mjs'), [UPEWP, ...PLAN_FLAGS]);
  ok(pr.status === 0, 'setup: the fixture plan is made (plan-site.mjs exit 0)', pr.stdout + pr.stderr);
  const SIG = path.join(TMP, 'signed');
  const SPEWP = path.join(SIG, 'site-checks', HOST, '.pewp');
  fs.cpSync(UNS, SIG, { recursive: true });
  const s1 = node(path.join(SKILL_REAL, 'scripts', 'approve.mjs'), ['--pewp', SPEWP, 'targets', '--by', 'Test Owner']);
  const s2 = node(path.join(SKILL_REAL, 'scripts', 'approve.mjs'), ['--pewp', SPEWP, 'plan', '--by', 'Test Owner']);
  ok(s1.status === 0 && s2.status === 0, 'setup: the copy is signed (approve.mjs targets and plan, exit 0 each)', `${s1.status} ${s1.stdout}${s1.stderr} | ${s2.status} ${s2.stdout}${s2.stderr}`);

  const GOOD = path.join(TMP, 'good');
  fs.cpSync(path.join(SKILL_REAL, 'fixtures', 'site-clean'), GOOD, { recursive: true });
  for (const [name, slug] of [['Privacy Policy', 'privacy'], ['Accessibility Statement', 'accessibility']]) {
    fs.mkdirSync(path.join(GOOD, slug), { recursive: true });
    fs.writeFileSync(path.join(GOOD, slug, 'index.html'), page(name, slug));
  }
  patch(path.join(GOOD, 'index.html'), '</footer>', HOME_FOOT);
  fs.writeFileSync(path.join(GOOD, 'sitemap.xml'), sitemap());
  const variant = (label, fn) => { const d = fresh(label); fs.cpSync(GOOD, d, { recursive: true }); fn(d); return d; };
  const R = repo();
  const go = (d, built, out, data) => run(d, '--manifest', MAN, '--built', built, '--out', out, '--data', data);

  // S1
  const o1 = fresh('out');
  const before = [snap(SPEWP), snap(GOOD)];
  const r1 = go(R, GOOD, o1, SIG);
  const after = [snap(SPEWP), snap(GOOD)];
  ok(r1.status === 0 && last(r1.stdout) === 'PASS search-gate demo-site: 14 checks: 14 PASS, 0 FAIL, 0 ERROR'
    && lines(r1.stdout).filter((l) => /^PASS GT-0\d\d /.test(l)).length === 14
    && size(path.join(o1, 'report.json')) > 0 && size(path.join(o1, 'report.md')) > 0
    && !lines(r1.stdout).some((l) => l.startsWith('BLOCKED'))
    && isDeepStrictEqual(before, after), 'S1: a good site against the signed plan passes', `${r1.status} ${r1.stdout.slice(-600)}${r1.stderr}`);

  // S2
  const g2 = variant('s2', (d) => fs.rmSync(path.join(d, 'guides'), { recursive: true }));
  const r2 = go(R, g2, fresh('out'), SIG);
  const l2 = lines(r2.stdout);
  ok(r2.status === 1 && l2.includes('FAIL GT-002 1 planned page(s) missing or not indexable')
    && l2.some((l) => l.includes('c-sell-without-agent /guides/sell-my-house-without-a-realtor-california/: no page built at this path'))
    && l2.some((l) => l.startsWith('PASS GT-004'))
    && last(r2.stdout) === 'FAIL search-gate demo-site: 14 checks: 11 PASS, 3 FAIL, 0 ERROR', 'S2: a planned page not built fails', `${r2.status} ${r2.stdout.slice(-900)}${r2.stderr}`);

  // S3
  const T3 = (d) => patch(path.join(d, 'rocklin-ca', 'index.html'), '<title>Real Estate Agent in Rocklin, CA | Sample Valley Realty</title>', '<title>Rocklin, CA Neighborhood Guide | Sample Valley Realty</title>');
  const g3 = variant('s3', T3);
  const r3 = go(R, g3, fresh('out'), SIG);
  const l3 = lines(r3.stdout);
  ok(r3.status === 1 && l3.some((l) => l.startsWith('FAIL GT-004 1 problem(s) on 6 page(s)'))
    && l3.some((l) => l.includes('/rocklin-ca/: title does not contain the head term of "real estate agent rocklin ca"'))
    && l3.some((l) => l.startsWith('PASS GT-002'))
    && last(r3.stdout).endsWith('13 PASS, 1 FAIL, 0 ERROR'), 'S3: a title without the head term fails', `${r3.status} ${r3.stdout.slice(-900)}${r3.stderr}`);

  // S4
  const r4 = go(R, GOOD, fresh('out'), UNS);
  ok(r4.status === 1 && lines(r4.stdout).some((l) => l.startsWith('FAIL GT-001')) && r4.stdout.includes('L-003 targets and plan are not both approved')
    && last(r4.stdout).startsWith('FAIL search-gate demo-site: '), 'S4: an unsigned plan fails (strict)', `${r4.status} ${r4.stdout.slice(-900)}${r4.stderr}`);

  // S5
  {
    const seo = `omnikom seo run https://${HOST}/ --client <slug>, its research steps writing the file`;
    const pl = `node skills/programmatic-enterprise-web-performance/scripts/plan-site.mjs`;
    const cases = [
      ['targets.json', 'research', 'targets\\.json', esc(seo)],
      ['business.json', 'business definition', 'business\\.json', esc(seo)],
      ['plan/sitemap.json', 'page plan', 'plan/sitemap\\.json', `${esc(pl)} \\S+/site-checks/demo-old\\.example\\.test/\\.pewp`],
    ];
    const bad = [];
    for (const [rel, what, relRe, fix] of cases) {
      const data = fresh('s5');
      fs.cpSync(SIG, data, { recursive: true });
      fs.rmSync(path.join(data, 'site-checks', HOST, '.pewp', rel));
      const out = fresh('out');
      const r = go(R, GOOD, out, data);
      const re = new RegExp(`^BLOCKED: no ${what} for demo-old\\.example\\.test: \\S+/site-checks/demo-old\\.example\\.test/\\.pewp/${relRe} is not there \\| unblocks: ${fix}$`);
      const one = lines(r.stdout);
      if (!(r.status === 3 && one.length === 1 && re.test(one[0]) && !there(out))) bad.push(`${rel}: ${r.status} ${r.stdout}${r.stderr}`);
    }
    ok(bad.length === 0, 'S5: a missing targets.json, business.json or plan/sitemap.json is BLOCKED, exit 3, one line', bad.join(' | '));
    const empty = fresh('s5empty');
    fs.mkdirSync(empty);
    const oe = fresh('out');
    const re = go(R, GOOD, oe, empty);
    ok(re.status === 3 && lines(re.stdout).length === 1 && re.stdout.includes('BLOCKED: no research for demo-old.example.test') && !there(oe), 'S5: an empty data folder is BLOCKED, no gate run, no out folder', `${re.status} ${re.stdout}${re.stderr}`);
  }

  // S6
  {
    const f = path.join(M, 'nosearch.json');
    const m = readJ(FIXTURE) ?? {};
    delete m.search;
    fs.writeFileSync(f, JSON.stringify(m, null, 1) + '\n');
    const out = fresh('out');
    const r = run(R, '--manifest', f, '--built', GOOD, '--out', out, '--data', SIG);
    ok(r.status === 1 && r.stdout === '' && isDeepStrictEqual(lines(r.stderr), [`REFUSED: ${f}: search: required, missing`]) && !there(out), 'S6: a manifest without search is refused', `${r.status} ${r.stdout}${r.stderr}`);
  }

  // S7
  {
    const o7 = fresh('out7');
    const base = ['--manifest', MAN, '--built', GOOD, '--out', o7, '--data', SIG];
    const nope = path.join(TMP, 'no-such-folder');
    const tries = [
      [[], null], [[...base, '--strict'], null], [[...base, '--waive', 'X'], null], [[...base, '--only', 'GT-004'], null], [[...base, '--build', 'x'], null], [[...base, 'x'], null],
      [['--built', GOOD, '--out', o7], null], [['--manifest', MAN, '--built', GOOD, '--out'], null], [['--manifest', MAN, '--built', GOOD, '--out', '--data'], null],
      [['--manifest', MAN, '--built', nope, '--out', o7, '--data', SIG], '--built is not a folder'], [['--manifest', MAN, '--built', GOOD, '--out', o7, '--data', nope], '--data is not a folder'],
    ];
    const bad = [];
    for (const [args, why] of tries) {
      const r = run(R, ...args);
      if (!(r.status === 2 && r.stdout === '' && last(r.stderr) === USAGE && (why === null || r.stderr.includes(why)))) bad.push(`${args.join(' ')}: ${r.status} ${r.stdout}${r.stderr}`);
    }
    ok(bad.length === 0 && !there(o7), 'S7: usage faults exit 2, nothing on stdout, nothing created', bad.join(' | '));
  }

  // S8
  {
    const bad = [];
    const jct = path.join(TMP, 'jct');
    let made = true;
    try { fs.symlinkSync(GOOD, jct, 'junction'); } catch (e) { made = false; ok(false, `S8: junction not made (${e.code})`); }
    const outs = [[GOOD, 'built', true], [path.join(GOOD, 'gate'), 'built', false], [path.join(GOOD, '..', path.basename(GOOD), 'gate'), 'built', false], [path.join(GOOD, 'a', 'b', 'c'), 'built', false],
      [path.join(SPEWP, 'gate'), 'plan', false]];
    if (made) outs.push([path.join(jct, 'gate'), 'built', false]);
    const g0 = snap(GOOD);
    for (const [out, what, exists] of outs) {
      const r = go(R, GOOD, out, SIG);
      if (!(r.status === 2 && new RegExp(`--out is inside the ${what} folder`).test(r.stderr) && (exists || !there(out)))) bad.push(`${out}: ${r.status} ${r.stdout}${r.stderr}`);
    }
    if (made) fs.unlinkSync(jct);
    ok(bad.length === 0 && isDeepStrictEqual(g0, snap(GOOD)), 'S8: --out inside the built folder or the plan folder is refused, exit 2, nothing created', bad.join(' | '));
  }

  // F1 to F4, S9: a fake gate
  const F4 = "console.log('PASS gate 3 checks: 3 PASS, 0 FAIL, 0 ERROR');\n";
  const fake = (text) => { const d = repo(text); const out = fresh('out'); return { d, out, r: go(d, GOOD, out, SIG) }; };
  const SAID = 'demo-site';
  {
    const { r } = fake('process.exit(0);\n');
    ok(r.status === 1 && last(r.stdout) === `FAIL search-gate ${SAID}: the gate printed no summary line (its exit was 0)`, 'F1: a silent gate with exit 0 is a FAIL', `${r.status} ${r.stdout}${r.stderr}`);
  }
  {
    const { r } = fake("console.log('ERROR gate 14 checks: 10 PASS, 0 FAIL, 4 ERROR');\nprocess.exit(2);\n");
    ok(r.status === 1 && last(r.stdout) === `ERROR search-gate ${SAID}: 14 checks: 10 PASS, 0 FAIL, 4 ERROR`, 'F2: a gate that could not judge is an ERROR, exit 1', `${r.status} ${r.stdout}${r.stderr}`);
  }
  {
    const a = fake("console.log('PASS gate 3 checks: 3 PASS, 0 FAIL, 0 ERROR');\nprocess.exit(1);\n").r;
    const b = fake("console.log('FAIL gate 3 checks: 2 PASS, 1 FAIL, 0 ERROR');\nprocess.exit(0);\n").r;
    ok(a.status === 1 && last(a.stdout).startsWith(`FAIL search-gate ${SAID}: `), 'F3: a PASS line with exit 1 is a FAIL', `${a.status} ${a.stdout}${a.stderr}`);
    ok(b.status === 1 && last(b.stdout).startsWith(`FAIL search-gate ${SAID}: `), 'F3: a FAIL line with exit 0 is a FAIL', `${b.status} ${b.stdout}${b.stderr}`);
  }
  {
    const { r, out } = fake(F4);
    const argv = readJ(path.join(out, 'argv.json'));
    ok(r.status === 0 && last(r.stdout) === `PASS search-gate ${SAID}: 3 checks: 3 PASS, 0 FAIL, 0 ERROR` && r.stdout.startsWith('PASS gate 3 checks')
      && !!argv && isDeepStrictEqual(argv.a, [path.join(SIG, 'site-checks', HOST, '.pewp'), GOOD, '--out', out, '--strict']) && argv.e.includes('--max-old-space-size=256'), 'F4: a clean fake gate passes, its arguments are exact', `${r.status} ${r.stdout}${r.stderr} ${JSON.stringify(argv)}`);
  }
  // S9
  {
    const d = repo(F4);
    const plan = path.join(d, 'skills', 'programmatic-enterprise-web-performance', 'site-checks', HOST, '.pewp');
    fs.cpSync(SPEWP, plan, { recursive: true });
    const out = fresh('out');
    const r = run(d, '--manifest', MAN, '--built', GOOD, '--out', out);
    const argv = readJ(path.join(out, 'argv.json'));
    ok(r.status === 0 && !!argv && argv.a[0] === plan, 'S9: without --data the plan is read from the skill folder', `${r.status} ${r.stdout}${r.stderr} ${JSON.stringify(argv)}`);
  }

  // S10: a check that passed because its input was absent says so, with its count
  {
    const NT = (l) => l.startsWith('NOTHING TO CHECK');
    const g14 = 'NOTHING TO CHECK GT-014: 0 prompt rows, the project has no prompt map';
    ok(isDeepStrictEqual(lines(r1.stdout).filter(NT), [g14]), 'S10: GT-014 the good run has exactly one NOTHING TO CHECK line', r1.stdout);
    const d9 = fresh('s10a');
    fs.cpSync(UNS, d9, { recursive: true });
    const pf = path.join(d9, 'site-checks', HOST, '.pewp', 'plan', 'programmatic.json');
    const pj = readJ(pf);
    const held = !!pj && Array.isArray(pj.groups) && pj.groups.length >= 1;
    if (held) { pj.groups = []; fs.writeFileSync(pf, JSON.stringify(pj, null, 1) + '\n'); }
    const r9 = go(R, GOOD, fresh('out'), d9);
    ok(held && r9.status === 1 && isDeepStrictEqual(lines(r9.stdout).filter(NT), ['NOTHING TO CHECK GT-009: 0 template groups planned', g14]), 'S10: GT-009 an empty page group list is a true answer, shown with its count', `${held} ${r9.status} ${r9.stdout.slice(-900)}${r9.stderr}`);
    const d10 = fresh('s10b');
    fs.cpSync(SIG, d10, { recursive: true });
    const bf = path.join(d10, 'site-checks', HOST, '.pewp', 'business.json');
    const bj = readJ(bf);
    const was = !!bj && bj.industry === 'real-estate-agent';
    if (was) { bj.industry = null; fs.writeFileSync(bf, JSON.stringify(bj, null, 1) + '\n'); }
    const r10 = go(R, GOOD, fresh('out'), d10);
    ok(was && r10.status === 0 && isDeepStrictEqual(lines(r10.stdout).filter(NT), ['NOTHING TO CHECK GT-010: 0 industry rule items, business.json says industry null', g14])
      && last(r10.stdout) === 'PASS search-gate demo-site: 14 checks: 14 PASS, 0 FAIL, 0 ERROR', 'S10: GT-010 no industry is a true answer, shown with its count', `${was} ${r10.status} ${r10.stdout.slice(-900)}${r10.stderr}`);
  }

  // S11: no sitemap is BLOCKED when the gate would pass, and never hides a FAIL
  {
    const a0 = variant('s11a', (d) => { if (!there(path.join(d, 'sitemap.xml'))) throw new Error('patch never applied: no sitemap.xml in good'); fs.rmSync(path.join(d, 'sitemap.xml')); });
    const ra = go(R, a0, fresh('out'), SIG);
    const la = lines(ra.stdout);
    const b0 = variant('s11b', (d) => { T3(d); fs.rmSync(path.join(d, 'sitemap.xml')); });
    const rb = go(R, b0, fresh('out'), SIG);
    ok(ra.status === 3 && last(ra.stdout) === "BLOCKED: no sitemap in the built site: GT-013 had no dates to read | unblocks: the site's build writes sitemap.xml into the built folder"
      && la.some((l) => l.startsWith('PASS GT-013 no sitemap in the built site')) && !la.some((l) => l.startsWith('PASS search-gate'))
      && rb.status === 1 && last(rb.stdout).startsWith('FAIL search-gate demo-site: '), 'S11: no sitemap is BLOCKED, a FAIL stays a FAIL', `${ra.status} ${ra.stdout.slice(-700)}${ra.stderr} | ${rb.status} ${rb.stdout.slice(-300)}`);
  }
} catch (e) {
  failed++;
  console.log(`  FAIL crash: ${e && e.message}`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`search-gate tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

// mutants: each must turn this test red, for the broken rule's own case
if (process.argv.includes('--mutants')) {
  const MUT = [
    ['exit not read', "r.status === 0 && m && m[1] === 'PASS' ? 'PASS'", "m && m[1] === 'PASS' ? 'PASS'", 'F3'],
    ['summary not read', "r.status === 0 && m && m[1] === 'PASS' ? 'PASS'", "r.status === 0 ? 'PASS'", 'F1'],
    ['no --strict', "out, '--strict']", 'out]', 'S4'],
    ['no --out', "'--out', out, '--strict']", "'--strict']", 'S1'],
    ['no memory cap', "['--max-old-space-size=256', path.join(SKILL, 'scripts', 'gate.mjs'),", "[path.join(SKILL, 'scripts', 'gate.mjs'),", 'F4'],
    ['BLOCKED exits 0', 'unblocks: ${fix}`); process.exit(3);', 'unblocks: ${fix}`); process.exit(0);', 'S5'],
    ['targets.json not looked for', "['targets.json', 'research', seo]", "['.', 'research', seo]", 'S5'],
    ['business.json not looked for', "['business.json', 'business definition', seo]", "['.', 'business definition', seo]", 'S5'],
    ['plan/sitemap.json not looked for', "['plan/sitemap.json', 'page plan',", "['plan', 'page plan',", 'S5'],
    ['--out inside not refused', 'if (inside(out, dir))', 'if (false && inside(out, dir))', 'S8'],
    ['no real path', 'fs.realpathSync.native(q)', 'q', 'S8'],
    ['unknown flag accepted', "!['--manifest', '--built', '--out', '--data'].includes(a[i]) || ", '', 'S7'],
    ['value may start with --', " || a[i + 1].startsWith('--')", '', 'S7'],
    ['no value not noticed', ' || a[i + 1] === undefined', '', 'S7'],
    ['manifest refusal exits 0', "console.error(faults.join('\\n')); process.exit(1);", "console.error(faults.join('\\n')); process.exit(0);", 'S6'],
    ['site name replaced by host', '${status} search-gate ${manifest.site}: ${m[2]}', '${status} search-gate ${host}: ${m[2]}', 'S1'],
    ['gate lines not passed on', "process.stdout.write(r.stdout ?? '');", '', 'S1'],
    ['plan of the deploy host', "path.join(data, 'site-checks', host, '.pewp')", "path.join(data, 'site-checks', manifest.deploy.host, '.pewp')", 'S1'],
    ['default data folder', "opt['--data'] ?? SKILL", "opt['--data'] ?? path.join(SKILL, 'x')", 'S9'],
    ['FAIL exits 0', "process.exitCode = status === 'PASS' ? 0 : 1;", 'process.exitCode = 0;', 'S2'],
    ['ERROR shown as FAIL', "m && m[1] === 'ERROR' ? 'ERROR'", "m && m[1] === 'ERROR' ? 'FAIL'", 'F2'],
    ['GT-009 not said', "['GT-009', 'no programmatic pages planned',", "['GT-009', 'no programmatic pages planned zz',", 'S10'],
    ['GT-010 not said', "['GT-010', 'no industry rules selected',", "['GT-010', 'no industry rules selected zz',", 'S10'],
    ['GT-014 not said', "['GT-014', 'no prompt map in this project',", "['GT-014', 'no prompt map in this project zz',", 'S10'],
    ['no sitemap passes', "status === 'PASS' && said('GT-013'", "false && said('GT-013'", 'S11'],
    ['BLOCKED hides a FAIL', "status === 'PASS' && said('GT-013'", "said('GT-013'", 'S11'],
    ['sitemap line not read', "'no sitemap in the built site')", "'no sitemap in the built site zz')", 'S11'],
  ];
  let caught = 0;
  for (const [name, from, to, id] of MUT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-gate-mut-'));
    const src = fs.readFileSync(path.join(HERE, 'search-gate.mjs'), 'utf8');
    if (src.split(from).length !== 2) { console.log(`MUTANT TARGET NOT FOUND once: ${name}`); process.exitCode = 1; fs.rmSync(dir, { recursive: true, force: true }); continue; }
    fs.writeFileSync(path.join(dir, 'search-gate.mjs'), src.split(from).join(to));
    const res = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 300000, env: { ...process.env, SEARCH_GATE_TOOL: path.join(dir, 'search-gate.mjs') } });
    const red = res.status !== 0 && res.stdout.includes(`FAIL ${id}:`);
    if (red) caught++;
    console.log(`mutant "${name}": ${red ? 'caught' : 'MISSED'} (${(res.stdout.trim().split('\n').pop() || '').trim()})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`mutants: ${caught}/${MUT.length} caught`);
  if (caught !== MUT.length) process.exitCode = 1;
}
