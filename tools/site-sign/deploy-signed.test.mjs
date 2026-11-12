// Tests for deploy-signed.mjs: the mode and target pairs, the register's place, the checks before an upload, the sealed draft, and which
// register line is filled. The upload is the seam `run`, a fake here: no test touches the network, no real token is read.
// usage: node --max-old-space-size=256 deploy-signed.test.mjs
// Fixtures: one small site in a temp folder, signed as draft and live by sign-site.mjs and sealed by seal-site.mjs (their command lines);
// the live date is today, so the draft, live and sealed-draft lines share one ID and only the stage tells them apart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-signed-test-'));
const REG = path.join(TMP, 'register.tsv');
const NO_REGISTER = "REFUSED: the register's place is not set: give --register <file> or set SIGN_SITE_REGISTER (it is kept outside the repository)";
let tool = {};
try { tool = await import(pathToFileURL(path.join(HERE, 'deploy-signed.mjs')).href); } catch (e) { console.log(`  NOTE the tool did not load: ${String(e && e.message).split('\n')[0]}`); }

let passed = 0, failed = 0;
async function kase(n, name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${n} ${name}: ${String((e && e.message) || e).split('\n')[0].slice(0, 300)}`); }
}
const put = (d, f, c) => { const p = path.join(d, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rels = (d) => walk(d).map((f) => path.relative(d, f).split(path.sep).join('/')).sort();
const cli = (script, args) => {
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', path.join(HERE, script), ...args], { encoding: 'utf8', timeout: 90000, env: { ...process.env, SIGN_SITE_REGISTER: REG } });
  if (r.status !== 0) throw new Error(`${script} exit ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  return r;
};
const copy = (src, name, fn) => { const d = path.join(TMP, name); fs.cpSync(src, d, { recursive: true }); if (fs.existsSync(`${src}-functions`)) fs.cpSync(`${src}-functions`, `${d}-functions`, { recursive: true }); if (fn) fn(d); return d; };
// the register's lines as cells, by stage (the ID is the same on every line here)
const regLine = (stage) => read(REG).split('\n').filter(Boolean).map((l) => l.split('\t')).filter((c) => c[2] === stage);

// ---- fixtures ----
const clean = path.join(TMP, 'clean');
put(clean, 'index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home</title><link rel="stylesheet" href="/a.css"></head><body><h1>Demo</h1><script src="/app.js"></script></body></html>\n');
put(clean, 'about/index.html', '<!doctype html><html><head><title>About</title></head><body><p>About</p></body></html>\n');
put(clean, 'a.css', 'body{margin:0}\n');
put(clean, 'app.js', 'window.demo=1;\n');
put(clean, 'img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
put(clean, '_headers', "/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'\n");
const today = new Date().toISOString().slice(0, 10);
const D = path.join(TMP, 'draft'), L = path.join(TMP, 'live'), S = path.join(TMP, 'sealed');
let fixtureError = null;
try {
  cli('sign-site.mjs', ['--draft', clean, '--out', D, '--site', 'demo-site', '--host', 'demo-site.pages.dev']);
  cli('sign-site.mjs', ['--live', clean, '--out', L, '--site', 'demo-site', '--client', 'Demo Client', '--date', today, '--host', 'demo-site.com']);
  cli('seal-site.mjs', ['--in', D, '--out', S]);
} catch (e) { fixtureError = e; }
const KEY_B64 = fs.existsSync(`${S}-functions`) ? (read(`${S}-functions`, 'omk-key.js').match(/\bk: "([^"]+)"/) || [])[1] : undefined;
const TOKEN = crypto.randomBytes(24).toString('hex');
const ENV = { SIGN_SITE_REGISTER: REG, CLOUDFLARE_API_TOKEN: TOKEN };

// one deploy with the fake upload: it records each call (the project, the files of the folder handed to it, the key function's text)
function deploy(argv, env = ENV) {
  const calls = [], out = [], err = [];
  const run = (o) => {
    const fn = path.join(o.dir, 'functions', 'omk-key.js');
    calls.push({ project: o.project, files: rels(o.dir), keyFn: fs.existsSync(fn) ? fs.readFileSync(fn, 'utf8') : null });
    return 'Uploaded 9 files\nDeployment complete! Take a peek over at https://ab12cd34.demo-site-preview.pages.dev\n';
  };
  if (typeof tool.deploy !== 'function') throw new Error('deploy-signed.mjs exports no deploy()');
  const code = tool.deploy(argv, { env, run, out: (s) => out.push(String(s)), err: (s) => err.push(String(s)) });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const refused = (r, what) => {
  assert.equal(r.code, 1, `${what}: exit ${r.code}: ${r.err.slice(0, 200)}`);
  assert.ok(r.err.split('\n').some((l) => l.startsWith('REFUSED: ') && l.endsWith('; nothing deployed')), `${what}: no "REFUSED: ...; nothing deployed" line: ${r.err.slice(0, 300)}`);
  assert.equal(r.calls.length, 0, `${what}: run was called`);
};
const sealedArgs = (folder, extra = []) => [folder, '--in', D, '--clean', clean, '--mode', 'sealed', '--to', 'preview', '--project', 'demo-site-preview', ...extra];
const NO_GO = "REFUSED: a production upload needs --i-mean-production (the owner's go); nothing deployed";

await kase(0, 'the fixtures sign, sign live and seal', () => { if (fixtureError) throw fixtureError; assert.ok(KEY_B64 && Buffer.from(KEY_B64, 'base64').length === 32); });

// 1
await kase(1, 'each mode takes only its own --to and --to has no default (--target is not read): anything else is a usage error (exit 2) and nothing is uploaded', () => {
  const before = read(REG);
  const tries = [
    ['draft', 'production', D], ['draft', 'staging', D], ['draft', undefined, D], ['live', 'preview', L], ['live', undefined, L],
    ['handover', 'preview', L], ['sealed', 'production', S], ['sealed', undefined, S], ['nope', 'preview', D],
  ];
  for (const [mode, to, folder] of tries) {
    const argv = [folder, '--clean', clean, '--mode', mode, '--project', 'demo-site-preview', '--i-mean-production', ...(mode === 'sealed' ? ['--in', D] : []), ...(to ? ['--to', to] : [])];
    const r = deploy(argv);
    assert.equal(r.code, 2, `--mode ${mode} --to ${to}: exit ${r.code}`);
    assert.equal(r.calls.length, 0, `--mode ${mode} --to ${to}: run was called`);
  }
  assert.equal(deploy([D, '--clean', clean, '--mode', 'draft', '--target', 'preview', '--project', 'demo-site-preview']).code, 2, '--target was read as the target');
  assert.equal(deploy([S, '--clean', clean, '--mode', 'sealed', '--to', 'preview', '--project', 'demo-site-preview']).code, 2, 'sealed without --in is not a usage error');
  assert.equal(read(REG), before, 'the register changed');
});
// 2
await kase(2, 'with neither --register nor SIGN_SITE_REGISTER a deploy is refused before anything is uploaded or written', () => {
  const before = read(REG);
  const r = deploy(sealedArgs(S), { CLOUDFLARE_API_TOKEN: TOKEN });
  assert.equal(r.code, 1, `exit ${r.code}`);
  assert.ok(r.err.split('\n').includes(NO_REGISTER), `stderr: ${r.err.slice(0, 200)}`);
  assert.equal(r.calls.length, 0, 'run was called');
  assert.equal(read(REG), before, 'the register changed');
  assert.ok(!fs.existsSync(path.join(HERE, 'register.tsv')), 'a register was written beside the tool');
});
// 3
await kase(3, 'without CLOUDFLARE_API_TOKEN nothing is uploaded', () => {
  const r = deploy(sealedArgs(S), { SIGN_SITE_REGISTER: REG });
  assert.equal(r.code, 1, `exit ${r.code}`);
  assert.equal(r.calls.length, 0, 'run was called');
});
// 4
await kase(4, 'a signed folder that fails its stage check is refused, nothing deployed', () => {
  const t = copy(D, 't4', (d) => fs.writeFileSync(path.join(d, 'about', 'index.html'), read(d, 'about', 'index.html').replace(/<div class="omk-draft"[^]*?<\/div>/, '')));
  refused(deploy([t, '--clean', clean, '--mode', 'draft', '--to', 'preview', '--project', 'demo-site-preview']), 'a draft without its bar');
  const r = deploy([D, '--clean', clean, '--mode', 'live', '--to', 'production', '--i-mean-production', '--project', 'demo-site']);
  refused(r, 'a draft deployed as live');
  assert.ok(r.err.includes('fails the live check'), `the refusal is not the live check's: ${r.err.slice(0, 300)}`);
});
// 5
await kase(5, 'sealed: a folder that fails seal-site\'s check against the signed draft is refused', () => {
  const t = copy(S, 't5', (d) => fs.appendFileSync(path.join(d, 'omk-seal.js'), '\n//x\n'));
  refused(deploy(sealedArgs(t)), 'a changed loader');
  refused(deploy(sealedArgs(L)), 'a live build given as the sealed folder');
});
// 6
await kase(6, 'sealed: a signed draft that fails its draft check against the clean build is refused', () => {
  const other = copy(clean, 'clean-other', (d) => fs.appendFileSync(path.join(d, 'a.css'), 'p{margin:0}\n'));
  const r = deploy([S, '--in', D, '--clean', other, '--mode', 'sealed', '--to', 'preview', '--project', 'demo-site-preview']);
  refused(r, 'another clean build');
  assert.ok(r.err.includes('draft check'), `the refusal does not name the draft check: ${r.err.slice(0, 300)}`);
});
// 7
await kase(7, 'sealed: <sealed>-functions must hold exactly omk-key.js', () => {
  refused(deploy(sealedArgs(copy(S, 't7a', (d) => put(`${d}-functions`, 'extra.js', 'export const onRequest = () => new Response("x");\n')))), 'a second function file');
  refused(deploy(sealedArgs(copy(S, 't7b', (d) => fs.rmSync(`${d}-functions`, { recursive: true, force: true })))), 'no functions folder');
});
// 8
await kase(8, 'the draft line is the one filled when a draft and a sealed-draft line share an ID; --register <file> is a register\'s place', () => {
  assert.equal(regLine('draft')[0][3], regLine('sealed-draft')[0][3], 'the fixture lines do not share an ID');
  const r = deploy([D, '--clean', clean, '--mode', 'draft', '--to', 'preview', '--project', 'demo-site-draft', '--register', REG], { CLOUDFLARE_API_TOKEN: TOKEN });
  assert.equal(r.code, 0, `exit ${r.code}: ${r.err.slice(0, 300)}`);
  assert.equal(r.calls.length, 1);
  assert.deepStrictEqual(regLine('draft').map((c) => [c[7], c[8]]), [['demo-site-draft', 'ab12cd34']]);
  assert.deepStrictEqual(regLine('sealed-draft').map((c) => [c[7], c[8]]), [['-', '-']], 'the sealed-draft line was filled by a draft deploy');
  assert.deepStrictEqual(regLine('live').map((c) => [c[7], c[8]]), [['-', '-']], 'the live line was filled by a draft deploy');
});
// 9
await kase(9, 'sealed: a passing run calls run once with the project, uploads the sealed pages and exactly functions/omk-key.js, fills the sealed-draft line, and prints neither the token nor the key', () => {
  const r = deploy(sealedArgs(S));
  assert.equal(r.code, 0, `exit ${r.code}: ${r.err.slice(0, 300)}`);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].project, 'demo-site-preview');
  const files = r.calls[0].files;
  assert.deepStrictEqual(files.filter((f) => f.startsWith('functions/')), ['functions/omk-key.js']);
  assert.deepStrictEqual(files.filter((f) => f.startsWith('public/')), rels(S).map((f) => `public/${f}`));
  assert.equal(r.calls[0].keyFn, read(`${S}-functions`, 'omk-key.js'));
  assert.deepStrictEqual(regLine('sealed-draft').map((c) => [c[7], c[8]]), [['demo-site-preview', 'ab12cd34']]);
  assert.deepStrictEqual(regLine('draft').map((c) => [c[7], c[8]]), [['demo-site-draft', 'ab12cd34']], 'the draft line changed');
  const printed = r.out + '\n' + r.err;
  for (const s of [TOKEN, KEY_B64, Buffer.from(KEY_B64, 'base64').toString('hex')]) assert.ok(!printed.includes(s), 'the token or the key was printed');
  assert.ok(/^deployed demo-site-preview: https:\/\/ab12cd34\.demo-site-preview\.pages\.dev /.test(r.out), `printed: ${r.out.slice(0, 200)}`);
});
// 11 (round 2)
await kase(11, '--to production without --i-mean-production is refused first, before the register, the token, any check or the upload', () => {
  const before = read(REG);
  for (const [folder, mode, env] of [[L, 'live', ENV], [L, 'handover', ENV], [D, 'live', {}]]) {
    const r = deploy([folder, '--clean', clean, '--mode', mode, '--to', 'production', '--project', 'demo-site'], env);
    assert.equal(r.code, 1, `--mode ${mode}: exit ${r.code}: ${r.err.slice(0, 200)}`);
    assert.deepStrictEqual(r.err.split('\n'), [NO_GO], `--mode ${mode}: stderr is ${r.err.slice(0, 300)}`);
    assert.equal(r.calls.length, 0, `--mode ${mode}: run was called`);
  }
  assert.equal(read(REG), before, 'the register changed');
});
// 10
await kase(10, 'live: the live line is filled; a stage whose line is already filled is refused before the upload', () => {
  const r = deploy([L, '--clean', clean, '--mode', 'live', '--to', 'production', '--i-mean-production', '--project', 'demo-site']);
  assert.equal(r.code, 0, `exit ${r.code}: ${r.err.slice(0, 300)}`);
  assert.equal(r.calls.length, 1);
  assert.deepStrictEqual(regLine('live').map((c) => [c[7], c[8]]), [['demo-site', 'ab12cd34']]);
  refused(deploy(sealedArgs(S)), 'the sealed-draft line is already filled');
});
// 12 (round 2)
await kase(12, 'live: a passing --mode live --to production --i-mean-production run calls run once with the project and fills the newest live line', () => {
  const L2 = path.join(TMP, 'live2');
  cli('sign-site.mjs', ['--live', clean, '--out', L2, '--site', 'demo-site', '--client', 'Demo Client', '--date', today, '--host', 'demo-site.com']);
  const r = deploy([L2, '--clean', clean, '--mode', 'live', '--to', 'production', '--i-mean-production', '--project', 'demo-site-live']);
  assert.equal(r.code, 0, `exit ${r.code}: ${r.err.slice(0, 300)}`);
  assert.equal(r.calls.length, 1, `run was called ${r.calls.length} times`);
  assert.equal(r.calls[0].project, 'demo-site-live');
  assert.deepStrictEqual(regLine('live').map((c) => [c[7], c[8]]), [['demo-site', 'ab12cd34'], ['demo-site-live', 'ab12cd34']]);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`deploy-signed tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
