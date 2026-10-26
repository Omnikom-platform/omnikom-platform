// Usage: node snapshot-site.mjs <url> <out dir> [--max-pages 16] [--per-group 2] [--include /a,/b]
//        [--exclude "<regex>"]... [--gap-ms 4000] [--retry-wait-ms 90000] [--ignore-robots] [--no-browser]
//        [--desktop] [--runs 3] [--page-cap-s 180] [--max-minutes 90] [--busy-threshold 35] [--note "<text>"]
// Never hangs: every Chrome command has a time limit, one page measurement is capped (--page-cap-s; on failure Chrome
// is restarted and the run moves on), and the whole run stops at --max-minutes (exit 4, what was saved is kept).
// Run it while the machine is otherwise idle: lab timings are measured on this CPU (other heavy jobs inflate them).
// Machine load (G9, contract C8): during the speed runs the CPU use of the whole machine is sampled every 2 s (os.cpus() idle vs total
// deltas across cores). _site.json.machineLoad = { cpuPctAvg, cpuPctMax, samples, thresholdPct } (--busy-threshold N, default 35) and every
// measured page gets speedTrust: "trusted", or "UNTRUSTED: machine busy (cpu avg N%)" when the average over that page's runs is above the
// threshold. An UNTRUSTED lab number is not a finding; take the PageSpeed Insights number (psi.mjs) instead. Test hook: PEWP_TEST_CPU_PCT
// (a number 0..100) replaces the real reading, so a test can say "busy" or "idle" without loading the laptop.
// Saves a live site to <out dir> in a form the check workers can read like a codebase, so the same
// checklist runs on a site whose code we do not have. It is a polite, honest crawler:
//   - GET only; never clicks, types, logs in or submits anything.
//   - Says who it is (user agent "PEWP-SiteCheck/1.0"; the browser pass keeps HeadlessChrome in its user agent).
//   - One request at a time, --gap-ms apart; obeys robots.txt unless --ignore-robots (use only on sites you own).
//   - One 429 allowance per RUN: the first 429 anywhere pauses everything --retry-wait-ms (default 90 s) and retries that request
//     once; a second 429 anywhere in the run stops it (exit 3). To a host that is not this machine: --gap-ms >= 1000 and
//     --retry-wait-ms >= 90000 (lib-polite.mjs); a value that is not a number is a usage error (exit 2) before any request.
// What it saves (each file under 200 KB so a worker can read it whole; full copies are .gz, which workers skip):
//   _site.json                 what was crawled, when, how, which pages, what was skipped and why
//   site/robots.txt, site/robots.json, site/sitemaps.json (+ sitemap-*.xml or .xml.gz), site/probes.json
//                              (404 test, http->https, www<->apex, trailing slash: status + redirect chains)
//   pages/<slug>/response.json status, redirect chain, every response header, time to first byte, bytes, mainTextHash (AEO-012)
//   pages/<slug>/head.html     the server's <head> as sent (what crawlers read first)
//   pages/<slug>/body.html     the server's <body> as sent, with big inline scripts/styles/SVG/data URIs
//                              replaced by a marker that keeps their size (so weight is still visible)
//   pages/<slug>/inline.json   every replaced block: kind, bytes, first 200 characters
//   pages/<slug>/raw.html.gz   the untouched server HTML (for check scripts; zlib.gunzipSync)
//   pages/<slug>/browser-mobile.json  real Chrome, phone, slow network: LCP, CLS, TBT, FCP, TTFB, requests,
//                              bytes by type, third parties, console errors, and the rendered page summary
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { launchBrowser, measurePage } from "./cdp-measure.mjs";
import { mainTextHash } from "./lib-freshness.mjs";
import { numArg, politeMs, UsageError, POLITE_GAP_MS, MIN_GAP_MS, RETRY_WAIT_MS, MIN_RETRY_WAIT_MS } from "./lib-polite.mjs";

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith("--") && !String(args[i - 1] || "").startsWith("--"));
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const optAll = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
if (pos.length < 2) { console.error("usage: node snapshot-site.mjs <url> <out dir> [options]"); process.exit(2); }
let start;
try { start = new URL(pos[0]); if (!/^https?:$/.test(start.protocol)) throw new Error("not http(s)"); } catch { console.error(`usage: node snapshot-site.mjs <url> <out dir>: "${pos[0]}" is not an http(s) URL`); process.exit(2); }
const out = path.resolve(pos[1]);
// Every number is checked before any request: "--gap-ms abc" used to become NaN and sleep(NaN) waits ~1 ms (3 ms gaps, a 3 ms "wait"
// after a 429). To a host this machine does not serve, the gap is at least MIN_GAP_MS and the 429 wait at least MIN_RETRY_WAIT_MS
// (lib-polite.mjs); a local fixture server may use any value >= 0. A bad value is a usage error (exit 2), nothing fetched.
const num = (k, def, o = {}) => numArg(k, opt(k), { present: args.includes(k), def, ...o });
let maxPages, perGroup, gapMs, retryWaitMs, runs, pageCapMs, maxMinutes, busyPct;
try {
  maxPages = num("--max-pages", 16, { min: 1, int: true });
  perGroup = num("--per-group", 2, { min: 1, int: true });
  gapMs = politeMs("--gap-ms", num("--gap-ms", POLITE_GAP_MS), [start.href], MIN_GAP_MS);
  retryWaitMs = politeMs("--retry-wait-ms", num("--retry-wait-ms", RETRY_WAIT_MS), [start.href], MIN_RETRY_WAIT_MS);
  runs = num("--runs", 3, { min: 1, int: true });
  pageCapMs = num("--page-cap-s", 180, { min: 1 }) * 1000;
  maxMinutes = num("--max-minutes", 90, { min: 0 });
  busyPct = num("--busy-threshold", 35, { min: 0 });
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(`usage: node snapshot-site.mjs <url> <out dir> [options]: ${e.message}`); process.exit(2);
}
const include = String(opt("--include", "")).split(",").filter(Boolean);
const excludeSrc = optAll("--exclude");
// Git Bash (MSYS) rewrites an argument that starts with "/" into a Windows path ("^/x" -> "^C:/Program Files/Git/x"),
// which silently turns an exclude into a rule that matches nothing. Refuse before any request is made.
const mangled = [...include, ...excludeSrc].filter((a) => /^\^?[A-Za-z]:[\\/]/.test(a) || /[\\/]Program Files[\\/]Git[\\/]/i.test(a));
if (mangled.length) {
  console.error(`REFUSED: these paths were rewritten by the shell (Git Bash turns "/x" into a Windows path): ${mangled.join(" | ")}\nRun from PowerShell, or prefix the command with MSYS_NO_PATHCONV=1. Nothing was fetched.`);
  process.exit(2);
}
const excludes = excludeSrc.map((r) => new RegExp(r));
const ignoreRobots = args.includes("--ignore-robots");
const useBrowser = !args.includes("--no-browser");
const profiles = args.includes("--desktop") ? ["mobile", "desktop"] : ["mobile"];
const note = opt("--note", "");
// Nothing runs unbounded: each browser measurement has a hard cap (--page-cap-s), and so does the whole run (--max-minutes).
const deadline = Date.now() + maxMinutes * 60000;
const UA = "Mozilla/5.0 (compatible; PEWP-SiteCheck/1.0; site audit, read-only)";
const LIMIT = 190 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const origin = start.origin;
const log = (s) => console.log(s);
fs.mkdirSync(path.join(out, "site"), { recursive: true });
fs.mkdirSync(path.join(out, "pages"), { recursive: true });
const write = (rel, data) => { const p = path.join(out, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const writeJson = (rel, o) => write(rel, JSON.stringify(o, null, 1) + "\n");

// Exit codes: 3 = the site rate-limited twice, 4 = the run time cap was reached.
class Stop extends Error { constructor(msg, code = 3) { super(msg); this.code = code; } }
let lastRequest = 0;
let requests = 0;
let rateLimited = 0;
// ONE 429 allowance per RUN (project rule), shared by every request of the server pass and the browser pass: the first 429 anywhere
// pauses everything for --retry-wait-ms and allows one retry; a second 429 anywhere (the retry itself, another address, the browser)
// stops the run (exit 3). It used to be per address, so a site that rate-limited page after page was hit again and again.
let allowanceUsed = null; // the address of the first 429, once it happened
async function on429(url, where) {
  rateLimited++;
  if (allowanceUsed) throw new Stop(`second 429 in this run (${where} ${url}; the first was on ${allowanceUsed}): run stopped (site rate limit)`);
  allowanceUsed = url;
  log(`429 ${where} ${url}: everything waits ${Math.round(retryWaitMs / 1000)} s, then one retry (a second 429 anywhere stops the run)`);
  await sleep(retryWaitMs);
  lastRequest = Date.now();
}
// One polite GET (no redirect following, so chains are recorded). 429: the run's one allowance (above), else stop.
async function get(url) {
  // The run time cap holds for every request, not only the browser pass (a slow site with 429 waits must not run past it).
  if (Date.now() > deadline) throw new Stop(`run time cap of ${maxMinutes} min reached`, 4);
  // --exclude applies to EVERY request (pages, sitemaps a robots.txt lists, probes), not only to chosen pages.
  try { const p = new URL(url).pathname; if (excludes.some((re) => re.test(p))) { site.skipped.push({ url, why: "excluded by --exclude" }); return { url, excluded: true, error: "excluded by --exclude" }; } } catch {}
  const wait = lastRequest + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  requests++;
  const t = performance.now();
  let res;
  try {
    res = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-encoding": "br, gzip" }, signal: AbortSignal.timeout(45000) });
  } catch (e) {
    return { url, error: String(e.cause?.code || e.message || e).slice(0, 200) };
  }
  const ttfbMs = Math.round(performance.now() - t);
  const headers = Object.fromEntries(res.headers.entries());
  if (res.status === 429) {
    await res.arrayBuffer().catch(() => {});
    await on429(url, "on"); // throws on the run's second 429
    return get(url);
  }
  // the 45 s limit also covers the body: a body that stalls or breaks is this request's error, not a crash of the run
  let buf;
  try { buf = Buffer.from(await res.arrayBuffer()); }
  catch (e) { return { url, status: res.status, headers, ttfbMs, error: `body not received: ${String(e.cause?.code || e.message || e).slice(0, 160)}` }; }
  return { url, status: res.status, headers, ttfbMs, totalMs: Math.round(performance.now() - t), bytes: buf.length, body: buf };
}
async function getChain(url) {
  const chain = [];
  let cur = url;
  for (let i = 0; i < 10; i++) {
    const r = await get(cur);
    chain.push({ url: cur, status: r.status, error: r.error, location: r.headers?.location, ttfbMs: r.ttfbMs });
    if (r.error || !(r.status >= 300 && r.status < 400 && r.headers.location)) return { final: r, chain };
    try { cur = new URL(r.headers.location, cur).href; } catch { return { final: { url: cur, error: `bad redirect location: ${String(r.headers.location).slice(0, 120)}` }, chain }; }
  }
  return { final: { url: cur, error: "more than 10 redirects" }, chain };
}

// robots.txt rules for user agent * (enough for an honest crawler).
function parseRobots(txt) {
  const groups = [];
  let g = null;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    const key = k.toLowerCase();
    if (key === "user-agent") { if (!g || g.rules.length) { g = { agents: [], rules: [] }; groups.push(g); } g.agents.push(v.toLowerCase()); }
    else if ((key === "allow" || key === "disallow") && g) g.rules.push({ allow: key === "allow", path: v });
  }
  const star = groups.filter((x) => x.agents.includes("*")).flatMap((x) => x.rules);
  const sitemaps = [...txt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
  return { groups, starRules: star, sitemaps };
}
function robotsAllows(rules, p) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// Replace heavy inline blocks with size markers so the HTML fits a worker's context; keep JSON-LD whole.
function elide(html) {
  const blocks = [];
  const mark = (kind, s) => { blocks.push({ n: blocks.length + 1, kind, bytes: Buffer.byteLength(s), start: s.slice(0, 200) }); return `/* PEWP: ${kind} #${blocks.length} ${Buffer.byteLength(s)} bytes elided, see inline.json */`; };
  let h = html.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi, (all, open, attrs, body, close) => {
    const ld = /application\/ld\+json/i.test(attrs);
    if (ld ? body.length > 50000 : body.length > 1024) return open + mark(ld ? "json-ld" : /json/i.test(attrs) ? "json-data" : "script", body) + close;
    return all;
  });
  h = h.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, open, body, close) => (body.length > 2048 ? open + mark("style", body) + close : all));
  h = h.replace(/<svg\b[\s\S]*?<\/svg>/gi, (s) => (s.length > 4096 ? `<svg data-pewp="${mark("svg", s)}"></svg>` : s));
  h = h.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{1024,}/gi, (s) => `data:elided;${mark("data-uri", s)}`);
  // srcset lists: keep the first candidate and the count (presence and count are what the rules read).
  h = h.replace(/\b(srcset|imagesrcset)=("([^"]*)"|'([^']*)')/gi, (all, attr, q, a, b) => {
    const list = (a ?? b).split(/,\s+(?=\S)/);
    return list.length > 2 ? `${attr}="${list[0]} /* PEWP: +${list.length - 1} more candidates */"` : all;
  });
  // Whitespace runs carry no meaning in HTML outside <pre>/<textarea>; collapse them so pages fit.
  if (!/<(pre|textarea)\b/i.test(h)) h = h.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n");
  return { html: h, blocks };
}
function splitWrite(dir, name, text) {
  if (Buffer.byteLength(text) <= LIMIT) { write(`${dir}/${name}.html`, text); return [`${name}.html`]; }
  const parts = [];
  for (let i = 0, n = 1; i < text.length; n++) {
    let end = Math.min(text.length, i + LIMIT - 4096);
    const cut = text.lastIndexOf("<", end);
    if (end < text.length && cut > i + 1000) end = cut;
    write(`${dir}/${name}-${n}.html`, text.slice(i, end));
    parts.push(`${name}-${n}.html`);
    i = end;
  }
  return parts;
}
const slugOf = (u) => { const p = new URL(u).pathname.replace(/\/+$/, ""); return (p ? p.slice(1).replace(/[^A-Za-z0-9._-]+/g, "__") : "home").slice(0, 120) || "home"; };

const site = { url: start.href, origin, startedAt: new Date().toISOString(), tool: "programmatic-enterprise-web-performance/snapshot-site.mjs",
  userAgent: UA, gapMs, runs, maxPages, perGroup, profiles, ignoreRobots, excludes: excludeSrc, include, note, pages: [], skipped: [], stoppedEarly: null };
let exit = 0;
let browser = null;

// G9: CPU use of the whole machine while the speed runs go. A reading is the share of non-idle time across all cores since the previous
// reading (os.cpus() times are cumulative). A timer takes one every 2 s and is unref'd (it never keeps the process alive); stop() clears it,
// and the run calls tick() after each page so even a short run has a reading. PEWP_TEST_CPU_PCT replaces the real number (tests only).
const cpuTimes = () => { let idle = 0, total = 0; for (const c of os.cpus()) { for (const [k, v] of Object.entries(c.times)) { total += v; if (k === "idle") idle += v; } } return { idle, total }; };
function makeSampler(intervalMs = 2000) {
  const fake = process.env.PEWP_TEST_CPU_PCT != null && process.env.PEWP_TEST_CPU_PCT !== "" ? Number(process.env.PEWP_TEST_CPU_PCT) : NaN;
  const samples = []; // { t: ms, pct }
  let prev = cpuTimes(), timer = null, started = false;
  const tick = () => {
    let pct;
    if (Number.isFinite(fake) && fake >= 0 && fake <= 100) pct = fake;
    else {
      const now = cpuTimes(), dt = now.total - prev.total, di = now.idle - prev.idle;
      prev = now;
      if (dt <= 0) return;
      pct = Math.min(100, Math.max(0, (1 - di / dt) * 100));
    }
    samples.push({ t: Date.now(), pct });
  };
  return {
    samples, tick,
    get started() { return started; },
    start() { started = true; if (!timer) { timer = setInterval(tick, intervalMs); timer.unref(); } },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    avgSince(t0) { const v = samples.filter((x) => x.t >= t0).map((x) => x.pct); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; },
  };
}
const sampler = makeSampler();
const trustOf = (avg) => (avg == null ? "UNTRUSTED: machine load not sampled" : avg > busyPct ? `UNTRUSTED: machine busy (cpu avg ${Math.round(avg)}%)` : "trusted");
try {
  // Site level: robots, sitemaps, probes.
  log(`robots.txt for ${origin}`);
  const rob = await get(`${origin}/robots.txt`);
  const robotsTxt = rob.status === 200 ? rob.body.toString("utf8") : "";
  if (rob.status === 200) write("site/robots.txt", robotsTxt.length > LIMIT ? robotsTxt.slice(0, LIMIT) : robotsTxt);
  const robots = parseRobots(robotsTxt);
  writeJson("site/robots.json", { status: rob.status ?? rob.error, headers: rob.headers, bytes: rob.bytes, ...robots });

  const sitemapUrls = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
  const seenMaps = new Set();
  const sm = { fetched: [], urls: [] };
  const queue = [...sitemapUrls];
  while (queue.length && seenMaps.size < 25) {
    const u = queue.shift();
    if (seenMaps.has(u)) continue;
    seenMaps.add(u);
    const r = await get(u);
    // gunzip only real gzip bytes (a server that sends .xml.gz with Content-Encoding: gzip arrives already unpacked); a broken
    // archive is this sitemap's error, not a crash of the run. Only a 200 is a sitemap (a 404 page is not saved as one).
    let xml = "", xmlError = null;
    if (r.body && r.status === 200) {
      try { xml = r.body[0] === 0x1f && r.body[1] === 0x8b ? zlib.gunzipSync(r.body).toString("utf8") : r.body.toString("utf8"); }
      catch (e) { xmlError = `could not unpack: ${e.message}`; }
    }
    const name = `site/sitemap-${seenMaps.size}.xml`;
    if (xml) Buffer.byteLength(xml) <= LIMIT ? write(name, xml) : write(name + ".gz", zlib.gzipSync(xml));
    const locs = [...xml.matchAll(/<(sitemap|url)>([\s\S]*?)<\/\1>/g)].map((m) => ({ kind: m[1], loc: (m[2].match(/<loc>\s*([^<]+?)\s*<\/loc>/) || [])[1], lastmod: (m[2].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/) || [])[1] }));
    sm.fetched.push({ url: u, status: r.status ?? r.error, ...(xmlError || r.error ? { error: xmlError || r.error } : {}), contentType: r.headers?.["content-type"], bytes: r.bytes, file: xml ? name + (Buffer.byteLength(xml) <= LIMIT ? "" : ".gz") : null,
      entries: locs.length, withLastmod: locs.filter((l) => l.lastmod).length, sampleLastmod: locs.find((l) => l.lastmod)?.lastmod });
    for (const l of locs) if (l.loc) (l.kind === "sitemap" ? queue.push(l.loc) : sm.urls.push(l));
  }
  writeJson("site/sitemaps.json", { declaredInRobots: robots.sitemaps, ...sm, urlCount: sm.urls.length, urls: sm.urls.slice(0, 2000) });

  const probes = {};
  const rnd = `/pewp-not-found-${Date.now().toString(36)}`;
  probes.notFound = await getChain(origin + rnd).then((x) => ({ path: rnd, chain: x.chain, finalStatus: x.final.status, bytes: x.final.bytes }));
  if (start.protocol === "https:") probes.httpToHttps = (await getChain(`http://${start.host}/`)).chain;
  const alt = start.hostname.startsWith("www.") ? start.hostname.slice(4) : `www.${start.hostname}`;
  if (!/\.pages\.dev$|\.vercel\.app$|\.netlify\.app$|^localhost$|^\d/.test(start.hostname)) probes.hostVariant = (await getChain(`https://${alt}/`)).chain;
  writeJson("site/probes.json", probes);

  // Choose pages: home, --include, then sitemap URLs grouped by first path segment (falls back to home's links).
  const pick = [start.href];
  for (const p of include) pick.push(new URL(p, origin).href);
  let candidates = sm.urls.map((l) => l.loc).filter((u) => { try { return new URL(u).origin === origin; } catch { return false; } });
  const homeChain = await getChain(start.href);
  const homeHtml = homeChain.final.body ? homeChain.final.body.toString("utf8") : "";
  if (!candidates.length) candidates = [...new Set([...homeHtml.matchAll(/href="([^"#]+)"/g)].map((m) => { try { const u = new URL(m[1], start.href); u.hash = ""; return u.origin === origin ? u.href : null; } catch { return null; } }).filter(Boolean))];
  const groups = new Map();
  for (const u of candidates) {
    const p = new URL(u).pathname;
    if (/\.(xml|pdf|jpe?g|png|webp|gif|svg|ico|txt|js|css|json|zip)$/i.test(p)) continue;
    const segs = p.split("/").filter(Boolean);
    const key = segs.length ? `${segs[0]}${segs.length > 1 ? "/*" : ""}` : "/";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  for (const [, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const step = Math.max(1, Math.floor(list.length / perGroup));
    for (let i = 0, n = 0; i < list.length && n < perGroup; i += step, n++) pick.push(list[i]);
  }
  const chosen = [];
  for (const u of pick) {
    const p = new URL(u).pathname;
    if (chosen.includes(u) || chosen.length >= maxPages) continue;
    if (excludes.some((re) => re.test(p))) { site.skipped.push({ url: u, why: "excluded by --exclude" }); continue; }
    if (!ignoreRobots && !robotsAllows(robots.starRules, p)) { site.skipped.push({ url: u, why: "robots.txt disallows" }); continue; }
    chosen.push(u);
  }
  site.groups = Object.fromEntries([...groups.entries()].map(([k, v]) => [k, v.length]));
  log(`${candidates.length} candidate URLs in ${groups.size} groups; checking ${chosen.length}`);

  // Server pass: the HTML exactly as sent, split so it can be read.
  for (const u of chosen) {
    const slug = slugOf(u);
    const dir = `pages/${slug}`;
    const r = u === start.href ? homeChain : await getChain(u);
    const f = r.final;
    const entry = { url: u, slug, status: f.status ?? f.error, finalUrl: f.url, redirects: r.chain.length - 1 };
    if (f.body) {
      const html = f.body.toString("utf8");
      write(`${dir}/raw.html.gz`, zlib.gzipSync(html));
      const headEnd = html.search(/<\/head>/i);
      const { html: headEl, blocks: hb } = elide(headEnd > 0 ? html.slice(0, headEnd + 7) : "");
      const { html: bodyEl, blocks: bb } = elide(headEnd > 0 ? html.slice(headEnd + 7) : html);
      entry.files = [...splitWrite(dir, "head", headEl), ...splitWrite(dir, "body", bodyEl)];
      writeJson(`${dir}/inline.json`, { head: hb, body: bb, totalElidedBytes: [...hb, ...bb].reduce((a, b) => a + b.bytes, 0) });
    }
    // mainTextHash (AEO-012): compared across two snapshots with the sitemap lastmod (compare.mjs --freshness): lastmod moved, text not = fake freshness
    writeJson(`${dir}/response.json`, { url: u, finalUrl: f.url, status: f.status, error: f.error, chain: r.chain, headers: f.headers, ttfbMs: f.ttfbMs, totalMs: f.totalMs, htmlBytes: f.bytes, mainTextHash: f.body ? mainTextHash(f.body.toString("utf8")) : null, fetchedAt: new Date().toISOString(), userAgent: UA });
    site.pages.push(entry);
    log(`  ${entry.status} ${u}${entry.redirects ? ` (${entry.redirects} redirect)` : ""}`);
  }

  // Browser pass: real Chrome, one page at a time, the same 429 rule.
  if (useBrowser) {
    browser = await launchBrowser();
    site.browser = browser.version;
    site.browserFailures = [];
    // One page can never hold the run: a measurement that errors or passes the page cap is recorded, Chrome is
    // restarted fresh, and the run moves on.
    const measure = async (url, profile) => {
      let timer;
      try {
        return await Promise.race([measurePage(browser, url, { profile }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`page cap ${pageCapMs / 1000} s passed`)), pageCapMs); })]);
      } catch (err) {
        site.browserFailures.push({ url, profile, error: String(err.message || err).slice(0, 200) });
        log(`  browser failed on ${url}: ${err.message}; restarting Chrome`);
        try { await Promise.race([browser.close(), sleep(10000)]); } catch {}
        browser = await launchBrowser();
        return null;
      } finally { clearTimeout(timer); }
    };
    sampler.start();
    for (const e of site.pages.filter((p) => p.status === 200)) {
      const pageStart = Date.now();
      for (const profile of profiles) {
        // Lab numbers swing from run to run: measure --runs times and keep the median of each metric.
        const all = [];
        for (let k = 0; k < runs; k++) {
          if (Date.now() > deadline) throw new Stop(`run time cap of ${maxMinutes} min reached`, 4);
          const wait = lastRequest + gapMs - Date.now();
          if (wait > 0) await sleep(wait);
          let m = await measure(e.url, profile);
          lastRequest = Date.now();
          if (m && m.status429.length) {
            // the same per-run allowance as the server pass: a 429 there earlier means this one stops the run
            try { await on429(e.url, `in the browser (${m.status429.length} request(s)) on`); }
            catch (err) { writeJson(`pages/${e.slug}/browser-${profile}.json`, m); throw err; }
            m = await measure(e.url, profile);
            lastRequest = Date.now();
            if (m && m.status429.length) { writeJson(`pages/${e.slug}/browser-${profile}.json`, m); await on429(e.url, "in the browser on"); }
          }
          if (m) all.push(m);
        }
        sampler.tick();
        if (!all.length) { e[profile] = { failed: true }; log(`  ${profile} ${e.url}: NOT MEASURED (every run failed, see _site.json browserFailures)`); continue; }
        const med = (xs) => { const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
        const keys = ["lcpMs", "cls", "tbtMs", "fcpMs", "ttfbMs", "loadMs"];
        const vitals = Object.fromEntries(keys.map((k) => [k, med(all.map((m) => m.vitals[k]))]));
        const rep = [...all].sort((a, b) => (a.vitals.lcpMs ?? 1e9) - (b.vitals.lcpMs ?? 1e9))[Math.floor((all.length - 1) / 2)];
        const m = { ...rep, vitals: { ...rep.vitals, ...vitals }, method: `median of ${all.length} run(s); other fields from the median-LCP run`,
          runs: all.map((x) => ({ lcpMs: x.vitals.lcpMs && Math.round(x.vitals.lcpMs), cls: x.vitals.cls, tbtMs: x.vitals.tbtMs, fcpMs: x.vitals.fcpMs && Math.round(x.vitals.fcpMs), requests: x.totals.requests, bytes: x.totals.bytes, timedOut: x.timedOut })) };
        writeJson(`pages/${e.slug}/browser-${profile}.json`, m);
        e[profile] = { lcpMs: m.vitals.lcpMs && Math.round(m.vitals.lcpMs), cls: m.vitals.cls != null ? Number(m.vitals.cls.toFixed(3)) : null, tbtMs: m.vitals.tbtMs, requests: m.totals.requests, kb: Math.round(m.totals.bytes / 1024), errors: m.errors.length, timedOut: all.some((x) => x.timedOut), runs: all.length };
        log(`  ${profile} ${e.url}: LCP ${e[profile].lcpMs} ms, CLS ${e[profile].cls}, TBT ${e[profile].tbtMs} ms (median of ${all.length}), ${e[profile].requests} requests, ${e[profile].kb} KB${e[profile].timedOut ? " (A RUN TIMED OUT)" : ""}`);
      }
      if (profiles.some((p) => e[p] && !e[p].failed)) { e.speedTrust = trustOf(sampler.avgSince(pageStart)); if (e.speedTrust !== "trusted") log(`  ${e.url}: speed ${e.speedTrust}; take the PageSpeed Insights number (psi.mjs) instead`); }
    }
  }
} catch (e) {
  if (e instanceof Stop) { site.stoppedEarly = e.message; exit = e.code; console.error(`STOPPED: ${e.message}`); }
  else { site.stoppedEarly = `error: ${e.stack || e}`; exit = 1; console.error(e); }
} finally {
  sampler.stop();
  if (browser) await browser.close();
  if (sampler.started) {
    const v = sampler.samples.map((x) => x.pct);
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, max = v.length ? Math.max(...v) : null;
    site.machineLoad = { cpuPctAvg: avg == null ? null : Number(avg.toFixed(1)), cpuPctMax: max == null ? null : Number(max.toFixed(1)), samples: v.length, thresholdPct: busyPct };
    if (v.length) log(`machine load during speed runs: avg ${Math.round(avg)}% max ${Math.round(max)}% -> speed ${avg > busyPct ? "UNTRUSTED" : "trusted"}`);
    else log("machine load during speed runs: not sampled -> speed UNTRUSTED");
  } else site.machineLoad = null;
  Object.assign(site, { finishedAt: new Date().toISOString(), requests, rateLimited });
  // REF-013: every service worker any measured page registered, in the shape ref-sw.mjs reads.
  if (useBrowser) {
    const regs = new Map();
    for (const e of site.pages) for (const prof of profiles) {
      try { for (const r of JSON.parse(fs.readFileSync(path.join(out, "pages", e.slug, `browser-${prof}.json`), "utf8")).serviceWorkers || []) if (r.scriptURL) regs.set(r.scriptURL + " " + r.scope, r); } catch {}
    }
    writeJson("site/serviceworkers.json", { capturedAt: new Date().toISOString(), source: "real Chrome, navigator.serviceWorker.getRegistrations() after each measured page load", registrations: [...regs.values()] });
  }
  writeJson("_site.json", site);
  write("README.md", `# Snapshot of ${site.url}\n\nMade by \`snapshot-site.mjs\` on ${site.startedAt}. Start with \`_site.json\` (pages, groups, skipped, stoppedEarly).\n${note ? `\nNote from whoever ran it: ${note}\n` : ""}\nThis folder is evidence about a LIVE site, not its source code. \`file:line\` in findings points at these saved files; the fix belongs on the site (or its platform). Re-run the snapshot, then \`node .checks/run-all.mjs\`, to see whether a fix landed.\n`);
}
log(`${exit === 0 ? "SNAPSHOT DONE" : "SNAPSHOT INCOMPLETE"}: ${site.pages.length} pages, ${requests} HTTP requests, ${rateLimited} rate-limit responses -> ${out}`);
// Let open keep-alive sockets close before exiting: process.exit() while one is closing trips a libuv assertion on
// Windows (exit 3221226505 after a successful run). A fallback timer still guarantees the process ends.
process.exitCode = exit;
setTimeout(() => process.exit(exit), 8000).unref();
