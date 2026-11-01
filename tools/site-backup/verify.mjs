// Independent check of a backup made by backup.mjs. Exit 0 = every hard gate passed, 1 = something failed.
//
// Usage: node verify.mjs --out <backup dir> [--no-replay] [--min-text 0.9]
//
// It deliberately does not trust report.json for the answers:
//  G1 page set   re-reads the live sitemaps itself and compares with what is on disk
//  G2 titles     reads <title> from each saved rendered.html file; rejects junk (font/file names) and challenges
//  G3 files      every page has raw.html, rendered.html, desktop/mobile .png and .webm, above minimum sizes
//  G4 replay     re-opens every page OFFLINE from its HAR (all network blocked) and compares title + text length
//  G5 videos     every <video> source seen on a page was saved whole (not a 206 fragment)
//  G6 loaded     at capture time every image finished, no spinner was showing, no "something went wrong"
//  G7 extras     sitemaps, raw-variant HTML and WordPress REST data saved; every published WP page/post captured or excluded
import fs from 'node:fs';
import path from 'node:path';
import { JUNK_TITLE, CHALLENGE_TITLE, VIEWPORTS, TOOL_UA, parseArgs, readJson, slugFor, pageSlug, decodeXmlUrl, normUrl, harUnanswered, loadPlaywright } from './lib.mjs';
// 5-H: the replay browser runs in a guarded temp folder and is closed on every path (it had no finally)
import { guardedTempEnv, sweep } from '../proc-guard/index.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.out !== 'string') { console.error('usage: node verify.mjs --out <backup dir> [--no-replay] [--min-text 0.9]'); process.exit(2); }
const OUT = path.resolve(args.out);
const R = readJson(path.join(OUT, 'report.json'), null);
if (!R) { console.error(`no report.json in ${OUT}`); process.exit(2); }
const MIN_TEXT = +(args['min-text'] || 0.9);
const results = { G1: [], G2: [], G3: [], G4: [], G5: [], G6: [], G7: [] };
const fail = (g, msg) => results[g].push(msg);

// ---- G1: page set, from the live sitemaps (own parser, not backup.mjs's) ----
const ua = { headers: { 'user-agent': TOOL_UA } };   // an honest agent, never a browser's
// Politeness (CLAUDE.md rule 3; Lead decision 2026-10-23): ONE 429 allowance for the whole verify run, shared by every
// sitemap. The first 429 anywhere: wait 90 s, ask that sitemap once more, and the rest of the run goes slower (15 s between
// requests, no extra tries after other errors). A second 429 anywhere: no more requests at all from this run.
// Before any 429, other failures (a dropped connection, a 5xx) get up to 3 tries with a growing pause. 60 s per request.
const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));
let seen429 = 0, stopped429 = false, lastReq = 0;
const getXml = async (u) => {
  if (stopped429) { fail('G1', `sitemap ${u} not read: the site already answered 429 twice in this run`); return ''; }
  if (!u) { fail('G1', 'the backup recorded no sitemap (report.json discovery); page-set check not possible'); return ''; }
  for (let i = 1; i <= 3; i++) {
    if (seen429) { const w = lastReq + 15000 - Date.now(); if (w > 0) await sleepMs(w); }
    lastReq = Date.now();
    const r = await fetch(u, { ...ua, signal: AbortSignal.timeout(60000) }).catch((e) => ({ ok: false, status: e.message }));
    if (r.ok) { const t = await r.text().catch((e) => ({ err: e.message })); if (typeof t === 'string') return t; fail('G1', `sitemap ${u}: body not read (${t.err}); page-set check not possible`); return ''; }
    await r.body?.cancel().catch(() => {});
    if (r.status === 429) {
      if (++seen429 >= 2) { stopped429 = true; fail('G1', `sitemap ${u} answered 429, the second 429 in this run; stopped (politeness rule), page-set check not possible`); return ''; }
      await sleepMs(90000);
      continue;
    }
    if (i === 3 || seen429) { fail('G1', `could not read sitemap ${u} (HTTP ${r.status}); page-set check not possible`); return ''; }
    await sleepMs(20000 * i);
  }
  fail('G1', `could not read sitemap ${u}; page-set check not possible`);
  return '';
};
const pick = (xml, outer) => {
  const out = [];
  for (const block of xml.split(`<${outer}>`).slice(1)) { const m = block.match(/<loc>\s*([^<\s]+)/); if (m) out.push(normUrl(decodeXmlUrl(m[1]))); }
  return out;
};
const rootXml = await getXml(R.discovery.rootSitemap);
const expected = new Set(pick(rootXml, 'url'));
for (const sm of pick(rootXml, 'sitemap')) {
  if (!(R.discovery.sitemapsUsed || []).includes(sm)) continue; // same exclusion the run used, so pilots compare like for like
  for (const u of pick(await getXml(sm), 'url')) expected.add(u);
}
const onDisk = new Set(fs.existsSync(path.join(OUT, 'pages')) ? fs.readdirSync(path.join(OUT, 'pages')) : []);
const pages = Object.values(R.pages);
const pilot = (R.discovery.planned ?? 0) < R.discovery.pageCount;
// Pages deliberately excluded by the run (captured by hand) are not expected on disk, but they are listed in the summary.
const exRe = R.discovery.excludePattern ? new RegExp(R.discovery.excludePattern) : null;
const excludedExpected = [...expected].filter((u) => exRe && exRe.test(new URL(u).pathname));
for (const u of excludedExpected) expected.delete(u);
for (const u of expected) {
  const slug = pageSlug(u);
  if (!pilot && !onDisk.has(slug)) fail('G1', `missing page: ${u}`);
}
for (const p of pages) {
  if (p.kind === 'page' && !expected.has(normUrl(p.url))) fail('G1', `captured page not in sitemap: ${p.url}`);
  if (p.kind === 'sample' && !R.samples.includes(p.url)) fail('G1', `sample not in sample list: ${p.url}`);
  if (p.kind === 'extra' && !(R.extras || []).includes(p.url)) fail('G1', `extra page not in --extra list: ${p.url}`);
  if (!['page', 'sample', 'extra'].includes(p.kind)) fail('G1', `unknown page kind "${p.kind}": ${p.url}`);
}
for (const d of onDisk) if (!pages.some((p) => p.slug === d)) fail('G1', `folder on disk with no report entry: pages/${d}`);

// ---- G2 + G3: per-page files and titles ----
const MIN = { 'desktop.png': 15000, 'mobile.png': 8000, 'desktop.webm': 20000, 'mobile.webm': 20000, 'rendered.html': 2000, 'raw.html': 500 };
for (const p of pages) {
  const dir = path.join(OUT, 'pages', p.slug);
  for (const [f, min] of Object.entries(MIN)) {
    const fp = path.join(dir, f);
    if (!fs.existsSync(fp)) fail('G3', `${p.slug}: missing ${f}`);
    else if (fs.statSync(fp).size < min) fail('G3', `${p.slug}: ${f} only ${fs.statSync(fp).size} bytes`);
  }
  if (!fs.existsSync(path.join(dir, 'capture.har.zip'))) fail('G3', `${p.slug}: missing capture.har.zip`);
  const html = fs.existsSync(path.join(dir, 'rendered.html')) ? fs.readFileSync(path.join(dir, 'rendered.html'), 'utf8') : '';
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (!title) fail('G2', `${p.slug}: no <title> in rendered.html`);
  else if (JUNK_TITLE.test(title)) fail('G2', `${p.slug}: junk title "${title}"`);
  else if (CHALLENGE_TITLE.test(title)) fail('G2', `${p.slug}: saved a bot-challenge page "${title}"`);
  if (p.desktop?.status !== 200) fail('G2', `${p.slug}: live status ${p.desktop?.status}`);
}

// ---- G6: fully loaded at capture time (images done, no spinner, no "something went wrong") ----
for (const p of pages) {
  for (const vp of ['desktop', 'mobile']) {
    const r = p[vp] || {};
    if (r.settled === false) fail('G6', `${p.slug} ${vp}: never settled in ${r.settleMs}ms (loaders visible: ${r.loadersVisible}, unloaded images: ${r.notLoaded?.length})`);
    if (r.notLoaded?.length) fail('G6', `${p.slug} ${vp}: ${r.notLoaded.length} images not loaded, e.g. ${r.notLoaded[0]}`);
    if (r.errorBanner) fail('G6', `${p.slug} ${vp}: page showed an error message ("something went wrong")`);
  }
}

// ---- G7: extras saved and complete (only what this run recorded; older runs without these features are skipped) ----
const exists = (rel) => fs.existsSync(path.join(OUT, rel)) && fs.statSync(path.join(OUT, rel)).size > 0;
if (R.sitemapsSaved) {
  if (!fs.existsSync(path.join(OUT, 'sitemaps')) || !fs.readdirSync(path.join(OUT, 'sitemaps')).length) fail('G7', 'sitemaps/ is empty');
  for (const sm of R.discovery.sitemapsUsed) {
    const name = new URL(sm).pathname.replace(/^\/+/, '').replace(/[\\/:*?"<>|]+/g, '__');
    if (!exists(path.join('sitemaps', name))) fail('G7', `sitemap not saved: ${sm}`);
  }
}
for (const p of pages) {
  if (!p.rawVariant) continue;
  if (p.rawVariant.status !== 200) fail('G7', `${p.slug}: raw variant ${p.rawVariant.query} → ${p.rawVariant.status ?? p.rawVariant.error}`);
  else if (!exists(path.join('pages', p.slug, 'raw-variant.html'))) fail('G7', `${p.slug}: raw-variant.html missing`);
}
if (R.wpApi) {
  for (const [type, v] of Object.entries(R.wpApi)) {
    if (type === 'mediaFiles') {
      if (v.failed?.length) fail('G7', `wp media: ${v.failed.length} of ${v.total} originals failed to download, e.g. ${v.failed[0]}`);
      const media = readJson(path.join(OUT, 'wp-api', 'media.json'), []);
      for (const m of media) if (m.source_url && (!R.assets[m.source_url] || !exists(R.assets[m.source_url].file))) { fail('G7', `wp media original not on disk: ${m.source_url}`); break; }
      continue;
    }
    if (type === 'root') { if (v.status !== 200 || !exists('wp-api/_root.json')) fail('G7', `wp-api root not saved (${v.status ?? v.error})`); continue; }
    if (v.status !== 200) { fail('G7', `wp-api ${type}: HTTP ${v.status ?? v.error}`); continue; }
    const arr = readJson(path.join(OUT, 'wp-api', `${type}.json`), null);
    if (!Array.isArray(arr) || arr.length !== v.count) fail('G7', `wp-api ${type}.json has ${arr?.length} items, report says ${v.count}`);
  }
  // Every published page and post WordPress knows about must be captured, or excluded on purpose.
  const captured = new Set(pages.map((p) => new URL(p.url).pathname));
  for (const type of ['pages', 'posts']) {
    for (const item of readJson(path.join(OUT, 'wp-api', `${type}.json`), [])) {
      if (!item.link || item.status && item.status !== 'publish') continue;
      const pth = new URL(item.link).pathname;
      if (captured.has(pth) || (exRe && exRe.test(pth))) continue;
      if (!pilot) fail('G7', `WordPress ${type.slice(0, -1)} not captured: ${pth} ("${item.title?.rendered || ''}")`);
    }
  }
}

// ---- G5: whole videos ----
for (const p of pages) {
  const fj = readJson(path.join(OUT, 'pages', p.slug, 'features.json'), { videos: [] });
  for (const v of fj.videos) {
    const a = R.assets[v];
    if (!a) fail('G5', `${p.slug}: video not saved ${v}`);
    else if (!fs.existsSync(path.join(OUT, a.file)) || fs.statSync(path.join(OUT, a.file)).size < 50000) fail('G5', `${p.slug}: video too small / missing ${a.file}`);
  }
}

// ---- G4: offline replay from HAR ----
const replay = [];
if (!args['no-replay']) {
  const { chromium } = await loadPlaywright();
  sweep();
  const guard = guardedTempEnv('site-backup-', 'browser');
  let browser;
  try {
  browser = await chromium.launch({ headless: true });
  for (const p of pages) {
    const har = path.join(OUT, 'pages', p.slug, 'capture.har.zip');
    if (!fs.existsSync(har)) continue;
    const ctx = await browser.newContext({ ...VIEWPORTS.desktop, serviceWorkers: 'block' });
    await ctx.routeFromHAR(har, { notFound: 'abort' }); // nothing reaches the internet
    // Requests the HAR holds with no answer (status -1) are aborted, not left hanging (registered last, so it wins).
    const unanswered = harUnanswered(har);
    if (unanswered.size) await ctx.route((u) => unanswered.has(normUrl(u.href)), (r) => r.abort());
    const page = await ctx.newPage();
    let aborted = 0;
    page.on('requestfailed', () => aborted++);
    const row = { slug: p.slug, liveTitle: p.desktop?.title, liveText: p.desktop?.textLength, unanswered: unanswered.size };
    try {
      await page.goto(p.url, { waitUntil: 'load', timeout: 60000 });
      // Read the offline copy the way the live page was read: scroll to the bottom and back to the top, then wait until the
      // text stops changing (3 equal reads 1 s apart, at most 20 s). elev8ca.com (2026-10-26, gap G-R-3): /sitemap shows its
      // last lists only after a scroll, and a timed chat greeting adds text; a 2.5 s look without a scroll read 82-88% of live.
      await page.evaluate(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 300; i++) { const y = scrollY; scrollBy(0, innerHeight * 0.5); await w(300); if (scrollY === y) break; }
        await w(1000); scrollTo(0, 0); await w(800);
      });
      for (let i = 0, last = -1, same = 0; i < 20 && same < 3; i++) {
        const n = await page.evaluate(() => document.body?.innerText.length || 0);
        same = n === last ? same + 1 : 0; last = n;
        await page.waitForTimeout(1000);
      }
      row.title = await page.title();
      row.text = await page.evaluate(() => document.body?.innerText.length || 0);
    } catch (e) { row.error = e.message.slice(0, 160); }
    row.aborted = aborted;
    await page.close({ runBeforeUnload: false }).catch(() => {});
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 60000))]);
    if (row.error) fail('G4', `${p.slug}: offline open failed: ${row.error}`);
    else {
      if (row.title !== row.liveTitle) fail('G4', `${p.slug}: offline title "${row.title}" != live "${row.liveTitle}"`);
      if (row.liveText && row.text < row.liveText * MIN_TEXT) fail('G4', `${p.slug}: offline text ${row.text} < ${Math.round(MIN_TEXT * 100)}% of live ${row.liveText}`);
    }
    replay.push(row);
  }
  } finally { try { if (browser) await browser.close(); } finally { guard.release(); } }
}

const gates = Object.fromEntries(Object.entries(results).map(([g, f]) => [g, { pass: f.length === 0, failures: f }]));
const summary = {
  checkedAt: new Date().toISOString(), pilot, expectedPages: expected.size, excludedByDesign: excludedExpected.length, capturedPages: pages.length,
  pagesOk: pages.filter((p) => p.ok).length, samples: R.samples.length, assets: Object.keys(R.assets).length,
  stopReason: R.stopReason, allPass: Object.values(gates).every((g) => g.pass),
};
fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify({ summary, gates, replay }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const [g, v] of Object.entries(gates)) console.log(`${g} ${v.pass ? 'PASS' : `FAIL (${v.failures.length})`}${v.pass ? '' : '\n  ' + v.failures.slice(0, 15).join('\n  ')}`);
if (replay.length) console.log('replay sample:', JSON.stringify(replay.slice(0, 5)));
// no process.exit(): every request has finished; exiting under an open fetch can crash Node on Windows
process.exitCode = summary.allPass ? 0 : 1;
