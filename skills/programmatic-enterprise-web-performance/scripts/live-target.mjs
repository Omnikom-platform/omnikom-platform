// Usage: node live-target.mjs <url> [--fresh] [--max-age-days 7] [--cwd DIR] [-- <snapshot-site options>]
// Returns the snapshot folder to check for a live URL: the newest COMPLETE snapshot under
// <cwd>/site-checks/<host>/snapshots/<date>/ if it is younger than --max-age-days (default 7: client sites rate-limit,
// so a re-run reuses instead of re-crawling), else takes a new one with snapshot-site.mjs (options after --).
// --fresh always takes a new one. Prints one line: REUSE <dir> | NEW <dir> | FAILED <dir> <why>. Exit 0 / 0 / 1.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import { numArg } from "./lib-polite.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locate } from "./state.mjs";

export function latestComplete(snapshotsDir) {
  if (!fs.existsSync(snapshotsDir)) return null;
  for (const d of fs.readdirSync(snapshotsDir).filter((x) => /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(x)).sort().reverse()) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(snapshotsDir, d, "_site.json"), "utf8"));
      if (!s.stoppedEarly && s.finishedAt && s.pages?.length) return { dir: path.join(snapshotsDir, d), finishedAt: s.finishedAt, site: s };
    } catch {}
  }
  return null;
}

if (isMain(import.meta.url)) {
  const all = process.argv.slice(2);
  const dd = all.indexOf("--");
  const a = dd >= 0 ? all.slice(0, dd) : all;
  const pass = dd >= 0 ? all.slice(dd + 1) : [];
  const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const url = a[0];
  if (!url || !/^https?:\/\//i.test(url)) { console.error("usage: node live-target.mjs <url> [--fresh] [--max-age-days 7] [--cwd DIR] [-- <snapshot-site options>]"); process.exit(2); }
  const loc = locate(url, { cwd: opt("--cwd", process.cwd()) });
  // "--max-age-days abc" was NaN: no snapshot was ever young enough, so every run re-crawled the live site. A usage error now.
  let maxAge;
  try { maxAge = numArg("--max-age-days", opt("--max-age-days"), { present: a.includes("--max-age-days"), def: 7, min: 0 }) * 86400000; }
  catch (e) { console.error(`usage: node live-target.mjs <url> [--fresh] [--max-age-days 7] [--cwd DIR] [-- <snapshot-site options>]: ${e.message}`); process.exit(2); }
  const last = latestComplete(loc.snapshots);
  if (last && !a.includes("--fresh") && Date.now() - Date.parse(last.finishedAt) < maxAge) { console.log(`REUSE ${last.dir} (finished ${last.finishedAt})`); process.exit(0); }
  let name = new Date().toISOString().slice(0, 10);
  for (let n = 2; fs.existsSync(path.join(loc.snapshots, name)); n++) name = `${new Date().toISOString().slice(0, 10)}-${n}`;
  const dir = path.join(loc.snapshots, name);
  const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "snapshot-site.mjs"), loc.target, dir, ...pass], { stdio: ["ignore", "inherit", "inherit"], timeout: 4 * 3600_000 });
  if (r.error?.code === "ETIMEDOUT") { console.log(`FAILED ${dir}: the snapshot ran over 4 h and was stopped`); process.exit(1); }
  if (r.error) { console.log(`FAILED ${dir}: snapshot-site.mjs could not run (${r.error.code || r.error.message})`); process.exit(1); }
  if (r.status === 0) console.log(`NEW ${dir}`);
  else { console.log(`FAILED ${dir} exit ${r.status} (see ${path.join(dir, "_site.json")})`); process.exit(1); }
}
