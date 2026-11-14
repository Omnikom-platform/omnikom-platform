// Usage: node test-pages-affected.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of the page count of a root cause (families.mjs countPages, used by merge.mjs) on INVENTED files: a live-site snapshot page is one page
// whether the cause sits in its head, its body or both; two snapshot pages are two; a family counts its members; a codebase's files count each
// (even a pages/x/head.html and pages/x/body.html). Cases 6 and 7 run the real merge.mjs on a tiny fake root. No network, no browser.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { W, J, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "files-counted-again", file: "families.mjs", from: "[pageOf(p, snapshot)]", to: "[p]", red: "case 1:" },
    { id: "slugs-merged-into-one-page", file: "families.mjs", from: "`pages/${m[1]}`", to: '"pages"', red: "case 2:" },
    { id: "repository-files-merged", file: "families.mjs", from: "const m = snapshot ? file.match(", to: "const m = true ? file.match(", red: "case 4:" },
    { id: "merge-ignores-snapshot-flag", file: "merge.mjs", from: "famOfFile, !!plan.snapshot)", to: "famOfFile, false)", red: "case 6:" },
    { id: "merge-always-snapshot", file: "merge.mjs", from: "famOfFile, !!plan.snapshot)", to: "famOfFile, true)", red: "case 7:" },
    { id: "family-members-dropped", file: "families.mjs", from: "famOfFile(p)?.members || ", to: "null || ", red: "case 5:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pagesaff-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-pages-affected.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };

const { countPages } = await import(pathToFileURL(path.join(dir, "families.mjs")).href);
const none = () => null;
const FAM5 = { id: "F01", members: ["blog/a/index.html", "blog/b/index.html", "blog/c/index.html", "blog/d/index.html", "blog/e/index.html"] };
const famRepo = (f) => (FAM5.members.includes(f) ? FAM5 : null);
const FAMS = { id: "F02", members: ["pages/a", "pages/b", "pages/c"] };
const famSnap = (f) => (FAMS.members.includes(f) || FAMS.members.includes(f.replace(/\/[^/]+$/, "")) ? FAMS : null);
const HEAD = "| id | severity | file:line | problem | why it matters | fix | check script | root cause |\n|---|---|---|---|---|---|---|---|\n";
const row = (id, sev, where, root) => `| ${id} | ${sev} | ${where} | BUG: invented defect ${id} | why | fix | none (manual) | ${root} |`;
const tmp = mkTmp("pages-affected");
let n = 0;
const e2e = (snap, files, rows) => {
  const root = path.join(tmp, `r${n++}`);
  for (const f of files) W(path.join(root, f), "<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>");
  if (snap) W(path.join(root, "_site.json"), { finishedAt: "2026-11-01T10:00:00Z", pages: [] });
  W(path.join(root, ".checks", "plan.json"), { slices: [{ id: "s01", files }], skipped: {}, snapshot: snap });
  W(path.join(root, ".checks", "findings", "s01.md"), HEAD + rows.join("\n") + "\n");
  const r = spawnSync(process.execPath, ["--max-old-space-size=256", path.join(dir, "merge.mjs"), root], { encoding: "utf8", timeout: 120000 });
  const cf = path.join(root, ".checks", "causes.json");
  const causes = fs.existsSync(cf) ? J(cf) : [];
  return { code: r.status, pages: (id) => causes.find((c) => c.findings.includes(id))?.pages, out: `exit ${r.status} ${(r.stdout || "") + (r.stderr || "")}`.slice(0, 300), n: causes.length };
};
try {
  check("case 1: one snapshot page, a cause in its head and its body: 1 page", countPages(["pages/home/head.html", "pages/home/body.html"], none, true) === 1, countPages(["pages/home/head.html", "pages/home/body.html"], none, true));
  check("case 2: two snapshot pages, the cause in the head of one and the body of the other: 2 pages", countPages(["pages/home/head.html", "pages/about/body.html"], none, true) === 2);
  check("case 3: one snapshot page's head only: 1 page", countPages(["pages/home/head.html"], none, true) === 1);
  check("case 4: a codebase's files named head.html and body.html in one folder (pages/x and site) stay two pages each, as today",
    countPages(["pages/x/head.html", "pages/x/body.html"], none, false) === 2 && countPages(["site/head.html", "site/body.html"], none, false) === 2);
  check("case 5: a family counts its members as today: 5 for a codebase family, 3 for a snapshot family (both files of a member are one), plus 1 for a page outside it",
    countPages(["blog/a/index.html"], famRepo, false) === 5 && countPages(["pages/a/head.html", "pages/a/body.html"], famSnap, true) === 3 && countPages(["pages/a/head.html", "pages/z/head.html"], famSnap, true) === 4);
  const S = e2e(true, ["pages/home/head.html", "pages/home/body.html", "pages/about/head.html", "pages/about/body.html"], [
    row("s01-01", "high", "pages/home/body.html:1", "pages/home/head.html:1"),
    row("s01-02", "medium", "pages/home/head.html:2", "pages/home/head.html:2"),
    row("s01-03", "low", "pages/home/head.html:3", "pages/about/body.html:3")]);
  check("case 6: through the real merge.mjs on a snapshot root: head+body of one page = 1, head only = 1, head of one and body of another = 2 (causes.json pages)",
    S.code === 0 && S.n === 3 && S.pages("s01-01") === 1 && S.pages("s01-02") === 1 && S.pages("s01-03") === 2, `pages ${S.pages("s01-01")} ${S.pages("s01-02")} ${S.pages("s01-03")} | ${S.out}`);
  const R = e2e(false, ["pages/x/head.html", "pages/x/body.html"], [row("s01-01", "high", "pages/x/body.html:1", "pages/x/head.html:1")]);
  check("case 7: through the real merge.mjs on a codebase root: pages/x/head.html and pages/x/body.html in a cause are 2 pages, as today", R.code === 0 && R.n === 1 && R.pages("s01-01") === 2, `pages ${R.pages("s01-01")} | ${R.out}`);
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
