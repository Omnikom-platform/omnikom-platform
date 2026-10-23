// Usage: node test-plan-merge.mjs [--scripts <dir holding plan.mjs, merge.mjs, families.mjs>]
// Builds a small fake repo (5 blog pages from one template, two one-off pages, a generator) and checks:
// the planner groups the 5 into one family and sends 2; the merge turns per-page findings of one template
// defect into ONE root cause, keeps a different defect under the same rule apart, keeps two bugs apart,
// counts the pages a cause affects, and lists a slice with no findings as NOT CHECKED. Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : path.dirname(fileURLToPath(import.meta.url)));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pm-test-"));
const w = (rel, s) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), s); };
const blog = (t, n) => `<!doctype html><html><head><title>${t}</title></head><body><header class="top"><nav class="nav"><a href="/">Home</a></nav></header><main class="post"><h1 class="t">${t}</h1>${"<p class=\"p\">words words</p>".repeat(n)}<aside class="side"><ul class="l"><li>a</li></ul></aside></main><footer class="foot"><p class="ph">CA DRE</p></footer></body></html>`;
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
try {
  w("gen.mjs", "// generator\nexport const page = () => '';\n");
  ["a", "b", "c", "d", "e"].forEach((s, i) => w(`blog/${s}/index.html`, blog(`Post ${s}`, 3 + i)));
  w("index.html", `<!doctype html><html><head><title>Home</title></head><body><section class="hero"><video class="v"></video><form class="f"><input name="e"></form></section></body></html>`);
  w("about/index.html", `<!doctype html><html><head><title>About</title></head><body><article class="bio"><img class="me" src="x.jpg"><table class="t"><tr><td>1</td></tr></table></article></body></html>`);

  // Same markup, different URL shapes (one layout wrapping different page types): never one family.
  ["guide", "team", "terms"].forEach((s) => w(`${s}/index.html`, blog(`Page ${s}`, 3)));
  const p = spawnSync(process.execPath, [path.join(dir, "plan.mjs"), repo], { encoding: "utf8", timeout: 120_000 });
  const plan = JSON.parse(fs.readFileSync(path.join(repo, ".checks/plan.json"), "utf8"));
  const fam = (plan.families || [])[0];
  check("planner: 5 blog pages are one family", plan.families?.length === 1 && fam.size === 5 && fam.label === "blog/*/index.html", p.stdout);
  check("planner: only 2 representatives sent", plan.coveredByFamily?.length === 3 && plan.slices.flatMap((s) => s.files).filter((f) => f.startsWith("blog/")).length === 2);
  check("planner: same markup at different URL shapes is not a family", !(plan.families || []).some((f) => f.members.some((m) => /^(guide|team|terms)\//.test(m))) && plan.slices.flatMap((s) => s.files).filter((f) => /^(guide|team|terms)\//.test(f)).length === 3);
  check("planner: one-off pages kept", plan.slices.flatMap((s) => s.files).includes("about/index.html") && plan.slices.flatMap((s) => s.files).includes("index.html"));
  const fid = fam?.id || "F01";

  // Findings as workers would write them: two slices see the same breadcrumb defect; one row in the old
  // 7-column format (no root cause); a different SCH-004 defect; two different bugs on one page.
  plan.slices = [{ id: "s01", files: ["gen.mjs", "about/index.html", fam?.reps[0]] }, { id: "s02", files: [fam?.reps[1], "index.html"] }, { id: "s03", files: ["blog/b/index.html"] }, { id: "s04", files: ["x.css"] }];
  fs.writeFileSync(path.join(repo, ".checks/plan.json"), JSON.stringify(plan));
  const head = "| id | severity | file:line | problem | why it matters | fix | check script | root cause |\n|---|---|---|---|---|---|---|---|\n";
  w(".checks/findings/s01.md", head +
    `| s01-01 | high | ${fam?.reps[0]}:1 | SCH-004: \`BreadcrumbList\` items have no \`item\` URL | rich results | add item | check-s01-01.mjs | gen.mjs:2 page() |\n` +
    `| s01-02 | medium | about/index.html:1 | BUG: image has no alt | a11y | add alt | check-s01-02.mjs | about/index.html:1 |\n` +
    `| s01-03 | medium | about/index.html:1 | BUG: table has no header row | a11y | add th | none (manual) | about/index.html:1 col 80 |\n` +
    `| s01-04 | high | index.html:1 | MET-003: no \`main\` landmark on the page | a11y | wrap in main | none (platform) | platform: hosted page layout |\n`);
  w(".checks/findings/s02.md", head +
    `| s02-01 | high | ${fid} (5 pages) | SCH-004 / SCH-008: \`BreadcrumbList\` names do not mirror the trail and have no \`item\` | rich results | fix crumbs | check-s02-01.mjs | gen.mjs:2 |\n` +
    `| s02-02 | medium | ${fam?.reps[1]}:1 | SCH-004: \`BlogPosting\` has no \`image\` or \`dateModified\` | rich results | add fields | check-s02-02.mjs | gen.mjs:2 |\n` +
    `| s02-03 | high | ${fid} (5 pages) | MET-011: placeholder \`ph\` text shows in the footer | trust | fill it | none (content) | gen.mjs:2 |\n` +
    `| s02-04 | high | about/index.html:1 | MET-003: the layout has no \`main\` element | a11y | add main | none (platform) | platform: the site builder's template |\n`);
  w(".checks/findings/s03.md", "| id | severity | file:line | problem | why it matters | fix | check script |\n|---|---|---|---|---|---|---|\n" +
    `| s03-01 | high | blog/b/index.html:1 | SCH-004: \`BreadcrumbList\` ListItem has no \`item\` | rich results | add item | none (old format) |\n`);
  w(".checks/scripts/check-s01-01.mjs", "console.log('FAIL s01-01 x'); process.exit(1);\n");
  w(".checks/scripts/check-s01-02.mjs", "console.log('PASS s01-02'); process.exit(0);\n");
  w(".checks/scripts/check-s02-01.mjs", "console.log('FAIL s02-01 x'); process.exit(1);\n");
  w(".checks/scripts/check-s02-02.mjs", "console.log('FAIL s02-02 x'); process.exit(1);\n");

  const m = spawnSync(process.execPath, [path.join(dir, "merge.mjs"), repo], { encoding: "utf8", timeout: 300_000 });
  const causes = fs.existsSync(path.join(repo, ".checks/causes.json")) ? JSON.parse(fs.readFileSync(path.join(repo, ".checks/causes.json"), "utf8")) : [];
  const crumb = causes.find((c) => c.findings.includes("s01-01"));
  check("merge: one template defect from 3 workers = one cause", crumb && ["s01-01", "s02-01", "s03-01"].every((id) => crumb.findings.includes(id)), JSON.stringify(causes.map((c) => c.findings)));
  check("merge: other defect under the same rule kept apart", crumb && !crumb.findings.includes("s02-02"));
  check("merge: two different bugs on one page kept apart", causes.filter((c) => c.findings.includes("s01-02") || c.findings.includes("s01-03")).length === 2);
  check("merge: 6 causes in all", causes.length === 6, `${causes.length}: ${m.stdout}`);
  const plat = causes.find((c) => c.findings.includes("s01-04"));
  check("merge: one platform defect from two workers = one cause", plat && plat.findings.includes("s02-04"), JSON.stringify(causes.map((c) => c.findings)));
  const ph = causes.find((c) => c.findings.includes("s02-03"));
  check("merge: a cause named only by its family counts the family's pages", ph && ph.pages === 5, ph && `pages ${ph.pages}`);
  check("merge: cause affects the whole family (5 pages)", crumb && crumb.pages === 5, crumb && `pages ${crumb.pages}`);
  const report = fs.existsSync(path.join(repo, ".checks/REPORT.md")) ? fs.readFileSync(path.join(repo, ".checks/REPORT.md"), "utf8") : "";
  check("report: root causes first, with where to fix", /## Root causes[\s\S]*gen\.mjs[\s\S]*## Every finding/.test(report));
  check("report: slice without findings is NOT CHECKED", /## NOT CHECKED[\s\S]*slice s04/.test(report));
  const ra = spawnSync(process.execPath, [path.join(repo, ".checks/run-all.mjs")], { encoding: "utf8", timeout: 300_000 });
  check("run-all: prints open causes", ra.status === 1 && /OPEN {2}C\d+/.test(ra.stdout) && /root causes still open/.test(ra.stdout), ra.stdout + ra.stderr);
  const rj = spawnSync(process.execPath, [path.join(repo, ".checks/run-all.mjs"), "--json"], { encoding: "utf8", timeout: 300_000 });
  let parsed = null; try { parsed = JSON.parse(rj.stdout); } catch {}
  check("run-all --json is valid JSON with causes", parsed && Array.isArray(parsed.causes) && /checks pass/.test(parsed.summary), rj.stdout.slice(-200));
  check("merge: the built-in sitemap lastmod check (SE-004/IDX-003) is copied into .checks/scripts although no finding names a sitemap, marked builtin in REPORT.md, run by run-all", fs.existsSync(path.join(repo, ".checks/scripts/check-builtin-se004-idx003-sitemap-lastmod.mjs")) && /`check-builtin-se004-idx003-sitemap-lastmod\.mjs` builtin: cannot judge yet/.test(report) && parsed?.scripts?.some((s) => s.script === "check-builtin-se004-idx003-sitemap-lastmod.mjs"), report.slice(-300));
  spawnSync(process.execPath, [path.join(dir, "plan.mjs"), repo], { encoding: "utf8", timeout: 120_000 });
  check("new plan moves the previous run to .checks/prev/", !fs.existsSync(path.join(repo, ".checks/findings")) && fs.existsSync(path.join(repo, ".checks/prev/findings/s01.md")) && fs.existsSync(path.join(repo, ".checks/plan.json")));
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `  ${String(r.detail).slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `PLAN+MERGE TEST FAIL: ${failed} of ${results.length}` : `PLAN+MERGE TEST PASS: ${results.length} of ${results.length}`);
process.exit(failed ? 1 : 0);
