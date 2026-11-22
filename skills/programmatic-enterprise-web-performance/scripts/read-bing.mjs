// The Bing result pages, read by a script in the work browser (owner, 2026-11-22: the work browser's scripts do the clicks for the assistants, Bing, Maps and the site reads).
// Bing is not a host of the other search company: it is the first results page we may read by script, politely, at one fixed pace, and a robot check is a hard stop.
// Usage: node read-bing.mjs <url or profile:slug> [--cwd DIR] [--port N] [--pages-file F]
// It reads <pewp>/research/capture-requests.json, takes the items whose engine is bing in file order, leaves out each one whose capture file already exists and is not older than 30 days,
// (each DISTINCT query once, whatever device the request asks for: it is read in the work browser's own desktop window, nothing emulated, and the capture says device "desktop" and, when desktop was
// not asked for, "asked for <devices>; read in a desktop window" in its notes; the importer flags a device other than the wanted one, it never rejects it), and for the others, ONE after another in ONE tab of the work browser: loads https://www.bing.com/search?q=<query> (nothing else in the address), waits afterLoadSeconds, makes the
// robot-check look, reads the page by its description, writes the capture, and waits out the gap before the next load. It types nothing, clicks nothing, scrolls nothing, opens no
// second tab, never loads a page a second time and never retries one.
// THE PACE AND THE PAGE DESCRIPTION are one file, read-pages.json: { "pace": { tabsAtOnce 1, afterLoadSeconds 3..60, gapSeconds 45..600 (never under the 45 s of vantage.mjs), maxPagesPerRun 1..60 },
//   "bing": { "selectors": "NOT SET" } }. A description, once the head has set it live, is { result, link, title, related?, ask?, footerPlace? } (CSS selectors; the object may stand under "selectors" or
//   directly under "bing"). NOT SET = blocked, nothing opened. The pace block is checked before any page is loaded (exit 2, the key named). Every wait goes through pause of lib-ask-pace.mjs
//   (its io.sleep is the one thing a test replaces). Nothing is random, and no flag and no setting outside that file changes a wait.
// A ROBOT CHECK OR A REFUSAL IS THE HARD STOP: a robot or human check on the page, or an answer of HTTP 429 or 403, closes the tab and writes a 24 h stop for bing (lib-stops.mjs); a sign-in wall or a
//   consent wall that hides the results is the same stop with its own reason. Nothing is clicked, dismissed or accepted. Bing has no ring-and-wait. A stop that is already in force is not gone against:
//   nothing is opened. A page whose description matches no result block is not written as an empty capture ("not read"); two of those in a row end the run (the description is stale; no stop).
// The tab is opened plainly (openPlain of vantage.mjs): no permission is granted and no location is set. Bing is read from wherever the work browser's exit is, so a reading is a national baseline
// unless the page itself names the place (the capture's location.footer says what the page said).
// What is NOT done here, ever: a changed or invented browser identity, a stealth patch, a faked pointer, a fresh profile, a changed exit, no location override and no permission grant. They disguise a script and are not ours.
// The capture is the one research-serp-import.mjs reads (captures/serp/<id>.bing.json). One record per run: captures/serp/bing-read.json { step, at, read, already, left, stop } (an exit 3 adds
// status "blocked" and blocked, so that a resume does not take a run that read nothing as done). Last line: READ: bing <r> read, <a> already there, <l> left (, stopped: <reason>).
// Exit 0 = at least one capture read or already there. 3 = BLOCKED (nothing could be read, a stop, no work browser, no description). 2 = usage or a bad pace block.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, openPlain, evalIn, closePage, looksLikeRobotCheck, aiWallReason, GAP_MS } from "./vantage.mjs";
import { isStopped, writeStop } from "./lib-stops.mjs";
import { context, slug } from "./research-lib.mjs";
import { io, pause, PaceError } from "./lib-ask-pace.mjs";
import { isMain } from "./lib-main.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "usage: node read-bing.mjs <url or profile:slug> [--cwd DIR] [--port N] [--pages-file F]";
const FLAGS = new Set(["cwd", "port", "pages-file"]);   // no other flag: none of them changes the pace
const FRESH_DAYS = 30;
const CAP_WHY = "over this run's cap";
const NOT_MATCHED = "not read: the page description matched nothing";
const ROBOT_WORDS = /just a moment|verifying you are human|verify you are (?:a )?human|checking your browser|attention required/i;
const CONSENT = /before you continue|accept (?:all )?cookies|we use cookies|cookie (?:consent|preferences)|consent to (?:the use of )?cookies/i;

// ---------------------------------------------------------------- the pace block
const MIN_GAP_SECONDS = GAP_MS / 1000;
const RANGES = { tabsAtOnce: [1, 1], afterLoadSeconds: [3, 60], gapSeconds: [MIN_GAP_SECONDS, 600], maxPagesPerRun: [1, 60] };
export const PACE_KEYS = Object.keys(RANGES);
export function checkReadPace(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) throw new PaceError("pace", "read-pages.json has no \"pace\" block (an object with the keys " + PACE_KEYS.join(", ") + ")");
  for (const k of Object.keys(block)) if (!Object.hasOwn(RANGES, k)) throw new PaceError(k, "the pace block has a key that is not known: " + k + " (known: " + PACE_KEYS.join(", ") + ")");
  for (const k of PACE_KEYS) {
    const v = block[k], [lo, hi] = RANGES[k];
    if (v === undefined) throw new PaceError(k, "the pace block has no " + k);
    if (typeof v !== "number" || !Number.isInteger(v)) throw new PaceError(k, "pace " + k + " is a whole number, not " + JSON.stringify(v));
    if (k === "tabsAtOnce") { if (v !== 1) throw new PaceError(k, "pace tabsAtOnce must be exactly 1, not " + v); continue; }
    if (v < lo || v > hi) throw new PaceError(k, "pace " + k + " is from " + lo + " to " + hi + ", not " + v);
  }
  return Object.freeze({ ...block });
}

// ---------------------------------------------------------------- the pure parts
export const idOf = (item) => slug(item.id || item.query);
export function addressOf(query) {
  return "https://www.bing.com/search?q=" + encodeURIComponent(query);
}

// items: the request file's items; have(id): null (no capture file) or its age in days; cap: maxPagesPerRun
// -> { toRead: [{ id, item, query, devices }], already: [id], left: [{ id, why }] }
// Each DISTINCT bing query is read ONCE (file order of its first appearance) in the work browser's own desktop window, whatever device or devices the requests for it ask for;
// devices is what was asked (in order of appearance), so that the capture can say so. The cap counts distinct queries.
export function selectItems(items, { have, cap }) {
  const toRead = [], already = [], left = [], groups = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || String(it.engine || "").toLowerCase() !== "bing") continue;
    const query = String(it.query || "").trim();
    if (!query) { left.push({ id: "(no query)", why: "the request has no query" }); continue; }
    const id = idOf(it), device = String(it.device || "desktop").toLowerCase(), key = id;   // one slot per query, whatever the device
    let g = groups.get(key);
    if (!g) { g = { id, item: it, query, devices: [] }; groups.set(key, g); }
    if (!g.devices.includes(device)) g.devices.push(device);
  }
  for (const g of groups.values()) {
    const age = have(g.id);
    if (age !== null && age <= FRESH_DAYS) { already.push(g.id); continue; }
    if (toRead.length >= cap) { left.push({ id: g.id, why: CAP_WHY }); continue; }
    toRead.push(g);
  }
  return { toRead, already, left };
}

const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const uniq = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(clean).filter(Boolean))];
// page: { blocks: [{ url, title }], related, asks, footer } as the page gave it; devices: what the requests asked for (default: the item's own) -> { capture, dropped: { noLink, nonHttp }, matched }
// (matched = result blocks that gave a usable address). The capture always says device "desktop": it was read in the work browser's own desktop window, nothing emulated.
export function buildCapture({ item, page, now = new Date(), devices = [item.device || "desktop"] }) {
  const organic = []; let noLink = 0, nonHttp = 0;
  for (const b of page.blocks || []) {
    const u = clean(b && b.url);
    if (!u) { noLink++; continue; }
    if (!/^https?:\/\//i.test(u)) { nonHttp++; continue; }
    organic.push({ position: organic.length + 1, url: u, title: clean(b.title) });
  }
  const out = [];
  if (noLink) out.push(noLink + " block" + (noLink === 1 ? "" : "s") + " with no link");
  if (nonHttp) out.push(nonHttp + " address" + (nonHttp === 1 ? "" : "es") + " not http or https");
  const capture = {
    query: clean(item.query), engine: "bing", capturedAt: now.toISOString(), browser: "work browser", device: "desktop", language: item.language == null ? null : item.language,
    location: { requested: item.location == null ? null : item.location, footer: clean(page.footer), method: "work browser's own exit" },
    organic, localPack: [], paa: uniq(page.asks), aiOverview: { present: false }, relatedSearches: uniq(page.related), robotCheck: false,
    notes: "read by script in the work browser" + (out.length ? "; left out: " + out.join(", ") : "") + (devices.includes("desktop") ? "" : ". asked for " + devices.join(", ") + "; read in a desktop window"),
  };
  return { capture, dropped: { noLink, nonHttp }, matched: organic.length };
}

// the decision after a load: { status, check, wall, matched } -> { act: "read" } | { act: "stop", reason } | { act: "notread", why }
export function decide({ status, check, wall, matched }) {
  if (status === 429 || status === 403) return { act: "stop", reason: "bing answered HTTP " + status };
  if (check) return { act: "stop", reason: "a robot or human check showed on the results page" };
  if (wall) return { act: "stop", reason: wall + " hides the results" };
  if (!(matched > 0)) return { act: "notread", why: NOT_MATCHED };
  return { act: "read" };
}

export const makeRecord = ({ at, read, already, left, stop }) => ({ step: "capture-bing", at, read, already, left, stop });
export const lastLine = (rec) => "READ: bing " + rec.read.length + " read, " + rec.already.length + " already there, " + rec.left.length + " left" + (rec.stop ? ", stopped: " + rec.stop.reason : "");
// exit 0 when at least one capture is read or already there, else 3 (and the line for it)
export function endOf(rec, blockedLine = null) {
  const line = lastLine(rec);
  if (rec.read.length + rec.already.length > 0) return { code: 0, lines: [line] };
  const why = rec.left.length ? [...new Set(rec.left.map((l) => l.why))].join("; ") : "no bing request in capture-requests.json";
  return { code: 3, lines: [line, blockedLine || "BLOCKED: no bing page could be read (" + (rec.stop ? rec.stop.reason : why) + ")" + (rec.stop ? " | outside: stop" : "")] };
}

// what a wall is, outside a robot check: a sign-in wall or a consent wall (the page text is tested here and thrown away)
function wallOf(href, text) {
  const w = aiWallReason(href, text, 0);
  if (w === "redirected to a sign-in page" || w === "sign-in wall") return w;
  return CONSENT.test(text) ? "consent wall" : null;
}
function isCheck(href, title, text) {
  const w = aiWallReason(href, text, 0);
  return looksLikeRobotCheck(href, text) || w === "bot wall or CAPTCHA" || w === "robot check" || ROBOT_WORDS.test(title) || ROBOT_WORDS.test(text);
}

// ---------------------------------------------------------------- the browser: every function the driver asks of it is here, so that a test can replace them
function readInPage(d) {
  const txt = (e) => (e ? (e.textContent || "").replace(/\s+/g, " ").trim() : "");
  const all = (sel) => (sel ? Array.from(document.querySelectorAll(sel)) : []);
  const blocks = all(d.result).map((b) => {
    const a = d.link ? b.querySelector(d.link) : null, t = d.title ? b.querySelector(d.title) : null;
    return { url: a ? String(a.href || a.getAttribute("href") || "") : "", title: txt(t) };
  });
  const nav = performance.getEntriesByType("navigation")[0], fp = d.footerPlace ? document.querySelector(d.footerPlace) : null;
  return { href: location.href, title: document.title, status: nav && Number.isFinite(nav.responseStatus) ? nav.responseStatus : 0, bodyText: document.body ? document.body.innerText.slice(0, 20000) : "", blocks, related: all(d.related).map(txt), asks: all(d.ask).map(txt), footer: txt(fp).slice(0, 200) };
}
const readerExpr = (desc) => "(" + readInPage.toString() + ")(" + JSON.stringify(desc) + ")";

// the one tab goes to the next address (an address it has not shown yet) and waits for the page to load
async function navigate(cdp, tab, url) {
  let timer = null, listener = null;
  const loaded = new Promise((res) => {
    listener = (m) => { if (m.sessionId === tab.sessionId && m.method === "Page.loadEventFired") res(true); };
    cdp.listeners.add(listener); timer = setTimeout(() => res(false), 30000);
  });
  try { await cdp.send("Page.navigate", { url }, tab.sessionId); return await loaded; }
  finally { cdp.listeners.delete(listener); clearTimeout(timer); }
}
export const drv = {
  workPort: async () => (await import("./work-browser.mjs")).workPort(),
  connect, openPlain, navigate, evalIn, closePage,
};

// ---------------------------------------------------------------- the run
const haveOf = (serp) => (id) => {
  const f = path.join(serp, id + ".bing.json");
  let st; try { st = fs.statSync(f); } catch { return null; }
  let at = NaN; try { at = Date.parse(JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")).capturedAt); } catch { /* an unreadable file: its own date */ }
  return Math.max(0, (Date.now() - (Number.isFinite(at) ? at : st.mtimeMs)) / 86400000);
};

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
  try { pages = JSON.parse(fs.readFileSync(pagesFile, "utf8").replace(/^﻿/, "")); } catch (e) { return bye(2, "cannot read " + pagesFile + ": " + e.message); }
  try { pace = checkReadPace(pages.pace); } catch (e) { if (e instanceof PaceError) return bye(2, e.message + " (key: " + e.key + ")\n" + USAGE); throw e; }   // before any page is loaded
  const cfg = pages.bing;
  if (!cfg || cfg.selectors === "NOT SET") return bye(3, "BLOCKED: no page description for bing yet | unblocks: set it in scripts/read-pages.json");
  const desc = cfg.selectors && typeof cfg.selectors === "object" ? cfg.selectors : cfg;
  for (const k of ["result", "link", "title"]) if (typeof desc[k] !== "string" || !desc[k].trim()) return bye(2, "the page description for bing has no " + k + " (a CSS selector)\n" + USAGE);
  for (const k of ["related", "ask", "footerPlace"]) if (desc[k] !== undefined && typeof desc[k] !== "string") return bye(2, "the page description for bing: " + k + " is a CSS selector (a string)\n" + USAGE);

  let ctx;
  try { ctx = context(url, { cwd }); } catch (e) { return bye(2, "cannot place the run for " + url + ": " + e.message + "\n" + USAGE); }
  const reqFile = path.join(ctx.rdir, "capture-requests.json"), serp = path.join(ctx.pewp, "captures", "serp"), recFile = path.join(serp, "bing-read.json");
  let req = null; try { req = JSON.parse(fs.readFileSync(reqFile, "utf8").replace(/^﻿/, "")); } catch { req = null; }
  if (!req || !Array.isArray(req.items)) return bye(3, "BLOCKED: no research/capture-requests.json to read the bing items from | unblocks: the research-plan step writes it");

  const sel = selectItems(req.items, { have: haveOf(serp), cap: pace.maxPagesPerRun });
  const read = [], left = [...sel.left];
  let stop = null;
  // one record per run, written on every exit from here on; the last lines say what happened
  const finish = (blockedLine = null) => {
    const rec = makeRecord({ at: new Date().toISOString(), read, already: sel.already, left, stop }), e = endOf(rec, blockedLine);
    const doc = e.code === 3 ? { ...rec, status: "blocked", blocked: e.lines[e.lines.length - 1] } : rec;
    fs.mkdirSync(serp, { recursive: true });
    fs.writeFileSync(recFile, JSON.stringify(doc, null, 1) + "\n");
    for (const l of e.lines) say(l);
    return { code: e.code };
  };
  const restLeft = (from, why) => { for (const t of sel.toRead.slice(from)) left.push({ id: t.id, why }); };

  if (!sel.toRead.length) return finish();   // nothing to load: no browser is needed
  const stopped = isStopped("bing");
  if (stopped) {
    stop = { reason: stopped.reason, until: stopped.until };
    restLeft(0, "bing is stopped until " + stopped.until);
    return finish("BLOCKED: bing is stopped until " + stopped.until + " | outside: stop");
  }
  if (!port) { try { port = Number(await drv.workPort()) || null; } catch { port = null; } }
  if (!port) { restLeft(0, "no work browser"); return finish("BLOCKED: the work browser is not open | unblocks: node work-browser.mjs open"); }
  let cdp = null, tab = null;
  try { cdp = await drv.connect(port); } catch (e) { restLeft(0, "no work browser"); return finish("BLOCKED: the work browser does not answer on port " + port + " (" + e.message + ") | unblocks: node work-browser.mjs open"); }

  try {
    let notRead = 0;
    for (let i = 0; i < sel.toRead.length; i++) {
      const t = sel.toRead[i];
      if (i > 0) await pause(pace.gapSeconds, "gap before the next load");
      let pg;
      try {
        const address = addressOf(t.query);
        if (!tab) tab = await drv.openPlain(cdp, address); else await drv.navigate(cdp, tab, address);
        await pause(pace.afterLoadSeconds, "after load");
        pg = await drv.evalIn(cdp, tab.sessionId, readerExpr(desc));
        if (!pg || typeof pg !== "object") throw new Error("the page gave nothing");
      } catch (e) {
        left.push({ id: t.id, why: "the page could not be read: " + e.message });
        restLeft(i + 1, "the run ended: the page could not be read");
        break;
      }
      const built = buildCapture({ item: t.item, page: pg, now: new Date(), devices: t.devices });
      const href = String(pg.href || ""), title = String(pg.title || ""), text = String(pg.bodyText || "");
      const verdict = decide({ status: Number(pg.status), check: isCheck(href, title, text), wall: built.matched > 0 ? null : wallOf(href, text), matched: built.matched });
      if (verdict.act === "stop") {
        await drv.closePage(cdp, tab.targetId); tab = null;
        const { reason } = verdict;
        const w = writeStop({ engine: "bing", reason, setBy: "read-bing.mjs", evidence: "the results page of " + t.id });
        stop = { reason, until: w.stop.until };
        left.push({ id: t.id, why: reason });
        restLeft(i + 1, "the run stopped: " + reason);
        break;
      }
      if (verdict.act === "notread") {
        left.push({ id: t.id, why: verdict.why });
        notRead++;
        if (notRead >= 2) { restLeft(i + 1, "the run ended: the page description matched nothing twice in a row"); break; }
        continue;
      }
      notRead = 0;
      fs.mkdirSync(serp, { recursive: true });
      fs.writeFileSync(path.join(serp, t.id + ".bing.json"), JSON.stringify(built.capture, null, 1) + "\n");
      read.push(t.id);
      say("read " + t.id + " (" + built.matched + " results)");
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
