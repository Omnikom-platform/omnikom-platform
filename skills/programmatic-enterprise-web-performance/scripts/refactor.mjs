// refactor mode driver: fix the root causes of an audit on a git branch, prove each fix, never touch main.
// Usage: node refactor.mjs <site root> --build "<build command>" | --no-build
//          [--setup "<cmd run once in every worktree, e.g. npm ci>"] [--causes C01,C03] [--people C04,C07]
//          [--parallel 3 | --max-parallel 3] [--project-merges] [--live-root <subfolder>] [--no-setup] [--timeout-min 30] [--build-timeout-min 10] [--model sonnet] [--effort high]
//          [--worktrees <dir outside the repo>] [--date YYYY-MM-DD] [--worker-script <file>] [--dry]
//          [--max-workers 12] [--yes] [--decisions <binding decisions file>]... (DECISIONS.md at the site root / repo top is found by itself)
//          [--visual [--visual-dir <subfolder of the site root that holds the built HTML>] [--visual-max-diff 0.001] [--visual-groups 40]
//           [--visual-allow "<route group path>=<ratio>"]... [--visual-allow-file refactor.json] [--visual-mask "<css selector>"]...]
//             REF-009: screenshots of every route group (template families + one-off pages) at the mobile and desktop baseline
//             viewports before any fix and after the merged fixes (real Chrome, scripts/ref-visual.mjs), pixel diff, changed regions
//             in the report. A difference over the allowance is REPORTED (it does not make the run UNSAFE: a contrast or spacing fix is
//             meant to change pixels; the owner looks at the pictures and declares it with --visual-allow). No Chrome: reported BLOCKED.
//          [--no-stability]  skip the rebuild-stability check (IDX-003 / SE-004 / AEO-012, lib-freshness.mjs). By default the untouched code
//             is built a second time at the baseline, and once more after every merge onto the combined branch: a date field (sitemap
//             lastmod, JSON-LD dateModified, ...) that moves between two builds of the same commit is the build clock, and a merge that
//             brings that in is rejected like a regression. A baseline that already fails is a pre-existing finding, not a regression.
//          --max-parallel N   same as --parallel (the overhaul start passes this name; with both, the smaller wins)
//          --project-merges   the project merges only through its own gate (CI green, never a direct merge): the integration branch is still
//             prepared and the report's closing lines say so instead of suggesting a merge command. Nothing else changes.
//          --no-setup         accepted and ignored (the overhaul start passes it as a recorded answer: there is no setup command)
//          --live-root <sub>  the folder (under the site root) that holds the built output; the live check scripts of origin:"live" causes
//             are run against it (default: the site root)
// Causes from a LIVE audit (causes-map.mjs): origin:"live" causes carry liveChecks (absolute paths of the live audit's check scripts) and no
//   repo check. Proof = after the rebuild each live check is run as `node <check> <built output root>`: all PASS -> FIXED; a check that
//   cannot judge (exit 2: the script is missing, or it expects a different folder layout) -> NEEDS-PROOF with its own line, never FIXED;
//   any FAIL -> NOT FIXED. A repo cause with liveEvidence is proven by its repo checks as before; the live evidence is only told to the worker.
// Needs <site root>/.checks/{causes.json,run-all.mjs,scripts/} from an audit (coordinator.md) and a git repo.
// What it does (stages/refactor.md has the full contract):
//   1. integration worktree on a NEW branch pewp/refactor-<date>; build; baseline = run-all before any fix
//   2. per root cause (cap --parallel): its own worktree + branch, a headless Sonnet fix worker (or --worker-script,
//      a stand-in for tests), then the COORDINATOR rebuilds and re-runs every check: FIXED only when the cause's
//      checks go FAIL -> PASS and no other check goes PASS -> not pass; else NOT FIXED / REGRESSED
//   3. FIXED causes are merged into the integration branch; one more build + run-all proves the combination
//   4. <site root>/.pewp/refactor/<date>.md + .json for the owner. NOTHING is merged to main, pushed or deployed.
// Exit: 0 report written; 1 safety failure (main checkout changed while workers ran, or the combined branch
// regressed a check); 2 usage / cannot start.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diffRunAll, snapshotRunAll } from "./run-all-diff.mjs";
import { locate, markStage } from "./state.mjs";
import { rebuildAndJudge, newFailures, plainReason, formatLines, gitRun, runShell as runBounded, supervised, whichExe } from "./lib-freshness.mjs";

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--build", "--setup", "--causes", "--people", "--parallel", "--max-parallel", "--live-root", "--timeout-min", "--build-timeout-min", "--model", "--effort", "--worktrees", "--date", "--worker-script", "--max-workers", "--decisions", "--visual-dir", "--visual-max-diff", "--visual-groups", "--visual-allow", "--visual-allow-file", "--visual-mask"]);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const positional = A.filter((x, i) => !x.startsWith("--") && !VALUE_FLAGS.has(A[i - 1]));
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
if (!positional[0]) die("usage: node refactor.mjs <site root> --build \"<cmd>\" | --no-build [--setup cmd] [--causes C01,C02] [--people C04] [--parallel 3] [--timeout-min 30] [--dry]");

const siteRoot = path.resolve(positional[0]);
const buildCmd = opt("--build");
const setupCmd = opt("--setup");
if (!buildCmd && !A.includes("--no-build")) die("refactor needs --build \"<command that regenerates the site>\" (the check only means something after a rebuild) or --no-build for a site with no generator");
// --max-parallel is the overhaul start's name for --parallel; if both are given the smaller wins (never more workers than either allows)
const parVals = ["--parallel", "--max-parallel"].filter((k) => A.includes(k)).map((k) => Number(opt(k))).filter((v) => Number.isFinite(v));
const parallel = Math.max(1, parVals.length ? Math.min(...parVals) : 3);
const projectMerges = A.includes("--project-merges");
const liveRootSub = opt("--live-root") || ".";
const timeoutMs = Number(opt("--timeout-min", 30)) * 60_000;
const buildTimeoutMs = Number(opt("--build-timeout-min", 10)) * 60_000;
const model = opt("--model", "sonnet");
const effort = opt("--effort", "high");
const workerScript = opt("--worker-script");
const dry = A.includes("--dry");
const date = opt("--date") || new Date().toLocaleDateString("sv-SE");
const only = (opt("--causes") || "").split(",").map((s) => s.trim()).filter(Boolean);
const peopleIds = (opt("--people") || "").split(",").map((s) => s.trim()).filter(Boolean);

// ---------- helpers ----------
// git never prompts or opens an editor (GIT_TERMINAL_PROMPT=0, GIT_EDITOR=true); a held index.lock is retried once (lib-freshness gitRun).
// Steps that check out files or run the repository's hooks (worktree add, commit, merge, checkout, reset) get 10 minutes, the rest 60 s.
const SLOW_GIT = new Set(["worktree", "commit", "merge", "checkout", "reset", "add"]);
const git = (cwd, ...a) => { const sub = a.find((x) => !x.startsWith("-") && !/^user\.(name|email)=/.test(x)); return gitRun(cwd, a, { timeoutMs: SLOW_GIT.has(sub) ? 600_000 : 60_000, maxBuffer: 256 * 1024 * 1024 }); };
const GIT_ID = ["-c", "user.name=pewp refactor", "-c", "user.email=pewp-refactor@localhost"];
const rel = (p) => p.replace(/\\/g, "/");
// A build or setup command: the whole process tree ends at the time limit (a timed-out build must not keep writing into the worktree).
function runShell(cmd, cwd, ms) {
  const t = Date.now();
  const r = runBounded(cmd, cwd, ms);
  return { code: r.code, secs: Math.round((Date.now() - t) / 1000), tail: r.timedOut ? `timed out after ${Math.round(ms / 1000)} s (the command and everything it started were stopped)\n${r.tail}`.slice(0, 600) : r.tail };
}
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");

// Everything in a checkout that could show a worker touched it: dirty/untracked file contents + branch/tag tips
// (our own pewp/refactor-* branches excluded). .checks/ and .pewp/ are ours and never count.
const SKIP_PATH = /(^|\/)\.(checks|pewp)(\/|$)/;
const OURS = /^refs\/heads\/pewp\/refactor-/;
function hashFile(p) {
  try {
    const st = fs.statSync(p);
    return st.size > 5 * 1024 * 1024 ? `big:${st.size}:${st.mtimeMs}` : sha(fs.readFileSync(p));
  } catch { return "deleted"; }
}
// SCOPE (a monorepo has other sessions working in it): the dirty/untracked files UNDER THE SITE ROOT and the base branch's tip.
// Anything else that changes (files elsewhere in the repo, other branches) is only a NOTE in the report, never UNSAFE. If the
// base branch moved, the commits' paths decide: touching the site root counts as a change of the site, otherwise it is a note
// (and nothing is rebased).
const inSite = (p) => !prefix || p === prefix || p.startsWith(prefix + "/");
let prefix = ""; // set below, once the site root is known
let baseBranch = "";
function fingerprint(top) {
  const files = new Map(); // under the site root
  const outside = new Map(); // elsewhere in the repository: notes only
  const parts = git(top, "status", "--porcelain=v1", "-z", "--untracked-files=all").raw.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    const code = e.slice(0, 2);
    const p = e.slice(3);
    if (code[0] === "R" || code[0] === "C") i++;
    if (SKIP_PATH.test(p)) continue;
    (inSite(p) ? files : outside).set(p, `${code} ${hashFile(path.join(top, p))}`);
  }
  const base = git(top, "rev-parse", baseBranch === "HEAD" ? "HEAD" : "refs/heads/" + baseBranch).out;
  const otherRefs = new Map();
  for (const l of git(top, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags").out.split("\n").filter(Boolean)) {
    const [n, o] = l.split(" ");
    if (!OURS.test(n) && n !== "refs/heads/" + baseBranch) otherRefs.set(n, o);
  }
  return { files, outside, base, otherRefs };
}
// -> { unsafe: what changed under the site root, notes: everything else }
function fpDiff(a, b, top) {
  const unsafe = [], notes = [];
  for (const k of new Set([...a.files.keys(), ...b.files.keys()])) if (a.files.get(k) !== b.files.get(k)) unsafe.push(`file ${k}`);
  for (const k of new Set([...a.outside.keys(), ...b.outside.keys()])) if (a.outside.get(k) !== b.outside.get(k)) notes.push(`file ${k} (outside the site)`);
  for (const k of new Set([...a.otherRefs.keys(), ...b.otherRefs.keys()])) if (a.otherRefs.get(k) !== b.otherRefs.get(k)) notes.push(`ref ${k} (another branch)`);
  if (a.base !== b.base) {
    const names = git(top, "diff", "--name-only", a.base, b.base).out.split("\n").filter(Boolean);
    const siteNames = names.filter(inSite);
    for (const n of siteNames) unsafe.push(`committed ${n} on ${baseBranch}`);
    notes.push(`the base branch ${baseBranch} moved ${a.base.slice(0, 8)} -> ${b.base.slice(0, 8)} (${git(top, "rev-list", "--count", a.base + ".." + b.base).out} commit(s), ${siteNames.length} path(s) under the site); nothing was rebased`);
  }
  return { unsafe, notes };
}

// What the worker may not have: tokens that deploy or publish, and any way to push. Git is told every remote's
// push URL is dead (also for pushes by raw URL); this holds for `node -e` child processes too, which Bash(node:*) allows.
const SECRET_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|CLOUDFLARE|NETLIFY|VERCEL|WRANGLER|GITHUB|^GH_|AWS_|AZURE|GOOGLE_APPLICATION|SUPABASE|NPM_CONFIG|SSH_AUTH)/i;
function workerEnv(top) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE_)/i.test(k)) env[k] = v;
    else if (!SECRET_RE.test(k)) env[k] = v;
  }
  const cfg = [];
  for (const r of git(top, "remote").out.split(/\s+/).filter(Boolean)) {
    cfg.push([`remote.${r}.pushurl`, `pewp-push-blocked://${r}`]);
    const u = git(top, "remote", "get-url", r).out;
    if (u) cfg.push(["url.pewp-push-blocked://raw.pushInsteadOf", u]);
  }
  for (const p of ["https://", "http://", "ssh://", "git@", "git://", "file://"]) cfg.push(["url.pewp-push-blocked://any.pushInsteadOf", p]);
  env.GIT_CONFIG_COUNT = String(cfg.length);
  cfg.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", CLAUDE_SYNC_SKIP: "1", CLAUDE_LEARN_SKIP: "1", PEWP_ROLE: "fix-worker" });
  return env;
}

const PEOPLE_RE = /\b(owner|client)[ -](decision|content|to (provide|supply|confirm|approve|decide|write))|\bneeds? (a |the )?(owner|client|human|people)\b|\b(real|actual|genuine) (licen[cs]e|testimonials?|reviews?|photos?|credentials?|prices?)\b|\bask the (owner|client)\b|\blegal review\b|\bwrite (the |real )?copy\b|\bplatform:/i;
const peopleReason = (c, extra) => {
  if (extra[c.id]) return extra[c.id];
  if (peopleIds.includes(c.id)) return "marked as needing people by the operator (--people)";
  const m = `${c.fix || ""} ${c.problem || ""}`.match(PEOPLE_RE);
  return m ? `the fix text asks for people ("${m[0]}")` : null;
};

// ---------- causes from the live audit (causes-map.mjs) ----------
const isLive = (c) => c.origin === "live";
const fixAtList = (c) => (Array.isArray(c.fixAt) ? c.fixAt : c.fixAt ? [c.fixAt] : []);
// -> { present: [abs path], missing: [abs path] } of the live check scripts a live cause names
const liveFiles = (c) => {
  const all = (c.liveChecks || []).map((p) => path.resolve(siteRoot, p));
  return { present: all.filter((p) => fs.existsSync(p)), missing: all.filter((p) => !fs.existsSync(p)) };
};
// One live check against a built output root. exit 0 = PASS, 1 = FAIL, anything else (exit 2, a crash, a timeout) = it cannot judge there.
function runLiveCheck(root, script) {
  const dir = path.resolve(root, liveRootSub);
  const r = spawnSync(process.execPath, [script, dir], { cwd: fs.existsSync(dir) ? dir : root, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const line = ((r.stdout || "").trim().split("\n")[0] || (r.stderr || "").trim().split("\n")[0] || "").slice(0, 200);
  if (r.error) return { script, status: "cannot", line: r.error.code === "ETIMEDOUT" ? "timed out after 60 s" : String(r.error.code || r.error.message) };
  return { script, status: r.status === 0 ? "pass" : r.status === 1 ? "fail" : "cannot", line };
}
const runLiveAll = (c, root) => liveFiles(c).present.map((p) => runLiveCheck(root, p));
const liveWord = { pass: "pass", fail: "open", cannot: "cannot judge" };
const liveBase = new Map(); // live cause id -> [{ script, status, line }] on the untouched code (filled after the baseline build)

// A worker runs under the job-object supervisor (lib-freshness supervised): killing the supervisor ends the worker's whole tree,
// the shells and their children included (`taskkill /T` alone misses Git Bash children). Without the supervisor: taskkill /T.
function killTree(child, isSupervised) {
  try {
    if (process.platform === "win32" && !isSupervised) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 10_000 });
    else child.kill("SIGKILL");
  } catch {}
}

// ---------- preconditions ----------
const checksDir = path.join(siteRoot, ".checks");
for (const f of ["causes.json", "run-all.mjs", "scripts"]) if (!fs.existsSync(path.join(checksDir, f))) die(`no ${rel(path.join(checksDir, f))}: run the audit (coordinator.md) first; refactor starts from its causes.json`);
const top = git(siteRoot, "rev-parse", "--show-toplevel").out;
if (!top) die(`${siteRoot} is not inside a git repository: refactor needs git to keep main safe`);
const topReal = path.resolve(top);
prefix = path.relative(topReal, fs.realpathSync(siteRoot)).replace(/\\/g, "/");
const baseSha = git(topReal, "rev-parse", "HEAD").out;
baseBranch = git(topReal, "rev-parse", "--abbrev-ref", "HEAD").out;
if (!baseSha) die("the repository has no commit yet");
const causesAll = JSON.parse(fs.readFileSync(path.join(checksDir, "causes.json"), "utf8"));
let causes = causesAll.filter((c) => !only.length || only.includes(c.id));
if (only.length && causes.length !== only.length) die(`unknown cause id in --causes (have ${causesAll.map((c) => c.id).join(", ")})`);
const peopleFile = path.join(siteRoot, ".pewp", "needs-people.json");
let extraPeople = {};
try { extraPeople = JSON.parse(fs.readFileSync(peopleFile, "utf8").replace(/^\uFEFF/, "")); } catch (e) { if (fs.existsSync(peopleFile)) die(`${rel(peopleFile)} is not valid JSON (${e.message}): fix it or remove it, then run again`); }

let runId = date;
for (let n = 2; git(topReal, "show-ref", "--verify", "--quiet", `refs/heads/pewp/refactor-${runId}`).code === 0; n++) runId = `${date}-${n}`;
const branch = `pewp/refactor-${runId}`;
const wtBase = path.resolve(opt("--worktrees") || path.join(path.dirname(topReal), `${path.basename(topReal)}.pewp-refactor-${runId}`));
if (!path.relative(topReal, wtBase).startsWith("..")) die("--worktrees must be outside the repository");
const outDir = path.join(siteRoot, ".pewp", "refactor");
const buildAllow = buildCmd && !/^node\b/.test(buildCmd) ? [`Bash(${buildCmd.split(/\s+/).slice(0, 3).join(" ")}:*)`] : [];

const promptTemplate = fs.readFileSync(path.join(skill, "fix-worker-prompt.md"), "utf8");
const workerArgs = (wtRoot) => [
  "-p", "--model", model, "--effort", effort, "--output-format", "json", "--no-session-persistence", "--permission-mode", "acceptEdits",
  "--allowedTools", "Read", "Grep", "Glob", "Write", "Edit", "Bash(node:*)", ...buildAllow, "Bash(git status:*)", "Bash(git diff:*)", "Bash(git ls-files:*)",
  "--disallowedTools", "Bash(git push:*)", "Bash(git commit:*)", "Bash(git checkout:*)", "Bash(git reset:*)", "Bash(git merge:*)", "Bash(git rebase:*)", "Bash(git stash:*)",
  "Bash(npx:*)", "Bash(npm publish:*)", "Bash(npm install:*)", "Bash(curl:*)", "Bash(wrangler:*)", "Bash(netlify:*)", "WebFetch", "WebSearch",
  "--add-dir", wtRoot,
];

// Cost stop (modes.md): at most --max-workers fix workers per run (default 12) unless --yes. Without --causes the
// most severe causes covering the most pages go first; the rest wait for the next run. The selection happens AFTER the
// baseline (below), so a cause whose checks already pass on the last commit never takes a slot (batch 2 on proposals/vtv
// ran 2 workers of 12 because fixed causes filled the batch). An explicit --causes list over the cap is refused up front.
const maxWorkers = Number(opt("--max-workers") || 12);
// takes no worker slot: a repo cause when all its checks pass at the baseline; a live cause when none of its live checks FAILS there (all pass: nothing to fix; all cannot judge: no fix could be proven; liveBase is filled by then)
const alreadyPassing = (c) => (isLive(c) ? !(liveBase.get(c.id) || []).some((x) => x.status === "fail") : (c.scripts || []).length > 0 && c.scripts.every((s) => baseMap.get(s) === "pass"));
const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
const provable = (c) => c.scripts?.length || (isLive(c) && liveFiles(c).present.length);
const runnableNow = causes.filter((c) => provable(c) && !peopleReason(c, extraPeople));
if (only.length && runnableNow.length > maxWorkers && !A.includes("--yes")) die(`${runnableNow.length} fix workers requested, over the cost stop of ${maxWorkers}: pass fewer --causes, or --yes after the owner agrees`);
let deferred = [];

// Binding project decisions (a held area a fix must not touch): --decisions <file> (repeatable), plus DECISIONS.md at the
// site root or the repository top when one exists. The worker is told to read them and to answer NEEDS-PEOPLE for a held area.
const decisionFiles = [...new Set([...A.flatMap((x, i) => (x === "--decisions" ? [A[i + 1]] : [])).map((f) => path.resolve(f)), ...[path.join(siteRoot, "DECISIONS.md"), path.join(topReal, "DECISIONS.md")].filter((f) => fs.existsSync(f))])];
for (const f of decisionFiles) if (!fs.existsSync(f)) die(`--decisions ${f} does not exist`);

// START RULE: uncommitted changes under the site root are not in the worktrees (they start from the last commit), so the "before"
// would not be the code the owner sees. Refuse. Uncommitted changes elsewhere in a monorepo are only a note.
const fp0 = fingerprint(topReal);
const dirtyAtStart = [...fp0.files.keys()];
const outsideAtStart = [...fp0.outside.keys()];
if (dirtyAtStart.length) die(`refusing to start: ${dirtyAtStart.length} uncommitted change(s) under ${rel(siteRoot)} (${dirtyAtStart.slice(0, 5).join(", ")}${dirtyAtStart.length > 5 ? ", ..." : ""}). The fix worktrees start from the last commit, so the proof would not be about the code you see. Commit or stash them, then run again.`);

if (dry) {
  const runnable = causes.filter((c) => provable(c) && !peopleReason(c, extraPeople));
  console.log(`DRY refactor ${siteRoot}\n  branch ${branch} (new), worktrees under ${wtBase}, base ${baseSha.slice(0, 8)} on ${baseBranch}`);
  console.log(`  ${causes.length} root causes: ${runnable.length} would get a fix worker (Sonnet, ${effort} effort, cap ${parallel} at once, ${timeoutMs / 60000} min each), ${causes.length - runnable.length} skipped (needs people / no check)`);
  const liveCs = causes.filter(isLive);
  console.log(`  causes by origin: ${causes.length - liveCs.length} repo (${causes.filter((c) => c.liveEvidence).length} with live evidence), ${liveCs.length} live`);
  for (const c of liveCs) console.log(`    ${c.id} [origin live, ${c.severity}] ${String(c.problem).slice(0, 80)}; live checks: ${liveFiles(c).present.length} found, ${liveFiles(c).missing.length} missing; source file: unknown`);
  console.log(`  merges: ${projectMerges ? "through the project's own gate (--project-merges); the integration branch is still prepared" : "left to the owner (a branch is prepared, nothing is merged)"}`);
  console.log(`  build: ${buildCmd || "none"}${setupCmd ? `; setup: ${setupCmd}` : ""}; worker: ${workerScript ? `stand-in ${workerScript}` : `claude ${workerArgs("<worktree>").join(" ")}`}`);
  console.log(`  worker cap: ${maxWorkers} per run; a cause whose checks already pass at the baseline takes no slot (the exact batch is chosen after the baseline build)`);
  console.log(`  binding decisions read by every worker: ${decisionFiles.map(rel).join(", ") || "none (pass --decisions <file>; DECISIONS.md at the site root or repo top is found by itself)"}`);
  console.log(`  visual proof (REF-009): ${A.includes("--visual") ? "ON: route-group screenshots before and after, mobile + desktop, allowance " + Number(opt("--visual-max-diff", 0.001)) : "off (add --visual)"}`);
  console.log(`  rebuild stability (IDX-003/SE-004/AEO-012): ${!buildCmd ? "NOT CHECKED (no build command)" : A.includes("--no-stability") ? "NOT CHECKED (--no-stability)" : "ON: one extra build at the baseline and one after each merge"}`);
  console.log("  external API calls: none. Main is never touched; nothing is pushed or deployed.");
  process.exit(0);
}

// ---------- worktrees ----------
const results = new Map();
const mkResult = (c, extra) => ({ id: c.id, origin: isLive(c) ? "live" : "repo", liveEvidence: !!c.liveEvidence, severity: c.severity, problem: c.problem, fix: c.fix, fixAt: c.fixAt, rules: c.rules, pages: c.pages, verdict: null, reason: "", checks: [], alsoFixed: [], regressed: [], newlyFailing: [], files: [], commit: null, ...extra });
const wtRootOf = (wt) => (prefix ? path.join(wt, prefix) : wt);
function addWorktree(dir, br) {
  const r = git(topReal, "worktree", "add", "-q", "-b", br, dir, baseSha);
  if (r.code !== 0) die(`git worktree add failed: ${r.err}`);
  const root = wtRootOf(dir);
  fs.cpSync(checksDir, path.join(root, ".checks"), { recursive: true, filter: (s) => !/[\\/]\.checks[\\/](logs|prev|tmp|refactor)([\\/]|$)/.test(s) });
  return root;
}
function prepare(root) {
  if (setupCmd) { const s = runShell(setupCmd, root, buildTimeoutMs); if (s.code) return { ok: false, why: `setup failed (exit ${s.code}): ${s.tail}` }; }
  if (buildCmd) { const b = runShell(buildCmd, root, buildTimeoutMs); if (b.code) return { ok: false, why: `build failed (exit ${b.code}): ${b.tail}` }; }
  return { ok: true };
}
const checkHash = (root) => {
  const h = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else h.push(`${rel(path.relative(root, p))} ${hashFile(p)}`); } };
  walk(path.join(root, ".checks", "scripts"));
  for (const f of ["run-all.mjs", "causes.json"]) h.push(`${f} ${hashFile(path.join(root, ".checks", f))}`);
  return sha(h.join("\n"));
};
const stageAll = (wt) => git(wt, "add", "-A", "--", ".", ":(exclude,glob)**/.checks/**", ":(exclude,glob)**/.pewp/**");

console.log(`refactor: ${causes.length} root causes, branch ${branch}, worktrees in ${rel(wtBase)}, base ${baseSha.slice(0, 8)} (${baseBranch})`);
if (outsideAtStart.length) console.log(`NOTE: ${outsideAtStart.length} uncommitted path(s) elsewhere in the repository are not part of this run (not under the site root): ${outsideAtStart.slice(0, 5).join(", ")}${outsideAtStart.length > 5 ? ", ..." : ""}`);
const intDir = path.join(wtBase, "integration");
fs.mkdirSync(wtBase, { recursive: true });
const intRoot = addWorktree(intDir, branch);
const prep0 = prepare(intRoot);
if (!prep0.ok) {
  git(topReal, "worktree", "remove", "--force", intDir); git(topReal, "branch", "-D", branch);
  die(`BLOCKED: the untouched code does not build, so no fix can be proven. ${prep0.why}\nUnblocks: make \`${buildCmd}\` pass on the last commit (or pass --setup for what it needs).`);
}
const baseline = snapshotRunAll(intRoot);
if (baseline.error) die(`BLOCKED: baseline checks did not run: ${baseline.error}`);
const baseMap = new Map(baseline.scripts.map((s) => [s.script, s.status]));
console.log(`baseline: ${baseline.summary}`);
for (const c of causes.filter(isLive)) liveBase.set(c.id, runLiveAll(c, intRoot));
if (liveBase.size) console.log(`live baseline: ${[...liveBase].map(([id, rs]) => `${id} ${rs.map((x) => x.status).join("/") || "no check"}`).join(", ")}`);
// ---------- REF-009 (optional): screenshots of every route group before any fix ----------
const visualOn = A.includes("--visual");
const allOpt = (k) => A.flatMap((x, i) => (x === k ? [A[i + 1]] : []));
const visualOut = path.join(outDir, runId, "visual");
let visualBefore = null, visualMod = null, visual = null;
if (visualOn) {
  visualMod = await import("./ref-visual.mjs");
  visualBefore = await visualMod.captureSite({ siteDir: path.join(intRoot, opt("--visual-dir") || "."), outDir: path.join(visualOut, "before"), masks: allOpt("--visual-mask"), maxGroups: Number(opt("--visual-groups", 40)), log: () => {} });
  console.log(visualBefore.status === "ok" ? `visual: ${visualBefore.manifest.shots.length} baseline screenshot(s) of ${visualBefore.manifest.groups.length} route group(s)${visualBefore.manifest.shots.some((x) => x.error) ? " (" + visualBefore.manifest.shots.filter((x) => x.error).length + " FAILED)" : ""}` : `visual: BLOCKED (${visualBefore.reason})`);
}
// ---------- rebuild stability at the baseline (IDX-003 / SE-004 / AEO-012): build the untouched code once more and compare dates ----------
const stabilityOn = !!buildCmd && !A.includes("--no-stability");
const stability = { checked: stabilityOn, why: !buildCmd ? "no build command" : !stabilityOn ? "--no-stability" : null, baseline: null, final: null, preExisting: [], rejected: [] };
if (stabilityOn) {
  stability.baseline = rebuildAndJudge(intRoot, buildCmd, { timeoutMs: buildTimeoutMs });
  git(intDir, "reset", "--hard", "-q"); // the second build may rewrite tracked output; the baseline's committed state is what the merges start from
  if (stability.baseline.status === "FAIL") stability.preExisting = [...stability.baseline.failures, ...stability.baseline.se004];
  console.log(`stability (baseline): ${stability.baseline.status}${stability.baseline.status === "FAIL" ? ` (pre-existing, not a regression: ${plainReason(stability.preExisting)})` : stability.baseline.why ? ` ${stability.baseline.why}` : ""}`);
} else console.log(`stability: NOT CHECKED (${stability.why})`);

// ---------- the cost stop, now that the baseline says which causes still fail ----------
{
  const stillFailing = runnableNow.filter((c) => !alreadyPassing(c));
  if (!only.length && stillFailing.length > maxWorkers && !A.includes("--yes")) {
    const keep = new Set([...stillFailing].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) || (b.pages || 0) - (a.pages || 0)).slice(0, maxWorkers).map((c) => c.id));
    deferred = stillFailing.filter((c) => !keep.has(c.id)).map((c) => c.id);
    for (let i = causes.length - 1; i >= 0; i--) if (deferred.includes(causes[i].id)) causes.splice(i, 1);
    console.log(`cost stop: ${stillFailing.length} causes still fail their checks at the baseline; this run takes the ${maxWorkers} most severe (${[...keep].join(", ")}); deferred to the next run: ${deferred.join(", ")}`);
  }
}

// ---------- choose ----------
const toRun = [];
for (const c of causes) {
  const r = mkResult(c);
  results.set(c.id, r);
  const missing = (c.scripts || []).filter((s) => !baseMap.has(s));
  const people = peopleReason(c, extraPeople);
  if (isLive(c)) {
    // a cause from the live audit: its proof is the live check scripts run against the built output (never FIXED without one)
    const lf = liveFiles(c);
    const base = liveBase.get(c.id) || [];
    if (people) { r.verdict = "SKIPPED-NEEDS-PEOPLE"; r.reason = people; }
    else if (!lf.present.length) { r.verdict = "NEEDS-PROOF"; r.reason = lf.missing.length ? `its live check script(s) are missing: ${lf.missing.slice(0, 3).join(", ")}; a fix could not be proven` : "the live cause names no check script, so a fix could not be proven; add a check first"; }
    else if (base.every((x) => x.status === "pass")) { r.verdict = "SKIPPED-ALREADY-PASSING"; r.reason = "its live check(s) already PASS on the repo's built output; the defect may exist only in what is deployed (an older release), nothing to fix in the code"; }
    else if (!base.some((x) => x.status === "fail")) { r.verdict = "NEEDS-PROOF"; r.reason = `the live check(s) cannot judge the built output (${base.filter((x) => x.status === "cannot").slice(0, 2).map((x) => path.basename(x.script) + ": " + x.line).join(" | ")}): they were written for another folder layout, so no fix here could be proven. Unblocks: a check that reads the built output (add it to the repo audit), then run this cause again with --causes ${c.id}`; }
    else toRun.push(c);
    continue;
  }
  if ((c.scripts || []).length && (c.scripts || []).every((s) => baseMap.get(s) === "pass")) { r.verdict = "SKIPPED-ALREADY-PASSING"; r.reason = "all its checks already pass on the last commit; nothing to fix"; }
  else if (people) { r.verdict = "SKIPPED-NEEDS-PEOPLE"; r.reason = people; }
  else if (!(c.scripts || []).length || missing.length === (c.scripts || []).length) { r.verdict = "SKIPPED-NO-CHECK"; r.reason = "no working check script, so a fix could not be proven; add a check first"; }
  else toRun.push(c);
}
console.log(`fix workers: ${toRun.length} (${[...results.values()].filter((r) => r.verdict).length} skipped up front)`);

// ---------- run the fix workers ----------
const env = workerEnv(topReal);
let lastFp = fp0;
const running = new Set();
const suspects = new Map();
const mainChanges = new Set(); // under the site root: UNSAFE
const mainNotes = new Set(); // elsewhere in the repository: reported, never counted against the run
function detectMain(id) {
  const now = fingerprint(topReal);
  const d = fpDiff(lastFp, now, topReal);
  d.notes.forEach((x) => mainNotes.add(x));
  if (d.unsafe.length) {
    for (const r of running) suspects.set(r, d.unsafe);
    suspects.set(id, d.unsafe);
    d.unsafe.forEach((x) => mainChanges.add(x));
  }
  lastFp = now;
}
function findingsRows(c) {
  const rows = [];
  const fdir = path.join(siteRoot, ".checks", "findings");
  if (!fs.existsSync(fdir)) return `(findings folder not available; see ${c.findings?.join(", ")} in .checks/REPORT.md)`;
  for (const f of fs.readdirSync(fdir).filter((x) => x.endsWith(".md"))) {
    for (const line of fs.readFileSync(path.join(fdir, f), "utf8").split(/\r?\n/)) {
      const cells = line.split("|").slice(1, -1).map((x) => x.trim());
      if (cells.length >= 7 && (c.findings || []).includes(cells[0])) rows.push(`- ${cells[0]} [${cells[1]}] ${cells[2]}: ${cells[3]} (why: ${cells[4]}; fix: ${cells[5]}; check: ${cells[6]}; root cause: ${cells[7] || "?"})`);
    }
  }
  return rows.join("\n") || "(no rows found)";
}
// What the worker is told about the live audit. A live-origin cause has no known source file; a repo cause may carry live evidence.
function liveFindings(c) {
  const pages = (c.liveFixAt || []).filter((p) => /^pages\//.test(p)).map((p) => p.split("/")[1]);
  return [`- live finding ids: ${(c.findings || []).join(", ") || "(none)"}; seen on ${c.pages ?? "?"} live page(s)${pages.length ? `: ${[...new Set(pages)].slice(0, 20).join(", ")}` : ""}`, ...(c.liveFixAt || []).slice(0, 12).map((p) => `- live snapshot file showing it: ${p} (a copy of the page as served, not a file of this repository)`)].join("\n");
}
function liveBlock(c, root, outRel) {
  // readable copies inside the work root (the worker cannot read the live audit's folder); the coordinator judges with the originals
  const copyChecks = (paths) => {
    const dir = path.join(root, outRel, "live-checks");
    fs.mkdirSync(dir, { recursive: true });
    return paths.map((p) => { try { fs.copyFileSync(p, path.join(dir, path.basename(p))); } catch {} return rel(path.join(outRel, "live-checks", path.basename(p))); });
  };
  if (isLive(c)) {
    const copies = copyChecks(liveFiles(c).present);
    return [
      "**This cause comes from the audit of the LIVE site, not from the code.** The pages as served show the defect; **no source file is known** (the cause's \"where to fix\" says UNKNOWN). Finding the file that makes it is your first job (grep the work root for the template, component or data behind those pages). In your final line name every file you changed.",
      `- Live problem: ${c.problem}`,
      `- Live fix suggested: ${c.fix || "(none)"}`,
      `- Live pages affected: ${c.pages ?? "?"}; live rules: ${(c.rules || []).join(", ") || "(none)"}`,
      `- How it is proven: the coordinator rebuilds, then runs these live check scripts against the built output (${liveRootSub === "." ? "the work root" : liveRootSub}): ${copies.join(", ")}. They are readable copies of the live audit's scripts; run one yourself with \`node <copy> <built output folder>\`. All must PASS. A check that prints "cannot judge" cannot prove your fix: the cause then ends NEEDS-PROOF, never FIXED. A "FAIL" line says what is still wrong.`,
    ].join("\n");
  }
  if (c.liveEvidence) {
    const e = c.liveEvidence;
    const copies = copyChecks((e.liveCheckScripts || []).filter((p) => fs.existsSync(p)));
    return [
      "**The live site shows this same defect** (the audit of the live pages matched it to this cause). Your fix is judged by the repo checks above, as always; the live evidence tells you what the served pages look like.",
      ...(e.causes || []).map((x) => `- Live cause ${x.id} [${x.severity}]: ${x.problem}${x.fix ? ` (live fix suggestion: ${x.fix})` : ""}`),
      `- Live pages affected: ${e.pages ?? "?"}; live finding ids: ${(e.findings || []).join(", ") || "(none)"}`,
      ...(copies.length ? [`- Live check scripts, for reading only: ${copies.join(", ")}`] : []),
    ].join("\n");
  }
  return "(this cause comes from the repo checker only; no live evidence)";
}
function spawnWorker(c, root, log) {
  return new Promise((resolve) => {
    const started = Date.now();
    const outRel = `.checks/refactor/${c.id}`;
    fs.mkdirSync(path.join(root, outRel), { recursive: true });
    const causeFile = path.join(root, outRel, "cause.json");
    fs.writeFileSync(causeFile, JSON.stringify(c, null, 1));
    fs.writeFileSync(path.join(root, outRel, "baseline.txt"), [...baseMap].map(([s, st]) => `${st} ${s}`).join("\n") + "\n");
    const prompt = promptTemplate
      .split("{{ROOT}}").join(rel(root)).split("{{CAUSE_ID}}").join(c.id).split("{{SEVERITY}}").join(c.severity)
      .split("{{PROBLEM}}").join(c.problem).split("{{FIX}}").join(c.fix || "(none given)")
      .split("{{FIX_AT}}").join(fixAtList(c).join("; ") || "(not named)")
      .split("{{FINDINGS}}").join(isLive(c) ? liveFindings(c) : findingsRows(c)).split("{{CHECKS}}").join((c.scripts || []).join(", ") || "(none from the repo checker: this cause is proven by the live check scripts named under Live evidence)")
      .split("{{LIVE}}").join(liveBlock(c, root, outRel))
      .split("{{CHECKLIST}}").join(rel(path.join(skill, "checklist")))
      .split("{{BUILD}}").join(buildCmd || "(no build step)").split("{{OUT_DIR}}").join(outRel).split("{{CAUSE_FILE}}").join(`${outRel}/cause.json`)
      .split("{{DECISIONS}}").join(decisionFiles.length
        ? `Read these files completely before changing anything: ${decisionFiles.map(rel).join(", ")}. They record what the client and the owner have decided (held areas: a schema type, a data or listing source, wording, a feature kept or dropped). If your fix would add, remove or change something one of those decisions holds, do not make it: write one sentence naming the decision into \`${outRel}/NEEDS-PEOPLE.txt\` and stop.`
        : "(no decisions file was given for this run)");
    fs.writeFileSync(path.join(root, outRel, "prompt.md"), prompt);
    // the owner can read what each worker was told: the prompt is kept with the run, outside the worktree
    fs.mkdirSync(path.join(outDir, runId, "prompts"), { recursive: true });
    fs.writeFileSync(path.join(outDir, runId, "prompts", `${c.id}.md`), prompt);
    // the supervisor's own limit is a backstop 30 s after ours; our timer is the one that decides "timed out"
    const sup = workerScript
      ? supervised(process.execPath, [workerScript, root, c.id, causeFile], { cwd: root, env, timeoutMs: timeoutMs + 30_000 })
      : supervised(whichExe("claude") || "claude", workerArgs(root), { cwd: root, env, timeoutMs: timeoutMs + 30_000 });
    const child = spawn(sup.command, sup.args, { cwd: root, env: sup.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "", timedOut = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { err += String(e); });
    const timer = setTimeout(() => { timedOut = true; killTree(child, sup.supervised); }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - started) / 1000);
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.writeFileSync(log, JSON.stringify({ cause: c.id, code, secs, timedOut, stdout: out.slice(-20000), stderr: err.slice(-5000) }, null, 1));
      resolve({ code, secs, timedOut, status: timedOut ? "timed out" : code === 0 ? "ok" : "failed" });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(workerScript ? "" : prompt);
  });
}
const fixedBranches = [];
async function fixOne(c, dir, root, br) {
  const r = results.get(c.id);
  const t0 = Date.now();
  const done = (verdict, reason, extra = {}) => { Object.assign(r, { verdict, reason, secs: Math.round((Date.now() - t0) / 1000) }, extra); console.log(`${verdict.padEnd(21)} ${c.id} ${reason.slice(0, 110)}`); };
  const prep = prepare(root);
  if (!prep.ok) return done("NOT FIXED", `could not start: ${prep.why}`);
  const before = checkHash(root);
  running.add(c.id);
  const w = await spawnWorker(c, root, path.join(outDir, runId, "logs", `${c.id}.json`));
  detectMain(c.id);
  running.delete(c.id);
  r.worker = { status: w.status, secs: w.secs };
  stageAll(root);
  // The worker's changes are saved FIRST, as a binary diff the owner can apply, whatever happens next (a failing hook, a failed
  // check, a crash). Saved again, final, just before the commit.
  const savePatch = () => {
    const patch = git(root, "diff", "--cached", "--binary").raw;
    if (!patch.trim()) return;
    const p = path.join(outDir, runId, `${c.id}.patch`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, patch);
    r.patch = rel(path.relative(siteRoot, p));
  };
  const patch = git(root, "diff", "--cached", "--binary").raw;
  savePatch();
  if (w.timedOut) { savePatch(); return done("NOT FIXED", `the fix worker timed out after ${timeoutMs / 60000} min`); }
  if (suspects.has(c.id)) { savePatch(); return done("NOT FIXED", `REFUSED: the main checkout changed while this worker ran (${suspects.get(c.id).slice(0, 3).join(", ")}); with several workers at once this may be a neighbour: re-run with --parallel 1`, { refused: "main checkout changed" }); }
  if (checkHash(root) !== before) { savePatch(); return done("NOT FIXED", "REFUSED: the worker changed the check scripts under .checks/ (editing a check is not a fix)", { refused: "check scripts changed" }); }
  const needs = path.join(root, ".checks", "refactor", c.id, "NEEDS-PEOPLE.txt");
  if (fs.existsSync(needs)) return done("SKIPPED-NEEDS-PEOPLE", `worker says: ${fs.readFileSync(needs, "utf8").trim().slice(0, 300)}`);
  const rebuilt = prepare(root); // the rebuild: a pass without it proves nothing (edits to built output vanish here)
  if (!rebuilt.ok) { savePatch(); return done("NOT FIXED", `the site does not build after the change: ${rebuilt.why}`); }
  const after = snapshotRunAll(root);
  if (after.error) { savePatch(); return done("NOT FIXED", `checks could not run after the change: ${after.error}`); }
  const d = diffRunAll(baseline, after, c.scripts);
  // a live-origin cause is proven by its live check scripts run against the rebuilt output (the repo checks only guard against regressions)
  const liveRes = isLive(c) ? runLiveAll(c, root) : null;
  r.checks = liveRes ? liveRes.map((x) => ({ script: path.basename(x.script), before: liveWord[(liveBase.get(c.id) || []).find((b) => b.script === x.script)?.status] || "?", after: liveWord[x.status] })) : d.target;
  r.alsoFixed = d.fixed.filter((s) => !c.scripts.includes(s));
  r.regressed = d.regressed;
  r.newlyFailing = d.newlyFailing;
  if (d.broken.length) {
    savePatch();
    const newOnly = d.broken.filter((x) => x.was !== "pass");
    const parts = [d.regressed.length ? `broke ${d.regressed.length} check(s) that passed before: ${d.regressed.map((x) => x.script).slice(0, 4).join(", ")}` : "", newOnly.length ? `made ${newOnly.length} check(s) FAIL that could not judge before (the fix created what they judge, wrongly): ${newOnly.map((x) => x.script).slice(0, 4).join(", ")}` : ""].filter(Boolean);
    return done("REGRESSED", `${parts.join("; ")}${d.targetFixed ? " (its own checks do pass)" : ""}`);
  }
  if (liveRes) {
    const failing = liveRes.filter((x) => x.status === "fail"), cannot = liveRes.filter((x) => x.status === "cannot");
    if (failing.length) { savePatch(); return done("NOT FIXED", `live check(s) still fail after rebuild: ${failing.map((x) => path.basename(x.script) + ": " + x.line).join(" | ")}${patch.trim() ? "" : " and no source file changed"}`); }
    if (cannot.length) { savePatch(); return done("NEEDS-PROOF", `after the rebuild the live check(s) cannot judge the built output (${cannot.slice(0, 2).map((x) => path.basename(x.script) + ": " + x.line).join(" | ")}); the worker's change is saved as a patch but nothing proves it`); }
  } else if (!d.targetFixed) { savePatch(); const edited = patch.trim() ? "" : " and no source file changed"; return done("NOT FIXED", `checks still fail after rebuild: ${d.target.filter((t) => t.after !== "pass").map((t) => t.script).join(", ")}${edited}`); }
  stageAll(root);
  savePatch(); // the final state (after the rebuild), before any commit is tried
  if (git(root, "diff", "--cached", "--quiet").code === 0) return done("NOT FIXED", "the checks pass but nothing is committable (the change lives in ignored or built files, so it would not survive a fresh checkout)");
  const files = git(root, "diff", "--cached", "--name-only").out.split("\n").filter(Boolean);
  const cm = git(root, ...GIT_ID, "commit", "-q", "-m", `refactor ${c.id}: ${c.problem.slice(0, 90)}\n\nProven by ${(liveRes ? liveRes.map((x) => "live check " + path.basename(x.script)) : c.scripts).join(", ")} (FAIL -> PASS) with no other check going PASS -> FAIL.`);
  if (cm.code !== 0) {
    // Hooks are never skipped: a failing hook is the project's to fix. The proven work stays in this worktree (staged) on its branch and
    // as the patch above; this worktree is NOT removed at the end.
    const msg = ((cm.err || "") + (cm.out ? "\n" + cm.out : "")).trim();
    r.hookMessage = msg; r.worktree = rel(dir); r.branch = br; r.files = git(root, "diff", "--cached", "--name-only").out.split("\n").filter(Boolean);
    return done("NOT COMMITTED", `proven fix (${r.checks.length} check(s) FAIL -> PASS, nothing regressed) but git commit failed: ${msg.split("\n").slice(0, 3).join(" | ")}. Kept in ${rel(dir)} (branch ${br}) and as ${r.patch || "(no patch)"}`);
  }
  fixedBranches.push({ id: c.id, br });
  done("FIXED", `${r.checks.length} check(s) FAIL -> PASS, ${d.passAfter}/${d.total} pass overall, files: ${files.join(", ").slice(0, 80)}`, { files, commit: git(root, "rev-parse", "--short", "HEAD").out });
}
const cwts = toRun.map((c) => { const dir = path.join(wtBase, c.id); const br = `${branch}-${c.id}`; return { c, dir, br, root: addWorktree(dir, br) }; });
const queue = [...cwts];
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
  while (queue.length) { const j = queue.shift(); try { await fixOne(j.c, j.dir, j.root, j.br); } catch (e) { running.delete(j.c.id); const r = results.get(j.c.id); r.verdict = "NOT FIXED"; r.reason = `coordinator error: ${e.message}`; console.log(`NOT FIXED             ${j.c.id} coordinator error: ${e.message}`); } }
}));
detectMain("(end)");

// ---------- integrate the proven fixes, one by one, proving the combination after each ----------
// Built output that is committed (dist/) changes in every fix, so two proven fixes can conflict only in generated
// files. On a conflict the earlier version is kept, the site is rebuilt, and the cause must still pass every check
// of the combined branch; a source conflict that loses a change fails that test and the fix is downgraded.
const downgrade = (id, reason) => { const r = results.get(id); Object.assign(r, { verdict: "NOT FIXED", reason, commit: null }); console.log(`NOT FIXED             ${id} ${reason.slice(0, 110)}`); };
let finalRun = null, integrationRegressions = [];
const accepted = [];
let combineFailed = false;
for (const { id, br } of fixedBranches.sort((x, y) => x.id.localeCompare(y.id))) {
  const c = causes.find((x) => x.id === id);
  const pre = git(intDir, "rev-parse", "HEAD").out;
  git(intDir, "reset", "--hard", "-q"); // built output that is tracked is rewritten by every build; start each merge from the committed state
  const m = git(intDir, ...GIT_ID, "merge", "--no-ff", "--no-commit", br);
  let conflicted = [];
  if (m.code !== 0) {
    conflicted = git(intDir, "diff", "--name-only", "--diff-filter=U").out.split("\n").filter(Boolean);
    if (!conflicted.length) { git(intDir, "merge", "--abort"); git(intDir, "reset", "--hard", pre); combineFailed = true; downgrade(id, `proven alone, but it could not be merged onto the combined branch: ${(m.err.split(String.fromCharCode(10)).filter((l) => !/^warning:/.test(l)).join(' ') + ' ' + m.out).slice(0, 200)}`); continue; }
    for (const p of conflicted) { git(intDir, "checkout", "--ours", "--", p); git(intDir, "add", "--", p); }
  }
  git(intDir, ...GIT_ID, "commit", "-q", "-m", `refactor ${id}${conflicted.length ? ` (kept the earlier version of ${conflicted.length} conflicting file(s), then rebuilt)` : ""}`);
  let why = "";
  const p = prepare(intRoot);
  if (!p.ok) why = `the combined branch does not build with it (${p.why.slice(0, 80)})`;
  else {
    stageAll(intRoot);
    if (git(intRoot, "diff", "--cached", "--quiet").code !== 0) git(intRoot, ...GIT_ID, "commit", "-q", "-m", `rebuild after merging ${id}`);
    const run = snapshotRunAll(intRoot);
    if (run.error) why = `checks could not run on the combined branch: ${run.error.slice(0, 80)}`;
    else {
      const d = diffRunAll(baseline, run, c.scripts);
      // earlier fixes must still pass: repo checks by the run-all result, live checks (live-origin causes) by running them on the combined branch
      const undone = [...accepted.flatMap((a) => a.scripts).filter((s) => run.scripts.find((x) => x.script === s)?.status !== "pass"), ...accepted.filter(isLive).flatMap((a) => runLiveAll(a, intRoot)).filter((x) => x.status !== "pass").map((x) => path.basename(x.script))];
      const targetOk = isLive(c) ? runLiveAll(c, intRoot).every((x) => x.status === "pass") : d.targetFixed;
      if (!(targetOk && !d.broken.length && !undone.length)) why = d.broken.length ? `it breaks ${d.broken.map((x) => x.script).slice(0, 3).join(", ")} when combined with the earlier fixes` : undone.length ? `it undoes an earlier fix (${undone.join(", ")})` : `its checks fail when combined with the earlier fixes${conflicted.length ? ` (it conflicts with an earlier fix in ${conflicted.slice(0, 3).join(", ")})` : ""}`;
      else if (stabilityOn) {
        // one extra build of this commit: a date that moves between the two builds is the build clock (IDX-003 / AEO-012), SE-004 on the format
        const s = rebuildAndJudge(intRoot, buildCmd, { timeoutMs: buildTimeoutMs });
        git(intDir, "reset", "--hard", "-q");
        const fresh = s.status === "ERROR" ? [] : newFailures(stability.baseline?.status === "FAIL" ? stability.baseline : null, s);
        if (s.status === "ERROR") why = `the combined branch does not rebuild a second time (${String(s.why).slice(0, 80)})`;
        else if (fresh.length) { why = plainReason(fresh); stability.rejected.push({ id, reason: why, failures: fresh.slice(0, 20) }); }
        else { stability.final = s; finalRun = run; accepted.push(c); }
      } else { finalRun = run; accepted.push(c); }
    }
  }
  if (why) {
    git(intDir, "reset", "--hard", pre); combineFailed = true;
    const clock = stability.rejected.some((x) => x.id === id);
    downgrade(id, clock ? `REJECTED (rebuild stability): ${why}. Dates written into the output must be content dates (a committed ledger, the source's change time, a post's own date), never the clock at build time` : `proven alone, but ${why}; re-run it alone on top of the merged branch (--causes ${id})`);
    if (clock) results.get(id).stability = stability.rejected.find((x) => x.id === id);
  }
}
if (combineFailed && accepted.length) prepare(intRoot); // leave the kept branch's built output matching its commits
if (finalRun) integrationRegressions = diffRunAll(baseline, finalRun, []).broken;
// the run's stability word: the combined branch's last check, else the baseline's (FAIL may be pre-existing: the report says which)
const stabilityWord = !stability.checked ? "NOT CHECKED" : (stability.final || stability.baseline)?.status === "ERROR" ? "NOT CHECKED" : (stability.final || stability.baseline)?.status || "NOT CHECKED";
const fixedNow = [...results.values()].filter((r) => r.verdict === "FIXED");
if (visualOn) {
  const vsum = (v) => ({ status: v.status, counts: v.counts, maxDiffRatio: v.maxDiffRatio, dir: rel(path.relative(siteRoot, visualOut)), failing: v.results.filter((x) => x.verdict !== "PASS").slice(0, 12).map((x) => ({ routeGroup: x.routeGroup, viewport: x.viewport, finding: x.finding, detail: x.detail, regions: (x.regions || []).slice(0, 3), diffImage: x.diffImage ? rel(path.join(path.relative(siteRoot, visualOut), x.diffImage)) : null })) });
  if (visualBefore.status !== "ok") visual = { status: "BLOCKED", detail: visualBefore.reason, unblock: visualBefore.unblock };
  else if (!accepted.length) visual = { status: "NOT-APPLICABLE", detail: "no fix was merged, so there is nothing to compare" };
  else {
    const aft = await visualMod.captureSite({ siteDir: path.join(intRoot, opt("--visual-dir") || "."), outDir: path.join(visualOut, "after"), groups: visualBefore.manifest.groups, masks: allOpt("--visual-mask"), log: () => {} });
    if (aft.status !== "ok") visual = { status: "BLOCKED", detail: aft.reason, unblock: aft.unblock };
    else {
      const v = visualMod.compareCaptures(path.join(visualOut, "before"), path.join(visualOut, "after"), { maxDiffRatio: Number(opt("--visual-max-diff", 0.001)), allow: visualMod.parseAllow(allOpt("--visual-allow"), opt("--visual-allow-file")), outDir: visualOut });
      visual = vsum(v);
    }
  }
  console.log(`visual (REF-009): ${visual.status}${visual.counts ? " " + JSON.stringify(visual.counts) : ""}${visual.detail ? " " + visual.detail : ""}`);
}
// ---------- clean up worktrees (patches of failures are already saved) ----------
for (const j of cwts) {
  if (results.get(j.c.id).verdict === "NOT COMMITTED") continue; // proven work that could not be committed stays where it is
  git(topReal, "worktree", "remove", "--force", j.dir); git(topReal, "branch", "-D", j.br);
  if (fs.existsSync(j.dir)) mainNotes.add(`worktree folder ${rel(j.dir)} was not fully removed (a junction or a locked file?); delete it by hand`);
}
const keepBranch = fixedNow.length > 0;
if (!keepBranch) { git(topReal, "worktree", "remove", "--force", intDir); git(topReal, "branch", "-D", branch); }
else { git(topReal, "worktree", "prune"); }
detectMain("(final)"); // anything that happened to the main repository during integration and cleanup
const mainHeadMoved = false; // a moved base branch is classified by detectMain: UNSAFE only if its commits touched the site root, else a note

// ---------- the report ----------
const list = [...results.values()];
const by = (v) => list.filter((r) => r.verdict === v);
const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
list.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) || a.id.localeCompare(b.id));
const finalPass = finalRun && !finalRun.error ? finalRun.summary : null;
const unsafe = mainChanges.size > 0 || mainHeadMoved || integrationRegressions.length > 0;
const summary = {
  runId, date, siteRoot: rel(siteRoot), baseBranch, baseSha, branch: keepBranch ? branch : null, worktree: keepBranch ? rel(intDir) : null,
  buildCommand: buildCmd, projectMerges, parallel, baseline: baseline.summary, final: finalPass, visual,
  stability: { status: stabilityWord, checked: stability.checked, why: stability.why, baseline: stability.baseline && { status: stability.baseline.status, why: stability.baseline.why, failures: stability.baseline.failures.slice(0, 40), se004: stability.baseline.se004.slice(0, 40), warns: stability.baseline.warns.slice(0, 40) }, final: stability.final && { status: stability.final.status, failures: stability.final.failures.slice(0, 40), se004: stability.final.se004.slice(0, 40), warns: stability.final.warns.slice(0, 40) }, preExisting: stability.preExisting.slice(0, 40), rejected: stability.rejected },
  counts: { causes: list.length, fixed: by("FIXED").length, notFixed: by("NOT FIXED").length, notCommitted: by("NOT COMMITTED").length, regressed: by("REGRESSED").length, needsPeople: by("SKIPPED-NEEDS-PEOPLE").length, needsProof: by("NEEDS-PROOF").length, liveCauses: list.filter((r) => r.origin === "live").length, noCheck: by("SKIPPED-NO-CHECK").length, alreadyPassing: by("SKIPPED-ALREADY-PASSING").length },
  mainTouched: [...mainChanges], notes: [...mainNotes], baseMoved: lastFp.base !== fp0.base, mainHeadMoved, integrationRegressions, deferred, decisionFiles: decisionFiles.map(rel), causes: list, generatedAt: new Date().toISOString(),
};
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const n = summary.counts;
const md = [
  `# Refactor ${runId}`,
  "",
  unsafe
    ? `**STOP: the run is not safe to use.** ${mainChanges.size ? `The main checkout changed under the site root while workers ran (${[...mainChanges].slice(0, 5).join(", ")}). ` : ""}${mainHeadMoved ? "A branch tip in the main repository moved. " : ""}${integrationRegressions.length ? `The combined branch breaks checks that passed before (${integrationRegressions.map((x) => x.script).join(", ")}). ` : ""}Nothing has been merged. Look at it before anything else.`
    : `**${n.fixed} of ${n.causes} root causes fixed and proven on the branch \`${keepBranch ? branch : "(none created: nothing was fixed)"}\`${n.notCommitted ? `; ${n.notCommitted} more are proven but git refused to commit them (a hook failed: the work is saved, see below)` : ""}; ${n.needsPeople} need people${n.needsProof ? `, ${n.needsProof} cannot be proven yet (no check that can judge them)` : ""}, ${n.notFixed + n.regressed} did not work out.** Nothing has been merged into \`${baseBranch}\`, pushed or deployed. You decide.`,
  "",
  "A **root cause** is one defect that shows up in many places (for example one template line behind 40 pages). A **check** is a small script that looks at the built site and says PASS or FAIL. A fix counts as **proven** only when its checks go from FAIL to PASS after the site is rebuilt, and no other check that passed before has stopped passing.",
  "",
  keepBranch ? `## To review and approve\n\n- Review the branch: \`git -C "${rel(topReal)}" log --oneline ${baseBranch}..${branch}\` and \`git -C "${rel(topReal)}" diff ${baseBranch}...${branch}\`. The files are also checked out at \`${rel(intDir)}\`.\n${projectMerges ? "- Merges for this project go only through the project's own gate (see the last lines of this report): do not run a direct merge.\n" : `- To accept it (your decision, not done by this tool): \`git -C "${rel(topReal)}" merge --no-ff ${branch}\`, then rebuild and re-run the audit.\n`}- To reject it: \`git -C "${rel(topReal)}" worktree remove --force "${rel(intDir)}"\` and \`git -C "${rel(topReal)}" branch -D ${branch}\`.\n` : "",
  `## Result per root cause`,
  "",
  "| cause | severity | verdict | what happened | checks (before -> after) |",
  "|---|---|---|---|---|",
  ...list.map((r) => `| ${r.id}${r.origin === "live" ? " (live)" : ""} | ${r.severity} | **${r.verdict}** | ${cell(r.reason)}${r.note ? ` Note: ${cell(r.note)}` : ""} | ${r.checks.map((t) => `${t.script}: ${t.before} -> ${t.after}`).join("; ") || "-"}${r.alsoFixed.length ? `; also fixed: ${r.alsoFixed.join(", ")}` : ""} |`),
  "",
  by("SKIPPED-NEEDS-PEOPLE").length ? `## Needs people (not touched, by design)\n\n${by("SKIPPED-NEEDS-PEOPLE").map((r) => `- **${r.id}** ${r.problem}: ${r.reason}`).join("\n")}\n` : "",
  by("SKIPPED-NO-CHECK").length ? `## Cannot be proven yet (no working check)\n\n${by("SKIPPED-NO-CHECK").map((r) => `- **${r.id}** ${r.problem}`).join("\n")}\n` : "",
  by("NEEDS-PROOF").length ? `## Needs a check before it can be proven (never marked fixed without one)\n\nThese causes come from the audit of the live site. The live check scripts that would prove a fix either are missing or could not judge the rebuilt output (they read another folder layout). Where a worker already made a change it is saved as a patch; it is NOT proven. To prove it: put a check that reads this project's built output into the repo audit, then run the cause again with \`--causes <id>\`.\n\n${by("NEEDS-PROOF").map((r) => `- **${r.id}** ${r.problem}: ${r.reason}${r.patch ? ` (unproven patch: ${r.patch})` : ""}`).join("\n")}\n` : "",
  by("NOT COMMITTED").length ? `## Proven, but not committed (nothing is lost)\n\nThe fix passed its checks after a rebuild with nothing regressing, then \`git commit\` was refused (normally by the repository's pre-commit hook). No hook was skipped. For each: the diff is saved as a patch, and the staged work is still in its worktree on its own branch. When the hook problem is fixed, commit from the worktree (\`git -C <worktree> commit -m "..."\`) or apply the patch (\`git apply <patch>\`).\n\n${by("NOT COMMITTED").map((r) => `- **${r.id}** patch \`${r.patch || "(none)"}\`; worktree \`${r.worktree}\` (branch \`${r.branch}\`); files: ${(r.files || []).slice(0, 8).join(", ")}\n\n  Hook message:\n\n  \`\`\`\n${String(r.hookMessage || "").split("\n").map((l) => "  " + l).join("\n")}\n  \`\`\``).join("\n")}\n` : "",
  by("REGRESSED").length || by("NOT FIXED").length ? `## Did not work (a patch of what the worker changed is saved next to this report: \`.pewp/refactor/${runId}/<cause>.patch\`)\n\n${[...by("REGRESSED"), ...by("NOT FIXED")].map((r) => `- **${r.id}** ${r.verdict}: ${r.reason}${r.patch ? ` (patch: ${r.patch})` : ""}`).join("\n")}\n` : "",
  `## Checks overall`,
  "",
  `- Before any fix: ${baseline.summary}`,
  `- After the fixes, combined: ${finalPass ?? (fixedNow.length ? "could not run" : "no fix to combine")}`,
  `- Combined branch regressions: ${integrationRegressions.length ? integrationRegressions.map((x) => `${x.script} (${x.was} -> ${x.now})`).join(", ") : "none"}`,
  `- Deferred by the cost stop (still failing, next run): ${deferred.length ? deferred.join(", ") : "none"}`,
  `- Rebuild stability (IDX-003 / SE-004 / AEO-012: the dates in the output are content dates, not the build clock): ${!stability.checked ? `NOT CHECKED (${stability.why}${stability.why === "--no-stability" ? "; remove --no-stability to check it" : ""})` : `${stabilityWord}. Baseline: ${stability.baseline.status}${stability.baseline.why ? ` (${stability.baseline.why})` : ""}${stability.preExisting.length ? `, a PRE-EXISTING finding on the untouched code, not caused by this run: ${plainReason(stability.preExisting)}` : ""}.${stability.rejected.length ? ` Fixes rejected because they bring in build-clock dates: ${stability.rejected.map((x) => `${x.id} (${x.reason})`).join("; ")}.` : ""}${(stability.final || stability.baseline)?.warns?.length ? ` WARN (not a failure): ${(stability.final || stability.baseline).warns.length} other output file(s) differ between two builds of one commit (a non-deterministic build): ${(stability.final || stability.baseline).warns.slice(0, 5).join(", ")}.` : ""}`}`,
  ...(stability.preExisting.length ? ["", "  Pre-existing date problems at the baseline:", ...formatLines({ failures: stability.baseline.failures, se004: stability.baseline.se004, warns: [], notes: [] }).slice(0, 12).map((l) => `  - ${cell(l)}`)] : []),
  `- Visual equivalence (REF-009): ${!visualOn ? "not run (add --visual)" : visual.status === "PASS" ? `PASS, ${visual.counts.pass} of ${visual.counts.checked} route-group screenshots match within ${visual.maxDiffRatio * 100}% (pictures: ${visual.dir})` : visual.status === "FAIL" ? `FAIL, ${visual.counts.fail} of ${visual.counts.checked} screenshots differ more than allowed: ${visual.failing.slice(0, 6).map((f) => `${f.routeGroup} ${f.viewport} (${f.detail})`).join("; ")}. Open ${visual.dir}/visual-diff.md and the pictures in ${visual.dir}/diff/, then accept the change with --visual-allow or send the fix back` : `${visual.status}${visual.detail ? ": " + visual.detail : ""}${visual.unblock ? " Unblocks: " + visual.unblock : ""}`}`,
  `- Binding decisions every worker was told to read: ${decisionFiles.map(rel).join(", ") || "none given"}`,
  `- Main checkout under the site root: ${mainChanges.size ? "CHANGED while workers ran: " + [...mainChanges].join(", ") : "unchanged"}`,
  `- Elsewhere in the repository (not counted against the run): ${mainNotes.size || outsideAtStart.length ? [...mainNotes, ...(outsideAtStart.length ? [`${outsideAtStart.length} uncommitted path(s) existed before the run (${outsideAtStart.slice(0, 5).join(", ")}${outsideAtStart.length > 5 ? ", ..." : ""})`] : [])].join("; ") : "nothing changed"}`,
  "",
  "## What this run does not prove",
  "",
  "A passing check means the thing it looks at is right; it does not prove the page looks right or reads well. Open the changed pages before you accept. Fix workers could run `node` and so could in principle write outside their folder: the main checkout is fingerprinted before and after every worker and any change is reported above.",
  "",
  ...(projectMerges ? [
    "## How this gets merged (--project-merges)",
    "",
    `Merges for this project go only through the project's own gate. The branch \`${keepBranch ? branch : "(none: nothing was fixed)"}\` is prepared for review; nothing was merged, pushed or deployed by this run. Open a pull request from it with the project's own process, let the project's CI go green, and merge there. Never a direct merge into \`${baseBranch}\`. If the repository is public, no secret goes into a commit or a pull request.`,
    "",
  ] : []),
].join("\n");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${runId}.json`), JSON.stringify(summary, null, 1) + "\n");
fs.writeFileSync(path.join(outDir, `${runId}.md`), md);
try { markStage(locate(siteRoot), "refactor", { report: `.pewp/refactor/${runId}.md`, json: `.pewp/refactor/${runId}.json` }, { branch: summary.branch, fixed: n.fixed }); } catch {}
console.log(`REFACTOR ${unsafe ? "UNSAFE" : "DONE"}: ${n.fixed} FIXED, ${n.regressed} REGRESSED, ${n.notFixed} NOT FIXED, ${n.notCommitted} NOT COMMITTED, ${n.needsPeople} NEEDS-PEOPLE, ${n.needsProof} NEEDS-PROOF, ${n.noCheck + n.alreadyPassing} other skipped; branch ${summary.branch || "none"}; stability: ${stabilityWord}${stabilityWord === "FAIL" && !stability.rejected.length && stability.preExisting.length ? " (pre-existing)" : ""}; report .pewp/refactor/${runId}.md`);
process.exit(unsafe ? 1 : 0);
