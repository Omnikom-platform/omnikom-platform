// craft-lint: measures a RENDERED page against tools/design-engine/CRAFT.md (Omnikom design SOP; first run: ELEV8, 2026-10-27). Opens the page
// in a real Chromium at each viewport (default 1366x900, 1536x864, 390x844), settles it (#still, fonts, images), and checks what the
// eye would see, from computed styles and layout boxes, inside the scope (default `main`):
//   tokens   font-size, padding, margin-block, gap, border-radius, box-shadow must equal a :root token (--fs-*, --sp-*, --r-*, --sh-*),
//            each resolved at the current viewport (clamp() included) by a probe element
//   type     <= 3 families, <= 4 weights, phone body >= 16px, nothing under 11px, measure 45-80 chars (laptop), no orphan word in h1-h3
//   colour   text contrast >= 4.5:1 (>= 3:1 large) against the real solid background; text over an image is listed for an eye check
//   targets  phone: links, buttons, inputs, tabs >= 44x44, or >= 24 with 8px clear of every other target (WCAG 2.5.8)
//   family   <= 3 distinct radii (pills >= 999px and 50% circles exempt), <= 3 distinct shadows
//   images   no distortion: rendered ratio = natural ratio unless object-fit cover/contain
//   layout   no horizontal overflow; alignment lines per section (warning above 4 laptop / 2 phone)
// Usage: node tools/design-engine/craft-lint.mjs --root <dir> <page> [--viewports 1366x900,390x844] [--scope "main"] [--json out.json] [--max 12]
// Exit: 0 no errors (warnings allowed), 1 errors, 2 usage. Browser from ./lib/browser.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { lib } from './lib/browser.mjs';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const root = opt('root'), page = a.find((x, i) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
if (!root || !page) { console.error('usage: --root <dir> <page> [--viewports WxH,...] [--scope sel] [--json out] [--max n]'); process.exit(2); }
const VPS = opt('viewports', '1366x900,1536x864,390x844').split(',').map((v) => v.split('x').map(Number));
const SCOPE = opt('scope', 'main'), MAX = +opt('max', 12);

function audit({ scope, phone, max: MAX }) {
  const out = { errors: [], warns: [], eye: [], stats: {} };
  const err = (rule, el, msg) => out.errors.push({ rule, at: sel(el), msg });
  const warn = (rule, el, msg) => out.warns.push({ rule, at: sel(el), msg });
  function sel(el) { if (!el || !el.tagName) return String(el || ''); const p = []; let e = el; for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) { s += '#' + e.id; p.unshift(s); break; } const c = [...e.classList].slice(0, 2).join('.'); if (c) s += '.' + c; p.unshift(s); } return p.join(' > '); }
  // tokens from :root rules of same-origin sheets
  const tok = { fs: [], sp: [], r: [], sh: [] };
  for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; } for (const r of rules) { if (r.selectorText && /(^|,)\s*:root\s*($|,)/.test(r.selectorText)) for (const n of r.style) { const m = n.match(/^--(fs|sp|r|sh)-/); if (m) tok[m[1]].push(n); } } }
  const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0'; document.body.appendChild(probe);
  const resolve = (prop, v) => { probe.style[prop] = `var(${v})`; const cs = getComputedStyle(probe)[prop]; probe.style[prop] = ''; return cs; };
  const px = (s) => parseFloat(s) || 0;
  const fsSet = [...new Set(tok.fs.map((v) => px(resolve('fontSize', v))))].filter(Boolean);
  const spSet = [...new Set(tok.sp.map((v) => px(resolve('paddingLeft', v))))];
  const rSet = [...new Set(tok.r.map((v) => px(resolve('borderTopLeftRadius', v))))];
  const shSet = [...new Set(tok.sh.map((v) => resolve('boxShadow', v)))];
  probe.remove();
  out.stats.tokens = { fs: fsSet.map((x) => +x.toFixed(1)).sort((a, b) => a - b), sp: spSet.sort((a, b) => a - b), r: rSet, sh: shSet.length };
  if (!tok.fs.length) err('tokens', document.documentElement, 'no --fs-* type tokens on :root (CRAFT.md 1)');
  if (!tok.sp.length) err('tokens', document.documentElement, 'no --sp-* space tokens on :root (CRAFT.md 1)');
  const near = (v, set, t = 0.6) => set.some((s) => Math.abs(s - v) <= t);
  const okSpace = (v) => v <= 2 || near(v, spSet);
  const sc = document.querySelector(scope) || document.body;
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.01; };
  const els = [...sc.querySelectorAll('*')].filter(visible);
  const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  const fams = new Map(), wts = new Map(), radii = new Map(), shadows = new Map();
  const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return { L: 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b), a, rgb: [r, g, b] }; };
  // text drawn over a photo (an <img>/<video>/<canvas> layer under it, not a CSS background) is an eye check, not a colour sum
  const overMedia = (el) => { const r = el.getBoundingClientRect(), x = r.left + Math.min(r.width / 2, 40), y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) { el.scrollIntoView({ block: 'center' }); }
    const r2 = el.getBoundingClientRect(); const stack = document.elementsFromPoint(r2.left + Math.min(r2.width / 2, 40), r2.top + r2.height / 2);
    const i = stack.indexOf(el); return stack.slice(i + 1).find((s) => /^(IMG|VIDEO|CANVAS|PICTURE)$/.test(s.tagName)) || null; };
  const bgOf = (el) => { const m = overMedia(el); if (m) return { image: true, at: m }; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none') return { image: true, at: e }; const c = lum(cs.backgroundColor); if (c && c.a > 0.5) return c; } return lum('rgb(255,255,255)'); };
  const counts = { tokenFs: 0, tokenSp: 0 };
  for (const el of els) {
    const cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
    if (['svg', 'path', 'g', 'circle', 'rect', 'text', 'line', 'polyline', 'ellipse', 'use', 'defs', 'filter', 'br', 'script', 'style'].includes(tag)) continue;
    const isText = directText(el);
    if (isText) {
      const fsz = px(cs.fontSize);
      fams.set(cs.fontFamily.split(',')[0].trim().replace(/["']/g, ''), sel(el)); wts.set(cs.fontWeight, sel(el));
      if (fsSet.length && !near(fsz, fsSet)) { counts.tokenFs++; if (counts.tokenFs <= MAX) err('token-type', el, `font-size ${fsz}px is not a --fs-* token (${out.stats.tokens.fs.join('/')})`); }
      if (fsz < 11) err('min-size', el, `text ${fsz}px < 11px`);
      if (phone && ['p', 'li', 'dd', 'td'].includes(tag) && fsz < 16) err('phone-body', el, `body text ${fsz}px < 16px on phone`);
      if (cs.textTransform === 'uppercase' && fsz < 11) err('min-size', el, `uppercase ${fsz}px < 11px`);
      const bg = bgOf(el), fg = lum(cs.color);
      if (bg.image) out.eye.push({ rule: 'contrast-on-image', at: sel(el), msg: `text over a background image (${sel(bg.at)}): check the scrim by eye` });
      else if (fg) { const hi = Math.max(fg.L, bg.L), lo = Math.min(fg.L, bg.L), ratio = (hi + 0.05) / (lo + 0.05), large = fsz >= 24 || (fsz >= 18.66 && +cs.fontWeight >= 700), need = large ? 3 : 4.5;
        if (ratio < need) err('contrast', el, `contrast ${ratio.toFixed(2)}:1 < ${need}:1 (${cs.color} on rgb(${bg.rgb.join(',')}), ${fsz}px)`); }
    }
    if (!['html', 'body'].includes(tag)) {
      for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
        const v = px(cs[p]); if (v && !okSpace(v)) { counts.tokenSp++; if (counts.tokenSp <= MAX) err('token-space', el, `${p} ${v}px is not a --sp-* token (${spSet.join('/')})`); }
      }
    }
    const rad = px(cs.borderTopLeftRadius); const r = el.getBoundingClientRect();
    if (rad > 0 && rad < 999 && !(Math.abs(rad - r.width / 2) < 1 && Math.abs(r.width - r.height) < 2)) radii.set(rad, sel(el));
    if (cs.boxShadow && cs.boxShadow !== 'none') shadows.set(cs.boxShadow, sel(el));
    if (tag === 'img' && el.naturalWidth) { const fit = cs.objectFit, nr = el.naturalWidth / el.naturalHeight, rr = r.width / r.height; if (fit === 'fill' && Math.abs(nr - rr) / nr > 0.02) err('distortion', el, `image stretched: natural ${nr.toFixed(2)} vs rendered ${rr.toFixed(2)}`); }
    if (tag === 'p' && !phone && (el.textContent || '').trim().length > 140) { const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.5, lines = Math.max(1, Math.round(r.height / lh)), cpl = el.textContent.trim().length / lines;
      if (lines > 1 && (cpl > 85 || cpl < 35)) (cpl > 95 ? err : warn)('measure', el, `about ${Math.round(cpl)} characters per line (45-80)`); }
    if (/^h[1-3]$/.test(tag)) { const words = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const t = n.textContent; const re = /\S+/g; let m; while ((m = re.exec(t))) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); const rc = rg.getClientRects()[0]; if (rc) words.push(Math.round(rc.top)); } }
      const tops = [...new Set(words)]; if (tops.length > 1) { const last = Math.max(...tops); if (words.filter((t) => Math.abs(t - last) < 3).length === 1) err('orphan', el, `heading ends with one word alone on its last line ("${el.textContent.trim().split(/\s+/).pop()}")`); } }
  }
  if (counts.tokenFs > MAX) out.errors.push({ rule: 'token-type', at: '(more)', msg: `${counts.tokenFs - MAX} more off-scale font sizes` });
  if (counts.tokenSp > MAX) out.errors.push({ rule: 'token-space', at: '(more)', msg: `${counts.tokenSp - MAX} more off-scale spacings` });
  if (fams.size > 3) err('families', document.documentElement, `${fams.size} font families: ${[...fams.keys()].join(', ')}`);
  if (wts.size > 4) warn('weights', document.documentElement, `${wts.size} font weights in use: ${[...wts.keys()].join(', ')}`);
  if (radii.size > 3) err('radius-family', document.documentElement, `${radii.size} distinct radii: ${[...radii.keys()].sort((a, b) => a - b).join(', ')}px (<= 3)`);
  if (shadows.size > 3) err('shadow-family', document.documentElement, `${shadows.size} distinct shadows (<= 3)`);
  if (document.documentElement.scrollWidth > innerWidth + 1) err('overflow', document.documentElement, `page is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px viewport`);
  if (phone) { const T = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=tab]')].filter(visible).map((e) => ({ e, r: e.getBoundingClientRect() }));
    for (const t of T) { const { width: w, height: h } = t.r; if (w >= 44 && h >= 44) continue; if (Math.min(w, h) < 24) { err('tap-target', t.e, `${Math.round(w)}x${Math.round(h)}px < 24px`); continue; }
      const crowd = T.some((o) => o !== t && !t.e.contains(o.e) && !o.e.contains(t.e) && o.r.left < t.r.right + 8 && o.r.right > t.r.left - 8 && o.r.top < t.r.bottom + 8 && o.r.bottom > t.r.top - 8);
      if (crowd) err('tap-target', t.e, `${Math.round(w)}x${Math.round(h)}px < 44px with another target within 8px`); } }
  for (const s of (sc.matches('main') ? sc.querySelectorAll(':scope > section') : [sc])) { const xs = [...s.querySelectorAll('h1,h2,h3,h4,p,img,figure,article,form,ol,ul')].filter(visible).filter((e) => !e.closest('nav')).map((e) => Math.round(e.getBoundingClientRect().left));
    const lines = []; for (const x of xs.sort((a, b) => a - b)) if (!lines.some((l) => Math.abs(l - x) <= 3)) lines.push(x);
    if (lines.length > (phone ? 2 : 4)) warn('alignment', s, `${lines.length} distinct left edges (${lines.slice(0, 8).join(', ')}): fewer alignment lines read more designed`); }
  out.stats.families = [...fams.keys()]; out.stats.radii = [...radii.keys()]; out.stats.shadows = shadows.size;
  return out;
}

const R = path.resolve(root), { server, port } = await lib.serve(R);
const browser = await lib.launch();
let total = 0; const report = [];
try {
  for (const [w, h] of VPS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    await pg.goto(lib.urlFor(port, R, path.resolve(R, page)) + '#still', { waitUntil: 'networkidle', timeout: 60000 });
    await pg.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))); });
    const r = await pg.evaluate(audit, { scope: SCOPE, phone: w < 600, max: MAX });
    report.push({ viewport: `${w}x${h}`, ...r });
    total += r.errors.length;
    console.log(`\n== ${w}x${h}: ${r.errors.length} errors, ${r.warns.length} warnings, ${r.eye.length} eye checks · tokens fs ${r.stats.tokens.fs.length} sp ${r.stats.tokens.sp.length} · families ${r.stats.families.join(' / ')}`);
    const byRule = {}; for (const e of r.errors) (byRule[e.rule] ||= []).push(e);
    for (const [rule, es] of Object.entries(byRule)) { console.log(`  ERROR ${rule} (${es.length})`); for (const e of es.slice(0, 5)) console.log(`    ${e.at}: ${e.msg}`); }
    for (const wv of r.warns.slice(0, 6)) console.log(`  warn  ${wv.rule}: ${wv.at}: ${wv.msg}`);
    if (r.eye.length) console.log(`  eye   ${r.eye.length} text-over-image spots to check by eye`);
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(report, null, 1));
console.log(`\nCRAFT-LINT ${total ? 'FAIL' : 'PASS'}: ${total} errors across ${VPS.length} viewports`);
process.exit(total ? 1 : 0);
