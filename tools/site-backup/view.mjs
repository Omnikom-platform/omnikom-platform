// Open a backed-up page in a real browser window, fully OFFLINE (served from its HAR; the internet is blocked).
// Usage: node view.mjs --out <backup dir> [--page <path or slug>]   (default: home page)
//        node view.mjs --out <backup dir> --gallery                  writes <out>/index.html (screenshots + videos per page)
import fs from 'node:fs';
import path from 'node:path';
import { VIEWPORTS, parseArgs, readJson, loadPlaywright } from './lib.mjs';
// 5-H: the browser runs in a guarded temp folder and is closed when this script ends, on any path (it is headed and interactive)
import { guardedTempEnv, sweep } from '../proc-guard/index.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.out !== 'string') { console.error('usage: node view.mjs --out <backup dir> [--page <path or slug>] | --gallery'); process.exit(2); }
const OUT = path.resolve(args.out);
const R = readJson(path.join(OUT, 'report.json'), null);
if (!R) { console.error(`no report.json in ${OUT}`); process.exit(2); }
const pages = Object.values(R.pages);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

if (args.gallery) {
  const rows = pages.map((p) => `<section><h2>${esc(p.title || p.url)}</h2><p><code>${esc(new URL(p.url).pathname)}</code> ${p.ok ? '' : `<b>FAILED: ${esc(p.error)}</b>`}</p>
  <div class="row"><a href="pages/${p.slug}/desktop.png"><img loading="lazy" src="pages/${p.slug}/desktop.png" alt="desktop"></a>
  <a href="pages/${p.slug}/mobile.png"><img loading="lazy" class="m" src="pages/${p.slug}/mobile.png" alt="mobile"></a>
  <video controls preload="none" src="pages/${p.slug}/desktop.webm"></video><video class="m" controls preload="none" src="pages/${p.slug}/mobile.webm"></video></div></section>`).join('\n');
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Backup: ${esc(R.site)}</title>
<style>body{font:14px system-ui;margin:24px;background:#fafafa}section{background:#fff;border:1px solid #ddd;padding:12px;margin:0 0 16px}.row{display:flex;gap:12px;align-items:flex-start;overflow-x:auto}img{width:360px;max-height:600px;object-fit:cover;object-position:top}img.m{width:140px}video{width:360px}video.m{width:140px}</style>
<h1>Backup of ${esc(R.site)}</h1><p>${pages.length} pages · captured ${esc(R.startedAt)} → ${esc(R.finishedAt)} · open a live-like offline copy with <code>node view.mjs --out "${esc(OUT)}" --page /path</code></p>${rows}`);
  console.log(`wrote ${path.join(OUT, 'index.html')}`);
  process.exit(0);
}

const want = args.page || '/';
const p = pages.find((x) => x.slug === want || new URL(x.url).pathname === want);
if (!p) { console.error(`no captured page "${want}". Try one of: ${pages.slice(0, 10).map((x) => new URL(x.url).pathname).join(', ')}`); process.exit(2); }
const { chromium } = await loadPlaywright();
sweep();
const guard = guardedTempEnv('site-backup-', 'browser');
let browser;
try {
  browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop.viewport, serviceWorkers: 'block' });
  await ctx.routeFromHAR(path.join(OUT, 'pages', p.slug, 'capture.har.zip'), { notFound: 'abort' });
  const page = await ctx.newPage();
  await page.goto(p.url);
  console.log(`offline view of ${p.url}. Close the browser window to exit.`);
  await new Promise((r) => browser.on('disconnected', r));
} finally { try { if (browser) await browser.close(); } finally { guard.release(); } }
