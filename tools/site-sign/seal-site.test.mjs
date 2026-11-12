// Tests for seal-site.mjs: 42 named cases, each counted once. Round 1 wrote 26 of them before the tool was rewritten; round 2
// changed four (6, 10, 22, 23) and added 13 (27 to 39), written before the code, seen red, then green. The browser trial (B1,
// kept outside this repository) added case 40 for the three loader rules a real browser showed were missing, seen red, then green.
// A review then found two faults of the loader's decision: on our own host a 404, 401, 403 or a wrong answer showed the copy
// warning, and a page of another site could show the preview in a frame. Case 22 now holds the new table (our own fault waits,
// a framed page warns) and case 42 holds the framed lines of the loader text, both written before the code and seen red.
// usage: node --max-old-space-size=256 seal-site.test.mjs
//        SEAL_SITE_TOOL=<path> node ... seal-site.test.mjs   (tests another copy of the tool; used by the seeded faults)
//        node --max-old-space-size=256 seal-site.test.mjs --mutants  (copies the tool, breaks it 12 ways, each must turn its named case red)
// The tool is read as a whole (seal = the module namespace), so a missing export fails one case and the file still runs to its last line.
// Fixtures are small sites in a temp folder, signed by sign-site.mjs --draft (its command line), the register points into the temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = JSON.parse(fs.readFileSync(path.join(HERE, 'wording.json'), 'utf8'));
const TOOL = process.env.SEAL_SITE_TOOL || path.join(HERE, 'seal-site.mjs');
const SIGN = path.join(HERE, 'sign-site.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-site-test-'));
const REG = path.join(TMP, 'register.tsv');
let seal = {};
try { seal = await import(pathToFileURL(TOOL).href); } catch (e) { console.log(`  NOTE the tool did not load: ${String(e && e.message).split('\n')[0]}`); }

let passed = 0, failed = 0;
async function kase(n, name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${n} ${name}: ${String((e && e.message) || e).split('\n')[0].slice(0, 300)}`); }
}
const memo = (fn) => { let done = false, val, err; return () => { if (!done) { done = true; try { val = fn(); } catch (e) { err = e; } } if (err) throw err; return val; }; };
const put = (d, f, c) => { const p = path.join(d, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rels = (d) => walk(d).map((f) => path.relative(d, f).split(path.sep).join('/')).sort();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const treeHashOf = (d) => sha(rels(d).map((r) => `${r}\t${sha(fs.readFileSync(path.join(d, r)))}`).sort().join('\n') + '\n');
const regLines = () => (fs.existsSync(REG) ? read(REG).split('\n').filter(Boolean) : []);
const run = (tool, args) => spawnSync(process.execPath, ['--max-old-space-size=256', tool, ...args], { encoding: 'utf8', timeout: 90000, env: { ...process.env, SIGN_SITE_REGISTER: REG } });

// ---- fixtures ----
const MARK = { body: 'OMKMARK_BODY_5d1c', style: 'OMKMARK_STYLE_a7e2', inline: 'OMKMARK_INLINE_93bf', css: 'OMKMARK_CSS_41c8', js: 'OMKMARK_JS_e60d' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
const CSP = "/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; img-src 'self' data:\n";
const mainFiles = () => ({
  'index.html': `<!doctype html>\n<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home &amp; Co</title><link rel="stylesheet" href="./assets/css/site.css"><link rel="stylesheet" href="https://cdn.example.com/remote.css"><link rel="preload" href="/assets/js/site.js" as="script"><style>p::after{content:"${MARK.style}"}</style><script type="application/ld+json">{"@context":"https://schema.org","name":"Demo"}</script></head><body class="home"><h1>Hi</h1><p>${MARK.body}</p><img src="/img.png" alt=""><script src="/assets/js/site.js" defer></script><script src="https://cdn.example.com/remote.js" async></script><script>window.__i="${MARK.inline}";</script></body></html>\n`,
  'about/index.html': '<!DOCTYPE html>\n<html><head><title>About</title><link rel="stylesheet" href="../assets/css/site.css"></head><body><p>About</p><script src="../assets/js/site.js" defer data-page="about" id="abt"></script></body></html>\n',
  '404.html': '<!doctype html><meta charset="utf-8"><title>Page not found</title><p>Gone</p>\n',
  'assets/css/site.css': `.x{content:"${MARK.css}"}\n`,
  'assets/js/site.js': `window.__j="${MARK.js}";\n`,
  'img.png': PNG, 'data.json': '{"a":1}\n', 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  'robots.txt': 'User-agent: *\nAllow: /\n', 'llms.txt': '# Site\nreal llms\n',
  '.well-known/security.txt': 'Contact: mailto:x@example.com\n',
  '_headers': CSP,
});
const tinyFiles = (extra = {}) => ({ 'index.html': '<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>\n', '_headers': CSP, ...extra });
let seq = 0;
function makeClean(files) {
  const d = path.join(TMP, `clean${seq++}`);
  for (const [f, c] of Object.entries(files)) if (c !== null) put(d, f, c);
  return d;
}
function signDraft(clean, host = 'demo.example.com') {
  const out = path.join(TMP, `signed${seq++}`);
  const r = run(SIGN, ['--draft', clean, '--out', out, '--site', 'demo', '--host', host]);
  if (r.status !== 0) throw new Error(`sign-site --draft exit ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  return { clean, signed: out, id: r.stdout.match(/omk-demo-\d{8}-[0-9a-f]{12}/)[0], host };
}
const sealFrom = (signed, name) => { const out = path.join(TMP, name); return { out, r: run(TOOL, ['--in', signed, '--out', out]) }; };
function built(files, name, host) {
  const s = signDraft(makeClean(files), host);
  const b = sealFrom(s.signed, name);
  if (b.r.status !== 0) throw new Error(`seal exit ${b.r.status}: ${(b.r.stderr || b.r.stdout).trim().slice(0, 200)}`);
  return { ...s, ...b };
}
const main = memo(() => {
  const s = signDraft(makeClean(mainFiles()));
  const before = regLines();
  const b = sealFrom(s.signed, 'sealed-main');
  const after = regLines();
  if (b.r.status !== 0) throw new Error(`seal exit ${b.r.status}: ${(b.r.stderr || b.r.stdout).trim().slice(0, 200)}`);
  return { ...s, ...b, before, after };
});
const pagesDev = memo(() => built(tinyFiles(), 'sealed-pagesdev', 'demo-site.pages.dev'));
const PAGES = ['404.html', 'about/index.html', 'index.html'];
const fnText = (out) => read(`${out}-functions`, 'omk-key.js');
const keyB64Of = (out) => fnText(out).match(/\bk: "([^"]+)"/)[1];
const keyOf = (out) => Buffer.from(keyB64Of(out), 'base64');
const blockOf = (text) => { const m = text.match(/<script id="omk-sealed" type="application\/octet-stream">([A-Za-z0-9+/=]*)<\/script>/); if (!m) throw new Error('no block in the page'); return m[1]; };
// a block is version 2: AES-256-GCM over a gzip of the JSON text (iv 12 | tag 16 | ciphertext, base64)
function decryptRaw(key, b64) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
// openText reads any block that holds JSON (gzip or plain), so the cases that only look at what is inside do not depend on the block's wrapping; case 6 is the one that holds the wrapping to account
const openText = (key, b64) => { const raw = decryptRaw(key, b64); return (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('utf8'); };
const openBlock = (key, b64) => JSON.parse(openText(key, b64));
function lockText(key, text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
const lockBlock = (key, obj) => lockText(key, JSON.stringify(obj));
function tamper(m, name, fn) {
  const d = path.join(TMP, name);
  fs.cpSync(m.out, d, { recursive: true });
  fs.cpSync(`${m.out}-functions`, `${d}-functions`, { recursive: true });
  fn(d);
  return d;
}
const check = (sealed, signed) => run(TOOL, ['--check', sealed, '--in', signed]);
const failsWith = (r, word) => r.status === 1 && r.stdout.includes('SEAL CHECK FAIL: ') && r.stdout.includes(word);
const noOut = (out) => !fs.existsSync(out) && !fs.existsSync(`${out}-functions`);
// a refusal: exit 1, its line, no output folder, no register line; after(signedDir) may change the signed draft before sealing
function refusal(files, line, name, after) {
  const s = signDraft(makeClean(files));
  if (after) after(s.signed);
  const lines = regLines().length;
  const b = sealFrom(s.signed, name);
  assert.equal(b.r.status, 1, `exit ${b.r.status}: ${(b.r.stderr || b.r.stdout).trim().slice(0, 150)}`);
  assert.ok(b.r.stderr.split('\n').includes(line), `stderr lacks "${line}": ${b.r.stderr.trim().slice(0, 200)}`);
  assert.ok(noOut(b.out), 'an output folder was left behind');
  assert.equal(regLines().length, lines, 'a register line was added');
}
const swapBlock = (dir, fn) => { const p = path.join(dir, 'index.html'), t = fs.readFileSync(p, 'utf8'), old = blockOf(t); fs.writeFileSync(p, t.replace(old, () => fn(old))); };
const loaderOf = (out) => { const sb = { __OMK_TEST__: {} }; vm.runInNewContext(read(out, 'omk-seal.js'), sb); return sb.__OMK_TEST__; };

// the page of cases 1 and 2: every thing the tool cuts and every thing it leaves
const pageSite = memo(() => {
  const d = path.join(TMP, 'pagesite');
  put(d, 'assets/css/a.css', 'a{color:red}\n'); put(d, 'assets/js/app.js', 'var app=1;\n'); put(d, 'assets/js/late.js', 'var late=1;\n');
  const page = '<!doctype html><!-- notice <script src="/commented.js"></script><style>x{}</style> -->\r\n'
    + '<html lang="en"><head><meta charset="utf-8"><title>T</title>'
    + '<style media="print">p{color:red}</style>'
    + '<link rel="stylesheet" href="/assets/css/a.css?v=3#x">'
    + '<link rel="stylesheet" href="https://cdn.example.com/x.css">'
    + '<link rel="preload" href="/assets/js/app.js" as="script">'
    + '<link rel="stylesheet" href="/omk-draft.css"><script src="/omk-lock.js" defer></script>'
    + '<script type="application/ld+json">{"a":"<link rel=\\"stylesheet\\" href=\\"/nope.css\\">"}</script>'
    + '</head><body class="x">\n<!-- <script>boom()</script> -->'
    + '<script>var inline = 1;</script>'
    + '<SCRIPT SRC=\'/assets/js/late.js\' DEFER id="late" data-x="a>b"></SCRIPT>'
    + '<script src="https://cdn.example.com/y.js" async></script>'
    + '<script nomodule src="/assets/js/app.js"></script>'
    + '</body></html>\r\n';
  return { d, page };
});

// 1
await kase(1, 'joinPage(splitPage(t)) is t', () => {
  const { d, page } = pageSite();
  const back = seal.joinPage(seal.splitPage(page, 'index.html', d));
  assert.equal(back, page);
  for (const t of ['', 'plain text', '<!doctype html><title>x</title><p>no head', '<p>unterminated <!-- comment <script>x()</script>']) assert.equal(seal.joinPage(seal.splitPage(t, 'x.html', d)), t);
});
// 2
await kase(2, 'the cuts are as section 2 says', () => {
  const { d, page } = pageSite();
  const { doc, cuts } = seal.splitPage(page, 'index.html', d);
  assert.deepStrictEqual(cuts.map((c) => [c.kind, c.mode, c.base, c.media, c.remote, c.code, c.attrs]), [
    ['css', '', '', 'print', null, 'p{color:red}', {}],
    ['css', '', '/assets/css/a.css', '', null, 'a{color:red}\n', {}],
    ['skip', '', '', '', null, null, {}],
    ['skip', '', '', '', null, null, {}],
    ['skip', '', '', '', null, null, {}],
    ['js', 'classic', '', '', null, 'var inline = 1;', {}],
    ['js', 'defer', '', '', null, 'var late=1;\n', { id: 'late', 'data-x': 'a>b' }],
    ['js', 'defer', '', '', 'https://cdn.example.com/y.js', null, {}],
    ['skip', '', '', '', null, null, {}],
  ]);
  assert.equal(cuts[2].raw, '<link rel="preload" href="/assets/js/app.js" as="script">');
  assert.equal(cuts[3].raw, '<link rel="stylesheet" href="/omk-draft.css">');
  assert.equal(cuts[4].raw, '<script src="/omk-lock.js" defer></script>');
  for (const keep of ['<link rel="stylesheet" href="https://cdn.example.com/x.css">', '<script type="application/ld+json">', '<!-- notice <script src="/commented.js"></script><style>x{}</style> -->', '<!-- <script>boom()</script> -->']) assert.ok(doc.includes(keep), `doc lost ${keep}`);
  for (const gone of ['<style media', 'omk-lock', 'var inline', 'late.js', 'a.css', 'app.js']) assert.ok(!doc.includes(gone), `doc still holds ${gone}`);
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i].at >= cuts[i - 1].at && cuts[i].at <= doc.length);
});
// 3
await kase(3, 'no shipped file holds the site code or text', () => {
  const m = main();
  const shipped = rels(m.out).map((r) => [r, fs.readFileSync(path.join(m.out, r))]);
  for (const [what, mark] of Object.entries(MARK)) for (const [r, b] of shipped) assert.ok(!b.includes(mark), `${r} holds the ${what} marker`);
  const key = keyOf(m.out);
  const idx = openBlock(key, blockOf(read(m.out, 'index.html')));
  assert.ok(idx.doc.includes(MARK.body), 'the body text must be inside the block');
  for (const what of ['style', 'inline', 'css', 'js']) assert.ok(!idx.doc.includes(MARK[what]), `the block's doc still holds the ${what} code (it must be in a cut)`);
  assert.ok(idx.cuts.some((c) => c.kind === 'js' && c.code === `window.__i="${MARK.inline}";`), 'the inline script is a cut');
});
// 4
await kase(4, 'code files are not in the output; the rest is byte for byte', () => {
  const m = main();
  const signedFiles = rels(m.signed), outFiles = rels(m.out);
  for (const gone of ['assets/css/site.css', 'assets/js/site.js', 'omk-lock.js']) assert.ok(signedFiles.includes(gone) && !outFiles.includes(gone), `${gone} must be in the signed draft and not in the output`);
  const expect = signedFiles.filter((r) => !['assets/css/site.css', 'assets/js/site.js', 'omk-lock.js'].includes(r)).concat(['omk-seal.js', 'omk-noscript.html']).sort();
  assert.deepStrictEqual(outFiles, expect);
  for (const r of signedFiles) if (outFiles.includes(r) && !PAGES.includes(r) && !['_headers', 'omk-seal.js', 'omk-noscript.html'].includes(r)) assert.ok(fs.readFileSync(path.join(m.signed, r)).equals(fs.readFileSync(path.join(m.out, r))), `${r} differs`);
  assert.ok(fs.readFileSync(path.join(m.out, 'img.png')).equals(PNG));
});
// 5
await kase(5, 'a shell is exactly the template', () => {
  const m = main();
  for (const r of PAGES) {
    const page = read(m.signed, r);
    const notice = page.match(/^<!doctype html>(<!-- [^]*? -->)/i)[1];
    const lang = (page.match(/<html[^>]*\blang="([^"]*)"/i) || [null, 'en'])[1];
    const title = page.match(/<title>([^]*?)<\/title>/i)[1];
    const metas = page.match(/<meta name="author" content="Omnikom"><meta name="copyright" content="[^"]*"><meta name="omnikom-signature" content="[^"]*">/)[0];
    const block = blockOf(read(m.out, r));
    const byHand = `<!doctype html>${notice}\n<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${metas}<meta name="robots" content="noindex, nofollow, noarchive, noai, noimageai"><noscript><meta http-equiv="refresh" content="0;url=/omk-noscript.html"></noscript><link rel="stylesheet" href="/omk-draft.css"><script id="omk-sealed" type="application/octet-stream">${block}</script><script src="/omk-seal.js" defer></script></head><body data-omk-sig="${m.id}"></body></html>`;
    assert.equal(read(m.out, r), byHand, `${r}: the shell is not the template`);
  }
  assert.ok(read(m.out, 'index.html').includes('<html lang="en-GB">') && read(m.out, 'about/index.html').includes('<html lang="en">'));
});
// 6
await kase(6, 'the block, decrypted with the function file key and gunzipped, is JSON.stringify({ v: 2, doc, cuts }) of the signed page', () => {
  const m = main();
  const key = keyOf(m.out);
  assert.equal(key.length, 32);
  for (const r of PAGES) {
    const raw = decryptRaw(key, blockOf(read(m.out, r)));
    assert.ok(raw[0] === 0x1f && raw[1] === 0x8b, `${r}: the decrypted block is not gzip`);
    const text = zlib.gunzipSync(raw).toString('utf8'), obj = JSON.parse(text);
    assert.equal(obj.v, 2);
    assert.deepStrictEqual(Object.keys(obj), ['v', 'doc', 'cuts']);
    assert.equal(text, JSON.stringify({ v: 2, doc: obj.doc, cuts: obj.cuts }), `${r}: the text is not JSON.stringify({ v: 2, doc, cuts })`);
    assert.equal(seal.joinPage(obj), read(m.signed, r), `${r}: joinPage is not the signed page`);
  }
});
// 7
await kase(7, '--check passes on a fresh sealed fixture', () => {
  const m = main();
  const r = check(m.out, m.signed);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), `SEAL CHECK PASS: 3 pages, signature ${m.id}`);
});
// 8 to 15
await kase(8, 'check fails: one byte changed in a block', () => {
  const m = main();
  const d = tamper(m, 't8', (x) => { const p = path.join(x, 'index.html'), t = fs.readFileSync(p, 'utf8'), b = blockOf(t), i = Math.floor(b.length / 2); fs.writeFileSync(p, t.replace(b, () => b.slice(0, i) + (b[i] === 'A' ? 'B' : 'A') + b.slice(i + 1))); });
  assert.ok(failsWith(check(d, m.signed), 'does not decrypt'));
});
await kase(9, 'check fails: a shell given an extra tag', () => {
  const m = main();
  const d = tamper(m, 't9', (x) => { const p = path.join(x, 'about', 'index.html'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('</body>', '<div>extra</div></body>')); });
  assert.ok(failsWith(check(d, m.signed), 'shell'));
});
await kase(10, 'check fails: a plain copy of the JS file put back; a block re-made from a changed file', () => {
  const m = main();
  const a = tamper(m, 't10a', (x) => put(x, 'assets/js/site.js', fs.readFileSync(path.join(m.signed, 'assets/js/site.js'))));
  assert.ok(failsWith(check(a, m.signed), 'code file'), 'the plain copy was not refused');
  const b = tamper(m, 't10b', (x) => {
    const p = path.join(x, 'index.html'), t = fs.readFileSync(p, 'utf8'), old = blockOf(t), obj = openBlock(keyOf(m.out), old);
    const j = obj.cuts.find((c) => c.kind === 'js' && c.code && c.code.includes(MARK.js));
    j.code += '\nwindow.__changed=1;\n';
    fs.writeFileSync(p, t.replace(old, () => lockBlock(keyOf(m.out), obj)));
  });
  assert.ok(failsWith(check(b, m.signed), "the block is not this signed page's block"), 'a block made from a changed file was not caught');
});
await kase(11, 'check fails: omk-seal.js changed', () => {
  const m = main();
  const d = tamper(m, 't11', (x) => fs.appendFileSync(path.join(x, 'omk-seal.js'), '\n//x\n'));
  assert.ok(failsWith(check(d, m.signed), 'omk-seal.js'));
});
await kase(12, 'check fails: the function file id changed', () => {
  const m = main();
  const d = tamper(m, 't12', (x) => { const p = path.join(`${x}-functions`, 'omk-key.js'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split(m.id).join('omk-other-20260101-000000000000')); });
  assert.ok(failsWith(check(d, m.signed), 'omk-key.js'));
});
await kase(13, 'check fails: an image changed', () => {
  const m = main();
  const d = tamper(m, 't13', (x) => fs.writeFileSync(path.join(x, 'img.png'), Buffer.from([1, 2, 3])));
  assert.ok(failsWith(check(d, m.signed), 'img.png'));
});
await kase(14, 'check fails: a file added', () => {
  const m = main();
  const d = tamper(m, 't14', (x) => put(x, 'extra.txt', 'hello'));
  assert.ok(failsWith(check(d, m.signed), 'extra.txt'));
});
await kase(15, 'check fails: _headers given unsafe-eval', () => {
  const m = main();
  const d = tamper(m, 't15', (x) => { const p = path.join(x, '_headers'); const t = fs.readFileSync(p, 'utf8'); assert.ok(t.includes("script-src 'self' blob:")); fs.writeFileSync(p, t.replace("script-src 'self' blob:", () => "script-src 'self' blob: 'unsafe-eval'")); });
  assert.ok(failsWith(check(d, m.signed), '_headers'));
});
// 16
await kase(16, '_headers: blob: added once, kept, or left alone', () => {
  const m = main();
  const sh = read(m.signed, '_headers');
  assert.ok(sh.includes("script-src 'self';"));
  assert.equal(read(m.out, '_headers'), sh.replace("script-src 'self';", () => "script-src 'self' blob:;"));
  const have = built(tinyFiles({ '_headers': "/*\n  Content-Security-Policy: script-src 'self' blob:\n" }), 'sealed-has');
  assert.equal(read(have.out, '_headers'), read(have.signed, '_headers'), 'a line that has blob: must stay as it is');
  const none = built(tinyFiles({ '_headers': "/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src-elem 'self'\n" }), 'sealed-none');
  assert.equal(read(none.out, '_headers'), read(none.signed, '_headers'), 'a file with no script-src must stay as it is');
});
// 17 to 21
await kase(17, 'refuses an input that is not a signed draft', () => {
  const m = main();
  const line = 'REFUSED: --in is not a signed draft';
  const tries = [['unsigned', m.clean], ['no function folder', (() => { const d = path.join(TMP, 'nofn'); fs.cpSync(m.signed, d, { recursive: true }); return d; })()], ['already sealed', m.out]];
  for (const [what, dir] of tries) {
    const out = path.join(TMP, `x17-${what.replace(/ /g, '')}`);
    const r = run(TOOL, ['--in', dir, '--out', out]);
    assert.equal(r.status, 1, `${what}: exit ${r.status}`);
    assert.ok(r.stderr.split('\n').includes(line), `${what}: stderr is ${r.stderr.trim().slice(0, 150)}`);
    assert.ok(noOut(out), `${what}: an output folder was left behind`);
  }
});
await kase(18, 'refuses a module script', () => refusal(tinyFiles({ 'index.html': '<!doctype html><html><head><title>T</title></head><body><script type="module" src="/app.js"></script></body></html>\n', 'app.js': 'export {};\n' }), 'REFUSED: a module script cannot be sealed: index.html', 'x18'));
await kase(19, 'refuses a missing local file', () => refusal(tinyFiles({ 'index.html': '<!doctype html><html><head><title>T</title></head><body><script src="/assets/js/missing.js"></script></body></html>\n' }), 'REFUSED: index.html loads a file that is not in the build: /assets/js/missing.js', 'x19'));
await kase(20, 'refuses @import in a CSS file and in a style element', () => {
  refusal(tinyFiles({ 'index.html': '<!doctype html><html><head><title>T</title><link rel="stylesheet" href="/site.css"></head><body></body></html>\n', 'site.css': '@import url("other.css");\nbody{margin:0}\n' }), 'REFUSED: @import cannot be sealed: site.css', 'x20a');
  refusal(tinyFiles({ 'index.html': '<!doctype html><html><head><title>T</title><style>@import url(x.css);</style></head><body></body></html>\n' }), 'REFUSED: @import cannot be sealed: index.html', 'x20b');
});
await kase(21, 'refuses a code file no page loads', () => refusal(tinyFiles({ 'extra.js': 'var x=1;\n' }), 'REFUSED: a code file no page loads cannot be sealed: extra.js', 'x21'));
// 22
await kase(22, 'decideSealed: the whole table', () => {
  const T = loaderOf(main().out), H = 'demo.example.com';
  assert.ok(typeof T.decideSealed === 'function' && T.HOSTS[0] === H && T.ID === main().id);
  const good = JSON.stringify({ id: T.ID, k: 'AAAA' });
  const dec = (o) => T.decideSealed({ hosts: T.HOSTS, id: T.ID, ...o });
  const eq = (o, want, what) => assert.equal(dec(o), want, what);
  // on our own host the warning is never ours to show: whatever the answer, no good key yet is a wait (our deployment's fault)
  eq({ hostname: H, status: 200, body: good }, 'reveal', 'listed host, good body');
  eq({ hostname: H, framed: false, status: 200, body: good }, 'reveal', 'listed host, not framed, good body');
  eq({ hostname: H, status: 404, body: '' }, 'wait', '404');
  eq({ hostname: H, status: 403, body: '' }, 'wait', '403');
  eq({ hostname: H, status: 401, body: '' }, 'wait', '401');
  eq({ hostname: H, framed: false, status: 404, body: '' }, 'wait', '404, not framed');
  eq({ hostname: H, status: 200, body: '<!doctype html><title>x</title>' }, 'wait', '200 that is HTML');
  eq({ hostname: H, status: 200, body: JSON.stringify({ id: 'omk-other', k: 'AAAA' }) }, 'wait', 'another id');
  eq({ hostname: H, status: 200, body: JSON.stringify({ id: T.ID }) }, 'wait', 'no k');
  eq({ hostname: H, status: 200, body: JSON.stringify({ id: T.ID, k: '' }) }, 'wait', 'empty k');
  eq({ hostname: H, error: true }, 'wait', 'network error');
  eq({ hostname: H, status: 500, body: '' }, 'wait', '500');
  eq({ hostname: H, status: 503, body: '' }, 'wait', '503');
  eq({ hostname: H, status: 429, body: '' }, 'wait', '429');
  // a page of another site that shows our preview in a frame: the host test passes inside the frame, the warning must still show
  eq({ hostname: H, framed: true, status: 200, body: good }, 'warn', 'framed by another site, good body');
  eq({ hostname: H, framed: true, status: 404, body: '' }, 'warn', 'framed by another site, 404');
  eq({ hostname: H, framed: true, error: true }, 'warn', 'framed by another site, network error');
  eq({ hostname: 'www.other-site.org', status: 200, body: good }, 'warn', 'foreign host');
  eq({ hostname: 'www.other-site.org', status: 404, body: '' }, 'warn', 'foreign host, 404');
  eq({ hostname: 'www.other-site.org', error: true }, 'warn', 'foreign host, network error');
  eq({ hostname: '', status: 200, body: good }, 'warn', 'empty hostname');
  eq({ hostname: `${H}.example.com`, status: 200, body: good }, 'warn', 'look-alike host');
  eq({ hostname: 'evil' + H, status: 200, body: good }, 'warn', 'a host that only ends like ours');
  const P = loaderOf(pagesDev().out), pd = (o) => P.decideSealed({ hosts: P.HOSTS, id: P.ID, ...o }), pgood = JSON.stringify({ id: P.ID, k: 'AAAA' });
  assert.equal(JSON.stringify(P.HOSTS), JSON.stringify(['demo-site.pages.dev', '*.demo-site.pages.dev']));
  assert.equal(pd({ hostname: 'ab12cd34.demo-site.pages.dev', status: 200, body: pgood }), 'reveal', 'an alias under *.');
  assert.equal(pd({ hostname: 'demo-site.pages.dev.example.com', status: 200, body: pgood }), 'warn', 'look-alike of the pages.dev host');
  assert.equal(pd({ hostname: 'evildemo-site.pages.dev', status: 200, body: pgood }), 'warn', 'ends like the pages.dev host without a dot');
});
// 23
await kase(23, 'the loader holds no eval, no new Function, no document.write, no innerHTML; it holds the three calls, DecompressionStream and able(), called after the host test and before attempt(0)', () => {
  const t = read(main().out, 'omk-seal.js');
  assert.ok(t.length > 500);
  assert.ok(!/\beval\b/.test(t) && !t.includes('new Function') && !t.includes('document.write') && !t.includes('innerHTML'));
  for (const need of ['adoptedStyleSheets', 'createObjectURL', 'revokeObjectURL', 'DecompressionStream', 'function able']) assert.ok(t.includes(need), `the loader lacks ${need}`);
  assert.equal(W.old_title, 'This preview needs a current browser');
  assert.equal(W.old_body, 'Open this address in an up-to-date Chrome, Edge, Safari or Firefox.');
  for (const w of ['This preview needs a current browser', 'Open this address in an up-to-date Chrome, Edge, Safari or Firefox.']) assert.ok(t.includes(w), `the loader lacks the old-browser text "${w}"`);
  const host = t.indexOf('if (!hostOk(host, HOSTS) || framed)'), able = t.indexOf('if (!able())'), first = t.indexOf('attempt(0)');
  assert.ok(host >= 0 && able >= 0 && first >= 0, `positions: host test ${host}, able() call ${able}, attempt(0) ${first}`);
  assert.ok(host < able && able < first, `the order must be host test (${host}), able() (${able}), attempt(0) (${first})`);
});
// 24
await kase(24, 'the function file answers { id, k } with no-store; keys differ between builds', async () => {
  const m = main();
  const f = path.join(TMP, 'fn24.mjs');
  fs.writeFileSync(f, fnText(m.out));
  const mod = await import(pathToFileURL(f).href);
  const res = await mod.onRequest();
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const j = JSON.parse(await res.text());
  assert.equal(j.id, m.id);
  assert.equal(Buffer.from(j.k, 'base64').length, 32);
  const again = sealFrom(m.signed, 'sealed-main2');
  assert.equal(again.r.status, 0, again.r.stderr);
  assert.notEqual(keyB64Of(again.out), keyB64Of(m.out));
});
// 25
await kase(25, 'the register gains one sealed-draft line with the key hash; the key is printed nowhere', () => {
  const m = main();
  assert.equal(m.after.length, m.before.length + 1);
  const c = m.after[m.after.length - 1].split('\t');
  assert.equal(c.length, 12);
  assert.equal(c[2], 'sealed-draft');
  assert.equal(c[3], m.id);
  assert.equal(c[4], `in:${treeHashOf(m.signed)}`);
  assert.equal(c[5], treeHashOf(m.out));
  assert.equal(c[6], String(rels(m.out).length));
  assert.equal(c[9], `key-sha256:${sha(keyOf(m.out))}`);
  assert.equal(c[11], 'demo.example.com');
  const key = keyOf(m.out);
  const secrets = [key.toString('hex'), key.toString('base64')];
  const printed = m.r.stdout + m.r.stderr, reg = fs.readFileSync(REG, 'utf8');
  for (const s of secrets) assert.ok(!printed.includes(s) && !reg.includes(s), 'the key leaked into a printed line or the register');
  assert.ok(new RegExp(`^sealed draft: ${m.id}; 3 pages, 2 code files sealed inside them, ${rels(m.out).length} files in .+; check PASS; register line added$`).test(m.r.stdout.trim()), `printed: ${m.r.stdout.trim().slice(0, 200)}`);
});
// 26
await kase(26, 'omk-noscript.html is the tool page; every shell holds the noscript refresh', () => {
  const m = main();
  assert.equal(W.noscript_title, 'This draft needs scripts');
  assert.equal(W.noscript_body, 'Omnikom draft previews are shown by a script. Turn scripts on for this address and reload.');
  const page = read(m.out, 'omk-noscript.html');
  assert.ok(page.includes('<html lang="en" class="omk-warn">') && page.includes('<link rel="stylesheet" href="/omk-draft.css">'));
  assert.ok(page.includes(`<main class="omk-warning" role="alert"><span class="omk-mark"></span><h1>${W.noscript_title}</h1><p>${W.noscript_body}</p></main>`));
  assert.equal(page, `<!doctype html><html lang="en" class="omk-warn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${W.noscript_title}</title><link rel="stylesheet" href="/omk-draft.css"></head><body><main class="omk-warning" role="alert"><span class="omk-mark"></span><h1>${W.noscript_title}</h1><p>${W.noscript_body}</p></main></body></html>`);
  for (const r of PAGES) assert.ok(read(m.out, r).includes('<noscript><meta http-equiv="refresh" content="0;url=/omk-noscript.html"></noscript>'), `${r}: no noscript refresh`);
});

// ---- round 2: 27 to 39 ----
const doc = (head, body) => `<!doctype html><html><head><title>T</title>${head}</head><body>${body}</body></html>\n`;
// 27
await kase(27, '--out: refused when it exists, inside --in, <in>-functions or inside it; an existing <out>-functions is refused', () => {
  const s = signDraft(makeClean(tinyFiles()));
  const inF = `${s.signed}-functions`;
  const attempt = (out, line) => {
    const lines = regLines().length, tin = treeHashOf(s.signed), tfn = treeHashOf(inF);
    const r = run(TOOL, ['--in', s.signed, '--out', out]);
    assert.equal(r.status, 1, `${out}: exit ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 150)}`);
    assert.ok(r.stderr.split('\n').includes(line), `${out}: stderr lacks "${line}": ${r.stderr.trim().slice(0, 200)}`);
    assert.equal(regLines().length, lines, `${out}: a register line was added`);
    assert.equal(treeHashOf(s.signed), tin, `${out}: the signed draft changed`);
    assert.equal(treeHashOf(inF), tfn, `${out}: the signed draft's functions folder changed`);
  };
  const line = 'REFUSED: --out exists or overlaps';
  const exists = path.join(TMP, 'x27-exists');
  put(exists, 'keep.txt', 'k');
  attempt(exists, line);
  assert.deepStrictEqual(rels(exists), ['keep.txt']);
  assert.ok(!fs.existsSync(`${exists}-functions`), 'a functions folder was made for an --out that exists');
  const inIn = path.join(s.signed, 'sealed');
  attempt(inIn, line);
  assert.ok(!fs.existsSync(inIn) && !fs.existsSync(`${inIn}-functions`), 'something was made inside --in');
  attempt(inF, line);
  const inFn = path.join(inF, 'sealed');
  attempt(inFn, line);
  assert.ok(!fs.existsSync(inFn) && !fs.existsSync(`${inFn}-functions`), 'something was made inside <in>-functions');
  const o = path.join(TMP, 'x27-fn');
  put(`${o}-functions`, 'keep.txt', 'k');
  attempt(o, `REFUSED: ${o}-functions exists; give a new --out`);
  assert.ok(!fs.existsSync(o), 'an --out folder was made next to an existing <out>-functions');
  assert.deepStrictEqual(rels(`${o}-functions`), ['keep.txt']);
});
// 28
await kase(28, 'refuses a page with a base tag; refuses a page made invalid UTF-8 after signing', () => {
  refusal(tinyFiles({ 'index.html': doc('<base href="/x/">', '<p>x</p>') }), 'REFUSED: a base tag cannot be sealed: index.html', 'x28a');
  refusal(tinyFiles(), 'REFUSED: index.html is not valid UTF-8', 'x28b', (signed) => fs.appendFileSync(path.join(signed, 'index.html'), Buffer.from([0xc3, 0x28])));
});
// 29
await kase(29, 'file kinds: a map, a .md and a file with no extension are refused; .cjs is a code file', () => {
  const kind = (rel) => `REFUSED: a file of this kind cannot ship in a sealed draft: ${rel}`;
  refusal(tinyFiles({ 'app.js.map': '{"version":3,"sourcesContent":["var secret=1;"]}\n' }), kind('app.js.map'), 'x29a');
  refusal(tinyFiles({ 'notes.md': '# notes\n' }), kind('notes.md'), 'x29b');
  refusal(tinyFiles({ 'LICENSE': 'text\n' }), kind('LICENSE'), 'x29c');
  refusal(tinyFiles({ 'extra.cjs': 'var x=1;\n' }), 'REFUSED: a code file no page loads cannot be sealed: extra.cjs', 'x29d');
  const b = built(tinyFiles({ 'index.html': doc('', '<script src="/lib.cjs"></script>'), 'lib.cjs': 'var lib="OMKCJS_77aa";\n' }), 'x29e');
  assert.ok(!rels(b.out).includes('lib.cjs'), 'lib.cjs is in the output');
  for (const r of rels(b.out)) assert.ok(!fs.readFileSync(path.join(b.out, r)).includes('OMKCJS_77aa'), `${r} holds the .cjs code`);
  const obj = openBlock(keyOf(b.out), blockOf(read(b.out, 'index.html')));
  assert.ok(obj.cuts.some((c) => c.kind === 'js' && c.code.includes('OMKCJS_77aa')), 'the .cjs code is not in a cut');
  assert.equal(check(b.out, b.signed).status, 0);
});
// 30
await kase(30, 'an svg file with a script is refused; one without ships byte for byte', () => {
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>\n`;
  const line = 'REFUSED: an svg file with a script cannot ship in a sealed draft: icon.svg';
  refusal(tinyFiles({ 'icon.svg': svg('<SCRIPT>alert(1)</SCRIPT>') }), line, 'x30a');
  refusal(tinyFiles({ 'icon.svg': svg('<script type="text/javascript">alert(1)</script>') }), line, 'x30b');
  refusal(tinyFiles({ 'icon.svg': svg('<script/>') }), line, 'x30c');
  const plain = svg('<path d="M0 0h8v8z"/><text>a scripture, and a script word</text><scripted/>');
  const b = built(tinyFiles({ 'icon.svg': plain }), 'x30d');
  assert.ok(fs.readFileSync(path.join(b.out, 'icon.svg')).equals(fs.readFileSync(path.join(b.signed, 'icon.svg'))), 'icon.svg differs');
  assert.equal(read(b.out, 'icon.svg'), plain);
});
// 31
await kase(31, 'a code file that is only preloaded is refused', () => {
  refusal(tinyFiles({ 'index.html': doc('<link rel="preload" href="/lazy.js" as="script">', '<p>x</p>'), 'lazy.js': 'var lazy=1;\n' }), 'REFUSED: lazy.js is only preloaded, no page loads it: it cannot be sealed', 'x31a');
  refusal(tinyFiles({ 'index.html': doc('<link rel="preload" href="/lazy.css" as="style">', '<p>x</p>'), 'lazy.css': 'p{margin:0}\n' }), 'REFUSED: lazy.css is only preloaded, no page loads it: it cannot be sealed', 'x31b');
});
// 32
await kase(32, 'a script of type text/ecmascript is refused; application/ld+json and application/json stay in the text', () => {
  refusal(tinyFiles({ 'index.html': doc('', '<script type="text/ecmascript">var a=1;</script>') }), 'REFUSED: a script of type text/ecmascript cannot be sealed: index.html', 'x32a');
  const ld = '<script type="application/ld+json">{"a":1}</script>', js = '<script type="application/json" id="cfg">{"b":2}</script>';
  const b = built(tinyFiles({ 'index.html': doc(ld, `${js}<p>x</p>`) }), 'x32b');
  const obj = openBlock(keyOf(b.out), blockOf(read(b.out, 'index.html')));
  assert.ok(obj.doc.includes(ld) && obj.doc.includes(js), 'a data script was cut out of the text');
  assert.equal(obj.cuts.filter((c) => c.kind === 'js').length, 0, 'a data script became a js cut');
  assert.equal(check(b.out, b.signed).status, 0);
});
// 33
await kase(33, 'a cut inside a textarea, title, noscript or template is refused; containers that hold no such tag pass', () => {
  const inside = (name, rel) => `REFUSED: a tag inside <${name}> cannot be sealed: ${rel}`;
  refusal(tinyFiles({ 'index.html': doc('', '<textarea><script>var a=1;</script></textarea>') }), inside('textarea', 'index.html'), 'x33a');
  refusal(tinyFiles({ 'index.html': '<!doctype html><html><head><title>Use <style>p{color:red}</style> wisely</title></head><body><p>x</p></body></html>\n' }), inside('title', 'index.html'), 'x33b');
  refusal(tinyFiles({ 'index.html': doc('', '<noscript><link rel="stylesheet" href="/n.css"></noscript>'), 'n.css': 'p{margin:0}\n' }), inside('noscript', 'index.html'), 'x33c');
  refusal(tinyFiles({ 'index.html': doc('', '<template><script>var t=1;</script></template>') }), inside('template', 'index.html'), 'x33d');
  const fine = '<textarea name="a">plain &lt;b&gt; text</textarea><noscript><img src="/p.gif" alt=""></noscript><template><p>hi</p></template><script>var OMKOK=1;</script>';
  const b = built(tinyFiles({ 'index.html': doc('', fine) }), 'x33e');
  const obj = openBlock(keyOf(b.out), blockOf(read(b.out, 'index.html')));
  assert.ok(obj.cuts.some((c) => c.kind === 'js' && c.code === 'var OMKOK=1;'), 'the script after the containers was not cut');
  assert.ok(obj.doc.includes('<textarea name="a">plain &lt;b&gt; text</textarea><noscript><img src="/p.gif" alt=""></noscript><template><p>hi</p></template>'));
});
// 34
await kase(34, 'a remote script keeps integrity, crossorigin and referrerpolicy in its cut; a local script does not', () => {
  const d = path.join(TMP, 'x34');
  put(d, 'loc.js', 'var loc=1;\n');
  const page = '<script src="https://cdn.example.com/r.js" integrity="sha384-abc" crossorigin="anonymous" referrerpolicy="no-referrer" id="r1" data-k="v" async></script>'
    + '<script src="https://cdn.example.com/q.js" crossorigin></script>'
    + '<script src="/loc.js" integrity="sha384-zzz" crossorigin="anonymous" referrerpolicy="origin" id="l1" data-a="1"></script>';
  const { cuts } = seal.splitPage(page, 'index.html', d);
  assert.equal(cuts.length, 3);
  assert.deepStrictEqual(cuts[0].attrs, { id: 'r1', 'data-k': 'v', integrity: 'sha384-abc', crossorigin: 'anonymous', referrerpolicy: 'no-referrer' });
  assert.equal(cuts[0].remote, 'https://cdn.example.com/r.js');
  assert.deepStrictEqual(cuts[1].attrs, { crossorigin: '' });
  assert.deepStrictEqual(cuts[2].attrs, { id: 'l1', 'data-a': '1' });
  assert.equal(cuts[2].remote, null);
});
// 35
await kase(35, 'a script whose src starts with // is remote: the build does not look for it in the folder', () => {
  const b = built(tinyFiles({ 'index.html': doc('', '<script src="//cdn.example.com/lib.js"></script>') }), 'x35');
  const obj = openBlock(keyOf(b.out), blockOf(read(b.out, 'index.html')));
  const js = obj.cuts.filter((c) => c.kind === 'js');
  assert.equal(js.length, 1);
  assert.equal(js[0].remote, '//cdn.example.com/lib.js');
  assert.equal(js[0].code, null);
  assert.equal(check(b.out, b.signed).status, 0);
});
// 36
await kase(36, 'a 100,000-character CSS file gives a block under 20,000 characters', () => {
  const palette = ['#a1b2c3', '#112233', '#fedcba', '#445566', '#0a0b0c', '#ff8800'];
  let css = '';
  for (let i = 0; ; i++) {
    const rule = `.c${i}{margin:${i % 7}px ${i % 5}px;padding:${i % 3}px;color:${palette[i % 6]};background:url(img${i % 9}.png)}\n`;
    if (css.length + rule.length > 99900) break;
    css += rule;
  }
  css += '/*' + ' '.repeat(100000 - css.length - 4) + '*/';
  assert.equal(css.length, 100000);
  const b = built(tinyFiles({ 'index.html': doc('<link rel="stylesheet" href="/big.css">', '<p>x</p>'), 'big.css': css }), 'x36');
  const block = blockOf(read(b.out, 'index.html'));
  assert.ok(block.length < 20000, `the block is ${block.length} characters`);
  assert.ok(openBlock(keyOf(b.out), block).cuts.some((c) => c.kind === 'css' && c.code.includes('.c1{margin')), 'the css is not in the block');
});
// 37
await kase(37, '--check fails on a block with one A appended, and on one with = appended', () => {
  const m = main();
  for (const [name, tail] of [['t37a', 'A'], ['t37b', '=']]) {
    const d = tamper(m, name, (x) => swapBlock(x, (old) => old + tail));
    const r = check(d, m.signed);
    assert.ok(failsWith(r, 'index.html: the block is not plain base64'), `"${tail}" appended: ${r.status} ${r.stdout.trim().slice(0, 200)}`);
  }
});
// 38
await kase(38, '--check fails on a block made again with the real key from the same text plus one more key', () => {
  const m = main(), key = keyOf(m.out);
  const same = tamper(m, 't38a', (x) => swapBlock(x, (old) => lockText(key, openText(key, old))));
  const control = check(same, m.signed);
  assert.equal(control.status, 0, `a block made again from the same text must pass: ${control.stdout.trim().slice(0, 200)}`);
  const d = tamper(m, 't38b', (x) => swapBlock(x, (old) => { const text = openText(key, old); assert.ok(text.endsWith('}')); return lockText(key, `${text.slice(0, -1)},"x":1}`); }));
  const r = check(d, m.signed);
  assert.ok(failsWith(r, "index.html: the block is not this signed page's block"), `${r.status} ${r.stdout.trim().slice(0, 200)}`);
});
// 39
await kase(39, '--check fails when the functions folder holds a second file', () => {
  const m = main();
  const d = tamper(m, 't39', (x) => put(`${x}-functions`, 'extra.js', 'export const onRequest = () => new Response("x");\n'));
  const r = check(d, m.signed);
  assert.ok(failsWith(r, 't39-functions: holds other files than omk-key.js'), `${r.status} ${r.stdout.trim().slice(0, 200)}`);
});
// 40 (browser trial B1: three rules the browser showed; their behaviour is proven by gate.mjs lines A, C and G, this case guards the text)
await kase(40, 'a sealed CSS file\'s relative url()s are made absolute against the file (the browser ignores baseURL); after the reveal the loader goes to the address\'s #part; it holds the icon place before attempt(0)', () => {
  const sb = { __OMK_TEST__: {}, URL };
  vm.runInNewContext(read(main().out, 'omk-seal.js'), sb);
  const r = sb.__OMK_TEST__.rebase;
  assert.equal(typeof r, 'function', 'the loader hands out no rebase');
  const base = 'https://demo.example.com/assets/css/site.css';
  assert.equal(r('a{background:url(../img/a.png)}', base), 'a{background:url(https://demo.example.com/assets/img/a.png)}');
  assert.equal(r('@font-face{src:url("../fonts/f.woff2?v=1") format("woff2")}', base), '@font-face{src:url("https://demo.example.com/assets/fonts/f.woff2?v=1") format("woff2")}');
  assert.equal(r("b{x:url( 'c.svg#i' )}", base), "b{x:url('https://demo.example.com/assets/css/c.svg#i')}");
  for (const keep of ['url(data:image/png;base64,AA==)', 'url(https://cdn.example.com/x.png)', 'url(//cdn.example.com/x.png)', 'url(#clip)', 'url("#clip")']) assert.equal(r(`a{b:${keep}}`, base), `a{b:${keep}}`, keep);
  const t = read(main().out, 'omk-seal.js');
  assert.ok(t.includes('s.replaceSync(c.base ? rebase(c.code, new URL(c.base, location.href).href) : c.code)'), 'a file cut is not rebased (or an inline one is)');
  assert.ok(t.includes('if (location.hash) location.replace(location.href);'), 'no go to the #part after the reveal');
  const able = t.indexOf('if (!able())'), hold = t.indexOf('holdIcon();'), first = t.indexOf('attempt(0)');
  assert.ok(able >= 0 && able < hold && hold < first, `the icon place is not held between able() (${able}) and attempt(0) (${first}): ${hold}`);
  assert.ok(t.includes("querySelectorAll('title, meta, #omk-sealed, #omk-icon')"), 'build does not remove the icon placeholder');
});
// 41 (the move into the repository): the register's place is --register or SIGN_SITE_REGISTER and nothing else
await kase(41, 'with neither --register nor SIGN_SITE_REGISTER a seal is refused before anything is written; --register <file> works; a --check needs none', () => {
  const s = signDraft(makeClean(tinyFiles()));
  const env = { ...process.env }; delete env.SIGN_SITE_REGISTER;
  const bare = (args) => spawnSync(process.execPath, ['--max-old-space-size=256', TOOL, ...args], { encoding: 'utf8', timeout: 90000, env });
  const out = path.join(TMP, 'x41'), lines = regLines().length;
  const r = bare(['--in', s.signed, '--out', out]);
  assert.equal(r.status, 1, `exit ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 150)}`);
  assert.ok(r.stderr.split('\n').includes("REFUSED: the register's place is not set: give --register <file> or set SIGN_SITE_REGISTER (it is kept outside the repository)"), `stderr: ${r.stderr.trim().slice(0, 200)}`);
  assert.ok(noOut(out), 'an output folder was left behind');
  assert.equal(regLines().length, lines, 'a register line was added');
  assert.ok(!fs.existsSync(path.join(path.dirname(TOOL), 'register.tsv')), 'a register was written beside the tool');
  const given = path.join(TMP, 'given-register.tsv'), out2 = path.join(TMP, 'x41b');
  const r2 = bare(['--in', s.signed, '--out', out2, '--register', given]);
  assert.equal(r2.status, 0, (r2.stderr || r2.stdout).trim().slice(0, 200));
  assert.ok(read(given).split('\n').filter(Boolean).length === 2 && read(given).includes('\tsealed-draft\t'), 'the given register holds no sealed-draft line');
  assert.equal(bare(['--check', out2, '--in', s.signed]).status, 0, 'a --check without a register failed');
});
// 42
await kase(42, 'the loader computes framed once (a top window of another origin counts as framed), tests it with the host, and hands it to done() both times', () => {
  const t = read(main().out, 'omk-seal.js');
  const line = 'var framed = false; try { framed = window.top !== window.self && window.top.location.hostname !== host; } catch (e) { framed = true; }';
  const test = 'if (!hostOk(host, HOSTS) || framed) { paint(WARN[0], WARN[1], true); return; }';
  assert.equal(t.split(line).length, 2, 'the framed line must be in the loader exactly once');
  assert.equal(t.split(test).length, 2, 'the host test with || framed must be in the loader exactly once');
  assert.ok(t.indexOf(line) < t.indexOf(test), 'framed must be computed before it is tested');
  const calls = t.match(/done\(\{[^}]*\}\)/g) || [];
  assert.equal(calls.length, 2, `the loader hands two objects to done(), found ${calls.length}`);
  for (const c of calls) assert.ok(c.includes('framed: framed'), `an object handed to done() lacks framed: ${c}`);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`seal-site tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

// seeded faults: each must turn its named case red (the named case must be among the failed ones)
if (process.argv.includes('--mutants')) {
  const MUT = [
    ['the host test taken out of decideSealed', 22, "    if (!hostOk(i.hostname, i.hosts) || i.framed) return 'warn';\n", "    if (i.framed) return 'warn';\n"],
    ['wait answered as warn', 22, "if (i.error || i.status !== 200) return 'wait';", "if (i.error || i.status !== 200) return 'warn';"],
    ['the JS file left in the output', 4, "if (r.toLowerCase() === 'omk-lock.js' || plan.removed.has(r.toLowerCase())) continue;", "if (r.toLowerCase() === 'omk-lock.js') continue;"],
    ['the cut for an inline script not taken', 3, "if (attrs.src === undefined) return mkCut(m[2], 'js', { code: m[4], mode: 'classic', attrs: keep });", 'if (attrs.src === undefined) return null;'],
    ['the check not comparing the block with the signed page', 10, "if (text !== JSON.stringify({ v: 2, doc: p.doc, cuts: p.cuts }))", 'if (false)'],
    ['blob: not added', 16, "+ ' blob:'", "+ ''"],
    ['the plain-base64 test taken out', 37, "Buffer.from(b64, 'base64').toString('base64') !== b64", 'false'],
    ['the functions-folder test taken out', 39, "held.length !== 1 || held[0] !== 'omk-key.js'", 'false'],
    ['the ship list not applied', 29, 'if (!SHIP.test(r)) refuse(', 'if (false) refuse('],
    ['the R5 count never above 0', 33, '(n) => open[n] > 0', '(n) => false'],
    ['our own fault shows the warning', 22, "if (i.error || i.status !== 200) return 'wait';", "if (i.error || i.status >= 500) return 'wait'; if (i.status !== 200) return 'warn';"],
    ['a page framed by another site opens', 22, "|| i.framed) return 'warn';", ") return 'warn';"],
  ];
  let caught = 0;
  for (const [name, want, from, to] of MUT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-site-mut-'));
    const src = fs.readFileSync(path.join(HERE, 'seal-site.mjs'), 'utf8');
    if (src.split(from).length !== 2) { console.log(`MUTANT TARGET NOT FOUND once: ${name}`); process.exitCode = 1; fs.rmSync(dir, { recursive: true, force: true }); continue; }
    fs.writeFileSync(path.join(dir, 'seal-site.mjs'), src.split(from).join(to));
    for (const f of ['sign-site.mjs', 'wording.json']) fs.copyFileSync(path.join(HERE, f), path.join(dir, f));
    fs.cpSync(path.join(HERE, 'assets'), path.join(dir, 'assets'), { recursive: true });
    const res = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 600000, env: { ...process.env, SEAL_SITE_TOOL: path.join(dir, 'seal-site.mjs') } });
    const reds = [...(res.stdout || '').matchAll(/^ {2}FAIL (\d+) /gm)].map((x) => Number(x[1]));
    const hit = res.status !== 0 && reds.includes(want);
    if (hit) caught++;
    console.log(`mutant "${name}": ${hit ? 'caught' : 'MISSED'} by case ${want} (red: ${reds.join(',') || 'none'}; ${((res.stdout || '').trim().split('\n').pop() || '').trim()})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`mutants: ${caught}/${MUT.length} caught`);
  if (caught !== MUT.length) process.exitCode = 1;
}
