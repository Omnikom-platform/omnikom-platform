// start: ONE entry point over every mode's stage sequence (shipgate 06-growth.md section 2: `start <mode>` records the
// sequence in state.json, runs the stages not yet done in order, stops at the first stage that needs an approval or a
// missing input; `start --stage <name>` re-runs one stage; later stages whose inputs changed are marked stale and re-run).
// It drives the skill's scripts by their own command lines; it builds no stage itself.
//
// Usage: node start.mjs <mode> <target> [<target2>] [--go] [--stage <name>] [--ack <stage> [--by NAME] [...]] [options]
//   modes: audit-live <url> | audit-repo <path> | audit <url|path> | compare <a> <b> | research <url|folder> | refactor <repo path>
//          | measure <url> | migrate <old url> <new url|folder> | build <folder> (alias: new) | iterate <target> | local <url|repo>
//   no --go            print the plan (stages, their status, who/what each needs, the cost) and stop. Show it, then run again with --go.
//   --go               run every stage that is pending or stale, in order, until one needs a person or a missing input.
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
//   refactor: --build "<cmd>" | --no-build  --setup "<cmd>" --causes C01,C03 --people C04 --decisions <file>... --max-workers N --yes
//             --no-visual (REF-009 screenshots are on by default) --visual-allow "<route group>=<ratio>"... --visual-dir <sub>
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

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, "..");
const ARGV = process.argv.slice(2);
const dd = ARGV.indexOf("--");
let snapPass = dd >= 0 ? ARGV.slice(dd + 1) : [];
let A = dd >= 0 ? ARGV.slice(0, dd) : ARGV;
const VALUE_FLAGS = new Set(["--cwd", "--stage-scripts", "--stage-timeout-min", "--today", "--stage", "--ack", "--by", "--site", "--cutover-date", "--max-age-days", "--launch-state", "--launch-state-a", "--launch-state-b", "--competitor", "--focus", "--workers",
  "--research-args", "--plan-args", "--brief", "--live-url", "--build", "--setup", "--causes", "--people", "--decisions", "--max-workers", "--visual-allow", "--visual-dir", "--property", "--gsc-file", "--gsc-days", "--links-csv", "--overrides", "--home-ok", "--min-score",
  "--new-origin", "--gap-ms", "--max-urls", "--exclude", "--snapshot-dir", "--image-scope", "--max-pages"]);
const flag = (k) => A.includes(k);
const val = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const vals = (k) => A.flatMap((x, i) => (x === k ? [A[i + 1]] : []));
const pos = A.filter((x, i) => !x.startsWith("--") && !VALUE_FLAGS.has(A[i - 1]));
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

const MODES = ["audit-live", "audit-repo", "audit", "compare", "research", "refactor", "measure", "migrate", "build", "new", "iterate", "local"];
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
const REMEMBER = new Set(["--exclude", "--max-pages", "--gap-ms", "--launch-state", "--launch-state-a", "--launch-state-b", "--competitor", "--focus", "--workers", "--research-args", "--plan-args", "--brief", "--live-url", "--build", "--setup", "--causes", "--people", "--decisions", "--max-workers", "--visual-allow", "--visual-dir", "--property", "--gsc-file", "--gsc-days", "--links-csv", "--overrides", "--home-ok", "--min-score", "--new-origin", "--max-urls", "--snapshot-dir", "--image-scope"]);
const BOOL_REMEMBER = new Set(["--ignore-robots", "--no-visual", "--no-images", "--fetch-sitemap", "--probe-old", "--include-suggestions", "--no-authority", "--strict", "--no-build", "--offline"]);
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
  return { name: "doctor", kind: "script", what: "which free sources are connected (writes doctor.json)", cost: "free, seconds", inputs: () => [], outputs: () => [path.join(l.pewp, "doctor.json")], cmd: () => script("doctor.mjs", [target, "--cwd", cwd, ...(flag("--offline") ? ["--offline"] : [])]) };
}
function snapshotStage(l, name = "snapshot") {
  return { name, kind: "script", what: `a polite snapshot of ${l.target} with real Chrome phone speed (reused when younger than 7 days)`, cost: "polite crawl: up to 20 pages, one request every 4 s, 3 phone runs each; about 30 to 60 minutes when a new one is taken, seconds when reused",
    inputs: () => [], outputs: () => { const d = snapDirOf(l); return d ? [path.join(d, "_site.json")] : [NEVER(l)]; },
    cmd: () => script("live-target.mjs", [l.target, "--cwd", cwd, ...(flag("--fresh") ? ["--fresh"] : []), ...(val("--max-age-days") ? ["--max-age-days", val("--max-age-days")] : []), ...(snapshotArgs().length ? ["--", ...snapshotArgs()] : [])]),
    judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").filter(Boolean).pop() } : { outcome: "fail", message: `the polite crawl stopped (a 429 rate limit, the time limit, or a crash): see _site.json stoppedEarly in the newest snapshot folder; wait and run again. ${r.out.split("\n").filter(Boolean).pop() || ""}` }) };
}
function checkerStage(l, name = "checker") {
  const root = () => (l.kind === "url" ? snapDirOf(l) : l.root);
  const dir = () => root() || NEVER(l);
  return { name, kind: "agent", what: `the checker agent reads ${l.kind === "url" ? "the snapshot" : "the codebase"} against the shipgate checklist and writes .checks/ (root causes first)`,
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
function approvalStage(name, what, l, kind, o = {}) {
  const t = mode === "compare" ? null : (isUrl(l.target) ? l.target : l.root);
  const from = o.from ? ["--from", o.from] : [];
  return { name, kind: "approval", what, cost: "a person signs; no spend", inputs: () => o.inputs || [kind === "targets" ? "targets.json" : "plan/sitemap.json"], outputs: () => [P("approved", kind === "targets" ? "targets.json" : path.join("plan", "sitemap.json")), P("approved", "lock.json")],
    cmd: () => script("approve.mjs", [t, kind, ...from, "--cwd", cwd]),
    judge: (r) => (r.code === 0 ? { outcome: "done", message: "approved copy matches the working file" } : r.code === 3 ? { outcome: "approval", message: `${r.out.trim()}\nNEEDS-APPROVAL stage=${name}: the owner reads the diff above and decides. To sign (the main session records the owner's decision, with the owner's name): node "${rel(path.join(stageDir, "approve.mjs"))}" "${t}" ${kind} ${from.join(" ")} --by "<owner name>"   then run the same start command again.` } : { outcome: r.code === 2 ? "blocked" : "fail", message: r.out.trim().split("\n").slice(-6).join("\n") }) };
}

// ---------------------------------------------------------------- the sequences
function sequence() {
  const S = [];
  if (mode === "audit-live") {
    S.push(doctorStage(loc, T1), snapshotStage(loc), checkerStage(loc), authorityStage(loc),
      { name: "report", kind: "script", what: "the six-question report in plain words (report.md) with every number sourced (report.json)", cost: "free, seconds",
        inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }, { abs: path.join(snapDirOf(loc) || P("none"), ".checks", "causes.json") }, "authority.json", "business.json"], outputs: () => [P("report.md"), P("report.json")],
        cmd: () => script("report-live.mjs", [T1, "--cwd", cwd, ...launchArgs()]) });
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
      { name: "research-plan", kind: "script", what: "the research plan and its external-call count (dry run: nothing is fetched)", cost: "free; prints the plan", inputs: () => ["business.json"], outputs: () => [P("start", "research-plan.log")], logOutput: "research-plan.log",
        cmd: () => script("research.mjs", [targetArg, "--cwd", cwd, "--dry", ...splitArgs(val("--research-args"))]), judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : r.code === 3 ? { outcome: "blocked", message: tail(r.out) } : { outcome: "fail", message: tail(r.out) }) },
      researchStage(targetArg));
  } else if (mode === "refactor") {
    const dryArgs = () => [loc.root, ...(val("--build") ? ["--build", val("--build")] : ["--no-build"]), ...(val("--setup") ? ["--setup", val("--setup")] : []), ...(val("--causes") ? ["--causes", val("--causes")] : []), ...(val("--people") ? ["--people", val("--people")] : []), ...vals("--decisions").flatMap((d) => ["--decisions", d]), ...(val("--max-workers") ? ["--max-workers", val("--max-workers")] : [])];
    const buildNeeds = () => (val("--build") || flag("--no-build") ? [] : [{ id: "build", question: "Which command regenerates the site? A check proves nothing without a rebuild. Look in the README or package.json (for example `node _build/build.mjs`); a site with no generator is `--no-build`.", options: ["a build command from the README or package.json (recommended when one exists)", "none: the site has no generator (--no-build)"] }]);
    const rfArgs = () => [...dryArgs(), ...(flag("--yes") ? ["--yes"] : []), ...(flag("--no-visual") ? [] : ["--visual"]), ...(val("--visual-dir") ? ["--visual-dir", val("--visual-dir")] : []), ...vals("--visual-allow").flatMap((a) => ["--visual-allow", a])];
    S.push(doctorStage(loc, loc.root), guardStage(loc, "before"), checkerStage(loc), guardStage(loc, "after"),
      { name: "refactor-dry", kind: "script", what: "the refactor plan: how many fix workers, which causes are skipped (nothing is changed)", cost: "free; prints the worker count (cap 12 per run, 3 at once, 30 minutes each, Sonnet high effort)", inputs: () => [{ abs: path.join(loc.root, ".checks", "causes.json") }, { git: loc.root }], outputs: () => [P("start", "refactor-dry.log")], logOutput: "refactor-dry.log",
        needs: buildNeeds, cmd: () => script("refactor.mjs", [...dryArgs(), "--dry"]), judge: (r) => (r.code === 0 ? { outcome: "done", message: "" } : { outcome: "fail", message: tail(r.out) }) },
      ackStage("refactor-ok", "the owner agrees to the worker count and the cost of the refactor run", { inputs: () => ["start/refactor-dry.log"], cost: "Sonnet fix workers, high effort: up to 12 per run (3 at once, 30 minutes each)",
        instruction: () => `NEEDS-APPROVAL stage=refactor-ok: show the owner the plan below (workers and what is skipped), then ask as a pickable option whether to run it. If yes, the main session records it:\n  node "${rel(path.join(here, "start.mjs"))}" refactor "${rel(loc.root)}" --ack refactor-ok --by "<owner name>"\n${(() => { try { return fs.readFileSync(P("start", "refactor-dry.log"), "utf8").split("\n").map((l) => "    " + l).slice(0, 14).join("\n"); } catch { return ""; } })()}` }),
      { name: "refactor", kind: "script", what: "one worktree and fix worker per root cause: fix the generator, rebuild, every check FAIL->PASS with no regression; REF-009 screenshots before and after; nothing merged", cost: "up to 12 Sonnet fix workers (3 at once, 30 minutes each); can run 1 to 3 hours: run it in the background",
        inputs: () => [{ abs: path.join(loc.root, ".checks", "causes.json") }, "start/refactor-dry.log"], outputs: () => [], needs: buildNeeds, cmd: () => script("refactor.mjs", rfArgs(), { timeoutMin: 300 }),
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
      { name: "measure-run", kind: "script", what: "rankings, citations, Search Console, CrUX, index, AI answers, diff against the last run (BLOCKED parts are results, listed in summary.json)", cost: "free sources; within the call caps above",
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
      { name: "inventory", kind: "script", what: "every old URL: old snapshot + sitemap + Search Console pages + pages with links", cost: "free; Search Console and links exports are optional inputs (BLOCKED parts are listed)", inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }, ...(val("--gsc-file") ? [{ abs: val("--gsc-file") }] : []), ...(val("--links-csv") ? [{ abs: val("--links-csv") }] : [])], outputs: () => [M("inventory.json")], cmd: () => script("migrate.mjs", mArgs("inventory", flag("--probe-old") ? ["--probe-old"] : [])) },
      { name: "map", kind: "script", what: "the redirect map old -> new (one hop 301, no chains, nothing to the homepage), _redirects, carry-over", cost: "free; a new URL is read through its sitemap (polite, cached)", inputs: () => ["migrate/inventory.json", ...newInput()], outputs: () => [M("redirect-map.json"), M("redirect-map.csv"), M("_redirects")], cmd: () => script("migrate.mjs", mArgs("map", flag("--include-suggestions") ? ["--include-suggestions"] : [])) },
      ackStage("map-review", "the owner reviews the suggested redirects in redirect-map.csv (a guess is never applied until approved)", { inputs: () => ["migrate/redirect-map.csv"], by: true,
        instruction: () => { let s = ""; try { const m = JSON.parse(fs.readFileSync(M("redirect-map.json"), "utf8")).summary; s = `${m.total} old addresses: ${m.same} same path, ${m.needsReview} guesses to approve, ${m.noTarget} with no target, ${m.gone410} 410 candidates. `; } catch {} return `NEEDS-APPROVAL stage=map-review: ${s}The owner opens ${rel(M("redirect-map.csv"))}, sets approved to yes or no on each guess (or gives a target), and says so. Then record it:\n  node "${rel(path.join(here, "start.mjs"))}" migrate "${T1}" "${T2}" --ack map-review --by "<owner name>"   (re-run the map first if the csv changed: start does that by itself)`; } }),
      { name: "baseline", kind: "script", what: "pre-cutover baseline: traffic per page, old statuses, rankings, AI citations, authority", cost: "free sources", inputs: () => ["migrate/inventory.json", "migrate/redirect-map.json"], outputs: () => [M(`baseline-${today}.json`)], cmd: () => script("migrate.mjs", mArgs("baseline")) },
      { name: "service-workers", kind: "script", what: "REF-013: every service worker the old site registered is retired on the new site (a self-unregistering worker at the same URL, or Clear-Site-Data)", cost: "free; reads the old snapshot and the new folder (or 2 requests to a new origin)",
        inputs: () => [{ abs: path.join(snapDirOf(loc) || P("none"), "_site.json") }, ...newInput()], outputs: () => [M("serviceworkers-check.json")],
        needs: () => (!newFolder && !newIsUrl ? [] : []),
        cmd: () => script("ref-sw.mjs", ["check", snapDirOf(loc) || "", ...(newFolder ? ["--new-site", newFolder] : ["--new-origin", val("--new-origin") || T2, ...(isLoopbackUrl(val("--new-origin") || T2) ? [] : ["--allow-remote"])]), "--out", M("")]),
        judge: (r) => (r.code === 0 ? { outcome: "done", message: r.out.split("\n").find((l) => /^# /.test(l)) || "" } : { outcome: "fail", message: `REF-013: an old service worker is not retired on the new site.\n${tail(r.out, 10)}` }) },
      { name: "gate", kind: "script", what: "every old URL with traffic or links resolves in ONE hop (301/308) to a 200 on the new site; REF-014: every old image URL keeps working", cost: "one request per URL per second (cap 500 URLs, 2000 images); GET only; stops at the first 429",
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
  }
  return S;
}
const splitArgs = (s) => (s || "").split(/\s+/).filter(Boolean);
const isLoopbackUrl = (u) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
function researchStage(t, bizFile = "business.json") {
  return { name: "research", kind: "script", what: "demand, competitors, AI citations from free sources -> targets.json (validated) and research/report.md", cost: "free sources; caps per run: Bing 60, competitor sites 12, Reddit 12, Gemini 30, captures 60; a plan above 150 external calls needs --yes (the owner agrees first)",
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
  if (outsOf(s).some((o) => !fs.existsSync(o))) return { status: "pending", note: "outputs missing" };
  if (!rec.inputsHash) { persist((x) => { x.stages[s.name].inputsHash = cur.hash; x.stages[s.name].inputsDetail = cur.detail; x.stages[s.name].adopted = true; }); return { status: "done", note: "adopted (already done outside start)" }; }
  return { status: "done", note: "" };
}
function markDone(s, outputs = {}, extra = {}) {
  const cur = hashInputs(s.inputs ? s.inputs() : []);
  persist((x) => { x.stages[s.name] = { doneAt: new Date().toISOString(), outputs: Object.fromEntries(outsOf(s).map((o) => [path.basename(o), rel(o)])), ...outputs, inputsHash: cur.hash, inputsDetail: cur.detail, ...extra }; });
}
function setRun(status, stage, message = "") { persist((x) => { x.start = { ...(x.start || {}), mode, targets: [T1, T2].filter(Boolean), sequence: SEQ.map((s) => ({ name: s.name, kind: s.kind, optional: !!s.optional })), status, stage, message: String(message).slice(0, 400), updatedAt: new Date().toISOString() }; }); }

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

// ---------------------------------------------------------------- main
const SEQ = sequence();
const byName = new Map(SEQ.map((s) => [s.name, s]));
if (val("--stage") && !byName.has(val("--stage"))) die(`no stage "${val("--stage")}" in mode ${mode}. Stages: ${SEQ.map((s) => s.name).join(", ")}`);

// acks first: a person's decision, recorded by the main session
if (val("--ack")) {
  const s = byName.get(val("--ack"));
  if (!s) die(`--ack ${val("--ack")}: no such stage in mode ${mode}. Stages: ${SEQ.map((x) => x.name).join(", ")}`);
  if (s.kind !== "ack") die(`--ack ${s.name}: ${s.name} is run by a script or an agent, not acknowledged by a person. The stages that take --ack: ${SEQ.filter((x) => x.kind === "ack").map((x) => x.name).join(", ") || "none"}`);
  if (s.ack.by && !val("--by")) die(`--ack ${s.name} needs --by "<the name of the person who decided>": the owner decides, the main session records.`);
  const extra = {};
  if (s.name === "cutover") { if (!/^\d{4}-\d{2}-\d{2}$/.test(val("--cutover-date") || "")) die("--ack cutover needs --cutover-date YYYY-MM-DD"); extra.date = val("--cutover-date"); }
  if (s.name === "builder") { const sd = path.resolve(val("--site") || path.join(loc.root, "site")); if (!fs.existsSync(sd)) die(`--ack builder: the built site folder ${sd} does not exist`); extra.site = sd; }
  markDone(s, {}, { ack: { by: val("--by") || null, at: new Date().toISOString(), ...extra } });
  fs.mkdirSync(P("start"), { recursive: true });
  fs.writeFileSync(P("start", `ack-${s.name}`), JSON.stringify({ by: val("--by") || null, at: new Date().toISOString(), ...extra }) + "\n");
  console.log(`recorded: ${s.name} acknowledged${val("--by") ? " by " + val("--by") : ""}`);
}

// status table (also persists the stale marks)
const rows = SEQ.map((s) => ({ s, ...statusOf(s) }));
persist((x) => { x.stages = x.stages || {}; for (const r of rows) if (x.stages[r.s.name]) { if (r.status === "stale") x.stages[r.s.name].stale = { markedAt: new Date().toISOString(), changed: r.changed }; else delete x.stages[r.s.name].stale; } });
const planLines = [`PLAN ${mode} ${[T1, T2].filter(Boolean).join(" ")}  (state: ${rel(P("state.json"))})`];
SEQ.forEach((s, i) => {
  const r = rows[i]; const skip = s.skipIf?.();
  planLines.push(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(18)} ${(skip ? "skipped" : r.status).padEnd(8)} ${("[" + s.kind + "]").padEnd(10)} ${s.what}${r.note ? `  (${r.note})` : ""}${skip ? `  (skipped: ${skip})` : ""}`);
  if (r.status !== "done" && !skip) planLines.push(`        cost: ${s.cost}`);
});
if (remembered.length) planLines.push(`  options remembered from the earlier start of this run (state.json start.options; --forget-options clears them): ${remembered.join(" | ")}`);
console.log(planLines.join("\n"));
const need =SEQ.filter((s, i) => !s.skipIf?.() && rows[i].status !== "done");
if (!go && !val("--ack")) {
  setRun(need.length ? "planned" : "done", need[0]?.name || null, need.length ? `${need.length} stage(s) to run` : "everything is done");
  console.log(need.length ? "Plan only. Show it (and the costs) to the owner, then run again with --go." : "Every stage is done and its inputs are unchanged.");
  process.exit(0);
}
if (!go) process.exit(0);

setRun("running", need[0]?.name || null, "");
const targetsToRun = val("--stage") ? [byName.get(val("--stage"))] : SEQ;
let stoppedFor = null;
for (const s of targetsToRun) {
  const i = SEQ.indexOf(s); const skip = s.skipIf?.();
  if (skip) { console.log(`${s.name}: skipped (${skip})`); continue; }
  const forced = !!val("--stage");
  let status = forced ? { status: "pending" } : statusOf(s);
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
  let v = s.judge ? s.judge(res) : (res.code === 0 ? { outcome: "done", message: "" } : res.code === 3 ? { outcome: "needs-input", message: `NEEDS-INPUT stage=${s.name}: ${tail(res.out)}` } : res.code === 4 ? { outcome: "blocked", message: res.out.trim().split("\n").pop() } : { outcome: "fail", message: tail(res.out, 15) });
  if (res.notBuilt) v = { outcome: "blocked", message: res.out };
  if (res.timedOut) v = { outcome: "fail", message: `timed out after ${(c.timeoutMin || timeoutMs / 60_000)} min` };
  if (v.outcome === "done" && outsOf(s).some((o) => !fs.existsSync(o))) v = { outcome: "fail", message: `the script exited 0 but did not write: ${outsOf(s).filter((o) => !fs.existsSync(o)).map(rel).join(", ")}` };
  if (v.outcome === "done") { markDone(s); if (v.message) console.log(`${s.name}: done. ${v.message}`); else console.log(`${s.name}: done`); continue; }
  if (v.outcome === "blocked" && s.optional) { persist((x) => { x.stages[s.name] = { blocked: String(v.message).slice(0, 300), at: new Date().toISOString() }; }); console.log(`${s.name}: skipped, BLOCKED (optional): ${v.message}`); continue; }
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
  if (!open.length || val("--stage")) { if (!val("--stage")) setRun("done", null, "all stages done"); console.log(val("--stage") ? "stage finished." : "ALL STAGES DONE."); process.exit(0); }
  process.exit(stoppedFor ?? 0);
}
process.exit(stoppedFor);
