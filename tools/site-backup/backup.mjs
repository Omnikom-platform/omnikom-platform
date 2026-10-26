// Browser-rendered website backup.
//
// Usage:
//   node backup.mjs --site https://valleytovalleyrealty.com --out <dir>
//        [--sitemap <url>]            sitemap index (default <site>/sitemap_index.xml, falls back to /sitemap.xml)
//        [--exclude-sitemap <regex>]  child sitemaps to skip (e.g. "home-search/sitemap-listings")
//        [--samples-page <path> --samples-selector <css> --samples <n>]   extra sample pages linked from one page
//        [--only <path,path>]         pilot: capture only these paths (still checked against the sitemap list)
//        [--extra <url,url>]          reachable pages the sitemap omits (e.g. blog list pages 2-4); explicit, never scraped
//        [--exclude-pages <regex>]    sitemap pages captured another way (e.g. "^/home-search" = rate-limited listing feed, done by hand)
//        [--raw-variant "?k=v"]       also save each page's HTML from this query variant (WP Rocket: "?nowprocket=1" = clean source)
//        [--wp-api]                   WordPress: save the public REST content (pages, posts, media, categories, tags, root) to wp-api/
// Every run saves the sitemaps it read to sitemaps/.
//        [--delay <ms>]               pause between page captures (default 8000; the site rate-limits with HTTP 429)
//        [--settle-max <ms>]          longest wait for a page to finish loading (default 60000), see waitForSettled
//        [--resume]                   skip pages already captured OK in <out>/report.json
//
// Design rules (each one fixes a failure of the first clone tool):
//  - The page list comes ONLY from the sitemap (+ explicit samples). URLs are never scraped out of JS/CSS
//    text, so font names, template strings and script fragments can never become "pages".
//  - Assets come ONLY from what the browser actually requested (network capture), never from regex guesses.
//  - Every page is scrolled top to bottom before saving so lazy images, videos and scroll animations load.
//  - A Cloudflare / bot challenge stops the run (stopReason in report.json). We never try to get around it.
//  - report.json is written after every page, so a crash loses nothing and --resume continues.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  VIEWPORTS, TOOL_UA, CHALLENGE_TITLE, JUNK_TITLE, sleep, parseArgs, slugFor, pageSlug, decodeXmlUrl, countLoaders, assetFileFor, writeFile, readJson, loadPlaywright,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.site || !args.out || args.site === true || args.out === true) { console.error('need --site <url> and --out <dir>'); process.exit(2); }
if (!URL.canParse(args.site) || !/^https?:$/.test(new URL(args.site).protocol)) { console.error(`--site must be a full http(s) address (got "${args.site}"; from Git Bash a "/" argument can arrive rewritten: run from PowerShell)`); process.exit(2); }
const SITE = new URL(args.site).origin;
const HOST = new URL(SITE).host;
const OUT = path.resolve(args.out);
const DELAY = +(args.delay || 8000);
const SETTLE_MAX = +(args['settle-max'] || 60000);
const EXCLUDE_SM = args['exclude-sitemap'] ? new RegExp(args['exclude-sitemap']) : null;
// valleytovalleyrealty.com's /home-search is a rate-limited listing feed (HTTP 429): owner decision 2026-10-17 =
// captured by hand, never by this tool. Excluded by default on that domain; --allow-home-search overrides.
const SAFE_DEFAULT_EXCLUDE = /(^|\.)valleytovalleyrealty\.com$/i.test(new URL(SITE).hostname) && !args['allow-home-search'] ? '^/home-search' : null;
const EXCLUDE_PAGES = args['exclude-pages'] ? new RegExp(args['exclude-pages'] + (SAFE_DEFAULT_EXCLUDE ? `|${SAFE_DEFAULT_EXCLUDE}` : ''))
  : (SAFE_DEFAULT_EXCLUDE ? new RegExp(SAFE_DEFAULT_EXCLUDE) : null);
if (SAFE_DEFAULT_EXCLUDE && args['samples-page'] && new RegExp(SAFE_DEFAULT_EXCLUDE).test(args['samples-page'])) {
  console.error(`refusing --samples-page ${args['samples-page']}: /home-search on this site is a rate-limited feed captured by hand (pass --allow-home-search only with the owner's OK)`);
  process.exit(2);
}
const RAW_VARIANT = typeof args['raw-variant'] === 'string' ? args['raw-variant'] : null;
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => {
  const s = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(s);
  fs.appendFileSync(path.join(OUT, 'backup.log'), s + '\n');
};
const REPORT_FILE = path.join(OUT, 'report.json');
const report = args.resume ? readJson(REPORT_FILE, null) : null;
const R = report || { site: SITE, startedAt: new Date().toISOString(), discovery: {}, pages: {}, samples: [], assets: {}, stopReason: null };
const saveReport = () => writeFile(REPORT_FILE, JSON.stringify(R, null, 1));

class StopRun extends Error {}

// HTTP 429 = the site asks us to slow down. ONE allowance per run, shared by every kind of request (Lead decision
// 2026-10-23, CLAUDE.md "a second 429 stops the run"): pages in the browser, sitemaps, videos, curl, WordPress, media,
// raw variants. The run's first 429, anywhere: nothing more goes out for 90 s, that request is asked once more, and the
// rest of the run is slower (SLOW_GAP_MS between plain requests, no second try after other errors, double page delay).
// The run's second 429, anywhere: the whole run stops (StopRun, recorded as stopReason).
const WAIT_429_MS = 90000, SLOW_GAP_MS = 15000;
const RL = { count: 0, until: 0, stop: null, lastPlain: 0 };
// Records one 429. Never throws, so the browser's response handler can call it; the caller checks RL.stop.
function note429(url, where) {
  RL.count++;
  if (RL.count >= 2) { RL.stop ||= `rate limited: a second HTTP 429 in this run (${where} ${url}); stopped to stay polite. Re-run later with --resume and a larger --delay`; return; }
  RL.until = Date.now() + WAIT_429_MS;
  log(`429 rate limit on ${url} (${where}); nothing more for 90s, then one retry; the rest of the run goes slower`);
}
const slowed = () => RL.count > 0;
// the pause between pages: --delay, doubled (at least SLOW_GAP_MS) once the run has had its 429
const pause = () => sleep(slowed() ? Math.max(2 * DELAY, SLOW_GAP_MS) : DELAY);
// Before any plain request: stop if the run has had its second 429; wait out a 429 pause; keep the slow gap.
async function beforeRequest() {
  if (RL.stop) throw new StopRun(RL.stop);
  const wait = Math.max(RL.until, slowed() ? RL.lastPlain + SLOW_GAP_MS : 0) - Date.now();
  if (wait > 0) await sleep(wait);
  if (RL.stop) throw new StopRun(RL.stop);   // the browser may have seen the second 429 meanwhile
  RL.lastPlain = Date.now();
}
// An address that answered 429 has had its one retry: it is never asked again in this run (a page retry would otherwise
// fetch the same video a third time).
class SkipUrl extends Error {}
RL.answered429 = new Set();
const triedVideos = new Set();
const netRetried = new Set();
// Every plain request to the site goes through here; the browser's own requests are watched in captureOne.
async function politeFetch(url, init = {}, ms = 60000) {
  if (RL.answered429.has(String(url))) throw new SkipUrl(`not asked again: ${url} answered 429 earlier in this run`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await beforeRequest();
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...init.headers, 'user-agent': TOOL_UA }, signal: AbortSignal.timeout(ms) });
    } catch (e) {
      // elev8ca.com (2026-10-26): one "fetch failed" (no HTTP answer) on the first sitemap ended a run at second one; the
      // same request answered 200 a minute later. A plain network error gets ONE retry per URL after 20 s; a timeout or a
      // second failure still stops as before. A 429 is never retried here (that is the rate-limit path below).
      if (!(e instanceof TypeError) || netRetried.has(String(url))) throw e;
      netRetried.add(String(url));
      log(`network error on ${url} (${e.cause?.code || e.message}); one retry in 20 s`);
      await sleep(20000);
      attempt--;
      continue;
    }
    if (res.status !== 429) return res;
    await res.body?.cancel().catch(() => {});
    RL.answered429.add(String(url));
    note429(url, 'request');
    if (RL.stop) throw new StopRun(RL.stop);
  }
  throw new StopRun(RL.stop || `rate limited (HTTP 429) twice on ${url}; stopped to stay polite`);   // not reached: the second 429 sets RL.stop
}

// ---------- 1. Page list from sitemaps only ----------
async function fetchText(url) {
  const res = await politeFetch(url);
  if (!res.ok) await res.body?.cancel().catch(() => {});
  return { status: res.status, text: res.ok ? await res.text() : '' };
}
const locs = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>`, 'g'))].map((m) => decodeXmlUrl(m[1]));

async function discoverPages() {
  const tried = [args.sitemap || `${SITE}/sitemap_index.xml`, `${SITE}/sitemap.xml`];
  let root = null;
  for (const u of tried) { const r = await fetchText(u); if (r.status === 200 && /<(sitemapindex|urlset)/.test(r.text)) { root = { url: u, xml: r.text }; break; } }
  if (!root) throw new StopRun(`no sitemap found at ${tried.join(' or ')}`);
  // Keep every sitemap we read (P1.7's redirect map needs the old URL lists exactly as published).
  const saveSitemap = (url, xml) => writeFile(path.join(OUT, 'sitemaps', new URL(url).pathname.replace(/^\/+/, '').replace(/[\\/:*?"<>|]+/g, '__') || 'sitemap.xml'), xml);
  saveSitemap(root.url, root.xml);
  R.sitemapsSaved = true;
  const childMaps = locs(root.xml, 'sitemap');
  const used = [], skipped = [], pageUrls = [...locs(root.xml, 'url')];
  for (const sm of childMaps) {
    if (EXCLUDE_SM && EXCLUDE_SM.test(sm)) { skipped.push(sm); continue; }
    const r = await fetchText(sm);
    if (r.status !== 200) { skipped.push(`${sm} (HTTP ${r.status})`); continue; }
    used.push(sm);
    saveSitemap(sm, r.text);
    pageUrls.push(...locs(r.text, 'url'));
  }
  const pages = [], rejected = [], excluded = [];
  for (const raw of pageUrls) {
    let u; try { u = new URL(raw); } catch { rejected.push({ url: raw, why: 'not a URL' }); continue; }
    if (u.host !== HOST) { rejected.push({ url: raw, why: `other host ${u.host}` }); continue; }
    // Pages captured another way (e.g. the rate-limited listing search, done by hand in a real browser).
    if (EXCLUDE_PAGES && EXCLUDE_PAGES.test(u.pathname)) { excluded.push(u.href); continue; }
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    if (/\.[a-z0-9]{2,5}$/i.test(last) && !/\.html?$/i.test(last)) { rejected.push({ url: raw, why: 'file, not a page' }); continue; }
    u.hash = '';
    if (!pages.includes(u.href)) pages.push(u.href);
  }
  R.discovery = { rootSitemap: root.url, sitemapsUsed: used, sitemapsSkipped: skipped, pageCount: pages.length, rejected, excludePattern: EXCLUDE_PAGES ? EXCLUDE_PAGES.source : null, excluded };
  log(`sitemaps used ${used.length}, skipped ${skipped.length}, pages ${pages.length}, excluded ${excluded.length}, rejected ${rejected.length}`);
  return pages;
}

// ---------- 2. Capture one page in one viewport ----------
const savedAssets = new Set(Object.keys(R.assets));
async function captureOne(browser, url, slug, vpName, opts) {
  const vp = VIEWPORTS[vpName];
  const dir = path.join(OUT, 'pages', slug);
  const tmpVideo = path.join(OUT, '.video-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    ...vp,
    serviceWorkers: 'block',
    recordVideo: { dir: tmpVideo, size: vp.viewport },
    ...(opts.har ? { recordHar: { path: path.join(dir, 'capture.har.zip'), mode: 'full' } } : {}),
  });
  const page = await ctx.newPage();
  // Chromium shares its HTTP cache between contexts, so files already loaded by an earlier page come back
  // "from cache" and the HAR stores them with no body (status -1). Offline replay then hangs on them.
  // Disable the cache so every capture records every file it needs.
  // Only the HAR capture needs this; the mobile pass keeps the cache so we load the site as lightly as possible.
  if (opts.har) {
    // After the run's 429 the browser asks nothing more until the 90 s are over (its own page load included): those
    // requests are aborted; the page is captured again after the wait. Routing turns off the HTTP cache, which this
    // pass does anyway (below); the mobile pass keeps its cache, so it has no route.
    await ctx.route('**/*', (route) => (RL.stop || Date.now() < RL.until ? route.abort('blockedbyclient') : route.fallback()));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  const consoleErrors = [], pageErrors = [], graphql = [], failed = [];
  const rec = { viewport: vpName, rateLimited: 0 };
  // 429 = the site is asking us to slow down. It uses the run's one allowance (note429): plain requests wait out the 90 s,
  // capturePage waits and retries the page once; a second 429 anywhere in the run stops it.
  page.on('response', (res) => {
    if (res.status() !== 429) return;
    rec.rateLimited++;
    note429(res.url().slice(0, 160), 'browser');
    (rec.rateLimitedUrls ||= []).length < 10 && rec.rateLimitedUrls.push(`${res.request().method()} ${res.url().slice(0, 160)}`);
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 200)}`));
  if (opts.assets) {
    page.on('response', async (res) => {
      const req = res.request();
      const u = res.url();
      if (req.method() !== 'GET' || res.status() !== 200 || !/^https?:/.test(u) || savedAssets.has(u)) return;
      if (req.resourceType() === 'document' && req.frame() === page.mainFrame()) return; // saved separately as raw.html
      try {
        const body = await res.body();
        const file = assetFileFor(OUT, u);
        writeFile(file, body);
        savedAssets.add(u);
        R.assets[u] = { file: path.relative(OUT, file).split(path.sep).join('/'), type: req.resourceType(), bytes: body.length, contentType: res.headers()['content-type'] || '' };
      } catch { /* body unavailable (redirect / evicted); HAR still has it */ }
    });
    page.on('requestfinished', async (req) => {
      if (req.method() !== 'POST' || !/graphql|federation/i.test(req.url())) return;
      try {
        const res = await req.response();
        graphql.push({ url: req.url(), request: req.postDataJSON(), status: res?.status(), response: await res?.json() });
      } catch (e) { graphql.push({ url: req.url(), error: String(e.message) }); }
    });
  }

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    rec.status = resp?.status() ?? 0;
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const title = await page.title();
    const challenged = CHALLENGE_TITLE.test(title) || await page.$('#challenge-form, iframe[src*="challenges.cloudflare.com"]');
    if (challenged) throw new StopRun(`bot challenge on ${url} (title "${title}")`);

    // Cookie banner: take the privacy-preserving choice so it neither covers the page nor turns on tracking.
    const reject = page.getByRole('button', { name: /reject (all|non-essential)|decline|only (necessary|essential)/i }).first();
    if (await reject.isVisible().catch(() => false)) { await reject.click().catch(() => {}); rec.consent = 'rejected non-essential'; await page.waitForTimeout(500); }

    // Lazy loading: a lazy image only loads when it scrolls into view, so slider slides that are never shown
    // (portfolio carousel, team slider) would be saved blank even after a full scroll (measured: 11 of 98 on
    // the home page). Make every lazy image load now. The saved HTML gets the original attributes back.
    rec.forcedEager = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img[loading=lazy]')];
      imgs.forEach((i) => { i.setAttribute('data-backup-was-lazy', ''); i.loading = 'eager'; });
      return imgs.length;
    });

    // Scroll SLOWLY to the bottom (half a screen per step) so every lazy-loaded image, video and reveal
    // animation fires. At each step wait until the images now on screen have actually finished (up to 4s),
    // instead of a fixed pause. Keeps going while the page grows (infinite scroll), up to 300 steps.
    rec.scroll = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const onScreenPending = () => [...document.images].filter((i) => {
        const r = i.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.width > 0 && (!i.complete || (i.currentSrc && i.naturalWidth === 0));
      }).length;
      let steps = 0, slowSteps = 0;
      for (; steps < 300; steps++) {
        const before = window.scrollY;
        window.scrollBy(0, Math.round(window.innerHeight * 0.5));
        await wait(400);
        const t0 = Date.now();
        while (onScreenPending() && Date.now() - t0 < 4000) await wait(250);
        if (Date.now() - t0 >= 4000) slowSteps++;
        if (window.scrollY === before) { await wait(1500); if (document.documentElement.scrollHeight <= window.scrollY + innerHeight + 2) break; }
      }
      await wait(1500);
      window.scrollTo(0, 0);
      await wait(1000);
      return { steps, slowSteps, pageHeight: document.documentElement.scrollHeight };
    });
    // Lazy videos (<source data-src>, used by this site's background videos) that the site's script still has
    // not started after the scroll: start them, so they play in the screenshot and their files get saved.
    rec.forcedVideos = await page.evaluate(() => {
      let n = 0;
      for (const v of document.querySelectorAll('video')) {
        if (v.currentSrc) continue;
        let touched = false;
        for (const s of v.querySelectorAll('source[data-src]')) {
          if (!s.getAttribute('src')) { s.setAttribute('data-backup-forced-src', ''); s.setAttribute('src', s.getAttribute('data-src')); touched = true; }
        }
        if (!v.getAttribute('src') && v.getAttribute('data-src')) { v.setAttribute('data-backup-forced-src', ''); v.setAttribute('src', v.getAttribute('data-src')); touched = true; }
        if (touched) { v.load(); if (v.autoplay) v.play().catch(() => {}); n++; }
      }
      return n;
    });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    Object.assign(rec, await waitForSettled(page, SETTLE_MAX));

    rec.title = await page.title();
    rec.textLength = await page.evaluate(() => document.body?.innerText.length || 0);
    // Save the DOM BEFORE the screenshot-only style below is injected, so rendered.html is exactly what visitors get.
    // Taken from a clone with our loading changes undone, so the file matches what the site itself produced.
    const renderedHtml = opts.assets ? await page.evaluate(() => {
      const root = document.documentElement.cloneNode(true);
      root.querySelectorAll('[data-backup-was-lazy]').forEach((i) => { i.setAttribute('loading', 'lazy'); i.removeAttribute('data-backup-was-lazy'); });
      root.querySelectorAll('[data-backup-forced-src]').forEach((s) => { s.removeAttribute('src'); s.removeAttribute('data-backup-forced-src'); });
      const dt = document.doctype ? `<!DOCTYPE ${document.doctype.name}>\n` : '';
      return dt + root.outerHTML;
    }) : null;

    // Full-page screenshots drop `background-attachment: fixed` (parallax) images, leaving light text on white.
    // Flatten it for the still image only; the scroll video above already recorded the real parallax.
    rec.fixedBackgrounds = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).backgroundAttachment.includes('fixed')).length);
    if (rec.fixedBackgrounds) await page.addStyleTag({ content: '*{background-attachment:scroll !important}' });
    await page.screenshot({ path: path.join(dir, `${vpName}.png`), fullPage: true, timeout: 120000 }).catch(async (e) => {
      rec.screenshotNote = `full page failed (${e.message.slice(0, 80)}), saved viewport only`;
      await page.screenshot({ path: path.join(dir, `${vpName}.png`) });
    });

    if (opts.assets) {
      writeFile(path.join(dir, 'raw.html'), resp ? await resp.text().catch(() => '') : '');
      writeFile(path.join(dir, 'rendered.html'), renderedHtml);
      const features = await page.evaluate(collectFeatures, opts.samplesSelector || null);
      writeFile(path.join(dir, 'features.json'), JSON.stringify(features, null, 1));
      rec.featuresSummary = { forms: features.forms.length, iframes: features.iframes.length, videos: features.videos.length, sliders: features.sliders, modals: features.modals.length };
      if (opts.samplesSelector) rec.sampleLinks = features.sampleLinks;
      // Background videos stream via range requests (HTTP 206), so the network capture holds only pieces. Fetch them whole.
      for (const v of features.videos) {
        if (!/^https?:/.test(v) || savedAssets.has(v)) continue;
        rec.videoErrors = rec.videoErrors || [];
        // A second try after another error (503, a dropped download) only while the run has had no 429; politeFetch itself
        // holds the run's one 429 retry. curl is tried only when the download itself failed (no HTTP answer), never after
        // an HTTP error status.
        // after the run's 429, a video already asked for in this run (e.g. before a page retry) is not asked again
        if (slowed() && triedVideos.has(v)) { rec.videoErrors.push(`not asked again after the run's 429: ${v}`); continue; }
        triedVideos.add(v);
        let networkFailed = false;
        for (let attempt = 1; attempt <= 2 && !savedAssets.has(v) && (attempt === 1 || !slowed()); attempt++) {
          if (attempt === 2) await sleep(15000);
          try {
            const res = await politeFetch(v, {}, 300000);
            if (!res.ok) { await res.body?.cancel().catch(() => {}); rec.videoErrors.push(`HTTP ${res.status} ${v}`); networkFailed = false; continue; }
            const body = Buffer.from(await res.arrayBuffer());
            const file = assetFileFor(OUT, v);
            writeFile(file, body);
            savedAssets.add(v);
            R.assets[v] = { file: path.relative(OUT, file).split(path.sep).join('/'), type: 'media', bytes: body.length, contentType: res.headers.get('content-type') || '' };
          } catch (e) {
            if (e instanceof StopRun) throw e;
            if (e instanceof SkipUrl) { networkFailed = false; rec.videoErrors.push(e.message.slice(0, 200)); break; }
            networkFailed = true; rec.videoErrors.push(`${e.name}: ${e.message.slice(0, 80)} ${v}`);
          }
        }
        // Node's fetch fails on some large Cloudinary webm files ("fetch failed") that curl downloads fine (measured).
        // curl obeys the same per-run 429 rule: a first 429 waits 90 s and retries once; a second stops the run.
        for (let attempt = 1; attempt <= 2 && networkFailed && !savedAssets.has(v); attempt++) {
          await beforeRequest();
          const file = assetFileFor(OUT, v);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const c = spawnSync('curl', ['-sS', '-L', '--fail', '--max-time', '300', '-A', TOOL_UA, '-o', file, '-w', '%{http_code} %{content_type}', v], { encoding: 'utf8', timeout: 330000 }); // curl stops itself at 300 s; this catches a curl that never starts
          const [code, ...ct] = String(c.stdout || '').trim().split(' ');
          if (code === '429') { fs.rmSync(file, { force: true }); RL.answered429.add(String(v)); note429(v, 'curl'); if (RL.stop) throw new StopRun(RL.stop); continue; }
          if (c.status === 0 && fs.existsSync(file) && fs.statSync(file).size > 0) {
            savedAssets.add(v);
            R.assets[v] = { file: path.relative(OUT, file).split(path.sep).join('/'), type: 'media', bytes: fs.statSync(file).size, contentType: ct.join(' '), via: 'curl' };
            rec.videoErrors.push(`recovered with curl: ${v}`);
          } else rec.videoErrors.push(`curl also failed (${c.error ? c.error.code : `exit ${c.status}`}${code ? `, HTTP ${code}` : ''}: ${(c.stderr || '').trim().slice(0, 80)}) ${v}`);
          break;
        }
      }
    }
  } finally {
    const video = page.video();
    // elev8ca.com (2026-10-26): a reCAPTCHA Enterprise web worker kept ctx.close() (the HAR flush) waiting forever; closing
    // the page first ends the worker and the context then closes at once (measured: hang > 90 s vs 0 s, HAR whole). The cap
    // keeps any other hang from stalling the run; a context that did not close is recorded, never silently passed.
    await page.close({ runBeforeUnload: false }).catch(() => {});
    const closed = await Promise.race([ctx.close().then(() => true), sleep(180000).then(() => false)]); // flushes video + HAR
    if (!closed) rec.closeNote = 'browser context did not close within 180 s: its HAR and video may be missing';
    if (video) {
      const vpath = await video.path().catch(() => null);
      if (vpath && fs.existsSync(vpath)) fs.renameSync(vpath, path.join(dir, `${vpName}.webm`));
    }
    if (graphql.length) graphql.forEach((g, i) => writeFile(path.join(dir, 'graphql', `${String(i + 1).padStart(3, '0')}.json`), JSON.stringify(g, null, 1)));
    rec.graphqlCount = graphql.length;
    rec.consoleErrors = consoleErrors.slice(0, 20);
    rec.pageErrors = pageErrors.slice(0, 20);
    rec.failedRequests = failed.slice(0, 30);
  }
  return rec;
}

// Wait until the page has really finished loading, instead of guessing a fixed time. "Settled" means, for
// two checks in a row: every <img> has finished (no broken/pending ones), no loader/spinner/skeleton is
// visible, the text length has stopped changing, and the network has been quiet. Capped at maxMs; whatever
// is still missing at the cap is recorded (verify.mjs gate G6 turns it red) rather than silently saved.
async function waitForSettled(page, maxMs) {
  const t0 = Date.now();
  let last = -1, stable = 0, state = null;
  while (Date.now() - t0 < maxMs) {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    state = await page.evaluate(() => {
      const visible = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0; };
      const pendingImgs = [...document.images].filter((i) => visible(i) && i.currentSrc && (!i.complete || i.naturalWidth === 0)).map((i) => i.currentSrc.slice(0, 160));
      // Lazy elements never swapped in: the real address still sits in data-src/data-srcset/data-bg while the
      // element shows an empty or placeholder source. These would be saved as blank boxes, so they count as not loaded.
      const isPlaceholder = (s) => !s || s.startsWith('data:') || /placeholder|blank|spacer|1x1|pixel\.gif/i.test(s);
      for (const e of document.querySelectorAll('[data-src], [data-srcset], [data-lazy], [data-lazy-src], [data-bg], [data-background], [data-original]')) {
        if (!visible(e) && e.tagName !== 'SOURCE') continue;
        // Buttons/links carry data-src as a click target (e.g. a Vimeo video-tour play button), not lazy content.
        // Only media elements, or elements with an explicit background attribute, count. (False alarm seen 2026-10-17.)
        const media = ['IMG', 'SOURCE', 'VIDEO', 'IFRAME', 'PICTURE'].includes(e.tagName);
        if (!media && !e.hasAttribute('data-bg') && !e.hasAttribute('data-background')) continue;
        const want = e.getAttribute('data-src') || e.getAttribute('data-lazy-src') || e.getAttribute('data-lazy') || e.getAttribute('data-original') || e.getAttribute('data-srcset') || e.getAttribute('data-bg') || e.getAttribute('data-background');
        if (!want) continue;
        let swapped;
        if (e.tagName === 'IMG') swapped = !isPlaceholder(e.currentSrc) && e.naturalWidth > 0;
        else if (e.tagName === 'SOURCE') swapped = !!(e.getAttribute('src') || e.getAttribute('srcset')) || !!e.parentElement?.currentSrc;
        else if (e.tagName === 'VIDEO') swapped = !!e.currentSrc;
        else if (e.tagName === 'IFRAME') swapped = !isPlaceholder(e.getAttribute('src'));
        else swapped = getComputedStyle(e).backgroundImage !== 'none';
        if (!swapped) pendingImgs.push(`lazy-not-loaded <${e.tagName.toLowerCase()}> ${want.slice(0, 140)}`);
      }
      for (const v of document.querySelectorAll('video')) if (visible(v) && v.autoplay && !v.currentSrc) pendingImgs.push(`video-not-loaded ${(v.querySelector('source')?.getAttribute('data-src') || v.poster || '').slice(0, 140)}`);
      const text = document.body?.innerText || '';
      const errorBanner = /something went wrong|failed to load|please try again/i.test(text);
      return { pendingImgs, textLength: text.length, errorBanner };
    }).catch(() => ({ pendingImgs: [], textLength: 0, errorBanner: false }));
    state.loaders = await page.evaluate(countLoaders).catch(() => 0);
    const quiet = !state.pendingImgs.length && !state.loaders && state.textLength === last;
    stable = quiet ? stable + 1 : 0;
    last = state.textLength;
    if (stable >= 2) break;
    await page.waitForTimeout(1500);
  }
  return { settleMs: Date.now() - t0, settled: stable >= 2, notLoaded: state?.pendingImgs.slice(0, 20) || [], loadersVisible: state?.loaders || 0, errorBanner: !!state?.errorBanner };
}

// Runs inside the page. Lists what the page does, for the feature inventory.
function collectFeatures(samplesSelector) {
  const txt = (e) => (e?.innerText || e?.textContent || '').replace(/\s+/g, ' ').trim();
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  return {
    url: location.href,
    title: document.title,
    meta: {
      description: document.querySelector('meta[name="description"]')?.content || null,
      canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      robots: document.querySelector('meta[name="robots"]')?.content || null,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
    },
    headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName} ${txt(h).slice(0, 120)}`).filter((s) => s.length > 3).slice(0, 80),
    jsonLdTypes: [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { try { const j = JSON.parse(s.textContent); return [].concat(j).flatMap((x) => [x['@type'], ...(x['@graph'] || []).map((g) => g['@type'])]); } catch { return []; } }).filter(Boolean),
    forms: [...document.querySelectorAll('form')].map((f) => ({
      id: f.id || null,
      action: f.getAttribute('action'),
      submit: txt(f.querySelector('button[type=submit],input[type=submit],button')).slice(0, 60),
      fields: [...f.querySelectorAll('input,select,textarea')].map((i) => ({ name: i.name || null, type: i.type || i.tagName.toLowerCase(), hidden: i.type === 'hidden', required: i.required, label: i.placeholder || i.getAttribute('aria-label') || null })),
      consentText: txt(f.querySelector('label[for*=terms], [class*=consent], [class*=terms]')).slice(0, 600) || null,
    })),
    modals: [...document.querySelectorAll('[class*=modal], [role=dialog]')].map((m) => m.id || String(m.className).slice(0, 60)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 30),
    sliders: document.querySelectorAll('.slick-slider, .swiper, .swiper-container, [class*=carousel]').length,
    iframes: [...document.querySelectorAll('iframe')].map((f) => f.src).filter(Boolean),
    videos: [...new Set([...document.querySelectorAll('video, video source')].map((v) => abs(v.currentSrc || v.src || v.getAttribute('data-src'))).filter(Boolean))],
    motionClasses: [...new Set([...document.querySelectorAll('[class*=wow], [data-wow-delay], [class*=parallax], [class*=animate], [data-aos]')].map((e) => String(e.className).split(' ').find((c) => /wow|parallax|animate|aos/i.test(c))).filter(Boolean))].slice(0, 20),
    internalLinks: [...new Set([...document.querySelectorAll('a[href]')].map((a) => abs(a.getAttribute('href'))).filter((h) => h && new URL(h).host === location.host).map((h) => new URL(h).pathname))].sort(),
    externalLinks: [...new Set([...document.querySelectorAll('a[href]')].map((a) => abs(a.getAttribute('href'))).filter((h) => h && /^https?:/.test(h) && new URL(h).host !== location.host))].sort().slice(0, 60),
    sampleLinks: samplesSelector ? [...new Set([...document.querySelectorAll(samplesSelector)].map((a) => abs(a.getAttribute('href'))).filter(Boolean))] : [],
  };
}

// ---------- 2b. WordPress REST content (public endpoints only; never /users) ----------
async function saveWpApi() {
  R.wpApi = {};
  const get = (u) => politeFetch(u, { headers: { accept: 'application/json' } });
  try {
    const res = await get(`${SITE}/wp-json/`);
    R.wpApi.root = { status: res.status };
    if (res.ok) { const j = await res.json(); writeFile(path.join(OUT, 'wp-api', '_root.json'), JSON.stringify(j, null, 1)); R.wpApi.root.namespaces = j.namespaces || []; }
    else await res.body?.cancel().catch(() => {});
  } catch (e) { if (e instanceof StopRun) throw e; R.wpApi.root = { error: e.message.slice(0, 120) }; }
  for (const type of ['pages', 'posts', 'media', 'categories', 'tags']) {
    const all = [];
    let status = 0, totalPages = 1;
    try {
      for (let pg = 1; pg <= totalPages && pg <= 50; pg++) {
        const res = await get(`${SITE}/wp-json/wp/v2/${type}?per_page=100&page=${pg}`);
        status = res.status;
        if (!res.ok) { await res.body?.cancel().catch(() => {}); break; }
        totalPages = +(res.headers.get('x-wp-totalpages') || 1);
        all.push(...await res.json());
        await sleep(1000);
      }
      if (status === 200) writeFile(path.join(OUT, 'wp-api', `${type}.json`), JSON.stringify(all, null, 1));
      R.wpApi[type] = { status, count: all.length };
    } catch (e) { if (e instanceof StopRun) throw e; R.wpApi[type] = { status, error: e.message.slice(0, 120) }; }
  }
  // Every original in the media library, including uploads no page displays (the browser capture only
  // saves what a page actually loads). Polite pace; already-saved URLs are skipped.
  const media = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'wp-api', 'media.json'), 'utf8')); } catch { return []; } })();
  const mediaResult = { total: media.length, saved: 0, already: 0, failed: [] };
  for (const m of media) {
    const src = m.source_url;
    if (!src || !/^https?:/.test(src)) continue;
    if (savedAssets.has(src)) { mediaResult.already++; continue; }
    try {
      const res = await politeFetch(src, {}, 120000);
      if (!res.ok) { await res.body?.cancel().catch(() => {}); mediaResult.failed.push(`${res.status} ${src}`); continue; }
      const body = Buffer.from(await res.arrayBuffer());
      const file = assetFileFor(OUT, src);
      writeFile(file, body);
      savedAssets.add(src);
      R.assets[src] = { file: path.relative(OUT, file).split(path.sep).join('/'), type: 'wp-media', bytes: body.length, contentType: res.headers.get('content-type') || '' };
      mediaResult.saved++;
    } catch (e) { if (e instanceof StopRun) { R.wpApi.mediaFiles = mediaResult; throw e; } mediaResult.failed.push(`${e.name} ${src}`); }
    await sleep(500);
  }
  R.wpApi.mediaFiles = mediaResult;
  saveReport();
  log(`wp-api: ${Object.entries(R.wpApi).map(([k, v]) => `${k}=${v.count ?? v.saved ?? v.status ?? v.error}`).join(' ')}; media files saved ${mediaResult.saved}, already ${mediaResult.already}, failed ${mediaResult.failed.length}`);
}

// ---------- 3. Main ----------
async function capturePage(browser, url, kind) {
  const u = new URL(url);
  const slug = pageSlug(url, kind);
  if (args.resume && R.pages[url]?.ok) { log(`skip (done) ${url}`); return R.pages[url]; }
  const isSamplesPage = args['samples-page'] && new URL(url).pathname === args['samples-page'];
  const entry = { url, slug, kind, ok: false };
  R.pages[url] = entry;
  try {
    // Rate-limited (HTTP 429)? The run's one allowance: wait out the 90 s, then retry the whole page once. A second 429
    // anywhere in the run (this page or any other request) stops the run: we never hammer the site.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await beforeRequest();   // no browser load while a 429 pause runs; stops here if the run already had its second 429
      fs.rmSync(path.join(OUT, 'pages', slug), { recursive: true, force: true });
      entry.desktop = await captureOne(browser, url, slug, 'desktop', { har: true, assets: true, samplesSelector: isSamplesPage ? args['samples-selector'] : null });
      if (RL.stop) throw new StopRun(RL.stop);
      // a 429 during the desktop pass: no mobile pass now (that would ask again within seconds); go straight to the wait
      if (entry.desktop.rateLimited) entry.mobile = { viewport: 'mobile', rateLimited: 0, settled: false, errorBanner: false, notLoaded: [], skipped: 'desktop pass was rate limited (HTTP 429)' };
      else {
        await sleep(slowed() ? DELAY : DELAY / 2);
        await beforeRequest();
        entry.mobile = await captureOne(browser, url, slug, 'mobile', { har: false, assets: false });
        if (RL.stop) throw new StopRun(RL.stop);
      }
      const limited = entry.desktop.rateLimited + entry.mobile.rateLimited;
      const incomplete = [entry.desktop, entry.mobile].some((r) => !r.settled || r.errorBanner);
      if (!limited && !incomplete) break;
      if (limited) {
        entry.rateLimitRetries = attempt;
        // not reached in practice: a 429 on the retry is the run's second 429 and has already stopped it above
        if (attempt >= 2) throw new StopRun(RL.stop || `rate limited (HTTP 429) on ${url} twice; stopped to stay polite. Re-run later with --resume and a larger --delay`);
        // the wait itself is done by beforeRequest at the top of the loop (90 s from the 429)
      } else {
        entry.incompleteRetries = attempt;
        if (attempt >= 2) break; // keep the second attempt; it is marked not-ok below and verify G6 reports it
        log(`page not fully loaded on ${url} (settled=${entry.desktop.settled}/${entry.mobile.settled}, errorBanner=${entry.desktop.errorBanner}/${entry.mobile.errorBanner}); waiting 60s before one retry`);
        await sleep(60000);
      }
    }
    entry.title = entry.desktop.title;
    const loadedFully = [entry.desktop, entry.mobile].every((r) => r.settled && !r.errorBanner);
    entry.ok = entry.desktop.status === 200 && !!entry.title && !JUNK_TITLE.test(entry.title) && loadedFully;
    if (!entry.ok) entry.error = `status ${entry.desktop.status}, title "${entry.title}"${loadedFully ? '' : `, not fully loaded (unloaded images: ${entry.desktop.notLoaded.length + entry.mobile.notLoaded.length}, error banner: ${entry.desktop.errorBanner || entry.mobile.errorBanner})`}`;
    // Optional second copy of the HTML from a query variant (WordPress + WP Rocket: "?nowprocket=1" returns the
    // page before the speed plugin rewrites it, i.e. the clean source). Plain fetch, no browser.
    if (RAW_VARIANT) {
      const vu = new URL(url); for (const [k, v] of new URLSearchParams(RAW_VARIANT.replace(/^\?/, ''))) vu.searchParams.set(k, v);
      try {
        const res = await politeFetch(vu);
        entry.rawVariant = { query: RAW_VARIANT, status: res.status };
        if (res.ok) writeFile(path.join(OUT, 'pages', slug, 'raw-variant.html'), await res.text());
        else await res.body?.cancel().catch(() => {});
      } catch (e) { if (e instanceof StopRun) throw e; entry.rawVariant = { query: RAW_VARIANT, error: e.message.slice(0, 120) }; }
    }
  } catch (e) {
    entry.error = String(e.message).slice(0, 300);
    if (e instanceof StopRun) { R.stopReason = e.message; saveReport(); throw e; }
  }
  saveReport();
  log(`${entry.ok ? 'OK  ' : 'FAIL'} ${url}  "${entry.title || ''}"  text=${entry.desktop?.textLength ?? '-'} gql=${entry.desktop?.graphqlCount ?? '-'} ${entry.error || ''}`);
  return entry;
}

const { chromium } = await loadPlaywright();
let exitCode = 0;
const browser = await chromium.launch({ headless: true });
try {
  const all = await discoverPages();
  let todo = all;
  if (args.only) {
    const want = String(args.only).split(',').map((p) => new URL(p.trim(), SITE).href);
    const missing = want.filter((w) => !all.includes(w));
    if (missing.length) throw new StopRun(`--only paths not in sitemap: ${missing.join(', ')}`);
    todo = want;
  }
  // Extra pages the sitemap leaves out but a visitor can reach (e.g. blog list pages 2-4 at /blog?<id>=N).
  // Explicit list only, never discovered by scraping. verify.mjs G1 accepts exactly these.
  R.extras = args.extra ? String(args.extra).split(',').map((p) => new URL(p.trim(), SITE).href).filter((u) => new URL(u).host === HOST).filter((u) => !(SAFE_DEFAULT_EXCLUDE && new RegExp(SAFE_DEFAULT_EXCLUDE).test(new URL(u).pathname))) : [];
  R.discovery.planned = todo.length + R.extras.length;
  saveReport();
  for (const url of todo) { await capturePage(browser, url, 'page'); await pause(); }
  for (const url of R.extras) { await capturePage(browser, url, 'extra'); await pause(); }

  // Samples: links found on the samples page (e.g. MLS listing detail pages).
  const n = +(args.samples || 0);
  if (n > 0 && args['samples-page']) {
    const sp = R.pages[new URL(args['samples-page'], SITE).href];
    const links = (sp?.desktop?.sampleLinks || []).filter((h) => new URL(h).host === HOST).slice(0, n);
    R.samples = links;
    log(`samples: ${links.length} of ${n} requested`);
    for (const url of links) { await capturePage(browser, url, 'sample'); await pause(); }
  }
  if (args['wp-api']) await saveWpApi();
} catch (e) {
  log(`STOPPED: ${e.message}`);
  R.stopReason = R.stopReason || e.message;
  exitCode = 1;
} finally {
  await browser.close();
  fs.rmSync(path.join(OUT, '.video-tmp'), { recursive: true, force: true });
  R.finishedAt = new Date().toISOString();
  const pages = Object.values(R.pages);
  R.summary = { planned: R.discovery.planned ?? 0, captured: pages.length, ok: pages.filter((p) => p.ok).length, failed: pages.filter((p) => !p.ok).map((p) => `${p.url}: ${p.error}`), assets: Object.keys(R.assets).length, stopReason: R.stopReason };
  saveReport();
  log(`DONE ${JSON.stringify(R.summary)}`);
}
// exit code without process.exit(): every request above has finished or been cancelled, so the process ends by itself;
// the unref'd timer only ends a process something else keeps open (it does not hold the process open itself)
process.exitCode = exitCode;
setTimeout(() => process.exit(exitCode), 10000).unref();
