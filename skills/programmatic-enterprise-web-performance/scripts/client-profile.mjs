// Usage: node client-profile.mjs <url or profile:slug> [--cwd DIR]
// The profile of one client (AB-4, parts AU.S-3 and AU.S-5): everything the stations gathered, pooled into one file, and the internal sheet of what was not gathered.
//   {pewp}/profile.json                  every step of the stations that gather: gathered, not gathered or not applicable, with its files and each file's own summary,
//                                        and for a gathered step every .json file under its outputs (jsonFiles, at most 300, sorted, relative to {pewp}, forward slashes)
//   {pewp}/internal/not-gathered.json    one row per step that was not gathered (INTERNAL: never shown to a client)
//   {pewp}/internal/not-gathered.md      the same, one line per row; its first line says it is internal
// It reads only: pipeline.json (one folder above scripts/), the run log {pewp}/seo-run.json, {pewp}/stations/sheet.json and rulings.json, and of each gathered step's
// evidence files the size, the date and, for a JSON object, its top-level status (when text) and summary (when an object). Never a row of a capture or a research file.
// No model, no network. It writes nothing outside {pewp}/profile.json and {pewp}/internal/.
// A step's bucket, from its run log entry: RUN and PARTIAL are gathered (PARTIAL says so: partial true); SKIPPED with a manifest rule is not applicable; everything else,
// and a step with no entry (NOT RUN), is not gathered, and its why is the detail of its row in the sheet, never reworded. The station that holds this step (it is the one running) is left out whole: it makes the report, it gathers nothing, so it is not in the stations, the counts or the internal sheet.
// Refuses (BLOCKED, exit 3, nothing written) when: there is no run log; there is no sheet; the sheet is older than the run log; the sheet lacks a station (it was written
// with --station); or a station other than the one that holds this step is OPEN. Exit 0: last line PROFILE: <g> gathered, <n> not gathered (<r> ruled), <a> not applicable. Exit 2: usage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { loadManifest, makeVars, substitute, norm } from "./lib-pipeline.mjs";
import { readRun } from "./lib-run.mjs";
import { stationsOf } from "./lib-stations.mjs";

const OWN = "client-profile", MAX_SUMMARY = 4000, MAX_FILES = 5, MAX_JSON = 300;
const USAGE = "usage: node client-profile.mjs <url or profile:slug> [--cwd DIR]";
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class Stop extends Error { constructor(message, exit) { super(message); this.exit = exit; } }
const blocked = (what, unblocks) => new Stop("BLOCKED: " + what + " | unblocks: " + unblocks, 3);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// one evidence file: its size, its date and, for a JSON object, its status (text) and summary (object; copied whole when its text is short, else only its key names)
function describeFile(pewp, abs) {
  const st = fs.statSync(abs), out = { path: path.posix.relative(norm(pewp), norm(abs)), bytes: st.size, modified: st.mtime.toISOString() };
  if (!/\.json$/i.test(abs)) return out;
  const j = readJson(abs);
  if (!isObj(j)) return out;
  if (typeof j.status === "string") out.status = j.status;
  const sm = j.summary;
  if (isObj(sm)) { if (JSON.stringify(sm).length <= MAX_SUMMARY) out.summary = sm; else out.summaryKeys = Object.keys(sm); }
  return out;
}

function pool(argv) {
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const key = argv[0];
  if (!key || key.startsWith("--")) throw new Stop(USAGE, 2);
  const cwd = path.resolve(opt("--cwd") || process.cwd());
  let vars;
  try { vars = makeVars({ url: key, client: "", skillDir, data: cwd }); } catch (e) { throw new Stop(e.message + "\n" + USAGE, 2); }
  const pewp = vars.pewp, ml = loadManifest(path.join(skillDir, "pipeline.json"));
  if (!ml.ok) throw new Stop(ml.problems.map((p) => p.detail).join("; "), 2);
  const manifest = ml.manifest, own = manifest.steps.find((s) => s.id === OWN);
  if (!own) throw new Stop("the manifest has no step " + OWN, 2);
  const ownStation = own.station;

  const logFile = pewp + "/seo-run.json", sheetFile = pewp + "/stations/sheet.json", rulingsFile = pewp + "/stations/rulings.json";
  const { run, error } = readRun(logFile);
  if (!run) throw blocked(error || "no run log at " + logFile, "run the audit first (omnikom seo run " + key + ")");
  if (!fs.existsSync(sheetFile)) throw blocked("no sheet of the stations at " + sheetFile, "omnikom seo station " + key);
  const sheet = readJson(sheetFile);
  if (!sheet || !Array.isArray(sheet.stations)) throw blocked(sheetFile + " is not a sheet of the stations", "omnikom seo station " + key);
  const sheetMs = fs.statSync(sheetFile).mtimeMs, updatedMs = Date.parse(run.updatedAt);
  if (sheetMs < updatedMs) throw blocked("the sheet is older than the run log (" + new Date(sheetMs).toISOString() + " against " + run.updatedAt + ")", "omnikom seo station " + key);
  const all = stationsOf(manifest), lacking = all.filter((s) => !sheet.stations.some((x) => x.id === s.id));
  if (lacking.length) throw blocked("the sheet lacks the station" + (lacking.length === 1 ? " " : "s ") + lacking.map((s) => s.id).join(", ") + " (it was written with --station)", "omnikom seo station " + key + " without --station");
  const open = sheet.stations.find((s) => s.id !== ownStation && s.verdict === "OPEN");
  if (open) throw blocked("station " + open.id + " is OPEN (" + open.toJudge + " to judge, " + open.notRun + " not run)", "omnikom seo station " + key + ", then judge what it lists");
  const rulings = fs.existsSync(rulingsFile) ? readJson(rulingsFile) : {};
  if (!isObj(rulings)) throw blocked(rulingsFile + " is not an object of step id to ruling", "omnikom seo rule " + key + " (or repair that file)");

  // every .json file under a step's outputs (a file output: that file; a folder: all below it), relative to pewp with forward slashes, sorted by code unit, at most MAX_JSON
  const jsonOf = (def) => {
    const found = new Set(), base = norm(pewp), visit = (abs) => {
      let st; try { st = fs.statSync(abs); } catch { return; }
      if (st.isDirectory()) { for (const name of fs.readdirSync(abs)) visit(abs + "/" + name); return; }
      const rel = path.posix.relative(base, norm(abs));
      if (/\.json$/i.test(abs) && !rel.startsWith("..")) found.add(rel);
    };
    for (const o of def.outputs || []) visit(norm(substitute(o, vars)).replace(/\/+$/, ""));
    const all = [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return all.length > MAX_JSON ? { jsonFiles: all.slice(0, MAX_JSON), jsonFilesCut: true } : { jsonFiles: all };
  };
  const steps = new Map(manifest.steps.map((s) => [s.id, s])), outputsOf = (def) => (def.outputs || []).map((o) => {
    const rel = path.posix.relative(norm(pewp), norm(substitute(o, vars)));
    return o.endsWith("/") && !rel.endsWith("/") ? rel + "/" : rel;
  });
  const gatherers = all.filter((s) => s.id !== ownStation);
  const profileStations = [], notGathered = [], rows = [], counts = { steps: 0, gathered: 0, notGathered: 0, ruled: 0, notApplicable: 0 };
  for (const st of gatherers) {
    const ss = sheet.stations.find((x) => x.id === st.id), outSteps = [];
    for (const id of st.steps) {
      const def = steps.get(id), entry = run.steps.find((e) => e.id === id), row = ss.open.find((o) => o.id === id);
      const state = entry ? entry.state : "NOT RUN";
      const gathered = state === "RUN" || state === "PARTIAL", partial = state === "PARTIAL";
      const notApplicable = entry && entry.state === "SKIPPED" && Boolean(entry.rule);
      const bucket = gathered ? "gathered" : notApplicable ? "not applicable" : "not gathered";
      const why = bucket === "not gathered" ? (row ? row.detail : null) : partial ? entry.line ?? null : notApplicable ? entry.line ?? entry.reason ?? null : null;
      let ruling = null;
      if (bucket === "not gathered" && row && String(row.ruling).startsWith("not gathered:") && isObj(rulings[id])) { const r = rulings[id]; ruling = { why: r.why, by: r.by, at: r.at }; }
      const found = gathered ? [...new Set(entry.evidence || [])].map((p) => path.resolve(cwd, p)).filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) : [];
      const files = found.map((p) => describeFile(pewp, p)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      outSteps.push({ id, what: def.what, state, bucket, partial, why, ruling, outputs: outputsOf(def), files: files.slice(0, MAX_FILES), fileCount: files.length, ...(gathered ? jsonOf(def) : {}) });
      counts.steps++;
      if (gathered) counts.gathered++;
      else if (notApplicable) counts.notApplicable++;
      else {
        counts.notGathered++;
        if (ruling) counts.ruled++;
        notGathered.push({ station: st.id, step: id, state, why, ruled: ruling !== null });
        rows.push({ station: st.id, step: id, what: def.what, state, why, ruled: ruling !== null, ruledBy: ruling ? ruling.by : null, ruledAt: ruling ? ruling.at : null });
      }
    }
    profileStations.push({ id: st.id, what: st.what, verdict: ss.verdict, steps: outSteps });
  }
  const generatedAt = new Date().toISOString();
  const profile = { step: OWN, generatedAt, key, host: vars.host, stations: profileStations, notGathered, counts };
  const md = ["INTERNAL: never shown to a client", ...rows.map((r) => [r.station, r.step, r.state, r.why, r.ruled ? "ruled by " + r.ruledBy + " on " + String(r.ruledAt).slice(0, 10) : "not ruled"].join(" | "))].join("\n") + "\n";
  fs.mkdirSync(pewp + "/internal", { recursive: true });
  fs.writeFileSync(pewp + "/internal/not-gathered.json", JSON.stringify({ generatedAt, key, rows }, null, 1) + "\n");
  fs.writeFileSync(pewp + "/internal/not-gathered.md", md);
  fs.writeFileSync(pewp + "/profile.json", JSON.stringify(profile, null, 1) + "\n");
  return "PROFILE: " + counts.gathered + " gathered, " + counts.notGathered + " not gathered (" + counts.ruled + " ruled), " + counts.notApplicable + " not applicable";
}

if (isMain(import.meta.url)) {
  if (process.argv.includes("--help")) { console.log(USAGE); process.exit(0); }
  try { console.log(pool(process.argv.slice(2))); } catch (e) { if (!(e instanceof Stop)) throw e; (e.exit === 2 ? console.error : console.log)(e.message); process.exit(e.exit); }
}
