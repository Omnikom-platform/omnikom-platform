// Usage: node test-measure.mjs [--scripts <dir>] [--quiet] [--mutants]
// Self-test of phase 4/5 pieces on FIXTURES ONLY (a local http server stands in for Search Console, Bing, CrUX, Gemini and the
// new site; a tiny fake Common Crawl graph stands in for the web graph; no live site, no Google HTML, no paid API):
//   measure (sources, rankings, AI citations, authority, MSR rules, diff between two dates, BLOCKED never faked, no raw
//   grounded text, no key on disk), migrate (inventory, redirect map, chain / homepage / no-target handling, _redirects,
//   carry-over, gate with chain / homepage / 302 / 404 / loop / 429, baseline, monitor), local (profile import, pack
//   importer, NAP, review gap), and the stage documents.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the
//   named check to go red (a mutant that leaves it green means the check measures nothing, or the patch never applied).
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
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
    { id: "country-filter-dropped", file: "measure-sources.mjs", from: "if (country) body.dimensionFilterGroups =", to: "if (false && country) body.dimensionFilterGroups =", red: "gsc: country filter" },
    { id: "token-not-written-back", file: "measure-sources.mjs", from: 'fs.writeFileSync(file, JSON.stringify(next, null, 1) + "\\n");', to: "", red: "gsc: access token refreshed" },
    { id: "error-status-cached", file: "measure-sources.mjs", from: "if (r.status < 200 || r.status >= 300) { try { fs.rmSync(r.cacheFile, { force: true }); } catch {} }", to: "", also: { file: "cache.mjs", from: "if (res.status < 200 || res.status >= 300) return wrap(c, null, false);", to: "" }, red: "cache: an error status is never left" },
    { id: "significance-always-false", file: "measure-sources.mjs", from: "return newV < lo || newV > hi; };", to: "return false; };", red: "diff: a click change is significant only" },
    { id: "unlocalized-counted-as-requested", file: "measure-sources.mjs", from: "location = c.locationShown; localized = false; }", to: "location = c.locationShown; localized = true; }", red: "rankings: a capture whose page showed another place" },
    { id: "rank-key-ignores-device", file: "measure-sources.mjs", from: "nfkc(r.location), r.device, r.language].join", to: "nfkc(r.location), r.language].join", red: "diff: ranks are compared only" },
    { id: "crux-key-missing-faked", file: "measure-sources.mjs", from: 'if (!key) return blocked("crux", "no CRUX_API_KEY",', to: 'if (!key) return { ok: true, noFieldData: true, target: url || origin, formFactor, reason: "fabricated", fetchedAt: new Date().toISOString(), cacheFile: null }; if (false) return blocked("crux", "no CRUX_API_KEY",', red: "blocked: with no key" },
    { id: "raw-answer-stored", file: "measure-sources.mjs", from: "answerHash: sha(text),", to: "answerHash: sha(text), rawText: text,", also: { file: "measure.mjs", from: "answerHashes: runs.map((r) => r.answerHash),", to: "answerHashes: runs.map((r) => r.answerHash), raw: runs,", }, red: "ai: the grounded answer text is never stored" },
    { id: "authority-gain-loss-swapped", file: "measure.mjs", from: "gained: [...B].filter((x) => !A.has(x)), lost: [...A].filter((x) => !B.has(x))", to: "gained: [...A].filter((x) => !B.has(x)), lost: [...B].filter((x) => !A.has(x))", red: "diff: referring domains" },
    { id: "authority-notingraph-competitors-dropped", file: "measure.mjs", from: "const competitors = results.filter((r) => r !== me).map(", to: "const competitors = results.filter((r) => r.role === \"competitor\").map(", red: "authority: a target the graph does not hold" },
    { id: "authority-notingraph-competitor-zero", file: "measure.mjs", from: "linkingDomains: r.inGraph ? r.linkingDomains ?? null : null }));", to: "linkingDomains: r.linkingDomains ?? 0 }));", red: "authority: a target the graph does not hold" },
    { id: "authority-notingraph-prospects-claim", file: "measure.mjs", from: "const judged = cur.authority.inGraph !== false;", to: "const judged = true;", red: "authority: with the target not in the graph the MSR-007" },
    { id: "authority-notingraph-linkgap-dropped", file: "measure.mjs", from: 'competitors, linkGap: (doc.linkGap || []).slice(0, 50) };\n  const list', to: 'competitors };\n  const list', red: "authority: with the target not in the graph the MSR-007" },
    { id: "homepage-guard-off", file: "migrate.mjs", from: 'if (r.to === "/" && r.from !== "/" && !homeAllowed.has(r.from)) {', to: "if (false) {", red: "map: an old URL pointed at the homepage" },
    { id: "chain-collapse-off", file: "migrate.mjs", from: "if (hops > 0) { r.flags.push(", to: "if (false) { r.flags.push(", red: "map: a chain in the map is collapsed" },
    { id: "suggestions-active", file: "migrate.mjs", from: 'const on = r.approved === "auto" || r.approved === "yes" || (includeSuggestions && r.method === "similarity" && !r.flags.includes("HOMEPAGE"));', to: "const on = true;", red: "map: _redirects activates only approved rows" },
    { id: "gate-ignores-chains", file: "migrate.mjs", from: "if (t.hops.length > 1) fails.push(", to: "if (false) fails.push(", red: "gate: a chain of two hops fails" },
    { id: "gate-ignores-429", file: "migrate.mjs", from: "if (res.status === 429) throw new Stop429(", to: "if (false) throw new Stop429(", red: "gate: a 429 stops the run" },
    { id: "gate-exclude-ignored", file: "migrate.mjs", from: "const targets = inv.rows.filter((r) => r.mustKeep && !isEx(r.path)).slice(0, maxUrls);", to: "const targets = inv.rows.filter((r) => r.mustKeep).slice(0, maxUrls);", red: "gate: --exclude keeps off-limits addresses" },
    { id: "gsc-expiry-date-ignored", file: "lib-google-auth.mjs", from: "const exp = t.expiry_date ?? t.expiry;", to: "const exp = t.expiry;", red: "gsc: a token with Google's expiry_date" }, // the token code moved to lib-google-auth.mjs (G12)
    { id: "phone-country-code-kept", file: "local-lib.mjs", from: 'if (d.length === 11 && d.startsWith("1")) d = d.slice(1);', to: "", red: "nap: phone numbers match after normalisation" },
    { id: "page-type-synonyms-off", file: "migrate.mjs", from: "if (types.size && pt.size &&", to: "if (false && types.size && pt.size &&", red: "map: page-type synonyms and stemming" },
    { id: "page-type-from-title", file: "migrate.mjs", from: "const types = oSlugTypes, pt =", to: "const types = oSlugTypes.size ? oSlugTypes : ot, pt =", red: "map: a page type comes only from the old path" },
    { id: "stemming-off", file: "migrate.mjs", from: "const stem = libStem; //", to: "const stem = (w) => w; //", red: "map: page-type synonyms and stemming" },
    { id: "gone-detection-off", file: "migrate.mjs", from: "else if (!o.mustKeep && goneReason(", to: "else if (false && goneReason(", red: "map: test and draft pages" },
    { id: "grid-unlocalized-counted", file: "local-grid.mjs", from: "if (!shown) return false;", to: "return true; if (!shown) return false;", red: "grid import: a capture whose page footer shows another place" },
    { id: "grid-spacing-ignores-latitude", file: "local-grid.mjs", from: "(KM_PER_DEG * Math.cos((center.lat * Math.PI) / 180))", to: "(KM_PER_DEG)", red: "grid: points are spaced" },
    { id: "grid-centre-not-added", file: "local-grid.mjs", from: "if (!pts.some((p) => p.isCenter)) pts.push(", to: "if (false) pts.push(", red: "grid: the city centre is always a point" },
    { id: "grid-cost-stop-off", file: "local-grid.mjs", from: "const over = requests.length > maxCaptures;", to: "const over = false;", red: "grid plan: over the cost stop" },
    { id: "grid-solv-counts-unlocalized", file: "local-grid.mjs", from: "const ok = list.filter((p) => p.localized);", to: "const ok = list;", red: "grid import: share of local voice" },
    { id: "grid-rows-without-url", file: "local-grid.mjs", from: "const url = v == null ? null : p.ours?.website || (domain ? `https://${domain}/` : null);", to: "const url = null;", red: "grid import: ranking rows pass the ranking-row validator" },
    { id: "grid-robot-check-continues", file: "local-grid.mjs", from: "if (c.robotCheck) {", to: "if (false) {", red: "grid import: per-point table" },
    { id: "grid-diff-ignores-lost-points", file: "local-grid.mjs", from: "left = (from != null && from <= 3) && !(to != null && to <= 3);", to: "left = false;", red: "grid diff: per point and per query" },
    { id: "grid-weak-coverage-silent", file: "measure.mjs", from: "if (s.solv3.value != null && s.solv3.value < th.gridSov3Floor)", to: "if (false)", red: "rules run B: MSR-010 reads the local grid" },
    { id: "grid-reimport-hides-diff", file: "local-grid.mjs", from: "if (lastG?.signature === signature) {", to: "if (false) {", red: "local run imports the grid when captures exist" },
    { id: "main-check-exact-path", file: "lib-main.mjs", from: "try { return norm(fs.realpathSync(arg)) === norm(fs.realpathSync(me)); }", to: "try { return norm(arg) === norm(fs.realpathSync(me)); }", red: "junction: started through a junction" },
    { id: "capture-bom-dropped", file: "measure-sources.mjs", from: "JSON.parse(stripBom(fs.readFileSync(p, \"utf8\")))", to: "JSON.parse(fs.readFileSync(p, \"utf8\"))", red: "captures: a capture file saved with a BOM" },
    { id: "tel-stray-percent", file: "measure-sources.mjs", from: "map((m) => safeDecode(m[1]))", to: "map((m) => decodeURIComponent(m[1]))", red: "html: a tel: link with a stray %" },
    { id: "map-stray-percent", file: "migrate.mjs", from: "const slugTokens = (p) => [...new Set(nfkc(safeDecode(p))", to: "const slugTokens = (p) => [...new Set(nfkc(decodeURIComponent(p))", red: "map: an old address with a stray %" },
    { id: "stage-unchecked", file: "migrate.mjs", from: "if (!STAGES.includes(stage)) return", to: "if (false) return", red: "migrate CLI: an unknown --stage" },
    { id: "number-options-nan", file: "migrate.mjs", from: "if (raw == null || raw === \"\" || !Number.isFinite(v) || v < min || (int && !Number.isInteger(v)))", to: "if (raw == null || raw === \"\" || v < min)", red: "migrate CLI: an unknown --stage" },
    { id: "gate-vacuous-pass", file: "migrate.mjs", from: "passed: !nothing && !stopped &&", to: "passed: !stopped &&", red: "gate: with no old address to check" },
    { id: "today-unchecked", file: "measure.mjs", from: "if (opt(\"--today\") && !isDay(opt(\"--today\"))) { console.error(", to: "if (false) { console.error(", red: "today: measure, local-run and local-grid" },
    { id: "runmjs-bom-config", file: "../measure/run.mjs", from: "JSON.parse(noBom(fs.readFileSync(cfgFile, \"utf8\")))", to: "JSON.parse(fs.readFileSync(cfgFile, \"utf8\"))", red: "measure run.mjs: a config.json with a BOM" },
    { id: "pack-unlocalized-counted", file: "local-pack.mjs", from: "location = c.locationShown; localized = false; }", to: "location = c.locationShown; localized = true; }", red: "local pack: a capture whose page showed another place" },
    // ---- grid capture forms (SKILL-GRID-1a)
    { id: "grid-maps-mobile-only", file: "local-grid.mjs", from: 'if (!maps && c.device !== "mobile") {', to: 'if (c.device !== "mobile") {', red: "grid maps: a capture of the Google Maps viewport at the point counts" },
    { id: "grid-maps-far-viewport-counted", file: "local-grid.mjs", from: "haversineKm(c.viewport, c.point) <= 0.5", to: "haversineKm(c.viewport, c.point) <= 5", red: "grid maps: localized exactly when the viewport centre" },
    { id: "grid-maps-any-zoom", file: "local-grid.mjs", from: "[13, 14, 15].includes(c.viewport.zoom)", to: "c.viewport.zoom > 0", red: "grid maps: localized exactly when the viewport centre" },
    { id: "grid-maps-footer-read", file: "local-grid.mjs", from: "const localized = maps ? ", to: "const localized = false ? ", red: "grid maps: a capture of the Google Maps viewport at the point counts" },
    { id: "grid-maps-viewport-unchecked", file: "local-grid.mjs", from: "if (maps && !(Number.isFinite(c.viewport?.lat)", to: "if (false && !(Number.isFinite(c.viewport?.lat)", red: "grid maps: a viewport that is not lat, lng and a whole zoom is rejected" },
    { id: "grid-maps-other-method-taken", file: "local-grid.mjs", from: 'if (maps && c.method !== "maps-viewport") {', to: "if (false) {", red: "grid maps: a method other than maps-viewport is rejected" },
    { id: "grid-ads-ranked", file: "local-grid.mjs", from: "const pack = c.pack.filter((p) => p.sponsored !== true).map(", to: "const pack = c.pack.map(", red: "grid maps: rows the page marks sponsored are ads" },
    { id: "grid-ads-not-renumbered", file: "local-grid.mjs", from: "position: ads ? i + 1 : Number(p.position ?? i + 1)", to: "position: Number(p.position ?? i + 1)", red: "grid maps: rows the page marks sponsored are ads" },
    { id: "grid-always-renumbered", file: "local-grid.mjs", from: "position: ads ? i + 1 : Number(p.position ?? i + 1)", to: "position: i + 1", red: "grid maps: with no sponsored row the positions stay as captured" },
    { id: "grid-bad-sponsored-taken", file: "local-grid.mjs", from: "if (bad >= 0) { rejected.push(", to: "if (false) { rejected.push(", red: "grid maps: with no sponsored row the positions stay as captured" },
    { id: "grid-point-device-mobile", file: "local-grid.mjs", from: 'const device = maps ? c.device : "mobile";', to: 'const device = "mobile";', red: "grid maps: a capture of the Google Maps viewport at the point counts" },
    { id: "grid-words-always-mobile", file: "local-grid.mjs", from: 'if (!d) return { label: "mobile",', to: 'if (true) return { label: "mobile",', red: "grid maps: a folder of Maps viewport captures imports" },
    { id: "grid-rows-device-mobile", file: "local-grid.mjs", from: 'device: p.device, language: p.language, engine: "google",', to: 'device: "mobile", language: p.language, engine: "google",', red: "grid maps: a folder of Maps viewport captures imports" },
    { id: "grid-forms-mixed", file: "local-grid.mjs", from: "if (res.summary.viewportCaptures && res.summary.searchCaptures) return", to: "if (false) return", red: "grid maps: a folder holding both forms is BLOCKED" },
    { id: "grid-maps-other-device-taken", file: "local-grid.mjs", from: 'if (maps && c.device !== "mobile" && c.device !== "desktop") {', to: "if (false) {", red: "grid maps: a Maps capture on a device that is not mobile or desktop is rejected" },
    // ---- the plan asks for the Maps viewport form (SKILL-GRID-1b)
    { id: "grid-requests-md-mobile", file: "local-grid.mjs", from: '| ${r.mapsUrl} | mobile or desktop, as captured -> ${r.id}.json`', to: '| ${r.location} | mobile -> ${r.id}.json`', red: "grid plan CLI: requests.json" },
    { id: "grid-request-device-mobile", file: "local-grid.mjs", from: 'device: "mobile or desktop, as captured", language, location: fmtLoc(p.lat, p.lng, pc.city),', to: 'device: "mobile", language, location: fmtLoc(p.lat, p.lng, pc.city),', red: "grid plan: capture requests per query x point" },
    { id: "grid-instructions-override", file: "local-grid.mjs", from: "const INSTRUCTIONS = \"Open the request's mapsUrl", to: "const INSTRUCTIONS = \"Set the browser's location override, then open the request's mapsUrl", red: "grid plan CLI: requests.json" },
    // ---- a manual capture's unread fields (SKILL-PROFILE-1)
    { id: "profile-null-read-as-empty", file: "local-profile.mjs", from: "secondaryCategories: Array.isArray(j.secondaryCategories) ? j.secondaryCategories : null", to: "secondaryCategories: j.secondaryCategories || []", red: "profile: a manual capture's unread fields (null, or the key left out) stay not read at import" },
    { id: "profile-unread-is-a-finding", file: "local-profile.mjs", from: 'if (p.services == null) notRead("LOC-P03", "services"); else ', to: "", red: "profile: a field that was not read is never a finding" },
    { id: "profile-unread-categories-compared", file: "local-profile.mjs", from: 'if (p.secondaryCategories == null) blockedChecks.push({ id: "LOC-P10"', to: 'if (false) blockedChecks.push({ id: "LOC-P10"', red: "profile: with competitor captures and our secondary categories not read" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mut-"));
  let ok = 0;
  // Async pool, 4 at a time: every mutant runs the whole test against its own copy of the skill.
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    for (const p of [m, m.also].filter(Boolean)) {
      const f = path.join(copy, "scripts", p.file); const src = fs.readFileSync(f, "utf8");
      if (!src.includes(p.from)) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text not found in ${p.file})` });
      fs.writeFileSync(f, src.replace(p.from, p.to));
    }
    const c = spawn(process.execPath, [path.join(copy, "scripts", "test-measure.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 400000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (check measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected check"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-measure-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" || Buffer.isBuffer(s) ? s : JSON.stringify(s, null, 1)); return p; };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
// Async on purpose: the fixture servers live in THIS process, so a blocking spawnSync would starve them and time out.
const spawnP = (cmd, a, opts) => new Promise((res) => { const p = spawn(cmd, a, { ...opts, stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d)); const t = setTimeout(() => p.kill(), 240000); p.on("close", (c) => { clearTimeout(t); res({ status: c, stdout: o, stderr: e }); }); });
const cli = (script, a, env = {}, opts = {}) => spawnP(process.execPath, [path.join(dir, script), ...a], { cwd: tmp, env: { ...cleanEnv, ...env }, ...opts });
const cleanEnv = { ...process.env, GSC_TOKEN_FILE: path.join(tmp, "no-such-token.json"), BING_WEBMASTER_KEY: "", CRUX_API_KEY: "", GEMINI_API_KEY: "" };
for (const k of ["GSC_TOKEN_FILE", "BING_WEBMASTER_KEY", "CRUX_API_KEY", "GEMINI_API_KEY"]) process.env[k] = cleanEnv[k];
const allFiles = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? allFiles(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const S = await imp("measure-sources.mjs");
  const M = await imp("measure.mjs");
  const G = await imp("migrate.mjs");

  // ================================================================ unit: pure functions
  const [lo, hi] = S.poissonInterval(100);
  check("unit: Poisson 95% interval for 100 is about 81.4 to 121.6", Math.abs(lo - 81.36) < 0.2 && Math.abs(hi - 121.63) < 0.2, `${lo} ${hi}`);
  check("unit: a click change is significant only outside the interval", S.clicksChanged(40, 72) && !S.clicksChanged(40, 45) && !S.clicksChanged(0, 1), `${S.clicksChanged(40, 72)} ${S.clicksChanged(40, 45)} ${S.clicksChanged(0, 1)}`);
  check("unit: whole-word matching after NFKC and lowercasing", S.containsWords("We Buy HOUSES tracy ca cheap", "we buy houses tracy ca") && !S.containsWords("housesitting", "house") && S.containsWords("ＷＥ ｂｕｙ", "we buy"), "");
  check("unit: Core Web Vitals status thresholds", S.cwvStatus("largest_contentful_paint", 2500) === "good" && S.cwvStatus("largest_contentful_paint", 3000) === "needs improvement" && S.cwvStatus("cumulative_layout_shift", "0.3") === "poor", "");
  check("unit: a ranking row is rejected without location, device, language, source or fetchedAt", S.validateRankingRow({ query: "q", location: "", device: "mobile", language: "en", position: { value: 1, source: "s", fetchedAt: "d" } }).includes("location") && S.validateRankingRow({ location: "x", device: "d", language: "en", position: { value: 1, source: "s" } }).includes("fetchedAt") && S.validateRankingRow({ location: "x", device: "d", language: "en", position: { value: 1, source: "s", fetchedAt: "d" } }).length === 0, "");
  check("unit: normPath drops origin, query, index.html and trailing slash", S.normPath("https://x.com/a//b/index.html?x=1#y") === "/a/b" && S.normPath("/") === "/" && S.normPath("https://x.com") === "/", "");
  const win = M.windowsFor(new Date("2026-09-01T12:00:00Z"), M.DEFAULT_CONFIG);
  check("unit: windows are two 28-day periods ending 3 days back", win.current.start === "2026-08-02" && win.current.end === "2026-08-29" && win.previous.start === "2026-07-05" && win.previous.end === "2026-08-01", JSON.stringify(win));
  const fresh = S.parseFreshMarkdown(
    `## UPDATE 2026-10-17 (night, fresh run): Google web READ in the OWNER'S EDGE\nLocation: Google location set to Tracy, California with the uule parameter; footer location shown: "Kafr Tohormos /B, Egypt - Based on your places (Home)" (footer also says "Results are personalized")\n**GOOGLE AI OVERVIEW: PRESENT** (complete: yes)\nNamed in the AI answer (in order): We Buy Houses Tracy (national network) · Kind Path Home Buyers (closed) · Frank Buys Houses, LLC (4.8, 61 reviews)\nSources shown with the AI answer: We Buy Houses (webuyhouses.com: "We Buy Houses Tracy CA") · Maple Home Buyers ("Sell My House Fast")\nLocal / Places pack: Frank Buys Houses, LLC (672 W 11th St) · I Buy Central Valley (324 E 11th St) · We Buy Houses (2318 East St)\nOrganic top 10: 1 webuyhouses.com (We Buy Houses Tracy CA; 1-877-932-8946) · 2 homelight.com (We Buy Houses Tracy: Top 5; Aug 11, 2026) · 3 listwithclever.com (Top 9 Tracy CA Cash Home Buyers 2026) · 4 maplehomebuyers.com (Sell My House Fast)\nOur clients (Eli Buys Homes): NOT on the page\n`, { query: "we buy houses Tracy CA", device: "desktop" });
  check("import-md: the project's own capture format is parsed (organic list, pack, AI answer, footer place)", fresh.organic.length === 4 && fresh.organic[1].domain === "homelight.com" && fresh.localPack.length === 3 && fresh.aiOverview.present && fresh.locationShown.startsWith("Kafr Tohormos") && fresh.location === "Tracy, California", JSON.stringify(fresh).slice(0, 300));

  // ================================================================ fixtures: the API server
  const U = "https://mysite.example";
  const q1 = "we buy houses tracy ca", q2 = "realtor in tracy ca";
  const R = (q, p, dev, c, clicks, imp, pos) => ({ q, page: U + p, dev, c, clicks, imp, pos });
  const DATA = {
    "2026-07-05": [R(q1, "/tracy", "MOBILE", "usa", 20, 400, 8), R(q2, "/realtor-tracy", "MOBILE", "usa", 5, 300, 12), R("cash home buyers near me", "/", "MOBILE", "usa", 3, 200, 15)],
    "2026-08-02": [R(q1, "/tracy", "MOBILE", "usa", 30, 350, 6), R(q1, "/tracy", "DESKTOP", "usa", 10, 150, 6), R(q1, "/tracy", "DESKTOP", "can", 2, 900, 40), R(q2, "/realtor-tracy", "MOBILE", "usa", 4, 300, 12.5), R("best realtor tracy", "/realtor-tracy", "MOBILE", "usa", 0, 120, 4), R("cash home buyers near me", "/", "MOBILE", "usa", 3, 220, 14), R("sell my house fast tracy", "/tracy", "MOBILE", "usa", 2, 80, 9)],
    "2026-08-30": [R(q1, "/tracy", "MOBILE", "usa", 50, 450, 3), R(q1, "/tracy", "DESKTOP", "usa", 20, 200, 3), R(q1, "/tracy", "DESKTOP", "can", 2, 900, 40), R(q2, "/realtor-tracy", "MOBILE", "usa", 0, 100, 17), R(q2, "/blog/realtor-tips", "MOBILE", "usa", 1, 210, 17.5), R("best realtor tracy", "/realtor-tracy", "MOBILE", "usa", 0, 120, 4), R("cash home buyers near me", "/", "MOBILE", "usa", 4, 230, 14), R("tracy cash offer", "/tracy", "MOBILE", "usa", 5, 60, 7)],
  };
  const gscRows = (start, dims, country) => {
    const key = (r) => dims.map((d) => ({ query: r.q, page: r.page, device: r.dev, country: r.c })[d]);
    const g = new Map();
    for (const r of (DATA[start] || []).filter((x) => !country || x.c === country)) { const k = JSON.stringify(key(r)); const o = g.get(k) || { keys: key(r), clicks: 0, impressions: 0, pw: 0 }; o.clicks += r.clicks; o.impressions += r.imp; o.pw += r.pos * r.imp; g.set(k, o); }
    return [...g.values()].map((o) => ({ keys: o.keys, clicks: o.clicks, impressions: o.impressions, ctr: o.impressions ? o.clicks / o.impressions : 0, position: o.pw / o.impressions }));
  };
  let phase = "A", gemMode = "normal", gemCount = {}, lastGem = null, tokenCalls = 0, gscCalls = 0, calls = [];
  const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
  const send = (res, status, obj) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
  const api = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"); const b = await body(req); calls.push(`${req.method} ${u.pathname}`);
    if (u.pathname === "/token") { tokenCalls++; return send(res, 200, { access_token: "tok-good", expires_in: 3600 }); }
    if (u.pathname.startsWith("/gsc/sites/")) {
      gscCalls++;
      if (req.headers.authorization !== "Bearer tok-good") return send(res, 401, { error: { message: "invalid credentials" } });
      const j = JSON.parse(b); const country = j.dimensionFilterGroups?.[0]?.filters?.[0]?.expression || null;
      return send(res, 200, { rows: gscRows(j.startDate, j.dimensions, country) });
    }
    if (u.pathname === "/inspect/urlInspection/index:inspect") {
      const j = JSON.parse(b); const ok = j.inspectionUrl.endsWith("/tracy");
      return send(res, 200, { inspectionResult: { indexStatusResult: ok ? { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-08-20T00:00:00Z" } : { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" } } });
    }
    if (u.pathname === "/bing/GetQueryStats") {
      const d = (s) => `/Date(${Date.parse(s)})/`;
      return send(res, 200, { d: [{ Query: q1, Date: d("2026-08-10T00:00:00Z"), Clicks: 10, Impressions: 100, AvgImpressionPosition: 5 }, { Query: q1, Date: d("2026-08-20T00:00:00Z"), Clicks: 5, Impressions: 300, AvgImpressionPosition: 9 }, { Query: q1, Date: d("2026-07-10T00:00:00Z"), Clicks: 1, Impressions: 50, AvgImpressionPosition: 20 }, { Query: "outside window", Date: d("2025-01-01T00:00:00Z"), Clicks: 9, Impressions: 9, AvgImpressionPosition: 1 }] });
    }
    if (u.pathname === "/bing/GetPageStats") return send(res, 200, { d: [] });
    if (u.pathname === "/bing/GetLinkCounts") return send(res, 200, { d: { Details: [{ Url: "https://old.example/people/jane-doe", Count: 14 }], TotalPages: 1 } });
    if (u.pathname === "/crux/records:queryRecord") {
      const j = JSON.parse(b); const m = (lcp, inp, cls) => ({ record: { metrics: { largest_contentful_paint: { percentiles: { p75: lcp } }, interaction_to_next_paint: { percentiles: { p75: inp } }, cumulative_layout_shift: { percentiles: { p75: String(cls) } } }, collectionPeriod: { lastDate: { year: 2026, month: 8, day: 28 } } } });
      if (j.origin) return send(res, 200, m(2000, 150, 0.12));
      if (j.url.endsWith("/realtor-tracy")) return send(res, 200, phase === "A" ? m(2200, 150, 0.05) : m(3100, 150, 0.05));
      return send(res, 404, { error: { message: "chrome ux report data not found" } });
    }
    if (u.pathname.startsWith("/gemini/models/")) {
      if (req.headers["x-goog-api-key"] !== "GEMKEY789") return send(res, 403, { error: { message: "bad key" } });
      const j = JSON.parse(b); lastGem = j; const qn = j.contents[0].parts[0].text; gemCount[qn] = (gemCount[qn] || 0) + 1; const n = gemCount[qn];
      if (gemMode === "429-after-2" && Object.values(gemCount).reduce((a, c) => a + c, 0) > 2) return send(res, 429, { error: { message: "quota" } });
      const chunks = (ds) => ds.map((d) => ({ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz", title: d } }));
      let ds = ["maplehomebuyers.com", "webuyhouses.com"];
      if (qn.startsWith("best realtor")) ds = ["zillow.com"];
      if (phase === "B" && qn.startsWith("who buys")) ds = n <= 2 ? ["mysite.example", "maplehomebuyers.com"] : ["maplehomebuyers.com"];
      return send(res, 200, { candidates: [{ content: { parts: [{ text: `SECRET_ANSWER_TEXT ${qn} #${n} see https://www.redfin.com/x` }] }, groundingMetadata: { groundingChunks: chunks(ds), webSearchQueries: [qn] } }] });
    }
    send(res, 404, { error: "unknown " + u.pathname });
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const A = `http://127.0.0.1:${api.address().port}`;
  const endpoints = { gsc: A + "/gsc", inspect: A + "/inspect", token: A + "/token", bing: A + "/bing", crux: A + "/crux", gemini: A + "/gemini" };

  // fake Common Crawl web graph: release r1 has 12 linking domains, r2 only 3 (a big loss), g1.com links to both competitors
  const cc = path.join(tmp, "cc"); const rev = (d) => d.split(".").reverse().join(".");
  const makeGraph = (rel, linkers) => {
    const names = { 0: "mysite.example", 1: "maplehomebuyers.com", 2: "webuyhouses.com", 100: "g1.com" }; linkers.forEach((d, i) => (names[10 + i] = d));
    const gz = (n, lines) => w(path.join(cc, `${rel}-domain-${n}.txt.gz`), zlib.gzipSync(lines.join("\n") + "\n"));
    gz("vertices", Object.entries(names).map(([id, d]) => `${id}\t${rev(d)}\t1`));
    gz("edges", [...linkers.map((_, i) => `${10 + i}\t0`), "100\t1", "100\t2"]);
    gz("ranks", ["#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts", ...Object.values(names).map((d, i) => `${i + 1}\t1\t${i + 1}\t1\t${rev(d)}\t1`)]);
  };
  makeGraph("cc-r1", Array.from({ length: 12 }, (_, i) => `l${String(i + 1).padStart(2, "0")}.com`));
  makeGraph("cc-r2", ["l01.com", "l02.com", "n1.com"]);

  // ================================================================ measure: target mysite.example
  const URL_ = "https://mysite.example/";
  const loc = (await imp("state.mjs")).locate(URL_, { cwd: tmp });
  const pewp = loc.pewp;
  w(path.join(pewp, "targets.json"), { version: 1, business: "mysite.example", market: { country: "US", language: "en" }, clusters: [
    { id: "c-sell", primaryQuery: q1, queries: [q1, "sell my house fast tracy", "tracy cash offer"], intent: "transactional", location: "Tracy, CA", competitorsTop3: [{ url: "https://maplehomebuyers.com/", domain: "maplehomebuyers.com" }, { url: "https://webuyhouses.com/", domain: "webuyhouses.com" }], questions: ["who buys houses for cash in Tracy, CA"], targetPage: "/tracy", priority: 10 },
    { id: "c-agent", primaryQuery: q2, queries: [q2, "best realtor tracy"], intent: "local", location: "Tracy, CA", competitorsTop3: [], questions: ["best realtor in Tracy, CA"], targetPage: "/realtor-tracy", priority: 5 },
    { id: "c-value", primaryQuery: "tracy home value", queries: ["tracy home value"], intent: "informational", location: null, competitorsTop3: [], questions: [], targetPage: "new", priority: 1 }] });
  w(path.join(pewp, "business.json"), { name: "Valley to Valley Realty", domain: "mysite.example", kind: "real-estate-agent", market: { country: "US", language: "en" }, phone: "(209) 555-0100", locations: [{ name: "Tracy", address: "123 Main Street, Suite 4, Tracy, CA 95376", serviceArea: ["Tracy"] }], competitors: ["maplehomebuyers.com", "webuyhouses.com"] });
  const tokenFile = w(path.join(tmp, "gsc-token.json"), { access_token: "expired", expiry: "2020-01-01T00:00:00Z", refresh_token: "REFRESHSECRET", client_id: "cid", client_secret: "csec", token_uri: A + "/token" });
  const cap = (n, o) => w(path.join(pewp, "captures", "serp", n), o);
  const orgs = (ours) => [{ position: 1, url: "https://webuyhouses.com/tracy" }, { position: 2, url: "https://maplehomebuyers.com/" }, { position: 3, url: "https://zillow.com/tracy" }, ...(ours ? [{ position: ours, url: "https://www.mysite.example/tracy" }] : [])];
  cap("tracy-mobile.json", { query: q1, engine: "google", location: "Tracy, CA", locationShown: "Tracy, CA", device: "mobile", language: "en", capturedAt: "2026-08-28T18:00:00Z", capturedIn: "owner phone, signed out", organic: orgs(6) });
  cap("egypt-footer.json", { query: q1, engine: "google", location: "Tracy, CA", locationShown: "Kafr Tohormos, Egypt", device: "desktop", language: "en", capturedAt: "2026-08-28T18:05:00Z", capturedIn: "owner Edge, signed in", organic: orgs(null) });
  cap("no-device.json", { query: q1, engine: "google", location: "Tracy, CA", language: "en", capturedAt: "2026-08-28T18:10:00Z", organic: orgs(2) });
  w(path.join(pewp, "captures", "ai", "chatgpt-1.json"), { question: "who buys houses for cash in Tracy, CA", engine: "chatgpt", model: "web", capturedAt: "2026-08-28T19:00:00Z", capturedIn: "owner Edge, fresh chat", location: "Tracy, CA", citedDomains: ["maplehomebuyers.com", "listwithclever.com"] });
  w(path.join(pewp, "captures", "ai", "chatgpt-2.json"), { question: "who buys houses for cash in Tracy, CA", engine: "chatgpt", model: "web", capturedAt: "2026-08-28T19:10:00Z", capturedIn: "owner Edge, fresh chat", location: "Tracy, CA", citedDomains: ["maplehomebuyers.com"] });

  const init = await cli("measure.mjs", [URL_, "--init", "--cwd", tmp]);
  const cfgFile = path.join(pewp, "measure", "config.json");
  check("measure init: config.json and the re-runnable run.mjs are written together", init.status === 0 && fs.existsSync(cfgFile) && fs.existsSync(path.join(pewp, "measure", "run.mjs")) && J(cfgFile).gsc.site === "sc-domain:mysite.example", init.stdout + init.stderr);
  const cfg = J(cfgFile);
  Object.assign(cfg, { endpoints, ai: { ...cfg.ai, gapMs: 0, geminiTermsAcknowledged: true }, authority: { ...cfg.authority, cache: cc, release: "cc-r1" } });
  w(cfgFile, cfg);
  const env = { GSC_TOKEN_FILE: tokenFile, BING_WEBMASTER_KEY: "BINGKEY123", CRUX_API_KEY: "CRUXKEY456", GEMINI_API_KEY: "GEMKEY789" };
  const run = (extra) => spawnP(process.execPath, [path.join(pewp, "measure", "run.mjs"), ...extra], { cwd: tmp, env: { ...cleanEnv, ...env } });

  const before = calls.length;
  const plan = await run(["--plan", "--today", "2026-09-01"]);
  check("measure plan: printed before any call, nothing fetched, nothing written", plan.status === 0 && /PLAN measure/.test(plan.stdout) && /2 questions x 3 runs = 6 Gemini answers/.test(plan.stdout) && calls.length === before && !fs.existsSync(path.join(pewp, "measure", "2026-09-01")), plan.stdout + plan.stderr);

  // a config.json saved by Notepad / PowerShell 5.1 starts with a BOM: run.mjs read it as "no config.json" (exit 2) before the fix
  const cfgText = fs.readFileSync(cfgFile, "utf8");
  fs.writeFileSync(cfgFile, "\uFEFF" + cfgText);
  const planBom = await run(["--plan", "--today", "2026-09-01"]);
  fs.writeFileSync(cfgFile, cfgText);
  check("measure run.mjs: a config.json with a BOM is read (plan printed, exit 0), not reported missing", planBom.status === 0 && /PLAN measure/.test(planBom.stdout), `exit ${planBom.status} ${planBom.stderr.slice(0, 200)}`);

  const ra = await run(["--today", "2026-09-01", "--refresh-authority"]);
  const dA = path.join(pewp, "measure", "2026-09-01");
  const sumA = J(path.join(dA, "summary.json")), gscA = J(path.join(dA, "gsc.json")), rankA = J(path.join(dA, "rank-detail.json")), aiA = J(path.join(dA, "ai.json")), autA = J(path.join(dA, "authority.json")), cruxA = J(path.join(dA, "crux.json")), bingA = J(path.join(dA, "bing.json")), idxA = J(path.join(dA, "index.json")), finA = J(path.join(dA, "findings.json"));
  check("measure run A: exit 0 and every part wrote its file", ra.status === 0 && sumA && ["gsc", "index", "bing", "crux", "rankings", "ai", "authority", "conversions"].every((k) => fs.existsSync(path.join(dA, k + ".json"))) && ["report.md", "report.json", "diff.json", "diff.md", "findings.json"].every((f) => fs.existsSync(path.join(dA, f))), ra.stdout.slice(-600) + ra.stderr.slice(-600));
  check("measure run A: sources connected are ok, analytics is BLOCKED", sumA?.parts.gsc.status === "ok" && sumA.parts.index.status === "ok" && sumA.parts.bing.status === "ok" && sumA.parts.crux.status === "ok" && sumA.parts.rankings.status === "ok" && sumA.parts.ai.status === "ok" && sumA.parts.authority.status === "ok" && sumA.parts.conversions.status === "BLOCKED", JSON.stringify(sumA?.parts));
  check("gsc: two 28-day windows with six tables each", gscA?.status === "ok" && ["query", "page", "country", "device", "queryPage", "queryDevice"].every((t) => Array.isArray(gscA.tables.current[t]) && Array.isArray(gscA.tables.previous[t])) && gscA.windows.current.start === "2026-08-02", JSON.stringify(gscA?.windows));
  check("gsc: access token refreshed and written back", tokenCalls === 1 && J(tokenFile).access_token === "tok-good" && J(tokenFile).refresh_token === "REFRESHSECRET", `calls ${tokenCalls} ${fs.readFileSync(tokenFile, "utf8").slice(0, 200)}`);
  const qd = gscA?.tables.current.queryDevice || [];
  const q1desk = qd.find((r) => r.keys[0] === q1 && r.keys[1] === "DESKTOP");
  check("gsc: country filter applied to the ranking table (Canada's 900 impressions excluded)", q1desk && q1desk.impressions === 150 && Math.abs(q1desk.position - 6) < 0.01, JSON.stringify(q1desk));
  const exp = (start) => { const rows = DATA[start]; const clicks = rows.reduce((n, r) => n + r.clicks, 0), impr = rows.reduce((n, r) => n + r.imp, 0); return { clicks, impr }; };
  check("gsc: totals equal the fixture's sums (device table)", gscA?.totals.current.clicks === exp("2026-08-02").clicks && gscA.totals.current.impressions === exp("2026-08-02").impr && gscA.totals.previous.clicks === exp("2026-07-05").clicks, JSON.stringify(gscA?.totals));
  const gr = rankA?.rows.filter((r) => r.source === "search-console") || [];
  const g1 = gr.find((r) => r.query === q1 && r.device === "mobile");
  check("rankings: Search Console rows carry location, device, language, source and date, labelled estimate", g1 && g1.location.includes("usa") && g1.device === "mobile" && g1.language === "en" && g1.position.source.includes("Search Console") && g1.position.fetchedAt && g1.position.estimate === true && Math.abs(g1.position.value - 6) < 0.01 && S.validateRankingRow(g1).length === 0, JSON.stringify(g1));
  check("rankings: every target query has a row, and a query without impressions is null, not invented", ["tracy home value", "tracy cash offer"].every((q) => gr.some((r) => r.query === q)) && gr.find((r) => r.query === "tracy home value").position.value === null, JSON.stringify(gr.map((r) => [r.query, r.position.value])));
  const caps = rankA?.rows.filter((r) => r.source === "browser-capture") || [];
  const capM = caps.find((r) => r.device === "mobile"), capE = caps.find((r) => r.device === "desktop");
  check("rankings: a browser capture keeps its place and device and our position", capM && capM.position.value === 6 && capM.localized === true && capM.location === "Tracy, CA" && capM.above.length === 3, JSON.stringify(capM));
  check("rankings: a capture whose page showed another place is kept under that place, localized false", capE && capE.localized === false && capE.location.includes("Egypt") && capE.requestedLocation === "Tracy, CA", JSON.stringify(capE));
  check("rankings: a capture without a device is rejected", rankA?.rejected?.some((x) => /device/.test(x.reason)), JSON.stringify(rankA?.rejected));
  check("ai: Gemini asked 3 times per question, question alone as the user message, Google Search grounding on", gemCount["who buys houses for cash in Tracy, CA"] === 3 && gemCount["best realtor in Tracy, CA"] === 3 && lastGem.contents.length === 1 && lastGem.contents[0].parts.length === 1 && lastGem.tools?.[0]?.google_search && !lastGem.systemInstruction, JSON.stringify(gemCount));
  const gem = aiA?.rows.find((r) => r.engine === "gemini" && r.question.startsWith("who buys"));
  check("ai: citedShare is a sourced number between 0 and 1 with runs, cited sources and competitors cited", gem && gem.runs === 3 && gem.citedShare.value === 0 && gem.citedShare.source.includes("Gemini") && gem.citedShare.fetchedAt && gem.citedSources[0] === "maplehomebuyers.com" && gem.citedSources.includes("redfin.com") && gem.sourceCounts["maplehomebuyers.com"] === 3 && gem.competitorsCited.includes("webuyhouses.com") && gem.ourDomainCited === false, JSON.stringify(gem));
  check("ai: the grounded answer text is never stored (only a hash)", !allFiles(pewp).some((f) => fs.readFileSync(f, "utf8").includes("SECRET_ANSWER_TEXT")) && gem.answerHashes.length === 3, "");
  const chat = aiA?.rows.find((r) => r.engine === "chatgpt");
  check("ai: owner captures are grouped per question and engine, flagged as a low sample", chat && chat.runs === 2 && chat.lowSample === true && chat.citedShare.value === 0 && chat.method === "browser-capture", JSON.stringify(chat));
  check("authority: referring domains from the Common Crawl graph, labelled domain level", autA?.status === "ok" && autA.referringDomains.value === 12 && autA.level === "domain" && autA.release === "cc-r1" && autA.linkingDomains.length === 12 && autA.linkGap.some((g) => g.domain === "g1.com"), JSON.stringify(autA).slice(0, 300));
  const cruxPage = cruxA?.results.find((r) => r.target.endsWith("/tracy"));
  check("crux: field data per origin/page; 'no field data' is a recorded result, not a failure", cruxA?.status === "ok" && cruxA.results.find((r) => r.target === "https://mysite.example").metrics.cumulative_layout_shift.status === "needs improvement" && cruxPage?.noFieldData === true, JSON.stringify(cruxA?.results.map((r) => [r.target, r.noFieldData])));
  const bq = bingA?.tables.current.query.find((r) => r.keys[0] === q1);
  check("bing: daily rows aggregated inside the window, position weighted by impressions", bq && bq.clicks === 15 && bq.impressions === 400 && Math.abs(bq.position - 8) < 0.01 && !bingA.tables.current.query.some((r) => r.keys[0] === "outside window"), JSON.stringify(bq));
  check("index: URL Inspection verdict and coverage state recorded per planned page", idxA?.results?.length === 2 && idxA.results.find((r) => r.path === "/realtor-tracy").coverageState === "Crawled - currently not indexed", JSON.stringify(idxA));
  const rules = (id) => finA.findings.filter((f) => f.rule === id);
  check("rules: MSR-001 not indexed, MSR-002 outside top 10, MSR-003 unplanned demand, MSR-004 low click-through", rules("MSR-001").length === 1 && rules("MSR-002").some((f) => /Outside the top/.test(f.title) && f.title.includes(q2)) && rules("MSR-003").some((f) => f.title.includes("cash home buyers near me")) && rules("MSR-004").some((f) => f.title.includes("best realtor tracy")), finA.findings.map((f) => f.rule + " " + f.title).join(" | "));
  check("rules: MSR-005 not cited while a competitor is, MSR-006 field speed, MSR-007 prospects", rules("MSR-005").length >= 2 && rules("MSR-006").some((f) => /cumulative layout shift/.test(f.title)) && rules("MSR-007").some((f) => /prospects/.test(f.title) && f.detail.includes("g1.com")) && true, finA.findings.map((f) => f.rule).join(","));
  check("rules: every finding names its significance rule and carries sourced evidence", finA.findings.every((f) => f.significance && f.evidence && f.fix), "");
  const bl = (id) => finA.blocked.find((b) => b.rule === id);
  check("rules: MSR-009 (no analytics) and MSR-010 (no local run) are BLOCKED with an unblock step", bl("MSR-009")?.unblock && bl("MSR-010")?.unblock && !finA.findings.some((f) => f.rule === "MSR-009" || f.rule === "MSR-010"), JSON.stringify(finA.blocked));
  const leak = allFiles(path.join(tmp, "site-checks")).filter((f) => /BINGKEY123|CRUXKEY456|GEMKEY789|REFRESHSECRET|tok-good/.test(fs.readFileSync(f, "utf8")));
  check("security: no API key or token is written under .pewp", leak.length === 0, leak.join(", "));
  check("run A had no earlier run: the diff says baseline", J(path.join(dA, "diff.json")).baseline === true, "");
  const repA = fs.readFileSync(path.join(dA, "report.md"), "utf8"), rjA = J(path.join(dA, "report.json"));
  check("report: one-line answer first, each term explained once, BLOCKED parts say how to fix them", /^# How mysite\.example is doing/.test(repA) && /^\*\*In the last 28 days Google sent/m.test(repA) && (repA.match(/click-through rate \(/g) || []).length === 1 && (repA.match(/an impression \(/g) || []).length === 1 && /Conversions\*\*: .*To fix: .*GA4/.test(repA), repA.slice(0, 900));
  check("report.json: every number is {value, source, fetchedAt, cacheFile}", rjA.numbers.length >= 3 && rjA.numbers.every((n) => "value" in n && n.source && n.fetchedAt && "cacheFile" in n), JSON.stringify(rjA.numbers));
  const c0 = gscCalls; const g0 = Object.values(gemCount).reduce((a, c) => a + c, 0);
  await run(["--today", "2026-09-01"]);
  check("cache: a second run the same day makes no new Search Console call", gscCalls === c0, `${gscCalls} vs ${c0}`);
  // error statuses must not stay in the cache
  // the token file is shared with research-gsc.mjs; Google's own files carry expiry_date in ms, ours carry expiry as ISO
  const ctxD = (f) => ({ pewp, endpoints, budget: new S.Budget(), maxAgeDays: 1, tokenFile: f, env });
  const tdFresh = await S.gscAccessToken(ctxD(w(path.join(tmp, "tok-ed-fresh.json"), { access_token: "GOOGLE-STYLE", expiry_date: Date.now() + 3600000 })));
  const tdStale = await S.gscAccessToken(ctxD(w(path.join(tmp, "tok-ed-stale.json"), { access_token: "GOOGLE-STALE", expiry_date: Date.now() - 1000, refresh_token: "REFRESHSECRET", client_id: "cid", client_secret: "csec", token_uri: A + "/token" })));
  check("gsc: a token with Google's expiry_date (ms) is honoured: fresh is used as is, expired is refreshed", tdFresh.ok && tdFresh.token === "GOOGLE-STYLE" && tdStale.ok && tdStale.token === "tok-good" && tdStale.refreshed === true, JSON.stringify([tdFresh, tdStale]));
  const badCtx = { pewp, endpoints, budget: new S.Budget(), maxAgeDays: 1, tokenFile: w(path.join(tmp, "badtok.json"), { access_token: "wrong", expiry: "2999-01-01T00:00:00Z" }), env };
  const rb = await S.gscQuery(badCtx, { site: "sc-domain:mysite.example", start: "2026-01-01", end: "2026-01-28", dimensions: ["page"] });
  const cacheFiles401 = allFiles(path.join(pewp, "cache", "gsc")).filter((f) => JSON.parse(fs.readFileSync(f, "utf8")).status === 401);
  check("cache: an error status is never left in the cache (401 -> BLOCKED, nothing stored)", rb.ok === false && /401|refused/.test(rb.blocked.reason) && cacheFiles401.length === 0, JSON.stringify(rb.blocked) + cacheFiles401.length);

  // ---------------- local run feeds MSR-010 (before run B)
  const napSite = path.join(tmp, "napsite");
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const addr = { "@type": "PostalAddress", streetAddress: "123 Main St Ste 4", addressLocality: "Tracy", addressRegion: "CA", postalCode: "95376" };
  w(path.join(napSite, "index.html"), `<html><head><title>Home</title>${ld({ "@context": "https://schema.org", "@type": "RealEstateAgent", name: "Valley to Valley Realty, Inc.", telephone: "+1 209-555-0100", address: addr })}</head><body><h1>Home</h1></body></html>`);
  w(path.join(napSite, "contact.html"), `<html><head><title>Contact</title>${ld({ "@type": "RealEstateAgent", name: "Valley to Valley Realty", telephone: "(209) 555-0100" })}</head><body><a href="tel:209-555-0199">call</a><p>Or 877-555-0111</p></body></html>`);
  w(path.join(napSite, "about.html"), `<html><head><title>About</title>${ld({ "@type": "LocalBusiness", name: "Valley Realty" })}</head><body>About us</body></html>`);
  w(path.join(pewp, "captures", "local", "citations.json"), [
    { directory: "yelp.com", url: "https://yelp.com/biz/x", name: "Valley To Valley Realty", address: "123 Main St #4, Tracy, CA 95376", phone: "209-555-0100", capturedAt: "2026-09-15" },
    { directory: "bbb.org", name: "Valley to Valley Realty", address: "123 Main Street Suite 5, Tracy CA 95376", phone: "209-555-0100", capturedAt: "2026-09-15" },
    { directory: "facebook.com", name: "Valley to Valley Realty", address: "123 Main Street Suite 4 Tracy CA 95376", phone: "(209) 555-0188", capturedAt: "2026-09-15" }]);
  const lr = await cli("local-run.mjs", [URL_, "--site", napSite, "--today", "2026-09-20", "--cwd", tmp]);
  check("local run (for mysite): writes profile/pack/nap/reviews, profile and pack BLOCKED without captures", lr.status === 0 && J(path.join(pewp, "local", "2026-09-20", "nap.json"))?.status === "ok" && J(path.join(pewp, "local", "2026-09-20", "profile.json"))?.status === "blocked" && J(path.join(pewp, "local", "2026-09-20", "pack.json"))?.status === "blocked", lr.stdout + lr.stderr);

  // ---------------- the local grid (our own rank grid; captures are fixtures standing in for owner-supervised browser captures)
  const GR = await imp("local-grid.mjs"), TVg = await imp("targets-validate.mjs");
  const gc = { lat: 37.7, lng: -121.4 };
  const g3 = GR.gridPoints(gc, 3, 3), g4 = GR.gridPoints(gc, 4, 3);
  const dist = (a, b) => GR.haversineKm(g3.find((p) => p.id === a), g3.find((p) => p.id === b));
  check("grid: points are spaced the configured km apart (north-south and east-west), the city centre is the middle point", g3.length === 9 && Math.abs(dist("r1c2", "r2c2") - 3) < 0.03 && Math.abs(dist("r2c1", "r2c2") - 3) < 0.03 && Math.abs(dist("r2c2", "r2c3") - 3) < 0.03 && g3.find((p) => p.isCenter).id === "r2c2" && g3.find((p) => p.id === "r1c1").lat > g3.find((p) => p.id === "r3c1").lat, JSON.stringify([dist("r1c2", "r2c2"), dist("r2c1", "r2c2")]));
  check("grid: the city centre is always a point (an even grid gets an extra 'center' point)", g4.length === 17 && g4.filter((p) => p.isCenter).length === 1 && g4.find((p) => p.isCenter).id === "center" && g4.find((p) => p.id === "center").lat === gc.lat, JSON.stringify(g4.length));
  const centers = [{ city: "Tracy, CA", lat: 37.7, lng: -121.4, source: "fixture", readAt: "2026-09-01" }, { city: "Manteca, CA", lat: 37.8, lng: -121.2, source: "fixture", readAt: "2026-09-01" }, { city: "Dublin, CA", lat: 37.7, lng: -121.9 }];
  const pl = GR.planGrid({ cities: ["Tracy, CA", "Manteca, CA", "Dublin, CA", "Elk Grove, CA"], centers, n: 3, spacingKm: 3, queryTemplates: ["we buy houses {city}", "realtor in {cityName}"] });
  check("grid plan: capture requests per query x point (mobile or desktop, the Google Maps address at the point, location 'lat,lng (city)'), cities without a sourced centre are BLOCKED with the step, never guessed", pl.requests.length === 36 && pl.captureCount === 36 && pl.requests.every((r) => r.device === "mobile or desktop, as captured" && /^https:\/\/www\.google\.com\/maps\/search\/[^/]+\/@-?\d+\.\d{5},-?\d+\.\d{5},14z$/.test(r.mapsUrl) && /^-?\d+\.\d{5},-?\d+\.\d{5} \([A-Za-z ,]+\)$/.test(r.location)) && pl.requests.find((r) => r.query === "we buy houses Tracy, CA" && r.point.id === "r2c2")?.mapsUrl === "https://www.google.com/maps/search/we%20buy%20houses%20Tracy%2C%20CA/@37.70000,-121.40000,14z" && pl.requests.some((r) => r.query === "realtor in Tracy") && pl.requests.some((r) => r.query === "we buy houses Manteca, CA") && pl.blocked.length === 2 && pl.blocked.find((b) => b.city === "Elk Grove, CA").reason.includes("no centre") && pl.blocked.find((b) => b.city === "Dublin, CA").reason.includes("no source") && pl.estimatedMinutes === 27, JSON.stringify(pl.blocked));
  const plOver = GR.planGrid({ cities: ["Tracy, CA", "Manteca, CA"], centers, n: 5, spacingKm: 3, queryTemplates: ["a {city}", "b {city}"], maxCaptures: 40 });
  check("grid plan: over the cost stop no requests are written, the message says what to do", plOver.over === true && plOver.requests.length === 0 && plOver.captureCount === 100 && /Ask the owner/.test(plOver.overMessage) && GR.planGrid({ cities: ["Tracy, CA"], centers, n: 9, queryTemplates: ["a"] }).error, JSON.stringify(plOver.overMessage));
  // the CLI against the mysite fixture: first without centres and queries (BLOCKED), then with
  const bz = J(path.join(pewp, "business.json")); bz.locations[0].serviceArea = ["Tracy, CA", "Manteca, CA"]; w(path.join(pewp, "business.json"), bz);
  const gdir = path.join(pewp, "captures", "local", "grid");
  const gp0 = await cli("local-grid.mjs", ["plan", URL_, "--cwd", tmp]);
  const gp1 = await cli("local-grid.mjs", ["plan", URL_, "--cwd", tmp, "--query", "we buy houses {city}"]);
  check("grid plan CLI: no query templates is BLOCKED; no city centres is BLOCKED city by city and writes no requests", /BLOCKED: no query templates/.test(gp0.stdout) && /BLOCKED city Tracy, CA: no centre coordinates/.test(gp1.stdout) && /BLOCKED city Manteca, CA/.test(gp1.stdout) && !fs.existsSync(path.join(gdir, "requests.json")), gp0.stdout + gp1.stdout);
  w(path.join(gdir, "cities.json"), centers.slice(0, 2));
  const gp2 = await cli("local-grid.mjs", ["plan", URL_, "--cwd", tmp, "--query", "we buy houses {city}", "--n", "3", "--spacing-km", "3"]);
  const reqs = J(path.join(gdir, "requests.json"));
  const mdl = fs.readFileSync(path.join(gdir, "requests.md"), "utf8").split("\n").filter((l) => /^\d+\. \[ \] /.test(l));
  check("grid plan CLI: requests.json (+ requests.md) for the main session: 18 captures, 45 s apart, stop at the first robot check, the Google Maps address per point, a Maps viewport capture template (method, viewport, sponsored)",gp2.status === 0 && reqs?.count === 18 && reqs.paceSeconds === 45 && reqs.stopOnRobotCheck === true && ["https://www.google.com/maps/search/", 'method "maps-viewport"', "viewport {lat, lng, zoom}", "sponsored: true"].every((s) => reqs.instructions.includes(s)) && !/location override|footer/i.test(reqs.instructions) && reqs.requests[0].template.method === "maps-viewport" && !("locationShown" in reqs.requests[0].template) && reqs.requests[0].template.pack[0].sponsored === false && mdl.length === 18 && mdl.every((l) => l.includes(" | https://www.google.com/maps/search/") && / \| mobile or desktop, as captured -> \S+\.json$/.test(l)) && reqs.requests[0].template.point.lat && reqs.requests[0].captureFile.endsWith(".json") && fs.readFileSync(path.join(gdir, "requests.md"), "utf8").includes("[ ]") && J(path.join(gdir, "plan.json")).planned.length === 2, gp2.stdout + gp2.stderr);
  // captures as a person would save them (fixture): Tracy, "we buy houses Tracy, CA"
  const me = { position: 0, name: "Valley to Valley Realty", rating: 4.6, reviews: 30, website: "https://www.mysite.example/" };
  const others = [{ name: "Maple Home Buyers", rating: 4.9, reviews: 245 }, { name: "Frank Buys Houses", rating: 4.8, reviews: 120 }, { name: "Kind Path", rating: 4.7, reviews: 61 }, { name: "Fifth Co", rating: 4.0, reviews: 9 }, { name: "Sixth Co", rating: 4.0, reviews: 8 }];
  const packWith = (p, extra = {}) => { const list = others.map((o) => ({ ...o, ...extra })); if (p != null) list.splice(p - 1, 0, { ...me }); return list.map((o, i) => ({ ...o, position: i + 1 })); };
  const tracyReq = reqs.requests.filter((r) => r.city === "Tracy, CA");
  const putCaps = (positions, when, over = {}) => { for (const r of tracyReq) { const pid = r.point.id; if (!(pid in positions)) continue; const base = { query: r.query, city: r.city, location: r.location, locationShown: pid === "r3c3" ? "Kafr Tohormos /B, Egypt - From your devices" : "Tracy, California", device: "mobile", language: "en", point: r.point, capturedAt: when, capturedIn: "owner phone, signed out", pack: packWith(positions[pid]).map((o) => (pid === "r1c1" && o.name === "Kind Path" ? { ...o, name: "<img src=x> & Co" } : o)) }; w(path.join(gdir, r.captureFile ?? `${r.id}.json`), { ...base, ...over[pid] }); } };
  // first state: in the 3-pack at r1c1 (2), r1c2 (3), r2c2 (1); in the pack at r3c1 (5); absent elsewhere; r3c3 shows an Egyptian footer; r3c2 not captured yet
  putCaps({ r1c1: 2, r1c2: 3, r1c3: null, r2c1: null, r2c2: 1, r2c3: null, r3c1: 5, r3c3: null }, "2026-09-24T10:00:00Z");
  w(path.join(gdir, "older-r1c1.json"), { query: tracyReq[0].query, city: "Tracy, CA", location: tracyReq[0].location, locationShown: "Tracy, California", device: "mobile", language: "en", point: tracyReq.find((r) => r.point.id === "r1c1").point, capturedAt: "2026-09-01T10:00:00Z", pack: packWith(null) });
  w(path.join(gdir, "stopped.json"), { robotCheck: true, note: "robot check on request 12" });
  w(path.join(gdir, "desktop.json"), { query: "q", city: "Tracy, CA", device: "desktop", language: "en", capturedAt: "2026-09-24", point: { id: "r1c1", lat: 1, lng: 1 }, pack: [] });
  w(path.join(gdir, "undated.json"), { query: "q", city: "Tracy, CA", device: "mobile", language: "en", point: { id: "r1c1", lat: 1, lng: 1 }, pack: [] });
  const gi1 = await cli("local-grid.mjs", ["import", URL_, "--cwd", tmp, "--today", "2026-09-24"]);
  const grid1 = J(path.join(pewp, "local", "2026-09-24", "grid.json"));
  const sv = grid1?.solv.find((s) => s.city === "Tracy, CA");
  check("grid import: per-point table (localized or not), the newest capture of a point wins, robot-check / desktop / undated captures are rejected with the reason", gi1.status === 0 && grid1.points.filter((p) => p.city === "Tracy, CA").length === 8 && grid1.summary.localized === 7 && grid1.superseded.length === 1 && grid1.rejected.some((r) => /robot check/.test(r.reason)) && grid1.rejected.some((r) => /mobile only/.test(r.reason)) && grid1.rejected.some((r) => /capturedAt/.test(r.reason)), gi1.stdout + gi1.stderr + JSON.stringify(grid1?.rejected));
  check("grid import: a capture whose page footer shows another place (Egypt) is kept under that place and is not counted", grid1.points.find((p) => p.pointId === "r3c3").localized === false && sv.localizedPoints === 7 && sv.notLocalizedPoints === 1, JSON.stringify(sv));
  check("grid import: share of local voice per query and city (3-pack points / localized points) as sourced numbers, coverage against the plan, pending captures listed", sv.solv3.value === 0.429 && sv.pointsIn3Pack === 3 && sv.presence.value === 0.571 && sv.pointsAbsent === 3 && sv.medianPosition === 2.5 && sv.solv3.source.includes("owner browser captures") && sv.solv3.fetchedAt && sv.coverage.value === 0.778 && sv.partial === true && grid1.pending.some((p) => p.point === "r3c2" && p.city === "Tracy, CA") && grid1.pending.length === 10, JSON.stringify(sv).slice(0, 500) + " pending " + grid1.pending.length);
  check("grid import: top 3 competitors per point and per query + city (ours excluded)", sv.topCompetitors.map((c) => c.name + ":" + c.points3).join() === "Frank Buys Houses:7,Maple Home Buyers:7,Kind Path:4" && grid1.points.find((p) => p.pointId === "r2c2").top3.map((t) => t.name).join() === "Maple Home Buyers,Frank Buys Houses,Kind Path", JSON.stringify(sv.topCompetitors));
  const rkRows = grid1.rankings;
  check("grid import: ranking rows pass the ranking-row validator (location 'lat,lng (city)', device mobile, whole position + URL, or null)", rkRows.length === 7 && rkRows.every((r) => TVg.validateRankingRow(r).length === 0 && r.device === "mobile" && /^-?\d+\.\d{5},-?\d+\.\d{5} \(Tracy, CA\)$/.test(r.location)) && rkRows.find((r) => r.pointId === "r2c2").position.value === 1 && rkRows.find((r) => r.pointId === "r2c2").url === "https://www.mysite.example/" && rkRows.find((r) => r.pointId === "r1c3").position.value === null, JSON.stringify(TVg.validateRankingRow(rkRows[0])) + JSON.stringify(rkRows[0]).slice(0, 300));
  const txt = fs.readFileSync(path.join(pewp, "local", "2026-09-24", "grid.txt"), "utf8"), htm = fs.readFileSync(path.join(pewp, "local", "2026-09-24", "grid.html"), "utf8");
  check("grid heat map (text): north-up matrix, 1-9 our position, - not in the pack, ? other place, . not captured", txt.includes("in the 3-pack at 3 of 7 points (share of local voice 43%)  [PARTIAL: not all points captured]") && txt.includes("\n  2 3 -\n  - 1 -\n  5 . ?\n"), txt);
  check("grid heat map (HTML): no external script, stylesheet or image, a competitor name is escaped, a legend and one table per query and city", !/<script|<link|<img|<iframe|\ssrc=|\shref=|https?:\/\//i.test(htm.replace(/<!doctype html>/i, "").replace(/&lt;img src=x&gt; &amp; Co/g, "")) && htm.includes("&lt;img src=x&gt; &amp; Co") && !htm.includes("<img src=x>") && (htm.match(/<table>/g) || []).length === 1 && /not captured yet/.test(htm), htm.slice(0, 600));
  // second state, a few days later: lost two 3-pack points
  putCaps({ r1c1: null, r1c2: null, r1c3: null, r2c1: null, r2c2: 1, r2c3: null, r3c1: 5, r3c2: null, r3c3: null }, "2026-09-27T10:00:00Z");
  fs.rmSync(path.join(gdir, "older-r1c1.json"), { force: true });
  const gi2 = await cli("local-grid.mjs", ["import", URL_, "--cwd", tmp, "--today", "2026-09-27"]);
  const grid2 = J(path.join(pewp, "local", "2026-09-27", "grid.json"));
  const gd = GR.diffGrid(grid1, grid2);
  const gcity = gd.perCity.find((c) => c.city === "Tracy, CA");
  check("grid diff: per point and per query + city, 3-pack points entered / left between identical points, share of local voice before and after", gd.baseline === false && gcity.left3 === 2 && gcity.entered3 === 0 && gcity.net3 === -2 && gcity.solv3From === 0.429 && gcity.solv3To === 0.125 && gcity.significant && gd.changes.filter((c) => c.left3).length === 2 && gd.notComparablePoints === 1 && GR.diffGrid(null, grid2).baseline === true, JSON.stringify(gcity));
  check("grid diff: an unchanged point is not reported as a change and a not-localized point is never compared", !gd.changes.some((c) => c.pointId === "r2c2" || c.pointId === "r3c3"), JSON.stringify(gd.changes.map((c) => c.pointId)));
  const lr2 = await cli("local-run.mjs", [URL_, "--site", napSite, "--today", "2026-09-28", "--cwd", tmp]);
  check("local run imports the grid when captures exist (BLOCKED when they do not); importing unchanged captures again does not create a second grid that would hide the change", lr2.status === 0 && !fs.existsSync(path.join(pewp, "local", "2026-09-28", "grid.json")) && /grid=ok/.test(lr2.stdout) && /grid=BLOCKED/.test(lr.stdout) && /Grid, "we buy houses Tracy, CA" around Tracy, CA/.test(fs.readFileSync(path.join(pewp, "local", "2026-09-28", "report.md"), "utf8")), lr.stdout + lr2.stdout);

  // ---- the Google Maps viewport form and sponsored rows (SKILL-GRID-1a)
  const IG = (caps) => { try { return GR.importGrid(caps, { name: me.name, domain: "mysite.example", cities: ["Tracy, CA", "Manteca, CA"] }); } catch (e) { return { threw: String(e), points: [], rejected: [] }; } };
  const reqOf = (id) => tracyReq.find((r) => r.point.id === id), km = (k) => k / GR.KM_PER_DEG, c22 = reqOf("r2c2");
  const V = (r, over = {}) => ({ query: r.query, city: r.city, location: r.location, method: "maps-viewport", viewport: { lat: r.point.lat, lng: r.point.lng, zoom: 14 }, device: "desktop", language: "en", point: r.point, capturedAt: "2026-09-29T10:00:00Z", capturedIn: "owner laptop, signed out", pack: packWith(2), ...over });
  const ads = ["First Ad Homes", "Second Ad Homes", "Third Ad Homes"].map((name, i) => ({ name, position: i + 1, sponsored: true }));
  const SF = (r, over = {}) => { const { method, viewport, ...rest } = V(r); return { ...rest, device: "mobile", locationShown: "Tracy, California", ...over }; };
  const m1 = IG([V(c22)]), m1p = m1.points[0];
  check("grid maps: a capture of the Google Maps viewport at the point counts, on the device it was captured on", m1.rejected.length === 0 && m1.points.length === 1 && m1p?.localized === true && m1p?.method === "maps-viewport" && m1p?.device === "desktop" && m1p?.position?.value === 2 && m1p?.position?.device === "desktop", JSON.stringify(m1).slice(0, 400));
  const vw = (o) => ({ viewport: { lat: c22.point.lat, lng: c22.point.lng, zoom: 14, ...o } }), loc2 = (over) => IG([V(c22, over)]).points[0]?.localized;
  const m2 = [loc2(vw({ lat: c22.point.lat + km(0.4) })), loc2(vw({ lat: c22.point.lat + km(0.6) })), loc2(vw({ zoom: 13 })), loc2(vw({ zoom: 15 })), loc2(vw({ zoom: 12 })), loc2(vw({ zoom: 16 })), loc2({ locationShown: "Another Town, Nowhere" })];
  check("grid maps: localized exactly when the viewport centre is at most 0.5 km from the point and the zoom is 13, 14 or 15", m2.join() === "true,false,true,true,false,false,true", m2.join());
  const m3 = [undefined, { lat: "37.7", lng: c22.point.lng, zoom: 14 }, { lat: c22.point.lat, lng: null, zoom: 14 }, { lat: c22.point.lat, lng: c22.point.lng, zoom: 14.5 }].map((viewport) => IG([V(c22, { viewport })]));
  check("grid maps: a viewport that is not lat, lng and a whole zoom is rejected", m3.every((r) => r.points.length === 0 && r.rejected.length === 1 && r.rejected[0]?.reason?.includes("viewport{lat,lng,zoom}")), JSON.stringify(m3.map((r) => [r.points.length, r.rejected])).slice(0, 400));
  const noM = (() => { const { method, ...rest } = V(c22); return rest; })();
  const m4 = [IG([V(c22, { method: "maps" })]), IG([V(c22, { method: null })])], m4n = IG([noM]);
  check("grid maps: a method other than maps-viewport is rejected naming the two forms", m4.every((r) => r.points.length === 0 && r.rejected.length === 1) && m4[0].rejected[0]?.reason === m4[1].rejected[0]?.reason && /left out/.test(m4[0].rejected[0]?.reason) && /"maps-viewport"/.test(m4[0].rejected[0]?.reason) && m4n.points.length === 0 && m4n.rejected[0]?.reason === "the grid is measured on mobile only", JSON.stringify([m4, m4n.rejected]).slice(0, 400));
  const adPack = [...ads, ...packWith(1).map((o) => ({ ...o, position: o.position + 3, sponsored: false }))];
  const m5 = [IG([V(c22, { pack: adPack })]), IG([SF(c22, { pack: adPack })])];
  check("grid maps: rows the page marks sponsored are ads", m5.every((r) => r.points.length === 1 && r.points[0].position?.value === 1 && r.points[0].packSize === 6 && r.points[0].sponsoredRemoved === 3 && r.points[0].top3?.map((t) => t.name).join() === "Maple Home Buyers,Frank Buys Houses,Kind Path"), JSON.stringify(m5.map((r) => r.points[0] && [r.points[0].position, r.points[0].packSize, r.points[0].sponsoredRemoved, r.points[0].top3])).slice(0, 400));
  const p6 = packWith(3).map((o, i) => ({ ...o, position: [1, 3, 4, 5, 6, 7][i], ...(i === 1 ? { sponsored: false } : {}) }));
  const m6 = IG([V(c22, { pack: p6 })]).points[0], m6a = IG([V(c22, { pack: packWith(3).map((o, i) => (i === 2 ? { ...o, sponsored: "yes" } : o)) })]), m6b = IG([V(c22, { pack: packWith(3).map((o, i) => (i === 0 ? { ...o, sponsored: null } : o)) })]);
  check("grid maps: with no sponsored row the positions stay as captured", m6?.position?.value === 4 && m6?.sponsoredRemoved === 0 && m6a.points.length === 0 && m6a.rejected[0]?.reason === "pack[2].sponsored must be true or false, or left out" && m6b.points.length === 0 && m6b.rejected[0]?.reason === "pack[0].sponsored must be true or false, or left out", JSON.stringify([m6?.position, m6?.sponsoredRemoved, m6a.rejected, m6b.rejected]).slice(0, 400));
  const vroot = path.join(tmp, "maps-form"), vp = path.join(vroot, "site-checks", "mysite.example", ".pewp"), vdir = path.join(vp, "captures", "local", "grid");
  w(path.join(vp, "business.json"), bz);
  for (const r of [c22, reqOf("r1c1")]) w(path.join(vdir, `${r.id}.json`), V(r));
  const gvm = await cli("local-grid.mjs", ["import", URL_, "--cwd", vroot, "--today", "2026-09-29"]);
  const vout = path.join(vp, "local", "2026-09-29"), rd = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  const vj = rd(path.join(vout, "grid.json")), vt = rd(path.join(vout, "grid.txt")), vh = rd(path.join(vout, "grid.html")), vg = J(path.join(vout, "grid.json"));
  check("grid maps: a folder of Maps viewport captures imports", gvm.status === 0 && /^grid 2026-09-29: 2 points \(2 localized, 0 not\), 0 still pending, 0 rejected; 2 ranking rows/m.test(gvm.stdout) && vg?.source === "owner-supervised browser captures of the Google Maps results list at each viewport, captured on desktop" && vg?.rankings?.length === 2 && vg.rankings.every((r) => r.device === "desktop" && TVg.validateRankingRow(r).length === 0) && !/mobile/i.test(vj) && !/mobile/i.test(vt) && !/mobile/i.test(vh) && vt.startsWith("Local grid heat map (the Google Maps results list at each viewport, captured on desktop). ") && vh.includes("<p>The Google Maps results list at each viewport, captured on desktop. Each square") && grid1.source === "owner-supervised browser captures of the map pack, mobile" && txt.startsWith("Local grid heat map (mobile). ") && htm.includes("<p>Mobile map pack. Each square"), gvm.stdout + gvm.stderr + vt.slice(0, 200));
  w(path.join(vdir, `${reqOf("r2c3").id}.json`), V(reqOf("r2c3"), { device: "mobile" }));
  w(path.join(vdir, "search-r2c3.json"), SF(reqOf("r2c3"), { capturedAt: "2026-09-29T11:00:00Z", pack: packWith(1) }));
  const gm = await cli("local-grid.mjs", ["import", URL_, "--cwd", vroot, "--today", "2026-09-30"]);
  check("grid maps: a folder holding both forms is BLOCKED", gm.status === 3 && /^BLOCKED: the grid folder holds 1 mobile Google search capture\(s\) \(no method\) and 3 Google Maps viewport capture\(s\) \(method maps-viewport\); one grid never mixes the two \| unblocks: Set the captures of the form you are not using aside/.test(gm.stdout.trim().split("\n").at(-1)) && !fs.existsSync(path.join(vp, "local", "2026-09-30")), gm.stdout + gm.stderr);
  const m9 = IG([V(c22, { device: "tablet" })]), m9c = IG([V(c22, { device: "mobile" })]);
  check("grid maps: a Maps capture on a device that is not mobile or desktop is rejected", m9.points.length === 0 && m9.rejected.length === 1 && m9.rejected[0]?.reason === "device must be mobile or desktop, as captured (ranking rules R-001 and R-002)" && m9c.points.length === 1 && m9c.points[0].localized === true && m9c.points[0].device === "mobile", JSON.stringify([m9.rejected, m9c.points.length]).slice(0, 400));

  // ---------------- run B (a month later, things moved)
  phase = "B"; gemCount = {};
  cap("tracy-mobile.json", { query: q1, engine: "google", location: "Tracy, CA", locationShown: "Tracy, CA", device: "mobile", language: "en", capturedAt: "2026-09-27T18:00:00Z", capturedIn: "owner phone, signed out", organic: orgs(2) });
  cap("tracy-desktop.json", { query: q1, engine: "google", location: "Tracy, CA", locationShown: "Tracy, CA", device: "desktop", language: "en", capturedAt: "2026-09-27T18:05:00Z", capturedIn: "owner laptop, signed out", organic: orgs(5) });
  const cfgB = J(cfgFile); cfgB.authority.release = "cc-r2"; w(cfgFile, cfgB);
  const rbRun = await run(["--today", "2026-09-29", "--fresh", "--refresh-authority"]);
  const dB = path.join(pewp, "measure", "2026-09-29");
  const diffB = J(path.join(dB, "diff.json")), finB = J(path.join(dB, "findings.json")), aiB = J(path.join(dB, "ai.json")), rankB = J(path.join(dB, "rank-detail.json"));
  check("measure run B: exit 0, diffed against the run of 2026-09-01", rbRun.status === 0 && diffB && diffB.baseline === false && diffB.previousDate === "2026-09-01", rbRun.stdout.slice(-500) + rbRun.stderr.slice(-400));
  const qd1 = diffB?.gsc?.queries;
  check("diff: query gains and losses, new and lost queries", qd1?.gains.some((x) => x.key === q1 && x.clicksFrom === 42 && x.clicksTo === 72) && qd1.newKeys.some((x) => x.key === "tracy cash offer") && qd1.lostKeys.some((x) => x.key === "sell my house fast tracy") && qd1.losses.some((x) => x.key === q2), JSON.stringify(qd1).slice(0, 500));
  check("diff: a click change is significant only outside the Poisson interval", qd1?.gains.find((x) => x.key === q1)?.significant === true && qd1.gains.find((x) => x.key === "cash home buyers near me")?.clicksTo === 4 && qd1.gains.find((x) => x.key === "cash home buyers near me")?.significant === false, JSON.stringify(qd1?.gains));
  const rc = diffB?.rankChanges || [];
  const ccM = rc.find((c) => c.source === "browser-capture" && c.device === "mobile");
  check("diff: ranks are compared only between identical query, source, place, device and language", ccM && ccM.from === 6 && ccM.to === 2 && ccM.significant === true && !rc.some((c) => c.source === "browser-capture" && c.device === "desktop" && c.location === "Tracy, CA") && diffB.rankingsNotComparable >= 1, JSON.stringify(rc.filter((c) => c.source === "browser-capture")) + " nc " + diffB?.rankingsNotComparable);
  const gemB = aiB?.rows.find((r) => r.engine === "gemini" && r.question.startsWith("who buys"));
  const ac = diffB?.aiChanges.find((c) => c.engine === "gemini" && c.question.startsWith("who buys"));
  check("diff: AI citation share compared as shares (0 of 3 -> 2 of 3, a change of 2 samples is significant)", gemB?.citedCount === 2 && ac?.from.cited === 0 && ac.to.cited === 2 && ac.significant === true, JSON.stringify(ac));
  check("diff: new and lost citations are listed (we are newly cited, webuyhouses.com is gone)", diffB?.newCitations.some((c) => c.ours && c.domain === "mysite.example") && diffB.lostCitations.some((c) => c.domain === "webuyhouses.com" && !c.ours), JSON.stringify([diffB?.newCitations, diffB?.lostCitations]));
  const da = diffB?.authority;
  check("diff: referring domains gained and lost between Common Crawl releases", da?.comparable === true && da.fromCount === 12 && da.toCount === 3 && da.lostCount === 10 && da.gained.join() === "n1.com" && da.lost.includes("l03.com"), JSON.stringify(da).slice(0, 300));
  const fB = (id) => finB.findings.filter((f) => f.rule === id);
  check("rules run B: MSR-007 significant loss of referring domains (3 is below the interval of 12)", fB("MSR-007").some((f) => /Lost referring domains/.test(f.title)), finB.findings.map((f) => f.rule + ":" + f.title).join(" | "));
  check("rules run B: MSR-008 two of our pages compete for a target query and the planned page is not first", fB("MSR-008").some((f) => f.title.includes(q2) && f.detail.includes("/blog/realtor-tips") && f.detail.includes("not the planned /realtor-tracy")), JSON.stringify(fB("MSR-008")));
  check("rules run B: MSR-006 got worse by status, MSR-005 not-cited persists, MSR-002 rank moves", fB("MSR-006").some((f) => /got worse/.test(f.title)) && diffB.cruxChanges.some((c) => c.worse) && fB("MSR-005").length >= 1, JSON.stringify(diffB?.cruxChanges));
  check("rules run B: MSR-010 now reads the local run (3 listing mismatches, directories without a listing)", fB("MSR-010").filter((f) => /differs/.test(f.title)).length === 2 && fB("MSR-010").some((f) => /No listing on zillow\.com/.test(f.title)) && !finB.blocked.some((b) => b.rule === "MSR-010"), fB("MSR-010").map((f) => f.title).join(" | "));
  check("rules run B: MSR-010 reads the local grid: weak map-pack coverage and 3-pack positions lost since the previous grid; the grid diff is in diff.json", fB("MSR-010").some((f) => /Weak map-pack coverage/.test(f.title) && f.title.includes("Tracy, CA") && /1 of 8 grid points \(13%\)/.test(f.detail)) && fB("MSR-010").some((f) => /Lost map-pack positions/.test(f.title) && /2 grid points left the 3-pack/.test(f.detail)) && diffB.grid?.baseline === false && diffB.grid.perCity[0].left3 === 2 && /Map-pack grid/.test(fs.readFileSync(path.join(dB, "report.md"), "utf8")), fB("MSR-010").map((f) => f.title + " :: " + f.detail.slice(0, 90)).filter((x) => /map-pack/.test(x)).join(" | ") + " DIFF " + JSON.stringify(diffB.grid).slice(0, 250));
  check("rankings run B: the desktop capture exists only now and is a new row, not a change", rankB.rows.some((r) => r.device === "desktop" && r.localized === true && r.position.value === 5), "");
  const repB = fs.readFileSync(path.join(dB, "report.md"), "utf8");
  check("report run B: says what changed since the last run", /What changed since the last run/.test(repB) && /Referring domains/.test(repB) && /compared with 2026-09-01/.test(repB), repB.slice(0, 800));

  // ---------------- the folder contract used by the plan stage (targets-validate.mjs)
  const TV = await imp("targets-validate.mjs");
  const errA = TV.validateMeasureDir(dA), errB = TV.validateMeasureDir(dB);
  check("contract: rankings.json and citations.json of both dates pass targets-validate (rows sourced, whole positions, ranking URL, device, language)", errA.length === 0 && errB.length === 0, JSON.stringify([...errA, ...errB].slice(0, 4)));
  const cmp = TV.compareMeasure(dA, dB);
  check("contract: compareMeasure pairs the two dates (same key comparable, the new desktop capture is new)", cmp.comparable.some((c) => c.query === q1 && c.from === 6 && c.to === 2) && cmp.comparable.length >= 2, JSON.stringify(cmp).slice(0, 400));
  const rkA = J(path.join(dA, "rankings.json")), ctA = J(path.join(dA, "citations.json"));
  check("contract: Search Console averages are whole positions with the average kept, tablet and local-pack rows stay in rank-detail.json", rkA.rankings.some((r) => r.source === "search-console" && Number.isInteger(r.position.value) && typeof r.position.average === "number") && !rkA.rankings.some((r) => r.device === "tablet" || r.engine === "google-local-pack") && ctA.citations.every((c) => c.citedSources.every((s) => typeof s === "string")), JSON.stringify(rkA.rankings.slice(0, 1)));

  // ---------------- the project's own capture formats (research-serp-import and research-ai parsers)
  const mdDir = path.join(tmp, "p02-fresh");
  w(path.join(mdDir, "C03.google.md"), `## UPDATE 2026-10-17 (night, fresh run): Google web READ in the OWNER'S EDGE (signed-in profile)\nLocation: Google location set to Tracy, California with the uule parameter; footer location shown: "Kafr Tohormos /B, Egypt - Based on your places (Home)"\n**GOOGLE AI OVERVIEW: PRESENT** (complete: yes)\nOrganic top 10: 1 webuyhouses.com (We Buy Houses Tracy CA) · 2 mysite.example/tracy (Valley to Valley) · 3 listwithclever.com (Top 9)\nLocal / Places pack: Frank Buys Houses, LLC 4.8 (61) · I Buy Central Valley 4.8 (22)\n`);
  const imd = await M.importFreshMarkdown(mdDir, path.join(tmp, "p02-out"), { device: "desktop", language: "en", queries: { C03: "we buy houses Tracy CA" } });
  const impCap = J(path.join(tmp, "p02-out", "C03.google.json"));
  const impRows = S.rankingRowsFromCaptures([{ ...impCap, _file: "C03.google.json" }], { domain: "mysite.example" });
  const impRow = impRows.rows.find((r) => r.engine === "google");
  check("import-md: a capture of the project's own fresh/*.google.md becomes a capture file; its footer place says it was NOT localized", imd.imported === 1 && imd.parser === "research-serp-import.mjs" && impRow && impRow.localized === false && impRow.location.includes("Egypt") && impRow.position.value === 2 && impRow.device === "desktop", JSON.stringify(imd) + JSON.stringify(impRow)?.slice(0, 300));
  w(path.join(mdDir, "C03.bing.md"), `## UPDATE 2026-10-17 (night, fresh run): Bing read in the OWNER'S EDGE\nLocation: none\nOrganic top 10: 1 webuyhouses.com (We Buy Houses) · 2 mysite.example/tracy (Valley to Valley)\n`);
  const imd2 = await M.importFreshMarkdown(mdDir, path.join(tmp, "p02-out2"), { device: "desktop", language: "en", queries: { C03: "we buy houses Tracy CA" } });
  const bingCap = J(path.join(tmp, "p02-out2", "C03.bing.json"));
  const bingRows = bingCap ? S.rankingRowsFromCaptures([{ ...bingCap, _file: "C03.bing.json" }], { domain: "mysite.example" }) : { rows: [], rejected: [] };
  check("import-md: a Bing capture (no location setting) is kept under its 'NOT LOCALIZED' label, not rejected for a missing place", bingRows.rows.length === 1 && bingRows.rows[0].engine === "bing" && bingRows.rows[0].localized === false && /^NOT LOCALIZED/.test(bingRows.rows[0].location) && bingRows.rows[0].position.value === 2 && bingRows.rejected.length === 0, JSON.stringify(imd2) + JSON.stringify(bingRows).slice(0, 300));
  const aiMdDir = path.join(tmp, "ai-md");
  const EM = String.fromCharCode(0x2014); // the capture heading format uses an em dash; built from its code so the file carries none
  w(path.join(aiMdDir, "AI-C03.chatgpt.md"), `# AI-C03.chatgpt ${EM} "who buys houses for cash in Tracy, CA" ${EM} ChatGPT ${EM} 2026-10-17 (night) ${EM} owner's Edge\n\n## Answer (verbatim, full)\nSome answer text.\n\n## Sources cited\n- maplehomebuyers.com\n- mysite.com\n`);
  w(path.join(aiMdDir, "x.json"), { question: "q json", engine: "perplexity", capturedAt: "2026-10-17", sources: ["https://www.zillow.com/a", { url: "https://redfin.com/b" }] });
  w(path.join(aiMdDir, "undated.json"), { question: "q undated", engine: "perplexity", citedDomains: ["a.com"] });
  const lac = await S.loadAiCaptures(aiMdDir); const aiR = S.aiRowsFromCaptures(lac.caps, { domain: "mysite.com", competitors: [] });
  check("ai captures: research-ai's `sources` field and the project's AI-<ID>.<engine>.md files are read; an undated answer is rejected", aiR.rows.length === 2 && aiR.rows.find((r) => r.engine === "chatgpt").ourDomainCited === true && aiR.rows.find((r) => r.engine === "perplexity").citedSources.join() === "zillow.com,redfin.com" && aiR.rejected.some((x) => /no capture date/.test(x.reason)), JSON.stringify(aiR).slice(0, 500));

  // ---------------- Gemini rate limit: partial result, stopped, not retried
  const lim = "https://limited.example/";
  const limPewp = (await imp("state.mjs")).locate(lim, { cwd: tmp }).pewp;
  w(path.join(limPewp, "targets.json"), J(path.join(pewp, "targets.json")));
  gemMode = "429-after-2"; gemCount = {};
  const rl = await M.runMeasure(lim, { cwd: tmp, today: "2026-09-01", log: () => {}, env: { GEMINI_API_KEY: "GEMKEY789" }, tokenFile: path.join(tmp, "none.json"), config: { endpoints, gsc: { site: "sc-domain:limited.example" }, ai: { gapMs: 0, geminiTermsAcknowledged: true } } });
  gemMode = "normal";
  const aiL = J(path.join(rl.dir, "ai.json"));
  check("ai: a 429 from the free tier stops the AI part with a partial result and the reason", aiL.status === "partial" && aiL.gemini.blocked.reason.includes("429") && aiL.rows.length === 1 && aiL.rows[0].runs === 2 && aiL.rows[0].incomplete === true, JSON.stringify(aiL.gemini));

  // ---------------- nothing connected: everything BLOCKED with its unblock step, nothing invented
  const bare = "https://bare.example/";
  const bareR = await M.runMeasure(bare, { cwd: tmp, today: "2026-09-01", log: () => {}, env: {}, tokenFile: path.join(tmp, "none.json"), config: { endpoints, authority: { cache: path.join(tmp, "nocc") } } });
  const parts = bareR.summary.parts;
  check("blocked: with no key, token, targets or captures every part is BLOCKED with an unblock step", Object.values(parts).every((p) => p.status === "BLOCKED" && p.unblock && p.reason), JSON.stringify(parts));
  const bareFiles = ["gsc", "bing", "crux", "rankings", "ai", "index"].map((k) => J(path.join(bareR.dir, k + ".json")));
  const bareReport = J(path.join(bareR.dir, "report.json")); const bareMd = fs.readFileSync(path.join(bareR.dir, "report.md"), "utf8");
  check("blocked: no data file holds invented rows, the report says NOT MEASURED, report.json has no numbers", bareFiles.every((f) => !(f.rows?.length) && !(f.results?.length) && !f.tables) && bareReport.numbers.length === 0 && /NOT MEASURED/.test(bareMd) && /not connected/.test(bareReport.headline), bareMd.slice(0, 500));
  check("blocked: with no key the CrUX part is BLOCKED, never an empty 'no field data' result", J(path.join(bareR.dir, "crux.json")).status === "blocked" && !J(path.join(bareR.dir, "crux.json")).results, JSON.stringify(J(path.join(bareR.dir, "crux.json"))));

  // ---------------- authority when the link graph does not hold a site (work order 28): "not found in the link data" is not 0, and no row is dropped
  // authority.mjs gives a site the graph does not hold only domain, inGraph:false and note: no role, no count
  const ngOut = (domain) => ({ domain, inGraph: false, note: "not in this Common Crawl release (too few links or not crawled)" });
  const ngIn = (domain, role, n, pos) => ({ domain, role, inGraph: true, hosts: 1, harmonicPos: pos, pageRankPos: pos, linkingDomains: n, strongestLinkingDomains: [{ domain: "l1.example", harmonicPos: 5 }] });
  const ngRun = async (host, results) => {
    const url = `https://${host}/`, loc = (await imp("state.mjs")).locate(url, { cwd: tmp });
    w(path.join(loc.pewp, "authority.json"), { fetchedAt: "2026-08-30T00:00:00Z", source: "Common Crawl web graph cc-test (domain level)", release: "cc-test", target: results[0].domain, results, linkGap: [{ domain: "g1.example", linksToCompetitors: 2, harmonicPos: 50 }] });
    const r = await M.runMeasure(url, { cwd: tmp, today: "2026-09-01", log: () => {}, env: {}, tokenFile: path.join(tmp, "none.json"), config: { endpoints, authority: { cache: path.join(tmp, "nocc") } } });
    return { au: J(path.join(r.dir, "authority.json")), fin: J(path.join(r.dir, "findings.json")) };
  };
  const ng = await ngRun("nograph.example", [ngOut("nograph.example"), ngIn("rival-a.example", "competitor", 120, 900), ngOut("rival-b.example")]);
  const ngC = (d) => ng.au?.competitors?.find((c) => c.domain === d);
  check("authority: a target the graph does not hold is inGraph false and still lists every competitor: the one in the graph with its count, the one not in it (it has no role) with linkingDomains null and inGraph false, never 0", ng.au?.status === "ok" && ng.au.inGraph === false && ng.au.competitors.length === 2 && ngC("rival-a.example")?.linkingDomains === 120 && ngC("rival-a.example").inGraph === true && ngC("rival-b.example")?.linkingDomains === null && ngC("rival-b.example").inGraph === false, "competitors: " + JSON.stringify(ng.au?.competitors) + " inGraph: " + ng.au?.inGraph);
  const ngP = (ng.fin?.findings || []).find((f) => f.rule === "MSR-007" && /prospects/i.test(f.title));
  check("authority: with the target not in the graph the MSR-007 prospects finding lists the sites that link to 2 or more competitors, says whether they link here cannot be judged (not found in the link data) and never says 'and not to us'", !!ngP && /2 or more competitors/.test(ngP.detail) && /cannot be judged/.test(ngP.detail) && /not found in the link data/.test(ngP.detail) && !/not to us/.test(ngP.detail + ngP.title) && ngP.detail.includes("g1.example"), JSON.stringify(ngP) || (ng.fin?.findings || []).map((f) => f.rule + ":" + f.title).join(" | "));
  const gi = await ngRun("ingraph.example", [ngIn("ingraph.example", "target", 14, 700), ngIn("rival-a.example", "competitor", 120, 900), ngOut("rival-b.example")]);
  const giP = (gi.fin?.findings || []).find((f) => f.rule === "MSR-007" && /prospects/i.test(f.title));
  check("authority: a target in the graph keeps its count, lists the competitor not in the graph (null, no role) next to the one in it, and the prospects finding keeps 'and not to us'", gi.au?.inGraph === true && gi.au.referringDomains.value === 14 && gi.au.competitors.length === 2 && gi.au.competitors.find((c) => c.domain === "rival-b.example")?.linkingDomains === null && gi.au.competitors.find((c) => c.domain === "rival-b.example").inGraph === false && gi.au.competitors.find((c) => c.domain === "rival-a.example")?.linkingDomains === 120 && !!giP && /and not to us: g1\.example/.test(giP.detail) && !/cannot be judged/.test(giP.detail), "competitors: " + JSON.stringify(gi.au?.competitors) + " finding: " + JSON.stringify(giP));

  // ================================================================ migrate
  const OLD = "https://old.example/";
  const oldLoc = (await imp("state.mjs")).locate(OLD, { cwd: tmp });
  const snap = path.join(oldLoc.snapshots, "2026-10-01");
  const slugOf = (p) => (p === "/" ? "home" : p.slice(1).replace(/[^A-Za-z0-9._-]+/g, "__"));
  const oldPages = [
    ["/", "Old Co | Home", 200], ["/about-us.html", "About Us | Old Co", 200], ["/services/cash-offer", "Cash Offer", 200], ["/old-cash-offer", "Cash Offer for your House Tracy", 200], ["/contact", "Contact", 200],
    ["/people/jane-doe", "Jane Doe | Old Co", 200], ["/blog/2019/selling-tips", "Selling Tips", 200], ["/legacy-a", "Legacy", 301, "/legacy-c"], ["/promo", "Promo", 200], ["/sale-old", "Sale", 200], ["/sale-mid", "Sale mid", 200], ["/unimportant", "Nothing", 200]];
  const sitePages = oldPages.map(([p, t, s, fin]) => ({ url: "https://old.example" + p, slug: slugOf(p), status: s, finalUrl: "https://old.example" + (fin || p), redirects: fin ? 2 : 0 }));
  w(path.join(snap, "_site.json"), { url: OLD, origin: "https://old.example", finishedAt: "2026-10-01T10:00:00Z", pages: sitePages, stoppedEarly: null });
  w(path.join(snap, "site", "sitemaps.json"), { urls: [...oldPages.map(([p]) => ({ loc: "https://old.example" + p })), { loc: "https://old.example/ghost-page" }] });
  for (const [p, t] of oldPages) { w(path.join(snap, "pages", slugOf(p), "head.html"), `<head><title>${t}</title><meta name="description" content="About ${t}"></head>`); w(path.join(snap, "pages", slugOf(p), "body.html"), `<body><h1>${t}</h1><p>${"word ".repeat(200)}</p></body>`); }
  const gscFile = w(path.join(tmp, "old-gsc.json"), { windowDays: 90, rows: [
    { page: "https://old.example/", clicks: 90, impressions: 900 }, { page: "https://old.example/about-us.html", clicks: 12, impressions: 100 }, { page: "https://old.example/about-us.html?utm=x", clicks: 3, impressions: 10 },
    { page: "https://old.example/services/cash-offer", clicks: 20, impressions: 300 }, { page: "https://old.example/old-cash-offer", clicks: 9, impressions: 100 }, { page: "https://old.example/blog/2019/selling-tips", clicks: 6, impressions: 60 },
    { page: "https://old.example/promo", clicks: 5, impressions: 50 }, { page: "https://old.example/sale-old", clicks: 7, impressions: 40 }, { page: "https://old.example/legacy-a", clicks: 4, impressions: 30 },
    { page: "https://old.example/contact", clicks: 2, impressions: 20 }, { page: "https://old.example/sale-mid", clicks: 1, impressions: 5 }, { page: "https://old.example/unimportant", clicks: 0, impressions: 3 }] });
  const linksCsv = w(path.join(tmp, "links.csv"), "Target page,External links,Linking sites\nhttps://old.example/people/jane-doe,14,3\nhttps://old.example/,230,40\n");
  const newDir = path.join(tmp, "newsite");
  const html = (t, extra = "") => `<html><head><title>${t}</title>${extra}</head><body><h1>${t}</h1><p>${"word ".repeat(150)}</p></body></html>`;
  w(path.join(newDir, "index.html"), html("Valley Realty | Home")); w(path.join(newDir, "about-us", "index.html"), html("About Us")); w(path.join(newDir, "services", "cash-offer", "index.html"), html("Get a Cash Offer for Your House in Tracy"));
  w(path.join(newDir, "contact.html"), html("Contact")); w(path.join(newDir, "blog", "selling-tips", "index.html"), html("Selling Tips")); w(path.join(newDir, "legacy-c.html"), html("Legacy C")); w(path.join(newDir, "deals.html"), html("Deals"));
  w(path.join(newDir, "_redirects"), "# existing\n/old-stuff /about-us 301\n/news/* /blog/:splat 301\n");
  const overrides = w(path.join(tmp, "overrides.csv"), "from,to\n/promo,/\n/sale-old,/sale-mid\n/sale-mid,/deals\n");

  const bareInv = await cli("migrate.mjs", ["https://nothing.example/", newDir, "--stage", "inventory", "--cwd", tmp]);
  const bareInvJ = J(path.join(tmp, "site-checks", "nothing.example", ".pewp", "migrate", "inventory.json"));
  check("migrate inventory: with no snapshot, Search Console data or links every part is BLOCKED with an unblock step", bareInv.status === 0 && bareInvJ.counts.total === 0 && ["snapshot", "searchConsole", "links", "sitemap"].every((k) => bareInvJ.parts[k].status === "blocked" && bareInvJ.parts[k].blocked.unblock), bareInv.stdout + bareInv.stderr);

  const mp = await cli("migrate.mjs", [OLD, newDir, "--stage", "map", "--cwd", tmp, "--gsc-file", gscFile, "--links-csv", linksCsv, "--overrides", overrides, "--today", "2026-10-22"]);
  const mdir = path.join(oldLoc.pewp, "migrate");
  const inv = J(path.join(mdir, "inventory.json")), map = J(path.join(mdir, "redirect-map.json"));
  const row = (p) => map?.rows.find((r) => r.from === p);
  check("inventory: old snapshot + sitemap + Search Console (query strings merged) + page links combined", mp.status === 0 && inv.counts.total === 13 && inv.rows.find((r) => r.path === "/about-us.html").clicks === 15 && inv.rows.find((r) => r.path === "/people/jane-doe").links === 14 && inv.rows.find((r) => r.path === "/ghost-page").sources.join() === "sitemap", mp.stdout + mp.stderr);
  check("inventory: mustKeep = traffic, links, visibility or home; an unvisited page is not gated", inv.rows.find((r) => r.path === "/people/jane-doe").mustKeep && inv.rows.find((r) => r.path === "/people/jane-doe").why.join() === "links" && !inv.rows.find((r) => r.path === "/unimportant").mustKeep && inv.counts.mustKeep === 11, JSON.stringify(inv.counts));
  check("map: same path needs no rule; extension/case differences are an automatic one-hop rule", row("/contact").method === "same" && row("/about-us.html").to === "/about-us" && row("/about-us.html").method === "normalized" && row("/about-us.html").approved === "auto", JSON.stringify([row("/contact"), row("/about-us.html")]));
  check("map: a URL the old site already redirected is mapped from its final destination, in one hop", row("/legacy-a").to === "/legacy-c" && row("/legacy-a").method === "exact", JSON.stringify(row("/legacy-a")));
  check("map: a guess by name similarity is marked for owner review, not approved", row("/old-cash-offer").method === "similarity" && row("/old-cash-offer").approved === "" && row("/old-cash-offer").to === "/services/cash-offer" && row("/old-cash-offer").score >= 0.5, JSON.stringify(row("/old-cash-offer")));
  check("map: nothing similar means NO TARGET, never the homepage", row("/people/jane-doe").to === "" && row("/people/jane-doe").flags.includes("NO TARGET") && map.summary.mustKeepWithoutTarget >= 1, JSON.stringify(row("/people/jane-doe")));
  check("map: an old URL pointed at the homepage is flagged and held back", row("/promo").flags.includes("HOMEPAGE") && row("/promo").approved === "" && map.summary.homepage === 1, JSON.stringify(row("/promo")));
  check("map: a chain in the map is collapsed to one hop", row("/sale-old").to === "/deals" && row("/sale-old").flags.some((f) => /CHAIN collapsed/.test(f)) && map.summary.chainsCollapsed === 1, JSON.stringify(row("/sale-old")));
  const red = fs.readFileSync(path.join(mdir, "_redirects"), "utf8");
  const act = red.split("\n").filter((l) => l && !l.startsWith("#"));
  const froms = new Set(act.map((l) => l.split(" ")[0])), tos = act.map((l) => l.split(" ")[1]);
  check("map: _redirects activates only approved rows, in Cloudflare Pages format, as 301", act.length === 4 && act.every((l) => /^\/\S+ \/\S+ 301$/.test(l)) && /# REVIEW \/old-cash-offer \/services\/cash-offer 301/.test(red) && /# NO TARGET \/people\/jane-doe/.test(red) && /# REVIEW \/promo \/ 301 \[HOMEPAGE\]/.test(red) && !act.some((l) => l.includes("old-cash-offer")), red);
  check("map: no active rule points at the homepage and no active rule points at another rule's source", !tos.includes("/") && tos.every((t) => !froms.has(t)), act.join(" | "));
  check("map: the existing _redirects of the new site is parsed (placeholder rules skipped, not guessed)", (() => { const p = G.parseRedirectsFile(fs.readFileSync(path.join(newDir, "_redirects"), "utf8")); return p.rules.length === 1 && p.rules[0].from === "/old-stuff" && p.skipped.length === 1; })(), "");
  const csv = fs.readFileSync(path.join(mdir, "redirect-map.csv"), "utf8");
  check("map: redirect-map.csv has the review columns and round-trips", csv.split("\n")[0].startsWith("from,to,status,method,score,approved") && G.parseCsv(csv).length === 13 && G.parseCsv(csv).find((r) => r.from === "/old-cash-offer").approved === "", csv.split("\n").slice(0, 3).join("\n"));
  const co = J(path.join(mdir, "carryover.json"));
  check("carry-over: a changed title on a page that ranks is flagged", co.rows.find((c) => c.from === "/about-us.html").flags.includes("title changed") && co.flagged >= 1, JSON.stringify(co.rows.map((c) => [c.from, c.flags])));

  // owner reviews the CSV: approve two guesses, point /people/jane-doe and /promo somewhere real, reject nothing
  const edit = G.parseCsv(csv).map((r) => ({ ...r, approved: ["/old-cash-offer", "/blog/2019/selling-tips"].includes(r.from) ? "yes" : r.from === "/people/jane-doe" ? "yes" : r.from === "/promo" ? "yes" : r.approved, to: r.from === "/people/jane-doe" ? "/about-us" : r.from === "/promo" ? "/deals" : r.to }));
  fs.writeFileSync(path.join(mdir, "redirect-map.csv"), [G.CSV_COLS.join(","), ...edit.map((r) => G.CSV_COLS.map((c) => G.csvLine([r[c]])).join(","))].join("\n") + "\n");
  await cli("migrate.mjs", [OLD, newDir, "--stage", "map", "--cwd", tmp, "--gsc-file", gscFile, "--links-csv", linksCsv, "--overrides", overrides, "--today", "2026-10-22"]);
  const red2 = fs.readFileSync(path.join(mdir, "_redirects"), "utf8"); const act2 = red2.split("\n").filter((l) => l && !l.startsWith("#"));
  const map2 = J(path.join(mdir, "redirect-map.json"));
  check("map: the owner's approvals and edits in the CSV survive a re-run and become active rules", act2.length === 8 && act2.includes("/old-cash-offer /services/cash-offer 301") && act2.includes("/people/jane-doe /about-us 301") && act2.includes("/promo /deals 301") && !map2.rows.find((r) => r.from === "/promo").flags.includes("HOMEPAGE"), act2.join(" | "));

  // ---- page-type synonyms, stemming and 410 candidates (the real valleytovalleyrealty.com -> proposals/vtv misses)
  const mkInv = (rowsIn) => ({ rows: rowsIn.map(([p, title, status = 200]) => ({ path: p, title, status, mustKeep: false, clicks: 0, impressions: 0, links: 0, sources: [] })) });
  const ns = { pages: new Map([["/", { title: "Valley Realty" }], ["/about", { title: "About Francine" }], ["/buy", { title: "Buy a home" }], ["/sell", { title: "Sell your home" }], ["/contact-us", { title: "Contact" }], ["/blog", { title: "Blog" }], ["/blog/what-we-love-about-living-in-dublin", { title: "Living in Dublin" }]]), redirects: { rules: [], skipped: [] } };
  const sm = G.buildRedirectMap(mkInv([["/sellers-guide", "Sellers Guide"], ["/buyers-guide", "Buyers Guide"], ["/agents/francine-masudi", "Francine Masudi"], ["/home-valuation", "Home Valuation"], ["/cash-offer", "Cash Offer"], ["/mortgage-calculator", "Mortgage Calculator"], ["/testimonials", "Testimonials"], ["/team", "Our Team"], ["/contact", "Contact"], ["/test", "Test"], ["/cash-offer-draft", "Cash offer"], ["/old-thing", "Page not found"], ["/gone-page", "Old", 404], ["/home-search/listings", "Listings"], ["/terms-and-conditions", "Terms and Conditions: about our site, meet the rules"]]), ns);
  const sr = (p) => sm.rows.find((r) => r.from === p);
  const want = { "/sellers-guide": "/sell", "/buyers-guide": "/buy", "/agents/francine-masudi": "/about", "/home-valuation": "/sell", "/cash-offer": "/sell", "/mortgage-calculator": "/buy", "/testimonials": "/about", "/team": "/about", "/contact": "/contact-us" };
  check("map: page-type synonyms and stemming suggest the obvious page (sellers-guide -> /sell, agents/... -> /about, mortgage -> /buy)", Object.entries(want).every(([f, t]) => sr(f).to === t && sr(f).method === "similarity"), JSON.stringify(Object.keys(want).map((f) => [f, sr(f).to, sr(f).score])));
  check("map: those guesses stay suggestions (needs review, not approved, not active in _redirects)", Object.keys(want).every((f) => sr(f).approved === "") && !G.emitRedirects(sm.rows).text.split("\n").some((l) => l && !l.startsWith("#") && Object.keys(want).some((f) => l.startsWith(f + " "))) && sm.summary.needsReview === 9, JSON.stringify(sm.summary));
  check("map: test and draft pages and 'not found' pages are 410 candidates with no redirect suggested", ["/test", "/cash-offer-draft", "/old-thing", "/gone-page"].every((p) => sr(p).gone === true && sr(p).to === "" && sr(p).flags.includes("410 CANDIDATE") && !sr(p).flags.includes("NO TARGET")) && sm.summary.gone410 === 4 && /# 410 CANDIDATE \(answer 410 Gone if the owner agrees\) \/test /.test(G.emitRedirects(sm.rows).text), JSON.stringify([sr("/test"), sm.summary]).slice(0, 400));
  check("map: a page type comes only from the old path and only points at a short top-level page (terms is not 'about', a blog post slug is not the about page)", sr("/terms-and-conditions").to === "" && sr("/terms-and-conditions").flags.includes("NO TARGET") && sm.rows.every((r) => r.to !== "/blog/what-we-love-about-living-in-dublin"), JSON.stringify(sr("/terms-and-conditions")));
  check("map: a page with no confident match is still NO TARGET (not a 410, not the homepage)", sr("/home-search/listings").flags.includes("NO TARGET") && !sr("/home-search/listings").gone && sr("/home-search/listings").to === "", JSON.stringify(sr("/home-search/listings")));

  // ---- gate against fixture servers
  let siteMode = "broken";
  const siteHits = [];
  const R301 = (res, to, code = 301) => { res.statusCode = code; res.setHeader("location", to); res.end(); };
  const site = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    siteHits.push(p);
    const ok = { "/": 1, "/about-us": 1, "/services/cash-offer": 1, "/contact": 1, "/blog/selling-tips": 1, "/legacy-c": 1, "/deals": 1 };
    if (siteMode === "ratelimit" && p === "/legacy-a") { res.statusCode = 429; return res.end("slow down"); }
    const redirects = { "/about-us.html": "/about-us", "/old-cash-offer": "/services/cash-offer", "/legacy-a": "/legacy-c" };
    if (siteMode === "broken") Object.assign(redirects, { "/blog/2019/selling-tips": "/tmp-hop", "/tmp-hop": "/blog/selling-tips", "/promo": "/", "/sale-mid": "/loop2", "/loop2": "/sale-mid" });
    else Object.assign(redirects, { "/blog/2019/selling-tips": "/blog/selling-tips", "/people/jane-doe": "/about-us", "/promo": "/deals", "/sale-old": "/deals", "/sale-mid": "/deals" });
    if (siteMode === "ratelimit") Object.assign(redirects, { "/blog/2019/selling-tips": "/blog/selling-tips" });
    if (p === "/sale-old" && siteMode === "broken") return R301(res, "/deals", 302);
    if (redirects[p]) return R301(res, redirects[p]);
    if (ok[p]) { res.statusCode = 200; res.setHeader("content-type", "text/html"); return res.end("<html><title>ok</title></html>"); }
    res.statusCode = 404; res.end("nope");
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const gate1run = await cli("migrate.mjs", [OLD, newDir, "--stage", "gate", "--new-origin", origin, "--gap-ms", "0", "--cwd", tmp, "--today", "2026-10-22"]);
  const gate1 = J(path.join(mdir, "gate-2026-10-22.json"));
  const gv = (p) => gate1?.rows.find((r) => r.path === p);
  check("gate: a chain of two hops fails", gate1run.status === 1 && gv("/blog/2019/selling-tips")?.verdict === "FAIL" && /chain of 2 hops/.test(gv("/blog/2019/selling-tips").fails.join()), JSON.stringify(gv("/blog/2019/selling-tips")));
  check("gate: a redirect to the homepage fails", gv("/promo")?.verdict === "FAIL" && /homepage/.test(gv("/promo").fails.join()), JSON.stringify(gv("/promo")));
  check("gate: a temporary redirect (302), a 404 and a loop fail", /temporary redirect \(302\)/.test(gv("/sale-old")?.fails.join()) && /ends at 404/.test(gv("/people/jane-doe")?.fails.join()) && /loop/.test(gv("/sale-mid")?.fails.join()), JSON.stringify([gv("/sale-old"), gv("/people/jane-doe"), gv("/sale-mid")]));
  check("gate: one-hop 301 to a 200 and a direct 200 pass; the summary adds up", ["/", "/about-us.html", "/old-cash-offer", "/legacy-a", "/contact", "/services/cash-offer"].every((p) => gv(p)?.verdict === "PASS") && gate1.summary.pass === 6 && gate1.summary.fail === 5 && gate1.passed === false, JSON.stringify(gate1?.summary));
  check("gate: only mustKeep URLs are requested (the 11 with traffic or links)", gate1.summary.checked === 11 && !gate1.rows.some((r) => r.path === "/unimportant" || r.path === "/ghost-page"), "");
  siteHits.length = 0;
  const gx = await cli("migrate.mjs", [OLD, newDir, "--stage", "gate", "--new-origin", origin, "--gap-ms", "0", "--cwd", tmp, "--today", "2026-10-25", "--exclude", "^/legacy", "--exclude", "^/people/"]);
  const gateX = J(path.join(mdir, "gate-2026-10-25.json"));
  check("gate: --exclude keeps off-limits addresses out of every request (listed as not checked, never fetched)", gx.status === 1 && gateX.excluded.join() === "/legacy-a,/people/jane-doe" && !siteHits.some((p) => /^\/(legacy|people)/.test(p)) && gateX.summary.checked === 9 && !gateX.rows.some((r) => r.path === "/legacy-a") && /2 off-limits/.test(fs.readFileSync(path.join(mdir, "gate-2026-10-25.md"), "utf8")), JSON.stringify([gx.status, gateX?.excluded, siteHits.filter((p) => /legacy|people/.test(p)), gateX?.summary]));
  siteMode = "fixed";
  const g2 = await cli("migrate.mjs", [OLD, newDir, "--stage", "gate", "--new-origin", origin, "--gap-ms", "0", "--cwd", tmp, "--today", "2026-10-23"]);
  const gate2 = J(path.join(mdir, "gate-2026-10-23.json"));
  check("gate: when every old URL with traffic or links reaches a 200 in one 301 hop the gate passes (exit 0)", g2.status === 0 && gate2.passed === true && gate2.summary.pass === 11, g2.stdout.slice(-400) + JSON.stringify(gate2?.summary));
  siteMode = "ratelimit";
  const g3m = await cli("migrate.mjs", [OLD, newDir, "--stage", "gate", "--new-origin", origin, "--gap-ms", "0", "--cwd", tmp, "--today", "2026-10-24"]);
  const gate3 = J(path.join(mdir, "gate-2026-10-24.json"));
  check("gate: a 429 stops the run (exit 3), nothing after it is requested, the rest is reported not checked", g3m.status === 3 && gate3.stopped429 && gate3.notChecked > 0 && gate3.passed === false && !gate3.rows.some((r) => r.path === "/old-cash-offer"), g3m.stdout + JSON.stringify(gate3?.summary));
  siteMode = "fixed";

  // ---- baseline and monitor
  const b0 = await G.runMigrate(OLD, newDir, { cwd: tmp, stage: "baseline", today: "2026-10-22", log: () => {}, gapMs: 0, probeOld: true, fetchImpl: (u, o) => fetch(u.replace("https://old.example", origin), o) });
  check("baseline: with no measure run, rankings / AI / authority / CrUX are BLOCKED with the step that unblocks them", ["rankings", "ai", "authority", "crux", "searchConsole"].every((k) => b0.baseline.parts[k].status === "blocked" && b0.baseline.parts[k].blocked.unblock) && b0.baseline.pages.length === 11, JSON.stringify(b0.baseline.parts).slice(0, 300));
  check("baseline: old statuses probed once per mustKeep URL (--probe-old) and traffic carried per page", b0.baseline.oldProbes.length === 11 && b0.baseline.pages.find((p) => p.path === "/about-us.html").clicks === 15 && b0.baseline.pageWindowDays === 90 && b0.baseline.pages.find((p) => p.path === "/about-us.html").newPath === "/about-us", JSON.stringify(b0.baseline.oldProbes?.slice(0, 2)));
  const mdirFake = path.join(oldLoc.pewp, "measure", "2026-11-02");
  const pg = (p, c, i) => ({ keys: ["https://old.example" + p], clicks: c, impressions: i });
  w(path.join(mdirFake, "gsc.json"), { status: "ok", windows: { current: { start: "2026-10-05", end: "2026-11-01" }, previous: { start: "2026-09-07", end: "2026-10-04" } }, totals: { current: { clicks: 40 } }, provenance: [], tables: { current: { page: [pg("/", 30, 300), pg("/about-us", 0, 0), pg("/services/cash-offer", 6, 90), pg("/deals", 5, 40)], queryPage: [] }, previous: { page: [] } } });
  const mon = await G.runMigrate(OLD, newDir, { cwd: tmp, stage: "monitor", today: "2026-11-02", cutover: "2026-10-30", log: () => {} });
  const mj = J(path.join(mdir, "monitor-2026-11-02.json"));
  check("monitor: 28 days after the cutover, a baselined page that lost its clicks (below the Poisson interval) is listed, healthy pages are not", mj?.status === "ok" && mj.dayOfMonitoring === 4 && mj.monitoringEndsOn === "2026-11-27" && mj.droppedPages.some((d) => d.oldPath === "/about-us.html" && d.newPath === "/about-us") && !mj.droppedPages.some((d) => d.oldPath === "/") && mj.pagesNotSeenAtAll.some((d) => d.oldPath === "/about-us.html"), JSON.stringify(mj).slice(0, 500));
  const mrep = fs.readFileSync(path.join(mdir, "report.md"), "utf8");
  check("migrate report: plain words, a redirect is explained, one-line answer first", /^# Moving https:\/\/old\.example\/ to /.test(mrep) && /\*\*[^*]+\*\*/.test(mrep) && /301/.test(mrep), mrep.slice(0, 400));

  // ================================================================ local
  const L = await imp("local-lib.mjs"), LP = await imp("local-profile.mjs"), LK = await imp("local-pack.mjs"), LN = await imp("local-nap.mjs"), LR = await imp("local-reviews.mjs");
  check("nap: phone numbers match after normalisation (country code, punctuation, extension)", L.normPhone("+1 (209) 555-0100") === L.normPhone("209.555.0100 x12") && L.normPhone("209-555-0100") === "2095550100" && L.normPhone("12") === "", `${L.normPhone("+1 (209) 555-0100")} ${L.normPhone("209.555.0100 x12")}`);
  check("nap: address and name normalisation (street suffix, suite, #, legal suffix, ZIP+4)", L.normAddress("123 Main Street, Suite 4, Tracy, CA 95376-1234") === L.normAddress("123 Main St #4 Tracy CA 95376") && L.normName("Valley to Valley Realty, Inc.") === L.normName("VALLEY TO VALLEY REALTY"), `${L.normAddress("123 Main Street, Suite 4, Tracy, CA 95376-1234")} | ${L.normAddress("123 Main St #4 Tracy CA 95376")}`);
  const napPath = J(path.join(pewp, "local", "2026-09-20", "nap.json"));
  check("nap: JSON-LD name, tel link and JSON-LD phone on the site are compared with business.json", napPath.site.pages === 3 && napPath.site.issues.some((i) => i.page === "/contact.html" && i.field === "phone" && i.where === "tel: link") && napPath.site.issues.some((i) => i.page === "/about.html" && i.field === "name") && !napPath.site.issues.some((i) => i.page === "/index.html" && !i.lowConfidence) && napPath.site.issues.some((i) => i.lowConfidence && /tracking/.test(i.note)), JSON.stringify(napPath.site.issues));
  check("nap: citations that differ are listed with the field, the others are consistent", napPath.mismatches.map((m) => m.directory).sort().join() === "bbb.org,facebook.com" && napPath.mismatches.find((m) => m.directory === "bbb.org").fields.join() === "address" && napPath.consistentDirectories.join() === "yelp.com", JSON.stringify(napPath.mismatches.map((m) => [m.directory, m.fields])));
  check("nap: directories of the (built-in, UNVERIFIED) citation list with no listing are reported", napPath.missingDirectories.includes("zillow.com") && napPath.missingDirectories.includes("mapquest.com") && !napPath.missingDirectories.includes("yelp.com") && /UNVERIFIED/.test(napPath.citationSourcesNote), JSON.stringify(napPath.missingDirectories));
  const nb = LN.runNap({ business: { name: "X" }, siteDir: null, citations: null });
  check("nap: business.json without address and phone is BLOCKED, not guessed", nb.status === "blocked" && /address, phone/.test(nb.blocked.reason) && nb.blocked.unblock, JSON.stringify(nb));
  const apiExport = { exportedAt: "2026-10-20", location: { title: "Valley to Valley Realty", categories: { primaryCategory: { displayName: "Real estate agent" }, additionalCategories: [] }, storefrontAddress: { addressLines: ["123 Main St"], locality: "Tracy", administrativeArea: "CA", postalCode: "95376" }, phoneNumbers: { primaryPhone: "(209) 555-0100" }, websiteUri: "https://mysite.example/" },
    reviews: { totalReviewCount: 30, averageRating: 4.6, reviews: [{ starRating: "FIVE", createTime: "2026-05-01T00:00:00Z", reviewReply: { comment: "thanks" } }, { starRating: "FIVE", createTime: "2026-06-01T00:00:00Z" }, { starRating: "FOUR", createTime: "2026-06-15T00:00:00Z" }] }, localPosts: { localPosts: [] }, media: { totalMediaItemCount: 8 } };
  const prof = LP.importProfile(apiExport, { file: "export.json" });
  check("profile: the owner's API export is read (categories, address, reviews, reply rate, last review, posts in 90 days)", prof.ok && prof.primaryCategory === "Real estate agent" && prof.reviews.count === 30 && Math.abs(prof.reviews.ownerReplyRate - 1 / 3) < 0.01 && prof.reviews.lastReviewDate === "2026-06-15" && prof.postsLast90d === 0 && prof.photosCount === 8 && prof.address.includes("Tracy"), JSON.stringify(prof));
  check("profile: an undated export or manual capture is BLOCKED (no date, no evidence)", LP.importProfile({ location: { title: "x" } }).blocked && LP.importProfile({ kind: "manual-capture", name: "x" }).blocked && LP.importProfile(null).blocked, "");
  const aud = LP.auditProfile(prof, [], { now: new Date("2026-10-22") });
  check("profile: absolute findings (no secondary categories, no services, no posts, unanswered reviews, stale reviews); competitor comparisons BLOCKED without captures", ["LOC-P02", "LOC-P03", "LOC-P07", "LOC-P08", "LOC-P09"].every((id) => aud.findings.some((f) => f.id === id)) && aud.blocked.length === 1 && aud.blocked[0].unblock, aud.findings.map((f) => f.id).join());
  const comp = [{ name: "Maple", primaryCategory: "Real estate agent", secondaryCategories: ["Real estate consultant"], rating: 4.9, reviewCount: 245, photosCount: 80, capturedAt: "2026-10-18", file: "c1.json" }, { name: "Frank", primaryCategory: "Real estate consultant", secondaryCategories: [], rating: 4.8, reviewCount: 61, photosCount: 30, capturedAt: "2026-10-18", file: "c2.json" }];
  const aud2 = LP.auditProfile(prof, comp, { now: new Date("2026-10-22") });
  check("profile: with competitor captures the categories, photos, reviews and rating are compared with sourced numbers", ["LOC-P10", "LOC-P11", "LOC-P12"].every((id) => aud2.findings.some((f) => f.id === id)) && aud2.findings.find((f) => f.id === "LOC-P12").evidence.competitorMedian.value === 153 && aud2.findings.find((f) => f.id === "LOC-P12").evidence.competitorMedian.source.includes("owner browser captures"), JSON.stringify(aud2.findings.find((f) => f.id === "LOC-P12")));
  // ---- a manual capture's unread fields (SKILL-PROFILE-1): null or a key left out is NOT READ, never a finding
  const man = (o) => LP.importProfile({ kind: "manual-capture", capturedAt: "2026-10-20", name: "Sample Lender", primaryCategory: "Loan agency", ...o }, { file: "profile.json" });
  const fids = (a) => a.findings.map((f) => f.id), bids = (a) => a.blocked.map((b) => b.id), d22 = { now: new Date("2026-10-22") };
  const mNull = man({ secondaryCategories: null, services: null, description: null }), mGone = man({}), mEmpty = man({ secondaryCategories: [], services: [], description: "" });
  const aNull = LP.auditProfile(mNull, [], d22), aGone = LP.auditProfile(mGone, [], d22), aEmpty = LP.auditProfile(mEmpty, [], d22);
  check("profile: a manual capture's unread fields (null, or the key left out) stay not read at import: secondary categories, services and description are null, not an empty list", mNull.ok && [mNull, mGone].every((m) => m.secondaryCategories === null && m.services === null && m.description === null), JSON.stringify([mNull.secondaryCategories, mNull.services, mNull.description, mGone.secondaryCategories, mGone.services, mGone.description]));
  check("profile: a field that was not read is never a finding: LOC-P02, LOC-P03 and LOC-P04 are BLOCKED checks, each with a reason that says not read and with what unblocks it", ["LOC-P02", "LOC-P03", "LOC-P04"].every((id) => !fids(aNull).includes(id) && !fids(aGone).includes(id) && aNull.blocked.some((b) => b.id === id && /not read/.test(b.reason) && b.unblock) && bids(aGone).includes(id)), `${fids(aNull).join()} | ${bids(aNull).join()}`);
  check("profile: a field read and found empty (an empty list, an empty text) is the finding, not a BLOCKED check", mEmpty.description === "" && ["LOC-P02", "LOC-P03", "LOC-P04"].every((id) => fids(aEmpty).includes(id) && !bids(aEmpty).includes(id)), `${JSON.stringify(mEmpty.description)} | ${fids(aEmpty).join()} | ${bids(aEmpty).join()}`);
  let aCmp = null, aCmpErr = ""; try { aCmp = LP.auditProfile(mNull, comp, d22); } catch (e) { aCmpErr = e.message; }
  const aCmpEmpty = LP.auditProfile(mEmpty, comp, d22);
  check("profile: with competitor captures and our secondary categories not read, the category comparison LOC-P10 is a BLOCKED check (never a list of every competitor category) and nothing throws; read and empty, it is compared", !!aCmp && !fids(aCmp).includes("LOC-P10") && bids(aCmp).includes("LOC-P10") && fids(aCmpEmpty).includes("LOC-P10") && !bids(aCmpEmpty).includes("LOC-P10"), aCmpErr || `${fids(aCmp).join()} | ${bids(aCmp).join()}`);
  check("profile: the owner's API export is complete, so what it does not hold is absent: no description gives LOC-P04 and no not-read check", prof.description === "" && fids(aud).includes("LOC-P04") && aud.blocked.length === 1, `${JSON.stringify(prof.description)} | ${fids(aud).join()} | ${bids(aud).join()}`);
  const packDir = path.join(tmp, "pack");
  const pk = (n, o) => w(path.join(packDir, n), { language: "en", capturedIn: "owner phone, signed out", ...o });
  const pack3 = (ours) => [{ position: 1, name: "Maple Home Buyers", rating: 4.9, reviews: 245 }, { position: 2, name: "Frank Buys Houses", rating: 4.8, reviews: 120 }, ours ? { position: 3, name: "Valley to Valley Realty", rating: 4.6, reviews: 30 } : { position: 3, name: "Kind Path", rating: 4.7, reviews: 61 }];
  pk("a.json", { query: "we buy houses tracy ca", city: "Tracy, CA", location: "Tracy, CA", locationShown: "Tracy, CA", device: "mobile", capturedAt: "2026-10-10T10:00:00Z", pack: pack3(false) });
  pk("a-old.json", { query: "we buy houses tracy ca", city: "Tracy, CA", location: "Tracy, CA", locationShown: "Tracy, CA", device: "mobile", capturedAt: "2026-09-10T10:00:00Z", pack: pack3(true) });
  pk("b.json", { query: "realtor tracy ca", city: "Tracy, CA", location: "Tracy, CA", locationShown: "Tracy, CA", device: "desktop", capturedAt: "2026-10-10T10:05:00Z", pack: pack3(true) });
  pk("c.json", { query: "we buy houses manteca ca", city: "Manteca, CA", location: "Manteca, CA", locationShown: "Kafr Tohormos, Egypt", device: "mobile", capturedAt: "2026-10-10T10:10:00Z", pack: pack3(false) });
  pk("d.json", { query: "we buy houses livermore ca", city: "Livermore, CA", location: "Livermore, CA", device: undefined, capturedAt: "2026-10-10T10:15:00Z", pack: pack3(false) });
  const pr = LK.importPackCaptures(packDir, { name: "Valley to Valley Realty", domain: "mysite.example", phone: "209-555-0100" });
  const prow = (q) => pr.rows.find((r) => r.query === q);
  check("local pack: our position per query, city and device; the newest capture of the same key wins", prow("we buy houses tracy ca").inPack === false && prow("we buy houses tracy ca").position.value === null && prow("realtor tracy ca").position.value === 3 && pr.superseded.length === 1, JSON.stringify(pr.summary));
  check("local pack: a capture whose page showed another place is kept under that place, localized false, and not counted for the city", prow("we buy houses manteca ca").localized === false && prow("we buy houses manteca ca").location.includes("Egypt") && pr.summary.localized === 2 && !pr.summary.cities.includes("Manteca, CA"), JSON.stringify(pr.summary));
  check("local pack: a capture without a device is rejected", pr.rejected.some((x) => /device/.test(x.reason)), JSON.stringify(pr.rejected));
  const gap = LR.reviewGap(prof, pr.rows);
  const gt = gap.rows.find((r) => r.query === "we buy houses tracy ca");
  check("reviews: the gap to the 3rd place in the pack is computed from localized captures only, with sourced numbers", gap.status === "ok" && gap.rows.length === 2 && gap.excluded.length === 1 && gt.packThirdPlaceReviews.value === 61 && gt.ourReviews.value === 30 && gt.reviewGapToThird.value === 31 && gt.reviewGapToThird.source.includes("owner browser capture") && /one factor/.test(gt.note), JSON.stringify(gt).slice(0, 400));
  check("reviews: without our profile or without captures the part is BLOCKED", LR.reviewGap(null, pr.rows).status === "blocked" && LR.reviewGap(prof, []).status === "blocked", "");

  // ================================================================ script pass 2026-10-23: start-up, input and exit-code hardening
  // started through a junction (a linked skill folder) every CLI must still run: no arguments = its usage line and exit 2. The old exact
  // path compare skipped the CLI and exited 0 with no output, which a caller reads as success.
  const jx = path.join(tmp, "jx-scripts"); fs.symlinkSync(dir, jx, "junction");
  const viaJx = [];
  for (const f of ["measure.mjs", "migrate.mjs", "local-run.mjs", "local-grid.mjs", "local-nap.mjs", "local-pack.mjs", "local-profile.mjs", "local-reviews.mjs"]) { const r = await spawnP(process.execPath, [path.join(jx, f)], { cwd: tmp, env: cleanEnv }); viaJx.push({ f, status: r.status, usage: /usage: node /.test(r.stderr) }); }
  check("junction: started through a junction every measure / migrate / local CLI still runs (usage, exit 2), none exits 0 silently", viaJx.every((x) => x.status === 2 && x.usage), JSON.stringify(viaJx.filter((x) => !(x.status === 2 && x.usage))));
  fs.rmSync(jx, { recursive: true, force: true }); // the link only
  // a capture or export saved with a BOM is read, not silently dropped
  const bomDir = path.join(tmp, "bom-captures");
  w(path.join(bomDir, "one.json"), "\uFEFF" + JSON.stringify({ query: "we buy houses tracy ca", engine: "google", location: "Tracy, CA", device: "mobile", language: "en", capturedAt: "2026-10-01T10:00:00Z", organic: [] }));
  check("captures: a capture file saved with a BOM (Notepad, PowerShell 5.1) is read, not silently dropped", S.loadCaptures(bomDir).length === 1 && S.readJson(path.join(bomDir, "one.json"))?.query === "we buy houses tracy ca", JSON.stringify(S.loadCaptures(bomDir)).slice(0, 200));
  // one odd address must not stop a whole run
  let telOk = null; try { telOk = S.htmlInfo('<a href="tel:209-555-0100%">call</a>').tel; } catch (e) { telOk = e.message; }
  check("html: a tel: link with a stray % is read, not a crash (NAP check)", Array.isArray(telOk) && telOk[0] === "209-555-0100%", JSON.stringify(telOk));
  let pctMap = null;
  try { const inv = { rows: [{ path: "/50%-off-sale", mustKeep: true, clicks: 3, impressions: 40, links: 0, title: "50% off sale", status: 200 }, { path: "/", mustKeep: true, clicks: 9, impressions: 90, links: 0, title: "Home", status: 200 }] }; const ns = { pages: new Map([["/", { title: "Home" }], ["/sale", { title: "Sale" }]]), redirects: { rules: [], skipped: [] } }; const m = G.buildRedirectMap(inv, ns); pctMap = { rows: m.rows.length, emitted: G.emitRedirects(m.rows, { includeSuggestions: true }).text.includes("50%25-off-sale") || m.rows.some((r) => r.from === "/50%-off-sale") }; } catch (e) { pctMap = e.message; }
  check("map: an old address with a stray % (/50%-off-sale) is mapped like the others, not a URIError that stops the map stage", pctMap?.rows === 2 && pctMap.emitted === true, JSON.stringify(pctMap));
  // migrate: a typo is a usage error, never a run on NaN or on no stage at all
  const pc = (extra) => G.parseCli(["https://old.example/", "new", ...extra]).error || "";
  const pcs = { stage: pc(["--stage", "gates"]), maxUrls: pc(["--max-urls", "abc"]), gap: pc(["--gap-ms", "-5"]), today: pc(["--today", "2026-02-30"]), cutover: pc(["--cutover", "soon"]), exclude: pc(["--exclude", "(open"]), ok: pc(["--stage", "gate", "--max-urls", "50", "--gap-ms", "1000", "--today", "2026-10-23"]) };
  check("migrate CLI: an unknown --stage, --max-urls abc, a negative --gap-ms, an impossible --today / --cutover and a broken --exclude regex are usage errors; good options parse", /--stage must be one of/.test(pcs.stage) && /--max-urls/.test(pcs.maxUrls) && /--gap-ms/.test(pcs.gap) && /--today must be a real day/.test(pcs.today) && /--cutover/.test(pcs.cutover) && /not a valid regular expression/.test(pcs.exclude) && pcs.ok === "", JSON.stringify(pcs));
  // politeness: below 1000 ms only when every site the run requests is on this machine (the old live site by --probe-old /
  // --fetch-sitemap, the new one by the gate when it is a URL); "--gap-ms abc" stays a usage error
  const pol = { probeOld: pc(["--stage", "baseline", "--probe-old", "--gap-ms", "10"]), sitemap: pc(["--stage", "inventory", "--fetch-sitemap", "--gap-ms", "999"]),
    remoteNew: pc(["--stage", "gate", "--new-origin", "https://new.example/", "--gap-ms", "0"]), nan: pc(["--gap-ms", "abc"]),
    localGate: pc(["--stage", "gate", "--new-origin", "http://127.0.0.1:9/", "--gap-ms", "0"]), oldUntouched: pc(["--stage", "map", "--gap-ms", "0"]), owner: pc(["--stage", "baseline", "--probe-old", "--gap-ms", "1000"]) };
  check("migrate CLI: --gap-ms below 1000 to a site this machine does not serve (old site by --probe-old / --fetch-sitemap, a remote new origin) is a usage error; local or untouched sites may use 0", [pol.probeOld, pol.sitemap, pol.remoteNew].every((e) => /polite minimum of 1000 ms/.test(e)) && /--gap-ms must be/.test(pol.nan) && pol.localGate === "" && pol.oldUntouched === "" && pol.owner === "", JSON.stringify(pol));
  const badStage = await cli("migrate.mjs", ["https://old.example/", path.join(tmp, "new-site"), "--stage", "gates", "--cwd", tmp]);
  check("migrate CLI: --stage gates (a typo) exits 2 and runs nothing (it exited 0 having run no stage)", badStage.status === 2 && /--stage must be one of/.test(badStage.stderr), `exit ${badStage.status} ${badStage.stderr.slice(0, 200)}`);
  // the redirect gate with nothing to check proved nothing: not a pass
  const gEmpty = await G.runGate({ inv: { rows: [{ path: "/x", mustKeep: false }] }, map: null, newOrigin: "http://127.0.0.1:9/", gapMs: 0, fetchImpl: () => { throw new Error("must not be called"); } });
  check("gate: with no old address to check (empty inventory) the gate is NOT passed and says why", gEmpty.passed === false && /no old address to check/.test(gEmpty.nothingToCheck || "") && gEmpty.summary.checked === 0, JSON.stringify({ passed: gEmpty.passed, why: gEmpty.nothingToCheck }));
  // measure / local: an impossible --today is a usage error (it crashed later with a RangeError, exit 1)
  const td = [];
  for (const [f, a] of [["measure.mjs", [URL_, "--today", "2026-13-01", "--cwd", tmp]], ["local-run.mjs", [URL_, "--today", "2026-02-30", "--cwd", tmp]], ["local-grid.mjs", ["import", URL_, "--today", "tomorrow", "--cwd", tmp]]]) { const r = await cli(f, a); td.push({ f, status: r.status, said: /--today must be a real day/.test(r.stderr) }); }
  check("today: measure, local-run and local-grid refuse an impossible --today with exit 2 before doing anything", td.every((x) => x.status === 2 && x.said), JSON.stringify(td));

  // ================================================================ cache / structure
  const stageDocs =["measure.md", "migrate.md", "local.md"].map((f) => path.join(skill, "stages", f));
  const sizes = stageDocs.map((f) => (fs.existsSync(f) ? Math.round(fs.statSync(f).size / 4) : 0));
  check("stages: measure.md, migrate.md and local.md exist and are 2,000 to 8,000 tokens (bytes / 4)", sizes.every((n) => n >= 2000 && n <= 8000), `approx tokens ${sizes.join(", ")}`);
  check("files: run.mjs template exists and every script parses", fs.existsSync(path.join(skill, "measure", "run.mjs")) && ["measure.mjs", "measure-sources.mjs", "migrate.mjs", "local-lib.mjs", "local-profile.mjs", "local-pack.mjs", "local-nap.mjs", "local-reviews.mjs", "local-run.mjs"].every((f) => spawnSync(process.execPath, ["--check", path.join(dir, f)], { timeout: 60000 }).status === 0), "");
  api.close(); site.close();
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((f) => f.name).join(" | ") : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
