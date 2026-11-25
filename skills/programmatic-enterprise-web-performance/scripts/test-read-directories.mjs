// Usage: node test-read-directories.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Test of read-directories.mjs (AB-14): the directories reader, capture-directories as a program step. Each directory is ONE page in ONE tab of the work browser, at the pace block of
// read-pages.json, nothing typed, clicked or scrolled; a robot check or a refusal stops THAT host for 24 h and the run goes on with the next host; a sign-in wall is not gathered, no stop.
// NO browser and no network: the driver takes every browser function from ONE object (drv, the one of read-bing.mjs) which this test replaces by a fake that serves invented pages; the waits go
// through io.sleep (lib-ask-pace.mjs), which this test replaces by a recorder that returns at once. The in-page reader is run once on an invented document in a vm.
// Watched-fail mutants: a patch is applied to a copy of the scripts folder and the named assertions must turn red (see lib-test-kit.mjs).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const HOST = "read-dir-test.test", SITE = "https://" + HOST + "/";
const PACE = { tabsAtOnce: 1, afterLoadSeconds: 8, gapSeconds: 45, maxPagesPerRun: 30 };
const SEARCH = {
  "yellowpages.com": "https://www.yellowpages.com/search?search_terms={name}&geo_location_terms={city}",
  "bbb.org": "https://www.bbb.org/search?find_country=USA&find_text={name}&find_loc={city}",
  "mapquest.com": "https://www.mapquest.com/search?query={name}%20{city}",
  "yelp.com": "https://www.yelp.com/search?find_desc={name}&find_loc={city}",
};
const HOSTS = Object.keys(SEARCH);
const DESC = { result: ".res", name: ".nm", address: ".ad", phone: ".ph", link: "a.lk" };
const NOTSET = "NOT SET";
const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)).href);
const dirs = (setHosts, only = HOSTS) => Object.fromEntries(only.map((h) => [h, { search: SEARCH[h], selectors: setHosts.includes(h) ? DESC : NOTSET }]));

const BIZNAME = "Read Dir Test Realty";
const blk = (name, o = {}) => ({ name, address: "1 Main St, Tracy, CA 95376", phone: "(209) 555-0100", link: "https://dir.test/biz/" + name.toLowerCase().replace(/\W+/g, "-"), ...o });
// a page as the in-page reader hands it over
const page = (n, o = {}) => ({ href: "https://www.page" + n + ".test/search?x=1", title: "Search results", status: 200, bodyText: "results for the business", blocks: [blk("Other Company " + n), blk(BIZNAME + ", LLC", { link: "https://dir" + n + ".test/biz/read-dir-test-realty" })], ...o });
const checkPage = () => page(0, { title: "Just a moment...", bodyText: "Verifying you are human", blocks: [] });
const wallPage = () => page(0, { blocks: [], bodyText: "Please sign in to continue to see the results" });

function fresh(tmp, n, biz = {}) {
  const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", HOST, ".pewp");
  const b = { name: BIZNAME, domain: HOST, market: { country: "US", language: "en" }, vocabulary: ["homes"], offer: "homes", phone: "(209) 555-0100", locations: [{ name: "Tracy, CA", address: "1 Main St, Tracy, CA, 95376" }], ...biz };
  W(path.join(pewp, "business.json"), b); W(path.join(pewp, "approved", "business.json"), b);
  const local = path.join(pewp, "captures", "local"), cit = path.join(local, "citations.json"), recFile = path.join(local, "directories-read.json");
  return { cwd, pewp, biz: b, cit, recFile, rec: () => J(recFile), rows: () => J(cit), hasCit: () => fs.existsSync(cit), hasRec: () => fs.existsSync(recFile) };
}

async function scenarios(dir) {
  const results = [], check = checker(results);
  // every case is one call: a throw (a stub, a missing export) is a red case, never a crash of the whole run
  const C = async (name, fn) => { try { const [ok, detail] = await fn(); check(name, ok, detail); } catch (e) { check(name, false, "threw: " + String((e && e.stack) || e).split("\n").slice(0, 3).join(" / ")); } };
  const tmp = mkTmp("read-directories");
  let mod = { drv: {} }, ace = null, stops = null, nap = null, loadErr = "";
  try { mod = await imp(dir, "read-directories.mjs"); } catch (e) { loadErr = e.message; }
  ace = await imp(dir, "lib-ask-pace.mjs"); stops = await imp(dir, "lib-stops.mjs"); nap = { ...(await imp(dir, "local-lib.mjs")), ...(await imp(dir, "local-nap.mjs")) };
  let stopN = 0;
  const newStops = () => { const d = path.join(tmp, "stops-" + ++stopN); fs.mkdirSync(d, { recursive: true }); process.env.OMNIKOM_STOPS_DIR = d; return d; };
  const stopFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => J(path.join(d, f))) : []);
  const pagesFile = (n, o = {}) => { const f = path.join(tmp, n + ".pages.json"); W(f, { pace: PACE, directories: dirs(HOSTS), ...o }); return f; };
  const addr = (h, name = BIZNAME, city = "Tracy") => mod.addressOf(h, SEARCH[h], { name, city });

  async function drive(f, { pages = [], pf = null, argv = null } = {}) {
    pf = pf || pagesFile("p" + stopN);
    const log = { loads: [], opens: 0, navs: 0, open: 0, maxOpen: 0, connects: 0, ports: 0, evals: 0, closed: 0, sends: 0, waits: [] };
    const savedDrv = { ...mod.drv }, savedSleep = ace.io.sleep, lines = [];
    mod.drv.workPort = async () => { log.ports++; return 9222; };
    mod.drv.connect = async () => { log.connects++; return { close() {}, send: async () => { log.sends++; return {}; }, listeners: new Set() }; };
    mod.drv.openPlain = async (c, url) => { log.loads.push(url); log.opens++; log.open++; log.maxOpen = Math.max(log.maxOpen, log.open); return { sessionId: "s", targetId: "t" + log.loads.length }; };
    mod.drv.navigate = async (c, tab, url) => { log.loads.push(url); log.navs++; };
    mod.drv.evalIn = async () => { log.evals++; return pages[log.loads.length - 1]; };
    mod.drv.closePage = async () => { log.open--; log.closed++; };
    ace.io.sleep = async (ms) => { log.waits.push(ms / 1000); };
    try {
      const r = await mod.run(argv || [SITE, "--cwd", f.cwd, "--pages-file", pf], { out: (l) => lines.push(l) });
      return { ...r, lines, last: lines[lines.length - 1] || "", log };
    } finally { Object.assign(mod.drv, savedDrv); ace.io.sleep = savedSleep; }
  }
  const nothingOpened = (x) => x.log.ports === 0 && x.log.connects === 0 && x.log.loads.length === 0 && x.log.evals === 0;
  const lj = (x) => JSON.stringify(x);

  try {
    // ------------------------------------------------------------ D1 the address of each directory
    await C("D1: the address of each directory: the template with {name} and {city} filled by encodeURIComponent, one parameter each, on the host of its key; a name that holds {city} is not filled twice", async () => {
      const bad = [], name = "Smith & Sons, LLC", city = "Walnut Creek", E = "Smith%20%26%20Sons%2C%20LLC", Cy = "Walnut%20Creek";
      const want = {
        "yellowpages.com": "https://www.yellowpages.com/search?search_terms=" + E + "&geo_location_terms=" + Cy,
        "bbb.org": "https://www.bbb.org/search?find_country=USA&find_text=" + E + "&find_loc=" + Cy,
        "mapquest.com": "https://www.mapquest.com/search?query=" + E + "%20" + Cy,
        "yelp.com": "https://www.yelp.com/search?find_desc=" + E + "&find_loc=" + Cy,
      };
      for (const h of HOSTS) { const a = mod.addressOf(h, SEARCH[h], { name, city }); if (a !== want[h]) bad.push(h + " -> " + a); }
      const tricky = mod.addressOf("yelp.com", SEARCH["yelp.com"], { name: "{city} & co", city: "Tracy" });
      if (tricky !== "https://www.yelp.com/search?find_desc=%7Bcity%7D%20%26%20co&find_loc=Tracy") bad.push("a name with {city}: " + tricky);
      const refuses = (h, tpl) => { try { mod.addressOf(h, tpl, { name, city }); return false; } catch { return true; } };
      for (const [h, tpl] of [["yelp.com", "https://www.evil.test/s?q={name}&l={city}"], ["yelp.com", "https://yelp.com.evil.test/s?q={name}&l={city}"], ["yelp.com", "https://evilyelp.com/s?q={name}&l={city}"], ["yelp.com", "http://www.yelp.com/s?q={name}&l={city}"], ["yelp.com", "/search?q={name}&l={city}"]]) if (!refuses(h, tpl)) bad.push("accepted " + tpl);
      if (refuses("yelp.com", "https://yelp.com/s?q={name}&l={city}") || refuses("yelp.com", "https://m.yelp.com/s?q={name}&l={city}")) bad.push("the bare host or a subdomain of the key is refused");
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D1: through the command a template that leaves the host of its key is exit 2 (the key named), a template without {name} or {city} is exit 2, a description without a name selector is exit 2: each with nothing opened and no record", async () => {
      const bad = [];
      for (const [label, d] of [
        ["host", { "yelp.com": { search: "https://www.evil.test/s?q={name}&l={city}", selectors: DESC } }],
        ["no placeholder", { "yelp.com": { search: "https://www.yelp.com/search?find_desc=x&find_loc={city}", selectors: DESC } }],
        ["no name selector", { "yelp.com": { search: SEARCH["yelp.com"], selectors: { result: ".res", address: ".ad" } } }],
        ["selector not a string", { "yelp.com": { search: SEARCH["yelp.com"], selectors: { ...DESC, phone: 5 } } }],
      ]) {
        newStops();
        const f = fresh(tmp, "d1" + label.replace(/\W/g, ""));
        const x = await drive(f, { pf: pagesFile("d1" + label.replace(/\W/g, ""), { directories: d }), pages: [page(1)] });
        if (x.code !== 2 || !nothingOpened(x) || f.hasRec() || f.hasCit() || !/yelp\.com/.test(x.lines.join("\n"))) bad.push(label + " -> exit " + x.code + " " + x.lines.join(" / "));
      }
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D1: the shipped read-pages.json holds the four directories with these addresses and mapquest.com and yelp.com NOT SET, and the settled pace block", async () => {
      const real = J(path.join(dir, "read-pages.json")), bad = [];
      const want = lj(Object.fromEntries(HOSTS.map((h) => [h, { search: SEARCH[h], selectors: ["yellowpages.com", "bbb.org"].includes(h) ? real.directories[h].selectors : NOTSET }])));   // the two descriptions themselves are D22's
      if (lj(real.directories) !== want) bad.push("directories " + lj(real.directories));
      if (lj(real.pace) !== lj(PACE)) bad.push("pace " + lj(real.pace));
      if (!real.bing || !real.bing.selectors || !real.bing.selectors.result) bad.push("the bing block is gone");
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D2 all NOT SET
    await C("D2: every directory NOT SET: exit 3, BLOCKED, the browser never asked for (no port, no connection, no page), the record says four lefts 'no page description', no citations.json", async () => {
      newStops();
      const f = fresh(tmp, "d2");
      const x = await drive(f, { pf: pagesFile("d2", { directories: dirs([]) }), pages: [page(1)] });
      const rec = f.hasRec() ? f.rec() : null, bad = [];
      if (x.code !== 3) bad.push("exit " + x.code);
      if (!nothingOpened(x)) bad.push("something was opened " + lj(x.log));
      if (!/^BLOCKED: /.test(x.last)) bad.push("last line: " + x.last);
      if (!rec || rec.step !== "capture-directories" || rec.read.length !== 0 || rec.already.length !== 0 || rec.left.length !== 4 || !rec.left.every((l) => l.why === "no page description") || lj(rec.left.map((l) => l.directory)) !== lj(HOSTS)) bad.push("record " + lj(rec));
      if (f.hasCit()) bad.push("citations.json was written");
      if (!x.lines.some((l) => l === "READ: directories 0 read, 4 left")) bad.push("no READ line: " + lj(x.lines));
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D3 one set, three not set
    await C("D3: one directory set, three NOT SET: exit 0, ONE page loaded (its address), three left 'no page description', one row, the last line READ: directories 1 read, 3 left", async () => {
      newStops();
      const f = fresh(tmp, "d3"), bad = [];
      const x = await drive(f, { pf: pagesFile("d3", { directories: dirs(["bbb.org"]) }), pages: [page(1)] });
      const rec = f.hasRec() ? f.rec() : null;
      if (x.code !== 0) bad.push("exit " + x.code);
      if (lj(x.log.loads) !== lj([addr("bbb.org")]) || x.log.waits.join() !== "8") bad.push("loads " + lj(x.log.loads) + " waits " + x.log.waits.join());
      if (x.log.connects !== 1 || x.log.open !== 0 || x.log.closed !== 1) bad.push("connection / tab: " + lj(x.log));
      if (!rec || lj(rec.read) !== '["bbb.org"]' || rec.left.length !== 3 || !rec.left.every((l) => l.why === "no page description") || rec.left.some((l) => l.directory === "bbb.org") || !rec.at) bad.push("record " + lj(rec));
      if (x.last !== "READ: directories 1 read, 3 left") bad.push("last line: " + x.last);
      if (!f.hasCit() || f.rows().length !== 1 || f.rows()[0].directory !== "bbb.org") bad.push("rows " + (f.hasCit() ? lj(f.rows()) : "none"));
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D4 the listed block
    await C("D4: the listing is the FIRST block whose normalised name equals the business name (blocks with another name before it, a lookalike name, a second match after it): the row has exactly directory, url (the link), name, address, phone, capturedAt, capturedIn", async () => {
      newStops();
      const f = fresh(tmp, "d4"), bad = [];
      const pg = page(1, { blocks: [blk("Read Dir Test Realty Group"), blk("Another Realty"), blk("READ DIR TEST REALTY, INC.", { link: "https://www.yelp.com/biz/read-dir-test-realty-tracy", address: "1 Main St, Tracy, CA 95376", phone: "(209) 555-0100" }), blk(BIZNAME, { link: "https://second.test/" })] });
      const before = Date.now();
      const x = await drive(f, { pf: pagesFile("d4", { directories: dirs(["yelp.com"]) }), pages: [pg] });
      const row = f.hasCit() ? f.rows()[0] : null;
      if (x.code !== 0 || !row) return [false, "exit " + x.code + " rows " + (f.hasCit() ? lj(f.rows()) : "none")];
      if (lj(Object.keys(row).sort()) !== lj(["address", "capturedAt", "capturedIn", "directory", "name", "phone", "url"])) bad.push("keys " + Object.keys(row).sort().join());
      const want = { directory: "yelp.com", url: "https://www.yelp.com/biz/read-dir-test-realty-tracy", name: "READ DIR TEST REALTY, INC.", address: "1 Main St, Tracy, CA 95376", phone: "(209) 555-0100", capturedIn: "work browser" };
      for (const [k, v] of Object.entries(want)) if (row[k] !== v) bad.push(k + " = " + lj(row[k]));
      const at = Date.parse(row.capturedAt);
      if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(row.capturedAt)) || !(at >= before - 1000 && at <= Date.now() + 1000)) bad.push("capturedAt " + row.capturedAt);
      // no link in the block: the address is the page's; an empty phone is null (the checker compares only what is there)
      newStops();
      const g = fresh(tmp, "d4b");
      const y = await drive(g, { pf: pagesFile("d4b", { directories: dirs(["yelp.com"]) }), pages: [page(2, { blocks: [blk(BIZNAME, { link: "", phone: "  " })] })] });
      const r2 = g.hasCit() ? g.rows()[0] : null;
      if (!r2 || r2.url !== "https://www.page2.test/search?x=1" || r2.phone !== null || r2.name !== BIZNAME) bad.push("no link / empty phone: " + lj(r2));
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D5 no matching block
    await C("D5: no block matches: the row is exactly directory, url (the page address), listed:false, capturedAt, capturedIn; local-nap's checkCitations reads it as NOT LISTED, and a listed row of the same business as consistent", async () => {
      newStops();
      const f = fresh(tmp, "d5"), bad = [];
      const x = await drive(f, { pf: pagesFile("d5", { directories: dirs(["mapquest.com", "yelp.com"]) }), pages: [page(1, { blocks: [blk("Someone Else", { phone: "(209) 555-0199" }), blk("Another Realty", { phone: "(209) 555-0198" })] }), page(2)] });
      const rows = f.hasCit() ? f.rows() : [], miss = rows.find((r) => r.directory === "mapquest.com"), hit = rows.find((r) => r.directory === "yelp.com");
      if (x.code !== 0 || !miss || !hit) return [false, "exit " + x.code + " rows " + lj(rows)];
      if (lj(Object.keys(miss).sort()) !== lj(["capturedAt", "capturedIn", "directory", "listed", "url"]) || miss.listed !== false || miss.url !== "https://www.page1.test/search?x=1" || miss.capturedIn !== "work browser" || !Date.parse(miss.capturedAt)) bad.push("the not listed row " + lj(miss));
      const canon = nap.canonicalNap(f.biz), cc = nap.checkCitations(rows, canon);
      if (!canon.ok) bad.push("canonicalNap: " + lj(canon.missing));
      if (lj(cc.notChecked.map((c) => [c.directory, c.status])) !== lj([["mapquest.com", "NOT LISTED"]])) bad.push("notChecked " + lj(cc.notChecked));
      if (lj(cc.consistent) !== '["yelp.com"]' || cc.mismatches.length !== 0) bad.push("the listed row is not consistent: " + lj(cc));
      if (x.last !== "READ: directories 2 read, 2 left") bad.push("last line " + x.last);
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D6 a check on directory 2 of 3
    await C("D6: a check on directory 2 of 3: that tab is closed, ONLY its host is stopped for 24 h, directory 3 is still read in a new tab, the waits are exactly after-load / gap / after-load / gap / after-load, exit 0", async () => {
      const d = newStops(), f = fresh(tmp, "d6"), bad = [], three = ["yellowpages.com", "bbb.org", "mapquest.com"];
      const x = await drive(f, { pf: pagesFile("d6", { directories: dirs(three, three) }), pages: [page(1), checkPage(), page(3)] });
      const rec = f.hasRec() ? f.rec() : null, sf = stopFiles(d);
      if (x.code !== 0) bad.push("exit " + x.code);
      if (lj(x.log.loads) !== lj(three.map((h) => addr(h)))) bad.push("loads " + lj(x.log.loads));
      if (x.log.waits.join() !== [8, 45, 8, 45, 8].join()) bad.push("waits " + x.log.waits.join());
      if (x.log.maxOpen !== 1 || x.log.open !== 0 || x.log.opens !== 2 || x.log.closed !== 2 || x.log.connects !== 1) bad.push("tabs: max " + x.log.maxOpen + " open " + x.log.open + " openPlain " + x.log.opens + " closed " + x.log.closed + " connections " + x.log.connects);
      if (sf.length !== 1) bad.push("stop files " + lj(sf));
      else {
        const st = sf[0], until = Date.parse(st.until);
        if (lj(st.hosts) !== '["bbb.org"]' || !(until > Date.now() + 23.5 * 3600e3 && until < Date.now() + 24.5 * 3600e3) || !/check/i.test(st.reason)) bad.push("stop " + lj(st));
      }
      if (!stops.isStopped("bbb.org", Date.now(), d) || stops.isStopped("yellowpages.com", Date.now(), d) || stops.isStopped("mapquest.com", Date.now(), d)) bad.push("isStopped says the wrong hosts");
      if (!rec || lj(rec.read) !== '["yellowpages.com","mapquest.com"]' || rec.left.length !== 1 || rec.left[0].directory !== "bbb.org" || !/check/i.test(rec.left[0].why) || !Array.isArray(rec.stops) || rec.stops.length !== 1 || rec.stops[0].directory !== "bbb.org") bad.push("record " + lj(rec));
      const rows = f.hasCit() ? f.rows() : [];
      if (lj(rows.map((r) => r.directory)) !== '["yellowpages.com","mapquest.com"]') bad.push("rows " + lj(rows.map((r) => r.directory)));
      if (x.last !== "READ: directories 2 read, 1 left") bad.push("last line " + x.last);
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D7 a 429 or 403 the same
    for (const [name, status, re] of [["a 429", 429, /429/], ["a 403", 403, /403/]]) {
      await C("D7: " + name + " on directory 2 of 3 is the same: the tab closed, that host stopped (the reason names the host and the status, not another site), the next directory read, the waits exact", async () => {
        const d = newStops(), f = fresh(tmp, "d7" + status), bad = [], three = ["yellowpages.com", "bbb.org", "mapquest.com"];
        const x = await drive(f, { pf: pagesFile("d7" + status, { directories: dirs(three, three) }), pages: [page(1), page(2, { status, blocks: [] }), page(3)] });
        const sf = stopFiles(d), rec = f.hasRec() ? f.rec() : null;
        if (x.code !== 0 || x.log.loads.length !== 3 || x.log.waits.join() !== [8, 45, 8, 45, 8].join() || x.log.opens !== 2 || x.log.open !== 0) bad.push("exit " + x.code + " loads " + x.log.loads.length + " waits " + x.log.waits.join() + " openPlain " + x.log.opens);
        if (sf.length !== 1 || lj(sf[0].hosts) !== '["bbb.org"]' || !re.test(sf[0].reason) || !/bbb\.org/.test(sf[0].reason) || /bing/i.test(sf[0].reason)) bad.push("stop " + lj(sf));
        if (!rec || lj(rec.read) !== '["yellowpages.com","mapquest.com"]' || !re.test(rec.left[0].why) || f.rows().some((r) => r.directory === "bbb.org")) bad.push("record " + lj(rec));
        return [bad.length === 0, bad.join(" | ")];
      });
    }

    // ------------------------------------------------------------ D8 a sign-in wall
    await C("D8: a sign-in wall on directory 2 of 3: not gathered (no row), NO stop, left with the wall as the reason, directory 3 is read, still one tab (the same tab is reused), the waits exact", async () => {
      const d = newStops(), f = fresh(tmp, "d8"), bad = [], three = ["yellowpages.com", "bbb.org", "mapquest.com"];
      const x = await drive(f, { pf: pagesFile("d8", { directories: dirs(three, three) }), pages: [page(1), wallPage(), page(3)] });
      const rec = f.hasRec() ? f.rec() : null;
      if (x.code !== 0 || x.log.loads.length !== 3 || x.log.waits.join() !== [8, 45, 8, 45, 8].join()) bad.push("exit " + x.code + " loads " + x.log.loads.length + " waits " + x.log.waits.join());
      if (x.log.opens !== 1 || x.log.navs !== 2 || x.log.maxOpen !== 1) bad.push("tabs: openPlain " + x.log.opens + " navigate " + x.log.navs);
      if (stopFiles(d).length !== 0 || stops.isStopped("bbb.org", Date.now(), d)) bad.push("a stop was written for a sign-in wall: " + lj(stopFiles(d)));
      if (f.rows().some((r) => r.directory === "bbb.org") || f.rows().length !== 2) bad.push("rows " + lj(f.rows().map((r) => r.directory)));
      if (!rec || rec.left.length !== 1 || rec.left[0].directory !== "bbb.org" || !/sign-in wall/.test(rec.left[0].why) || (rec.stops && rec.stops.length !== 0)) bad.push("record " + lj(rec));
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D8: a results page that carries a sign-in link in its text but has result blocks is NOT a wall (it is read)", async () => {
      newStops();
      const f = fresh(tmp, "d8b");
      const x = await drive(f, { pf: pagesFile("d8b", { directories: dirs(["yelp.com"]) }), pages: [page(1, { bodyText: "Please sign in to continue to see your saved places. Results below." })] });
      return [x.code === 0 && f.hasCit() && f.rows().length === 1, "exit " + x.code + " " + x.last];
    });

    // ------------------------------------------------------------ D9 an active stop
    await C("D9: an active stop for a host (a stop another script wrote, and one this script wrote): that directory is left 'stopped', nothing is loaded for it, no wait for it, the others are read", async () => {
      const d = newStops(), f = fresh(tmp, "d9"), bad = [], three = ["yellowpages.com", "bbb.org", "mapquest.com"];
      stops.writeStop({ engine: "bbb", reason: "a robot check earlier", setBy: "test", dir: d });
      const x = await drive(f, { pf: pagesFile("d9", { directories: dirs(three, three) }), pages: [page(1), page(2)] });
      const rec = f.hasRec() ? f.rec() : null;
      if (x.code !== 0 || lj(x.log.loads) !== lj([addr("yellowpages.com"), addr("mapquest.com")]) || x.log.waits.join() !== [8, 45, 8].join()) bad.push("exit " + x.code + " loads " + lj(x.log.loads) + " waits " + x.log.waits.join());
      if (!rec || lj(rec.read) !== '["yellowpages.com","mapquest.com"]' || lj(rec.left.map((l) => [l.directory, l.why])) !== lj([["bbb.org", "stopped"]]) || !Array.isArray(rec.stops) || rec.stops.length !== 1 || rec.stops[0].directory !== "bbb.org" || !rec.stops[0].until) bad.push("record " + lj(rec));
      // every directory stopped: exit 3, nothing opened
      const d2 = newStops(), g = fresh(tmp, "d9b");
      for (const h of three) stops.writeStop({ engine: h.replace(/\./g, "-"), hosts: [h], reason: "stopped by a test", setBy: "test", dir: d2 });
      const y = await drive(g, { pf: pagesFile("d9b", { directories: dirs(three, three) }), pages: [page(1)] });
      if (y.code !== 3 || !nothingOpened(y) || !/^BLOCKED: /.test(y.last) || g.hasCit()) bad.push("all stopped: exit " + y.code + " " + y.last);
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D10 the merge
    await C("D10: citations.json is merged: rows of other directories are kept (in their order), the rows of the directories read in this run replace the earlier rows of the same directory; an existing file that is not an array is exit 3 before any page, left as it is", async () => {
      newStops();
      const f = fresh(tmp, "d10"), bad = [];
      const manta = { directory: "manta.com", url: "https://www.manta.com/c/x", name: "Read Dir Test Realty", address: "1 Main St, Tracy, CA 95376", phone: "(209) 555-0100", capturedAt: "2026-10-01T00:00:00.000Z", capturedIn: "owner's Edge" };
      const oldYelp = { directory: "yelp.com", url: "https://old.test/", name: "Old Name", address: "old", phone: "1", capturedAt: "2026-09-01T00:00:00.000Z", capturedIn: "owner's Edge" };
      const oldBbb = { directory: "bbb.org", url: "https://old.test/bbb", name: "Old", capturedAt: "2026-09-01T00:00:00.000Z", capturedIn: "owner's Edge" };
      W(f.cit, [manta, oldYelp, oldBbb]);
      const x = await drive(f, { pf: pagesFile("d10", { directories: dirs(["yelp.com", "mapquest.com"]) }), pages: [page(1), page(2)] });
      const rows = f.hasCit() ? f.rows() : [];
      if (x.code !== 0) bad.push("exit " + x.code);
      const by = (h) => rows.filter((r) => r.directory === h);
      if (rows.length !== 4 || by("yelp.com").length !== 1 || by("mapquest.com").length !== 1 || by("manta.com").length !== 1 || by("bbb.org").length !== 1) bad.push("rows " + lj(rows.map((r) => r.directory)));
      if (lj(by("manta.com")[0]) !== lj(manta) || lj(by("bbb.org")[0]) !== lj(oldBbb)) bad.push("a row of another directory changed");
      if (by("yelp.com")[0] && (by("yelp.com")[0].name === "Old Name" || by("yelp.com")[0].capturedIn !== "work browser")) bad.push("the yelp row was not replaced: " + lj(by("yelp.com")[0]));
      if (lj(rows.filter((r) => ["manta.com", "bbb.org"].includes(r.directory)).map((r) => r.directory)) !== '["manta.com","bbb.org"]') bad.push("the kept rows changed their order");
      // not an array
      newStops();
      const g = fresh(tmp, "d10b");
      W(g.cit, { not: "an array" });
      const y = await drive(g, { pf: pagesFile("d10b", { directories: dirs(["yelp.com"]) }), pages: [page(1)] });
      if (y.code !== 3 || !nothingOpened(y) || !/^BLOCKED: .*citations\.json/.test(y.last) || lj(J(g.cit)) !== '{"not":"an array"}') bad.push("a file that is not an array: exit " + y.code + " " + y.last);
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D11 no name or no city
    await C("D11: no name, or no city (neither market.city nor a location with an address), or no approved business.json: exit 3, 'BLOCKED: ... | unblocks: approve-business', nothing opened, nothing written", async () => {
      const bad = [];
      const cases = [["no name", { name: undefined }], ["no city", { locations: [{ name: "Tracy, CA", address: null }] }], ["a city nowhere", { locations: [] }]];
      for (const [label, biz] of cases) {
        newStops();
        const f = fresh(tmp, "d11" + label.replace(/\W/g, ""), biz);
        const x = await drive(f, { pf: pagesFile("d11" + label.replace(/\W/g, ""), { directories: dirs(HOSTS) }), pages: [page(1)] });
        if (x.code !== 3 || !nothingOpened(x) || !/^BLOCKED: .* \| unblocks: approve-business$/.test(x.last) || f.hasRec() || f.hasCit()) bad.push(label + " -> exit " + x.code + " " + x.last);
      }
      newStops();
      const g = fresh(tmp, "d11gone");
      fs.rmSync(path.join(g.pewp, "approved", "business.json"));
      const y = await drive(g, { pf: pagesFile("d11gone", { directories: dirs(HOSTS) }), pages: [page(1)] });
      if (y.code !== 3 || !nothingOpened(y) || !/^BLOCKED: .* \| unblocks: approve-business$/.test(y.last)) bad.push("no approved file -> exit " + y.code + " " + y.last);
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D11: the name is name, else legalName; the city is market.city, else the city of the first location that has an address ('1 Main St, Tracy, CA, 95376' -> Tracy, a structured address, a street-state-zip with no commas before the state): the address loaded carries them", async () => {
      const bad = [], one = ["yelp.com"];
      const run1 = async (label, biz, wantName, wantCity) => {
        newStops();
        const f = fresh(tmp, "d11b" + label, biz), x = await drive(f, { pf: pagesFile("d11b" + label, { directories: dirs(one, one) }), pages: [page(1, { blocks: [blk(wantName)] })] });
        if (x.code !== 0 || lj(x.log.loads) !== lj([addr("yelp.com", wantName, wantCity)])) bad.push(label + " -> exit " + x.code + " " + lj(x.log.loads));
      };
      await run1("legal", { name: undefined, legalName: "Legal Name Realty LLC" }, "Legal Name Realty LLC", "Tracy");
      await run1("market", { market: { country: "US", language: "en", city: "Manteca" } }, BIZNAME, "Manteca");
      await run1("second", { locations: [{ name: "x", address: null }, { name: "Elk Grove, CA", address: "5 Oak Ave, Elk Grove, CA 95624" }] }, BIZNAME, "Elk Grove");
      await run1("object", { locations: [{ address: { streetAddress: "7 Elm St", addressLocality: "Lathrop", addressRegion: "CA", postalCode: "95330" } }] }, BIZNAME, "Lathrop");
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D12 the waits are the pace block, exactly
    await C("D12: all four read: the waits are exactly the pace block (here 5 and 60, no jitter), ONE tab (openPlain once, the others navigate), one connection, nothing sent to the browser by the script itself, the loads in file order", async () => {
      newStops();
      const f = fresh(tmp, "d12"), bad = [], pace = { tabsAtOnce: 1, afterLoadSeconds: 5, gapSeconds: 60, maxPagesPerRun: 30 };
      const x = await drive(f, { pf: pagesFile("d12", { pace }), pages: [page(1), page(2), page(3), page(4)] });
      if (x.code !== 0 || x.log.waits.join() !== [5, 60, 5, 60, 5, 60, 5].join()) bad.push("exit " + x.code + " waits " + x.log.waits.join());
      if (lj(x.log.loads) !== lj(HOSTS.map((h) => addr(h))) || x.log.opens !== 1 || x.log.navs !== 3 || x.log.maxOpen !== 1 || x.log.connects !== 1 || x.log.open !== 0 || x.log.sends !== 0) bad.push("loads " + x.log.loads.length + " openPlain " + x.log.opens + " navigate " + x.log.navs + " connections " + x.log.connects + " sends " + x.log.sends);
      if (x.last !== "READ: directories 4 read, 0 left" || f.rows().length !== 4) bad.push("last " + x.last);
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D12: maxPagesPerRun caps the pages loaded (2 of 4 loaded, the other two left 'over this run's cap')", async () => {
      newStops();
      const f = fresh(tmp, "d12b"), bad = [];
      const x = await drive(f, { pf: pagesFile("d12b", { pace: { ...PACE, maxPagesPerRun: 2 } }), pages: [page(1), page(2), page(3)] });
      const rec = f.hasRec() ? f.rec() : null;
      if (x.code !== 0 || x.log.loads.length !== 2 || !rec || lj(rec.left.map((l) => [l.directory, l.why])) !== lj([["mapquest.com", "over this run's cap"], ["yelp.com", "over this run's cap"]])) bad.push("cap: exit " + x.code + " loads " + x.log.loads.length + " " + lj(rec && rec.left));
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D12: the command line: no flag changes a wait (--gap, --no-wait, --retries are exit 2), no address is exit 2, a bad pace block in the file is exit 2 naming its key (gapSeconds 44, tabsAtOnce 2), each with nothing opened", async () => {
      newStops();
      const f = fresh(tmp, "d12c"), bad = [];
      const ctl = await drive(f, { pf: pagesFile("d12cctl", { directories: dirs(["yelp.com"]) }), pages: [page(1)] });   // the control: a good configuration is read, so that an exit 2 below is the refusal
      if (ctl.code !== 0 || ctl.log.loads.length !== 1) bad.push("the control run: exit " + ctl.code);
      for (const extra of [["--gap", "10"], ["--no-wait"], ["--retries", "2"]]) { const x = await drive(f, { argv: [SITE, "--cwd", f.cwd, ...extra], pages: [page(1)] }); if (x.code !== 2 || !nothingOpened(x)) bad.push(extra.join(" ") + " -> exit " + x.code); }
      const none = await drive(f, { argv: ["--cwd", f.cwd], pages: [page(1)] });
      if (none.code !== 2 || !nothingOpened(none)) bad.push("no address -> exit " + none.code);
      for (const [key, pace] of [["gapSeconds", { ...PACE, gapSeconds: 44 }], ["tabsAtOnce", { ...PACE, tabsAtOnce: 2 }]]) {
        const x = await drive(f, { pf: pagesFile("d12c" + key, { pace }), pages: [page(1)] });
        if (x.code !== 2 || !x.lines.join("\n").includes(key) || !nothingOpened(x)) bad.push(key + " -> exit " + x.code + " " + x.lines.join(" / "));
      }
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D13 the manifest (the real tree, not a mutated copy)
    await C("D13: the manifest: capture-directories is a program step (read-directories.mjs, its args, the work browser, 45 minutes, its inputs, outputs and evidence), not waiting, and validateManifest has no problem", async () => {
      const lib = await import(pathToFileURL(path.join(here, "lib-pipeline.mjs")).href);
      const man = lib.loadManifest(path.join(here, "..", "pipeline.json")).manifest, s = man.steps.find((x) => x.id === "capture-directories"), bad = [];
      if (!s) bad.push("no capture-directories step");
      else {
        const want = { script: "scripts/read-directories.mjs", needsBrowser: "work", heavy: false, timeoutMinutes: 45, needsAi: false, needsPerson: false, hits: "third-party:directories", station: "local", module: "reputation", kind: "time-sensitive", maxAgeDays: 90 };
        for (const [k, v] of Object.entries(want)) if (s[k] !== v) bad.push(k + " = " + lj(s[k]));
        if (lj(s.args) !== lj(["{key}", "--cwd", "{skill}"])) bad.push("args " + lj(s.args));
        if (lj(s.dependsOn) !== lj(["approve-business"]) || lj(s.inputs) !== lj(["{pewp}/approved/business.json"]) || lj(s.outputs) !== lj(["{pewp}/captures/local/citations.json"]) || lj(s.evidence) !== lj(["{pewp}/captures/local/citations.json"])) bad.push("dependsOn / inputs / outputs / evidence");
        if (lib.isWaiting(s)) bad.push("the step still waits");
        if (typeof s.pace !== "string" || /\d/.test(s.pace) || typeof s.brief !== "string" || /owner's Edge/.test(s.brief) || /by hand/.test(s.brief)) bad.push("pace / brief words: " + lj([s.pace, s.brief]));
      }
      const v = lib.validateManifest(man, { skillDir: path.dirname(here) });
      if (!v.ok) bad.push("validateManifest: " + v.problems.map(lib.describe).join("; "));
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D14 what the script must not have
    await C("D14: read-directories.mjs has no Google address, no input, no user agent, no reload, no random wait, no environment variable, no fresh browser context, no click or key press; it uses the drv driver (openPlain), isStopped and writeStop, and says 'no location override and no permission grant'", async () => {
      const src = fs.readFileSync(path.join(dir, "read-directories.mjs"), "utf8"), bad = [];
      for (const [name, re] of [["a Google address", /google/i], ["input events", /Input\.|dispatch(Key|Mouse)/], ["a user agent", /userAgent|user-agent|setUserAgent/i], ["a reload", /reload/i], ["a random number", /Math\.random|randomInt|crypto/], ["an environment variable", /process\.env/], ["a new browser context", /createBrowserContext/], ["a click or a key press", /\.click\(|keyboard|insertText/], ["openPage", /\bopenPage\b/], ["a location override or a grant", /grantPermissions|setGeolocationOverride|Emulation\./]]) if (re.test(src)) bad.push("read-directories.mjs has " + name);
      for (const [name, re] of [["drv.openPlain", /drv\.openPlain\(/], ["isStopped(", /isStopped\(/], ["writeStop(", /writeStop\(/], ["the pace pause", /pause\(/], ["the words about location and permission", /no location override and no permission grant/]]) if (!re.test(src)) bad.push("read-directories.mjs does not have " + name);
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D15 the in-page reader, on an invented document
    await C("D15: the in-page reader, run on an invented document: per block the text of name, address, phone and the href of the link; a selector that is not given gives null; the page's address, status and text come back", async () => {
      const el = (text, kids = {}, href = null) => ({ textContent: text, href, getAttribute: (k) => (k === "href" ? href : null), querySelector: (s) => kids[s] || null });
      const b1 = el("", { ".nm": el("  Read Dir   Test Realty "), ".ad": el("1 Main St,\n Tracy"), ".ph": el("(209) 555-0100"), "a.lk": el("x", {}, "https://dir.test/biz/1") });
      const b2 = el("", { ".nm": el("Other Co") });
      const doc = { title: "T", body: { innerText: "body words" }, querySelectorAll: (s) => (s === ".res" ? [b1, b2] : []), querySelector: (s) => (s === ".none" ? el("No results") : null) };
      const ctx = vm.createContext({ document: doc, location: { href: "https://www.yelp.com/search?x" }, performance: { getEntriesByType: () => [{ responseStatus: 200 }] } });
      const full = vm.runInContext(mod.readerExpr(DESC), ctx), part = vm.runInContext(mod.readerExpr({ result: ".res", name: ".nm" }), ctx), bad = [];
      if (lj(full.blocks) !== lj([{ name: "Read Dir Test Realty", address: "1 Main St, Tracy", phone: "(209) 555-0100", link: "https://dir.test/biz/1" }, { name: "Other Co", address: null, phone: null, link: null }])) bad.push("blocks " + lj(full.blocks));
      if (full.href !== "https://www.yelp.com/search?x" || full.status !== 200 || full.bodyText !== "body words" || full.title !== "T") bad.push("page " + lj({ ...full, blocks: 0 }));
      if (lj(part.blocks.map((b) => [b.address, b.phone, b.link])) !== '[[null,null,null],[null,null,null]]') bad.push("part " + lj(part.blocks));
      // noResults: true only when the selector is set and matches the document; false when it is set and does not match, and false when it is not set
      const hit = vm.runInContext(mod.readerExpr({ ...DESC, noResults: ".none" }), ctx), miss = vm.runInContext(mod.readerExpr({ ...DESC, noResults: ".gone" }), ctx);
      if (hit.noResults !== true) bad.push("noResults selector that matches -> " + lj(hit.noResults));
      if (miss.noResults !== false) bad.push("noResults selector that does not match -> " + lj(miss.noResults));
      if (full.noResults !== false || part.noResults !== false) bad.push("no noResults selector -> " + lj([full.noResults, part.noResults]));
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D16-D18 a page with no result blocks is not a "not listed" unless the page says "no results"
    const NR = { ...DESC, noResults: ".none" }, dirsWith = (desc, only) => Object.fromEntries(only.map((h) => [h, { search: SEARCH[h], selectors: desc }]));
    const noBlocks = (n, o = {}) => page(n, { blocks: [], ...o });
    await C("D16: zero result blocks and no noResults selector on directory 2 of 3: NOT gathered (no row), no stop, left with the 'may be out of date' reason, not counted as read, directory 3 is read, the waits exact, exit 0", async () => {
      const d = newStops(), f = fresh(tmp, "d16"), bad = [], three = ["yellowpages.com", "bbb.org", "mapquest.com"];
      const x = await drive(f, { pf: pagesFile("d16", { directories: dirs(three, three) }), pages: [page(1), noBlocks(2), page(3)] });
      const rec = f.hasRec() ? f.rec() : null, rows = f.hasCit() ? f.rows() : [];
      if (x.code !== 0 || x.log.loads.length !== 3 || x.log.waits.join() !== [8, 45, 8, 45, 8].join()) bad.push("exit " + x.code + " loads " + x.log.loads.length + " waits " + x.log.waits.join());
      if (lj(rows.map((r) => r.directory)) !== '["yellowpages.com","mapquest.com"]' || rows.some((r) => r.listed === false)) bad.push("rows " + lj(rows));
      if (stopFiles(d).length !== 0) bad.push("a stop was written: " + lj(stopFiles(d)));
      if (!rec || lj(rec.read) !== '["yellowpages.com","mapquest.com"]' || rec.left.length !== 1 || rec.left[0].directory !== "bbb.org" || rec.left[0].why !== "no result blocks on the page and no no-results sign (the page description may be out of date)" || (rec.stops && rec.stops.length !== 0)) bad.push("record " + lj(rec));
      if (x.last !== "READ: directories 2 read, 1 left") bad.push("last line " + x.last);
      // the only directory: nothing was read, exit 3 BLOCKED, no citations.json
      const g = fresh(tmp, "d16b");
      const y = await drive(g, { pf: pagesFile("d16b", { directories: dirs(["bbb.org"], ["bbb.org"]) }), pages: [noBlocks(1)] });
      if (y.code !== 3 || !/^BLOCKED: /.test(y.last) || !y.lines.includes("READ: directories 0 read, 1 left") || g.hasCit() || !g.hasRec() || g.rec().status !== "blocked" || lj(g.rec().read) !== "[]") bad.push("the only one: exit " + y.code + " " + lj(y.lines) + " cit " + g.hasCit());
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D17: zero blocks and the page matches the noResults selector: the listed:false row exactly as D5 (directory, url, listed, capturedAt, capturedIn), counted as read, NOT LISTED in local-nap; a noResults that is not a string is exit 2", async () => {
      newStops();
      const f = fresh(tmp, "d17"), bad = [];
      const x = await drive(f, { pf: pagesFile("d17", { directories: dirsWith(NR, ["mapquest.com"]) }), pages: [noBlocks(1, { noResults: true })] });
      const row = f.hasCit() ? f.rows()[0] : null;
      if (x.code !== 0 || !row) return [false, "exit " + x.code + " rows " + (f.hasCit() ? lj(f.rows()) : "none") + " " + x.lines.join(" / ")];
      if (lj(Object.keys(row).sort()) !== lj(["capturedAt", "capturedIn", "directory", "listed", "url"]) || row.listed !== false || row.directory !== "mapquest.com" || row.url !== "https://www.page1.test/search?x=1" || row.capturedIn !== "work browser" || !Date.parse(row.capturedAt)) bad.push("row " + lj(row));
      if (x.last !== "READ: directories 1 read, 0 left" || lj(f.rec().read) !== '["mapquest.com"]') bad.push("last line " + x.last);
      if (lj(nap.checkCitations(f.rows(), nap.canonicalNap(f.biz)).notChecked.map((c) => [c.directory, c.status])) !== lj([["mapquest.com", "NOT LISTED"]])) bad.push("local-nap does not read it as NOT LISTED");
      newStops();
      const g = fresh(tmp, "d17b");
      const y = await drive(g, { pf: pagesFile("d17b", { directories: dirsWith({ ...DESC, noResults: 5 }, ["mapquest.com"]) }), pages: [page(1)] });
      if (y.code !== 2 || !nothingOpened(y) || g.hasRec() || g.hasCit() || !/mapquest\.com/.test(y.lines.join("\n"))) bad.push("noResults not a string -> exit " + y.code + " " + y.lines.join(" / "));
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D18: result blocks present and none matches the business: listed:false, with the noResults selector set and not matching, and without one (as D5); blocks that do match are the listing even when noResults is true", async () => {
      newStops();
      const f = fresh(tmp, "d18"), bad = [];
      const other = [blk("Someone Else", { phone: "(209) 555-0199" }), blk("Another Realty", { phone: "(209) 555-0198" })];
      const x = await drive(f, { pf: pagesFile("d18", { directories: { "mapquest.com": { search: SEARCH["mapquest.com"], selectors: NR }, "yelp.com": { search: SEARCH["yelp.com"], selectors: DESC }, "bbb.org": { search: SEARCH["bbb.org"], selectors: NR } } }), pages: [page(1, { blocks: other, noResults: false }), page(2, { blocks: other }), page(3, { noResults: true })] });
      const rows = f.hasCit() ? f.rows() : [], by = (h) => rows.find((r) => r.directory === h);
      if (x.code !== 0 || rows.length !== 3) return [false, "exit " + x.code + " rows " + lj(rows) + " " + x.lines.join(" / ")];
      for (const h of ["mapquest.com", "yelp.com"]) if (!by(h) || by(h).listed !== false || lj(Object.keys(by(h)).sort()) !== lj(["capturedAt", "capturedIn", "directory", "listed", "url"])) bad.push(h + " -> " + lj(by(h)));
      if (!by("bbb.org") || by("bbb.org").listed === false || by("bbb.org").name !== BIZNAME + ", LLC") bad.push("blocks that match with noResults true -> " + lj(by("bbb.org")));
      if (x.last !== "READ: directories 3 read, 0 left") bad.push("last line " + x.last);
      return [bad.length === 0, bad.join(" | ")];
    });

    // ------------------------------------------------------------ D19-D22 a listing is matched by name OR phone; a near name is never "not listed" (AB-15)
    const MID = "Midtown Modern Dental", MIDPH = "(916) 246-0889", NEAR = "a listing with a near name (Midtown Modern Dental Group) that no phone confirms";
    const mb = (name, phone) => blk(name, { phone, address: "1 K St, Sacramento, CA 95814" });
    const midFresh = (n, o = {}) => fresh(tmp, n, { name: MID, phone: MIDPH, locations: [{ name: "Sacramento, CA", address: "1 K St, Sacramento, CA, 95814" }], ...o });
    const midRun = (f, n, blocks) => drive(f, { pf: pagesFile(n, { directories: dirsWith(DESC, ["yellowpages.com"]) }), pages: [page(1, { blocks })] });
    await C("D19: the measured case: business 'Midtown Modern Dental' (916) 246-0889, blocks [Modern Family Dental (916) 928-9300, Midtown Modern Dental Group (916) 246-0889]: the row is the Group block (the phone); a phone with a country code (+1 ... / 1-...) is the same phone (last 10 digits); an exact name wins over a phone shared by another block; the phone may come from the first location", async () => {
      const bad = [], one = async (n, f, blocks) => { newStops(); const x = await midRun(f, n, blocks); return { x, row: f.hasCit() ? f.rows()[0] : null }; };
      let r = await one("d19", midFresh("d19"), [mb("Modern Family Dental", "(916) 928-9300"), mb(MID + " Group", MIDPH)]);
      if (r.x.code !== 0 || !r.row || r.row.listed === false || r.row.name !== MID + " Group" || r.row.phone !== MIDPH || r.x.last !== "READ: directories 1 read, 0 left") bad.push("the measured case: exit " + r.x.code + " " + lj(r.row) + " " + r.x.last);
      r = await one("d19b", midFresh("d19b"), [mb("Modern Family Dental", "(916) 928-9300"), mb(MID + " Group", "+1 916-246-0889")]);
      if (!r.row || r.row.listed === false || r.row.name !== MID + " Group") bad.push("a country code: " + lj(r.row));
      r = await one("d19c", midFresh("d19c"), [mb("Modern Family Dental", MIDPH), mb(MID, "(916) 555-0000")]);
      if (!r.row || r.row.listed === false || r.row.name !== MID) bad.push("exact name before phone: " + lj(r.row));
      r = await one("d19d", midFresh("d19d", { phone: undefined, locations: [{ name: "Sacramento, CA", address: "1 K St, Sacramento, CA, 95814", phone: MIDPH }] }), [mb("Modern Family Dental", "(916) 928-9300"), mb(MID + " Group", MIDPH)]);
      if (!r.row || r.row.listed === false || r.row.name !== MID + " Group") bad.push("phone of the first location: " + lj(r.row));
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D20: the same without a business phone, or with another phone on the near name: NOT gathered: no row, no citations.json, no stop, not counted as read, left with the near-name why naming the block; also when the business name is the longer one", async () => {
      const bad = [], one = async (n, f, blocks) => { const d = newStops(), x = await midRun(f, n, blocks); return { x, d, rec: f.hasRec() ? f.rec() : null }; };
      for (const [n, f, blocks, want] of [
        ["d20", midFresh("d20", { phone: undefined }), [mb("Modern Family Dental", "(916) 928-9300"), mb(MID + " Group", MIDPH)], NEAR],
        ["d20b", midFresh("d20b"), [mb(MID + " Group", "(916) 111-2222")], NEAR],
        ["d20c", midFresh("d20c", { name: MID + " Care", phone: undefined }), [mb(MID, MIDPH)], "a listing with a near name (" + MID + ") that no phone confirms"],
      ]) {
        const r = await one(n, f, blocks);
        if (r.x.code !== 3 || f.hasCit() || stopFiles(r.d).length !== 0 || !r.rec || r.rec.read.length !== 0 || lj(r.rec.left) !== lj([{ directory: "yellowpages.com", why: want }]) || r.x.last.indexOf("BLOCKED") !== 0 || !r.x.lines.includes("READ: directories 0 read, 1 left")) bad.push(n + ": exit " + r.x.code + " rec " + lj(r.rec) + " cit " + f.hasCit() + " stops " + stopFiles(r.d).length + " " + r.x.last);
      }
      // a near name on directory 1 of 2 does not end the run: directory 2 is read
      const d = newStops(), g = midFresh("d20d"), two = ["yellowpages.com", "bbb.org"];
      const y = await drive(g, { pf: pagesFile("d20d", { directories: dirsWith(DESC, two) }), pages: [page(1, { blocks: [mb(MID + " Group", "(916) 111-2222")] }), page(2, { blocks: [mb(MID, MIDPH)] })] });
      if (y.code !== 0 || y.log.loads.length !== 2 || !g.hasRec() || lj(g.rec().read) !== '["bbb.org"]' || lj(g.rec().left) !== lj([{ directory: "yellowpages.com", why: NEAR }]) || !g.hasCit() || lj(g.rows().map((r) => r.directory)) !== '["bbb.org"]' || stopFiles(d).length !== 0 || y.last !== "READ: directories 1 read, 1 left") bad.push("two directories: exit " + y.code + " loads " + y.log.loads.length + " rec " + (g.hasRec() ? lj(g.rec()) : "none") + " " + y.last);
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D21: blocks with unrelated names and phones (and a name that only starts with the same letters, 'Midtown Modern Dentals': no space after the business name): listed:false, counted as read, exactly as D5", async () => {
      newStops();
      const f = midFresh("d21"), bad = [];
      const x = await midRun(f, "d21", [mb("Modern Family Dental", "(916) 928-9300"), mb("Midtown Modern Dentals", "(916) 333-4444"), mb("Capital Smiles", "(916) 777-8888")]);
      const row = f.hasCit() ? f.rows()[0] : null;
      if (x.code !== 0 || !row || row.listed !== false || lj(Object.keys(row).sort()) !== lj(["capturedAt", "capturedIn", "directory", "listed", "url"])) bad.push("exit " + x.code + " row " + lj(row));
      if (x.last !== "READ: directories 1 read, 0 left") bad.push("last line " + x.last);
      return [bad.length === 0, bad.join(" | ")];
    });
    await C("D22: the shipped read-pages.json: yellowpages.com and bbb.org hold exactly the two measured descriptions (no noResults), mapquest.com and yelp.com stay NOT SET; each description passes the script's own check (the run is no exit 2, two pages are loaded, the other two are left 'no page description')", async () => {
      const real = J(path.join(dir, "read-pages.json")).directories, bad = [];
      const yp = { result: "div.search-results.organic > div.result", name: "a.business-name", address: "div.adr", phone: "div.phones", link: "a.business-name" };
      const bbb = { result: "div.search-results div.card.result-card", name: "h3", address: ".result-business-info p", phone: 'a[href^="tel:"]', link: "h3 a" };
      if (lj(real["yellowpages.com"].selectors) !== lj(yp)) bad.push("yellowpages.com " + lj(real["yellowpages.com"].selectors));
      if (lj(real["bbb.org"].selectors) !== lj(bbb)) bad.push("bbb.org " + lj(real["bbb.org"].selectors));
      for (const h of ["mapquest.com", "yelp.com"]) if (real[h].selectors !== NOTSET) bad.push(h + " " + lj(real[h].selectors));
      newStops();
      const f = fresh(tmp, "d22"), x = await drive(f, { pf: path.join(dir, "read-pages.json"), pages: [] });
      if (x.code === 2 || x.log.loads.length !== 2 || !f.hasRec() || lj(f.rec().left.filter((l) => l.why === "no page description").map((l) => l.directory)) !== '["mapquest.com","yelp.com"]') bad.push("the run: exit " + x.code + " " + x.lines.join(" / ") + " loads " + x.log.loads.length);
      return [bad.length === 0, bad.join(" | ")];
    });
  } finally { delete process.env.OMNIKOM_STOPS_DIR; rmTmp(tmp); }
  if (loadErr) results.push({ name: "D0: read-directories.mjs loads", ok: false, detail: loadErr });
  return results;
}

const RD = "read-directories.mjs";
const MUTANTS = [
  { name: "the gap is not waited", patches: [{ file: RD, from: 'if (loaded > 0) await pause(pace.gapSeconds, "gap before the next load");', to: "" }], expect: [/^D6:/, /^D12: all four/] },
  { name: "a check ends the run instead of only its host", patches: [{ file: RD, from: "left.push({ directory: h, why: reason });\n        continue;", to: "left.push({ directory: h, why: reason });\n        break;" }], expect: [/^D6:/, /^D7: a 429/] },
  { name: "a check stops every directory's host", patches: [{ file: RD, from: "hosts: [h], reason,", to: 'hosts: ["yellowpages.com", "bbb.org", "mapquest.com", "yelp.com"], reason,' }], expect: [/^D6:/, /^D7: a 429/] },
  { name: "a 429 does not stop", patches: [{ file: "read-bing.mjs", from: "if (status === 429 || status === 403)", to: "if (status === 403)" }], expect: [/^D7: a 429/] },
  { name: "a check leaves its tab open", patches: [{ file: RD, from: "await drv.closePage(cdp, tab.targetId); tab = null;\n        const reason", to: "tab = null;\n        const reason" }], expect: [/^D6:/, /^D7:/] },
  { name: "a sign-in wall writes a stop", patches: [{ file: RD, from: 'if (wall) { left.push({ directory: h, why: wall + " hides the results" }); continue; }', to: 'if (wall) { writeStop({ engine: stopName(h), hosts: [h], reason: wall, setBy: "x" }); left.push({ directory: h, why: wall + " hides the results" }); continue; }' }], expect: [/^D8: a sign-in wall/] },
  { name: "an active stop is gone against", patches: [{ file: RD, from: "const st = isStopped(h);", to: "const st = null;" }], expect: [/^D9:/] },
  { name: "a NOT SET directory is refused as a bad description instead of left", patches: [{ file: RD, from: 'if (d.selectors === "NOT SET") continue;', to: "" }], expect: [/^D2:/, /^D3:/] },
  { name: "a second tab is opened for each directory", patches: [{ file: RD, from: "if (!tab) tab = await drv.openPlain(cdp, address); else await drv.navigate(cdp, tab, address);", to: "tab = await drv.openPlain(cdp, address);" }], expect: [/^D8: a sign-in wall/, /^D12: all four/] },
  { name: "the wait after a load has a jitter", patches: [{ file: RD, from: 'await pause(pace.afterLoadSeconds, "after load");', to: 'await pause(pace.afterLoadSeconds + Math.random(), "after load");' }], expect: [/^D6:/, /^D12: all four/, /^D14:/] },
  { name: "the page cap is ignored", patches: [{ file: RD, from: "else if (todo.length >= pace.maxPagesPerRun)", to: "else if (false)" }], expect: [/^D12: maxPagesPerRun/] },
  { name: "the listing is any block that starts with the name", patches: [{ file: RD, from: "normName(b.name) === want", to: "normName(b.name).startsWith(want)" }], expect: [/^D4:/] },
  { name: "the listing is the last matching block, not the first", patches: [{ file: RD, from: "const byName = list.find(", to: "const byName = list.slice().reverse().find(" }], expect: [/^D4:/] },
  { name: "no matching block is a row without listed false", patches: [{ file: RD, from: "{ ...base, url: pageUrl, listed: false, capturedAt", to: "{ ...base, url: pageUrl, capturedAt" }], expect: [/^D5:/] },
  { name: "an empty phone is an empty string, not null", patches: [{ file: RD, from: "const orNull = (s) => clean(s) || null;", to: "const orNull = (s) => clean(s);" }], expect: [/^D4:/] },
  { name: "the url of a block with no link is empty", patches: [{ file: RD, from: "url: orNull(hit.link) || pageUrl", to: "url: orNull(hit.link)" }], expect: [/^D4:/] },
  { name: "the rows of the earlier run are all replaced", patches: [{ file: RD, from: "[...existing.filter((r) => !rows.some((n) => n.directory === (r && r.directory))), ...rows]", to: "rows" }], expect: [/^D10:/] },
  { name: "the earlier row of a directory read again is kept", patches: [{ file: RD, from: "[...existing.filter((r) => !rows.some((n) => n.directory === (r && r.directory))), ...rows]", to: "[...existing, ...rows]" }], expect: [/^D10:/] },
  { name: "a name is not encoded into the address", patches: [{ file: RD, from: "encodeURIComponent(vals[k])", to: "vals[k]" }], expect: [/^D1: the address/] },
  { name: "an address that only ends like the host is accepted", patches: [{ file: RD, from: 'u.hostname.endsWith("." + host)', to: "u.hostname.endsWith(host)" }], expect: [/^D1: the address/] },
  { name: "a missing name does not block", patches: [{ file: RD, from: "if (!name || !city) return bye(3,", to: "if (!name && !city) return bye(3," }], expect: [/^D11: no name/] },
  { name: "the city of a location is not read", patches: [{ file: RD, from: "return loc ? cityOfAddress(loc.address) : null;", to: "return null;" }], expect: [/^D11: the name/] },
  { name: "the in-page reader leaves out the link", patches: [{ file: RD, from: "link: a ? String(a.href || a.getAttribute(\"href\") || \"\") || null : null", to: "link: null" }], expect: [/^D15:/] },
  { name: "zero result blocks are read as listed:false again", patches: [{ file: RD, from: "if (!blocks.length && pg.noResults !== true) {", to: "if (false) {" }], expect: [/^D16:/] },
  { name: "only an explicit noResults:false counts as a page without the sign", patches: [{ file: RD, from: "pg.noResults !== true) {", to: "pg.noResults === false) {" }], expect: [/^D16:/] },
  { name: "a zero-block page with the no-results sign is left too", patches: [{ file: RD, from: "if (!blocks.length && pg.noResults !== true) {", to: "if (!blocks.length) {" }], expect: [/^D17:/] },
  { name: "the noResults selector is ignored by the in-page reader", patches: [{ file: RD, from: "const noResults = d.noResults ? !!document.querySelector(d.noResults) : false;", to: "const noResults = false;" }], expect: [/^D15:/] },
  { name: "the noResults answer of the in-page reader is always true", patches: [{ file: RD, from: "const noResults = d.noResults ? !!document.querySelector(d.noResults) : false;", to: "const noResults = true;" }], expect: [/^D15:/] },
  { name: "a noResults that is not a string is accepted", patches: [{ file: RD, from: '["address", "phone", "link", "noResults"]', to: '["address", "phone", "link"]' }], expect: [/^D17:/] },
  { name: "a zero-block page writes a stop", patches: [{ file: RD, from: "left.push({ directory: h, why: NO_BLOCKS }); continue; }", to: 'left.push({ directory: h, why: NO_BLOCKS }); writeStop({ engine: stopName(h), hosts: [h], reason: "x", setBy: "x" }); continue; }' }], expect: [/^D16:/] },
  { name: "the phone rule is left out", patches: [{ file: RD, from: "hit = byName || byPhone", to: "hit = byName" }], expect: [/^D19:/] },
  { name: "a near name is read as listed:false", patches: [{ file: RD, from: "if (near) return { near: orNull(near.name) };", to: "" }], expect: [/^D20:/] },
  { name: "the phone is compared with all its digits, not the last 10", patches: [{ file: RD, from: 'const last10 = (s) => String(s == null ? "" : s).replace(/\\D/g, "").slice(-10);', to: 'const last10 = (s) => String(s == null ? "" : s).replace(/\\D/g, "");' }], expect: [/^D19:/] },
  { name: "a phone is checked before the name", patches: [{ file: RD, from: "hit = byName || byPhone", to: "hit = byPhone || byName" }], expect: [/^D19:/] },
  { name: "the phone of the first location is not used", patches: [{ file: RD, from: "(b.phone || ((b.locations || []).find((l) => l && l.phone) || {}).phone)", to: "b.phone" }], expect: [/^D19:/] },
  { name: "a block name that starts with the business name is no near name", patches: [{ file: RD, from: "n.startsWith(want + \" \") || ", to: "" }], expect: [/^D20:/] },
  { name: "a business name that starts with the block name is no near name", patches: [{ file: RD, from: "|| want.startsWith(n + \" \")", to: "" }], expect: [/^D20:/] },
  { name: "a near name needs no space after the business name", patches: [{ file: RD, from: "n.startsWith(want + \" \")", to: "n.startsWith(want)" }], expect: [/^D21:/] },
  { name: "a near name stops the run", patches: [{ file: RD, from: "left.push({ directory: h, why: NEAR + lf.near + NEAR_END }); continue;", to: "left.push({ directory: h, why: NEAR + lf.near + NEAR_END }); break;" }], expect: [/^D20:/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-read-directories.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "READ DIRECTORIES", scenarios, MUTANTS, scriptsDir, argv: A }));
}
