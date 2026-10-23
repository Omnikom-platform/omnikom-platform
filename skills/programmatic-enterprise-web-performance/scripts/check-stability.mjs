// Rebuild stability / no fake freshness (IDX-003, SE-004, AEO-012): build the site twice from the same commit and compare every date
// field of the output (sitemap <lastmod>, JSON-LD dateModified/datePublished, article:modified_time / og:updated_time, _headers
// Last-Modified). A date that moves between two builds of identical source is the build clock. lib-freshness.mjs has the rules.
// Usage: node check-stability.mjs <site dir> --build "<cmd>" [--setup "<cmd>"] [--out <dir>] [--timeout-min 10] [--json]
//   <site dir> is where the build command runs; every file under it (minus .git, node_modules, .checks, .pewp) is read.
//   A clean git checkout is restored to its commit afterwards (tracked output put back, new untracked files removed); a folder
//   with uncommitted changes, or outside git, is built twice in place and not restored (the output says so).
//   --out writes stability.json + stability.txt there.
// Exit 0 PASS, 1 FAIL (a date field differs between the builds, or a sitemap lastmod breaks SE-004), 2 cannot judge (build failed).
import fs from "node:fs";
import path from "node:path";
import { checkStability, formatLines } from "./lib-freshness.mjs";

const A = process.argv.slice(2);
const VALUE = new Set(["--build", "--setup", "--out", "--timeout-min"]);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const pos = A.filter((x, i) => !x.startsWith("--") && !VALUE.has(A[i - 1]));
if (!pos[0] || !opt("--build")) { console.error('usage: node check-stability.mjs <site dir> --build "<cmd>" [--setup "<cmd>"] [--out <dir>] [--timeout-min 10] [--json]'); process.exit(2); }
const dir = path.resolve(pos[0]);
if (!fs.existsSync(dir)) { console.error(`ERROR stability cannot judge: ${dir} does not exist`); process.exit(2); }

const res = checkStability(dir, { build: opt("--build"), setup: opt("--setup"), timeoutMs: Number(opt("--timeout-min", 10)) * 60_000 });
const head = res.status === "ERROR"
  ? `ERROR stability cannot judge: ${res.why}`
  : res.status === "FAIL"
    ? `FAIL stability ${res.failures.length} date field(s) change between two builds of the same source, ${res.se004.length} sitemap lastmod value(s) break SE-004`
    : `PASS stability two builds give the same dates${res.warns.length ? ` (${res.warns.length} other file(s) differ: WARN)` : ""}`;
const lines = [head, ...formatLines(res).map((l) => "  " + l)];
if (A.includes("--json")) console.log(JSON.stringify(res, null, 1));
else console.log(lines.join("\n"));
if (opt("--out")) {
  const out = path.resolve(opt("--out"));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "stability.json"), JSON.stringify({ dir, ranAt: new Date().toISOString(), ...res }, null, 1) + "\n");
  fs.writeFileSync(path.join(out, "stability.txt"), lines.join("\n") + "\n");
}
process.exit(res.status === "PASS" ? 0 : res.status === "FAIL" ? 1 : 2);
