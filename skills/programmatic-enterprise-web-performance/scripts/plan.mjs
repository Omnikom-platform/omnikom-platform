// Usage: node plan.mjs <repo root> [--budget-kb 200] [--all] [--dry]
// Splits a repo's source files into slices that fit one worker's context beside the ~130 KB checklist
// (default 200 KB each),
// keeping files of the same directory together, and writes <repo>/.checks/plan.json.
// Uses `git ls-files` when the repo is a git repo (respects .gitignore), else walks the tree.
// Pages built from one template (3 or more with the same tag skeleton, see families.mjs) are a family:
// only 2 representatives go to the workers, the rest are listed in plan.families as covered by them.
// --all checks every page anyway.
// No file is skipped for size (AB-17): a file over the per-file limit (200 KB) is cut into chunks of at most the slice budget, never inside a
// UTF-8 character, and each chunk is its own slice (.checks/chunks/<path with / as __>.part<i>-of-<n>.txt: a first line "PEWP CHUNK <file> bytes
// <a>-<b> of <size> (part i of n)", then every line as "@<byte offset in the original> <at most 1000 characters>"; the original newlines are
// the gaps between offsets). Byte-identical files (sha256) are sent once: plan.json "duplicates": [{ sent, sameAs: [..] }].
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { groupFamilies, unitsFor } from "./families.mjs";

const args = process.argv.slice(2);
// An unknown flag (2026-10-26: `--help`) used to fall through to a real plan, which rotated .checks/prev/ and lost a run.
const KNOWN = new Set(["--budget-kb", "--dry", "--all"]);
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: node plan.mjs <repo> [--dry] [--all] [--budget-kb N]   (without --dry it starts a new run: the old one moves to .checks/prev/)");
  process.exit(0);
}
const unknown = args.filter((a) => a.startsWith("-") && !KNOWN.has(a));
if (unknown.length) {
  console.error(`refusing: unknown option(s) ${unknown.join(", ")}; nothing was planned or moved`);
  process.exit(2);
}
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
const skipped = { generatedOrBinary: 0, tooLarge: [] }; // tooLarge stays in plan.json as an empty list: nothing is skipped for size any more
const kept = [];
for (const f of files.sort()) {
  if (SKIP_DIR.test(f) || SKIP_FILE.test(f)) { skipped.generatedOrBinary++; continue; }
  let size;
  try { size = fs.statSync(path.join(root, f)).size; } catch { continue; }
  const head = fs.readFileSync(path.join(root, f)).subarray(0, 4096);
  if (head.includes(0)) { skipped.generatedOrBinary++; continue; }
  kept.push({ file: f, size });
}
// Byte-identical files are sent once (the first by path); the others are listed under it.
const duplicates = [];
{
  const bySize = new Map();
  for (const k of kept) bySize.set(k.size, [...(bySize.get(k.size) || []), k]);
  const drop = new Set();
  for (const same of bySize.values()) {
    if (same.length < 2) continue;
    const byHash = new Map();
    for (const k of same) { const h = createHash("sha256").update(fs.readFileSync(path.join(root, k.file))).digest("hex"); byHash.set(h, [...(byHash.get(h) || []), k.file]); }
    for (const names of byHash.values()) if (names.length > 1) { duplicates.push({ sent: names[0], sameAs: names.slice(1) }); names.slice(1).forEach((n) => drop.add(n)); }
  }
  duplicates.sort((a, b) => (a.sent < b.sent ? -1 : 1));
  for (let i = kept.length - 1; i >= 0; i--) if (drop.has(kept[i].file)) kept.splice(i, 1);
}
const isBig = (k) => k.size > MAX_FILE;
const { families, covered } = all ? { families: [], covered: new Set() } : groupFamilies(unitsFor(root, kept.filter((k) => !isBig(k)).map((k) => k.file)));
const coveredFiles = kept.filter((k) => covered.has(k.file)).map((k) => k.file);
for (let i = kept.length - 1; i >= 0; i--) if (covered.has(kept[i].file)) kept.splice(i, 1);
// Greedy packing in path order; a slice boundary prefers a directory boundary. A file over the per-file limit is cut into chunks of at most the
// slice budget; each chunk is a slice of its own.
const slices = [];
let cur = { files: [], bytes: 0 };
const dirOf = (f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".");
const chunkJobs = [];
function cutPoints(buf, max) {
  const out = [];
  for (let a = 0; a < buf.length;) {
    let b = Math.min(a + max, buf.length);
    while (b < buf.length && b > a && (buf[b] & 0xc0) === 0x80) b--; // never inside a UTF-8 character
    if (b === a) b = Math.min(a + max, buf.length);
    out.push([a, b]); a = b;
  }
  return out;
}
function chunkText(file, buf, a, b, size, i, n) {
  let text = buf.subarray(a, b).toString("utf8"), note = "";
  if (!Buffer.from(text, "utf8").equals(buf.subarray(a, b))) { text = buf.subarray(a, b).toString("latin1"); note = " [not valid UTF-8: read one byte per character]"; }
  const out = [`PEWP CHUNK ${file} bytes ${a}-${b} of ${size} (part ${i} of ${n})${note}`];
  let off = a;
  const pieces = text.split("\n");
  pieces.forEach((piece, idx) => {
    if (!piece.length) out.push(`@${off} `);
    for (let k = 0; k < piece.length;) {
      let e = Math.min(k + 1000, piece.length);
      if (e < piece.length && piece.charCodeAt(e - 1) >= 0xd800 && piece.charCodeAt(e - 1) <= 0xdbff) e--; // not between the halves of one character
      const seg = piece.slice(k, e);
      out.push(`@${off} ${seg}`);
      off += Buffer.byteLength(seg, note ? "latin1" : "utf8"); k = e;
    }
    if (idx < pieces.length - 1) off += 1;
  });
  return out.join("\n") + "\n";
}
for (const k of kept) {
  if (isBig(k)) {
    if (cur.files.length) { slices.push(cur); cur = { files: [], bytes: 0 }; }
    const buf = fs.readFileSync(path.join(root, k.file));
    const cuts = cutPoints(buf, budget);
    cuts.forEach(([a, b], i) => {
      const name = `${k.file.replace(/\//g, "__")}.part${i + 1}-of-${cuts.length}.txt`;
      chunkJobs.push({ name, text: () => chunkText(k.file, buf, a, b, buf.length, i + 1, cuts.length) });
      slices.push({ files: [`.checks/chunks/${name}`], bytes: b - a, chunk: { file: k.file, from: a, to: b, size: buf.length, part: i + 1, of: cuts.length } });
    });
    continue;
  }
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
  const top = [...new Set((s.chunk ? [s.chunk.file] : s.files).map((f) => f.split("/")[0]))].slice(0, 2).join("+").replace(/[^A-Za-z0-9+_-]/g, "_");
  return { id: `s${String(i + 1).padStart(2, "0")}-${top}`.slice(0, 40), bytes: s.bytes, files: s.files, ...(s.chunk ? { chunk: s.chunk } : {}) };
});
const plan = { root, createdAt: new Date().toISOString(), budgetKb: budget / 1024, snapshot: fs.existsSync(path.join(root, "_site.json")), slices: named, families, coveredByFamily: coveredFiles, duplicates, skipped };
console.log(`${named.length} slice(s), ${kept.length} files, ${Math.round(kept.reduce((a, k) => a + k.size, 0) / 1024)} KB of source; skipped ${skipped.generatedOrBinary} binary/generated/lock files; ${chunkJobs.length ? `${new Set(named.filter((s) => s.chunk).map((s) => s.chunk.file)).size} file(s) over 200 KB cut into ${chunkJobs.length} chunk slices` : "no file over 200 KB"}`);
for (const d of duplicates) console.log(`  ${d.sent} is sent once; byte-identical: ${d.sameAs.join(", ")}`);
for (const f of families) console.log(`  family ${f.id} ${f.label}: ${f.size} pages, checked through ${f.reps.join(" + ")}`);
if (families.length) console.log(`  ${coveredFiles.length} files covered by their family's representatives (--all checks them one by one)`);
for (const s of named) console.log(`  ${s.id}: ${s.files.length} files, ${Math.round(s.bytes / 1024)} KB`);
if (!dry) {
  // A new plan starts a new run: move the previous run's outputs into .checks/prev/ so old findings
  // (whose slice ids collide with the new ones) are never merged into the new report.
  const cd = path.join(root, ".checks");
  const old = ["findings", "scripts", "logs", "verdicts", "chunks", "LEDGER.md", "ledger.json", "REPORT.md", "REPORT.prev.md", "causes.json", "run-all.mjs", "plan.json"].filter((x) => fs.existsSync(path.join(cd, x)));
  // A plan with no run behind it (only plan.json) is replaced in place: rotating it would wipe the real previous run in prev/.
  if (old.every((x) => x === "plan.json" || x === "chunks")) { fs.rmSync(path.join(cd, "chunks"), { recursive: true, force: true }); if (old.length) console.log("replacing a plan that has no run yet; .checks/prev/ kept"); }
  else if (old.length) {
    fs.rmSync(path.join(cd, "prev"), { recursive: true, force: true });
    fs.mkdirSync(path.join(cd, "prev"), { recursive: true });
    for (const x of old) fs.renameSync(path.join(cd, x), path.join(cd, "prev", x));
    console.log(`previous run moved to .checks/prev/ (${old.join(", ")})`);
  }
  fs.mkdirSync(path.join(root, ".checks"), { recursive: true });
  for (const j of chunkJobs) { fs.mkdirSync(path.join(cd, "chunks"), { recursive: true }); fs.writeFileSync(path.join(cd, "chunks", j.name), j.text()); }
  fs.writeFileSync(path.join(root, ".checks", "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`wrote ${path.join(root, ".checks", "plan.json")}`);
}
