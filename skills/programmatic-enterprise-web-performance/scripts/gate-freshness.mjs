// GT-013 rebuild-stable: the dates the built site carries are content dates, not the build clock (IDX-003, SE-004, AEO-012).
// With a build command (gate.mjs --build "<cmd>" [--build-cwd <dir>] [--setup "<cmd>"]; build-site.mjs passes the builder's): the site is
// built twice from the same source (lib-freshness checkStability) and every date field must be equal; FAIL lists URL + field + both values.
// Without one: the built output is read once: SE-004 on every sitemap lastmod (seconds + timezone, not in the future) and the build-clock
// signature (>= 5 URLs sharing one lastmod within 10 minutes of the sitemap file's mtime); the two-build comparison is a NOTE "NOT CHECKED".
// Exit (alone): 0 PASS, 1 FAIL, 2 cannot judge (the build failed). Usage alone: node gate-freshness.mjs <pewp dir> <site dir> [--build "<cmd>"]
import { pass, fail, error, formatResult, exitCode, loadCtx } from "./lib-plan.mjs";
import { isMain } from "./lib-main.mjs";
import { checkStability, collectDates, lintSitemaps, buildClockSignature, formatLines } from "./lib-freshness.mjs";

export const id = "GT-013";
export const title = "rebuild-stable";
export const plain = "Building the site twice gives the same dates: sitemap and page dates are content dates, not the time of the build";
export function run(ctx) {
  if (!ctx.siteDir) return error("no site folder given");
  if (ctx.build) {
    const res = checkStability(ctx.buildCwd || ctx.siteDir, { build: ctx.build, setup: ctx.setup, timeoutMs: (ctx.buildTimeoutMin || 10) * 60_000 });
    if (res.status === "ERROR") return error(res.why, res.notes);
    const lines = formatLines(res);
    if (res.status === "FAIL") return fail(`${res.failures.length} date field(s) change between two builds of the same source, ${res.se004.length} sitemap lastmod value(s) break SE-004`, lines);
    return pass(`two builds give the same dates${res.warns.length ? ` (${res.warns.length} other file(s) differ: WARN)` : ""}`, lines);
  }
  const snap = collectDates(ctx.siteDir);
  const se = lintSitemaps(snap);
  const clock = snap.sitemaps.map((s) => buildClockSignature(s)).filter(Boolean);
  const note = `NOTE the two-build comparison is NOT CHECKED: no build command known (gate.mjs --build "<cmd>"; build-site.mjs reads it from .pewp/builder/build-command.txt)`;
  const details = [...se.slice(0, 30).map((f) => `${f.url} sitemap <lastmod> "${f.value}": ${f.why} (SE-004, ${f.file})`), ...clock.map((c) => `${c.file}: ${c.why} (IDX-003)`), note];
  if (se.length || clock.length) return fail(`${se.length} sitemap lastmod value(s) break SE-004${clock.length ? `, ${clock.length} sitemap(s) carry the build clock` : ""}`, details);
  const n = snap.sitemaps.reduce((k, s) => k + s.entries.filter((e) => e.kind === "url").length, 0);
  return pass(snap.sitemaps.length ? `${n} sitemap URL(s): lastmod format right, no build-clock signature (one build read)` : "no sitemap in the built site: nothing claims freshness", [note]);
}

if (isMain(import.meta.url)) { // real-path compare (junction/symlink safe), see lib-plan.mjs
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--build", "--build-cwd", "--setup"].includes(a[i - 1]));
  if (pos.length < 2) { console.error('usage: node gate-freshness.mjs <pewp dir> <site dir> [--build "<cmd>"] [--build-cwd <dir>] [--setup "<cmd>"]'); process.exit(2); }
  const ctx = loadCtx(pos[0], pos[1], { build: opt("--build"), buildCwd: opt("--build-cwd"), setup: opt("--setup") });
  let r;
  try { r = run(ctx); } catch (e) { r = error(`check crashed: ${e.message}`); }
  console.log(formatResult(id, r));
  process.exit(exitCode(r.status));
}
