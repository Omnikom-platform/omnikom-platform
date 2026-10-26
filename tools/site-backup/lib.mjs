// Shared helpers for backup.mjs / verify.mjs / view.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

export const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// Plain requests (fetch, curl) say honestly what they are (CLAUDE.md: never disguise a tool). A contact address is added
// only when one is configured: SITE_BACKUP_CONTACT in the environment or "config": {"contact": "..."} in this folder's
// package.json; it is never hard-coded here. The browser contexts below keep their VIEWPORTS settings.
const contact = (() => {
  if (process.env.SITE_BACKUP_CONTACT) return process.env.SITE_BACKUP_CONTACT.trim();
  try { return String(JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))?.config?.contact || '').trim(); } catch { return ''; }
})();
export const TOOL_UA = `OmnikomSiteBackup/1.0 (read-only website backup${contact ? `; +${contact}` : ''})`;
export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, userAgent: UA_DESKTOP, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, userAgent: UA_MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
// A page title that looks like a file or a script fragment means the page list is wrong (the old tool's bug).
export const JUNK_TITLE = /(\.(woff2?|ttf|otf|eot|css|js|mjs|png|jpe?g|gif|svg|webp|json|xml)$)|^\+|^[a-z]$/i;
export const CHALLENGE_TITLE = /just a moment|attention required|verify you are human|access denied/i;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const h8 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// '/' -> 'home'; '/blog/my-post' -> 'blog__my-post'. Deterministic, filesystem-safe.
export function slugFor(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  if (!segs.length) return 'home';
  const s = segs.map((x) => decodeURIComponent(x).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')).join('__');
  return s.length > 120 ? `${s.slice(0, 100)}__${h8(s)}` : s;
}

// A sitemap <loc> as a URL. XML may write "&" as &amp;, &#38; or &#x26; (elev8ca.com uses &#38;, 2026-10-26: decoding only
// &amp; cut its search URLs at "#38;"). Every numeric and the five named entities are decoded.
export function decodeXmlUrl(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n]);
}

// Runs inside the page (page.evaluate): how many visible loading placeholders are on screen. A loader is a visible element
// with a skeleton/spinner/loading class or aria-busy that is still EMPTY: under 20 characters of text and no loaded image.
// elev8ca.com (2026-10-26, gap G-R-4) leaves the class "loading" on finished listing cards (text + photo), which kept the
// phone pass "unsettled" for 60 s. Proof: test-loaders.mjs (fixtures, no network).
export function countLoaders() {
  const visible = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0; };
  const hasContent = (e) => (e.innerText || '').trim().length >= 20 || [...e.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth > 0);
  return [...document.querySelectorAll('[class*=skeleton i], [class*=spinner i], [class*=loading i], [aria-busy=true]')].filter((e) => visible(e) && !hasContent(e)).length;
}

// URLs whose every entry in a capture.har.zip has no answer (status <= 0). elev8ca.com (2026-10-26): two Brivity stylesheets
// answer 403 live, the browser drops the body, the HAR keeps status -1, and routeFromHAR then holds the replay forever
// (G4 "load" timeout on 12 pages). The replay aborts these, as the live load effectively did. Windows tar reads the zip;
// without it the set is empty and the replay behaves as before.
export function harUnanswered(harZip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'har-'));
  try {
    const tar = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar';
    const r = spawnSync(tar, ['-xf', harZip, '-C', tmp], { timeout: 120000 });
    const file = path.join(tmp, 'har.har');
    if (r.status !== 0 || !fs.existsSync(file)) return new Set();
    const byUrl = new Map();
    for (const e of JSON.parse(fs.readFileSync(file, 'utf8')).log.entries) {
      const u = normUrl(e.request.url);
      byUrl.set(u, (byUrl.get(u) ?? true) && !(e.response.status > 0));
    }
    return new Set([...byUrl].filter(([, none]) => none).map(([u]) => u));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// One spelling per URL, so "https://site.com" and "https://site.com/" compare equal.
export const normUrl = (s) => { try { return new URL(s).href; } catch { return String(s); } };

// The folder name of a captured page. A query gets a readable start plus a hash of the whole query: elev8ca.com's four
// search URLs all end in "q_offset=0", so the old "last 12 characters" name gave all four the same folder.
export function pageSlug(url, kind = 'page') {
  const u = new URL(url);
  const q = u.search ? `__q${u.search.replace(/[^a-z0-9]+/gi, '-').slice(0, 24).replace(/-+$/, '')}-${h8(u.search)}` : '';
  return (kind === 'sample' ? 'sample__' : '') + slugFor(u.pathname) + q;
}

// Local path for a captured asset URL: assets/<host>/<path>[__<queryhash>]
export function assetFileFor(outDir, urlStr) {
  const u = new URL(urlStr);
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index';
  const segs = p.split('/').filter((s) => s && s !== '.' && s !== '..').map((s) => s.replace(/[<>:"|?*\\]/g, '_').slice(0, 120));
  if (!segs.length) segs.push('index');
  if (u.search) segs[segs.length - 1] += `__${h8(u.search)}`;
  return path.join(outDir, 'assets', u.host.replace(/[:]/g, '_'), ...segs);
}

export function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function loadPlaywright() {
  return import('playwright');
}
