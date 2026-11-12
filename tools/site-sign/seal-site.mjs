// seal-site: turns a SIGNED DRAFT (sign-site.mjs --draft) into a SEALED draft. Each page becomes a small shell holding one
// encrypted block; the site's own CSS and JS files live inside the pages' blocks and are not files in the output; one generated
// loader, /omk-seal.js (the lock and the unsealing in one file), shows the page only on our host with the key from /omk-key.
//   node seal-site.mjs --in <signed draft folder> --out <new folder>   (needs --register <file> or SIGN_SITE_REGISTER: the register is kept outside the repository)
//   node seal-site.mjs --check <sealed folder> --in <signed draft folder>
// The key is 32 random bytes per build (AES-256-GCM); it lives only in <out>-functions/omk-key.js, its sha256 goes in the register.
// The key is never printed and never on a command line. Method and limits: README.md ("Sealed drafts"). Browser behaviour of the
// loader is not covered by this tool's tests (they run the pure decideSealed only): it is proven by the browser trial.
// Exit 0 = done / check passed, 1 = refused / check failed, 2 = wrong command line.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { marks, treeHash, keyFunction, REGISTER_UNSET } from './sign-site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = JSON.parse(fs.readFileSync(path.join(HERE, 'wording.json'), 'utf8'));
// the warning page's logo is INLINE (same line as in sign-site.mjs): a copy on someone else's host loads nothing from our domains
const LOGO_DATA_URI = 'data:image/webp;base64,' + fs.readFileSync(path.join(HERE, 'assets', 'omnikom-logo-full.webp')).toString('base64');
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ID_RE = /^omk-[a-z0-9-]+-\d{8}-[0-9a-f]{12}$/;
const PAGE = /\.html?$/i, CODE = /\.(css|[mc]?js)$/i;
// what may ship as it is (R1): a page (sealed), a code file (inside a cut and absent, or the tool's own), _headers, _redirects, or a file of this list
const SHIP = /\.(png|jpe?g|webp|avif|gif|ico|svg|woff2?|ttf|otf|mp4|webm|mp3|pdf|txt|xml|json|webmanifest)$/i;
// script types (R4): cut and run, or data a browser does not run (left in the text); anything else is refused
const JS_TYPES = new Set(['text/javascript', 'application/javascript']);
const DATA_TYPES = new Set(['application/ld+json', 'application/json', 'text/plain', 'text/template', 'text/x-template', 'text/html']);
// what a remote script keeps besides id and data-* (R6): what protects it
const PROTECT = new Set(['integrity', 'crossorigin', 'referrerpolicy']);
// containers whose content a browser does not run as page tags (R5): a cut inside one is refused
const INERT = /<(\/?)(textarea|template|noscript|title|xmp|iframe)(?=[\s/>])/gi;
const INERT_NAMES = ['textarea', 'template', 'noscript', 'title', 'xmp', 'iframe'];
const NOT_SIGNED = '--in is not a signed draft';
const REGISTER_HEADER = 'time_utc\tsite\tstage\tid\tclean_sha256\tsigned_sha256\tfiles\tproject\tdeployment\tclient\tdate\thost\n';
const BLOCK_RE = /<script id="omk-sealed" type="application\/octet-stream">([A-Za-z0-9+/=]*)<\/script>/g;

class Refusal extends Error {}
const refuse = (why) => { throw new Refusal(why); };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rels = (d) => walk(d).map((f) => path.relative(d, f).split(path.sep).join('/')).sort();
const lockHosts = (host) => (host.endsWith('.pages.dev') ? [host, `*.${host}`] : [host]); // twin of the one in sign-site.mjs
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); // ignoreBOM: a BOM stays in the text, so the page comes back byte for byte
function readText(file, label) {
  const b = fs.readFileSync(file);
  try { return UTF8.decode(b); } catch { return refuse(`${label} is not valid UTF-8`); }
}

// AES-256-GCM; stored blob = iv(12) | tag(16) | ciphertext, base64. The browser (SubtleCrypto) wants ciphertext then tag, the loader re-splices.
export function encrypt(key, plaintextBuf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintextBuf), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}
export function decrypt(key, b64) {
  const blob = Buffer.from(b64, 'base64');
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// ---- splitting a page: what is cut out of the text, and what is left ----
const OPEN = `(?:"[^"]*"|'[^']*'|[^>"'])*`; // the inside of a tag, quote aware: a ">" inside an attribute value does not end it
const SCAN = new RegExp(
  `(<!--[^]*?(?:-->|$))` // 1 a comment: skipped whole, nothing inside it is a tag
  + `|(<script(?=[\\s/>])(${OPEN})>([^]*?)(?:</script(?=[\\s/>])${OPEN}>|$))` // 2 whole, 3 attributes, 4 text
  + `|(<style(?=[\\s/>])(${OPEN})>([^]*?)(?:</style(?=[\\s/>])${OPEN}>|$))` // 5 whole, 6 attributes, 7 text
  + `|(<link(?=[\\s/>])(${OPEN})>)`, // 8 whole, 9 attributes
  'gi');
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };
const unent = (s) => s.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/gi, (_, k) => ENTITY[k.toLowerCase()]);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isLocal = (s) => !/^(?:https?:|\/\/|data:|blob:)/i.test(s.trim());
const bare = (s) => s.replace(/<!--[^]*?(?:-->|$)/g, '');
function parseAttrs(s) {
  const out = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const k = m[1].toLowerCase();
    if (has(out, k)) continue;
    out[k] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  }
  return out;
}
// a local reference, from the page's folder (or the site root when it starts with "/"), without ? or #, URL-decoded; must be a file inside inDir
function resolveLocal(ref, relPage, inDir) {
  const miss = () => refuse(`${relPage} loads a file that is not in the build: ${ref}`);
  let p = ref.trim().replace(/[?#][^]*$/, '');
  try { p = decodeURIComponent(p); } catch { miss(); }
  const segs = p.startsWith('/') ? [] : relPage.split('/').slice(0, -1);
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s.includes('\\') || s.includes('\0')) miss();
    if (s === '..') { if (!segs.length) miss(); segs.pop(); } else segs.push(s);
  }
  const abs = path.join(inDir, ...segs);
  const inside = path.relative(inDir, abs);
  if (!segs.length || inside.startsWith('..') || path.isAbsolute(inside)) miss();
  let st;
  try { st = fs.statSync(abs); } catch { miss(); }
  if (!st.isFile()) miss();
  return { rel: segs.join('/'), abs };
}
const mkCut = (raw, kind, o) => ({ raw, kind, code: null, remote: null, media: '', base: '', mode: '', attrs: {}, ...o });
const noImport = (code, label) => { if (/@import\b/i.test(code.replace(/\/\*[^]*?\*\//g, ''))) refuse(`@import cannot be sealed: ${label}`); return code; };

// returns { doc, cuts, files }: files = the local files the cuts name ({ rel, inside }: inside = its text sits in a cut)
function splitFull(text, relPage, inDir) {
  const files = [];
  const useFile = (ref, inside) => { const f = resolveLocal(ref, relPage, inDir); files.push({ rel: f.rel, inside }); return f; };
  const scriptCut = (m) => {
    const attrs = parseAttrs(m[3]);
    const type = has(attrs, 'type') ? attrs.type.split(';')[0].trim().toLowerCase() : null;
    if (type === 'module') refuse(`a module script cannot be sealed: ${relPage}`);
    if (type !== null && DATA_TYPES.has(type)) return null;
    if (type !== null && type !== '' && !JS_TYPES.has(type)) refuse(`a script of type ${type} cannot be sealed: ${relPage}`);
    if (attrs.src === '/omk-lock.js' || has(attrs, 'nomodule')) return mkCut(m[2], 'skip', {});
    const keep = {};
    const remote = attrs.src !== undefined && !isLocal(unent(attrs.src));
    for (const k of Object.keys(attrs)) if (k === 'id' || k.startsWith('data-') || (remote && PROTECT.has(k))) keep[k] = unent(attrs[k]);
    if (attrs.src === undefined) return mkCut(m[2], 'js', { code: m[4], mode: 'classic', attrs: keep });
    const mode = has(attrs, 'defer') || has(attrs, 'async') ? 'defer' : 'classic';
    const src = unent(attrs.src);
    if (!isLocal(src)) return mkCut(m[2], 'js', { remote: src, mode, attrs: keep });
    const f = useFile(src, true);
    return mkCut(m[2], 'js', { code: readText(f.abs, f.rel), mode, attrs: keep });
  };
  const styleCut = (m) => mkCut(m[5], 'css', { code: noImport(m[7], relPage), media: unent(parseAttrs(m[6]).media || '') });
  const linkCut = (m) => {
    const attrs = parseAttrs(m[9]);
    if (attrs.href === undefined) return null;
    const href = unent(attrs.href), rel = (attrs.rel || '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet')) {
      if (href === '/omk-draft.css') return mkCut(m[8], 'skip', {});
      if (!isLocal(href)) return null;
      const f = useFile(href, true);
      return mkCut(m[8], 'css', { code: noImport(readText(f.abs, f.rel), f.rel), media: unent(attrs.media || ''), base: `/${f.rel}` });
    }
    if (['preload', 'modulepreload', 'prefetch'].some((w) => rel.includes(w)) && isLocal(href) && /\.(css|m?js)$/i.test(href.replace(/[?#][^]*$/, ''))) {
      useFile(href, false);
      return mkCut(m[8], 'skip', {});
    }
    return null;
  };
  const re = new RegExp(SCAN.source, SCAN.flags);
  const cuts = [];
  // openings minus closings of each inert container, counted in the text outside every match of SCAN, left to right as the loop advances
  const open = {};
  let seen = 0;
  const tally = (s) => { for (const t of s.matchAll(INERT)) { const n = t[2].toLowerCase(); open[n] = Math.max(0, (open[n] || 0) + (t[1] ? -1 : 1)); } };
  let doc = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    tally(text.slice(seen, m.index)); seen = m.index + m[0].length;
    if (m[1] !== undefined) continue;
    const c = m[2] !== undefined ? scriptCut(m) : m[5] !== undefined ? styleCut(m) : linkCut(m);
    if (!c) continue;
    const inert = INERT_NAMES.find((n) => open[n] > 0);
    if (inert) refuse(`a tag inside <${inert}> cannot be sealed: ${relPage}`);
    doc += text.slice(last, m.index);
    last = m.index + m[0].length;
    cuts.push({ at: doc.length, ...c });
  }
  doc += text.slice(last);
  if (/<base(?=[\s/>])/i.test(bare(doc))) refuse(`a base tag cannot be sealed: ${relPage}`);
  return { doc, cuts, files };
}
export function splitPage(text, relPage, inDir) { const { doc, cuts } = splitFull(text, relPage, inDir); return { doc, cuts }; }
export function joinPage({ doc, cuts }) {
  let out = '', last = 0;
  for (const c of cuts) { out += doc.slice(last, c.at) + c.raw; last = c.at; }
  return out + doc.slice(last);
}

// ---- the shell of a page ----
function pageParts(doc) {
  const t = bare(doc);
  const title = t.match(/<title(?=[\s/>])[^>]*>([^]*?)<\/title\s*>/i);
  const html = t.match(new RegExp(`<html(?=[\\s/>])(${OPEN})>`, 'i'));
  const lang = html ? parseAttrs(html[1]).lang : undefined;
  return { title: title ? title[1] : '', lang: lang ? lang.replace(/"/g, '&quot;') : 'en' };
}
function shellOf(m, id, doc, b64) {
  const { title, lang } = pageParts(doc);
  return `<!doctype html>${m.htmlComment}\n<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${m.meta}${m.draftRobotsMeta}<noscript><meta http-equiv="refresh" content="0;url=/omk-noscript.html"></noscript><link rel="stylesheet" href="/omk-draft.css"><script id="omk-sealed" type="application/octet-stream">${b64}</script><script src="/omk-seal.js" defer></script></head><body data-omk-sig="${id}"></body></html>`;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function noscriptPage() {
  const t = esc(W.noscript_title), b = esc(W.noscript_body);
  return `<!doctype html><html lang="en" class="omk-warn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title><link rel="stylesheet" href="/omk-draft.css"></head><body><main class="omk-warning" role="alert"><span class="omk-mark"></span><h1>${t}</h1><p>${b}</p></main></body></html>`;
}
// "blob:" at the end of each script-src directive that lacks it (drafts only: sign-site.mjs refuses it in live and handover)
export function sealHeaders(text) {
  return text.replace(/(?<=(?:^|[:;])[ \t]*)script-src(?![\w-])([^;\r\n]*)/gim, (all, rest) => (/(?:^|\s)blob:(?:\s|$)/i.test(rest) ? all : all.replace(/\s+$/, '') + ' blob:'));
}
export function sealedKeyFunction(id, keyB64) {
  const base = keyFunction(id);
  const a = `JSON.stringify({ id: ${JSON.stringify(id)} })`, b = "answers this deployment's signature ID and nothing else (no secret)";
  if (base.split(a).length !== 2 || base.split(b).length !== 2) throw new Error('sign-site.mjs keyFunction changed: update sealedKeyFunction with it');
  return base.replace(a, () => `JSON.stringify({ id: ${JSON.stringify(id)}, k: ${JSON.stringify(keyB64)} })`)
    .replace(b, () => "answers this deployment's signature ID and the key that opens its sealed pages (a secret: never part of the site files)");
}

// The loader. hostOk, lift and the warning layout (paint) are twins of hostOk, lift and apply() in lockJs (sign-site.mjs).
// decideSealed() and rebase() are pure and tested; with globalThis.__OMK_TEST__ set the loader only hands out decideSealed, HOSTS, ID and rebase.
export function sealJs(id, hosts, report, notice) {
  const vals = { host: hosts[0], report, id, year: id.split('-').slice(-2, -1)[0].slice(0, 4) };
  const warn = ['warning_title', 'warning_body', 'warning_report', 'warning_footer'].map((k) => fill(W[k], vals));
  const wait = ['wait_title', 'wait_body'].map((k) => fill(W[k], vals));
  const old = ['old_title', 'old_body'].map((k) => fill(W[k], vals));
  return `/*! ${notice} */
(function () {
  var HOSTS = ${JSON.stringify(hosts)}, ID = ${JSON.stringify(id)}, WARN = ${JSON.stringify(warn)}, WAIT = ${JSON.stringify(wait)}, OLD = ${JSON.stringify(old)};
  var LOGO = ${JSON.stringify(LOGO_DATA_URI)};
  // hostOk, lift and paint are the twins of hostOk, lift and the warning builder of apply() in lockJs (sign-site.mjs): change them together
  function hostOk(h, list) {
    if (!h) return false;
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (h === x) return true;
      if (x.indexOf('*.') === 0 && h.length > x.length - 1 && h.slice(-(x.length - 1)) === x.slice(1)) return true;
    }
    return false;
  }
  // pure: what the answer from /omk-key means. warn = not ours or not allowed, wait = cannot tell yet, reveal = open the page
  function decideSealed(i) {
    if (!hostOk(i.hostname, i.hosts)) return 'warn';
    if (i.error || i.status === 429 || i.status >= 500) return 'wait';
    if (i.status !== 200) return 'warn';
    var j; try { j = JSON.parse(i.body); } catch (e) { return 'warn'; }
    return j && j.id === i.id && typeof j.k === 'string' && j.k !== '' ? 'reveal' : 'warn';
  }
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__OMK_TEST__) { g.__OMK_TEST__.decideSealed = decideSealed; g.__OMK_TEST__.HOSTS = HOSTS; g.__OMK_TEST__.ID = ID; g.__OMK_TEST__.rebase = rebase; return; }
  var root = document.documentElement;
  // the draft bar is fixed to the bottom: lift the site's own bottom-fixed parts (a phone nav bar, a call button) above it
  function lift() {
    var bar = document.querySelector('.omk-draft'); if (!bar) return;
    var h = bar.getBoundingClientRect().height, all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i]; if (e === bar || bar.contains(e)) continue;
      var cs = getComputedStyle(e);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      var base = e.getAttribute('data-omk-bottom');
      if (base === null) { var b = parseFloat(cs.bottom); if (isNaN(b) || cs.bottom === 'auto' || b > 40) continue; base = String(b); e.setAttribute('data-omk-bottom', base); }
      e.style.bottom = (parseFloat(base) + h) + 'px';
    }
  }
  function show() {
    root.classList.add('omk-ok'); lift();
    var t2; window.addEventListener('resize', function () { clearTimeout(t2); t2 = setTimeout(lift, 150); });
    setTimeout(lift, 1000);
  }
  // the warning layout; the wait page is the same layout with the wait words and no report box
  function paint(title, text, withReport) {
    var b = document.body || root.appendChild(document.createElement('body'));
    while (b.firstChild) b.removeChild(b.firstChild);
    function el(tag, cls, text2) { var e = document.createElement(tag); if (cls) e.className = cls; if (text2) e.textContent = text2; return e; }
    var d = el('main', 'omk-warning'); d.setAttribute('role', 'alert');
    var logo = el('img', 'omk-logo'); logo.src = LOGO; logo.alt = 'Omnikom'; logo.width = 112; logo.height = 28;
    d.appendChild(logo); d.appendChild(el('span', 'omk-mark')); d.appendChild(el('h1', '', title)); d.appendChild(el('p', '', text));
    if (withReport) { var rep = el('div', 'omk-report'); rep.appendChild(el('p', '', WARN[2])); d.appendChild(rep); }
    d.appendChild(el('hr')); d.appendChild(el('small', '', WARN[3]));
    root.setAttribute('lang', 'en'); b.appendChild(d); root.classList.add('omk-warn'); document.title = title;
  }
  function b64(s) { var bin = atob(s), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u; }
  // the browser ignores the baseURL of a constructed sheet (Edge 157, browser trial B1): a CSS file's relative url()s are made
  // absolute against the file itself, so its fonts and images load from the file's own folder; data:, other schemes, // and #ids stay
  function rebase(code, base) {
    return code.replace(/url\\(\\s*(['"]?)(.*?)\\1\\s*\\)/gi, function (all, q, u) {
      return !u || /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(u) ? all : 'url(' + q + new URL(u, base).href + q + ')';
    });
  }
  // a page that finishes loading with no icon link makes the browser ask for /favicon.ico; the page's own icon link arrives with the
  // reveal, after the load: hold the place with an empty one until then (build removes it)
  function holdIcon() { var l = document.createElement('link'); l.id = 'omk-icon'; l.rel = 'icon'; l.href = 'data:,'; document.head.appendChild(l); }
  // true only in a browser that has everything the unsealing needs; anything missing, or any throw, is false
  function able() {
    try {
      return typeof DecompressionStream === 'function' && typeof DOMParser === 'function' && !!(crypto && crypto.subtle)
        && !!document.adoptedStyleSheets && typeof CSSStyleSheet === 'function' && typeof CSSStyleSheet.prototype.replaceSync === 'function';
    } catch (e) { return false; }
  }
  // the browser side of decrypt() and gunzip: iv 12, tag 16, then the ciphertext; SubtleCrypto wants the ciphertext and then the tag
  function openBlock(keyB64) {
    var blob = b64(document.getElementById('omk-sealed').textContent), iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ct = blob.subarray(28), data = new Uint8Array(ct.length + 16);
    data.set(ct); data.set(tag, ct.length);
    return crypto.subtle.importKey('raw', b64(keyB64), { name: 'AES-GCM' }, false, ['decrypt'])
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, data); })
      .then(function (pt) { return new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); })
      .then(function (text) { return JSON.parse(text); });
  }
  function copyAttrs(from, to) {
    for (var i = 0; i < from.attributes.length; i++) {
      var a = from.attributes[i];
      try {
        if (a.name === 'class') {
          var keep = [];
          for (var k = 0; k < to.classList.length; k++) if (to.classList[k].indexOf('omk-') === 0) keep.push(to.classList[k]);
          to.setAttribute('class', keep.concat(a.value ? [a.value] : []).join(' '));
        } else to.setAttribute(a.name, a.value);
      } catch (e) {}
    }
  }
  // the classic scripts in order, then the deferred ones, one after the other; no element that holds site code stays in the page
  function runScripts(cuts, done) {
    var js = cuts.filter(function (c) { return c.kind === 'js'; });
    var order = js.filter(function (c) { return c.mode !== 'defer'; }).concat(js.filter(function (c) { return c.mode === 'defer'; }));
    var n = 0;
    (function next() {
      if (n >= order.length) { done(); return; }
      var c = order[n++], s = document.createElement('script'), url = null, over = false, at = c.attrs || {};
      for (var k in at) if (Object.prototype.hasOwnProperty.call(at, k)) { try { s.setAttribute(k, at[k]); } catch (e) {} }
      if (c.code !== null) { url = URL.createObjectURL(new Blob([c.code], { type: 'text/javascript' })); s.src = url; } else s.src = c.remote;
      function fin() { if (over) return; over = true; if (url) URL.revokeObjectURL(url); if (s.parentNode) s.parentNode.removeChild(s); next(); }
      s.addEventListener('load', fin); s.addEventListener('error', fin);
      document.body.appendChild(s);
    })();
  }
  function build(p) {
    if (!p || p.v !== 2 || typeof p.doc !== 'string' || !Array.isArray(p.cuts)) { paint(WAIT[0], WAIT[1], false); return; }
    root.classList.remove('omk-warn');
    var parsed = new DOMParser().parseFromString(p.doc, 'text/html');
    copyAttrs(parsed.documentElement, root); copyAttrs(parsed.body, document.body);
    var old = document.head.querySelectorAll('title, meta, #omk-sealed, #omk-icon');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    while (parsed.head.firstChild) document.head.appendChild(parsed.head.firstChild);
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    while (parsed.body.firstChild) document.body.appendChild(parsed.body.firstChild);
    var sheets = [];
    for (var j = 0; j < p.cuts.length; j++) {
      var c = p.cuts[j]; if (c.kind !== 'css') continue;
      var s = new CSSStyleSheet({ baseURL: c.base ? new URL(c.base, location.href).href : location.href, media: c.media });
      s.replaceSync(c.base ? rebase(c.code, new URL(c.base, location.href).href) : c.code); sheets.push(s);
    }
    document.adoptedStyleSheets = Array.prototype.slice.call(document.adoptedStyleSheets).concat(sheets);
    show();
    runScripts(p.cuts, function () {
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
      if (document.readyState === 'complete') window.dispatchEvent(new Event('load'));
      // the browser looked for the address's #part when the shell loaded, before the page existed: go to it now (no reload)
      if (location.hash) location.replace(location.href);
    });
  }
  var host = location.hostname, DELAYS = [1000, 2000, 4000];
  function attempt(n) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
    function done(i) {
      clearTimeout(t);
      var r = decideSealed(i);
      if (r === 'wait') {
        paint(WAIT[0], WAIT[1], false);
        if (n < DELAYS.length) setTimeout(function () { attempt(n + 1); }, DELAYS[n]);
        return;
      }
      if (r === 'warn') { paint(WARN[0], WARN[1], true); return; }
      // from here the answer was reveal: a block that does not open, is not version 2 or breaks build is our fault, never the unauthorised-copy words, and there is no retry
      var p; try { p = openBlock(JSON.parse(i.body).k); } catch (e) { paint(WAIT[0], WAIT[1], false); return; }
      p.then(function (x) { try { build(x); } catch (e) { paint(WAIT[0], WAIT[1], false); } }, function () { paint(WAIT[0], WAIT[1], false); });
    }
    fetch('/omk-key', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.text().then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (a) { done({ hostname: host, hosts: HOSTS, status: a.status, body: a.body, id: ID }); }, function () { done({ hostname: host, hosts: HOSTS, error: true, id: ID }); });
  }
  if (!hostOk(host, HOSTS)) { paint(WARN[0], WARN[1], true); return; }
  if (!able()) { paint(OLD[0], OLD[1], false); return; }
  holdIcon();
  attempt(0);
})();
`;
}

// ---- reading the input ----
function readSigned(inDir) {
  const idx = path.join(inDir, 'index.html');
  if (!fs.existsSync(idx) || !fs.statSync(idx).isFile()) refuse(NOT_SIGNED);
  const t = fs.readFileSync(idx, 'utf8');
  const sm = t.match(/name="omnikom-signature" content="([^;"]+); stage=([a-z-]+)"/);
  if (!sm || sm[2] !== 'draft' || !ID_RE.test(sm[1])) refuse(NOT_SIGNED);
  if (!fs.existsSync(path.join(`${inDir}-functions`, 'omk-key.js'))) refuse(NOT_SIGNED);
  // an already sealed folder is not a signed draft
  if (t.includes('id="omk-sealed"') || fs.existsSync(path.join(inDir, 'omk-seal.js')) || fs.existsSync(path.join(inDir, 'omk-noscript.html'))) refuse(NOT_SIGNED);
  const id = sm[1];
  const copyright = ((t.match(/name="copyright" content="([^"]*)"/) || [])[1] || '').replace(/&quot;/g, '"');
  const host = (copyright.match(/publishes this draft only at (\S+)\. If/) || [])[1] || '';
  if (!HOST.test(host)) refuse(NOT_SIGNED);
  const day = id.split('-').slice(-2, -1)[0];
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const m = marks('draft', id, { year: date.slice(0, 4), client: '', date, host });
  return { id, host, date, m, site: id.split('-').slice(1, -2).join('-') };
}
// every page split, every code file accounted for; refusals come here, before anything is written
function planOf(inDir, sig) {
  const files = rels(inDir);
  const pages = [], all = new Set(), inside = new Set();
  for (const r of files.filter((f) => PAGE.test(f))) {
    const text = readText(path.join(inDir, r), r);
    if (!text.includes(sig.m.htmlComment) || !text.includes(sig.m.meta)) refuse(NOT_SIGNED);
    const s = splitFull(text, r, inDir);
    if (joinPage({ doc: s.doc, cuts: s.cuts }) !== text) refuse(`the page cannot be split without loss: ${r}`);
    pages.push({ rel: r, text, doc: s.doc, cuts: s.cuts });
    for (const f of s.files) { all.add(f.rel.toLowerCase()); if (f.inside) inside.add(f.rel.toLowerCase()); }
  }
  const own = (r) => r === 'omk-draft.css' || r === 'omk-lock.js'; // the tool's own code files
  // R2: a file named only by a preload would be dropped with its code nowhere
  for (const n of all) if (!inside.has(n) && !own(n)) refuse(`${files.find((f) => f.toLowerCase() === n) || n} is only preloaded, no page loads it: it cannot be sealed`);
  // R1: what may ship as it is
  for (const r of files) {
    if (PAGE.test(r) || r === '_headers' || r === '_redirects') continue;
    if (CODE.test(r)) { if (!own(r) && !all.has(r.toLowerCase())) refuse(`a code file no page loads cannot be sealed: ${r}`); continue; }
    if (!SHIP.test(r)) refuse(`a file of this kind cannot ship in a sealed draft: ${r}`);
    if (/\.svg$/i.test(r) && /<script[\s/>]/i.test(fs.readFileSync(path.join(inDir, r)).toString('utf8'))) refuse(`an svg file with a script cannot ship in a sealed draft: ${r}`);
  }
  const removed = new Set([...all].filter((r) => r !== 'omk-draft.css'));
  return { files, pages, removed, inside: inside.size };
}

// ---- the build ----
export function sealBuild({ inDir, outDir, key, register: reg }) {
  if (!reg) refuse(REGISTER_UNSET);
  inDir = path.resolve(inDir); outDir = path.resolve(outDir);
  key = key || crypto.randomBytes(32);
  if (key.length !== 32) throw new Error('the key must be 32 bytes');
  const sig = readSigned(inDir);
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  // a is b, or lies under b (on the normalised paths)
  const within = (a, b) => { a = norm(a); b = norm(b); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
  const inF = `${inDir}-functions`, fdir = `${outDir}-functions`;
  if (fs.existsSync(outDir) || within(outDir, inDir) || within(inDir, outDir) || within(outDir, inF) || within(inF, outDir) || within(fdir, inDir) || within(inDir, fdir)) refuse('--out exists or overlaps');
  if (fs.existsSync(fdir)) refuse(`${fdir} exists; give a new --out`);
  const plan = planOf(inDir, sig);
  const shells = new Map(plan.pages.map((p) => [p.rel, shellOf(sig.m, sig.id, p.doc, encrypt(key, zlib.gzipSync(Buffer.from(JSON.stringify({ v: 2, doc: p.doc, cuts: p.cuts }), 'utf8'), { level: 9 })))]));
  fs.mkdirSync(outDir, { recursive: true });
  const put = (r, data) => { const dst = path.join(outDir, r); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, data); };
  for (const r of plan.files) {
    if (shells.has(r)) put(r, shells.get(r));
    else if (r.toLowerCase() === 'omk-lock.js' || plan.removed.has(r.toLowerCase())) continue;
    else if (r === '_headers') put(r, Buffer.from(sealHeaders(fs.readFileSync(path.join(inDir, r)).toString('latin1')), 'latin1'));
    else put(r, fs.readFileSync(path.join(inDir, r)));
  }
  put('omk-seal.js', sealJs(sig.id, lockHosts(sig.host), W.report_email, sig.m.notice));
  put('omk-noscript.html', noscriptPage());
  fs.mkdirSync(fdir, { recursive: true });
  fs.writeFileSync(path.join(fdir, 'omk-key.js'), sealedKeyFunction(sig.id, key.toString('base64')));
  const res = check(outDir, inDir, true);
  if (!res.ok) { console.error(res.problems.slice(0, 20).join('\n')); refuse('the sealed folder failed its own check (left in place for reading)'); }
  const files = walk(outDir).length;
  if (!fs.existsSync(reg)) fs.writeFileSync(reg, REGISTER_HEADER);
  fs.appendFileSync(reg, [new Date().toISOString(), sig.site, 'sealed-draft', sig.id, `in:${treeHash(inDir)}`, treeHash(outDir), files, '-', '-', `key-sha256:${sha256(key)}`, sig.date, sig.host].join('\t') + '\n');
  console.log(`sealed draft: ${sig.id}; ${plan.pages.length} pages, ${plan.inside} code files sealed inside them, ${files} files in ${outDir}; check PASS; register line added`);
  return { id: sig.id, pages: plan.pages.length, sealedCode: plan.inside, files };
}

// ---- the check: the sealed folder is that signed draft and nothing else ----
export function check(sealedDir, inDir, quiet = false) {
  sealedDir = path.resolve(sealedDir); inDir = path.resolve(inDir);
  const problems = [];
  let sig, plan;
  try { sig = readSigned(inDir); plan = planOf(inDir, sig); } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    if (!quiet) console.log(`SEAL CHECK FAIL: 1 problems\n--in: ${e.message}`);
    return { ok: false, problems: [`--in: ${e.message}`], id: null, pages: 0 };
  }
  const { id, host, m } = sig;
  // the key, from the function file
  const fnFile = path.join(`${sealedDir}-functions`, 'omk-key.js'), fnName = `${path.basename(sealedDir)}-functions/omk-key.js`;
  let key = null;
  if (!fs.existsSync(fnFile)) problems.push(`${fnName}: missing`);
  else {
    const ft = fs.readFileSync(fnFile, 'utf8');
    const kb = (ft.match(/\bk: "([A-Za-z0-9+/=]*)"/) || [])[1];
    if (kb !== undefined && Buffer.from(kb, 'base64').length === 32 && sealedKeyFunction(id, kb) === ft) key = Buffer.from(kb, 'base64');
    else problems.push(`${fnName}: not the tool's function file for this ID with a 32-byte key`);
    // the functions folder is deployed whole: it holds this one file and nothing else
    const held = rels(path.dirname(fnFile));
    if (held.length !== 1 || held[0] !== 'omk-key.js') problems.push(`${path.basename(sealedDir)}-functions: holds other files than omk-key.js`);
  }
  const pageSet = new Set(plan.pages.map((p) => p.rel));
  for (const p of plan.pages) {
    const f = path.join(sealedDir, p.rel);
    if (!fs.existsSync(f)) { problems.push(`${p.rel}: no shell in the sealed folder`); continue; }
    const st = fs.readFileSync(f, 'utf8');
    const blocks = [...st.matchAll(BLOCK_RE)];
    if (blocks.length !== 1) { problems.push(`${p.rel}: no shell (a sealed page holds exactly one block)`); continue; }
    const b64 = blocks[0][1];
    if (st !== shellOf(m, id, p.doc, b64)) problems.push(`${p.rel}: not the shell this tool makes for this page and block`);
    // the block's text is plain base64 (the browser's atob is strict where Node's decoder is not)
    if (Buffer.from(b64, 'base64').toString('base64') !== b64) { problems.push(`${p.rel}: the block is not plain base64`); continue; }
    let text = null;
    if (key) { try { text = zlib.gunzipSync(decrypt(key, b64)).toString('utf8'); } catch { text = null; } }
    if (text === null) { problems.push(`${p.rel}: the block does not decrypt`); continue; }
    // exactly the signed page's block: nothing added, nothing missing, same order
    if (text !== JSON.stringify({ v: 2, doc: p.doc, cuts: p.cuts })) problems.push(`${p.rel}: the block is not this signed page's block`);
  }
  // the other files
  const inFiles = new Set(plan.files), sealedFiles = rels(sealedDir), sealedSet = new Set(sealedFiles);
  for (const r of sealedFiles) {
    if (CODE.test(r) && r !== 'omk-draft.css' && r !== 'omk-seal.js') { problems.push(`${r}: a code file in the sealed folder`); continue; }
    if (pageSet.has(r)) continue;
    const bytes = fs.readFileSync(path.join(sealedDir, r));
    if (r === 'omk-seal.js') { if (bytes.toString('utf8') !== sealJs(id, lockHosts(host), W.report_email, m.notice)) problems.push('omk-seal.js: not the tool\'s loader for this ID and host'); continue; }
    if (r === 'omk-noscript.html') { if (bytes.toString('utf8') !== noscriptPage()) problems.push('omk-noscript.html: not the tool\'s page'); continue; }
    if (!inFiles.has(r)) { problems.push(`${r}: not in --in and not made by this tool`); continue; }
    if (r === '_headers') { if (bytes.toString('latin1') !== sealHeaders(fs.readFileSync(path.join(inDir, r)).toString('latin1'))) problems.push('_headers: not the input\'s with the "blob:" rule added'); continue; }
    if (!bytes.equals(fs.readFileSync(path.join(inDir, r)))) problems.push(`${r}: differs from --in`);
  }
  const expected = plan.files.filter((r) => !pageSet.has(r) && r.toLowerCase() !== 'omk-lock.js' && !plan.removed.has(r.toLowerCase())).concat(['omk-seal.js', 'omk-noscript.html']);
  for (const r of expected) if (!sealedSet.has(r)) problems.push(`${r}: missing from the sealed folder`);
  if (!quiet) console.log(problems.length ? `SEAL CHECK FAIL: ${problems.length} problems\n` + problems.slice(0, 30).join('\n') : `SEAL CHECK PASS: ${plan.pages.length} pages, signature ${id}`);
  return { ok: problems.length === 0, problems, id, pages: plan.pages.length };
}

const isMain = (() => { if (!process.argv[1]) return false; try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] !== undefined && !a[i + 1].startsWith('--') ? a[i + 1] : undefined; };
  // exit codes are set, not forced with process.exit, so the last printed line is never cut off on a pipe
  try {
    if (a.includes('--check') && opt('--check') && opt('--in')) process.exitCode = check(opt('--check'), opt('--in')).ok ? 0 : 1;
    else if (!a.includes('--check') && opt('--in') && opt('--out')) sealBuild({ inDir: opt('--in'), outDir: opt('--out'), register: opt('--register') || process.env.SIGN_SITE_REGISTER });
    else { console.error('usage: node seal-site.mjs --in <signed draft folder> --out <new folder>   or   --check <sealed folder> --in <signed draft folder>'); process.exitCode = 2; }
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`REFUSED: ${e.message}`);
    process.exitCode = 1;
  }
}
