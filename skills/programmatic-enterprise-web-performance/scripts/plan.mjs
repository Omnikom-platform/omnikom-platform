// Usage: node plan.mjs <repo root> [--budget-kb 200] [--all] [--dry]
// Splits a repo's source files into slices that fit one worker's context beside the ~130 KB checklist
// (default 200 KB each),
// keeping files of the same directory together, and writes <repo>/.checks/plan.json.
// Uses `git ls-files` when the repo is a git repo (respects .gitignore), else walks the tree.
// Pages built from one template (3 or more with the same tag skeleton, see families.mjs) are a family:
// only 2 representatives go to the workers, the rest are listed in plan.families as covered by them.
// --all checks every page anyway.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { groupFamilies, unitsFor } from "./families.mjs";

const args = process.argv.slice(2);
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--budget-kb") || ".");
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const budget = Number(opt("--budget-kb", 200)) * 1024;
const dry = args.includes("--dry");
const all = args.includes("--all");

const SKIP_DIR = /(^|\/)(\.git|node_modules|dist|build|out|target|\.next|\.nuxt|\.svelte-kit|\.astro|coverage|vendor|\.venv|venv|__pycache__|\.turbo|\.cache|\.checks|\.claude\/worktrees)(\/|$)/;
const SKIP_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.(png|jpe?g|gif|webp|avif|ico|svg|bmp|tiff?|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|xz|7z|rar|exe|dll|so|dylib|wasm|bin|class|jar|pyc|map|min\.js|min\.css)$/i;
const MAX_FILE = 200 * 1024;

let files = [];
try {
  files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
    .split("\0")
    .filter(Boolean);
} catch (e) {
  // Not a git repo is normal (a snapshot folder). Anything else (a timeout, git missing) is said out loud: the walk below does
  // not read .gitignore, so the file list may differ from what git would give.
  if (!/not a git repository/i.test(String(e.stderr || ""))) console.log(`NOTE: git ls-files failed (${e.code === "ETIMEDOUT" ? "took over 60 s" : e.code || `exit ${e.status}`}); walking the folder instead (.gitignore not applied)`);
}
// A folder git ignores (a site snapshot, a backup) lists as empty, not as an error: walk it instead.
if (!files.length) {
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIR.test(rel + "/")) walk(rel); } else files.push(rel);
    }
  };
  walk("");
}
const skipped = { generatedOrBinary: 0, tooLarge: [] };
const kept = [];
for (const f of files.sort()) {
  if (SKIP_DIR.test(f) || SKIP_FILE.test(f)) { skipped.generatedOrBinary++; continue; }
  let size;
  try { size = fs.statSync(path.join(root, f)).size; } catch { continue; }
  if (size > MAX_FILE) { skipped.tooLarge.push(`${f} (${Math.round(size / 1024)} KB)`); continue; }
  const head = fs.readFileSync(path.join(root, f)).subarray(0, 4096);
  if (head.includes(0)) { skipped.generatedOrBinary++; continue; }
  kept.push({ file: f, size });
}
const { families, covered } = all ? { families: [], covered: new Set() } : groupFamilies(unitsFor(root, kept.map((k) => k.file)));
const coveredFiles = kept.filter((k) => covered.has(k.file)).map((k) => k.file);
for (let i = kept.length - 1; i >= 0; i--) if (covered.has(kept[i].file)) kept.splice(i, 1);
// Greedy packing in path order; a slice boundary prefers a directory boundary.
const slices = [];
let cur = { files: [], bytes: 0 };
const dirOf = (f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".");
for (const k of kept) {
  const last = cur.files[cur.files.length - 1];
  const newDir = last && dirOf(last) !== dirOf(k.file);
  if (cur.bytes + k.size > budget || (newDir && cur.bytes > budget * 0.8)) {
    if (cur.files.length) slices.push(cur);
    cur = { files: [], bytes: 0 };
  }
  cur.files.push(k.file);
  cur.bytes += k.size;
}
if (cur.files.length) slices.push(cur);
const named = slices.map((s, i) => {
  const top = [...new Set(s.files.map((f) => f.split("/")[0]))].slice(0, 2).join("+").replace(/[^A-Za-z0-9+_-]/g, "_");
  return { id: `s${String(i + 1).padStart(2, "0")}-${top}`.slice(0, 40), bytes: s.bytes, files: s.files };
});
const plan = { root, createdAt: new Date().toISOString(), budgetKb: budget / 1024, snapshot: fs.existsSync(path.join(root, "_site.json")), slices: named, families, coveredByFamily: coveredFiles, skipped };
console.log(`${named.length} slice(s), ${kept.length} files, ${Math.round(kept.reduce((a, k) => a + k.size, 0) / 1024)} KB of source; skipped ${skipped.generatedOrBinary} binary/generated/lock files and ${skipped.tooLarge.length} files over 200 KB`);
for (const f of families) console.log(`  family ${f.id} ${f.label}: ${f.size} pages, checked through ${f.reps.join(" + ")}`);
if (families.length) console.log(`  ${coveredFiles.length} files covered by their family's representatives (--all checks them one by one)`);
for (const s of named) console.log(`  ${s.id}: ${s.files.length} files, ${Math.round(s.bytes / 1024)} KB`);
if (skipped.tooLarge.length) console.log(`  too large to read (not checked): ${skipped.tooLarge.slice(0, 10).join(", ")}${skipped.tooLarge.length > 10 ? " …" : ""}`);
if (!dry) {
  // A new plan starts a new run: move the previous run's outputs into .checks/prev/ so old findings
  // (whose slice ids collide with the new ones) are never merged into the new report.
  const cd = path.join(root, ".checks");
  const old = ["findings", "scripts", "logs", "REPORT.md", "REPORT.prev.md", "causes.json", "run-all.mjs", "plan.json"].filter((x) => fs.existsSync(path.join(cd, x)));
  if (old.length) {
    fs.rmSync(path.join(cd, "prev"), { recursive: true, force: true });
    fs.mkdirSync(path.join(cd, "prev"), { recursive: true });
    for (const x of old) fs.renameSync(path.join(cd, x), path.join(cd, "prev", x));
    console.log(`previous run moved to .checks/prev/ (${old.join(", ")})`);
  }
  fs.mkdirSync(path.join(root, ".checks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".checks", "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`wrote ${path.join(root, ".checks", "plan.json")}`);
}
