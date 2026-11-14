// Usage: node test-grid-text.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of grid-text-to-capture.mjs (a saved Google Maps page text, a results list or one place's card, becomes one grid capture file).
// Every case builds a run folder in a temporary folder from INVENTED names, writes one page text and starts the command as a child
// process. No network, no browser, no repository file is read except local-grid.mjs (cases 4 and 8: the capture must be taken by importGrid).
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs twice is refused).
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "card-unknown-rating-written-null", file: "grid-text-to-capture.mjs", from: "refuse(rated.length === 0 || lm,", to: "void (", red: "case 9:" },
    { id: "card-rating-from-whole-block", file: "grid-text-to-capture.mjs", from: "const hdr = t.slice(iName + 1, hdrEnd);", to: "const hdr = t.slice(iName + 1);", red: "case 8:" },
    { id: "card-name-not-taken-out", file: "grid-text-to-capture.mjs", from: 'const without = (l) => l.toLowerCase().split(name.toLowerCase()).join(" ");', to: "const without = (l) => l;", red: "case 11:" },
    { id: "ad-heading-not-sponsored", file: "grid-text-to-capture.mjs", from: "sponsored: /^(ad|sponsored) · /i.test(h[1])", to: "sponsored: false", red: "case 2:" },
    { id: "viewport-far-accepted", file: "grid-text-to-capture.mjs", from: "const TOL = 0.0003;", to: "const TOL = 0.5;", red: "case 5:" },
    { id: "robot-words-accepted", file: "grid-text-to-capture.mjs", from: 'refuse(!/unusual traffic|not a robot|recaptcha|before you continue/i.test(text.join(" ")),', to: 'refuse(!/never-matches-this-text/i.test(text.join(" ")),', red: "case 5:" },
    { id: "card-header-words-judged", file: "grid-text-to-capture.mjs", from: "const body = text.slice(1);", to: "const body = text.slice(0);", red: "case 8:" },
    { id: "captured-file-overwritten", file: "grid-text-to-capture.mjs", from: 'refuse(!("method" in old),', to: "refuse(true,", red: "case 6:" },
    { id: "more-than-20-rows", file: "grid-text-to-capture.mjs", from: "parseRows(text.slice(1)).slice(0, 20)", to: "parseRows(text.slice(1))", red: "case 3:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gtext-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-grid-text.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  const total = queue.length;
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${total} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const CMD = path.join(dir, "grid-text-to-capture.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtext-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
// a case body returns a list of problems (empty = pass); a throw is that case's failure, not the run's
const CASE = async (name, fn) => { try { const bad = (await fn()).filter(Boolean); check(name, bad.length === 0, bad.join(" | ")); } catch (e) { check(name, false, e.stack || String(e)); } };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const BIZ = "Alder Bay Roof Works";
const QUERY = "roofer alder bay";
const ID = "ab__roofer__r1c1";
const VP = "38.50000,-121.50000,14z";

// ---------------------------------------------------------------- the two page texts (every name and number is invented)
function row(r) {
  const L = [`Hyperlink: ${r.name}`];
  if (r.sponsoredLine) L.push("Text: Sponsored");
  if (r.rating) L.push(`Image: ${r.rating[0]} stars ${r.rating[1]} Reviews`);
  if (r.category) L.push(`Text: ${r.category}`);
  L.push("Image: Wheelchair accessible entrance");
  if (r.address) L.push(`Text: ${r.address}`);
  L.push("Text: Open", "Text: · Closes 6 PM");
  if (r.phone) L.push(`Text: ${r.phone}`);
  if (r.website) L.push(`Hyperlink: Visit ${r.name} website`);
  L.push(`Button: Get directions to ${r.name}`, 'Text: "Fast and tidy on the whole roof"');
  return L.map((l) => "            " + l);
}
const ROWS3 = [
  { name: "Ridgeline Roofs", rating: [4.8, "1,127"], category: "Roofing contractor", address: "120 Harbor Rd", phone: "(555) 010-0101", website: true },
  { name: "Summit Shingle Co", rating: [4.2, "88"], category: "Roof repair service", address: "45 Quarry Ln", phone: "(555) 010-0102", website: true },
  { name: "Birch Slate Roofing", rating: [3.9, "12"], category: "Roofing supply store", address: "7 Mill St", phone: "(555) 010-0103", website: false },
];
function listText({ id = ID, query = QUERY, rows = ROWS3, resultsLine = true, resultsFor = query, vp = VP, readAt = true, idle = true, extra = [] } = {}) {
  const l1 = `# i=7 id=${id} query=${query} point=r1c1 lat=38.50000 lng=-121.50000` + (readAt ? " readAtUtc=2026-01-05T10:00:00Z" : "") + (idle ? " idleMsBeforePage=130000 sinceOwnInputMsBeforePage=131000" : "") + ` title=${query} - Google Maps`;
  const L = [l1];
  if (vp) L.push(`VIEWPORT: ${vp}`);
  L.push("  Group: Google Maps", "      Pane: Google Maps", "        Button: Menu", "        Button: Search", "        Group: Available filters for this search", "          Button: Rating", "          Button: Hours");
  if (resultsLine) L.push(`            Group: Results for ${resultsFor}`);
  L.push("            Text: Results", "            Button: Share");
  for (const r of rows) L.push(...row(r));
  L.push(...extra);
  return L.join("\r\n") + "\r\n";
}
const defaultHeader = (name) => ["Button: Roofing contractor", "Image: Wheelchair accessible entrance", `TabItem: Overview of ${name}`, `TabItem: About ${name}`];
function placeBlock(name, header) {
  const L = [`Group: ${name}`, `Button: Photo of ${name}`, "Button: See photos", `Text: ${name}`, ...header, `Group: Actions for ${name}`, "Button: Directions", "Button: Share", `Group: Information for ${name}`,
    "Button: Address: 120 Harbor Rd Ste 4, Alder Bay, ST 00000", "Button: Copy address", "Button: Phone: (555) 010-0101", "Button: Add website", "Text: Photos & videos", "Button: Write a review", "Text: People also search for",
    "Hyperlink: Harbor Gutters · 4.5 stars · 2 reviews · Gutter service", "Image: 4.5 stars 2 Reviews", "Hyperlink: Quarry Lane Roofing · 0.0 stars · Roofing contractor"];
  return L.map((l, i) => (i === 0 ? "          " : "            ") + l);
}
function cardText({ id = ID, blocks = [{ name: BIZ }], vp = VP, viewportLine = `VIEWPORT: ${VP}`, readAt = "2026-01-05T10:00:00Z", extraBody = [] } = {}) {
  const l1 = `# i=100 id=${id} runnerLine=card at point 100 (${id}): the viewport is at the point; not a robot check addressBar=CHECK fg=ok ` + (vp ? `vp=${vp} ` : "") + `kbfocus=False readAtUtc=${readAt}`;
  const L = [l1];
  if (viewportLine) L.push(viewportLine);
  L.push("  Group: Google Maps", "      Pane: Google Maps", "        Button: Menu", "        Group: Available search options for this area", "          Button: Restaurants");
  for (const b of blocks) L.push(...placeBlock(b.name, b.header || defaultHeader(b.name)));
  L.push("    Button: Google Account: Test Person (person@example.test)", ...extraBody.map((l) => "    " + l));
  return L.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- one run folder
function mkRun(text, { reqId = ID, requests = null } = {}) {
  const d = fs.mkdtempSync(path.join(tmp, "run-"));
  const pewp = path.join(d, "pewp"), convert = path.join(d, "convert"), grid = path.join(pewp, "captures", "local", "grid");
  fs.mkdirSync(grid, { recursive: true }); fs.mkdirSync(convert, { recursive: true });
  fs.writeFileSync(path.join(pewp, "business.json"), JSON.stringify({ name: BIZ }));
  const reqs = requests || [{ id: reqId, query: QUERY, city: "Alder Bay, ST", location: "Alder Bay, ST (38.50000, -121.50000)", language: "en", captureFile: `${reqId}.json`, point: { id: "r1c1", row: 1, col: 1, lat: 38.5, lng: -121.5 } }];
  fs.writeFileSync(path.join(grid, "requests.json"), JSON.stringify({ requests: reqs }, null, 1));
  const page = path.join(d, "page.txt");
  if (text !== null) fs.writeFileSync(page, text);
  const capFile = path.join(grid, `${reqId}.json`);
  return { d, pewp, convert, grid, page, capFile, orig: path.join(convert, "originals", "grid", `${reqId}.json`) };
}
function run(r, kind, { capturedIn = "Test browser, desktop", extra = [] } = {}) {
  const a = ["--max-old-space-size=256", CMD, "--pewp", r.pewp, kind === "card" ? "--card" : "--raw", r.page, "--convert", r.convert, "--captured-in", capturedIn, ...extra];
  const p = spawnSync(process.execPath, a, { encoding: "utf8", timeout: 60000 });
  const lines = (p.stdout || "").split(/\r?\n/).filter(Boolean);
  return { code: p.status, out: p.stdout || "", err: p.stderr || "", last: lines.at(-1) || "", errLines: (p.stderr || "").split(/\r?\n/).filter(Boolean) };
}
const readCap = (r) => JSON.parse(fs.readFileSync(r.capFile, "utf8"));
// the one shape of every refusal: exit 1, ONE line starting REFUSED: , nothing written
function refusedProblems(label, res, r, wantLine = null) {
  const P = [];
  if (res.code !== 1) P.push(`${label}: exit ${res.code}, not 1`);
  if (!(res.errLines.length === 1 && res.errLines[0].startsWith("REFUSED: "))) P.push(`${label}: stderr is not one REFUSED line: ${JSON.stringify(res.err.slice(0, 160))}`);
  if (wantLine !== null && res.errLines[0] !== wantLine) P.push(`${label}: stderr ${JSON.stringify(res.errLines[0])} is not ${JSON.stringify(wantLine)}`);
  if (fs.existsSync(r.capFile)) P.push(`${label}: a capture file was written`);
  return P;
}
const refuseList = (label, text, o = {}, runOpts = {}) => { const r = mkRun(text, o); return refusedProblems(label, run(r, "raw", runOpts), r); };
const refuseCard = (label, text, o = {}) => { const r = mkRun(text, o); return refusedProblems(label, run(r, "card"), r); };

const KEYS = ["id", "query", "city", "location", "method", "viewport", "locationShown", "device", "language", "point", "capturedAt", "capturedIn", "robotCheck", "firstListOnly", "humanIdleBeforePage", "ourPosition", "pack", "notes", "rawFile"];
const gridMod = await import(pathToFileURL(path.join(dir, "local-grid.mjs")).href).catch(() => null);
const taken = (cap, r, packSize) => {
  if (!gridMod) return ["local-grid.mjs could not be imported"];
  const g = gridMod.importGrid([{ ...cap, _file: path.basename(r.capFile) }], { name: BIZ });
  return [g.rejected.length !== 0 && `importGrid rejected ${JSON.stringify(g.rejected)}`, g.points.length !== 1 && `importGrid points ${g.points.length}`, g.points[0]?.pointId !== "r1c1" && `pointId ${g.points[0]?.pointId}`, g.points[0]?.packSize !== packSize && `packSize ${g.points[0]?.packSize}`];
};

// ---------------------------------------------------------------- the cases
await CASE("case 1: a list of 3 rows becomes one capture, key by key", () => {
  const r = mkRun(listText()); const res = run(r, "raw"); const P = [];
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  const cap = readCap(r);
  if (!eq(Object.keys(cap), KEYS)) P.push(`keys ${Object.keys(cap).join(",")}`);
  if (cap.method !== "maps-viewport") P.push("method");
  if (!eq(cap.viewport, { lat: 38.5, lng: -121.5, zoom: 14 })) P.push(`viewport ${JSON.stringify(cap.viewport)}`);
  const want = [["Ridgeline Roofs", 4.8, 1127, "Roofing contractor", "120 Harbor Rd", "(555) 010-0101", "shown (address not exposed by the page text)"], ["Summit Shingle Co", 4.2, 88, "Roof repair service", "45 Quarry Ln", "(555) 010-0102", "shown (address not exposed by the page text)"], ["Birch Slate Roofing", 3.9, 12, "Roofing supply store", "7 Mill St", "(555) 010-0103", null]];
  if (cap.pack.length !== 3) P.push(`pack ${cap.pack.length}`);
  want.forEach((w, i) => { const p = cap.pack[i] || {}; if (!eq([p.name, p.rating, p.reviews, p.category, p.address, p.phone, p.website, p.sponsored], [...w, false])) P.push(`row ${i + 1}: ${JSON.stringify(p)}`); });
  if (cap.rawFile?.sha256 !== sha(fs.readFileSync(r.page))) P.push("rawFile.sha256");
  if (cap.capturedIn !== "Test browser, desktop" || cap.capturedAt !== "2026-01-05T10:00:00Z") P.push("capturedIn or capturedAt");
  if (res.last !== `${ID} rows=3 ours=- sponsored=0 viewport=38.5,-121.5,14 -> ${r.capFile}`) P.push(`last line ${JSON.stringify(res.last)}`);
  return P;
});

await CASE("case 2: our own name in other letter case is ours; two kinds of ad are sponsored", () => {
  const rows = [ROWS3[0], { ...ROWS3[1], name: "ALDER BAY ROOF WORKS" }, { ...ROWS3[2], name: "Nimbus Roofing", sponsoredLine: true }, { ...ROWS3[0], name: "Ad · Quill Roofing" }];
  const r = mkRun(listText({ rows })); const res = run(r, "raw");
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  const cap = readCap(r);
  return [cap.ourPosition !== 2 && `ourPosition ${cap.ourPosition}`, !eq(cap.pack.map((p) => p.sponsored), [false, false, true, true]) && `sponsored ${JSON.stringify(cap.pack.map((p) => p.sponsored))}`,
    res.last !== `${ID} rows=4 ours=2 sponsored=2 viewport=38.5,-121.5,14 -> ${r.capFile}` && `last line ${JSON.stringify(res.last)}`];
});

await CASE("case 3: 23 rows give a pack of 20", () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ ...ROWS3[0], name: `Roofer Number ${i + 1}` }));
  const r = mkRun(listText({ rows })); const res = run(r, "raw");
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  const cap = readCap(r);
  return [cap.pack.length !== 20 && `pack ${cap.pack.length}`, !res.last.includes(" rows=20 ") && `last line ${JSON.stringify(res.last)}`];
});

await CASE("case 4: importGrid takes the capture of a list", () => {
  const r = mkRun(listText()); const res = run(r, "raw");
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  return taken(readCap(r), r, 3);
});

await CASE("case 5: the list refusals, one line each, nothing written", () => {
  const P = [];
  P.push(...refuseList("id not in the requests", listText({ id: "no__such__id" })));
  P.push(...refuseList("no Results line", listText({ resultsLine: false })));
  P.push(...refuseList("another query", listText({ resultsFor: "gutter cleaner alder bay" })));
  P.push(...refuseList("unusual traffic", listText({ extra: ["            Text: unusual traffic from your computer network"] })));
  P.push(...refuseList("no VIEWPORT line", listText({ vp: null })));
  P.push(...refuseList("two VIEWPORT lines", listText({ extra: ["VIEWPORT: 38.50000,-121.50000,15z"] })));
  P.push(...refuseList("fractional zoom", listText({ vp: "38.5,-121.5,14.5z" })));
  P.push(...refuseList("viewport 0.001 away", listText({ vp: "38.50100,-121.50000,14z" })));
  P.push(...refuseList("no readAtUtc", listText({ readAt: false })));
  P.push(...refuseList("no idle numbers", listText({ idle: false })));
  P.push(...refuseList("empty --captured-in", listText(), {}, { capturedIn: "" }));
  return P;
});

await CASE("case 6: commit moves an old capture aside, never over a captured one", () => {
  const P = [];
  const T0 = new Date("2025-03-01T08:00:00Z");
  // (a) an old capture without method is moved aside, same sha256 and write time; the new one is written
  { const r = mkRun(listText()); const old = '{"old": true}\n'; fs.writeFileSync(r.capFile, old); fs.utimesSync(r.capFile, T0, T0);
    const before = { sha: sha(fs.readFileSync(r.capFile)), m: fs.statSync(r.capFile).mtimeMs };
    const res = run(r, "raw");
    if (res.code !== 0) P.push(`a: exit ${res.code}: ${res.err.slice(0, 160)}`);
    else {
      if (!fs.existsSync(r.orig)) P.push("a: the old capture is not in originals/grid");
      else if (sha(fs.readFileSync(r.orig)) !== before.sha || fs.statSync(r.orig).mtimeMs !== before.m) P.push("a: sha256 or write time of the moved file changed");
      if (readCap(r).method !== "maps-viewport") P.push("a: the new capture is not written");
    } }
  // (b) one WITH method is refused, both files as they were
  { const r = mkRun(listText()); const old = '{"method": "maps-viewport"}\n'; fs.writeFileSync(r.capFile, old);
    const res = run(r, "raw");
    if (res.code !== 1 || !res.errLines.some((l) => l.startsWith("REFUSED: "))) P.push(`b: exit ${res.code}, ${res.err.slice(0, 120)}`);
    if (fs.readFileSync(r.capFile, "utf8") !== old) P.push("b: the existing capture changed");
    if (fs.existsSync(r.orig)) P.push("b: something was moved"); }
  // (c) originals/grid/<name> exists already: refused, nothing moved, nothing written
  { const r = mkRun(listText()); const old = '{"old": true}\n', prior = '{"older": true}\n'; fs.writeFileSync(r.capFile, old);
    fs.mkdirSync(path.dirname(r.orig), { recursive: true }); fs.writeFileSync(r.orig, prior);
    const res = run(r, "raw");
    if (res.code !== 1 || !res.errLines.some((l) => l.startsWith("REFUSED: "))) P.push(`c: exit ${res.code}, ${res.err.slice(0, 120)}`);
    if (fs.readFileSync(r.capFile, "utf8") !== old) P.push("c: the existing capture changed");
    if (fs.readFileSync(r.orig, "utf8") !== prior) P.push("c: the file in originals changed"); }
  return P;
});

await CASE("case 7: --raw with --card, and neither, are a usage error", () => {
  const P = [];
  for (const [label, extra] of [["both", ["--raw", "a.txt", "--card", "b.txt"]], ["neither", []]]) {
    const p = spawnSync(process.execPath, ["--max-old-space-size=256", CMD, "--pewp", tmp, "--convert", tmp, "--captured-in", "x", ...extra], { encoding: "utf8", timeout: 60000 });
    if (p.status !== 2) P.push(`${label}: exit ${p.status}, not 2`);
    if (!/^usage: node grid-text-to-capture\.mjs /m.test(p.stderr || "")) P.push(`${label}: no usage line: ${JSON.stringify((p.stderr || "").slice(0, 120))}`);
  }
  return P;
});

await CASE("case 8: a card with no rating becomes a one-row capture", () => {
  const r = mkRun(cardText()); const res = run(r, "card");
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  const raw = fs.readFileSync(r.capFile, "utf8"), cap = JSON.parse(raw), P = [];
  const ks = Object.keys(cap);
  if (ks[ks.indexOf("notes") + 1] !== "singlePlaceCard" || cap.singlePlaceCard !== true) P.push("singlePlaceCard is not directly after notes");
  if (cap.humanIdleBeforePage !== null) P.push("humanIdleBeforePage");
  const p = cap.pack[0] || {};
  if (cap.pack.length !== 1 || !eq([p.name, p.category, p.address, p.phone, p.website, p.rating, p.reviews], [BIZ, "Roofing contractor", "120 Harbor Rd Ste 4, Alder Bay, ST 00000", "(555) 010-0101", null, null, null])) P.push(`pack ${JSON.stringify(cap.pack)}`);
  if (cap.ourPosition !== 1) P.push(`ourPosition ${cap.ourPosition}`);
  if (res.last !== `${ID} rows=1 ours=1 sponsored=0 viewport=38.5,-121.5,14 card -> ${r.capFile}`) P.push(`last line ${JSON.stringify(res.last)}`);
  for (const w of ["Harbor Gutters", "Quarry Lane", "Test Person", "person@example.test"]) if (raw.includes(w)) P.push(`the capture holds ${w}`);
  P.push(...taken(cap, r, 1));
  return P;
});

await CASE("case 9: a card header with a rating in a form not known is REFUSED, not written as no rating", () => {
  const P = [], d = defaultHeader(BIZ);
  const want = (line) => `REFUSED: the card's header holds a rating line this reader has not met: ${line.slice(0, 80)}`;
  for (const [label, add] of [["a", ["Text: 4.7", "Text: (15)"]], ["b", ["Button: 4.7 stars"]], ["c", ["Image: 4.7 stars 15 Reviews", "Image: 4.6 stars 15 Reviews"]]]) {
    const r = mkRun(cardText({ blocks: [{ name: BIZ, header: [...d, ...add] }] }));
    P.push(...refusedProblems(label, run(r, "card"), r, want(add[0])));
  }
  return P;
});

await CASE("case 10: the list's own rating line in a card header is read", () => {
  const r = mkRun(cardText({ blocks: [{ name: BIZ, header: [...defaultHeader(BIZ), "Image: 4.7 stars 15 Reviews"] }] })); const res = run(r, "card");
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  const p = readCap(r).pack[0];
  return [(p.rating !== 4.7 || p.reviews !== 15) && `rating ${p.rating}, reviews ${p.reviews}`];
});

await CASE("case 11: a name with the words star and review in it is not a rating", () => {
  const name = "Lone Star Review Roofing";
  const r = mkRun(cardText({ blocks: [{ name }] })); const res = run(r, "card");
  if (res.code !== 0) return [`exit ${res.code}: ${res.err.slice(0, 200)}`];
  const p = readCap(r).pack[0];
  return [(p.name !== name || p.rating !== null || p.reviews !== null) && `row ${JSON.stringify(p)}`];
});

await CASE("case 12: the card refusals, one line each, nothing written", () => {
  const P = [];
  P.push(...refuseCard("a results list", cardText({ extraBody: ["Group: Results for roofer alder bay"] })));
  P.push(...refuseCard("not a robot in the body", cardText({ extraBody: ["Text: Confirm you are not a robot"] })));
  P.push(...refuseCard("no place group", cardText({ blocks: [] })));
  P.push(...refuseCard("two place groups", cardText({ blocks: [{ name: BIZ }, { name: "Pine Ridge Roofing" }] })));
  P.push(...refuseCard("header without vp", cardText({ vp: null })));
  P.push(...refuseCard("readAtUtc=yesterday", cardText({ readAt: "yesterday" })));
  P.push(...refuseCard("header vp and VIEWPORT differ", cardText({ vp: "38.50000,-121.50000,13z" })));
  P.push(...refuseCard("viewport 0.001 away", cardText({ vp: "38.50100,-121.50000,14z", viewportLine: "VIEWPORT: 38.50100,-121.50000,14z" })));
  return P;
});

// ---------------------------------------------------------------- end
fs.rmSync(tmp, { recursive: true, force: true });
const passed = results.filter((x) => x.ok).length, failed = results.filter((x) => !x.ok).map((x) => x.name);
console.log(`${passed}/${results.length} passed${failed.length ? "; FAILED: " + failed.join("; ") : ""}`);
process.exit(failed.length ? 1 : 0);
