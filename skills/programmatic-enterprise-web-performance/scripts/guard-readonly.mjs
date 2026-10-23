// Usage: node guard-readonly.mjs <repo> --before | --after
// Audit modes never edit the target's source. --before records `git status --porcelain`; --after fails (exit 1) when
// any path outside .checks/ and .pewp/ changed since. Not a git repo (a site snapshot): nothing to guard, exit 0.
// Exit 2: the guard cannot judge (git timed out, is missing, or failed for another reason): never read as a pass.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [repo, when] = process.argv.slice(2);
if (!repo || !["--before", "--after"].includes(when)) { console.error("usage: node guard-readonly.mjs <repo> --before | --after"); process.exit(2); }
const root = path.resolve(repo);
// --no-optional-locks: a read-only status must not take the index.lock another git process (or agent) may need.
const GIT = (args) => spawnSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const st = GIT(["status", "--porcelain", "--untracked-files=all", "--", "."]);
if (st.error?.code === "ETIMEDOUT") { console.log(`ERROR guard cannot judge: git status in ${root} took over 60 s`); process.exit(2); }
if (st.error) { console.log(`ERROR guard cannot judge: git could not run (${st.error.code || st.error.message}); install Git or put it on PATH`); process.exit(2); }
if (st.status !== 0) {
  // only "not a git repository" means there is nothing to guard; any other git failure is not a pass
  if (/not a git repository/i.test(st.stderr || "")) { console.log(`PASS guard: ${root} is not a git repo (nothing to guard)`); process.exit(0); }
  console.log(`ERROR guard cannot judge: git status failed in ${root} (exit ${st.status}): ${(st.stderr || "").trim().split("\n")[0]}`);
  process.exit(2);
}
const top = (GIT(["rev-parse", "--show-prefix"]).stdout || "").trim();
const lines = st.stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, "").replace(top, ""))
  .filter((p) => !/^(\.checks|\.pewp)\//.test(p));
const file = path.join(root, ".pewp", "guard-before.json");
if (when === "--before") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), changed: lines }) + "\n");
  console.log(`guard: ${lines.length} path(s) already changed before the run (not counted against it)`);
} else {
  let before = new Set();
  if (fs.existsSync(file)) {
    try { before = new Set(JSON.parse(fs.readFileSync(file, "utf8")).changed); }
    catch (e) { console.log(`ERROR guard cannot judge: ${file} is not readable JSON (${e.message}); run --before again`); process.exit(2); }
  }
  const added = lines.filter((p) => !before.has(p));
  if (added.length) { console.log(`FAIL guard: the audit changed source files: ${added.slice(0, 20).join(", ")}`); process.exit(1); }
  console.log("PASS guard: no source file changed by the audit");
}
