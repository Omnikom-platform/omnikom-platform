// craft-lint: measures a RENDERED page against tools/design-engine/CRAFT.md (Omnikom design SOP; first run: Example A, 2026-10-27). Opens the page
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
// Ported from tasteskill (github.com/Leonxlnx/taste-skill, MIT, v2.1.5 read 2026-10-28; CRAFT.md 10), with its false positives on Example A fixed:
//   edge-text      text inside the viewport within 16px of its left/right edge (sideways scrollers exempt: CRAFT 8 wants a peek)
//   broken-image   an <img> that finished loading with no pixels
//   covered-text   at every screen-height scroll stop, text under another painted element (fixed/sticky bars exempt: content
//                  passes under them by design; clipped and screen-reader-only text exempt)
//   reduced-hidden text that becomes visible while scrolling with motion on but never with prefers-reduced-motion (two extra loads,
//                  no #still); text hidden in both (tab-swapped labels) is not reported
//   warnings     first-action (no filled control >= 44px on the first screen), off-centre margins, display headline over 2 lines,
//                tells (gradient text, mono labels, eyebrows above headings, mixed-face headlines, em-dash habit, genre buzzwords,
//                "not just X, it's Y", emoji as icons): advisory, never errors
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
  // color-mix() computes to `color(srgb r g b / a)` with channels 0-1, not 0-255 (2026-10-27: read as near-black, false 1.14:1 failures)
  const lum = (c) => { const fn = /^color\(srgb\s/.test(c); const m = c.replace(/^color\(srgb/, '').match(/[\d.]+/g); if (!m) return null; let [r, g, b, a = 1] = m.map(Number); if (fn) { r *= 255; g *= 255; b *= 255; } const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return { L: 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b), a, rgb: [r, g, b] }; };
  // text drawn over a photo (an <img>/<video>/<canvas> layer under it, not a CSS background) is an eye check, not a colour sum
  const overMedia = (el) => { const r = el.getBoundingClientRect(), x = r.left + Math.min(r.width / 2, 40), y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) { el.scrollIntoView({ block: 'center' }); }
    const r2 = el.getBoundingClientRect(); const stack = document.elementsFromPoint(r2.left + Math.min(r2.width / 2, 40), r2.top + r2.height / 2);
    const i = stack.indexOf(el); return stack.slice(i + 1).find((s) => /^(IMG|VIDEO|CANVAS|PICTURE)$/.test(s.tagName)) || null; };
  const bgOf = (el) => { const m = overMedia(el); if (m) return { image: true, at: m }; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none') return { image: true, at: e }; const c = lum(cs.backgroundColor); if (c && c.a > 0.5) return c; } return lum('rgb(255,255,255)'); };
  const counts = { tokenFs: 0, tokenSp: 0 };
  // tasteskill ports (CRAFT.md 10): helpers, then the first-screen action before anything scrolls
  const inScroller = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) return true; } return false; };
  const textRects = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).flatMap((n) => { const rg = document.createRange(); rg.selectNodeContents(n); return [...rg.getClientRects()].filter((rc) => rc.width > 1); });
  const srOnly = (el) => { for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) { const c = getComputedStyle(e), r = e.getBoundingClientRect(); if (c.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(c.clipPath) || (r.width <= 2 && r.height <= 2)) return true; } return false; };
  const tells = { gradient: [], mono: [], eyebrow: [], mixed: [] };
  scrollTo(0, 0);
  const action = [...document.querySelectorAll('a[href], button, input[type=submit]')].filter(visible).find((e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.top < innerHeight && r.bottom > 0 && r.height >= 44 && ((lum(c.backgroundColor)?.a || 0) > 0.5 || px(c.borderTopWidth) >= 1); });
  if (!action) warn('first-action', document.body, 'no filled or outlined control >= 44px tall on the first screen: give the one primary action a real button');
  for (const el of els) {
    const cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
    if (['svg', 'path', 'g', 'circle', 'rect', 'text', 'line', 'polyline', 'ellipse', 'use', 'defs', 'filter', 'br', 'script', 'style'].includes(tag)) continue;
    const isText = directText(el);
    if (isText) {
      const fsz = px(cs.fontSize);
      fams.set(cs.fontFamily.split(',')[0].trim().replace(/["']/g, ''), sel(el)); wts.set(cs.fontWeight, sel(el));
      if (fsSet.length && !near(fsz, fsSet)) { counts.tokenFs++; if (counts.tokenFs <= MAX) err('token-type', el, `font-size ${fsz}px is not a --fs-* token (${out.stats.tokens.fs.join('/')})`); }
      if (fsz < 11) err('min-size', el, `text ${fsz}px < 11px`);
      // uppercase tracked text is a label (CRAFT 3: >= 11 px, checked below), not body copy
      if (phone && ['p', 'li', 'dd', 'td'].includes(tag) && fsz < 16 && cs.textTransform !== 'uppercase') err('phone-body', el, `body text ${fsz}px < 16px on phone`);
      if (cs.textTransform === 'uppercase' && fsz < 11) err('min-size', el, `uppercase ${fsz}px < 11px`);
      const bg = bgOf(el), fg = lum(cs.color);
      if (bg.image) out.eye.push({ rule: 'contrast-on-image', at: sel(el), msg: `text over a background image (${sel(bg.at)}): check the scrim by eye` });
      else if (fg) { const hi = Math.max(fg.L, bg.L), lo = Math.min(fg.L, bg.L), ratio = (hi + 0.05) / (lo + 0.05), large = fsz >= 24 || (fsz >= 18.66 && +cs.fontWeight >= 700), need = large ? 3 : 4.5;
        if (ratio < need) err('contrast', el, `contrast ${ratio.toFixed(2)}:1 < ${need}:1 (${cs.color} on rgb(${bg.rgb.join(',')}), ${fsz}px)`); }
      // CRAFT 2: content never touches the viewport edge (only text wholly on screen; a carousel's cut-off card is CRAFT 8's peek)
      const edge = textRects(el).find((rc) => rc.left >= 0 && rc.right <= innerWidth && (rc.left < 16 || innerWidth - rc.right < 16));
      if (edge && !inScroller(el) && !srOnly(el)) err('edge-text', el, `text ${Math.round(Math.min(edge.left, innerWidth - edge.right))}px from the screen edge ("${el.textContent.trim().slice(0, 40)}"): keep >= 16px`);
      const fam = cs.fontFamily.split(',')[0].trim().replace(/["']/g, ''), t40 = el.textContent.trim().slice(0, 40);
      if ((cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') && cs.backgroundImage.includes('gradient')) tells.gradient.push(t40);
      if (/mono|courier|consolas|menlo/i.test(fam) && !el.closest('pre, code, kbd, samp')) tells.mono.push(t40);
      if (cs.textTransform === 'uppercase' && fsz <= 14 && px(cs.letterSpacing) / fsz >= 0.05 && /^H[1-3]$/.test(el.nextElementSibling?.tagName || '')) tells.eyebrow.push(t40);
    }
    if (!['html', 'body'].includes(tag)) {
      for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
        const v = px(cs[p]); if (v && !okSpace(v)) { counts.tokenSp++; if (counts.tokenSp <= MAX) err('token-space', el, `${p} ${v}px is not a --sp-* token (${spSet.join('/')})`); }
      }
    }
    // a % radius computes as "50%", not px: >= 50% is a circle or pill (exempt), a smaller % is converted against the short side
    const r = el.getBoundingClientRect(), rRaw = cs.borderTopLeftRadius; let rad = px(rRaw);
    if (rRaw.includes('%')) rad = rad >= 50 ? 1000 : (rad / 100) * Math.min(r.width, r.height);
    if (rad > 0 && rad < 999 && !(Math.abs(rad - r.width / 2) < 1 && Math.abs(r.width - r.height) < 2)) radii.set(rad, sel(el));
    if (cs.boxShadow && cs.boxShadow !== 'none') shadows.set(cs.boxShadow, sel(el));
    if (tag === 'img' && el.complete && !el.naturalWidth && (el.currentSrc || el.getAttribute('src'))) err('broken-image', el, `image did not load: ${el.currentSrc || el.getAttribute('src')}`);
    if (tag === 'img' && el.naturalWidth) { const fit = cs.objectFit, nr = el.naturalWidth / el.naturalHeight, rr = r.width / r.height; if (fit === 'fill' && Math.abs(nr - rr) / nr > 0.02) err('distortion', el, `image stretched: natural ${nr.toFixed(2)} vs rendered ${rr.toFixed(2)}`); }
    if (tag === 'p' && !phone && (el.textContent || '').trim().length > 140) { const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.5, lines = Math.max(1, Math.round(r.height / lh)), cpl = el.textContent.trim().length / lines;
      if (lines > 1 && (cpl > 85 || cpl < 35)) (cpl > 95 ? err : warn)('measure', el, `about ${Math.round(cpl)} characters per line (45-80)`); }
    // a button-like control (a box with a fill or border) whose label breaks onto two lines (2026-10-27: "Get my home / value" passed every rule)
    if (isText && (['a', 'button', 'summary'].includes(tag) || el.getAttribute('role') === 'tab') && /flex|grid|inline-block/.test(cs.display)
      && ((lum(cs.backgroundColor)?.a || 0) > 0.05 || px(cs.borderTopWidth) > 0 || px(cs.borderBottomWidth) > 0)) {
      const tops = new Set(); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) { const rg = document.createRange(); rg.selectNodeContents(n); for (const rc of rg.getClientRects()) if (rc.width > 1) tops.add(Math.round(rc.top / 4)); }
      if (tops.size > 1) err('label-wrap', el, `control label wraps onto ${tops.size} lines ("${el.textContent.trim().slice(0, 40)}"): use white-space: nowrap or a shorter label`);
    }
    if (/^h[1-3]$/.test(tag)) { const words = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const t = n.textContent; const re = /\S+/g; let m; while ((m = re.exec(t))) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); const rc = rg.getClientRects()[0]; if (rc) words.push(Math.round(rc.top)); } }
      const tops = [...new Set(words)]; if (tops.length > 1) { const last = Math.max(...tops); if (words.filter((t) => Math.abs(t - last) < 3).length === 1) err('orphan', el, `heading ends with one word alone on its last line ("${el.textContent.trim().split(/\s+/).pop()}")`); }
      const lines = tops.filter((t, i) => !tops.slice(0, i).some((u) => Math.abs(u - t) < 3)).length;
      if (px(cs.fontSize) >= 40 && lines > 2) warn('headline-lines', el, `display headline sets on ${lines} lines: about 5 words / 32 characters holds two lines at every width`);
      const face = (c) => `${c.fontFamily.split(',')[0]}|${c.fontStyle}`;
      if ([...el.querySelectorAll('*')].some((d) => d.textContent.trim() && face(getComputedStyle(d)) !== face(cs))) tells.mixed.push(el.textContent.trim().slice(0, 40)); }
  }
  // tells: advisory (CRAFT.md 10). Owner-approved directions may keep them; the warning asks for the reason, it never fails the page
  const tellMsg = { gradient: 'gradient-filled text', mono: 'monospace outside code', eyebrow: 'small tracked uppercase label right above a heading', mixed: 'headline switches face or to italic mid-line' };
  for (const [k, list] of Object.entries(tells)) if (list.length) warn(`tell-${k}`, document.documentElement, `${list.length}x ${tellMsg[k]} (e.g. "${list[0]}")`);
  const copy = sc.innerText || '';
  const dashes = (copy.match(/—/g) || []).length; if (dashes > 2) warn('tell-em-dash', sc, `${dashes} em dashes: keep one or two a page; use a full stop or a comma`);
  const buzz = [...new Set((copy.match(/\b(unlock|supercharge|seamless(ly)?|elevat(e|es|ed|ing)|effortless(ly)?|cutting-edge|all-in-one|game[- ]chang(er|ing)|revolutioni[sz]e|unleash|next-level|world-class|best-in-class)\b/gi) || []).map((w) => w.toLowerCase()))];
  if (buzz.length) warn('tell-buzzword', sc, `genre words: ${buzz.join(', ')}`);
  if (/\bnot just\b[^.!?]{0,60}\b(it'?s|it is|but)\b/i.test(copy)) warn('tell-not-just', sc, 'the "not just X, it\'s Y" correction');
  const emoji = els.filter((e) => directText(e) && /^\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*$/u.test(e.textContent.trim()));
  if (emoji.length) warn('tell-emoji', emoji[0], `${emoji.length} emoji used as icons or bullets`);
  // one pair of page margins: the leftmost and rightmost text blocks (not in a sideways scroller) sit equally far in. Images are left out:
  // CRAFT 7 lets them bleed to an edge on purpose (Example A laptop: a photo at 0px read as "0px from the left", 2026-10-28)
  const box = els.filter((e) => directText(e) && !inScroller(e)).map((e) => e.getBoundingClientRect()).filter((r) => r.left >= 0 && r.right <= innerWidth && r.width < innerWidth - 2);
  if (box.length) { const L = Math.min(...box.map((r) => r.left)), Rm = innerWidth - Math.max(...box.map((r) => r.right)); if (Math.abs(L - Rm) > 32) warn('off-centre', sc, `content sits ${Math.round(L)}px from the left and ${Math.round(Rm)}px from the right: give the page one pair of margins`); }
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

// covered-text (tasteskill port): one stop per screen height; hit-test 3 points per line of text. pointer-events is forced on while
// sampling, or an overlay with pointer-events:none would look like it is underneath
async function coverPass({ scope }) {
  const sel = (el) => { const p = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) { let s = e.tagName.toLowerCase(); if (e.id) { p.unshift(s + '#' + e.id); break; } const c = [...e.classList].slice(0, 2).join('.'); p.unshift(c ? s + '.' + c : s); } return p.join(' > '); };
  const pinned = (n) => { for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const alpha = (c) => { const m = c.match(/[\d.]+/g); return !m ? 0 : m.length < 4 ? 1 : +m[3]; };
  // does the element on top paint anything at (x, y)? a transparent box does not; its own text counts only where that text is
  const paints = (hit, el, x, y) => { for (let p = hit; p && p.nodeType === 1 && !p.contains(el); p = p.parentElement) {
    if (/^(IMG|VIDEO|CANVAS|PICTURE|SVG)$/i.test(p.tagName)) return true;
    const c = getComputedStyle(p); if (c.backgroundImage !== 'none' || alpha(c.backgroundColor) > 0.05) return true;
    for (const ps of ['::before', '::after']) { const q = getComputedStyle(p, ps); if (q.content !== 'none' && (q.backgroundImage !== 'none' || alpha(q.backgroundColor) > 0.05)) return true; }
    if (p === hit) for (const n of p.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); if ([...rg.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return true; } }
    return false; };
  const hiddenText = (el) => { for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) { const c = getComputedStyle(e), r = e.getBoundingClientRect(); if (c.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(c.clipPath) || (r.width <= 2 && r.height <= 2)) return true; } return false; };
  const clipped = (el, x, y) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const c = getComputedStyle(e); if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const r = e.getBoundingClientRect(); if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true; } } return false; };
  const st = document.createElement('style'); st.textContent = '*, *::before, *::after { pointer-events: auto !important; }'; document.head.appendChild(st);
  const sc = document.querySelector(scope) || document.body, out = [], done = new Set(), H = innerHeight;
  for (let y = 0; y < document.documentElement.scrollHeight; y += H) {
    scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const el of sc.querySelectorAll('*')) {
      if (done.has(el)) continue;
      const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length > 2); if (!texts.length) continue;
      // a closed <details> still lays its content out, unpainted, over what follows (Example A phone footer, 2026-10-28: 4 false errors on v4
      // and v2, 0 after): checkVisibility() knows. Not reproduced in a fixture (two tries), so the Example A run is its only proof
      const cs = getComputedStyle(el); if (!el.checkVisibility() || cs.visibility === 'hidden' || +cs.opacity < 0.3 || pinned(el) || hiddenText(el)) continue;
      // lines of one heading or link set as separate spans overlap each other's boxes: not a collision
      const unit = el.closest('h1, h2, h3, h4, h5, h6, p, li, a, button, label');
      let tot = 0, hid = 0, by = null;
      for (const n of texts) { const rg = document.createRange(); rg.selectNodeContents(n);
        for (const rc of rg.getClientRects()) { if (rc.width < 6) continue;
          for (const fx of [0.15, 0.5, 0.85]) { const x = rc.left + rc.width * fx, yy = rc.top + rc.height / 2; if (x < 0 || x >= innerWidth || yy < 0 || yy >= H || clipped(el, x, yy)) continue;
            tot++; const hit = document.elementFromPoint(x, yy);
            if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(unit && unit.contains(hit) && !/^(IMG|VIDEO|CANVAS|PICTURE)$/.test(hit.tagName)) && !pinned(hit) && paints(hit, el, x, yy)) { hid++; by = hit; } } } }
      if (tot >= 3 && hid / tot >= 0.2) { done.add(el); out.push({ rule: 'covered-text', at: sel(el), msg: `"${el.textContent.trim().slice(0, 40)}" lies under ${sel(by)} at scroll ${y}px (${Math.round((100 * hid) / tot)}% of samples)` }); }
    }
  }
  st.remove(); scrollTo(0, 0); return out;
}
// reduced-hidden (tasteskill port): scroll every screen, note each text element that is ever visible. Run once with motion on and once
// with prefers-reduced-motion; text seen only with motion is content a reduced-motion visitor never gets
async function seenPass({ scope, dwell }) {
  const sc = document.querySelector(scope) || document.body, all = [...sc.querySelectorAll('*')], ever = new Map(), H = innerHeight;
  const op = (e) => { let o = 1; for (; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  for (let y = 0; ; y += H) {
    scrollTo(0, y); await new Promise((r) => setTimeout(r, dwell));
    all.forEach((e, i) => { if (ever.has(i) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) return;
      const r = e.getBoundingClientRect(), c = getComputedStyle(e); if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > H || c.visibility === 'hidden' || op(e) < 0.1) return;
      ever.set(i, `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}: "${e.textContent.trim().slice(0, 40)}"`); });
    if (y + H >= document.documentElement.scrollHeight) break;
  }
  scrollTo(0, 0); return { n: all.length, ever: [...ever] };
}

const R = path.resolve(root), { server, port } = await lib.serve(R);
const browser = await lib.launch();
let total = 0; const report = [];
try {
  for (const [w, h] of VPS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    await pg.goto(lib.urlFor(port, R, path.resolve(R, page)) + '#still', { waitUntil: 'networkidle', timeout: 60000 });
    // a hidden <img loading="lazy"> never loads, so its promise never settled and the lint hung forever (2026-10-27): load lazy images
    // eagerly and cap the wait per image
    await pg.evaluate(async () => { await document.fonts.ready; for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = 'eager';
      await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); }))); });
    const r = await pg.evaluate(audit, { scope: SCOPE, phone: w < 600, max: MAX });
    r.errors.push(...await pg.evaluate(coverPass, { scope: SCOPE }));
    const seen = {};
    for (const motion of ['no-preference', 'reduce']) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: motion }), p2 = await c2.newPage();
      await p2.goto(lib.urlFor(port, R, path.resolve(R, page)), { waitUntil: 'networkidle', timeout: 60000 });
      await p2.evaluate(async () => { await document.fonts.ready; await new Promise((ok) => setTimeout(ok, 800)); });
      seen[motion] = await p2.evaluate(seenPass, { scope: SCOPE, dwell: 350 }); await c2.close();
    }
    if (seen.reduce.n !== seen['no-preference'].n) r.warns.push({ rule: 'reduced-hidden', at: '(page)', msg: `DOM differs between the motion and reduced-motion loads (${seen['no-preference'].n} vs ${seen.reduce.n} elements): not compared` });
    else { const red = new Set(seen.reduce.ever.map(([i]) => i)); for (const [i, what] of seen['no-preference'].ever) if (!red.has(i)) r.errors.push({ rule: 'reduced-hidden', at: what, msg: 'visible with motion on, never visible with prefers-reduced-motion: put the hidden start state inside @media (prefers-reduced-motion: no-preference)' }); }
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
