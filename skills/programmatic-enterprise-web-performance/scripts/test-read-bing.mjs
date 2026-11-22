// Usage: node test-read-bing.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Test of read-bing.mjs (AB-12, owner's job 2): the Bing result pages are read by a script in the work browser, politely, at one fixed pace, and a robot check is a hard stop.
// NO browser and no network: the script is built as pure parts plus a thin driver, and the driver takes every browser function from ONE object (drv) which this test replaces by a fake
// that serves invented pages; the waits go through io.sleep (lib-ask-pace.mjs), which this test replaces by a recorder that returns at once. The real research-serp-import.mjs is run
// (a child process on a fixture folder) to prove that a capture the script builds is accepted. The same read through a REAL browser on invented pages is test-read-bing-browser.mjs
// (a browser test: the head runs it through the machine lock; it is not on the GitHub list).
// Watched-fail mutants: a patch is applied to a copy of the scripts folder and the named assertions must turn red (see lib-test-kit.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const HOST = "read-bing-test.test", SITE = "https://" + HOST + "/";
const PACE = { tabsAtOnce: 1, afterLoadSeconds: 8, gapSeconds: 45, maxPagesPerRun: 30 };
const DESC = { result: "li.b_algo", link: "h2 a", title: "h2", related: ".b_rs a", ask: ".rwrl", footerPlace: "#fl" };
const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)).href);
const DAY = 86400000;

const item = (q, o = {}) => ({ query: q, engine: "bing", device: "desktop", location: "Tracy, CA", language: "en", ...o });
// a page as the in-page reader hands it over
const page = (n, o = {}) => ({ href: "https://www.bing.com/search?q=x", title: "x - Search", status: 200, bodyText: "results for x", blocks: [{ url: "https://site" + n + "-a.test/", title: "A" + n }, { url: "https://site" + n + "-b.test/p", title: "B" + n }], related: ["r" + n], asks: ["Q" + n + "?"], footer: "Tracy, California", ...o });
const checkPage = () => page(0, { title: "Verify you are human", bodyText: "Please verify you are human to continue", blocks: [] });
const blankPage = () => page(0, { blocks: [], related: [], asks: [], footer: "" });

function fresh(tmp, n, items, biz = {}) {
  const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", HOST, ".pewp");
  W(path.join(pewp, "business.json"), { name: "Read Bing Test Realty", domain: HOST, market: { country: "US", language: "en" }, vocabulary: ["homes"], offer: "homes", ...biz });
  if (items) W(path.join(pewp, "research", "capture-requests.json"), { items });
  const serp = path.join(pewp, "captures", "serp");
  return { cwd, pewp, serp, recFile: path.join(serp, "bing-read.json"), rec: () => J(path.join(serp, "bing-read.json")), has: (id) => fs.existsSync(path.join(serp, id + ".bing.json")), cap: (id) => J(path.join(serp, id + ".bing.json")) };
}

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("read-bing"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, []);
  const mod = await imp(dir, "read-bing.mjs"), ace = await imp(dir, "lib-ask-pace.mjs"), stops = await imp(dir, "lib-stops.mjs");
  let stopN = 0;
  const newStops = () => { const d = path.join(tmp, "stops-" + ++stopN); fs.mkdirSync(d, { recursive: true }); process.env.OMNIKOM_STOPS_DIR = d; return d; };
  const pagesFile = (n, o = {}) => { const f = path.join(tmp, n + ".pages.json"); W(f, { pace: PACE, bing: { selectors: DESC }, ...o }); return f; };

  // one run of the driver with the fake browser: the log says what was asked of it
  async function drive(f, { pages = [], pf = pagesFile("p" + stopN), argv = null } = {}) {
    const log = { loads: [], open: 0, maxOpen: 0, connects: 0, ports: 0, evals: 0, closed: 0, waits: [] };
    const savedDrv = { ...mod.drv }, savedSleep = ace.io.sleep, lines = [];
    mod.drv.workPort = async () => { log.ports++; return 9222; };
    mod.drv.connect = async () => { log.connects++; return { close() {}, send: async () => ({}), listeners: new Set() }; };
    mod.drv.openPlain = async (c, url) => { log.loads.push(url); log.open++; log.maxOpen = Math.max(log.maxOpen, log.open); return { sessionId: "s", targetId: "t" + log.loads.length }; };
    mod.drv.navigate = async (c, tab, url) => { log.loads.push(url); };
    mod.drv.evalIn = async () => { log.evals++; return pages[log.loads.length - 1]; };
    mod.drv.closePage = async () => { log.open--; log.closed++; };
    ace.io.sleep = async (ms) => { log.waits.push(ms / 1000); };
    try {
      const r = await mod.run(argv || [SITE, "--cwd", f.cwd, "--pages-file", pf], { out: (l) => lines.push(l) });
      return { ...r, lines, last: lines[lines.length - 1] || "", log };
    } finally { Object.assign(mod.drv, savedDrv); ace.io.sleep = savedSleep; }
  }
  const nothingOpened = (x) => x.log.ports === 0 && x.log.connects === 0 && x.log.loads.length === 0 && x.log.evals === 0;

  try {
    // ------------------------------------------------------------ P1 the pace block
    {
      const bad = [], ok = (o) => { try { mod.checkReadPace({ ...PACE, ...o }); return true; } catch { return false; } };
      const named = (o, key) => { try { mod.checkReadPace({ ...PACE, ...o }); return false; } catch (e) { return e instanceof ace.PaceError && e.key === key && String(e.message).includes(key); } };
      if (!ok({})) bad.push("the settled block is refused");
      if (!ok({ gapSeconds: 45 })) bad.push("45 is refused");
      if (!named({ gapSeconds: 44 }, "gapSeconds")) bad.push("44 is not refused with its key");
      if (!ok({ gapSeconds: 600 }) || !named({ gapSeconds: 601 }, "gapSeconds")) bad.push("gapSeconds 600 / 601");
      if (!named({ gapSeconds: 45.5 }, "gapSeconds") || !named({ gapSeconds: "45" }, "gapSeconds")) bad.push("gapSeconds must be a whole number");
      if (!named({ tabsAtOnce: 2 }, "tabsAtOnce") || !named({ tabsAtOnce: 0 }, "tabsAtOnce")) bad.push("tabsAtOnce must be exactly 1");
      if (!ok({ afterLoadSeconds: 3 }) || !named({ afterLoadSeconds: 2 }, "afterLoadSeconds") || !ok({ afterLoadSeconds: 60 }) || !named({ afterLoadSeconds: 61 }, "afterLoadSeconds")) bad.push("afterLoadSeconds 3 to 60");
      if (!ok({ maxPagesPerRun: 1 }) || !named({ maxPagesPerRun: 0 }, "maxPagesPerRun") || !ok({ maxPagesPerRun: 60 }) || !named({ maxPagesPerRun: 61 }, "maxPagesPerRun")) bad.push("maxPagesPerRun 1 to 60");
      for (const k of Object.keys(PACE)) { const b = { ...PACE }; delete b[k]; try { mod.checkReadPace(b); bad.push("no " + k + " accepted"); } catch (e) { if (e.key !== k) bad.push("a missing " + k + " names " + e.key); } }
      try { mod.checkReadPace({ ...PACE, jitterSeconds: 3 }); bad.push("an unknown key is accepted"); } catch (e) { if (e.key !== "jitterSeconds") bad.push("an unknown key is not named"); }
      for (const b of [null, undefined, [], "pace"]) { try { mod.checkReadPace(b); bad.push("a pace block of " + JSON.stringify(b) + " is accepted"); } catch { /* refused */ } }
      const real = J(path.join(dir, "read-pages.json"));
      let realOk = true; try { mod.checkReadPace(real.pace); } catch { realOk = false; }
      if (!realOk || JSON.stringify(real.pace) !== JSON.stringify(PACE)) bad.push("the shipped read-pages.json pace is not the settled block " + JSON.stringify(PACE) + ": " + JSON.stringify(real.pace));
      check("P1: the pace block: each bad value is refused with its key (44 refused, 45 accepted, tabsAtOnce 2 refused), the shipped file holds the settled block", bad.length === 0, bad.join(" | "));
    }

    // ------------------------------------------------------------ P1b the bing page description
    {
      const real = J(path.join(dir, "read-pages.json"));
      const want = { result: "#b_results > li.b_algo", link: "h2 a", title: "h2", related: ".b_rs a" };
      check("P1b: the shipped read-pages.json holds the bing page description measured on real Bing pages 2026-11-22", JSON.stringify(real.bing && real.bing.selectors) === JSON.stringify(want), JSON.stringify(real.bing));
    }

    // ------------------------------------------------------------ P2 which items are read
    {
      // each DISTINCT bing query once, in the order of its first appearance, whatever device or devices the request asks for
      const items = [item("alpha one"), item("mobile two", { device: "mobile" }), item("beta three"), item("gamma four", { engine: "google" }), item("beta three", { device: "mobile" }), item("delta five"), item("echo six"), item("foxtrot seven")];
      const ages = { "alpha-one": 5, "beta-three": 31 };
      const s = mod.selectItems(items, { have: (id) => (id in ages ? ages[id] : null), cap: 3 });
      const bad = [];
      if (s.toRead.map((x) => x.id).join() !== "mobile-two,beta-three,delta-five") bad.push("toRead " + s.toRead.map((x) => x.id).join());
      if (s.already.join() !== "alpha-one") bad.push("already " + s.already.join());
      if (JSON.stringify(s.toRead.map((x) => x.devices)) !== '[["mobile"],["desktop","mobile"],["desktop"]]') bad.push("devices asked " + JSON.stringify(s.toRead.map((x) => x.devices)));
      const left = Object.fromEntries(s.left.map((x) => [x.id, x.why]));
      if (s.left.map((x) => x.id).join() !== "echo-six,foxtrot-seven") bad.push("left " + s.left.map((x) => x.id).join());
      if (left["echo-six"] !== "over this run's cap" || left["foxtrot-seven"] !== "over this run's cap") bad.push("cap reason: " + left["echo-six"]);
      if (s.left.some((x) => /mobile/i.test(x.why))) bad.push("a mobile reason is still given: " + JSON.stringify(s.left));
      if (s.toRead.some((x) => x.id === "gamma-four") || "gamma-four" in left || s.already.includes("gamma-four")) bad.push("a google item is not ignored");
      const two = mod.selectItems([item("same q", { device: "mobile" }), item("Same  Q"), item("other q")], { have: () => null, cap: 5 });
      if (two.toRead.map((x) => x.id).join() !== "same-q,other-q" || two.left.length !== 0 || JSON.stringify(two.toRead[0].devices) !== '["mobile","desktop"]') bad.push("a query asked for on two devices is one page: " + JSON.stringify(two));
      const only = mod.selectItems([item("only mobile", { device: "mobile" })], { have: () => null, cap: 5 });
      if (only.toRead.length !== 1 || only.left.length !== 0) bad.push("a request with only mobile items is not read: " + JSON.stringify(only));
      const cap2 = mod.selectItems([item("a q", { device: "mobile" }), item("a q"), item("b q"), item("c q")], { have: () => null, cap: 2 });
      if (cap2.toRead.map((x) => x.id).join() !== "a-q,b-q" || cap2.left.map((x) => x.id).join() !== "c-q") bad.push("the cap counts distinct queries: " + JSON.stringify(cap2));
      const b30 = mod.selectItems([item("old thirty"), item("old thirty one")], { have: (id) => (id === "old-thirty" ? 30 : 31), cap: 5 });
      if (b30.already.join() !== "old-thirty" || b30.toRead.map((x) => x.id).join() !== "old-thirty-one") bad.push("30 days is already there, 31 is read again: " + JSON.stringify(b30));
      check("P2: which items: bing only, each distinct query once in file order whatever its devices, a mobile-only query is read, a fresh capture is already there (30 days), 31 days is read again, the rest over the cap (distinct queries) are left", bad.length === 0, bad.join(" | "));
      // through the files on disk: capturedAt and the file name decide
      const f = fresh(tmp, "p2disk", [item("tracy realtor"), item("sacramento realtor")]);
      const old = new Date(Date.now() - 31 * DAY).toISOString(), recent = new Date(Date.now() - 5 * DAY).toISOString();
      W(path.join(f.serp, "tracy-realtor.bing.json"), { query: "tracy realtor", engine: "bing", capturedAt: recent });
      W(path.join(f.serp, "sacramento-realtor.bing.json"), { query: "sacramento realtor", engine: "bing", capturedAt: old });
      newStops();
      const x = await drive(f, { pages: [page(1)] });
      check("P2: on disk, a capture 5 days old is not loaded again, one 31 days old is read again and replaced", x.code === 0 && x.log.loads.length === 1 && x.log.loads[0] === mod.addressOf("sacramento realtor") && f.cap("sacramento-realtor").organic.length === 2 && f.cap("tracy-realtor").capturedAt === recent && f.rec().already.join() === "tracy-realtor" && f.rec().read.join() === "sacramento-realtor", JSON.stringify({ code: x.code, loads: x.log.loads, rec: fs.existsSync(f.recFile) ? f.rec() : null }));
    }

    // ------------------------------------------------------------ P3 the address
    {
      const bad = [];
      for (const q of ["tracy realtor", "a&b=c", 'say "hi"', "café déjà vu", "100% sure+x#y?z", "it's (fine)", "två ord"]) {
        const a = mod.addressOf(q);
        let u; try { u = new URL(a); } catch { bad.push("not an address: " + a); continue; }
        const keys = [...u.searchParams.keys()];
        if (u.origin !== "https://www.bing.com" || u.pathname !== "/search" || keys.join() !== "q" || u.searchParams.get("q") !== q || u.hash !== "") bad.push(JSON.stringify(q) + " -> " + a);
        if (!a.startsWith("https://www.bing.com/search?q=") || /[ "&#]/.test(a.slice("https://www.bing.com/search?q=".length))) bad.push("raw characters in " + a);
      }
      check("P3: the address of a query is https://www.bing.com/search?q=<encoded> and nothing but q (spaces, an ampersand, a quote, non-ASCII words, a hash)", bad.length === 0, bad.join(" | "));
    }

    // ------------------------------------------------------------ P4 the capture, accepted by the real importer
    {
      const it = item("tracy realtor", { location: "Tracy, CA" });
      const pg = { blocks: [{ url: "https://a.test/", title: "A" }, { url: "ftp://x.test/f", title: "F" }, { url: "", title: "NoLink" }, { url: "javascript:void(0)", title: "J" }, { url: "https://b.test/p", title: " B  two " }], related: ["r1", "r1", " r2 ", ""], asks: ["q one?"], footer: "Tracy, California" };
      const now = new Date("2026-11-22T12:00:00.000Z");
      const b = mod.buildCapture({ item: it, page: pg, now });
      const c = b.capture, bad = [];
      if (JSON.stringify(c.organic) !== JSON.stringify([{ position: 1, url: "https://a.test/", title: "A" }, { position: 2, url: "https://b.test/p", title: "B two" }])) bad.push("organic " + JSON.stringify(c.organic));
      if (b.dropped.nonHttp !== 2 || b.dropped.noLink !== 1) bad.push("dropped " + JSON.stringify(b.dropped));
      if (!/1 block with no link/.test(c.notes) || !/2 addresses? (that are )?not http/.test(c.notes)) bad.push("notes " + c.notes);
      const want = { query: "tracy realtor", engine: "bing", capturedAt: "2026-11-22T12:00:00.000Z", browser: "work browser", device: "desktop", language: "en", robotCheck: false };
      for (const [k, v] of Object.entries(want)) if (c[k] !== v) bad.push(k + " = " + JSON.stringify(c[k]));
      if (JSON.stringify(c.location) !== JSON.stringify({ requested: "Tracy, CA", footer: "Tracy, California", method: "work browser's own exit" })) bad.push("location " + JSON.stringify(c.location));
      if (JSON.stringify(c.localPack) !== "[]" || JSON.stringify(c.aiOverview) !== '{"present":false}' || JSON.stringify(c.relatedSearches) !== '["r1","r2"]' || JSON.stringify(c.paa) !== '["q one?"]') bad.push("localPack / aiOverview / related / paa: " + JSON.stringify([c.localPack, c.aiOverview, c.relatedSearches, c.paa]));
      if (b.matched !== 2) bad.push("matched " + b.matched);
      const nofoot = mod.buildCapture({ item: item("x y", { location: null }), page: { blocks: [{ url: "https://a.test/", title: "A" }], related: [], asks: [] }, now }).capture;
      if (nofoot.location.footer !== "" || nofoot.location.requested !== null) bad.push("a page with no footer: " + JSON.stringify(nofoot.location));
      // the device is the truth about the window: desktop, whatever was asked; the notes say what was asked when desktop was not
      const asked = (devices) => mod.buildCapture({ item: item("x y", { device: devices[0] }), devices, page: { blocks: [{ url: "https://a.test/", title: "A" }] }, now }).capture;
      const m1 = asked(["mobile"]), m2 = asked(["desktop", "mobile"]), m3 = asked(["mobile", "tablet"]), m4 = asked(["desktop"]);
      if (m1.device !== "desktop" || !m1.notes.includes("asked for mobile; read in a desktop window")) bad.push("mobile only: " + m1.device + " / " + m1.notes);
      if (m2.device !== "desktop" || /asked for/.test(m2.notes) || m4.device !== "desktop" || /asked for/.test(m4.notes)) bad.push("desktop asked: " + m2.notes + " / " + m4.notes);
      if (m3.device !== "desktop" || !m3.notes.includes("asked for mobile, tablet; read in a desktop window")) bad.push("two other devices: " + m3.notes);
      check("P4: the capture built from what the page gave: positions from 1, a non-http address and a linkless block left out and counted, every field of the format, device desktop with the asked devices in the notes", bad.length === 0, bad.join(" | "));
      // the real importer
      const f = fresh(tmp, "p4imp", null);
      W(path.join(f.serp, "tracy-realtor.bing.json"), c);
      W(f.recFile, mod.makeRecord({ at: now.toISOString(), read: ["tracy-realtor"], already: [], left: [], stop: null }));
      const r = await run("research-serp-import.mjs", [SITE, "--cwd", f.cwd]);
      const serpFile = path.join(f.pewp, "research", "serp.json"), j = fs.existsSync(serpFile) ? J(serpFile) : null;
      const row = j && j.captures && j.captures.find((x) => x.engine === "bing");
      check("P4: the real research-serp-import.mjs accepts the built capture (exit 0, the row is in research/serp.json, bing, two organic results, desktop)", r.code === 0 && !!row && row.organic.length === 2 && row.device === "desktop" && row.query === "tracy realtor", "exit " + r.code + " " + r.out.slice(-300));
      // a business that tracks mobile only: the desktop capture is ACCEPTED and flagged (deviceMismatch), never rejected
      const fm = fresh(tmp, "p4mob", null, { rankTracking: { devices: ["mobile"] } });
      W(path.join(fm.serp, "tracy-realtor.bing.json"), mod.buildCapture({ item: item("tracy realtor", { device: "mobile" }), devices: ["mobile"], page: pg, now }).capture);
      const rm = await run("research-serp-import.mjs", [SITE, "--cwd", fm.cwd]);
      const jm = fs.existsSync(path.join(fm.pewp, "research", "serp.json")) ? J(path.join(fm.pewp, "research", "serp.json")) : null;
      check("P4: with a business that tracks mobile only, the real importer ACCEPTS the desktop capture (in captures, not in rejected) and serp.json holds deviceMismatch with count 1", rm.code === 0 && !!jm && jm.captures.length === 1 && jm.rejected.length === 0 && jm.captures[0].device === "desktop" && !!jm.deviceMismatch && jm.deviceMismatch.count === 1, "exit " + rm.code + " " + (jm ? JSON.stringify({ rej: jm.rejected, mm: jm.deviceMismatch }).slice(0, 300) : rm.out.slice(-300)));
      check("P4: the record bing-read.json in the same folder is not a rejected capture (rejected is empty, exactly one row)", !!j && Array.isArray(j.rejected) && j.rejected.length === 0 && j.captures.length === 1, j ? JSON.stringify(j.rejected).slice(0, 300) : "no serp.json");
    }

    // ------------------------------------------------------------ P5 the decision after a load
    {
      const bad = [], d = (o) => mod.decide({ status: 200, check: false, wall: null, matched: 3, ...o });
      const s429 = d({ status: 429 }), s403 = d({ status: 403 }), sck = d({ check: true }), ssi = d({ wall: "sign-in wall" }), sco = d({ wall: "consent wall" });
      for (const [n, x, re] of [["429", s429, /429/], ["403", s403, /403/], ["a check", sck, /check/i], ["a sign-in wall", ssi, /sign-in wall/], ["a consent wall", sco, /consent wall/]]) {
        if (x.act !== "stop" || !re.test(x.reason || "")) bad.push(n + " -> " + JSON.stringify(x));
      }
      if (new Set([s429.reason, s403.reason, sck.reason, ssi.reason, sco.reason]).size !== 5) bad.push("the reasons are not each their own");
      const nm = d({ matched: 0 });
      if (nm.act !== "notread" || nm.why !== "not read: the page description matched nothing") bad.push("matched nothing -> " + JSON.stringify(nm));
      if (d({}).act !== "read") bad.push("a good page is not read");
      if (d({ status: 429, matched: 0, check: true }).act !== "stop") bad.push("a 429 with nothing matched is not a stop");
      if (d({ check: true, matched: 0 }).act !== "stop") bad.push("a check with nothing matched is not a stop");
      if (d({ status: 404, matched: 0 }).act !== "notread") bad.push("another status is not a stop");
      check("P5: the decision: 429, 403, a check, a sign-in wall and a consent wall are each a stop with their own reason; nothing matched is not read, never an empty capture", bad.length === 0, bad.join(" | "));
      // two not read in a row end the run, no stop; one apart they do not
      newStops();
      const f = fresh(tmp, "p5a", [item("q one"), item("q two"), item("q three")]);
      const x = await drive(f, { pages: [blankPage(), blankPage(), page(3)] });
      check("P5: two pages in a row that match nothing end the run with no stop and no capture written; the third page is never loaded", x.log.loads.length === 2 && x.code === 3 && !f.has("q-one") && !f.has("q-two") && !f.has("q-three") && f.rec().stop === null && f.rec().left.length === 3 && /^BLOCKED: no bing page could be read/.test(x.last) && !/outside: stop/.test(x.last) && !fs.existsSync(path.join(process.env.OMNIKOM_STOPS_DIR, "bing.json")), JSON.stringify({ code: x.code, loads: x.log.loads.length, last: x.last }));
      newStops();
      const g = fresh(tmp, "p5b", [item("q one"), item("q two"), item("q three")]);
      const y = await drive(g, { pages: [blankPage(), page(2), blankPage()] });
      check("P5: one page that matches nothing between others does not end the run", y.log.loads.length === 3 && g.has("q-two") && !g.has("q-one") && !g.has("q-three") && y.code === 0, JSON.stringify({ code: y.code, loads: y.log.loads.length }));
    }

    // ------------------------------------------------------------ P6 "NOT SET": blocked, nothing opened
    {
      newStops();
      const f = fresh(tmp, "p6", [item("q one")]);
      const x = await drive(f, { pf: pagesFile("notset", { bing: { selectors: "NOT SET" } }), pages: [page(1)] });
      check("P6: NOT SET: exit 3, the BLOCKED line, the browser was never asked for (no port, no connection, no page), no capture and no record", x.code === 3 && x.last === "BLOCKED: no page description for bing yet | unblocks: set it in scripts/read-pages.json" && nothingOpened(x) && !f.has("q-one") && !fs.existsSync(f.recFile), JSON.stringify({ code: x.code, last: x.last, log: x.log }));
      const g = fresh(tmp, "p6b", [item("q one")]);
      const y = await drive(g, { pf: pagesFile("direct", { bing: DESC }), pages: [page(1)] });
      check("P6: a description given directly (the keys result, link, title) is read as set", y.code === 0 && y.log.loads.length === 1 && g.has("q-one"), JSON.stringify({ code: y.code, last: y.last }));
      const h = fresh(tmp, "p6c", [item("q one")]);
      const z = await drive(h, { pf: pagesFile("nolink", { bing: { selectors: { result: "li", title: "h2" } } }), pages: [page(1)] });
      check("P6: a description without a link selector is a usage error (exit 2, the key named), nothing opened", z.code === 2 && /link/.test(z.lines.join("\n")) && nothingOpened(z), JSON.stringify({ code: z.code, lines: z.lines }));
    }

    // ------------------------------------------------------------ P7 an active stop
    {
      const d = newStops();
      stops.writeStop({ engine: "bing", reason: "robot check earlier", setBy: "test", dir: d });
      const f = fresh(tmp, "p7", [item("q one"), item("q two")]);
      const x = await drive(f, { pages: [page(1), page(2)] });
      const rec = fs.existsSync(f.recFile) ? f.rec() : null;
      check("P7: an active stop for bing: exit 3, 'BLOCKED: bing is stopped until <time> | outside: stop', nothing opened, the record names the stop", x.code === 3 && /^BLOCKED: bing is stopped until \S+ \| outside: stop$/.test(x.last) && nothingOpened(x) && !f.has("q-one") && !!rec && !!rec.stop && /robot check earlier/.test(rec.stop.reason) && rec.read.length === 0, JSON.stringify({ code: x.code, last: x.last, log: x.log, rec }));
    }

    // ------------------------------------------------------------ P8 three pages, then a check
    {
      const d = newStops();
      const mob = { device: "mobile" };   // the default request asks for mobile only: that is the case proven here
      const items = [item("q one", mob), item("q two", mob), item("q two"), item("q google", { engine: "google" }), item("q three", mob), item("q four", mob), item("q five", mob)];
      const f = fresh(tmp, "p8", items);
      const x = await drive(f, { pages: [page(1), page(2), page(3), checkPage(), page(5)] });
      const bad = [], rec = fs.existsSync(f.recFile) ? f.rec() : null, ids = ["q-one", "q-two", "q-three"];
      if (x.code !== 0) bad.push("exit " + x.code);
      if (!ids.every((i) => f.has(i)) || f.has("q-four") || f.has("q-five") || f.has("q-google")) bad.push("captures on disk");
      if (x.log.loads.join("|") !== ["q one", "q two", "q three", "q four"].map((q) => mod.addressOf(q)).join("|")) bad.push("loads " + JSON.stringify(x.log.loads));
      if (x.log.waits.join() !== [8, 45, 8, 45, 8, 45, 8].join()) bad.push("waits " + x.log.waits.join());
      if (x.log.maxOpen !== 1 || x.log.open !== 0 || x.log.connects !== 1) bad.push("tabs: max " + x.log.maxOpen + ", still open " + x.log.open + ", connections " + x.log.connects);
      const sf = path.join(d, "bing.json");
      if (!fs.existsSync(sf)) bad.push("no stop file for bing");
      else { const st = J(sf), until = Date.parse(st.until); if (st.engine !== "bing" || !(until > Date.now() + 23.5 * 3600e3 && until < Date.now() + 24.5 * 3600e3) || !/check/i.test(st.reason)) bad.push("stop " + JSON.stringify(st)); }
      if (!rec || rec.step !== "capture-bing" || rec.read.join() !== ids.join() || rec.already.length !== 0 || !rec.stop || !/check/i.test(rec.stop.reason) || !rec.stop.until || !rec.at) bad.push("record " + JSON.stringify(rec));
      else {
        const left = Object.fromEntries(rec.left.map((l) => [l.id, l.why]));
        if (rec.left.length !== 2 || !left["q-four"] || !left["q-five"] || !/stop/i.test(left["q-five"]) || rec.left.some((l) => /mobile/i.test(l.why))) bad.push("left " + JSON.stringify(rec.left));
      }
      if (!/^READ: bing 3 read, 0 already there, 2 left, stopped: .+$/.test(x.last)) bad.push("last line: " + x.last);
      const c1 = f.has("q-one") ? f.cap("q-one") : null;
      if (!c1 || c1.organic[0].url !== "https://site1-a.test/" || c1.organic[1].position !== 2 || c1.browser !== "work browser" || c1.device !== "desktop" || !/asked for mobile; read in a desktop window/.test(c1.notes)) bad.push("first capture " + JSON.stringify(c1));
      const c2 = f.has("q-two") ? f.cap("q-two") : null;
      if (!c2 || c2.device !== "desktop" || /asked for/.test(c2.notes)) bad.push("a query asked for on both devices: " + JSON.stringify(c2 && c2.notes));
      if (x.log.loads.filter((u) => u === mod.addressOf("q two")).length !== 1) bad.push("q two is loaded " + x.log.loads.filter((u) => u === mod.addressOf("q two")).length + " times");
      check("P8: three pages then a check: three captures written, the waits are exactly the after-load seconds and the gap seconds in order, one tab, a stop for bing, the record and the last line, exit 0", bad.length === 0, bad.join(" | "));
    }

    // ------------------------------------------------------------ P9 a check on the first page
    {
      const d = newStops();
      const f = fresh(tmp, "p9", [item("q one"), item("q two")]);
      const x = await drive(f, { pages: [checkPage(), page(2)] });
      const rec = fs.existsSync(f.recFile) ? f.rec() : null;
      check("P9: a check on the first page: exit 3, a stop for bing, no capture, the tab closed, nothing loaded after, 'outside: stop'", x.code === 3 && fs.existsSync(path.join(d, "bing.json")) && !f.has("q-one") && !f.has("q-two") && x.log.loads.length === 1 && x.log.open === 0 && x.log.closed === 1 && x.log.waits.join() === "8" && /^BLOCKED: no bing page could be read \(.+\) \| outside: stop$/.test(x.last) && !!rec && rec.read.length === 0 && !!rec.stop, JSON.stringify({ code: x.code, last: x.last, waits: x.log.waits, loads: x.log.loads.length, rec }));
      // a 429 and a 403 on the first page, a sign-in wall on the second
      for (const [name, pg, re] of [["a 429", page(1, { status: 429, blocks: [] }), /429/], ["a 403", page(1, { status: 403, blocks: [] }), /403/], ["a sign-in wall", page(1, { blocks: [], bodyText: "Please sign in to continue to see your results" }), /sign-in wall/], ["a consent wall", page(1, { blocks: [], bodyText: "Before you continue: we use cookies. Accept all cookies or manage settings." }), /consent wall/]]) {
        const dd = newStops(), g = fresh(tmp, "p9" + name.replace(/\W/g, ""), [item("q one"), item("q two")]);
        const y = await drive(g, { pages: [pg, page(2)] });
        const st = fs.existsSync(path.join(dd, "bing.json")) ? J(path.join(dd, "bing.json")) : null;
        check("P9: " + name + " on the first page is a stop with its own reason (a stop file, no capture, one load)", y.code === 3 && !!st && re.test(st.reason) && !g.has("q-one") && y.log.loads.length === 1 && y.log.open === 0, JSON.stringify({ code: y.code, st, loads: y.log.loads.length, last: y.last }));
      }
    }

    // ------------------------------------------------------------ P11 the command line and the files
    {
      newStops();
      const f = fresh(tmp, "p11", [item("q one")]);
      const bad = [];
      for (const extra of [["--gap", "10"], ["--no-wait"], ["--retries", "2"]]) { const x = await drive(f, { argv: [SITE, "--cwd", f.cwd, ...extra], pages: [page(1)] }); if (x.code !== 2 || !nothingOpened(x)) bad.push(extra.join(" ") + " -> exit " + x.code); }
      const none = await drive(f, { argv: ["--cwd", f.cwd], pages: [page(1)] });
      if (none.code !== 2 || !nothingOpened(none)) bad.push("no address -> exit " + none.code);
      const badGap = await drive(f, { pf: pagesFile("gap44", { pace: { ...PACE, gapSeconds: 44 } }), pages: [page(1)] });
      if (badGap.code !== 2 || !/gapSeconds/.test(badGap.lines.join("\n")) || !nothingOpened(badGap)) bad.push("gap 44 in the file -> exit " + badGap.code + " " + badGap.lines.join(" / "));
      const noReq = fresh(tmp, "p11b", null);
      const nr = await drive(noReq, { pages: [page(1)] });
      if (nr.code !== 3 || !/^BLOCKED: .*capture-requests\.json/.test(nr.last) || !nothingOpened(nr)) bad.push("no request file -> exit " + nr.code + " " + nr.last);
      check("P11: the command line: no flag changes a wait (--gap and others are exit 2), a bad pace block in the file is exit 2 with its key, no request file is BLOCKED, each with nothing opened", bad.length === 0, bad.join(" | "));
    }

    // ------------------------------------------------------------ P12 what the script must not have
    {
      const src = fs.readFileSync(path.join(dir, "read-bing.mjs"), "utf8"), bad = [];
      for (const [name, re] of [["a Google address", /google/i], ["input events", /Input\.|dispatch(Key|Mouse)/], ["a user agent", /userAgent|user-agent|setUserAgent/i], ["a reload", /reload/i], ["a random number", /Math\.random|randomInt|crypto/], ["an environment variable", /process\.env/], ["a new browser context", /createBrowserContext/], ["a click or a key press", /\.click\(|keyboard|insertText/]]) if (re.test(src)) bad.push("read-bing.mjs has " + name);
      check("P12: read-bing.mjs has no Google address, no input, no user agent, no reload, no random wait, no environment variable and no fresh browser context", bad.length === 0, bad.join(" | "));
    }

    // ------------------------------------------------------------ P10 the manifest (the real tree, not the mutated copy)
    {
      const lib = await import(pathToFileURL(path.join(here, "lib-pipeline.mjs")).href);
      const man = lib.loadManifest(path.join(here, "..", "pipeline.json")).manifest, s = man.steps.find((x) => x.id === "capture-bing"), bad = [], Js = JSON.stringify;
      if (!s) bad.push("no capture-bing step");
      else {
        const want = { script: "scripts/read-bing.mjs", needsBrowser: "work", heavy: false, timeoutMinutes: 45, needsAi: false, needsPerson: false, hits: "third-party:bing.com", station: "search", module: "visibility", kind: "time-sensitive", maxAgeDays: 30 };
        for (const [k, v] of Object.entries(want)) if (s[k] !== v) bad.push(k + " = " + Js(s[k]));
        if (Js(s.args) !== Js(["{key}", "--cwd", "{skill}"])) bad.push("args " + Js(s.args));
        if (Js(s.dependsOn) !== Js(["research-plan"]) || Js(s.inputs) !== Js(["{pewp}/research/capture-requests.json"]) || Js(s.outputs) !== Js(["{pewp}/captures/serp/"])) bad.push("dependsOn / inputs / outputs");
        if (Js(s.evidence) !== Js(["{pewp}/captures/serp/bing-read.json"])) bad.push("evidence " + Js(s.evidence));
        if (Js(s.engines) !== Js(["bing"])) bad.push("engines " + Js(s.engines));
        if (lib.isWaiting(s)) bad.push("the step still waits");
        if (typeof s.pace !== "string" || /\d/.test(s.pace) || typeof s.brief !== "string" || /owner's Edge/.test(s.brief)) bad.push("pace / brief words: " + Js([s.pace, s.brief]));
      }
      const v = lib.validateManifest(man, { skillDir: path.dirname(here) });
      if (!v.ok) bad.push("validateManifest: " + v.problems.map(lib.describe).join("; "));
      check("P10: the manifest: capture-bing is a program step (read-bing.mjs, its args, the work browser, 45 minutes, its evidence), not waiting, and validateManifest has no problem", bad.length === 0, bad.join(" | "));
    }
  } finally { delete process.env.OMNIKOM_STOPS_DIR; rmTmp(tmp); }
  return results;
}

const RB = "read-bing.mjs";
const MUTANTS = [
  { name: "the gap is not waited", patches: [{ file: RB, from: 'if (i > 0) await pause(pace.gapSeconds, "gap before the next load");', to: "" }], expect: [/^P8:/] },
  { name: "a gap of 44 is accepted", patches: [{ file: RB, from: "const MIN_GAP_SECONDS = GAP_MS / 1000;", to: "const MIN_GAP_SECONDS = GAP_MS / 1000 - 1;" }], expect: [/^P1:/] },
  { name: "a second tab is opened", patches: [{ file: RB, from: "if (!tab) tab = await drv.openPlain(cdp, address); else await drv.navigate(cdp, tab, address);", to: "tab = await drv.openPlain(cdp, address);" }], expect: [/^P8:/] },
  { name: "a page is loaded although bing is stopped", patches: [{ file: RB, from: 'const stopped = isStopped("bing");', to: "const stopped = null;" }], expect: [/^P7:/] },
  { name: "a 429 does not stop", patches: [{ file: RB, from: "if (status === 429 || status === 403)", to: "if (status === 403)" }], expect: [/^P5:/, /^P9: a 429/] },
  { name: "an empty capture is written when nothing matched", patches: [{ file: RB, from: "if (!(matched > 0)) return { act: \"notread\", why: NOT_MATCHED };", to: "" }], expect: [/^P5:/] },
  { name: "a query asked for on two devices is loaded twice", patches: [{ file: RB, from: "key = id;", to: 'key = id + "|" + device;' }], expect: [/^P2:/, /^P8:/] },
  { name: "a capture read in the desktop window says mobile", patches: [{ file: RB, from: 'browser: "work browser", device: "desktop",', to: 'browser: "work browser", device: devices[0],' }], expect: [/^P4:/, /^P8:/] },
  { name: "a capture that exists is read again", patches: [{ file: RB, from: "if (age !== null && age <= FRESH_DAYS) {", to: "if (false) {" }], expect: [/^P2:/] },
  { name: "the address carries more than q", patches: [{ file: RB, from: 'return "https://www.bing.com/search?q=" + encodeURIComponent(query);', to: 'return "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&setlang=en";' }], expect: [/^P3:/] },
  { name: "a check writes no stop", patches: [{ file: RB, from: "const w = writeStop({ engine: \"bing\", reason,", to: "const w = ((x) => ({ stop: { until: null } }))({ engine: \"bing\", reason," }], expect: [/^P8:/, /^P9:/] },
  { name: "two pages that match nothing do not end the run", patches: [{ file: RB, from: "if (notRead >= 2) {", to: "if (notRead >= 99) {" }], expect: [/^P5: two pages/] },
  { name: "the wait after a load has a jitter", patches: [{ file: RB, from: 'await pause(pace.afterLoadSeconds, "after load");', to: 'await pause(pace.afterLoadSeconds + Math.random(), "after load");' }], expect: [/^P8:/, /^P12:/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-read-bing.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "READ BING", scenarios, MUTANTS, scriptsDir, argv: A }));
}
