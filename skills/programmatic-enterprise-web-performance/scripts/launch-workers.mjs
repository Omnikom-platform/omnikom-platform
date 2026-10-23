// Usage: node launch-workers.mjs <repo root> [--focus "<text>"] [--parallel 4] [--only <slice id>]
//        [--model sonnet] [--effort high] [--timeout-min 40] [--dry]
// Starts one headless worker (`claude -p`) per slice of <repo>/.checks/plan.json, the prompt piped on
// stdin (a positional multi-line prompt makes claude wait for stdin and run with none). Workers may
// read anything and write only under .checks/ (enforced by the prompt and by the allowed tool list).
// Waits for all workers; prints one line per worker; logs to .checks/logs/<slice>.json.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { supervised, whichExe } from "./lib-freshness.mjs";

const args = process.argv.slice(2);
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && !String(args[i - 1] || "").startsWith("--")) || ".");
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const focus = opt("--focus", "everything that needs fixing");
const parallel = Number(opt("--parallel", 4));
const only = opt("--only", null);
const model = opt("--model", "sonnet");
const effort = opt("--effort", "high");
const timeoutMs = Number(opt("--timeout-min", 40)) * 60_000;
const dry = args.includes("--dry");
const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A timed-out worker is killed with its whole process tree (claude.exe spawns node and shells; child.kill() alone leaves them
// running on Windows, and `taskkill /T` misses Git Bash children). Each worker runs under the job-object supervisor
// (lib-freshness supervised): killing the supervisor ends the tree. Same as refactor.mjs killTree.
function killTree(child, isSupervised) {
  try {
    if (process.platform === "win32" && !isSupervised) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 10_000 });
    else child.kill("SIGKILL");
  } catch {}
}

const plan = JSON.parse(fs.readFileSync(path.join(root, ".checks", "plan.json"), "utf8"));
const template = fs.readFileSync(path.join(skill, "worker-prompt.md"), "utf8");
for (const d of ["findings", "scripts", "logs"]) fs.mkdirSync(path.join(root, ".checks", d), { recursive: true });
const slices = plan.slices.filter((s) => !only || s.id === only);
if (!slices.length) { console.error(only ? `no slice ${only}` : "plan has no slices"); process.exit(2); }

// Which of this slice's pages stand for a whole template family (plan.families), so the worker reports the template once.
const famNote = (s) => {
  const fams = (plan.families || []).filter((f) => f.reps.some((r) => s.files.some((x) => x === r || x.startsWith(r + "/"))));
  if (!fams.length) return "";
  return "   **Template families in your slice:** " + fams.map((f) => `${f.reps.filter((r) => s.files.some((x) => x === r || x.startsWith(r + "/"))).join(" and ")} stand for family ${f.id} \`${f.label}\` (${f.size} pages built from one template; the other members are not sent to anyone)`).join("; ") +
    `. A defect you find on a representative is a template defect: write it once, with the template or generator as \`root cause\` and the family (e.g. \`${fams[0].id} (${fams[0].size} pages)\`) in \`file:line\`; make its check script test every member page (they are on disk under the same pattern), so it passes only when the template is fixed everywhere. Report something that only one page has (its own content) as that page's finding.`;
};
const fill = (s) =>
  template
    .split("{{FAMILIES}}").join(famNote(s))
    .split("{{ROOT}}").join(root.replace(/\\/g, "/"))
    .split("{{SLICE}}").join(s.id)
    .split("{{FOCUS}}").join(focus)
    .split("{{CHECKLIST}}").join(path.join(skill, "checklist").replace(/\\/g, "/"))
    .split("{{FILES}}").join(s.files.map((f) => `- ${f}`).join("\n"));
const cliArgs = [
  "-p", "--model", model, "--effort", effort, "--output-format", "json", "--no-session-persistence",
  "--permission-mode", "acceptEdits",
  "--allowedTools", "Read", "Grep", "Glob", "Write", "Edit", "Bash(node:*)", "Bash(git ls-files:*)", "Bash(git log:*)",
  "--add-dir", root, path.join(skill, "checklist"),
];
if (dry) {
  for (const s of slices) console.log(`DRY ${s.id}: claude ${cliArgs.join(" ")} < prompt(${fill(s).length} chars, ${s.files.length} files)`);
  process.exit(0);
}

function runOne(s) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sup = supervised(whichExe("claude") || "claude", cliArgs, { cwd: root, env: { ...process.env, CLAUDE_SYNC_SKIP: "1", CLAUDE_LEARN_SKIP: "1" }, timeoutMs: timeoutMs + 30_000 });
    const child = spawn(sup.command, sup.args, { cwd: root, env: sup.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    // a worker that cannot start (claude not installed) is a failed worker, never a crash of the launcher
    child.on("error", (e) => { err += `could not start the worker: ${e.message}\n`; });
    child.stdin.on("error", () => {});
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child, sup.supervised); }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - started) / 1000);
      fs.writeFileSync(path.join(root, ".checks", "logs", `${s.id}.json`), JSON.stringify({ slice: s.id, code, secs, timedOut, stdout: out.slice(-20000), stderr: err.slice(-5000) }, null, 2));
      let summary = "";
      try { summary = String(JSON.parse(out).result || "").split("\n").pop().slice(0, 160); } catch { summary = err.split("\n")[0].slice(0, 160); }
      const wrote = fs.existsSync(path.join(root, ".checks", "findings", `${s.id}.md`));
      const status = timedOut ? "timed out" : code === 0 && wrote ? "ok" : "failed";
      resolve({ id: s.id, status, secs, summary });
    });
    child.stdin.end(fill(s));
  });
}

const queue = [...slices];
const results = [];
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const r = await runOne(s);
      results.push(r);
      console.log(`${r.status.padEnd(9)} ${r.id} (${r.secs}s) ${r.summary}`);
    }
  }),
);
const bad = results.filter((r) => r.status !== "ok");
console.log(`${results.length - bad.length}/${results.length} workers ok${bad.length ? `; re-run: ${bad.map((b) => `--only ${b.id}`).join(" ")}` : ""}`);
process.exit(bad.length ? 1 : 0);
