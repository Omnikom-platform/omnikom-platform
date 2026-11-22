// Usage: node test-client-profile.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of client-profile.mjs (AB-4): the pool of everything the stations gathered into {pewp}/profile.json, and the internal sheet of what was not gathered
// ({pewp}/internal/not-gathered.json and .md, never shown to a client). The real script runs as a child process on an invented run folder: a small invented
// manifest of four stations (the last one holds the client-profile step), a run log, a sheet made by the real lib-stations.mjs, rulings and a few research files.
// No network (netguard-import.mjs refuses every non-local request), no browser, no model. Mutants: a patch to a copy of the scripts folder must turn the named case red.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { checker, main, runner, mkTmp, rmTmp, walk } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SKILL = path.resolve(here, "..");
const PIPE = path.join(SKILL, "pipeline.json");
const NOW = "2026-11-22T10:00:00.000Z";
const T0 = Date.parse("2026-11-22T09:00:00.000Z");   // the run log's updatedAt
const norm = (p) => String(p).replace(/\\/g, "/");

const STATIONS = [["alpha", "the first block"], ["beta", "the second block"], ["gamma", "the third block"], ["report", "the report block"]];
const STEPS = [["alpha", "s-a1"], ["alpha", "s-a2"], ["beta", "s-b1"], ["gamma", "s-g1"], ["report", "client-profile"], ["report", "rep-one"]];
const MANIFEST = { stations: STATIONS.map(([id, what]) => ({ id, what })), steps: STEPS.map(([station, id]) => ({
  id, station, what: "what " + id + " does", needsPerson: false,
  outputs: id === "s-g1" ? ["{pewp}/research/", "{runDir}/snapshots/*/_site.json"] : id === "client-profile" ? ["{pewp}/profile.json", "{pewp}/internal/not-gathered.md"] : ["{pewp}/out/" + id + ".json"],
})) };

async function scenarios(dir) {
  const results = [], check = checker(results);
  let lib;
  try { lib = await import(pathToFileURL(path.join(dir, "lib-stations.mjs")).href + "?" + Math.random()); }
  catch (e) { check("0: lib-stations.mjs loads", false, e.message); return results; }
  const root = mkTmp("cprofile"), skill = path.join(root, "skill"), home = path.join(root, "home");
  try {
    fs.cpSync(dir, path.join(skill, "scripts"), { recursive: true });   // the script finds its manifest one folder above scripts/
    fs.writeFileSync(path.join(skill, "pipeline.json"), JSON.stringify(MANIFEST, null, 1));
    fs.mkdirSync(home, { recursive: true });
    const exec = runner(path.join(skill, "scripts"), home, path.join(root, "net.log"));
    let n = 0;
    check("0: client-profile.mjs exists next to the other scripts", fs.existsSync(path.join(dir, "client-profile.mjs")), "the script is not there yet");

    // a run folder: spec = { stepId: { state, line, rule, files: [{ name, body }], missing: [name], evidence: [names in the order the log keeps them] } }; a step with no entry was not run
    const mk = (spec, o = {}) => {
      const key = o.key || "https://client.test/", host = key.startsWith("profile:") ? key.slice(8) : "client.test";
      const data = path.join(root, "d" + ++n), pewp = path.join(data, "site-checks", host, ".pewp");
      fs.mkdirSync(pewp, { recursive: true });
      const entries = [];
      for (const [id, s] of Object.entries(spec)) {
        const files = s.files || [];
        for (const f of files) { fs.mkdirSync(path.dirname(path.join(pewp, f.name)), { recursive: true }); fs.writeFileSync(path.join(pewp, f.name), typeof f.body === "string" ? f.body : JSON.stringify(f.body)); }
        const names = s.evidence || [...files.map((f) => f.name), ...(s.missing || [])];
        entries.push({ id, state: s.state || "RUN", line: s.line ?? "ok", exit: s.exit ?? 0, ...(s.rule ? { rule: s.rule } : {}), evidence: names.map((x) => norm(path.join(pewp, x))), evidenceCount: names.length });
      }
      const rows = MANIFEST.steps.map((st) => { const e = entries.find((x) => x.id === st.id);
        return !e ? { id: st.id, state: "NOT RUN", detail: "not run yet" } : { id: st.id, state: e.state, detail: e.state === "RUN" ? e.evidence[0] : "exit " + e.exit + ": " + e.line, ...(e.rule ? { rule: e.rule } : {}) }; });
      let rulings = {};
      for (const [id, why] of Object.entries(o.rulings || {})) rulings = lib.ruleStep(MANIFEST, rows, rulings, { step: id, why, by: "agent", now: NOW });
      const sheet = lib.buildSheet(MANIFEST, rows, rulings, o.sheetStation ? { station: o.sheetStation } : {});
      if (!o.noRun) fs.writeFileSync(path.join(pewp, "seo-run.json"), JSON.stringify({ version: 1, updatedAt: new Date(T0).toISOString(), steps: entries }));
      fs.mkdirSync(path.join(pewp, "stations"), { recursive: true });
      if (!o.noSheet) { const sf = path.join(pewp, "stations", "sheet.json"); fs.writeFileSync(sf, JSON.stringify(sheet)); const t = new Date(T0 + (o.sheetOffsetMs ?? 60000)); fs.utimesSync(sf, t, t); }
      if (Object.keys(rulings).length) fs.writeFileSync(path.join(pewp, "stations", "rulings.json"), JSON.stringify(rulings));
      return { key, data, pewp, rows, sheet, host };
    };
    const go = async (m, extra = []) => { const r = await exec("client-profile.mjs", [m.key, "--cwd", m.data, ...extra]); return { ...r, last: r.out.trim().split(/\r?\n/).pop() }; };
    const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
    const prof = (m) => readJ(path.join(m.pewp, "profile.json"));
    const intJ = (m) => readJ(path.join(m.pewp, "internal", "not-gathered.json"));
    const intMd = (m) => { try { return fs.readFileSync(path.join(m.pewp, "internal", "not-gathered.md"), "utf8"); } catch { return null; } };
    const stepOf = (p, id) => (p && p.stations ? p.stations.flatMap((s) => s.steps) : []).find((x) => x.id === id) || {};
    const nothing = (m) => !fs.existsSync(path.join(m.pewp, "profile.json")) && !fs.existsSync(path.join(m.pewp, "internal"));
    const RUNS = (extra = {}) => ({ "s-a1": { files: [{ name: "research/a.json", body: { status: "ok", summary: { rows: 3 }, rows: ["SECRET-ROW-VALUE"] } }] }, "s-a2": { files: [{ name: "research/b.json", body: {} }] },
      "s-b1": { files: [{ name: "research/c.json", body: { summary: { hits: 2 } } }] }, "s-g1": { files: [{ name: "research/d.json", body: { status: "done" } }] }, "rep-one": { files: [{ name: "report.json", body: { status: "ok" } }] }, ...extra });
    const BL = "BLOCKED: no key | unblocks: set the key";

    // 1. every step RUN
    { const m = mk(RUNS()), before = walk(m.data).map(norm), r = await go(m), p = prof(m), i = intJ(m), md = intMd(m), a = stepOf(p, "s-a1"), after = walk(m.data).map(norm).filter((f) => !before.includes(f)).sort();
      check("1: every step RUN: exit 0 and the PROFILE line", r.code === 0 && r.last === "PROFILE: 4 gathered, 0 not gathered (0 ruled), 0 not applicable", r.out);
      check("1: the profile holds step, key, host, the three stations that gather, in order, and the counts", p && p.step === "client-profile" && p.key === "https://client.test/" && p.host === "client.test" && !Number.isNaN(Date.parse(p.generatedAt)) && p.stations.map((s) => s.id).join() === "alpha,beta,gamma" && p.stations[0].what === "the first block" && p.stations[0].verdict === "CLOSED"
        && JSON.stringify(p.counts) === JSON.stringify({ steps: 4, gathered: 4, notGathered: 0, ruled: 0, notApplicable: 0 }) && Array.isArray(p.notGathered) && p.notGathered.length === 0, JSON.stringify(p && p.counts));
      check("1: a step is under its station with bucket, files, the file's status and summary, no why and no ruling; the report station (the profile's own, with rep-one) is in no part of it", a.state === "RUN" && a.bucket === "gathered" && a.partial === false && a.why === null && a.ruling === null && a.what === "what s-a1 does" && a.fileCount === 1 && a.files.length === 1 && a.files[0].path === "research/a.json"
        && a.files[0].bytes === fs.statSync(path.join(m.pewp, "research", "a.json")).size && !Number.isNaN(Date.parse(a.files[0].modified)) && a.files[0].status === "ok" && JSON.stringify(a.files[0].summary) === '{"rows":3}' && !stepOf(p, "client-profile").id && !stepOf(p, "rep-one").id && !JSON.stringify(p).includes("rep-one") && !JSON.stringify(p).includes("report"), JSON.stringify(a));
      check("1: no row of a research file is copied into the profile", p && !JSON.stringify(p).includes("SECRET-ROW-VALUE"), "a row was copied");
      check("1: the internal sheet has no row; the run wrote only profile.json and internal/not-gathered.json and .md", i && i.rows.length === 0 && i.key === "https://client.test/" && !Number.isNaN(Date.parse(i.generatedAt)) && md !== null && md.trim().split(/\r?\n/).length === 1
        && after.join() === [m.pewp + "/internal/not-gathered.json", m.pewp + "/internal/not-gathered.md", m.pewp + "/profile.json"].map(norm).sort().join(), after.join(" ")); }

    // 2. a BLOCKED step with a ruling that counts
    { const m = mk(RUNS({ "s-a1": { state: "BLOCKED", exit: 3, line: BL } }), { rulings: { "s-a1": "the key is not ours to get" } }), r = await go(m), p = prof(m), a = stepOf(p, "s-a1"), i = intJ(m), md = intMd(m);
      check("2: BLOCKED and ruled: exit 0, 4 gathered, 1 not gathered (1 ruled)", r.code === 0 && r.last === "PROFILE: 3 gathered, 1 not gathered (1 ruled), 0 not applicable", r.out);
      check("2: the step is not gathered; why is the sheet's own words word for word; the ruling holds why, by and at; no files", a.bucket === "not gathered" && a.state === "BLOCKED" && a.why === "exit 3: " + BL && a.partial === false && JSON.stringify(a.ruling) === JSON.stringify({ why: "the key is not ours to get", by: "agent", at: NOW }) && a.files.length === 0 && a.fileCount === 0, JSON.stringify(a));
      check("2: notGathered and counts name it as ruled", p && p.notGathered.length === 1 && JSON.stringify(p.notGathered[0]) === JSON.stringify({ station: "alpha", step: "s-a1", state: "BLOCKED", why: "exit 3: " + BL, ruled: true }) && p.counts.ruled === 1 && p.counts.notGathered === 1, JSON.stringify(p && p.notGathered));
      check("2: one internal row and one .md line with 'ruled by'", i && i.rows.length === 1 && JSON.stringify(i.rows[0]) === JSON.stringify({ station: "alpha", step: "s-a1", what: "what s-a1 does", state: "BLOCKED", why: "exit 3: " + BL, ruled: true, ruledBy: "agent", ruledAt: NOW })
        && md && md.trim().split(/\r?\n/).length === 2 && md.trim().split(/\r?\n/)[1] === "alpha | s-a1 | BLOCKED | exit 3: " + BL + " | ruled by agent on 2026-11-22", md); }

    // 3. a station other than the profile's own is OPEN
    { const m = mk(RUNS({ "s-a1": { state: "BLOCKED", exit: 3, line: BL }, "s-b1": { state: "FAILED", exit: 1, line: "boom" } })), r = await go(m);
      check("3: a station before the profile's own is OPEN: exit 3, the last line names the first open station with its counts and what unblocks", r.code === 3 && r.last === "BLOCKED: station alpha is OPEN (1 to judge, 0 not run) | unblocks: omnikom seo station https://client.test/, then judge what it lists", r.out);
      check("3: neither profile.json nor the internal files exist", nothing(m), "something was written"); }

    // 4. the report station (the profile's own) is left out whole, run or not
    { const spec = RUNS(); delete spec["rep-one"]; const m = mk(spec), r = await go(m), p = prof(m), i = intJ(m), md = intMd(m) || "", all = JSON.stringify(p) + JSON.stringify(i) + md;
      check("4: the report station holding a step that was not run does not block and is not counted: exit 0, 4 gathered, 0 not gathered", r.code === 0 && r.last === "PROFILE: 4 gathered, 0 not gathered (0 ruled), 0 not applicable", r.out);
      check("4: the report station's steps are in no part of profile.json and on no line of the internal sheet", p && i && !all.includes("rep-one") && !JSON.stringify(p.stations).includes("client-profile") && !all.includes("NOT RUN") && p.notGathered.length === 0 && i.rows.length === 0 && md.trim().split(/\r?\n/).length === 1, all.slice(0, 300)); }

    // 5. SKIPPED with and without a rule
    { const m = mk(RUNS({ "s-a1": { state: "SKIPPED", exit: 4, rule: "site-none", line: "SKIPPED: client has no site" }, "s-a2": { state: "SKIPPED", exit: 4, line: "SKIPPED: no US egress" } }), { rulings: { "s-a2": "no US machine today" } }), r = await go(m), p = prof(m), a = stepOf(p, "s-a1"), b = stepOf(p, "s-a2"), i = intJ(m);
      check("5: SKIPPED by the manifest's rule: not applicable, why is its line, no internal row; the counts say so", r.code === 0 && r.last === "PROFILE: 2 gathered, 1 not gathered (1 ruled), 1 not applicable" && a.bucket === "not applicable" && a.why === "SKIPPED: client has no site" && a.ruling === null && i && i.rows.length === 1 && i.rows[0].step === "s-a2" && p.counts.notApplicable === 1, r.out + JSON.stringify(a));
      check("5: SKIPPED without a rule, ruled: not gathered, with its ruling", b.bucket === "not gathered" && b.state === "SKIPPED" && b.ruling && b.ruling.why === "no US machine today", JSON.stringify(b)); }

    // 6. PARTIAL
    { const m = mk(RUNS({ "s-b1": { state: "PARTIAL", exit: 0, line: "PARTIAL: read 10 of 25", files: [{ name: "research/p.json", body: { status: "partial" } }] } }), { rulings: { "s-b1": "the rest is not reachable" } }), r = await go(m), p = prof(m), a = stepOf(p, "s-b1");
      check("6: PARTIAL is gathered with partial true, why is the run log's line, its files are listed, no internal row", r.code === 0 && r.last === "PROFILE: 4 gathered, 0 not gathered (0 ruled), 0 not applicable" && a.bucket === "gathered" && a.state === "PARTIAL" && a.partial === true && a.why === "PARTIAL: read 10 of 25" && a.files.length === 1 && a.files[0].status === "partial" && intJ(m).rows.length === 0, r.out + JSON.stringify(a)); }

    // 7. nothing to pool from
    { const bad = [["no run log", mk(RUNS(), { noRun: true }), /^BLOCKED: no run log at .*seo-run\.json \| unblocks: /],
        ["no sheet", mk(RUNS(), { noSheet: true }), /^BLOCKED: no sheet of the stations at .*sheet\.json \| unblocks: omnikom seo station /],
        ["a sheet older than the run log", mk(RUNS(), { sheetOffsetMs: -60000 }), /^BLOCKED: the sheet is older than the run log .* \| unblocks: omnikom seo station /],
        ["a sheet that lacks stations", mk(RUNS(), { sheetStation: "alpha" }), /^BLOCKED: the sheet lacks the stations beta, gamma, report \(it was written with --station\) \| unblocks: omnikom seo station /]];
      for (const [name, m, re] of bad) { const r = await go(m); check("7: " + name + ": exit 3, its own BLOCKED line, nothing written", r.code === 3 && re.test(r.last) && nothing(m), r.code + " " + r.last); }
      const u = await exec("client-profile.mjs", []), repo = await exec("client-profile.mjs", [path.join(root, "somewhere"), "--cwd", root]);
      check("7: no argument, and a path that is no url or profile key: exit 2 (usage)", u.code === 2 && repo.code === 2, u.code + " " + repo.code + " " + repo.out); }

    // 8. the summary limit, the file limit, a missing file
    { const edge = (len) => ({ k: "x".repeat(len - 8) });   // JSON text of {"k":"..."} is len characters
      const files = [];
      for (let k = 7; k >= 1; k--) files.push({ name: "research/f" + k + ".json", body: {} });
      const m = mk(RUNS({ "s-a1": { files: [{ name: "research/big.json", body: { status: "ok", summary: { blob: "x".repeat(5000), a: 1, b: 2 } } }, { name: "research/edge.json", body: { summary: edge(4000) } }, { name: "research/over.json", body: { summary: edge(4001) } }] },
        "s-a2": { files, missing: ["research/gone.json"], evidence: [...files.map((f) => f.name), "research/gone.json"] } })), r = await go(m), p = prof(m), a = stepOf(p, "s-a1"), b = stepOf(p, "s-a2");
      const f = (name) => (a.files || []).find((x) => x.path === "research/" + name) || {};
      check("8: a summary of more than 4000 characters gives summaryKeys and no summary (status kept)", r.code === 0 && f("big.json").summary === undefined && JSON.stringify(f("big.json").summaryKeys) === '["blob","a","b"]' && f("big.json").status === "ok", JSON.stringify(f("big.json")));
      check("8: a summary of exactly 4000 characters is copied, one of 4001 is not", f("edge.json").summary !== undefined && f("edge.json").summaryKeys === undefined && f("over.json").summary === undefined && Array.isArray(f("over.json").summaryKeys), JSON.stringify([f("edge.json").summaryKeys, f("over.json").summary === undefined]));
      check("8: 7 evidence files give 5 listed in name order and fileCount 7; the missing path is not listed", b.fileCount === 7 && b.files.length === 5 && b.files.map((x) => x.path).join() === [1, 2, 3, 4, 5].map((k) => "research/f" + k + ".json").join() && !JSON.stringify(b.files).includes("gone"), JSON.stringify(b.files && b.files.map((x) => x.path))); }

    // 9. a file that is not an object
    { const m = mk(RUNS({ "s-a1": { files: [{ name: "research/notes.txt", body: "plain text" }, { name: "research/list.json", body: [1, 2, 3] }, { name: "research/bad.json", body: "{not json" }, { name: "research/odd.json", body: { status: 5, summary: [1] } }] } })), r = await go(m), a = stepOf(prof(m), "s-a1");
      const ok = a.files && a.files.length === 4 && a.files.every((x) => x.summary === undefined && x.summaryKeys === undefined && x.status === undefined);
      check("9: a text file, a JSON list, a broken JSON file and a status that is no text: all listed, no summary, no status, no crash", r.code === 0 && ok, r.out + JSON.stringify(a.files)); }

    // 10. the .md file and the outputs; a profile key
    { const none = mk(RUNS({ "s-a1": { state: "BLOCKED", exit: 3, line: BL } }), { rulings: { "s-a1": "w" } }), r = await go(none), md = intMd(none), p = prof(none);
      check("10: the .md file's first line is exactly 'INTERNAL: never shown to a client'", r.code === 0 && md !== null && md.split(/\r?\n/)[0] === "INTERNAL: never shown to a client", md);
      check("10: outputs hold the manifest's outputs relative to the run folder, a folder ending with a slash", JSON.stringify(stepOf(p, "s-g1").outputs) === '["research/","../snapshots/*/_site.json"]' && JSON.stringify(stepOf(p, "s-a1").outputs) === '["out/s-a1.json"]', JSON.stringify(stepOf(p, "s-g1").outputs));
      const pr = mk(RUNS(), { key: "profile:acme" }), r2 = await go(pr), p2 = prof(pr);
      check("10: a profile:<slug> key works the same way (key and host in the profile)", r2.code === 0 && p2 && p2.key === "profile:acme" && p2.host === "acme", r2.out); }

    // 13. AB-11: a step skipped because its source was ruled not gathered is NOT GATHERED (counted under ruled), never "not applicable"; only the site-none rule is
    { const SKIP_LINE = "SKIPPED: its source s-a1 was ruled not gathered", SITE_LINE = "SKIPPED: the client has no site (run-key.json)";
      const m = mk(RUNS({ "s-a1": { state: "WAITING", exit: 0, line: "needs the owner's browser" }, "s-a2": { state: "SKIPPED", exit: 4, rule: "source-ruled", line: SKIP_LINE }, "s-b1": { state: "SKIPPED", exit: 4, rule: "site-none", line: SITE_LINE } }), { rulings: { "s-a1": "the page cannot be had" } });
      const r = await go(m), p = prof(m), a1 = stepOf(p, "s-a1"), a2 = stepOf(p, "s-a2"), b1 = stepOf(p, "s-b1"), i = intJ(m), md = intMd(m);
      check("13: the rule value the runner writes for a step skipped because its source was ruled is the constant lib-stations.mjs exports (one value, pinned: tools/omnikom-cli/test/seo-run.mjs checks the runner's row says it)", lib.SOURCE_RULED === "source-ruled", String(lib.SOURCE_RULED));
      check("13: a ruled capture, its importer skipped because of it, and a site-none skip in one run: the last line counts 1 gathered, 2 not gathered (2 ruled), 1 not applicable", r.code === 0 && r.last === "PROFILE: 1 gathered, 2 not gathered (2 ruled), 1 not applicable", r.out);
      check("13: the step skipped because its source was ruled is not gathered, why is the runner's line word for word, and it counts as ruled", a2.bucket === "not gathered" && a2.state === "SKIPPED" && a2.why === SKIP_LINE && a2.ruling !== null && a2.ruling.why === SKIP_LINE && p.notGathered.some((x) => x.step === "s-a2" && x.ruled === true && x.why === SKIP_LINE), JSON.stringify(a2));
      check("13: the ruled capture is not gathered with its own ruling, the site-none skip is not applicable with no internal row", a1.bucket === "not gathered" && a1.ruling && a1.ruling.why === "the page cannot be had" && b1.bucket === "not applicable" && b1.why === SITE_LINE && b1.ruling === null, JSON.stringify([a1.bucket, b1.bucket]));
      check("13: the internal sheet lists both not gathered steps (and not the site-none one), in the .json and in the .md", i && i.rows.length === 2 && i.rows.some((x) => x.step === "s-a1" && x.ruled === true) && i.rows.some((x) => x.step === "s-a2" && x.ruled === true && x.why === SKIP_LINE) && !i.rows.some((x) => x.step === "s-b1") && md && md.trim().split(/\r?\n/).length === 3 && md.includes("s-a2") && !md.includes("s-b1"), JSON.stringify(i && i.rows) + md); }
  } finally { rmTmp(root); }

  // 12. jsonFiles: every .json file under a gathered step's outputs (AB-4b)
  { const root2 = mkTmp("cprofile12"), skill2 = path.join(root2, "skill"), home2 = path.join(root2, "home");
    try {
      fs.cpSync(dir, path.join(skill2, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(skill2, "pipeline.json"), JSON.stringify(MANIFEST, null, 1));
      fs.mkdirSync(home2, { recursive: true });
      const exec2 = runner(path.join(skill2, "scripts"), home2, path.join(root2, "net.log"));
      let k = 0;
      // one run folder: the steps other than s-g1 leave their file under out/; s-g1's folder output research/ holds what the caller gives
      const mk2 = (gFiles, over = {}) => {
        const data = path.join(root2, "d" + ++k), pewp = path.join(data, "site-checks", "client.test", ".pewp"), put = (name, body) => { fs.mkdirSync(path.dirname(path.join(pewp, name)), { recursive: true }); fs.writeFileSync(path.join(pewp, name), body); };
        const ids = ["s-a1", "s-a2", "s-b1", "s-g1", "rep-one"], entries = [];
        for (const id of ids) { const state = (over[id] && over[id].state) || "RUN", names = id === "s-g1" ? gFiles.map((f) => f[0]) : ["out/" + id + ".json"];
          if (id === "s-g1") for (const [nm, body] of gFiles) put(nm, body); else put(names[0], "{}");
          entries.push({ id, state, line: state === "RUN" ? "ok" : "exit 3: BLOCKED: x | unblocks: y", exit: state === "RUN" ? 0 : 3, evidence: names.map((x) => norm(path.join(pewp, x))), evidenceCount: names.length }); }
        const rows = MANIFEST.steps.map((s) => { const e = entries.find((x) => x.id === s.id); return e ? { id: s.id, state: e.state, detail: e.state === "RUN" ? e.evidence[0] : e.line } : { id: s.id, state: "NOT RUN", detail: "not run yet" }; });
        let rulings = {};
        for (const id of Object.keys(over)) rulings = lib.ruleStep(MANIFEST, rows, rulings, { step: id, why: "w", by: "agent", now: NOW });
        fs.mkdirSync(path.join(pewp, "stations"), { recursive: true });
        fs.writeFileSync(path.join(pewp, "seo-run.json"), JSON.stringify({ version: 1, updatedAt: new Date(T0).toISOString(), steps: entries }));
        const sf = path.join(pewp, "stations", "sheet.json"); fs.writeFileSync(sf, JSON.stringify(lib.buildSheet(MANIFEST, rows, rulings, {}))); const tt = new Date(T0 + 60000); fs.utimesSync(sf, tt, tt);
        if (Object.keys(rulings).length) fs.writeFileSync(path.join(pewp, "stations", "rulings.json"), JSON.stringify(rulings));
        return { data, pewp };
      };
      const run2 = async (m) => { const r = await exec2("client-profile.mjs", ["https://client.test/", "--cwd", m.data]); let p = null; try { p = JSON.parse(fs.readFileSync(path.join(m.pewp, "profile.json"), "utf8")); } catch { /* red below */ } return { r, p, step: (id) => (p && p.stations ? p.stations.flatMap((s) => s.steps) : []).find((x) => x.id === id) || {} }; };
      // (b) a folder output with 8 .json files (one deep, names out of order) and 2 other files
      const eight = ["research/z8.json", "research/b2.json", "research/deep/sub/h7.json", "research/a1.json", "research/c3.JSON", "research/d4.json", "research/e5.json", "research/f6.json"];
      const m1 = mk2([...eight.map((n) => [n, "{}"]), ["research/notes.txt", "x"], ["research/pic.png", "x"]]), x1 = await run2(m1), g = x1.step("s-g1");
      const want = [...eight].filter((n) => /\.json$/i.test(n)).sort();
      check("12: a gathered step with 8 .json files and 2 others under a folder output: jsonFiles has the .json files, sorted, relative, forward slashes; files still holds 5; no cut mark", x1.r.code === 0 && JSON.stringify(g.jsonFiles) === JSON.stringify(want) && g.jsonFiles.length === 8 && g.files.length === 5 && g.fileCount === 10 && g.jsonFilesCut === undefined && !g.jsonFiles.some((f) => f.includes("\\") || f.startsWith("/") || f.includes(":")), x1.r.out + JSON.stringify(g.jsonFiles));
      check("12: a gathered step whose output is one file lists that file", JSON.stringify(x1.step("s-a2").jsonFiles) === '["out/s-a2.json"]', JSON.stringify(x1.step("s-a2").jsonFiles));
      // (c) a step that is not gathered has no jsonFiles key, although its output file exists
      const m2 = mk2([["research/d.json", "{}"]], { "s-a1": { state: "BLOCKED" } }), x2 = await run2(m2), a = x2.step("s-a1");
      check("12: a step that is not gathered has no jsonFiles key (and no jsonFilesCut)", x2.r.code === 0 && a.bucket === "not gathered" && !("jsonFiles" in a) && !("jsonFilesCut" in a), x2.r.out + JSON.stringify(a));
      // (d) 301 files
      const many = Array.from({ length: 301 }, (_, i) => "research/g" + String(i).padStart(3, "0") + ".json");
      const m3 = mk2(many.map((n) => [n, "{}"])), x3 = await run2(m3), g3 = x3.step("s-g1");
      check("12: 301 .json files: the first 300 in order and jsonFilesCut true", x3.r.code === 0 && Array.isArray(g3.jsonFiles) && g3.jsonFiles.length === 300 && g3.jsonFiles[0] === many[0] && g3.jsonFiles[299] === many[299] && g3.jsonFilesCut === true, x3.r.out + String(g3.jsonFiles && g3.jsonFiles.length));
    } finally { rmTmp(root2); } }

  // 11. the real pipeline.json
  { let m = null; try { m = JSON.parse(fs.readFileSync(PIPE, "utf8")); } catch (e) { /* red below */ }
    const L = await import(pathToFileURL(path.join(dir, "lib-pipeline.mjs")).href + "?" + Math.random());
    const v = m ? L.validateManifest(m, { skillDir: SKILL }) : { ok: false, problems: [{ detail: "no manifest" }] };
    const i = m ? m.steps.findIndex((s) => s.id === "client-profile") : -1;
    check("11: the real pipeline.json is valid (validateManifest)", v.ok === true, v.problems.map(L.describe).join("; "));
    check("11: the real pipeline.json holds client-profile in station report, then analysis-judge, directly before report-live", i > 0 && m.steps[i].station === "report" && m.steps[i + 1] && m.steps[i + 1].id === "analysis-judge" && m.steps[i + 2] && m.steps[i + 2].id === "report-live", String(i)); }
  return results;
}

const CP = "client-profile.mjs";
const MUTANTS = [
  { name: "an OPEN station does not block", patches: [{ file: CP, from: 's.id !== ownStation && s.verdict === "OPEN"', to: 's.id !== ownStation && s.verdict === "NEVER"' }], expect: [/^3: a station before the profile's own is OPEN/] },
  { name: "a rule skip is counted as not gathered", patches: [{ file: CP, from: 'entry.state === "SKIPPED" && entry.rule === "site-none"', to: "false" }], expect: [/^5: SKIPPED by the manifest's rule/] },
  { name: "a step skipped because its source was ruled reads as not applicable", patches: [{ file: CP, from: 'entry.state === "SKIPPED" && entry.rule === "site-none"', to: 'entry.state === "SKIPPED" && Boolean(entry.rule)' }], expect: [/^13: a ruled capture, its importer skipped/, /^13: the step skipped because its source was ruled/] },
  { name: "a stale sheet is accepted", patches: [{ file: CP, from: "sheetMs < updatedMs", to: "false" }], expect: [/^7: a sheet older than the run log/] },
  { name: "the summary limit is removed", patches: [{ file: CP, from: "JSON.stringify(sm).length <= MAX_SUMMARY", to: "true" }], expect: [/^8: a summary of more than 4000/] },
  { name: "the ruling's by is dropped", patches: [{ file: CP, from: "{ why: r.why, by: r.by, at: r.at }", to: "{ why: r.why, at: r.at }" }], expect: [/^2: the step is not gathered/] },
  { name: "why is taken from the run log, not the sheet's detail", patches: [{ file: CP, from: ": row ? row.detail : null)", to: ": entry ? entry.line : null)" }], expect: [/^2: the step is not gathered/] },
  { name: "the file limit is removed", patches: [{ file: CP, from: ".slice(0, MAX_FILES)", to: ".slice(0, 99)" }], expect: [/^8: 7 evidence files/] },
  { name: "the report station is listed again", patches: [{ file: CP, from: "all.filter((s) => s.id !== ownStation)", to: "all" }], expect: [/^4: the report station/] },
  { name: "jsonFiles is cut to 5", patches: [{ file: CP, from: "MAX_JSON = 300", to: "MAX_JSON = 5" }], expect: [/^12: a gathered step with 8/, /^12: 301/] },
  { name: "a folder output is not walked", patches: [{ file: CP, from: "st.isDirectory()", to: "false" }], expect: [/^12: a gathered step with 8/] },
  { name: "a not gathered step gets jsonFiles", patches: [{ file: CP, from: "...(gathered ? jsonOf(def) : {})", to: "...jsonOf(def)" }], expect: [/^12: a step that is not gathered/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-client-profile.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "CLIENT PROFILE", scenarios, MUTANTS, scriptsDir, argv: A }));
}
