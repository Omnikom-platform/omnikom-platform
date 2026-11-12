// start: ONE entry point over every mode's stage sequence (shipgate 06-growth.md section 2: `start <mode>` records the
// sequence in state.json, runs the stages not yet done in order, stops at the first stage that needs an approval or a
// missing input; `start --stage <name>` re-runs one stage; later stages whose inputs changed are marked stale and re-run).
// It drives the skill's scripts by their own command lines; it builds no stage itself.
//
// Usage: node start.mjs <mode> <target> [<target2>] [--go] [--stage <name>] [--ack <stage> [--by NAME] [...]] [options]
//   audit-live: its steps are NOT in this file: they are the steps of pipeline.json (skill root), read through lib-pipeline.mjs and run in its
//          order (file order, a step after the steps it depends on). Steps with a script run; steps marked needsPerson (NEEDS-APPROVAL), needsBrowser
//          owner or needsAi (WAITING-FOR) print their brief and wait for their evidence; a step that exits 3 is BLOCKED and the steps that do not
//          depend on it go on. Extra options: --client <slug> (the {client} placeholder), --pipeline <file> (another manifest; tests).
//   modes: audit-live <url> | audit-repo <path> | audit <url|path> | compare <a> <b> | research <url|folder> | refactor <repo path>
//          | measure <url> | migrate <old url> <new url|folder> | build <folder> (alias: new) | iterate <target> | local <url|repo>
//          | overhaul <live url> <repo path>   (fix an existing live site end to end: stages/overhaul.md; 14 steps, OWNER stops)
//   no --go            print the plan (stages, their status, who/what each needs, the cost) and stop. Show it, then run again with --go.
//   --go               run every stage that is pending or stale, in order, until one needs a person or a missing input.
//                      A stage that makes external calls or starts agent workers runs only after the owner saw the plan: record it with
//                      `--ack plan-ok --by "<owner name>"`, or pass `--yes` when the owner already said yes (the run file records which).
//   --env-file <path>  (or --dotenv <path>) load keys from this .env file (names only are ever printed); remembered for the run; passed to doctor as --dotenv.
//   Every start writes <pewp>/runs/<date>-<mode>.md (command, exit code, first 40 lines, doctor result) and one per stage it ran.
//   --stage <name>     run only that stage (forced, even when done), then mark the stages after it that depend on it stale. With --go.
//   --ack <stage> --by NAME   record that a person did/approved a stage the script cannot do for them (refactor cost OK, the merge,
//                      the redirect map review, the cutover, the builder session). The owner decides first; the main session records.
//                      Extra: --site <built folder> (builder), --cutover-date YYYY-MM-DD (cutover).
//   Run state: <pewp>/state.json (stages{name:{doneAt,outputs,inputsHash,inputsDetail}} + start{mode,sequence,status,stage,message}); logs in <pewp>/start/.
//   <pewp> is site-checks/<host>/.pewp for a URL, <repo>/.pewp for a folder (state.mjs). compare keeps its own under site-checks/compare-<a>-vs-<b>/.pewp.
// Options (forwarded to the script that uses them): --cwd DIR --stage-scripts DIR --stage-timeout-min 150 --today YYYY-MM-DD
//   all: --offline (doctor does not look up the latest Common Crawl release)
//   audit/compare: --fresh --max-age-days N --launch-state live|preview --launch-state-a/-b --competitor <domain>... --no-authority
//                  --focus "<text>" --workers N -- <snapshot-site options, e.g. --exclude "^/home-search" --ignore-robots --max-pages 20>
//   research/build: --research-args "<research.mjs args>" --plan-args "<plan-site.mjs args>" --brief <file> --site <built folder>
//                   --live-url <url> --strict
//   refactor: --build "<cmd>" | --no-build  --setup "<cmd>" | --no-setup  --causes C01,C03 --people C04 --decisions <file>... --max-workers N --yes
//             --max-parallel N (fix workers at once; overhaul asks, never assumes)  --project-merges | --owner-merges (who merges fixed branches)
//             --no-visual (REF-009 screenshots are on by default) --visual-allow "<route group>=<ratio>"... --visual-dir <sub>
//   overhaul: the audit-live, research, refactor and build options above, plus --seed-args "<research-seeds.mjs args>", --sitemap-url <url>
//             (default <live url>/sitemap.xml), --cc-release <Common Crawl release id> (download early), --ack deploy --release <commit or release id>, --ack builder --site <built folder>
//   measure: --property sc-domain:example.com --fresh
//   migrate: --gsc-file f --gsc-days N --links-csv f --fetch-sitemap --overrides f --home-ok /a,/b --min-score N --new-origin URL
//            --gap-ms N --max-urls N --probe-old --exclude re... --snapshot-dir D --no-images --image-scope all|priority
// Exit: 0 every stage is done (or the run ended at the documented natural pause: built, gated, waiting for launch);
//       1 a stage or gate FAILED; 2 usage; 3 STOPPED for a person (a missing input, an approval, or a task for the main session:
//       the line starting NEEDS-INPUT / NEEDS-APPROVAL / WAITING-FOR names it); 4 BLOCKED (a source or capability is missing; the line says what unblocks it).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locate, load, save, init } from "./state.mjs";
import { latestComplete } from "./live-target.mjs";
import os from "node:os";
import { loadManifest, validateManifest, runOrder, substitute, evidenceState, stepOutcome, stepKind, stepStop, describe, globPaths, hasGlob, adoptStep } from "./lib-pipeline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, "..");
const ARGV = process.argv.slice(2);
const dd = ARGV.indexOf("--");
let snapPass = dd >= 0 ? ARGV.slice(dd + 1) : [];
let A = dd >= 0 ? ARGV.slice(0, dd) : ARGV;
const VALUE_FLAGS = new Set(["--cwd", "--stage-scripts", "--stage-timeout-min", "--today", "--stage", "--ack", "--by", "--site", "--cutover-date", "--max-age-days", "--launch-state", "--launch-state-a", "--launch-state-b", "--competitor", "--focus", "--workers",
  "--research-args", "--plan-args", "--brief", "--live-url", "--build", "--setup", "--causes", "--people", "--decisions", "--max-workers", "--visual-allow", "--visual-dir", "--property", "--gsc-file", "--gsc-days", "--links-csv", "--overrides", "--home-ok", "--min-score",
  "--new-origin", "--gap-ms", "--max-urls", "--exclude", "--snapshot-dir", "--image-scope", "--max-pages",
  "--env-file", "--dotenv", "--max-parallel", "--release", "--sitemap-url", "--seed-args", "--cc-release", "--client", "--pipeline", "--adopt"]);
const flag = (k) => A.includes(k);
const val = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const vals = (k) => A.flatMap((x, i) => (x === k ? [A[i + 1]] : []));
const MODES0 = ["audit-live", "audit-repo", "audit", "compare", "research", "refactor", "measure", "migrate", "build", "new", "iterate", "local", "overhaul"]; // the mode names, needed before MODES to tell `--fresh <step>` from a target
const pos = A.filter((x, i) => !x.startsWith("--") && !VALUE_FLAGS.has(A[i - 1]) && !(A[i - 1] === "--fresh" && /^[a-z][a-z0-9,-]*$/.test(x) && !MODES0.includes(x)));
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
// everything printed is kept, so the run file (G14) can hold the first 40 lines of exactly what the main session saw
const OUTLOG = []; { const _log = console.log; console.log = (...a) => { const s = a.map(String).join(" "); OUTLOG.push(...s.split("\n")); _log(s); }; }

const MODES = ["audit-live", "audit-repo", "audit", "compare", "research", "refactor", "measure", "migrate", "build", "new", "iterate", "local", "overhaul"];
let mode = pos[0];
if (!mode || !MODES.includes(mode)) die(`usage: node start.mjs <${MODES.join("|")}> <target> [<target2>] [--go] [--stage name] [--ack stage --by NAME] [options: see the top of the file]`);
if (mode === "new") mode = "build";
const isUrl = (t) => /^https?:\/\//i.test(String(t || ""));
if (mode === "audit") { if (!pos[1]) die("audit needs a target: a URL (audit-live) or a folder (audit-repo)"); mode = isUrl(pos[1]) ? "audit-live" : "audit-repo"; }
const T1 = pos[1], T2 = pos[2];
if (!T1) die(`${mode} needs a target; see the usage line at the top of start.mjs`);
if (mode === "compare" && !T2) die("compare needs two targets: node start.mjs compare <a> <b>");
if (mode === "migrate" && (!T2 || !isUrl(T1))) die("migrate needs the old site's URL and the new site (a URL or a built folder): node start.mjs migrate <old url> <new url|folder>");
if ((mode === "audit-live" || mode === "measure") && !isUrl(T1)) die(`${mode} needs a URL`);
if (mode === "overhaul") {
  if (!T2 || !isUrl(T1)) die("overhaul needs the live site's URL and the code repo's folder: node start.mjs overhaul <live url> <repo path>");
  if (isUrl(T2) || !fs.existsSync(path.resolve(val("--cwd") || process.cwd(), T2))) die(`overhaul: the repo folder ${T2} does not exist (the second target is the code, not a URL)`);
}
// Git Bash rewrites "^/x" into a Windows path, which turns an exclude into a rule that matches nothing (same refusal as snapshot-site.mjs).
const mangled = [...vals("--exclude"), ...snapPass].filter((x) => /^\^?[A-Za-z]:[\\/]/.test(x) || /[\\/]Program Files[\\/]Git[\\/]/i.test(x));
if (mangled.length) die(`REFUSED: these arguments were rewritten by the shell (Git Bash turns "/x" into a Windows path): ${mangled.join(" | ")}\nRun from PowerShell, or prefix the command with MSYS_NO_PATHCONV=1. Nothing was run.`);

const cwd = path.resolve(val("--cwd") || process.cwd());
const stageDir = path.resolve(val("--stage-scripts") || here);
const timeoutMs = Number(val("--stage-timeout-min", 150)) * 60_000;
const today = val("--today") || new Date().toISOString().slice(0, 10);
const go = flag("--go");
const rel = (p) => String(p).replace(/\\/g, "/");
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");

// ---------------------------------------------------------------- where the run lives
const dirTarget = (t) => { const d = path.resolve(cwd, t); fs.mkdirSync(d, { recursive: true }); return d; };
const sideTarget = (t) => (isUrl(t) ? t : mode === "build" || mode === "research" ? dirTarget(t) : path.resolve(cwd, t));
let loc, locA, locB, runLoc;
if (mode === "compare") {
  locA = locate(sideTarget(T1), { cwd }); locB = locate(sideTarget(T2), { cwd });
  const hostOf = (l) => (l.kind === "url" ? l.host : path.basename(l.root));
  const dir = path.join(cwd, "site-checks", `compare-${hostOf(locA)}-vs-${hostOf(locB)}`);
  fs.mkdirSync(path.join(dir, ".pewp"), { recursive: true });
  if (!fs.existsSync(path.join(dir, ".pewp", ".gitignore"))) fs.writeFileSync(path.join(dir, ".pewp", ".gitignore"), "*\n");
  runLoc = { kind: "repo", target: dir, root: dir, pewp: path.join(dir, ".pewp") }; loc = runLoc;
} else {
  loc = locate(sideTarget(T1), { cwd }); runLoc = loc;
}
// overhaul: the run lives with the live site (site-checks/<host>/.pewp); the code stages (checker, fix run) work in the repo
const repoLoc = mode === "overhaul" ? locate(path.resolve(cwd, T2), { cwd }) : null;
const pewp = runLoc.pewp;
const P = (...x) => path.join(pewp, ...x);
const targetArg = mode === "compare" ? null : (isUrl(T1) ? T1 : loc.root);
const newIsUrl = isUrl(T2);
const newFolder = mode === "migrate" && T2 && !newIsUrl ? path.resolve(cwd, T2) : null;

let st = load(runLoc) || init(runLoc, mode);
// state.mjs ignores only its own files in a repo's .pewp; this script's logs and acknowledgements are run files too.
try { const gi = path.join(pewp, ".gitignore"); const t = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : ""; if (!/^\*$/m.test(t) && !/^start\/$/m.test(t)) fs.writeFileSync(gi, (t && !t.endsWith("\n") ? t + "\n" : t) + "start/\n"); } catch {}
const reload = () => { st = load(runLoc) || st; return st; };
const persist = (fn) => { reload(); fn(st); st.stages = st.stages || {}; save(runLoc, st); };

// Options that shape what a stage does are remembered in state.json (start.options) and applied to every later start of this run, so a
// second --go can never forget an --exclude (a client's off-limits path) or a --no-images. Things that are decisions of the moment (--go,
// --stage, --ack, --by, --yes, --fresh, --today) are never remembered. --forget-options starts the list again from this command line.
const REMEMBER = new Set(["--exclude", "--max-pages", "--gap-ms", "--launch-state", "--launch-state-a", "--launch-state-b", "--competitor", "--focus", "--workers", "--research-args", "--plan-args", "--brief", "--live-url", "--build", "--setup", "--causes", "--people", "--decisions", "--max-workers", "--visual-allow", "--visual-dir", "--property", "--gsc-file", "--gsc-days", "--links-csv", "--overrides", "--home-ok", "--min-score", "--new-origin", "--max-urls", "--snapshot-dir", "--image-scope",
  "--env-file", "--dotenv", "--max-parallel", "--sitemap-url", "--seed-args", "--cc-release"]);
const BOOL_REMEMBER = new Set(["--ignore-robots", "--no-visual", "--no-images", "--fetch-sitemap", "--probe-old", "--include-suggestions", "--no-authority", "--strict", "--no-build", "--offline", "--project-merges", "--owner-merges", "--no-setup"]);
const remembered = [];
{
  const given = [];
  for (let i = 0; i < A.length; i++) { const t = A[i]; if (REMEMBER.has(t)) { given.push([t, A[i + 1]]); i++; } else if (BOOL_REMEMBER.has(t)) given.push([t, null]); else if (VALUE_FLAGS.has(t)) i++; }
  const prev = flag("--forget-options") ? { flags: [], pass: [] } : (st.start && st.start.options) || { flags: [], pass: [] };
  const keys = new Set(given.map(([k]) => k));
  const merged = { flags: [...prev.flags.filter(([k]) => !keys.has(k)), ...given], pass: snapPass.length ? snapPass : prev.pass || [] };
  for (const [k, v] of merged.flags) if (!keys.has(k)) { A = [...A, k, ...(v == null ? [] : [v])]; remembered.push(v == null ? k : `${k} ${v}`); }
  if (!snapPass.length && merged.pass.length) { snapPass = merged.pass; remembered.push(`-- ${merged.pass.join(" ")}`); }
  persist((x) => { x.start = { ...(x.start || {}), options: merged }; });
}

// ---------------------------------------------------------------- keys from a .env file (G1): loaded once here, every stage inherits process.env
// lib-env.mjs: --env-file, else state.json envFile, else ~/.claude/machine.local.json envFile. Names only are ever printed; a value never is.
let envInfo = { file: null, loaded: [], source: "none" };
{
  let lib = null; try { lib = await import("./lib-env.mjs"); } catch {}
  if (lib?.loadEnv) {
    try { envInfo = lib.loadEnv({ envFile: val("--env-file") || val("--dotenv"), pewp, cwd }) || envInfo; }
    catch (e) { die(`--env-file: ${e.message || e}`, 2); }
  } else if (val("--env-file") || val("--dotenv")) die("--env-file given but scripts/lib-env.mjs is not built: nothing loaded. Unblocks: deliver lib-env.mjs (contract C4).", 4);
  if (envInfo.file) console.log(`env: loaded ${envInfo.loaded.length} name(s) from ${rel(envInfo.file)} (${envInfo.source})${envInfo.skipped?.length ? `; already set, kept: ${envInfo.skipped.join(", ")}` : ""}`);
}
// children get --dotenv, never --env-file: Node 24 scans the whole command line for --env-file and exits 9 on a missing file before any script runs
const envArgs = () => (envInfo.file ? ["--dotenv", envInfo.file] : []);

// ---------------------------------------------------------------- hashing of stage inputs (stale detection)
const hashFile = (f) => { try { const s = fs.statSync(f); return s.size > 25e6 ? `big:${s.size}:${Math.round(s.mtimeMs)}` : sha1(fs.readFileSync(f)); } catch { return "absent"; } };
function hashDir(d) {
  const out = [];
  const walk = (x, depth) => {
    if (out.length > 1500 || depth > 6) return;
    let es; try { es = fs.readdirSync(x, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of es) {
      if (/^(node_modules|\.git|\.pewp|\.checks)$/.test(e.name)) continue;
      const f = path.join(x, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else { let s; try { s = fs.statSync(f); } catch { continue; } out.push(`${rel(path.relative(d, f))}:${s.size <= 100_000 && /\.(html?|css|js|mjs|json|txt|xml|_redirects|_headers)$/i.test(e.name) || /^_(redirects|headers)$/.test(e.name) ? hashFile(f) : s.size}`); }
    }
  };
  try { if (!fs.statSync(d).isDirectory()) return "absent"; } catch { return "absent"; }
  walk(d, 0);
  return sha1(out.join("\n"));
}
const gitHead = (repo) => { const r = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 60_000 }); return r.status === 0 ? r.stdout.trim() : "no-git"; };
// spec: a string = a file or folder under <pewp>; { abs } a file/folder; { dir } a folder listing; { git } a repo's HEAD
function inputHash(spec) {
  if (typeof spec === "string") { const f = P(spec); return { label: spec, hash: fs.existsSync(f) && fs.statSync(f).isDirectory() ? hashDir(f) : hashFile(f) }; }
  if (spec.git) return { label: `git HEAD of ${path.basename(spec.git)}`, hash: gitHead(spec.git) };
  if (spec.dir) return { label: rel(spec.dir), hash: hashDir(spec.dir) };
  return { label: rel(spec.abs), hash: fs.existsSync(spec.abs) && fs.statSync(spec.abs).isDirectory() ? hashDir(spec.abs) : hashFile(spec.abs) };
}
function hashInputs(specs) {
  const detail = {}; for (const s of specs) { const h = inputHash(s); detail[h.label] = h.hash; }
  return { hash: sha1(JSON.stringify(Object.entries(detail).sort())), detail };
}

// ---------------------------------------------------------------- stage helpers
const bizCompetitors = () => { try { return (JSON.parse(fs.readFileSync(P("business.json"), "utf8")).competitors || []).map((c) => (typeof c === "string" ? c : c.domain || c.url)).filter(Boolean); } catch { return []; } };
const snapOf = (l) => (l.kind === "url" ? latestComplete(l.snapshots) : null);
const snapDirOf = (l) => snapOf(l)?.dir || null;
const NEVER = (l) => path.join(l.pewp, "__not-yet__"); // an output that does not exist yet
const snapshotArgs = () => {
  const o = [];
  for (const e of vals("--exclude")) o.push("--exclude", e);
  if (flag("--ignore-robots")) o.push("--ignore-robots");
  if (val("--max-pages")) o.push("--max-pages", val("--max-pages"));
  if (val("--gap-ms") && mode !== "migrate") o.push("--gap-ms", val("--gap-ms"));
  return [...o, ...snapPass];
};
const launchArgs = () => (val("--launch-state") ? ["--launch-state", val("--launch-state")] : []);

// A question list for the main session to ask as pickable options (recommended first), written to <pewp>/start/questions.json
function questionsFor(stage, qs) { fs.mkdirSync(P("start"), { recursive: true }); fs.writeFileSync(P("start", "questions.json"), JSON.stringify({ stage, questions: qs }, null, 1) + "\n"); }
function intakeQuestionText(stage, res) {
  let qs = []; try { qs = JSON.parse(fs.readFileSync(P("intake-facts.json"), "utf8")).questions || []; } catch {}
  if (!qs.length) return null;
  const lines = [`NEEDS-INPUT stage=${stage}: ${qs.length} question(s). Ask ALL of them in one batch as pickable options (the first option is the recommended one), write the chosen values to ${rel(P("intake-answers.json"))} as {"<field>": <value>} (a typed "Other" answer is the value; multi-select = an array), then run the same command again.`];
  qs.forEach((q, i) => { lines.push(`${i + 1}. [${q.id}] (${q.field}) ${q.question}`); (q.options || []).forEach((o, j) => lines.push(`   - ${typeof o === "string" ? o : o.label}${o.description ? ` (${o.description})` : ""}${j === (q.recommended ?? 0) ? " [recommended]" : ""}`)); });
  lines.push(`QUESTIONS-JSON ${rel(P("intake-facts.json"))}`);
  return lines.join("\n");
}
const tail = (s, n = 12) => String(s || "").trim().split("\n").slice(-n).map((l) => `  ${l}`).join("\n");

// A stage: { name, kind: script|agent|ack|approval, what, cost, optional, inputs(), outputs(), needs() -> [{id, question, options[]}] | [],
//            cmd() -> { script, args, cwd?, timeoutMin? }, judge(res) -> { outcome: done|needs-input|blocked|fail, message },
//            instruction() (agent/ack), ack: { by: bool, extra }, skipIf() -> reason }
const script = (name, args, extra = {}) => ({ script: name, args, ...extra });

function doctorStage(l, target) {
  return { name: "doctor", kind: "script", what: "which free sources are connected (writes doctor.json; says which env file it loaded)", cost: "free, seconds", inputs: () => (envInfo.file ? [{ abs: envInfo.file }] : []), outputs: () => [path.join(l.pewp, "doctor.json")], cmd: () => script("doctor.mjs", [target, "--cwd", cwd, ...envArgs(), ...(flag("--offline") ? ["--offline"] : [])]) };
}
function snapshotStage(l, name = "snapshot") {
  return { name, kind: "script", external: true, what: `a polite snapshot of ${l.target} with real Chrome phone speed (reused when younger than 7 days; speed is marked UNTRUSTED when the machine was busy)`, cost: "polite crawl: up to 20 pages, one request every 4 s, 3 phone runs each; about 30 to 60 minutes when a new one is taken, seconds when reused",
    inputs: () => [], outputs: () => { const d = snapDirOf(l); return d ? [path.join(d, "_site.json")] : [NEVER(l)]; },
    cmd: () => script("live-target.mjs", [l.target, "--cwd", cwd, ...(flag("--fresh") ? ["--fresh"] : []), ...(val("--max-age-days") ? ["--max-age-days", val("--max-age-days")] : []), ...(snapshotArgs().length ? ["--", ...snapshotArgs()] : [])]),
    judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter(Boolean).pop() } : { outcome: "fail", message: `the polite crawl stopped (a 429 rate limit, the time limit, or a crash): see _site.json stoppedEarly in the newest snapshot folder; wait and run again. ${r.out.split("\n").filter(Boolean).pop() || ""}` }) };
}
function checkerStage(l, name = "checker") {
  const root = () => (l.kind === "url" ? snapDirOf(l) : l.root);
  const dir = () => root() || NEVER(l);
  return { name, kind: "agent", external: true, what: `the checker agent reads ${l.kind === "url" ? "the snapshot" : "the codebase"} against the shipgate checklist and writes .checks/ (root causes first)`,
    cost: "one Sonnet worker (high effort) per slice, cap 12 per run (more = ask the owner first); the main session never reads the code",
    inputs: () => (l.kind === "url" ? [{ abs: path.join(dir(), "_site.json") }] : [{ git: l.root }]),
    outputs: () => [path.join(dir(), ".checks", "REPORT.md"), path.join(dir(), ".checks", "causes.json")],
    instruction: () => {
      const r = rel(dir());
      return [`WAITING-FOR the checker agent (stage=${name}). The main session does this, not this script:`,
        `  1. node "${rel(path.join(stageDir, "plan.mjs"))}" "${r}" --dry     (the worker count: show the owner first; more than 12 = ask)`,
        l.kind === "repo" ? `  2. node "${rel(path.join(stageDir, "guard-readonly.mjs"))}" "${r}" --before   (start did this already if the guard stage is done)` : null,
        `  ${l.kind === "repo" ? 3 : 2}. Start ONE agent: subagent_type "general-purpose", model "sonnet", effort "high", prompt: Read ${rel(path.join(skill, "coordinator.md"))} and follow it exactly. Repo root: ${r}. Focus: ${val("--focus", "everything")}. Max parallel workers: ${val("--workers", 4)}. Return only the short summary it specifies.`,
        `  Then run the same start command again: it sees .checks/REPORT.md and goes on.`].filter(Boolean).join("\n");
    } };
}
function authorityStage(l, name = "authority") {
  return { name, kind: "script", optional: true, what: "authority from the free Common Crawl link graph (optional; BLOCKED when no release is cached)", cost: "free; 15 to 30 minutes of disk reading; needs a Common Crawl release in the cache (about 11 GB, one time)",
    skipIf: () => (flag("--no-authority") ? "--no-authority" : null),
    inputs: () => [], outputs: () => [path.join(l.pewp, "authority.json")],
    cmd: () => { const comps = [...new Set([...vals("--competitor"), ...(() => { try { return JSON.parse(fs.readFileSync(path.join(l.pewp, "business.json"), "utf8")).competitors || []; } catch { return []; } })().map((c) => (typeof c === "string" ? c : c.domain))])].filter(Boolean); return script("authority.mjs", [path.join(l.pewp, "authority.json"), "--target", l.kind === "url" ? l.host : path.basename(l.root), ...comps.flatMap((c) => ["--competitor", c])]); },
    judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "blocked", message: r.out.split("\n").filter(Boolean).pop() || `authority.mjs exited ${r.code}` }) };
}
function guardStage(l, when) {
  return { name: `guard-${when}`, kind: "script", what: when === "before" ? "fingerprint the source before the audit (audit modes never edit it)" : "prove the audit changed no source file", cost: "free, seconds",
    inputs: () => (when === "before" ? [{ git: l.root }] : [{ abs: path.join(l.root, ".checks", "REPORT.md") }]), outputs: () => [],
    cmd: () => script("guard-readonly.mjs", [l.root, `--${when}`]),
    judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter(Boolean).pop() } : { outcome: "fail", message: r.out.split("\n").filter(Boolean).pop() || "the guard failed" }) };
}
function ackStage(name, what, o) {
  return { name, kind: "ack", what, cost: o.cost || "a person decides; no spend", ack: { by: o.by !== false, extra: o.extra }, inputs: o.inputs || (() => []), outputs: () => [], instruction: o.instruction, skipIf: o.skipIf, afterAck: o.afterAck };
}
// approve.mjs kinds (contract C1): targets, plan (the page plan), business (the definition), competitors (the approved list), seeds (the search seeds)
const APPROVE_SOURCE = { targets: "targets.json", plan: "plan/sitemap.json", business: "business.json", competitors: "research/competitors-proposed.json", seeds: "research/seeds.json" };
const APPROVE_COPY = { targets: ["approved", "targets.json"], plan: ["approved", "plan", "sitemap.json"], business: ["approved", "business.json"], competitors: ["approved", "competitors.json"], seeds: ["approved", "seeds.json"] };
function approvalStage(name, what, l, kind, o = {}) {
  const t = mode === "compare" ? null : (isUrl(l.target) ? l.target : l.root);
  const from = o.from ? ["--from", o.from] : [];
  return { name, kind: "approval", what, cost: "a person signs; no spend", inputs: () => o.inputs || [APPROVE_SOURCE[kind]], outputs: () => [P(...APPROVE_COPY[kind]), P("approved", "lock.json")],
    cmd: () => script("approve.mjs", [t, kind, ...from, "--cwd", cwd]),
    judge: (r) => (r.code === 0 ? { outcome: "done", message: "approved copy matches the working file" } : r.code === 3 ? { outcome: "approval", message: `${r.out.trim()}\nNEEDS-APPROVAL stage=${name}: the owner reads the diff above and decides. To sign (the main session records the owner's decision, with the owner's name): node "${rel(path.join(stageDir, "approve.mjs"))}" "${t}" ${kind} ${from.join(" ")} --by "<owner name>"   then run the same start command again.` } : { outcome: r.code === 2 ? "blocked" : "fail", message: r.out.trim().split("\n").slice(-6).join("\n") }) };
}

// ---------------------------------------------------------------- audit-live: the step list is pipeline.json (lib-pipeline.mjs) and nothing else
// A manifest step becomes a stage here; this file keeps no list of audit-live steps of its own (test-pipeline.mjs fails if it ever does).
const PIPELINE_FILE = path.resolve(val("--pipeline") || path.join(skill, "pipeline.json"));
const stripSlash = (p) => String(p).replace(/[\\/]+$/, "");
// {work}: a folder for the checker's headless workers. {runDir}/work, except when {runDir} is under ~/.claude (the outside copy of the skill), where those
// workers cannot write: then <os temp>/pewp-work/<host>.
const underClaude = (p) => { const c = path.resolve(os.homedir(), ".claude").toLowerCase() + path.sep; return (path.resolve(p).toLowerCase() + path.sep).startsWith(c); };
function pipelineVars() {
  return { url: T1, client: val("--client") || null, host: loc.host, skill, runDir: loc.root, pewp: loc.pewp, work: underClaude(loc.root) ? path.join(os.tmpdir(), "pewp-work", loc.host) : path.join(loc.root, "work") };
}
// the evidence of one step; a placeholder without a value (no --client) counts as missing evidence and says why
const evid = (m, since) => { try { const r = evidenceState(m, pipelineVars(), { since }); return { ...r, ok: r.state === "done" }; } catch (e) { return { state: "missing", ok: false, problems: [e.message], evidence: [] }; } };
// What the runner adds to a script's command line from its own options; never part of the manifest. A manifest "--cwd {skill}" is the run
// root: with the run in the skill folder that is the skill folder, and --cwd of this command replaces it, so the script writes where start reads.
const EXTRA_ARGS = {
  "doctor.mjs": () => [...envArgs(), ...(flag("--offline") ? ["--offline"] : [])],
  "live-target.mjs": () => [...(flag("--fresh") ? ["--fresh"] : []), ...(val("--max-age-days") ? ["--max-age-days", val("--max-age-days")] : []), ...(snapshotArgs().length ? ["--", ...snapshotArgs()] : [])],
  "report-live.mjs": () => launchArgs(),
  "research.mjs": () => splitArgs(val("--research-args")),
  "research-seeds.mjs": () => splitArgs(val("--seed-args")),
};
const lastLine = (out) => String(out || "").trim().split("\n").filter(Boolean).pop() || "";
function costOf(m) {
  const bits = [m.hits === "none" ? "free, local" : m.hits === "client" ? "requests to the client's site" : `calls ${m.hits.replace("third-party:", "")}`];
  if (m.pace) bits.push(`pace: ${m.pace}`);
  if (m.timeoutMinutes) bits.push(`up to ${m.timeoutMinutes} min`);
  if (m.needsKeys.length) bits.push(`keys: ${m.needsKeys.join(", ")}`);
  if (m.heavy) bits.push("heavy (one at a time on this laptop)");
  return bits.join("; ");
}
function manifestStage(m) {
  const waits = m.script === null;
  const kind = stepKind(m);
  const ex = (x) => substitute(x, pipelineVars());
  const safe = (arr) => arr.flatMap((x) => { try { return [ex(x)]; } catch { return []; } }); // a placeholder without a value (no --client) leaves the path out; cmd() says why
  const usesWork = JSON.stringify(m).includes("{work}");
  return { name: m.id, kind, manifest: m, dependsOn: m.dependsOn, what: m.what, cost: costOf(m), external: !waits && m.hits !== "none",
    skipIf: () => (m.module === "authority" && flag("--no-authority") ? "--no-authority" : null),
    inputs: () => safe(m.inputs).flatMap((p) => { const g = hasGlob(p) ? globPaths(p) : [p]; return (g.length ? g : [p]).map((abs) => ({ abs })); }),
    outputs: () => safe(m.outputs).map(stripSlash),
    evidence: (since) => evid(m, since),
    prepare: () => { if (usesWork) fs.mkdirSync(pipelineVars().work, { recursive: true }); },
    cmd: () => {
      const raw = m.args.map(ex);
      const args = raw.map((a, i) => (raw[i - 1] === "--cwd" && m.args[i] === "{skill}" ? cwd : a));
      const name = path.basename(m.script);
      return script(name, [...args, ...(EXTRA_ARGS[name] ? EXTRA_ARGS[name]() : [])], m.timeoutMinutes ? { timeoutMin: m.timeoutMinutes } : {});
    },
    // the outcome of a step that ran is lib-pipeline.mjs's stepOutcome (exit 0 ok and then its evidence, 2 usage, 3 BLOCKED, 4 SKIPPED or partial, a NEEDS-INPUT line)
    judge: (r, since) => {
      const o = stepOutcome(m, { code: r.code, lastLine: lastLine(r.out), output: r.out, evidence: r.code === 0 ? evid(m, since) : null });
      if (o.outcome === "needs-input") return { outcome: "needs-input", message: intakeQuestionText(m.id, r) || `NEEDS-INPUT stage=${m.id}: ${tail(r.out, 20)}` };
      if (o.outcome === "fail" && r.code === 2) return { outcome: "fail", message: `usage error (exit 2): the manifest's args do not fit the script: ${tail(r.out, 4)}` };
      if (o.outcome === "fail" && ![0, 3, 4].includes(r.code)) return { outcome: "fail", message: tail(r.out, 15) };
      return o;
    } };
}
function pipelineSequence() {
  const lm = loadManifest(PIPELINE_FILE);
  const scriptExists = (p) => String(p).startsWith("repo:") || fs.existsSync(path.join(stageDir, path.basename(p)));
  const problems = lm.ok ? validateManifest(lm.manifest, { scriptExists }).problems : lm.problems;
  if (problems.length) die(`${rel(PIPELINE_FILE)} is not valid; nothing ran:\n - ${problems.map(describe).join("\n - ")}`, 2);
  return runOrder(lm.manifest).steps.map(manifestStage);
}
const safeList = (arr, vars) => arr.map((x) => { try { return substitute(x, vars); } catch { return x; } }).join(", ");
// ---------------------------------------------------------------- ADOPT (work order 41): a run resumes from where it is, never from scratch (the owner's standing rule)
// A step whose evidence exists (not empty) and whose inputs are older is recorded as adopted: done, exit 0, outcome "adopted", evidenceDate = the evidence's own mtime (not now), and
// not run again. A step whose input is newer than its evidence runs (and so, through its outputs, do its dependents). --adopt <id>[,<id>] is the explicit case: a step that
// cannot be adopted is a refusal (exit 3) and nothing starts. --fresh discards: --fresh alone runs every step again, --fresh <id>[,<id>] those steps (their dependents follow
// through their inputs). Bare --fresh also still tells the snapshot to take a new snapshot.
const idList = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const freshArg = (() => { const i = A.indexOf("--fresh"); const n = i >= 0 ? A[i + 1] : null; return n && /^[a-z][a-z0-9,-]*$/.test(n) && !MODES.includes(n) ? n : null; })();
const freshAll = flag("--fresh") && !freshArg, freshIds = new Set(idList(freshArg));
function tryAdopt(s) {
  let a;
  try { a = adoptStep(s.manifest, { vars: pipelineVars(), now: Date.now() }); } catch (e) { return { ok: false, rule: "error", reason: e.message }; }
  if (!a.ok) return a;
  // doneAt stays "when the step was completed or adopted" (a waiting step's staleness is judged against it: its evidence must be newer than that after an input changes); evidenceDate is the date of the DATA
  markDone(s, {}, { adopted: true, adoptedAt: a.adoptedAt, evidenceDate: a.at, exit: 0, outcome: "adopted", adoptedEvidence: a.evidence });
  RAN.push({ stage: s.name, script: null, args: [], code: 0, out: `adopted: ${a.evidence.map((e) => `${e.path} (${e.mtime})`).join(", ")}`, adopted: a });
  console.log(`${s.name}: adopted (its evidence is from ${a.at}; not run again)`);
  return a;
}
// The waiting steps print their brief; the run goes on with every step that does not depend on one. Exit 0 all done, 1 a step FAILED,
// 3 a step is waiting for a person, an agent or the owner's browser (or needs input), 4 a step is BLOCKED or partial and nothing else can run.
async function runManifestLoop() {
  const settled = new Set(["done", "skipped"]);
  const res = new Map(); // id -> done | skipped | blocked | partial | waiting | held
  const heldBy = new Map(), waiting = [], blockedNotes = [];
  const forced = val("--stage");
  const unknown = [...idList(val("--adopt")), ...freshIds].filter((x) => !byName.has(x));
  if (unknown.length) { console.error(`unknown step id(s) ${unknown.join(", ")}: --adopt and --fresh take ids of the manifest's steps: ${SEQ.map((s) => s.name).join(", ")}`); return 2; }
  if (go && !forced && idList(val("--adopt")).length) {
    const refused = [];
    for (const id of idList(val("--adopt"))) {
      const s = byName.get(id);
      if (statusOf(s).status === "done") { console.log(`${id}: already done, nothing to adopt`); continue; }
      const a = adoptStep(s.manifest, { vars: pipelineVars(), now: Date.now() });
      if (!a.ok) refused.push(a);
    }
    if (refused.length) {
      for (const a of refused) console.log(`ADOPT REFUSED ${a.id}: ${a.reason}`);
      console.log(`BLOCKED: cannot adopt ${refused.map((a) => a.id).join(", ")}: ${refused[0].reason} | unblocks: run the step instead (drop it from --adopt), or restore the older input, or fix its evidence`);
      return 3;
    }
    for (const id of idList(val("--adopt"))) if (statusOf(byName.get(id)).status !== "done") tryAdopt(byName.get(id));
  }
  // a step with `engines` is BLOCKED, never started, while a stop (lib-stops.mjs: a robot check, a 429, a sign-in wall) is in force for one of them; the stop's until and reason are quoted
  const stopBlock = (s, stop) => { persist((x) => { x.stages[s.name] = { blocked: String(stop.message).slice(0, 300), at: new Date().toISOString(), stop: { engine: stop.engine, until: stop.until } }; }); console.log(`${s.name}: BLOCKED: ${stop.message}`); blockedNotes.push(`${s.name}: ${stop.message}`); res.set(s.name, "blocked"); };
  const queue = forced ? [byName.get(forced)] : SEQ;
  setRun("running", queue[0]?.name || null, "");
  if (forced) {
    const s = byName.get(forced);
    const dep = s.dependsOn.filter((d) => statusOf(byName.get(d)).status !== "done");
    if (dep.length) { setRun("waiting-for-dependency", s.name, dep.join(", ")); console.log(`WAITING-FOR stage=${dep[0]}: ${s.name} depends on ${dep.join(", ")}, which ${dep.length > 1 ? "are" : "is"} not done yet. A step never starts before the steps it depends on are done: run the same command without --stage to reach it in order.`); return 3; }
  }
  for (const s of queue) {
    const skip = s.skipIf?.();
    if (skip) { console.log(`${s.name}: skipped (${skip})`); res.set(s.name, "skipped"); continue; }
    const unmet = forced ? [] : s.dependsOn.filter((d) => !settled.has(res.get(d)));
    if (unmet.length) { res.set(s.name, "held"); heldBy.set(s.name, unmet); continue; }
    const isFresh = freshAll || freshIds.has(s.name);
    const status = forced || isFresh ? { status: "pending" } : statusOf(s);
    if (status.status === "pending" && !forced && !isFresh && go) {
      const a = tryAdopt(s);
      if (a.ok) { res.set(s.name, "done"); continue; }
      if (a.rule === "input-newer") console.log(`${s.name}: not adopted (${a.reason}): running it again`);
    }
    if (status.status === "done") { console.log(`${s.name}: done${status.note ? ` (${status.note})` : ""}`); res.set(s.name, status.note.startsWith("skipped") ? "skipped" : "done"); continue; }
    if (status.status === "stale") console.log(`${s.name}: stale (${status.note}): running again`);
    s.prepare?.();
    if (s.kind !== "script") {
      // the evidence makes it done: it exists, is not empty and is newer than the step's last completion (after an input changed, nothing earlier counts)
      const rec = load(runLoc)?.stages?.[s.name];
      const since = Date.parse(rec?.doneAt || 0) || 0;
      const ev = s.evidence(since);
      if (ev.ok && !forced && !isFresh) { markDone(s); console.log(`${s.name}: done (its evidence exists)`); res.set(s.name, "done"); continue; }
      const stopW = stepStop(s.manifest, { mode: s.kind === "browser" ? "desktop" : "script" }); // a person-paced capture in the owner's own browser is freed by a desktop lift
      if (stopW) { stopBlock(s, stopW); continue; }
      res.set(s.name, "waiting"); waiting.push({ s, ev }); continue;
    }
    const stopS = stepStop(s.manifest, { mode: "script" });
    if (stopS) { stopBlock(s, stopS); continue; }
    if (!planAckOf() && s.external) {
      setRun("needs-approval", s.name, "plan-ok");
      console.log(`NEEDS-APPROVAL stage=plan-ok (before ${s.name}): the owner has not seen this run plan (the steps above and their costs; not the page plan). Show it and ask as a pickable option. Then record it:\n  node "${rel(path.join(here, "start.mjs"))}" ${mode} ${JSON.stringify(T1)} --ack plan-ok --by "<owner name>"   (or pass --yes with --go when the owner already said yes in words). Nothing external ran.`);
      return 3;
    }
    let c;
    try { c = s.cmd(); } catch (e) { setRun("needs-input", s.name, e.message); console.log(`NEEDS-INPUT stage=${s.name}: ${e.message}`); return 3; }
    console.log(`${s.name}: running scripts/${c.script} ${c.args.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ").slice(0, 200)}`);
    const t0 = Date.now();
    const out = await runScript(c, s.name);
    RAN.push({ stage: s.name, script: c.script, args: c.args, code: out.code, out: out.out });
    const v = out.notBuilt ? { outcome: "blocked", message: out.out } : out.timedOut ? { outcome: "fail", message: `timed out after ${c.timeoutMin || timeoutMs / 60_000} min` } : s.judge(out, t0);
    if (v.outcome === "done") { markDone(s); console.log(`${s.name}: done${v.message ? `. ${v.message}` : ""}`); res.set(s.name, "done"); continue; }
    if (v.outcome === "skipped") { markDone(s, {}, { skipped: String(v.message).slice(0, 300) }); console.log(`${s.name}: SKIPPED: ${v.message}`); res.set(s.name, "skipped"); continue; }
    if (v.outcome === "blocked") { persist((x) => { x.stages[s.name] = { blocked: String(v.message).slice(0, 300), at: new Date().toISOString() }; }); console.log(`${s.name}: BLOCKED: ${v.message}`); blockedNotes.push(`${s.name}: ${v.message}`); res.set(s.name, "blocked"); continue; }
    if (v.outcome === "partial") { persist((x) => { x.stages[s.name] = { partial: String(v.message).slice(0, 300), at: new Date().toISOString() }; }); console.log(`${s.name}: PARTIAL: ${v.message} (what was read is kept; run again to continue)`); blockedNotes.push(`${s.name}: partial, ${v.message}`); res.set(s.name, "partial"); continue; }
    if (v.outcome === "needs-input") { setRun("needs-input", s.name, ""); console.log(v.message); return 3; }
    setRun("failed", s.name, v.message); console.log(`FAILED stage=${s.name}: ${v.message}`); return 1;
  }
  const after2 = SEQ.map((x) => ({ s: x, ...statusOf(x) }));
  persist((x) => { for (const r of after2) if (x.stages[r.s.name]) { if (r.status === "stale") x.stages[r.s.name].stale = { markedAt: new Date().toISOString(), changed: r.changed }; else delete x.stages[r.s.name].stale; } });
  if (forced) { const stale = after2.filter((r) => r.status === "stale").map((r) => r.s.name); if (stale.length) console.log(`marked stale in state.json (their inputs changed): ${stale.join(", ")}; the next start --go re-runs them`); }
  if (waiting.length) {
    const first = waiting[0].s;
    setRun(first.kind === "person" ? "needs-approval" : first.kind === "browser" ? "waiting-for-browser" : "waiting-for-agent", first.name, waiting.map((w) => w.s.name).join(", "));
    for (const { s, ev } of waiting) {
      const m = s.manifest, vars = pipelineVars();
      const head = s.kind === "person" ? `NEEDS-APPROVAL stage=${s.name}: ${m.what}` : s.kind === "browser" ? `WAITING-FOR the owner's browser (stage=${s.name}): ${m.what}` : `WAITING-FOR an agent (stage=${s.name}): ${m.what}`;
      let brief = m.brief; try { brief = substitute(m.brief, vars); } catch {}
      console.log([head, `  brief: ${brief}`, ...(m.pace ? [`  pace: ${m.pace}`] : []), `  evidence it must leave: ${safeList(m.evidence, vars)}`, `  now: ${ev.problems.slice(0, 2).join("; ")}`].join("\n"));
    }
    if (blockedNotes.length) console.log(`BLOCKED (the steps that do not depend on them went on): ${blockedNotes.join(" | ")}`);
    console.log(`${waiting.length} step(s) wait. When their evidence is written, run the same command again: it picks them up and goes on.`);
    return 3;
  }
  if (blockedNotes.length) {
    setRun("blocked", blockedNotes[0].split(":")[0], blockedNotes.join(" | "));
    console.log(`BLOCKED: ${blockedNotes.join(" | ")}\n${[...heldBy].map(([k, v]) => `${k} waits for ${v.join(", ")}`).join("; ")}`);
    return 4;
  }
  if (forced) { console.log("stage finished."); return 0; }
  setRun("done", null, "all steps done"); console.log("ALL STAGES DONE."); return 0;
}

// ---------------------------------------------------------------- the sequences
function sequence() {
  const S = [];
  if (mode === "audit-live") {
    S.push(...pipelineSequence());
  } else if (mode === "audit-repo") {
    S.push(doctorStage(loc, loc.root), guardStage(loc, "before"), checkerStage(loc), guardStage(loc, "after"));
  } else if (mode === "compare") {
    for (const [tag, l, t] of [["a", locA, T1], ["b", locB, T2]]) {
      if (l.kind === "url") S.push(snapshotStage(l, `snapshot-${tag}`));
      S.push(checkerStage(l, `checker-${tag}`));
    }
    S.push(authorityStage(locA, "authority-a"), authorityStage(locB, "authority-b"));
    const sideInputs = (l) => [...(l.kind === "url" ? [{ abs: path.join(snapDirOf(l) || P("none"), "_site.json") }, { abs: path.join(snapDirOf(l) || P("none"), ".checks", "causes.json") }] : [{ abs: path.join(l.root, ".checks", "causes.json") }]), { abs: path.join(l.pewp, "authority.json") }, { abs: path.join(l.pewp, "business.json") }];
    S.push({ name: "compare", kind: "script", what: "side-by-side comparison (compare.md and compare.json); reads the snapshots and checks, never crawls", cost: "free, seconds", inputs: () => [...sideInputs(locA), ...sideInputs(locB)], outputs: () => [path.join(runLoc.root, "compare.md"), path.join(runLoc.root, "compare.json")],
      cmd: () => script("compare.mjs", [T1, T2, "--cwd", cwd, ...(val("--launch-state-a") ? ["--launch-state-a", val("--launch-state-a")] : []), ...(val("--launch-state-b") ? ["--launch-state-b", val("--launch-state-b")] : []), ...(flag("--strict") ? ["--strict"] : [])]) });
  } else if (mode === "research") {
    S.push(doctorStage(loc, targetArg),
      { name: "intake", kind: "script", what: "who the client is (business.json); asks the owner only what it cannot find", cost: "free; reads the site and your answers",
        inputs: () => ["intake-answers.json"], outputs: () => [P("business.json")], cmd: () => script("intake.mjs", [targetArg, "--cwd", cwd]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter(Boolean).pop() } : r.code === 3 ? { outcome: "needs-input", message: intakeQuestionText("intake", r) || `NEEDS-INPUT stage=intake: ${tail(r.out)}` } : { outcome: "fail", message: tail(r.out) }) },
      // G3: the seeds are proposed and approved by the owner before research spends a call on them (research.mjs refuses otherwise, unless --yes is in --research-args)
      { name: "seeds-propose", kind: "script", what: "search seeds proposed from the definition's vocabulary and places (research/seeds.json, each with where it came from); nothing is fetched", cost: "free",
        inputs: () => ["business.json"], outputs: () => [P("research", "seeds.json")], cmd: () => script("research-seeds.mjs", [targetArg, "--cwd", cwd, ...splitArgs(val("--seed-args"))]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 ? { outcome: "needs-input", message: tail(r.out, 20) } : { outcome: "fail", message: tail(r.out) }) },
      approvalStage("approve-seeds", "OWNER approves the seeds (the searches we will measure demand for); research refuses to spend calls on unapproved seeds", loc, "seeds"),
      { name: "research-plan", kind: "script", what: "the research plan and its external-call count (dry run: nothing is fetched)", cost: "free; prints the plan", inputs: () => ["business.json", "approved/seeds.json"], outputs: () => [P("start", "research-plan.log")], logOutput: "research-plan.log",
        cmd: () => script("research.mjs", [targetArg, "--cwd", cwd, "--dry", ...splitArgs(val("--research-args"))]), judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 ? { outcome: "blocked", message: tail(r.out) } : { outcome: "fail", message: tail(r.out) }) },
      { ...researchStage(targetArg), inputs: () => ["business.json", "approved/seeds.json", "captures/serp"] });
  } else if (mode === "refactor") {
    const dryArgs = () => [loc.root, ...(val("--build") ? ["--build", val("--build")] : ["--no-build"]), ...(val("--setup") ? ["--setup", val("--setup")] : []), ...(val("--causes") ? ["--causes", val("--causes")] : []), ...(val("--people") ? ["--people", val("--people")] : []), ...vals("--decisions").flatMap((d) => ["--decisions", d]), ...(val("--max-workers") ? ["--max-workers", val("--max-workers")] : [])];
    const buildNeeds = () => (val("--build") || flag("--no-build") ? [] : [{ id: "build", question: "Which command regenerates the site? A check proves nothing without a rebuild. Look in the README or package.json (for example `node _build/build.mjs`); a site with no generator is `--no-build`.", options: ["a build command from the README or package.json (recommended when one exists)", "none: the site has no generator (--no-build)"] }]);
    const rfArgs = () => [...dryArgs(), ...(flag("--yes") ? ["--yes"] : []), ...(flag("--no-visual") ? [] : ["--visual"]), ...(val("--visual-dir") ? ["--visual-dir", val("--visual-dir")] : []), ...vals("--visual-allow").flatMap((a) => ["--visual-allow", a])];
    S.push(doctorStage(loc, loc.root), guardStage(loc, "before"), checkerStage(loc), guardStage(loc, "after"),
      { name: "refactor-dry", kind: "script", what: "the refactor plan: how many fix workers, which causes are skipped (nothing is changed)", cost: "free; prints the worker count (cap 12 per run, 3 at once, 30 minutes each, Sonnet high effort)", inputs: () => [{ abs: path.join(loc.root, ".checks", "causes.json") }, { git: loc.root }], outputs: () => [P("start", "refactor-dry.log")], logOutput: "refactor-dry.log",
        needs: buildNeeds, cmd: () => script("refactor.mjs", [...dryArgs(), "--dry"]), judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "fail", message: tail(r.out) }) },
      ackStage("refactor-ok", "the owner agrees to the worker count and the cost of the refactor run", { inputs: () => ["start/refactor-dry.log"], cost: "Sonnet fix workers, high effort: up to 12 per run (3 at once, 30 minutes each)",
        instruction: () => `NEEDS-APPROVAL stage=refactor-ok: show the owner the plan below (workers and what is skipped), then ask as a pickable option whether to run it. If yes, the main session records it:\n  node "${rel(path.join(here, "start.mjs"))}" refactor "${rel(loc.root)}" --ack refactor-ok --by "<owner name>"\n${(() => { try { return fs.readFileSync(P("start", "refactor-dry.log"), "utf8").split("\n").map((l) => "    " + l).slice(0, 14).join("\n"); } catch { return ""; } })()}` }),
      { name: "refactor", kind: "script", external: true, what: "one worktree and fix worker per root cause: fix the generator, rebuild, every check FAIL->PASS with no regression; REF-009 screenshots before and after; nothing merged", cost: "up to 12 Sonnet fix workers (3 at once, 30 minutes each); can run 1 to 3 hours: run it in the background",
        inputs: () => [{ abs: path.join(loc.root, ".checks", "causes.json") }, "start/refactor-dry.log", "start/ack-refactor-ok"], outputs: () => [], needs: buildNeeds, cmd: () => script("refactor.mjs", rfArgs(), { timeoutMin: 300 }),
        judge: (r) => { const last = r.out.split("\n").filter((l) => /^REFACTOR /.test(l)).pop(); return r.code === 0 ? { outcome: "done", message: last || "" } : { outcome: "fail", message: `${last || tail(r.out)}\nThe run is not safe to use or the combined branch regressed a check: read .pewp/refactor/<run>.md.` }; } },
      ackStage("refactor-merge", "the owner reviews the branch and the REF-009 pictures, then decides to merge (start never merges, pushes or deploys)", { inputs: () => [], by: true,
        instruction: () => `NEEDS-APPROVAL stage=refactor-merge: the owner reads .pewp/refactor/<run>.md (and the visual pictures under .pewp/refactor/<run>/visual/diff/ if any) and decides in words. Nothing was merged. When the owner has merged or rejected it, record it:\n  node "${rel(path.join(here, "start.mjs"))}" refactor "${rel(loc.root)}" --ack refactor-merge --by "<owner name>"` }));
  } else if (mode === "measure") {
    const todayDir = (f) => P("measure", today, f);
    S.push(doctorStage(loc, T1),
      { name: "measure-init", kind: "script", what: "set up measuring once (measure/config.json and run.mjs; needs the Search Console property for real searches)", cost: "free, seconds", inputs: () => [], outputs: () => [P("measure", "config.json"), P("measure", "run.mjs")],
        cmd: () => script("measure.mjs", [T1, "--init", ...(val("--property") ? ["--property", val("--property")] : []), "--cwd", cwd]) },
      { name: "measure-plan", kind: "script", what: "what this measure run will call and how many calls (nothing is fetched)", cost: "free; caps: 80 API calls, 60 AI answers, 20 URL inspections per run", inputs: () => ["measure/config.json"], outputs: () => [P("start", "measure-plan.log")], logOutput: "measure-plan.log",
        cmd: () => script("measure.mjs", [T1, "--plan", "--today", today, "--cwd", cwd]) },
      { name: "measure-run", kind: "script", external: true, what: "rankings, citations, Search Console, CrUX, index, AI answers, diff against the last run (BLOCKED parts are results, listed in summary.json)", cost: "free sources; within the call caps above",
        inputs: () => ["measure/config.json", "targets.json"], outputs: () => [todayDir("summary.json")], cmd: () => script("measure.mjs", [T1, "--today", today, "--cwd", cwd, ...(flag("--fresh") ? ["--fresh"] : [])]) },
      { name: "iterate", kind: "script", optional: true, what: "proposals from the last two measure runs (they need approval again); BLOCKED until two runs and approved files exist", cost: "free, seconds",
        inputs: () => [todayDir("summary.json").replace(pewp + path.sep, ""), "approved/lock.json"], outputs: () => [P("iterate", "report.md")], cmd: () => script("iterate.mjs", [T1, "--cwd", cwd, "--today", today]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 2 ? { outcome: "blocked", message: tail(r.out, 4) } : { outcome: "fail", message: tail(r.out) }) });
  } else if (mode === "migrate") {
    const mArgs = (stageName, extra = []) => [T1, T2, "--stage", stageName, "--cwd", cwd, "--today", today, ...(val("--gsc-file") ? ["--gsc-file", val("--gsc-file")] : []), ...(val("--gsc-days") ? ["--gsc-days", val("--gsc-days")] : []), ...(val("--links-csv") ? ["--links-csv", val("--links-csv")] : []), ...(flag("--fetch-sitemap") ? ["--fetch-sitemap"] : []), ...(val("--overrides") ? ["--overrides", val("--overrides")] : []), ...(val("--home-ok") ? ["--home-ok", val("--home-ok")] : []), ...(val("--min-score") ? ["--min-score", val("--min-score")] : []), ...(val("--new-origin") ? ["--new-origin", val("--new-origin")] : []), ...(val("--gap-ms") ? ["--gap-ms", val("--gap-ms")] : []), ...(val("--max-urls") ? ["--max-urls", val("--max-urls")] : []), ...vals("--exclude").flatMap((e) => ["--exclude", e]), ...(val("--snapshot-dir") ? ["--snapshot-dir", val("--snapshot-dir")] : []), ...extra];
    const M = (f) => P("migrate", f);
    const newInput = () => (newFolder ? [{ dir: newFolder }] : []);
    const cutoverDate = () => (load(runLoc)?.stages?.cutover?.ack?.date) || val("--cutover-date");
    S.push(snapshotStage(loc, "snapshot-old"),
      { name: "inventory", kind: "script", external: true, what: "every old URL: old snapshot + sitemap + Search Console pages + pages with links", cost: "free; Search Console and links exports are optional inputs (BLOCKED parts are listed)", inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }, ...(val("--gsc-file") ? [{ abs: val("--gsc-file") }] : []), ...(val("--links-csv") ? [{ abs: val("--links-csv") }] : [])], outputs: () => [M("inventory.json")], cmd: () => script("migrate.mjs", mArgs("inventory", flag("--probe-old") ? ["--probe-old"] : [])) },
      { name: "map", kind: "script", external: true, what: "the redirect map old -> new (one hop 301, no chains, nothing to the homepage), _redirects, carry-over", cost: "free; a new URL is read through its sitemap (polite, cached)", inputs: () => ["migrate/inventory.json", ...newInput()], outputs: () => [M("redirect-map.json"), M("redirect-map.csv"), M("_redirects")], cmd: () => script("migrate.mjs", mArgs("map", flag("--include-suggestions") ? ["--include-suggestions"] : [])) },
      ackStage("map-review", "the owner reviews the suggested redirects in redirect-map.csv (a guess is never applied until approved)", { inputs: () => ["migrate/redirect-map.csv"], by: true,
        instruction: () => { let s = ""; try { const m = JSON.parse(fs.readFileSync(M("redirect-map.json"), "utf8")).summary; s = `${m.total} old addresses: ${m.same} same path, ${m.needsReview} guesses to approve, ${m.noTarget} with no target, ${m.gone410} 410 candidates. `; } catch {} return `NEEDS-APPROVAL stage=map-review: ${s}The owner opens ${rel(M("redirect-map.csv"))}, sets approved to yes or no on each guess (or gives a target), and says so. Then record it:\n  node "${rel(path.join(here, "start.mjs"))}" migrate "${T1}" "${T2}" --ack map-review --by "<owner name>"   (re-run the map first if the csv changed: start does that by itself)`; } }),
      { name: "baseline", kind: "script", external: true, what: "pre-cutover baseline: traffic per page, old statuses, rankings, AI citations, authority", cost: "free sources", inputs: () => ["migrate/inventory.json", "migrate/redirect-map.json"], outputs: () => [M(`baseline-${today}.json`)], cmd: () => script("migrate.mjs", mArgs("baseline")) },
      { name: "service-workers", kind: "script", external: true, what: "REF-013: every service worker the old site registered is retired on the new site (a self-unregistering worker at the same URL, or Clear-Site-Data)", cost: "free; reads the old snapshot and the new folder (or 2 requests to a new origin)",
        inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }, ...newInput()], outputs: () => [M("serviceworkers-check.json")],
        needs: () => (!newFolder && !newIsUrl ? [] : []),
        cmd: () => script("ref-sw.mjs", ["check", snapDirOf(loc) || "", ...(newFolder ? ["--new-site", newFolder] : ["--new-origin", val("--new-origin") || T2, ...(isLoopbackUrl(val("--new-origin") || T2) ? [] : ["--allow-remote"])]), "--out", M("")]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").find((l) => /^# /.test(l)) || "" } : { outcome: "fail", message: `REF-013: an old service worker is not retired on the new site.\n${tail(r.out, 10)}` }) },
      { name: "gate", kind: "script", external: true, what: "every old URL with traffic or links resolves in ONE hop (301/308) to a 200 on the new site; REF-014: every old image URL keeps working", cost: "one request per URL per second (cap 500 URLs, 2000 images); GET only; stops at the first 429",
        inputs: () => ["migrate/redirect-map.json", "start/ack-map-review", ...newInput()], outputs: () => [M(`gate-${today}.json`)],
        needs: () => (newFolder && !val("--new-origin") ? [{ id: "new-origin", question: "The new site is a folder. Where is it running (a preview or the live new site) so the gate can request the old URLs? Give --new-origin <url>.", options: ["the preview URL of the new site (recommended)", "the live new site's URL after cutover"] }] : []),
        cmd: () => script("migrate.mjs", mArgs("gate", [...(flag("--no-images") ? [] : ["--images"]), ...(val("--image-scope") ? ["--image-scope", val("--image-scope")] : [])])),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter((l) => /^gate:|^images:/.test(l)).join("\n") } : r.code === 3 ? { outcome: "blocked", message: `STOPPED at a 429 (rate limit): nothing concluded. Wait, then run the gate again.\n${tail(r.out, 4)}` } : { outcome: "fail", message: `The gate failed: ${r.out.split("\n").filter((l) => /^gate:|^images:|^FAIL/.test(l)).slice(0, 12).join("\n")}\nSee ${rel(M(`gate-${today}.md`))}.` }) },
      ackStage("cutover", "the owner switches the live site to the new one and gives the date", { by: true, extra: "--cutover-date YYYY-MM-DD",
        instruction: () => `NEEDS-APPROVAL stage=cutover: the gate passed. The owner switches the live site (hosting or DNS) to the new one. Do not do this for them. When it is done, record the date:\n  node "${rel(path.join(here, "start.mjs"))}" migrate "${T1}" "${T2}" --ack cutover --by "<owner name>" --cutover-date YYYY-MM-DD` }),
      { name: "monitor", kind: "script", what: "for 28 days after the cutover: compare the latest measure run with the baseline", cost: "free; needs a measure run each day (mode measure)", inputs: () => [], outputs: () => [M(`monitor-${today}.json`)],
        cmd: () => script("migrate.mjs", mArgs("monitor", cutoverDate() ? ["--cutover", cutoverDate()] : [])),
        judge: (r) => (r.code === 0 ? (fs.existsSync(M(`monitor-${today}.json`)) ? { outcome: "done", message: r.out.split("\n").filter((l) => /^monitor:/.test(l)).join("\n") } : { outcome: "blocked", message: r.out.split("\n").filter((l) => /^monitor:/.test(l)).join("\n") || "no monitor result (run measure first)" }) : { outcome: "fail", message: tail(r.out) }) });
  } else if (mode === "build") {
    const dir = loc.root; const siteDir = path.resolve(val("--site") || path.join(dir, "site"));
    S.push(doctorStage(loc, dir),
      { name: "intake", kind: "script", what: "business.json from the brief; asks the owner only what it cannot find", cost: "free", prepare: () => { if (val("--brief") && fs.existsSync(val("--brief"))) { fs.mkdirSync(pewp, { recursive: true }); fs.copyFileSync(val("--brief"), P("brief.txt")); } },
        inputs: () => ["intake-answers.json", "brief.txt"], outputs: () => [P("business.json")], cmd: () => script("intake.mjs", [dir, "--cwd", cwd]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 ? { outcome: "needs-input", message: intakeQuestionText("intake", r) || `NEEDS-INPUT stage=intake: ${tail(r.out)}` } : { outcome: "fail", message: tail(r.out) }) },
      researchStage(dir, "business.json"),
      { name: "plan", kind: "script", what: "the site plan: one cluster = one page, briefs, priorities, off-site plan", cost: "free", inputs: () => ["business.json", "targets.json"], outputs: () => [P("plan", "sitemap.json")], cmd: () => script("plan-site.mjs", [pewp, ...splitArgs(val("--plan-args"))]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: r.code === 2 ? "blocked" : "fail", message: tail(r.out) }) },
      approvalStage("approve-targets", "the owner signs the targets (what the site must be found for)", loc, "targets", { inputs: ["targets.json"] }),
      approvalStage("approve-plan", "the owner signs the plan (the pages to build)", loc, "plan", { inputs: ["plan/sitemap.json", "approved/targets.json"] }),
      { name: "handoff", kind: "script", what: "the builder's spec: HANDOFF.md and builder-prompt.md from the approved plan", cost: "free", inputs: () => ["plan/sitemap.json", "business.json", "approved/lock.json"], outputs: () => [P("builder", "HANDOFF.md"), P("builder", "builder-prompt.md")], cmd: () => script("build-site.mjs", [dir, "--go"]),
        judge: (r) => (/WAITING-FOR-BUILDER|^handoff:/m.test(r.out) || r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 || r.code === 4 ? { outcome: r.code === 3 ? "needs-input" : "blocked", message: r.out.split("\n").slice(-10).join("\n") } : { outcome: "fail", message: tail(r.out) }) },
      ackStage("builder", "a builder session builds the site from the briefs into the site folder", { by: false, extra: "--site <built folder>", inputs: () => ["builder/HANDOFF.md"],
        instruction: () => `WAITING-FOR the builder session (stage=builder). Start it with the prompt in ${rel(P("builder", "builder-prompt.md"))} (spec: ${rel(P("builder", "HANDOFF.md"))}). When it reports its gate passes, record it:\n  node "${rel(path.join(here, "start.mjs"))}" build "${rel(dir)}" --ack builder --site "${rel(siteDir)}"` }),
      { name: "gate", kind: "script", what: "deterministic checks of the built site against the approved targets and plan (--strict at launch)", cost: "free, seconds", inputs: () => ["approved/lock.json", "start/ack-builder"],
        outputs: () => [], cmd: () => script("build-site.mjs", [dir, "--go", "--builder-done", "--site", (load(runLoc)?.stages?.builder?.ack?.site) || siteDir, ...(flag("--strict") ? ["--strict"] : []), ...(val("--live-url") ? ["--live-url", val("--live-url")] : [])]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter((l) => /^gate:|^STATUS/.test(l)).join("\n") } : { outcome: "fail", message: `${r.out.split("\n").slice(0, 20).join("\n")}` }) },
      { name: "measure", kind: "final", what: "post-launch measurement (needs the live site and Search Console access)", cost: "free sources", needs: () => (val("--live-url") ? [] : [{ id: "launch", unmet: true }]) });
  } else if (mode === "iterate") {
    S.push({ name: "iterate", kind: "script", what: "proposals from the last two measure runs (significance rules); proposals need approval again", cost: "free, seconds", inputs: () => ["approved/lock.json"], outputs: () => [P("iterate", "report.md")], cmd: () => script("iterate.mjs", [targetArg, "--cwd", cwd, "--today", today]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 2 ? { outcome: "blocked", message: `iterate cannot judge: ${tail(r.out, 4)}\nUnblocks: two measure runs (mode measure) and approved targets and plan (approve.mjs).` } : { outcome: "fail", message: tail(r.out) }) },
    approvalStage("approve-proposals-targets", "the owner signs the proposed target changes", loc, "targets", { from: "proposals", inputs: ["proposals/targets.json"] }),
      approvalStage("approve-proposals-plan", "the owner signs the proposed plan changes", loc, "plan", { from: "proposals", inputs: ["proposals/plan/deltas.json"] }));
  } else if (mode === "local") {
    S.push(doctorStage(loc, targetArg), { name: "local", kind: "script", what: "Business Profile import, map-pack captures, NAP check, review gap", cost: "free; captures are made by hand by the owner's browser", inputs: () => ["business.json"], outputs: () => [], cmd: () => script("local-run.mjs", [targetArg, "--cwd", cwd, "--today", today, ...(val("--site") ? ["--site", val("--site")] : [])]) });
  } else if (mode === "overhaul") {
    S.push(...overhaulSequence());
  }
  return S;
}

// ---------------------------------------------------------------- overhaul: fix an existing live site end to end (stages/overhaul.md)
// 14 steps in a fixed order; a stage never starts while an earlier stage it depends on is not done or not approved (its inputs name the
// approved copies). OWNER stops: the business definition, the competitor list, the seeds, the targets and the page plan, the fix run and
// its merge, the builder, the deploy. Nothing is submitted to a search engine before the sitemap file passes its check.
function overhaulSequence() {
  const S = [];
  const R = repoLoc; const repo = R.root;
  const snapCauses = () => path.join(snapDirOf(loc) || P("none"), ".checks", "causes.json");
  const approvedDomains = () => { try { return (JSON.parse(fs.readFileSync(P("approved", "competitors.json"), "utf8")).rows || []).map((r) => r.domain).filter(Boolean); } catch { return []; } };
  const judgeCode = (okMsg) => (r) => (r.code === 0 ? { outcome: "done", message: okMsg ? okMsg(r) : "" } : r.code === 3 ? { outcome: "needs-input", message: tail(r.out, 30) } : r.code === 4 || r.code === 2 ? { outcome: "blocked", message: tail(r.out, 8) } : { outcome: "fail", message: tail(r.out) });
  // the authority follow-ups are skipped when authority itself was BLOCKED or skipped (no authority.json); any non-zero exit of theirs is BLOCKED, not a stop
  const skipNoAuthority = () => (flag("--no-authority") ? "--no-authority" : !fs.existsSync(P("authority.json")) ? "authority BLOCKED or skipped (no authority.json)" : null);
  // a cap or a stop ends these exit 0 with the last line `PARTIAL: <why>` (read by lib-pipeline's stepOutcome, the one rule): partial, run again; exit 0 without it is done
  const judgeOptional = (r) => {
    if (r.code !== 0) return { outcome: "blocked", message: tail(r.out, 4) };
    const o = stepOutcome(null, { code: 0, lastLine: lastLine(r.out) });
    return o.outcome === "partial" ? { outcome: "partial", message: o.message } : { outcome: "done", message: "" };
  };
  // 1 doctor, 2 audit-live
  S.push(doctorStage(loc, T1), snapshotStage(loc),
    { name: "psi", kind: "script", external: true, optional: true, what: "PageSpeed Insights (Google's own machines) for the measured pages, next to the lab numbers; the trusted speed when this laptop was busy", cost: "free API key (PSI_API_KEY); 1 request every 2 s, 2 per page",
      skipIf: () => (process.env.PSI_API_KEY ? null : "PSI_API_KEY not set (doctor says how)"),
      inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }], outputs: () => [P("psi", `${today}.json`)],
      cmd: () => { let urls = [T1]; try { urls = (JSON.parse(fs.readFileSync(path.join(snapDirOf(loc), "_site.json"), "utf8")).pages || []).map((p) => p.url).filter(Boolean).slice(0, 20); } catch {} return script("psi.mjs", [...urls, "--cwd", cwd, "--today", today]); },
      judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "blocked", message: tail(r.out, 4) }) },
    checkerStage(loc, "checker-live"),
    { name: "report-live", kind: "script", what: "the six-question report of the live site in plain words (report.md), every number sourced (report.json), the date of the doctor result it used", cost: "free, seconds",
      inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }, { abs: snapCauses() }, "authority.json", "business.json", "doctor.json", "psi"], outputs: () => [P("report.md"), P("report.json")],
      cmd: () => script("report-live.mjs", [T1, "--cwd", cwd, ...launchArgs()]) });
  // 3 the business definition, approved by the owner
  S.push({ name: "intake", kind: "script", what: "who the business is (business.json): what it is, what it is not, who pays, who reads, markets, vocabulary; the script asks the owner only what the site does not say, and records who answered each field", cost: "free; the owner answers, the main session records (never answers for the owner)",
      inputs: () => ["intake-answers.json"], outputs: () => [P("business.json")], cmd: () => script("intake.mjs", [T1, "--cwd", cwd, "--require-vocabulary"]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter(Boolean).pop() } : r.code === 3 ? { outcome: "needs-input", message: intakeQuestionText("intake", r) || `NEEDS-INPUT stage=intake: ${tail(r.out)}` } : { outcome: "fail", message: tail(r.out) }) },
    { name: "classify", kind: "script", what: "what the business IS, on one screen (business-definition.md): the kind of business and which industry pack applies, what it is and is not, who pays, who reads, markets, vocabulary, and who answered each field; a field missing or not answered by the owner stops here", cost: "free, seconds",
      inputs: () => ["business.json"], outputs: () => [P("business-definition.md")], cmd: () => script("classify-business.mjs", [T1, "--cwd", cwd]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter((l) => /^- Kind of business/.test(l)).join("") } : r.code === 3 ? { outcome: "needs-input", message: `NEEDS-INPUT stage=classify: ${r.out.split("\n").filter((l) => /^(NEEDS-INPUT|BLOCKED)/.test(l)).join(" ") || tail(r.out, 6)}` } : { outcome: "fail", message: tail(r.out) }) },
    approvalStage("approve-business", "OWNER approves the business definition (the one screen in business-definition.md); refused when an owner-only field was not answered by the owner", loc, "business", { inputs: ["business.json", "business-definition.md"] }));
  // 4 competitors of every kind, approved by the owner
  S.push({ name: "competitors-discover", kind: "script", what: "competitors of every kind from the approved definition: websites that rank, Instagram / TikTok / YouTube / Substack accounts, paid media, agencies, brokerage programs; one evidence URL and a closeness per row (the main session's discovery agents write the candidates; the script checks and lists them)", cost: "discovery agents (Sonnet) when candidates are missing; the script itself is free",
      inputs: () => ["approved/business.json", "inputs", "research/competitors-candidates.json"], outputs: () => [P("research", "competitors-proposed.json"), P("research", "competitors-proposed.md")],
      cmd: () => script("competitors-discover.mjs", [T1, "--cwd", cwd]),
      judge: judgeCode((r) => r.out.split("\n").filter(Boolean).pop()) },
    approvalStage("approve-competitors", "OWNER approves the competitor list (research/competitors-proposed.md); only approved rows feed the competitor audit and the link graph; social accounts without a domain stay in the report and the off-site plan", loc, "competitors"),
    { name: "authority-prepare", kind: "script", optional: true, what: "prepare the Common Crawl release early (download only; the same for any competitor list); nothing is compared or reported here", cost: "free; about 11 GB once, reused for every later run; BLOCKED when no release is cached and none is given with --release",
      skipIf: () => (flag("--no-authority") ? "--no-authority" : null), inputs: () => [], outputs: () => [],
      cmd: () => script("authority.mjs", [P("authority.json"), "--target", loc.host, "--download-only", ...(val("--cc-release") ? ["--release", val("--cc-release")] : [])]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "blocked", message: r.out.split("\n").filter(Boolean).pop() || `authority.mjs exited ${r.code}` }) });
  // 5 research end to end: seeds proposed and approved first
  S.push({ name: "seeds-propose", kind: "script", what: "search seeds proposed from the definition's vocabulary and places (research/seeds.json, each with where it came from); nothing is fetched", cost: "free",
      inputs: () => ["approved/business.json", "approved/competitors.json"], outputs: () => [P("research", "seeds.json")],
      cmd: () => script("research-seeds.mjs", [T1, "--cwd", cwd, ...splitArgs(val("--seed-args"))]), judge: judgeCode() },
    approvalStage("approve-seeds", "OWNER approves the seeds (the searches we will measure demand for); research refuses to spend calls on unapproved seeds", loc, "seeds"),
    { name: "research-plan", kind: "script", what: "the research plan and its external-call count (dry run: nothing is fetched)", cost: "free; prints the plan", inputs: () => ["approved/seeds.json", "approved/competitors.json"], outputs: () => [P("start", "research-plan.log")], logOutput: "research-plan.log",
      cmd: () => script("research.mjs", [T1, "--cwd", cwd, "--dry", ...splitArgs(val("--research-args"))]), judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 ? { outcome: "blocked", message: tail(r.out) } : { outcome: "fail", message: tail(r.out) }) },
    { ...researchStage(T1), what: "research end to end on the approved seeds and competitors: Search Console, Bing (with the relevance filter), Keyword Planner CSV if given, SERP and AI-answer captures (the main session captures in the owner's browser), clusters, competitor audit of the approved list, winner pages, AI citations -> targets.json (validated)",
      inputs: () => ["business.json", "approved/seeds.json", "approved/competitors.json", "captures/serp", "captures/ai"] });
  // 6 authority on exactly the approved competitor domains, then classify, vet, outreach list
  S.push({ name: "authority", kind: "script", optional: true, what: "authority from the Common Crawl link graph on exactly the approved competitor domains (refuses an unapproved list)", cost: "free; 15 to 30 minutes of disk reading",
      skipIf: () => (flag("--no-authority") ? "--no-authority" : null), inputs: () => ["approved/competitors.json"], outputs: () => [P("authority.json")],
      cmd: () => script("authority.mjs", [P("authority.json"), "--target", loc.host, "--approved-competitors", P("approved", "competitors.json"), "--require-approved", ...approvedDomains().flatMap((d) => ["--competitor", d])]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "blocked", message: r.out.split("\n").filter(Boolean).pop() || `authority.mjs exited ${r.code}` }) },
    { name: "authority-classify", kind: "script", optional: true, what: "sort the linking sites: link gap and AI-cited sources first", cost: "free, seconds", skipIf: skipNoAuthority, inputs: () => ["authority.json", "research/ai-citations.json"], outputs: () => [P("authority", "opportunities.json")],
      cmd: () => script("authority-classify.mjs", [T1, "--cwd", cwd]), judge: judgeOptional },
    { name: "authority-vet", kind: "script", external: true, optional: true, what: "polite read-only visit of each candidate site: what it is, how to get listed, free or paid; PURSUE / CHECK BY HAND / AVOID", cost: "12 s a site, at most 25 sites and 20 minutes per run", skipIf: skipNoAuthority, inputs: () => ["authority/opportunities.json"], outputs: () => [P("authority", "vetting.json")],
      cmd: () => script("authority-vet.mjs", [T1, "--cwd", cwd]), judge: judgeOptional },
    { name: "authority-outreach", kind: "script", optional: true, what: "the outreach list from the vetted PURSUE sites (planned rows; a row is listed only with an evidence URL)", cost: "free", skipIf: skipNoAuthority, inputs: () => ["authority/vetting.json"], outputs: () => [P("authority", "outreach.json")],
      cmd: () => script("authority-outreach.mjs", [T1, "seed", "--cwd", cwd]), judge: judgeOptional });
  // 7 the page plan (not the sitemap file), shown as a picture, approved by the owner
  S.push({ name: "plan", kind: "script", what: "the page plan: which pages exist, which search each targets, parent and child links (plan/sitemap.json), briefs, the programmatic gate, the off-site plan; refuses a definition the owner did not approve", cost: "free, seconds",
      inputs: () => ["approved/business.json", "targets.json", "authority.json"], outputs: () => [P("plan", "sitemap.json")],
      cmd: () => script("plan-site.mjs", [pewp, "--require-approved-business", ...(fs.existsSync(P("authority.json")) ? ["--authority", P("authority.json")] : []), ...splitArgs(val("--plan-args"))]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: r.code === 2 ? "blocked" : "fail", message: tail(r.out) }) },
    { name: "plan-picture", kind: "script", what: "the page plan as a picture the owner reads (plan/page-plan.png and .svg: every page as a box under its parent with its target search, volume, new or existing) plus a short table (page-plan.md)", cost: "free, seconds (PNG needs Chrome; the SVG and table are written without it)",
      inputs: () => ["plan/sitemap.json", "targets.json"], outputs: () => [P("plan", "page-plan.svg"), P("plan", "page-plan.md")], cmd: () => script("plan-picture.mjs", [pewp]), judge: judgeCode((r) => r.out.split("\n").filter(Boolean).pop()) },
    approvalStage("approve-targets", "OWNER signs the targets (what the site must be found for)", loc, "targets", { inputs: ["targets.json"] }),
    approvalStage("approve-plan", "OWNER signs the page plan (the pages to build, from the picture and the table)", loc, "plan", { inputs: ["plan/sitemap.json", "approved/targets.json"] }));
  // 8 audit-repo on the code, 9 the fix run with the live findings mapped in
  const dryArgs = () => [repo, ...(val("--build") ? ["--build", val("--build")] : ["--no-build"]), ...(val("--setup") ? ["--setup", val("--setup")] : []), ...(val("--causes") ? ["--causes", val("--causes")] : []), ...(val("--people") ? ["--people", val("--people")] : []), ...vals("--decisions").flatMap((d) => ["--decisions", d]), ...(val("--max-workers") ? ["--max-workers", val("--max-workers")] : []), ...(val("--max-parallel") ? ["--max-parallel", val("--max-parallel")] : []), ...(flag("--project-merges") ? ["--project-merges"] : [])];
  const projectNeeds = () => [
    ...(val("--build") || flag("--no-build") ? [] : [{ id: "build", question: "Which command builds the site from this repo? A check proves nothing without a rebuild (Matter of Place: `bun run build` inside app/). Give --build \"<cmd>\" (run from the repo root) or --no-build for a site with no generator.", options: ["the project's build command from its README or package.json (recommended when one exists)", "none: the site has no generator (--no-build)"] }]),
    ...(val("--setup") || flag("--no-setup") ? [] : [{ id: "setup", question: "Which command prepares a fresh worktree before a build (installs, env files)? Give --setup \"<cmd>\" or --no-setup.", options: ["the project's install command (for example `bun install`) (recommended when the build needs it)", "none needed (--no-setup)"] }]),
    ...(val("--max-parallel") ? [] : [{ id: "max-parallel", question: "How many fix workers may build at once on this machine? Give --max-parallel N.", options: ["1: one fix worker at a time (recommended on a laptop that runs other work)", "3: the skill's default"] }]),
    ...(flag("--project-merges") || flag("--owner-merges") ? [] : [{ id: "merges", question: "Who merges the fixed branches? Give --project-merges (the project's own merge gate, e.g. GitHub CI must be green; the skill only prepares the branch) or --owner-merges (the owner merges by hand after reading the report).", options: ["the project's own merge gate (--project-merges) (recommended when the repo has CI)", "the owner merges by hand (--owner-merges)"] }])];
  const rfArgs = () => [...dryArgs(), ...(flag("--yes") ? ["--yes"] : []), ...(!flag("--no-visual") ? ["--visual"] : []), ...(val("--visual-dir") ? ["--visual-dir", val("--visual-dir")] : []), ...vals("--visual-allow").flatMap((a) => ["--visual-allow", a])];
  S.push(guardStage(R, "before"), checkerStage(R, "checker-repo"), guardStage(R, "after"),
    { name: "causes-map", kind: "script", what: "the live findings (from the snapshot's checks) mapped onto the repo's root causes by rule id; a live finding with no repo match becomes its own cause for the fix run, so nothing from the live audit is handed around as a to-do list", cost: "free, seconds",
      inputs: () => [{ abs: snapCauses() }, { abs: path.join(repo, ".checks", "REPORT.md") }], outputs: () => [path.join(repo, ".checks", "causes.json")],
      cmd: () => script("causes-map.mjs", [repo, "--live", snapCauses(), "--out", path.join(repo, ".checks", "causes.json")]), judge: judgeCode((r) => r.out.split("\n").filter(Boolean).pop()) },
    { name: "refactor-dry", kind: "script", what: "the fix-run plan: how many fix workers, which causes are skipped (nothing is changed); asks once for the build command, the setup command, the workers at once and who merges, and remembers them", cost: "free; prints the worker count (cap 12 per run, Sonnet high effort)", inputs: () => [{ abs: path.join(repo, ".checks", "causes.json") }, { git: repo }], outputs: () => [P("start", "refactor-dry.log")], logOutput: "refactor-dry.log",
      needs: projectNeeds, cmd: () => script("refactor.mjs", [...dryArgs(), "--dry"]), judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "fail", message: tail(r.out) }) },
    ackStage("refactor-ok", "OWNER agrees to the worker count and the cost of the fix run", { inputs: () => ["start/refactor-dry.log"], cost: "Sonnet fix workers, high effort: up to 12 per run, --max-parallel at once, 30 minutes each",
      instruction: () => `NEEDS-APPROVAL stage=refactor-ok: show the owner the plan below (workers and what is skipped), then ask as a pickable option whether to run it. If yes, the main session records it:\n  node "${rel(path.join(here, "start.mjs"))}" overhaul "${T1}" "${rel(repo)}" --ack refactor-ok --by "<owner name>"\n${(() => { try { return fs.readFileSync(P("start", "refactor-dry.log"), "utf8").split("\n").map((l) => "    " + l).slice(0, 14).join("\n"); } catch { return ""; } })()}` }),
    { name: "refactor", kind: "script", external: true, what: "the fix run: one worktree and fix worker per root cause (repo causes and mapped live findings), rebuild, every check FAIL->PASS re-proven by the coordinator, no regression; REF-009 screenshots; nothing merged", cost: "up to 12 Sonnet fix workers (--max-parallel at once, 30 minutes each); hours: run it in the background",
      inputs: () => [{ abs: path.join(repo, ".checks", "causes.json") }, "start/refactor-dry.log", "start/ack-refactor-ok"], outputs: () => [], needs: projectNeeds, cmd: () => script("refactor.mjs", rfArgs(), { timeoutMin: 300 }),
      judge: (r) => { const last = r.out.split("\n").filter((l) => /^REFACTOR /.test(l)).pop(); return r.code === 0 ? { outcome: "done", message: last || "" } : { outcome: "fail", message: `${last || tail(r.out)}\nThe run is not safe to use or the combined branch regressed a check: read ${rel(path.join(repo, ".pewp", "refactor"))}/<run>.md.` }; } },
    ackStage("refactor-merge", "OWNER reviews the fixed branch and the REF-009 pictures, then it is merged through the project's own path (start never merges, pushes or deploys)", { inputs: () => [], by: true,
      instruction: () => `NEEDS-APPROVAL stage=refactor-merge: the owner reads ${rel(path.join(repo, ".pewp", "refactor"))}/<run>.md (and the pictures under visual/diff/ if any) and decides in words. Nothing was merged. ${flag("--project-merges") ? "The project's own merge gate merges it (CI green, never a direct merge)." : "The owner merges by hand."} When merged or rejected, record it:\n  node "${rel(path.join(here, "start.mjs"))}" overhaul "${T1}" "${rel(repo)}" --ack refactor-merge --by "<owner name>"` }));
  // 10 build the planned new pages, 11 gate, 12 deploy
  const siteDir = () => path.resolve((load(runLoc)?.stages?.builder?.ack?.site) || val("--site") || path.join(repo, "dist"));
  S.push({ name: "handoff", kind: "script", what: "the builder's spec for the planned new pages: HANDOFF.md and builder-prompt.md from the approved page plan", cost: "free", inputs: () => ["approved/plan/sitemap.json", "business.json", "approved/lock.json", "start/ack-refactor-merge"], outputs: () => [P("builder", "HANDOFF.md"), P("builder", "builder-prompt.md")],
      cmd: () => script("build-site.mjs", [repo, "--go", "--pewp", pewp, ...(val("--build") ? ["--site-build", val("--build"), "--site-build-cwd", repo] : [])]),
      judge: (r) => (/WAITING-FOR-BUILDER|^handoff:/m.test(r.out) || r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 || r.code === 4 ? { outcome: r.code === 3 ? "needs-input" : "blocked", message: r.out.split("\n").slice(-10).join("\n") } : { outcome: "fail", message: tail(r.out) }) },
    ackStage("builder", "a builder session builds the planned pages in the repo from the briefs (same proof discipline: build, checks, nothing merged by the skill)", { by: false, extra: "--site <built folder>", inputs: () => ["builder/HANDOFF.md"],
      instruction: () => `WAITING-FOR the builder session (stage=builder). Start it with the prompt in ${rel(P("builder", "builder-prompt.md"))} (spec: ${rel(P("builder", "HANDOFF.md"))}); it works on a branch of ${rel(repo)}${val("--build") ? ` and builds with: ${val("--build")}` : ""}. When its gate passes, record the built output folder:\n  node "${rel(path.join(here, "start.mjs"))}" overhaul "${T1}" "${rel(repo)}" --ack builder --site "<built folder, e.g. ${rel(path.join(repo, "dist"))}>"` }),
    { name: "gate", kind: "script", what: "the built site against the approved targets and page plan (--strict at launch: every warning is a blocker)", cost: "free, seconds (a build command makes it build twice for GT-013)", inputs: () => ["approved/lock.json", "start/ack-builder"], outputs: () => [P("gate", "report.json")],
      cmd: () => script("gate.mjs", [pewp, siteDir(), "--strict", ...(val("--build") ? ["--build", val("--build"), "--build-cwd", repo] : []), ...(val("--setup") ? ["--setup", val("--setup")] : [])]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter((l) => /^(PASS|FAIL|ERROR) /.test(l)).slice(0, 3).join("\n") } : { outcome: r.code === 2 ? "blocked" : "fail", message: r.out.split("\n").filter((l) => /^(FAIL|ERROR) /.test(l)).slice(0, 12).join("\n") || tail(r.out) }) },
    ackStage("deploy", "OWNER deploys through the project's own path (the skill never deploys); the deployed release or commit is recorded", { by: true, extra: "--release <commit or release id>", inputs: () => ["start/ack-builder"],
      instruction: () => `NEEDS-APPROVAL stage=deploy: the gate passed. The project deploys through its own path (its CI and merge gate). Do not deploy for them. When it is live, record what went out:\n  node "${rel(path.join(here, "start.mjs"))}" overhaul "${T1}" "${rel(repo)}" --ack deploy --by "<owner name>" --release "<commit or release id>"` }));
  // 13 the sitemap file: checked, then submitted; 14 measure and iterate
  const sitemapUrl = () => val("--sitemap-url") || new URL("/sitemap.xml", T1).href;
  S.push({ name: "sitemap-check", kind: "script", external: true, what: "the sitemap file search engines read (generated by the site's own code from the pages that now exist): every URL in it is in the approved page plan, answers 200, is indexable and canonical to itself; every indexable planned page is in it; lastmod is real, not the build clock", cost: "one polite request per URL (cap 500); stops at the first 429",
      inputs: () => ["approved/plan/sitemap.json", "start/ack-deploy"], outputs: () => [P("sitemap", `check-${today}.json`)],
      cmd: () => script("sitemap-check.mjs", [T1, "--plan", P("approved", "plan", "sitemap.json"), "--cwd", cwd, "--today", today, ...(val("--sitemap-url") ? ["--sitemap", val("--sitemap-url")] : []), ...vals("--exclude").flatMap((e) => ["--exclude", e])]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter((l) => /^(PASS|sitemap:)/.test(l)).join("\n") } : r.code === 3 ? { outcome: "blocked", message: `STOPPED at a 429 (rate limit): nothing concluded. Wait, then run again.\n${tail(r.out, 4)}` } : { outcome: "fail", message: `The sitemap file is not right yet; nothing is submitted until it passes.\n${r.out.split("\n").filter((l) => /^FAIL/.test(l)).slice(0, 12).join("\n") || tail(r.out)}` }) },
    { name: "sitemap-submit", kind: "script", external: true, what: "submit the checked sitemap file to Search Console and Bing (APIs), the responses recorded; refused without a same-day PASS of the check", cost: "2 API calls",
      inputs: () => [`sitemap/check-${today}.json`, "start/ack-deploy"], outputs: () => [P("sitemap", `submit-${today}.json`)],
      cmd: () => script("sitemap-submit.mjs", [T1, "--sitemap", sitemapUrl(), "--cwd", cwd, "--today", today]), judge: judgeCode((r) => r.out.split("\n").filter((l) => /^(gsc|bing|submitted)/i.test(l)).join("\n")) });
  const todayDir = (f) => P("measure", today, f);
  S.push({ name: "measure-init", kind: "script", what: "set up measuring once (measure/config.json and run.mjs; needs the Search Console property)", cost: "free, seconds", inputs: () => ["start/ack-deploy"], outputs: () => [P("measure", "config.json"), P("measure", "run.mjs")],
      cmd: () => script("measure.mjs", [T1, "--init", ...(val("--property") ? ["--property", val("--property")] : []), "--cwd", cwd]) },
    { name: "measure-plan", kind: "script", what: "what the baseline measure run will call and how many calls (nothing is fetched)", cost: "free; caps: 80 API calls, 60 AI answers, 20 URL inspections per run", inputs: () => ["measure/config.json"], outputs: () => [P("start", "measure-plan.log")], logOutput: "measure-plan.log",
      cmd: () => script("measure.mjs", [T1, "--plan", "--today", today, "--cwd", cwd]) },
    { name: "measure-run", kind: "script", external: true, what: "the baseline after the overhaul: rankings, AI citations, Search Console, CrUX, index; later runs diff against it", cost: "free sources; within the call caps above",
      inputs: () => ["measure/config.json", "approved/targets.json", `sitemap/submit-${today}.json`], outputs: () => [todayDir("summary.json")], cmd: () => script("measure.mjs", [T1, "--today", today, "--cwd", cwd, ...(flag("--fresh") ? ["--fresh"] : [])]) },
    { name: "iterate", kind: "script", optional: true, what: "the iterate loop: proposals from the last two measure runs (they need approval again); BLOCKED until two runs exist", cost: "free, seconds",
      inputs: () => [todayDir("summary.json").replace(pewp + path.sep, ""), "approved/lock.json"], outputs: () => [P("iterate", "report.md")], cmd: () => script("iterate.mjs", [T1, "--cwd", cwd, "--today", today]),
      judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 2 ? { outcome: "blocked", message: tail(r.out, 4) } : { outcome: "fail", message: tail(r.out) }) });
  // the 14 steps the owner reads (stages/overhaul.md); the plan prints a heading when the step changes
  const STEP_OF = { doctor: 1, snapshot: 2, psi: 2, "checker-live": 2, "report-live": 2, intake: 3, classify: 3, "approve-business": 3, "competitors-discover": 4, "approve-competitors": 4, "authority-prepare": 4,
    "seeds-propose": 5, "approve-seeds": 5, "research-plan": 5, research: 5, authority: 6, "authority-classify": 6, "authority-vet": 6, "authority-outreach": 6, plan: 7, "plan-picture": 7, "approve-targets": 7, "approve-plan": 7,
    "guard-before": 8, "checker-repo": 8, "guard-after": 8, "causes-map": 9, "refactor-dry": 9, "refactor-ok": 9, refactor: 9, "refactor-merge": 9, handoff: 10, builder: 10, gate: 11, deploy: 12, "sitemap-check": 13, "sitemap-submit": 13,
    "measure-init": 14, "measure-plan": 14, "measure-run": 14, iterate: 14 };
  for (const s of S) s.step = STEP_OF[s.name];
  return S;
}
const OVERHAUL_STEPS = ["", "doctor: which sources are connected", "audit the live site (snapshot, checks, report)", "the business definition (OWNER approves)", "competitors of every kind (OWNER approves the list)", "research end to end on approved seeds (OWNER approves the seeds)", "authority on the approved competitor domains", "the page plan, shown as a picture (OWNER approves targets and the page plan)", "audit the code", "the fix run on repo causes and live findings (OWNER approves cost and merge)", "build the planned pages (builder session)", "gate the built site against the approved page plan", "deploy through the project's own path (OWNER records the release)", "the sitemap file: checked, then submitted (nothing is submitted before it passes)", "baseline measurement and the iterate loop"];
const splitArgs = (s) => (s || "").split(/\s+/).filter(Boolean);
const isLoopbackUrl = (u) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
function researchStage(t, bizFile = "business.json") {
  return { name: "research", kind: "script", external: true, what: "demand, competitors, AI citations from free sources -> targets.json (validated) and research/report.md", cost: "free sources; caps per run: Bing 60, competitor sites 12, Reddit 12, Gemini 30, captures 60; a plan above 150 external calls needs --yes (the owner agrees first)",
    inputs: () => [bizFile, "captures/serp"], outputs: () => [P("targets.json")], cmd: () => script("research.mjs", [t, "--cwd", cwd, ...splitArgs(val("--research-args"))], { timeoutMin: 240 }),
    judge: (r) => { const tailMsg = r.out.split("\n").filter((l) => /^(DONE|PARTIAL|\s+\d+ results pages)/.test(l.trim()) || /still to capture/.test(l)).join("\n");
      return r.code === 0 ? { outcome: "done", message: tailMsg } : r.code === 3 ? { outcome: "needs-input", message: `NEEDS-INPUT stage=research: research cannot go on without something from the owner or the operator. Its message:\n${tail(r.out)}\nThe main session turns this into pickable options (recommended first), puts the answer in --research-args "<args>" (for the call-count confirmation: --yes inside it), and runs the same command again.` } : { outcome: "fail", message: tail(r.out, 15) }; } };
}

// ---------------------------------------------------------------- status of each stage
const outsOf = (s) => (s.outputs ? s.outputs() : []);
function statusOf(s) {
  reload();
  const rec = st.stages?.[s.name];
  if (!rec || !rec.doneAt) return { status: "pending", note: rec?.blocked ? `last time BLOCKED: ${rec.blocked}` : "" };
  if (s.kind === "ack" || s.kind === "approval") { if (s.kind === "ack" && !rec.ack) return { status: "pending", note: "" }; }
  const cur = hashInputs(s.inputs ? s.inputs() : []);
  // inputs first: a stage whose inputs changed is STALE even when its outputs sit at an old path (a new snapshot folder)
  if (rec.inputsHash && rec.inputsHash !== cur.hash) {
    const changed = Object.keys(cur.detail).filter((k) => rec.inputsDetail?.[k] !== cur.detail[k]);
    return { status: "stale", note: `an input changed: ${changed.slice(0, 3).map((c) => path.basename(c)).join(", ")}`, changed };
  }
  if (rec.skipped) return { status: "done", note: `skipped: ${rec.skipped}` };
  if (outsOf(s).some((o) => !fs.existsSync(o))) return { status: "pending", note: "outputs missing" };
  if (s.evidence) { const ev = s.evidence(0); if (!ev.ok) return { status: "pending", note: `evidence: ${ev.problems.slice(0, 2).join("; ")}` }; }
  if (!rec.inputsHash) { persist((x) => { x.stages[s.name].inputsHash = cur.hash; x.stages[s.name].inputsDetail = cur.detail; x.stages[s.name].adopted = true; }); return { status: "done", note: "adopted (already done outside start)" }; }
  return { status: "done", note: "" };
}
function markDone(s, outputs = {}, extra = {}) {
  const cur = hashInputs(s.inputs ? s.inputs() : []);
  persist((x) => { x.stages[s.name] = { doneAt: new Date().toISOString(), outputs: Object.fromEntries(outsOf(s).map((o) => [path.basename(o), rel(o)])), ...outputs, inputsHash: cur.hash, inputsDetail: cur.detail, ...extra }; });
}
function setRun(status, stage, message = "") { persist((x) => { x.start = { ...(x.start || {}), mode, targets: [T1, T2].filter(Boolean), sequence: SEQ.map((s) => ({ name: s.name, kind: s.kind, optional: !!s.optional, ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}) })), status, stage, message: String(message).slice(0, 400), updatedAt: new Date().toISOString() }; }); }

// ---------------------------------------------------------------- running a script
function killTree(child) { try { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 10_000 }); else child.kill("SIGKILL"); } catch {} }
function runScript(c, logName) {
  const scriptPath = path.join(stageDir, c.script);
  if (!fs.existsSync(scriptPath)) return Promise.resolve({ code: 4, out: `scripts/${c.script} is not built yet. Unblocks: the stage owner delivers it (see PHASES.md).`, notBuilt: true });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...c.args], { cwd: c.cwd || cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", buf = ""; let timedOut = false;
    const emit = (d) => { const t = d.toString(); out += t; buf += t; const lines = buf.split("\n"); buf = lines.pop(); for (const l of lines) console.log(`    | ${l}`); };
    child.stdout.on("data", emit); child.stderr.on("data", emit);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, (c.timeoutMin ? c.timeoutMin * 60_000 : timeoutMs));
    child.on("error", (e) => { out += String(e); });
    child.on("close", (code) => { clearTimeout(timer); if (buf) console.log(`    | ${buf}`); fs.mkdirSync(P("start"), { recursive: true }); fs.writeFileSync(P("start", `${logName}.log`.replace(/\.log\.log$/, ".log")), out); resolve({ code: timedOut ? 124 : code ?? 1, out, timedOut }); });
  });
}

// ---------------------------------------------------------------- run files (G14): <pewp>/runs/<date>-<mode>.md at every end or stop, one per stage that ran
const RAN = []; // { stage, script, args, code, out }
function doctorSummary() {
  try { const d = JSON.parse(fs.readFileSync(P("doctor.json"), "utf8")); const list = Array.isArray(d.sources) ? d.sources : Object.entries(d.sources || {}).map(([id, v]) => ({ id, ...(typeof v === "object" ? v : { status: String(v) }) }));
    return `doctor ${d.checkedAt || "(no date)"}${d.env?.file ? `, env file ${rel(d.env.file)} (${(d.env.loaded || []).length} names)` : ""}: ${list.map((s) => `${s.id || s.label}=${s.status}`).join(", ") || "(no sources listed)"}`; }
  catch { return "doctor: no doctor.json yet"; }
}
const safeArgv = () => ["node", "start.mjs", ...ARGV].map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ");
const first40 = (s) => String(s || "").split("\n").slice(0, 40).join("\n");
function writeRunFiles(code) {
  try {
    const dir = P("runs"); fs.mkdirSync(dir, { recursive: true });
    const ack = planAckOf();
    const head = [`# ${today} ${mode}: ${[T1, T2].filter(Boolean).join(" ")}`, "", `- command: \`${safeArgv()}\``, `- exit code: ${code} (${code === 0 ? "done or natural pause" : code === 1 ? "FAILED" : code === 3 ? "STOPPED for a person" : code === 4 ? "BLOCKED" : "usage"})`,
      `- run state: ${load(runLoc)?.start?.status || "?"} at stage ${load(runLoc)?.start?.stage || "-"}`, `- plan seen by the owner: ${ack ? `${ack.how}, by ${ack.by}, ${ack.at}` : "NOT RECORDED (no --ack plan-ok, no --yes)"}`, `- env file: ${envInfo.file ? `${rel(envInfo.file)} (${envInfo.loaded.length} names, ${envInfo.source})` : "none"}`, `- ${doctorSummary()}`,
      `- stages run now: ${RAN.length ? RAN.map((r) => `${r.stage} (exit ${r.code}${r.adopted ? ", adopted" : ""})`).join(", ") : "none"}`, "", "## First 40 lines", "```", first40(OUTLOG.join("\n")), "```", ""];
    fs.writeFileSync(path.join(dir, `${today}-${mode}.md`), head.join("\n"));
    for (const r of RAN.filter((x) => x.adopted)) fs.writeFileSync(path.join(dir, `${today}-${mode}-${r.stage}.md`), [`# ${today} ${mode} / ${r.stage}`, "", "- adopted: the step was not run; its evidence already existed and every input was older", `- exit code: ${r.code} (adopted)`, `- date: ${r.adopted.at} (the evidence's own date; adopted ${r.adopted.adoptedAt})`, `- evidence: ${r.adopted.evidence.map((e) => `${e.path} (${e.mtime})`).join(", ")}`, `- inputs checked: ${r.adopted.inputsChecked}${r.adopted.missingInputs.length ? `; not present (cannot be newer): ${r.adopted.missingInputs.join(", ")}` : ""}`, ""].join("\n"));
    for (const r of RAN.filter((x) => !x.adopted)) fs.writeFileSync(path.join(dir, `${today}-${mode}-${r.stage}.md`), [`# ${today} ${mode} / ${r.stage}`, "", `- command: \`node scripts/${r.script} ${r.args.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ")}\``, `- exit code: ${r.code}`, `- ${doctorSummary()}`, "", "## First 40 lines of its output", "```", first40(r.out), "```", ""].join("\n"));
  } catch (e) { console.error(`run file not written: ${e.message || e}`); }
}
const finish = (code) => { writeRunFiles(code); process.exit(code); };

// ---------------------------------------------------------------- main
const SEQ = sequence();
const byName = new Map(SEQ.map((s) => [s.name, s]));
if (val("--stage") && !byName.has(val("--stage"))) die(`no stage "${val("--stage")}" in mode ${mode}. Stages: ${SEQ.map((s) => s.name).join(", ")}`);

// ---------------------------------------------------------------- the owner saw the plan (G13): recorded per mode in state.json start.planAck
// `--ack plan-ok --by NAME` = the owner read the plan and its costs; `--yes` = the main session says the owner already agreed (recorded as such).
// A stage marked external (a crawl, API calls, agent workers) refuses to start without one; free local stages run without it.
const planAckOf = () => (load(runLoc)?.start?.planAck || {})[mode] || null;
if (val("--ack") === "plan-ok") {
  if (!val("--by")) die(`--ack plan-ok needs --by "<the owner's name>": the owner reads the plan and its costs, the main session records it.`);
  persist((x) => { x.start = { ...(x.start || {}), planAck: { ...((x.start || {}).planAck || {}), [mode]: { by: val("--by"), at: new Date().toISOString(), how: "owner ack (--ack plan-ok)" } } }; });
  fs.mkdirSync(P("start"), { recursive: true }); fs.writeFileSync(P("start", `ack-plan-ok-${mode}`), JSON.stringify(planAckOf()) + "\n");
  console.log(`recorded: the owner (${val("--by")}) saw the ${mode} plan and its costs`);
}
if (go && flag("--yes") && !planAckOf()) persist((x) => { x.start = { ...(x.start || {}), planAck: { ...((x.start || {}).planAck || {}), [mode]: { by: "main session (--yes: the owner said yes in words)", at: new Date().toISOString(), how: "--yes" } } }; });

// acks first: a person's decision, recorded by the main session
if (val("--ack") && val("--ack") !== "plan-ok") {
  const s = byName.get(val("--ack"));
  if (!s) die(`--ack ${val("--ack")}: no such stage in mode ${mode}. Stages: ${SEQ.map((x) => x.name).join(", ")}`);
  if (s.kind !== "ack") die(`--ack ${s.name}: ${s.name} is run by a script or an agent, not acknowledged by a person. The stages that take --ack: ${SEQ.filter((x) => x.kind === "ack").map((x) => x.name).join(", ") || "none"}`);
  if (s.ack.by && !val("--by")) die(`--ack ${s.name} needs --by "<the name of the person who decided>": the owner decides, the main session records.`);
  const extra = {};
  if (s.name === "cutover") { if (!/^\d{4}-\d{2}-\d{2}$/.test(val("--cutover-date") || "")) die("--ack cutover needs --cutover-date YYYY-MM-DD"); extra.date = val("--cutover-date"); }
  if (s.name === "builder") { const sd = path.resolve(val("--site") || path.join(mode === "overhaul" ? repoLoc.root : loc.root, mode === "overhaul" ? "dist" : "site")); if (!fs.existsSync(sd)) die(`--ack builder: the built site folder ${sd} does not exist`); extra.site = sd; }
  if (s.name === "deploy") { if (!String(val("--release") || "").trim()) die("--ack deploy needs --release \"<the deployed commit or release id>\": the skill records what went live, it never deploys."); extra.release = val("--release"); }
  markDone(s, {}, { ack: { by: val("--by") || null, at: new Date().toISOString(), ...extra } });
  fs.mkdirSync(P("start"), { recursive: true });
  fs.writeFileSync(P("start", `ack-${s.name}`), JSON.stringify({ by: val("--by") || null, at: new Date().toISOString(), ...extra }) + "\n");
  console.log(`recorded: ${s.name} acknowledged${val("--by") ? " by " + val("--by") : ""}`);
}

// status table (also persists the stale marks)
const rows = SEQ.map((s) => ({ s, ...statusOf(s) }));
persist((x) => { x.stages = x.stages || {}; for (const r of rows) if (x.stages[r.s.name]) { if (r.status === "stale") x.stages[r.s.name].stale = { markedAt: new Date().toISOString(), changed: r.changed }; else delete x.stages[r.s.name].stale; } });
const planLines = [`PLAN ${mode} ${[T1, T2].filter(Boolean).join(" ")}  (state: ${rel(P("state.json"))})`];
let lastStep = 0;
SEQ.forEach((s, i) => {
  const r = rows[i]; const skip = s.skipIf?.();
  if (s.step && s.step !== lastStep) { lastStep = s.step; planLines.push(`  == step ${s.step} of 14: ${OVERHAUL_STEPS[s.step]}`); }
  planLines.push(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(18)} ${(skip ? "skipped" : r.status).padEnd(8)} ${("[" + s.kind + "]").padEnd(10)} ${s.what}${r.note ? `  (${r.note})` : ""}${skip ? `  (skipped: ${skip})` : ""}`);
  if (r.status !== "done" && !skip) planLines.push(`        cost: ${s.cost}`);
});
if (remembered.length) planLines.push(`  options remembered from the earlier start of this run (state.json start.options; --forget-options clears them): ${remembered.join(" | ")}`);
console.log(planLines.join("\n"));
const need =SEQ.filter((s, i) => !s.skipIf?.() && rows[i].status !== "done");
if (!go && !val("--ack")) {
  setRun(need.length ? "planned" : "done", need[0]?.name || null, need.length ? `${need.length} stage(s) to run` : "everything is done");
  console.log(need.length ? "Plan only. Show it (and the costs) to the owner, then run again with --go." : "Every stage is done and its inputs are unchanged.");
  finish(0);
}
if (!go) finish(0);

if (mode === "audit-live") finish(await runManifestLoop());

setRun("running", need[0]?.name || null, "");
const targetsToRun = val("--stage") ? [byName.get(val("--stage"))] : SEQ;
let stoppedFor = null;
for (const s of targetsToRun) {
  const i = SEQ.indexOf(s); const skip = s.skipIf?.();
  if (skip) { console.log(`${s.name}: skipped (${skip})`); continue; }
  const forced = !!val("--stage");
  let status = forced ? { status: "pending" } : statusOf(s);
  // a forced stage still never starts before the approval or acknowledgement it depends on exists (its inputs under approved/ or start/ack-*)
  if (forced) {
    // only approvals and acknowledgements that an EARLIER stage of this very sequence produces count (iterate alone judges its own approved files)
    const earlier = new Set(SEQ.slice(0, i).flatMap((x) => [...outsOf(x).map(rel), ...(x.kind === "ack" ? [rel(P("start", `ack-${x.name}`))] : [])]));
    const missing = (s.inputs ? s.inputs() : []).filter((i) => typeof i === "string" && /^(approved\/|start\/ack-)/.test(i) && earlier.has(rel(P(i))) && !fs.existsSync(P(i)));
    if (missing.length) { setRun("needs-approval", s.name, missing.join(", ")); console.log(`NEEDS-APPROVAL stage=${s.name}: it depends on ${missing.map((m) => (/^approved\//.test(m) ? `the approval that writes ${m}` : `the acknowledgement ${m.replace("start/ack-", "--ack ")}`)).join(" and ")}, which does not exist yet. A stage never starts before the stage it depends on is done and approved: run the same command without --stage to reach it in order.`); stoppedFor = 3; break; }
  }
  if (status.status === "done") { console.log(`${s.name}: done`); continue; }
  if (status.status === "stale") console.log(`${s.name}: stale (${status.note}): running again`);
  // what a stage needs from a person or the operator before it can run
  const nd = (s.needs ? s.needs() : []).filter((n) => !n.unmet);
  if (nd.length) {
    questionsFor(s.name, nd);
    setRun("needs-input", s.name, nd.map((n) => n.id).join(", "));
    console.log([`NEEDS-INPUT stage=${s.name}: ${nd.length} question(s). Ask them as pickable options (the first option is the recommended one), then run the same command again with the answer as the option named in each question (the file ${rel(P("start", "questions.json"))} has them as JSON).`, ...nd.map((n, k) => `${k + 1}. [${n.id}] ${n.question}\n${(n.options || []).map((o, j) => `   - ${o}${j === 0 ? " [recommended]" : ""}`).join("\n")}`)].join("\n"));
    stoppedFor = 3; break;
  }
  if (s.external && !planAckOf()) {
    setRun("needs-approval", s.name, "plan-ok");
    console.log(`NEEDS-APPROVAL stage=plan-ok (before ${s.name}): the owner has not seen this run plan (the stages above and their costs; not the page plan). Show it and ask as a pickable option. Then record it:\n  node "${rel(path.join(here, "start.mjs"))}" ${mode} ${[T1, T2].filter(Boolean).map((t) => JSON.stringify(t)).join(" ")} --ack plan-ok --by "<owner name>"   (or pass --yes with --go when the owner already said yes in words). Nothing external ran.`);
    stoppedFor = 3; break;
  }
  if (s.kind === "final") {
    const unmet = (s.needs ? s.needs() : []).some((n) => n.unmet);
    if (unmet) { setRun("built-awaiting-measure", s.name, "waits for launch"); console.log(`measure: BLOCKED(launch). Measuring needs the LIVE site and the owner's Search Console access. After launch: node "${rel(path.join(here, "start.mjs"))}" measure <live url> --go (or re-run this with --live-url <url>). The site is built and gated: this is the correct state before launch.\nSTATUS: BUILT-AWAITING-MEASURE`); stoppedFor = 0; break; }
    markDone(s); console.log(`${s.name}: done`); continue;
  }
  if (s.kind === "agent") {
    const done = outsOf(s).every((o) => fs.existsSync(o));
    const rec = load(runLoc)?.stages?.[s.name];
    const since = Date.parse(rec?.rerunRequestedAt || rec?.doneAt || 0) || 0;
    const fresh = done && outsOf(s).every((o) => fs.statSync(o).mtimeMs > since) && !forced;
    if (fresh) { markDone(s); console.log(`${s.name}: done (its outputs exist)`); continue; }
    persist((x) => { x.stages[s.name] = { ...(x.stages[s.name] || {}), rerunRequestedAt: new Date().toISOString(), doneAt: x.stages[s.name]?.doneAt || null }; if (!x.stages[s.name].doneAt) delete x.stages[s.name].doneAt; });
    setRun("waiting-for-agent", s.name, "");
    console.log(s.instruction()); stoppedFor = 3; break;
  }
  if (s.kind === "ack") {
    setRun("needs-approval", s.name, s.what);
    console.log(s.instruction ? s.instruction() : `NEEDS-APPROVAL stage=${s.name}: ${s.what}. Record it: node "${rel(path.join(here, "start.mjs"))}" ${mode} ${[T1, T2].filter(Boolean).join(" ")} --ack ${s.name}${s.ack.by ? ' --by "<name>"' : ""}${s.ack.extra ? " " + s.ack.extra : ""}`);
    stoppedFor = 3; break;
  }
  // script or approval (approve.mjs): run it
  s.prepare?.();
  const c = s.cmd();
  console.log(`${s.name}: running scripts/${c.script} ${c.args.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ").slice(0, 200)}`);
  const res = await runScript(c, s.logOutput ? s.logOutput.replace(/\.log$/, "") : s.name);
  RAN.push({ stage: s.name, script: c.script, args: c.args, code: res.code, out: res.out });
  let v = s.judge ? s.judge(res) : (res.code === 0 ? { outcome: "done", message: "" } : res.code === 3 ? { outcome: "needs-input", message: `NEEDS-INPUT stage=${s.name}: ${tail(res.out)}` } : res.code === 4 ? { outcome: "blocked", message: res.out.trim().split("\n").pop() } : { outcome: "fail", message: tail(res.out, 15) });
  if (res.notBuilt) v = { outcome: "blocked", message: res.out };
  if (res.timedOut) v = { outcome: "fail", message: `timed out after ${(c.timeoutMin || timeoutMs / 60_000)} min` };
  if (v.outcome === "done" && outsOf(s).some((o) => !fs.existsSync(o))) v = { outcome: "fail", message: `the script exited 0 but did not write: ${outsOf(s).filter((o) => !fs.existsSync(o)).map(rel).join(", ")}` };
  if (v.outcome === "done") { markDone(s); if (v.message) console.log(`${s.name}: done. ${v.message}`); else console.log(`${s.name}: done`); continue; }
  if (v.outcome === "blocked" && s.optional) { persist((x) => { x.stages[s.name] = { blocked: String(v.message).slice(0, 300), at: new Date().toISOString() }; }); console.log(`${s.name}: skipped, BLOCKED (optional): ${v.message}`); continue; }
  if (v.outcome === "partial") { persist((x) => { x.stages[s.name] = { partial: String(v.message).slice(0, 300), at: new Date().toISOString() }; }); console.log(`${s.name}: PARTIAL: ${v.message} (what was read is kept; run again to continue)`); continue; }
  if (v.outcome === "needs-input") { setRun("needs-input", s.name, ""); console.log(v.message); stoppedFor = 3; break; }
  if (v.outcome === "approval") { setRun("needs-approval", s.name, ""); console.log(v.message); stoppedFor = 3; break; }
  if (v.outcome === "blocked") { setRun("blocked", s.name, v.message); console.log(`BLOCKED stage=${s.name}: ${v.message}`); stoppedFor = 4; break; }
  setRun("failed", s.name, v.message); console.log(`FAILED stage=${s.name}: ${v.message}`); stoppedFor = 1; break;
}

// the stages after a forced single-stage run whose inputs changed are marked stale
const after = SEQ.map((s) => ({ s, ...statusOf(s) }));
persist((x) => { for (const r of after) if (x.stages[r.s.name]) { if (r.status === "stale") x.stages[r.s.name].stale = { markedAt: new Date().toISOString(), changed: r.changed }; else delete x.stages[r.s.name].stale; } });
if (val("--stage")) {
  const stale = after.filter((r) => r.status === "stale").map((r) => r.s.name);
  if (stale.length) console.log(`marked stale in state.json (their inputs changed): ${stale.join(", ")}; the next start --go re-runs them`);
}
if (stoppedFor === null || stoppedFor === 0) {
  const open = SEQ.filter((s) => !s.skipIf?.() && !s.optional && statusOf(s).status !== "done");
  if (!open.length || val("--stage")) { if (!val("--stage")) setRun("done", null, "all stages done"); console.log(val("--stage") ? "stage finished." : "ALL STAGES DONE."); finish(0); }
  finish(stoppedFor ?? 0);
}
finish(stoppedFor);
