// The directory pages (Yellow Pages, BBB, MapQuest, Yelp), read by a script in the work browser: capture-directories as a program step (owner, 2026-11-22: the work browser's scripts do the reads for the assistants, Bing, Maps and the site).
// Usage: node read-directories.mjs <url or profile:slug> [--cwd DIR] [--port N] [--pages-file F]
// It reads <pewp>/approved/business.json (the name is name, else legalName; the city is market.city, else the city of the first location that has an address) and the "directories" block of read-pages.json:
//   { "<host>": { "search": "<address with {name} and {city}>", "selectors": "NOT SET" | { result, name, address?, phone?, link?, noResults? } } }.
// Each directory that has a description is ONE page in ONE tab of the work browser (opened plainly, drv.openPlain of read-bing.mjs, the same driver): it loads the search address (the name and the city encoded into it, on the host of
// its key), waits afterLoadSeconds, makes the robot-check look, reads the page by its description, and waits out gapSeconds before the next load. It types nothing, clicks nothing, scrolls nothing, never loads a page a second time and never retries one.
// THE PACE is the pace block of read-pages.json, the one read-bing.mjs reads (checkReadPace of read-bing.mjs, checked before any page is loaded: exit 2, the key named). Every wait goes through pause of lib-ask-pace.mjs; nothing is random and no
// flag changes a wait. A directory that is NOT SET is not opened (left, "no page description"); a directory with a stop in force (lib-stops.mjs) is not opened (left, "stopped").
// A robot or human check on a page, or an answer of HTTP 429 or 403: the tab is closed, a 24 h stop is written for THAT host only, the directory is left, and the run goes on with the next directory (another host). A sign-in wall or a consent
// wall that hides the results is not gathered and writes no stop; the run goes on. A page with ZERO result blocks is "not listed" only when the description's optional "noResults" selector matches on it; without that sign the directory is left ("the page description may be out of date"), no row, no stop, not read.
// THE MATCH, in this order (listingFrom): a block whose normName (local-lib.mjs) equals the business name is the listing; else a block whose phone has the same last 10 digits as the business phone (business.phone, else the first location's phone) is; else, when a block's name
// and the business name differ only by a trailing word (one starts with the other plus a space: a near name) nothing is decided: no row, the directory is left ("a listing with a near name (...) that no phone confirms"), no stop, not read; else listed:false. The row is { directory, url, name, address, phone, capturedAt, capturedIn: "work browser" } (url: the link of the block,
// else the page address). No listing and no near name: { directory, url: <page address>, listed: false, capturedAt, capturedIn } (local-nap.mjs reads listed:false as NOT LISTED). An empty address or phone is null.
// <pewp>/captures/local/citations.json is an array: the rows of the directories read in THIS run replace the earlier rows of the same directory, the rows of the other directories stay. One record per run:
// <pewp>/captures/local/directories-read.json { step: "capture-directories", at, read, already: [], left: [{directory, why}], stops: [{directory, reason, until}] } (an exit 3 adds status "blocked" and blocked).
// What is NOT done here, ever: a changed or invented browser identity, a stealth patch, a faked pointer, a fresh profile, a changed exit, no location override and no permission grant. They disguise a script and are not ours.
// Last line: READ: directories <n> read, <m> left. Exit 0 = at least one directory read. 3 = BLOCKED (nothing could be read, no name or city, no work browser). 2 = usage, a bad pace block or a bad description.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drv, checkReadPace, decide, isCheck, wallOf } from "./read-bing.mjs";
import { isStopped, writeStop } from "./lib-stops.mjs";
import { context } from "./research-lib.mjs";
import { normName } from "./local-lib.mjs";
import { pause, PaceError } from "./lib-ask-pace.mjs";
import { isMain } from "./lib-main.mjs";

export { drv };
const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "usage: node read-directories.mjs <url or profile:slug> [--cwd DIR] [--port N] [--pages-file F]";
const FLAGS = new Set(["cwd", "port", "pages-file"]);   // no other flag: none of them changes the pace
const NO_PAGE = "no page description", CAP_WHY = "over this run's cap", STOPPED = "stopped";
const NEAR = "a listing with a near name (", NEAR_END = ") that no phone confirms";
const NO_BLOCKS = "no result blocks on the page and no no-results sign (the page description may be out of date)";
const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const orNull = (s) => clean(s) || null;
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const stopName = (host) => host.replace(/\./g, "-");   // the stop file of a host: yelp.com -> yelp-com.json

// ---------------------------------------------------------------- the pure parts
// the search address of a directory: the template with {name} and {city} filled in one pass by encodeURIComponent; it must be https and stay on the host of its key (or a subdomain of it)
export function addressOf(host, template, { name, city }) {
  if (typeof template !== "string" || !template.includes("{name}") || !template.includes("{city}")) throw new Error("the search address of " + host + " must hold {name} and {city}");
  const vals = { name, city }, filled = template.replace(/\{(name|city)\}/g, (m, k) => encodeURIComponent(vals[k]));
  let u; try { u = new URL(filled); } catch { throw new Error("the search address of " + host + " is not an address: " + template); }
  if (u.protocol !== "https:" || !(u.hostname === host || u.hostname.endsWith("." + host))) throw new Error("the search address of " + host + " leaves " + host + " (" + u.protocol + "//" + u.hostname + ")");
  return filled;
}

const STATE = /^[A-Za-z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;
// the city of one location address: a structured address, or "street, city, ST, zip" (the part before the state)
function cityOfAddress(a) {
  if (a && typeof a === "object") return orNull(a.addressLocality || a.locality || a.city);
  const parts = String(a || "").split(",").map(clean).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) if (STATE.test(parts[i])) return orNull(parts[i - 1]);
  return null;
}
export const nameOf = (b) => orNull(b && (b.name || b.legalName));
export const phoneOf = (b) => orNull(b && (b.phone || ((b.locations || []).find((l) => l && l.phone) || {}).phone));
export function cityOf(b) {
  const m = orNull(b && b.market && b.market.city);
  if (m) return m;
  const loc = ((b && b.locations) || []).find((l) => l && l.address);
  return loc ? cityOfAddress(loc.address) : null;
}

// blocks: [{ name, address, phone, link }] as the page gave them -> the row of this directory
const last10 = (s) => String(s == null ? "" : s).replace(/\D/g, "").slice(-10);
export function listingFrom({ host, blocks, businessName, businessPhone = null, pageUrl, now = new Date() }) {
  const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean), want = normName(businessName), ph = last10(businessPhone);
  const byName = list.find((b) => normName(b.name) === want), byPhone = ph.length === 10 ? list.find((b) => last10(b.phone) === ph) : null, hit = byName || byPhone;
  const near = hit ? null : list.find((b) => { const n = normName(b.name); return n && want && (n.startsWith(want + " ") || want.startsWith(n + " ")); });
  if (near) return { near: orNull(near.name) };
  const base = { directory: host };
  if (!hit) return { ...base, url: pageUrl, listed: false, capturedAt: now.toISOString(), capturedIn: "work browser" };
  return { ...base, url: orNull(hit.link) || pageUrl, name: orNull(hit.name), address: orNull(hit.address), phone: orNull(hit.phone), capturedAt: now.toISOString(), capturedIn: "work browser" };
}
// the earlier rows of the directories read in this run go; every other row stays; the new rows follow
export const mergeRows = (existing, rows) => [...existing.filter((r) => !rows.some((n) => n.directory === (r && r.directory))), ...rows];

export const makeRecord = ({ at, read, left, stops }) => ({ step: "capture-directories", at, read, already: [], left, stops });
export const lastLine = (rec) => "READ: directories " + rec.read.length + " read, " + rec.left.length + " left";

// ---------------------------------------------------------------- the browser: the in-page reader (every other browser function is drv of read-bing.mjs)
function readInPage(d) {
  const txt = (e) => (e ? (e.textContent || "").replace(/\s+/g, " ").trim() : "");
  const blocks = Array.from(document.querySelectorAll(d.result)).map((b) => {
    const one = (sel) => (sel ? b.querySelector(sel) : null), a = one(d.link);
    return { name: txt(one(d.name)) || null, address: txt(one(d.address)) || null, phone: txt(one(d.phone)) || null, link: a ? String(a.href || a.getAttribute("href") || "") || null : null };
  });
  const nav = performance.getEntriesByType("navigation")[0];
  const noResults = d.noResults ? !!document.querySelector(d.noResults) : false;
  return { href: location.href, title: document.title, status: nav && Number.isFinite(nav.responseStatus) ? nav.responseStatus : 0, bodyText: document.body ? document.body.innerText.slice(0, 20000) : "", blocks, noResults };
}
export const readerExpr = (desc) => "(" + readInPage.toString() + ")(" + JSON.stringify(desc) + ")";

// ---------------------------------------------------------------- the run
export async function run(argv, opts = {}) {
  const say = (line, isErr = false) => (opts.out ? opts.out(line) : (isErr ? console.error : console.log)(line));
  const bye = (code, line) => { say(line, code === 2); return { code }; };
  const pos = [], opt = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { pos.push(argv[i]); continue; }
    if (!FLAGS.has(argv[i].slice(2))) return bye(2, "unknown option " + argv[i] + " (no flag changes the pace; it is the pace block of read-pages.json)\n" + USAGE);
    if (i + 1 >= argv.length) return bye(2, argv[i] + " needs a value\n" + USAGE);
    opt.set(argv[i].slice(2), argv[++i]);
  }
  if (pos.length !== 1) return bye(2, "the site's address is needed\n" + USAGE);
  const url = pos[0], cwd = opt.get("cwd") || process.cwd(), pagesFile = opt.get("pages-file") || path.join(here, "read-pages.json");
  let port = opt.has("port") ? Number(opt.get("port")) : null;
  if (opt.has("port") && !Number.isInteger(port)) return bye(2, "--port is a whole number\n" + USAGE);

  let pages, pace;
  try { pages = readJson(pagesFile); } catch (e) { return bye(2, "cannot read " + pagesFile + ": " + e.message); }
  try { pace = checkReadPace(pages.pace); } catch (e) { if (e instanceof PaceError) return bye(2, e.message + " (key: " + e.key + ")\n" + USAGE); throw e; }   // before any page is loaded
  const block = pages.directories && typeof pages.directories === "object" && !Array.isArray(pages.directories) ? pages.directories : {};
  const hosts = Object.keys(block), descs = new Map();
  for (const h of hosts) {   // every description is checked before any page is loaded: the key is named
    const d = block[h];
    if (!d || typeof d !== "object") return bye(2, "the directory " + h + " in read-pages.json is an object { search, selectors }\n" + USAGE);
    try { addressOf(h, d.search, { name: "x", city: "y" }); } catch (e) { return bye(2, e.message + " (key: " + h + ")\n" + USAGE); }
    if (d.selectors === "NOT SET") continue;
    const s = d.selectors;
    if (!s || typeof s !== "object" || Array.isArray(s)) return bye(2, "the page description for " + h + " is \"NOT SET\" or an object { result, name, address?, phone?, link?, noResults? }\n" + USAGE);
    for (const k of ["result", "name"]) if (typeof s[k] !== "string" || !s[k].trim()) return bye(2, "the page description for " + h + " has no " + k + " (a CSS selector)\n" + USAGE);
    for (const k of ["address", "phone", "link", "noResults"]) if (s[k] !== undefined && typeof s[k] !== "string") return bye(2, "the page description for " + h + ": " + k + " is a CSS selector (a string)\n" + USAGE);
    descs.set(h, s);
  }

  let ctx;
  try { ctx = context(url, { cwd }); } catch (e) { return bye(2, "cannot place the run for " + url + ": " + e.message + "\n" + USAGE); }
  const local = path.join(ctx.pewp, "captures", "local"), citFile = path.join(local, "citations.json"), recFile = path.join(local, "directories-read.json");
  let biz = null; try { biz = readJson(path.join(ctx.pewp, "approved", "business.json")); } catch { biz = null; }
  const name = nameOf(biz), city = cityOf(biz);
  if (!name || !city) return bye(3, "BLOCKED: " + (!biz ? "no approved/business.json" : "approved/business.json has no " + (!name ? "name" : "city")) + " | unblocks: approve-business");
  let existing = [];
  if (fs.existsSync(citFile)) { try { existing = readJson(citFile); } catch { existing = null; } if (!Array.isArray(existing)) return bye(3, "BLOCKED: " + citFile + " is not a JSON array of rows | unblocks: fix or remove that file"); }

  // the plan: who is not opened, and why
  const read = [], rows = [], left = [], stops = [], todo = [];
  for (const h of hosts) {
    const st = isStopped(h);
    if (!descs.has(h)) left.push({ directory: h, why: NO_PAGE });
    else if (st) { left.push({ directory: h, why: STOPPED }); stops.push({ directory: h, reason: st.reason, until: st.until }); }
    else if (todo.length >= pace.maxPagesPerRun) left.push({ directory: h, why: CAP_WHY });
    else todo.push(h);
  }
  const finish = (blockedLine = null) => {
    const rec = makeRecord({ at: new Date().toISOString(), read, left, stops }), ok = read.length > 0;
    const last = ok ? null : blockedLine || "BLOCKED: no directory could be read (" + ([...new Set(left.map((l) => l.why))].join("; ") || "no directory in read-pages.json") + ")" + (stops.length ? " | outside: stop" : "");
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(recFile, JSON.stringify(ok ? rec : { ...rec, status: "blocked", blocked: last }, null, 1) + "\n");
    if (ok) fs.writeFileSync(citFile, JSON.stringify(mergeRows(existing, rows), null, 1) + "\n");
    say(lastLine(rec));
    if (!ok) say(last);
    return { code: ok ? 0 : 3 };
  };

  if (!todo.length) return finish();   // nothing to load: no browser is needed
  if (!port) { try { port = Number(await drv.workPort()) || null; } catch { port = null; } }
  const noBrowser = (why) => { for (const h of todo) left.push({ directory: h, why: "no work browser" }); return finish("BLOCKED: " + why + " | unblocks: node work-browser.mjs open"); };
  if (!port) return noBrowser("the work browser is not open");
  let cdp = null, tab = null;
  try { cdp = await drv.connect(port); } catch (e) { return noBrowser("the work browser does not answer on port " + port + " (" + e.message + ")"); }

  try {
    let loaded = 0;
    for (const h of todo) {
      if (loaded > 0) await pause(pace.gapSeconds, "gap before the next load");
      loaded++;
      let pg;
      try {
        const address = addressOf(h, block[h].search, { name, city });
        if (!tab) tab = await drv.openPlain(cdp, address); else await drv.navigate(cdp, tab, address);
        await pause(pace.afterLoadSeconds, "after load");
        pg = await drv.evalIn(cdp, tab.sessionId, readerExpr(descs.get(h)));
        if (!pg || typeof pg !== "object") throw new Error("the page gave nothing");
      } catch (e) {
        left.push({ directory: h, why: "the page could not be read: " + e.message });
        if (tab) { await drv.closePage(cdp, tab.targetId); tab = null; }
        continue;
      }
      const href = String(pg.href || ""), title = String(pg.title || ""), text = String(pg.bodyText || "");
      const verdict = decide({ status: Number(pg.status), check: isCheck(href, title, text), wall: null, matched: 1 });   // a check or a refusal; a wall is judged below, it is no stop
      if (verdict.act === "stop") {
        await drv.closePage(cdp, tab.targetId); tab = null;
        const reason = verdict.reason.replace(/^bing /, h + " ");
        const w = writeStop({ engine: stopName(h), hosts: [h], reason, setBy: "read-directories.mjs", evidence: "the results page of " + h });
        stops.push({ directory: h, reason, until: w.stop.until });
        left.push({ directory: h, why: reason });
        continue;
      }
      const blocks = Array.isArray(pg.blocks) ? pg.blocks : [], wall = blocks.length ? null : wallOf(href, text);
      if (wall) { left.push({ directory: h, why: wall + " hides the results" }); continue; }
      if (!blocks.length && pg.noResults !== true) { left.push({ directory: h, why: NO_BLOCKS }); continue; }   // nothing to read and no sign of "no results": the page description may be out of date, so this is no "not listed"
      const lf = listingFrom({ host: h, blocks, businessName: name, businessPhone: phoneOf(biz), pageUrl: href || addressOf(h, block[h].search, { name, city }) });
      if (lf.near) { left.push({ directory: h, why: NEAR + lf.near + NEAR_END }); continue; }   // a near name no phone confirms: not gathered, no row, no stop
      rows.push(lf);
      read.push(h);
      say("read " + h + (rows[rows.length - 1].listed === false ? " (not listed)" : " (listed)"));
    }
  } finally {
    if (tab) await drv.closePage(cdp, tab.targetId);
    cdp.close();
  }
  return finish();
}

if (isMain(import.meta.url)) {
  let r;
  try { r = await run(process.argv.slice(2)); } catch (e) { console.error(e.stack || e); r = { code: 1 }; }
  process.exit(r.code);
}
