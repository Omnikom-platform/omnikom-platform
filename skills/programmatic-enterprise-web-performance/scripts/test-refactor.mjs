// Usage: node test-refactor.mjs [--scripts <dir>] [--only units|A|B|C|D|E|F|build] [--no-mutants] [--keep]
// Proof of refactor mode (refactor.mjs, run-all-diff.mjs) and the build-mode driver (build-site.mjs). No model is called:
// the fix worker is a stand-in script (--worker-script) that behaves as scripted per finding; the stage scripts of
// build mode are stand-ins too. Fixture = a git repo with a tiny generator (site/gen.mjs -> site/dist/, tracked), a
// bare "remote", and a real `.checks/` made by the real merge.mjs from findings tables.
//   scenario A (cap 1): good fix, fix that breaks another check, output-only edit, edit of main, edit of a check,
//     worker-declared NEEDS-PEOPLE, hang, push attempt + secret scrub, plus the up-front skips
//   scenario B (cap 2): concurrency cap respected, merge conflict between two proven fixes is downgraded
//   scenario F: rebuild stability (IDX-003/SE-004/AEO-012): clock-stamped sitemap rejected at the merge, ledger sitemap merged,
//     a 6-URL clock sitemap newly fails the built-in check, --no-stability, a pre-existing baseline defect
//   mutants: break the code each assertion guards, expect the named assertion(s) to go red, restore.
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const onlyWhat = opt("--only");
const keep = A.includes("--keep");
const realScripts = here; // fixtures are always made with the real merge.mjs
const node = process.execPath;
const sh = (cwd, cmd, ...a) => spawnSync(cmd, a, { cwd, encoding: "utf8", timeout: 120_000 });
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", timeout: 60_000 });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// ---------------- fixture ----------------
const FLAGS = [
  // fid, flag, rule, severity, problem, fix, check?, behaviour in scenario A
  ["s01-01", "lang", "LNG-001", "high", "html has no lang attribute", "add lang to the html tag in gen.mjs", true, "good"],
  ["s01-02", "desc", "MET-002", "high", "meta description is empty", "write a description in gen.mjs", true, "regress"],
  ["s01-03", "viewport", "MOB-003", "medium", "no viewport meta tag", "add the viewport meta in gen.mjs", true, "outputonly"],
  ["s01-04", "licence", "TRU-004", "high", "licence number shows the placeholder", "owner decision: supply the real licence number", true, "noop"],
  ["s01-05", "alt", "SEO-005", "low", "hero image alt text missing", "write alt text", false, "noop"],
  ["s01-06", "title", "SEO-006", "medium", "page has no title", "add title", true, "noop"],
  ["s01-07", "h1", "SEO-007", "medium", "page has no h1", "add h1", true, "noop"],
  ["s01-08", "canon", "CAN-008", "medium", "no canonical link", "emit rel=canonical in gen.mjs", true, "editmain"],
  ["s01-09", "robots", "ROB-009", "medium", "no robots meta", "emit robots meta in gen.mjs", true, "tamper"],
  ["s01-10", "og", "OGP-010", "low", "no og:title", "emit og:title in gen.mjs", true, "needspeople"],
  ["s01-11", "icon", "ICO-011", "low", "no favicon link", "emit icon link in gen.mjs", true, "hang"],
  ["s01-12", "hreflang", "HRF-012", "low", "no hreflang alternate", "emit hreflang in gen.mjs", true, "pushtry"],
];
const MARK = {
  lang: ['<html lang="en">', true], desc: ['<meta name="description" content="A page">', true], viewport: ['<meta name="viewport"', true],
  licence: ["DRE #00000000", false], title: ["<title>", true], h1: ["<h1>", true], canon: ['<link rel="canonical"', true],
  robots: ['<meta name="robots"', true], og: ['<meta property="og:title"', true], icon: ['<link rel="icon"', true], hreflang: ['<link rel="alternate" hreflang', true],
};
const GEN = `// tiny static generator: site/dist/ is its (committed) output
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const features = {
  lang: false,
  // -
  desc: false,
  // -
  viewport: false,
  // -
  licence: false,
  // -
  alt: false,
  // -
  title: true,
  // -
  h1: true,
  // -
  canon: false,
  // -
  robots: false,
  // -
  og: false,
  // -
  icon: false,
  // -
  hreflang: false,
};
const page = (t) => "<!doctype html><html" + (features.lang ? ' lang="en"' : "") + "><head><meta charset=\\"utf-8\\">" +
  (features.title ? "<title>" + t + "</title>" : "") +
  '<meta name="description" content="' + (features.desc ? "A page" : "") + '">' +
  (features.viewport ? '<meta name="viewport" content="width=device-width">' : "") +
  (features.canon ? '<link rel="canonical" href="/">' : "") +
  (features.robots ? '<meta name="robots" content="index">' : "") +
  (features.og ? '<meta property="og:title" content="' + t + '">' : "") +
  (features.icon ? '<link rel="icon" href="/i.png">' : "") +
  (features.hreflang ? '<link rel="alternate" hreflang="en" href="/">' : "") +
  "</head><body>" + (features.h1 ? "<h1>" + t + "</h1>" : "") + "<p>" + (features.licence ? "DRE #01234567" : "DRE #00000000") + "</p></body></html>\\n";
for (const [rel, t] of [["index.html", "Home"], ["about/index.html", "About"]]) {
  const f = path.join(here, "dist", rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, page(t));
}
`;
const checkSrc = (fid, flag) => {
  const [mark, positive] = MARK[flag];
  return `import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] || ".");
const files = ["index.html", "about/index.html"].map((f) => path.join(root, "dist", f));
if (files.some((f) => !fs.existsSync(f))) { console.log("ERROR ${fid} cannot judge: dist missing"); process.exit(2); }
const bad = files.filter((f) => ${positive ? "!" : ""}fs.readFileSync(f, "utf8").includes(${JSON.stringify(mark)}));
if (bad.length) { console.log("FAIL ${fid} " + bad.length + " page(s)"); process.exit(1); }
console.log("PASS ${fid}");
`;
};
const FAKE = `import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const [root, causeId, causeFile] = process.argv.slice(2);
const cause = JSON.parse(fs.readFileSync(causeFile, "utf8"));
const spec = JSON.parse(fs.readFileSync(process.env.FAKE_BEHAVIORS, "utf8"));
const fid = cause.findings[0];
const { b = "noop", flag } = spec[fid] || {};
const log = (o) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ cause: causeId, fid, b, t: Date.now(), ...o }) + "\\n");
const gen = path.join(root, "gen.mjs");
const flip = (file, name, to = "true") => {
  const s = fs.readFileSync(file, "utf8");
  const re = new RegExp("(\\\\b" + name + ":\\\\s*)(true|false)");
  if (!re.test(s)) throw new Error("fake worker: flag " + name + " not found in " + file);
  fs.writeFileSync(file, s.replace(re, "$1" + to));
};
log({ ev: "start", cf: !!process.env.CLOUDFLARE_API_TOKEN, gh: !!process.env.GITHUB_TOKEN, cfgCount: process.env.GIT_CONFIG_COUNT || null, keepsAnthropic: !!process.env.ANTHROPIC_API_KEY });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
switch (b) {
  case "good": flip(gen, flag); break;
  case "good-slow": {
    // a barrier, not a fixed sleep: wait (up to 30 s) until the other slow worker has started too. Under load the coordinator's
    // synchronous rebuilds can outlast any fixed sleep, so a sleep made "ran in parallel" depend on timing; this does not.
    const t0 = Date.now();
    const starts = (slowOnly) => fs.readFileSync(process.env.FAKE_LOG, "utf8").split(String.fromCharCode(10)).filter((l) => l.includes('"ev":"start"') && (!slowOnly || l.includes('"b":"good-slow"'))).length;
    while (Date.now() - t0 < 30000 && starts(true) < 2) await sleep(200);
    // then hold the slot (up to 10 s): with the cap working the third worker cannot start now; without a cap it starts and is seen
    const t1 = Date.now();
    while (Date.now() - t1 < 10000 && starts(false) < 3) await sleep(200);
    flip(gen, flag);
    break;
  }
  case "regress": flip(gen, flag); flip(gen, "title", "false"); break;
  case "outputonly":
    for (const f of ["index.html", "about/index.html"]) {
      const p = path.join(root, "dist", f);
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("<head>", '<head><meta name="viewport" content="width=device-width">'));
    }
    break;
  case "editmain": {
    flip(gen, flag);
    const common = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 60000 }).stdout.trim();
    const prefix = spawnSync("git", ["-C", root, "rev-parse", "--show-prefix"], { encoding: "utf8", timeout: 60000 }).stdout.trim();
    flip(path.join(path.dirname(common), prefix, "gen.mjs"), flag);
    break;
  }
  case "tamper": {
    flip(gen, flag);
    flip(gen, "title", "false");
    fs.writeFileSync(path.join(root, ".checks/scripts/check-s01-06.mjs"), 'console.log("PASS s01-06 (edited)");\\n');
    break;
  }
  case "needspeople": fs.mkdirSync(path.join(root, ".checks/refactor", causeId), { recursive: true }); fs.writeFileSync(path.join(root, ".checks/refactor", causeId, "NEEDS-PEOPLE.txt"), "needs the client to provide the Open Graph image\\n"); break;
  case "hang": setInterval(() => {}, 1000); await new Promise(() => {}); break;
  case "pushtry": {
    flip(gen, flag);
    const p = spawnSync("git", ["-C", root, "push", "origin", "HEAD:refs/heads/rogue"], { encoding: "utf8", timeout: 20000 });
    log({ ev: "push", code: p.status });
    break;
  }
  case "conflictlang": flip(gen, flag); { const s = fs.readFileSync(gen, "utf8"); fs.writeFileSync(gen, s.replace(/lang: false,/, "lang: true, // also set by the hreflang worker")); } break;
  case "touchoutside": case "commitoutside": case "commitsite": {
    // a legitimate fix in the worktree, plus something done to the MAIN repository: outside the site (a note), or a commit
    flip(gen, flag);
    const common = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 60000 }).stdout.trim();
    const prefix = spawnSync("git", ["-C", root, "rev-parse", "--show-prefix"], { encoding: "utf8", timeout: 60000 }).stdout.trim();
    const mainTop = path.dirname(common);
    if (b === "touchoutside") fs.appendFileSync(path.join(mainTop, "README.md"), "another session was here" + String.fromCharCode(10));
    if (b === "commitoutside") {
      fs.writeFileSync(path.join(mainTop, "OTHER.md"), "another session committed this" + String.fromCharCode(10));
      spawnSync("git", ["-C", mainTop, "add", "OTHER.md"], { timeout: 60000 }); spawnSync("git", ["-C", mainTop, "commit", "-q", "-m", "other session"], { timeout: 60000 });
    }
    if (b === "commitsite") {
      flip(path.join(mainTop, prefix, "gen.mjs"), flag);
      spawnSync("git", ["-C", mainTop, "add", path.join(prefix, "gen.mjs")], { timeout: 60000 }); spawnSync("git", ["-C", mainTop, "commit", "-q", "-m", "worker committed to main"], { timeout: 60000 });
    }
    break;
  }
  // F: code appended to the generator (a sitemap writer), plus files the fix adds (a committed ledger)
  case "append": fs.appendFileSync(gen, spec[fid].append); for (const [f, s] of Object.entries(spec[fid].files || {})) fs.writeFileSync(path.join(root, f), s); break;
  default: break;
}
log({ ev: "end" });
`;

// opts.extra: more findings [{ fid, rule, sev, prob, fix, src }] (src = its check script); opts.genTail: code appended to the
// committed generator (a defect present at the baseline)
function makeFixture(label, behaviors, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pewp-refactor-${label}-`));
  const top = path.join(tmp, "repo");
  const site = path.join(top, "site");
  w(path.join(site, "gen.mjs"), GEN + (opts.genTail || ""));
  w(path.join(top, ".gitignore"), ".checks/\n.pewp/\n");
  w(path.join(top, "README.md"), "fixture\n");
  git(tmp, "init", "-q", "-b", "main", top);
  git(top, "config", "user.name", "fixture"); git(top, "config", "user.email", "f@localhost");
  const b = sh(site, node, "gen.mjs");
  if (b.status) throw new Error("fixture gen failed " + b.stderr);
  git(top, "add", "-A"); git(top, "commit", "-q", "-m", "fixture");
  git(tmp, "init", "-q", "--bare", "remote.git");
  git(top, "remote", "add", "origin", path.join(tmp, "remote.git"));
  // a real .checks made by the real merge.mjs
  const head = "| id | severity | file:line | problem | why it matters | fix | check script | root cause |\n|---|---|---|---|---|---|---|---|\n";
  w(path.join(site, ".checks/findings/s01.md"), head + FLAGS.map(([fid, flag, rule, sev, prob, fix, has]) =>
    `| ${fid} | ${sev} | gen.mjs:1 | ${rule}: ${prob} | matters | ${fix} | ${has ? `check-${fid}.mjs` : "none (manual)"} | gen.mjs:1 |`).join("\n") + "\n" +
    (opts.extra || []).map((x) => `| ${x.fid} | ${x.sev} | gen.mjs:1 | ${x.rule}: ${x.prob} | matters | ${x.fix} | check-${x.fid}.mjs | gen.mjs:1 |\n`).join(""));
  for (const [fid, flag, , , , , has] of FLAGS) if (has) w(path.join(site, `.checks/scripts/check-${fid}.mjs`), checkSrc(fid, flag));
  for (const x of opts.extra || []) w(path.join(site, `.checks/scripts/check-${x.fid}.mjs`), x.src);
  w(path.join(site, ".checks/plan.json"), JSON.stringify({ slices: [{ id: "s01", files: ["gen.mjs"] }], skipped: {} }));
  const m = sh(site, node, path.join(realScripts, "merge.mjs"), site);
  if (m.status) throw new Error("fixture merge failed: " + m.stdout + m.stderr);
  const causes = JSON.parse(fs.readFileSync(path.join(site, ".checks/causes.json"), "utf8"));
  const cid = (fid) => causes.find((c) => c.findings.includes(fid))?.id;
  const beh = (fid, flag, dflt) => (behaviors[fid] && typeof behaviors[fid] === "object" ? { ...behaviors[fid], flag } : { b: behaviors[fid] ?? dflt, flag });
  w(path.join(tmp, "behaviors.json"), JSON.stringify(Object.fromEntries([...FLAGS.map(([fid, flag, , , , , , d]) => [fid, beh(fid, flag, d)]), ...(opts.extra || []).map((x) => [x.fid, beh(x.fid, null, "noop")])])));
  w(path.join(tmp, "fake-worker.mjs"), FAKE);
  return { tmp, top, site, cid, causes, behaviors: path.join(tmp, "behaviors.json"), log: path.join(tmp, "fake.log"), remote: path.join(tmp, "remote.git") };
}

function runRefactor(fx, dir, extra = []) {
  const mainBefore = git(fx.top, "rev-parse", "main").stdout.trim();
  const r = spawnSync(node, [path.join(dir, "refactor.mjs"), fx.site, "--build", "node gen.mjs", "--worker-script", path.join(fx.tmp, "fake-worker.mjs"), "--worktrees", path.join(fx.tmp, "wt"), "--date", "2026-10-22", ...extra], {
    encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FAKE_BEHAVIORS: fx.behaviors, FAKE_LOG: fx.log, CLOUDFLARE_API_TOKEN: "leak-test", GITHUB_TOKEN: "leak-test", ANTHROPIC_API_KEY: "kept-test" },
  });
  const jf = path.join(fx.site, ".pewp/refactor/2026-10-22.json");
  const report = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, "utf8")) : null;
  const md = fs.existsSync(jf.replace(/\.json$/, ".md")) ? fs.readFileSync(jf.replace(/\.json$/, ".md"), "utf8") : "";
  const logLines = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { r, report, md, logLines, mainBefore, mainAfter: git(fx.top, "rev-parse", "main").stdout.trim(), out: (r.stdout || "") + (r.stderr || "") };
}

// ---------------- assertions ----------------
let results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail) });

async function units(dir) {
  const { diffRunAll } = await import(pathToFileURL(path.join(dir, "run-all-diff.mjs")).href + `?u=${Math.random()}`);
  const ra = (o) => ({ scripts: Object.entries(o).map(([script, status]) => ({ script, status })) });
  const d1 = diffRunAll(ra({ "a.mjs": "open", "b.mjs": "pass" }), ra({ "a.mjs": "pass", "b.mjs": "pass" }), ["a.mjs"]);
  check("diff: open -> pass with nothing else moving is targetFixed", d1.targetFixed && !d1.regressed.length && d1.fixed[0] === "a.mjs");
  const d2 = diffRunAll(ra({ "a.mjs": "open", "b.mjs": "pass" }), ra({ "a.mjs": "pass", "b.mjs": "open" }), ["a.mjs"]);
  check("diff: another check going pass -> open is a regression", d2.regressed.length === 1 && d2.regressed[0].script === "b.mjs");
  const d3 = diffRunAll(ra({ "a.mjs": "open", "b.mjs": "pass" }), ra({ "a.mjs": "pass", "b.mjs": "error" }), ["a.mjs"]);
  check("diff: a passing check that now errors is a regression", d3.regressed.some((x) => x.script === "b.mjs" && x.now === "error"));
  const d4 = diffRunAll(ra({ "a.mjs": "open", "b.mjs": "pass" }), ra({ "a.mjs": "pass" }), ["a.mjs"]);
  check("diff: a deleted passing check is a regression", d4.regressed.some((x) => x.script === "b.mjs" && x.now === "missing"));
  const d5 = diffRunAll(ra({ "a.mjs": "open" }), ra({ "a.mjs": "open" }), ["a.mjs"]);
  check("diff: unchanged failing target is not fixed", !d5.targetFixed && !d5.regressed.length);
  const d6 = diffRunAll(ra({ "a.mjs": "pass" }), ra({ "a.mjs": "pass" }), ["a.mjs"]);
  check("diff: a target that already passed is not 'fixed'", !d6.targetFixed);
  const d7 = diffRunAll(ra({ "a.mjs": "open", "s.mjs": "error" }), ra({ "a.mjs": "pass", "s.mjs": "open" }), ["a.mjs"]);
  check("diff: a check that could not judge before (exit 2) and FAILS now is newlyFailing and breaks the fix, though not a regression", d7.newlyFailing.length === 1 && d7.newlyFailing[0].script === "s.mjs" && d7.newlyFailing[0].was === "error" && !d7.regressed.length && d7.broken.some((x) => x.script === "s.mjs"), JSON.stringify(d7));
  const d8 = diffRunAll(ra({ "a.mjs": "open" }), ra({ "a.mjs": "pass", "n.mjs": "open" }), ["a.mjs"]);
  check("diff: a check missing before that FAILS now is newlyFailing", d8.newlyFailing.some((x) => x.script === "n.mjs" && x.was === "missing") && d8.broken.length === 1, JSON.stringify(d8));
  const d9 = diffRunAll(ra({ "b.mjs": "pass", "e.mjs": "error" }), ra({ "b.mjs": "open", "e.mjs": "error" }), []);
  check("diff: pass -> FAIL is in regressed and newlyFailing, counted once in broken; error -> error is neither", d9.regressed.length === 1 && d9.newlyFailing.length === 1 && d9.broken.length === 1 && !d9.newlyFailing.some((x) => x.script === "e.mjs"), JSON.stringify(d9));
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-diffcli-"));
  w(path.join(t, "b.json"), JSON.stringify(ra({ "a.mjs": "pass", "s.mjs": "error" })));
  w(path.join(t, "a.json"), JSON.stringify(ra({ "a.mjs": "pass", "s.mjs": "open" })));
  const cli = spawnSync(node, [path.join(dir, "run-all-diff.mjs"), "diff", path.join(t, "b.json"), path.join(t, "a.json")], { encoding: "utf8", timeout: 60_000 });
  w(path.join(t, "c.json"), JSON.stringify(ra({ "a.mjs": "pass", "s.mjs": "error" })));
  const cli0 = spawnSync(node, [path.join(dir, "run-all-diff.mjs"), "diff", path.join(t, "b.json"), path.join(t, "c.json")], { encoding: "utf8", timeout: 60_000 });
  fs.rmSync(t, { recursive: true, force: true });
  check("diff CLI: cannot judge -> FAIL exits 1 and says NEWLY FAILING; nothing moved exits 0", cli.status === 1 && /NEWLY FAILING s\.mjs \(error -> FAIL/.test(cli.stdout) && cli0.status === 0, `exit ${cli.status} ${cli.stdout}${cli.stderr} / exit ${cli0.status}`);
}

function scenarioA(dir) {
  const fx = makeFixture("A", {});
  const decisions = path.join(fx.tmp, "DEFAULTS.md"); w(decisions, "# Binding defaults\n\nDEF-07: listings come from the client's own feed, never a third-party schema.\n");
  const run = runRefactor(fx, dir, ["--parallel", "1", "--timeout-min", "0.1", "--decisions", decisions]);
  const rep = run.report;
  const V = (fid) => rep?.causes.find((c) => c.id === fx.cid(fid));
  check("A: report json written", !!rep, run.out.slice(-600));
  if (!rep) return fx;
  const promptKept = path.join(fx.site, ".pewp/refactor/2026-10-22/prompts", `${fx.cid("s01-01")}.md`);
  const promptText = fs.existsSync(promptKept) ? fs.readFileSync(promptKept, "utf8") : "";
  check("A: every worker is told to read the binding decisions file and to answer NEEDS-PEOPLE for a held area; the prompt is kept with the run", promptText.includes(decisions.replace(/\\/g, "/")) && /held areas/.test(promptText) && /NEEDS-PEOPLE\.txt/.test(promptText.split("Binding project decisions")[1] || "") && !/\{\{DECISIONS\}\}/.test(promptText) && rep.decisionFiles?.length === 1 && /Binding decisions every worker was told to read: .*DEFAULTS\.md/.test(run.md), promptText.slice(0, 300) + JSON.stringify(rep.decisionFiles));
  check("A: good fix is FIXED with its check FAIL -> PASS and a commit", V("s01-01")?.verdict === "FIXED" && V("s01-01").checks[0].before === "open" && V("s01-01").checks[0].after === "pass" && !!V("s01-01").commit, JSON.stringify(V("s01-01")));
  check("A: a fix that breaks another check is REGRESSED (even though its own check passes)", V("s01-02")?.verdict === "REGRESSED" && V("s01-02").regressed.some((x) => x.script === "check-s01-06.mjs") && !V("s01-02").commit, JSON.stringify(V("s01-02")));
  check("A: an edit of built output without the generator is NOT FIXED after the rebuild", V("s01-03")?.verdict === "NOT FIXED" && /still fail after rebuild/.test(V("s01-03").reason), JSON.stringify(V("s01-03")));
  check("A: needs-people cause is skipped and its worker never started", V("s01-04")?.verdict === "SKIPPED-NEEDS-PEOPLE" && !run.logLines.some((l) => l.fid === "s01-04"), JSON.stringify(V("s01-04")));
  check("A: cause without a check is SKIPPED-NO-CHECK", V("s01-05")?.verdict === "SKIPPED-NO-CHECK");
  check("A: causes whose checks already pass are SKIPPED-ALREADY-PASSING", V("s01-06")?.verdict === "SKIPPED-ALREADY-PASSING" && V("s01-07")?.verdict === "SKIPPED-ALREADY-PASSING");
  check("A: a worker that edits main is REFUSED even though its own fix is right", V("s01-08")?.verdict === "NOT FIXED" && !!V("s01-08").refused && /main checkout/.test(V("s01-08").refused) && !V("s01-08").commit, JSON.stringify(V("s01-08")));
  check("A: the edit of main is reported and the run exits 1 (UNSAFE)", rep.mainTouched.some((x) => /gen\.mjs/.test(x)) && run.r.status === 1 && /UNSAFE/.test(run.out) && /STOP/.test(run.md.split("\n").slice(0, 4).join("\n")), `exit ${run.r.status} ${rep.mainTouched}`);
  check("A: a worker that edits a check script is REFUSED (hidden regression not accepted)", V("s01-09")?.verdict === "NOT FIXED" && /check scripts/.test(V("s01-09").refused || ""), JSON.stringify(V("s01-09")));
  check("A: a worker's NEEDS-PEOPLE.txt makes it SKIPPED-NEEDS-PEOPLE", V("s01-10")?.verdict === "SKIPPED-NEEDS-PEOPLE" && /Open Graph/.test(V("s01-10").reason), JSON.stringify(V("s01-10")));
  check("A: a hung worker is killed at the timeout: NOT FIXED", V("s01-11")?.verdict === "NOT FIXED" && /timed out/.test(V("s01-11").reason), JSON.stringify(V("s01-11")));
  check("A: a worker that tries to push gets a failure, and the remote stays empty", (() => { const p = run.logLines.find((l) => l.ev === "push"); return p && p.code !== 0 && git(fx.remote, "for-each-ref").stdout.trim() === ""; })(), JSON.stringify(run.logLines.find((l) => l.ev === "push")) + git(fx.remote, "for-each-ref").stdout);
  check("A: worker environment has no deploy/publish tokens but keeps the model key", run.logLines.filter((l) => l.ev === "start").length > 0 && run.logLines.filter((l) => l.ev === "start").every((l) => !l.cf && !l.gh && l.keepsAnthropic && Number(l.cfgCount) > 0), JSON.stringify(run.logLines[0]));
  check("A: the pushing worker's fix is still FIXED", V("s01-12")?.verdict === "FIXED");
  check("A: main branch never moved", run.mainBefore === run.mainAfter);
  const log = git(fx.top, "log", "--oneline", "--merges", "main..pewp/refactor-2026-10-22").stdout;
  check("A: the new branch holds exactly the two proven fixes (merges), nothing else", (log.match(/refactor C\d+/g) || []).length === 2 && !/C0[2-9]|C1[01]/.test(log) && (git(fx.top, "show", "pewp/refactor-2026-10-22:site/gen.mjs").stdout.match(/\blang: true/g) || []).length === 1 && /hreflang: true/.test(git(fx.top, "show", "pewp/refactor-2026-10-22:site/gen.mjs").stdout) && !/desc: true/.test(git(fx.top, "show", "pewp/refactor-2026-10-22:site/gen.mjs").stdout) && !/robots: true/.test(git(fx.top, "show", "pewp/refactor-2026-10-22:site/gen.mjs").stdout), log);
  check("A: no other pewp branches or worktrees are left behind", git(fx.top, "branch", "--list", "pewp/*").stdout.trim().split("\n").length === 1 && git(fx.top, "worktree", "list").stdout.trim().split("\n").length === 2, git(fx.top, "branch", "--list").stdout + git(fx.top, "worktree", "list").stdout);
  check("A: combined branch: more checks pass than at baseline, none regressed", rep.integrationRegressions.length === 0 && Number(/^(\d+)\//.exec(rep.final)?.[1]) > Number(/^(\d+)\//.exec(rep.baseline)?.[1]), `${rep.baseline} -> ${rep.final}`);
  const patchOf = (fid) => path.join(fx.site, ".pewp/refactor/2026-10-22", `${fx.cid(fid)}.patch`);
  check("A: a patch of every worker's changes is saved as <run>/<cause>.patch (failed attempts and fixed ones)", [ "s01-02", "s01-03", "s01-01", "s01-12" ].every((fid) => fs.existsSync(patchOf(fid)) && fs.statSync(patchOf(fid)).size > 0) && V("s01-02").patch === `.pewp/refactor/2026-10-22/${fx.cid("s01-02")}.patch`);
  check("A: report .md explains terms and says nothing was merged", /root cause/.test(run.md) && /Nothing has been merged|Nothing has been merged\./.test(run.md) && /FIXED/.test(run.md));
  check("A: state.json records the refactor stage", fs.existsSync(path.join(fx.site, ".pewp/state.json")) && !!JSON.parse(fs.readFileSync(path.join(fx.site, ".pewp/state.json"), "utf8")).stages.refactor);
  return fx;
}

function scenarioB(dir) {
  const behaviors = { "s01-01": "good-slow", "s01-03": "good-slow", "s01-12": "conflictlang" };
  const fx = makeFixture("B", behaviors);
  const ids = ["s01-01", "s01-03", "s01-12"].map(fx.cid);
  const run = runRefactor(fx, dir, ["--parallel", "2", "--timeout-min", "1", "--causes", ids.join(",")]);
  const rep = run.report;
  check("B: report json written", !!rep, run.out.slice(-600));
  if (!rep) return fx;
  const V = (fid) => rep.causes.find((c) => c.id === fx.cid(fid));
  const ev = run.logLines.filter((l) => l.ev === "start" || l.ev === "end").sort((a, b) => a.t - b.t);
  let cur = 0, max = 0;
  for (const e of ev) { cur += e.ev === "start" ? 1 : -1; max = Math.max(max, cur); }
  check("B: workers run in parallel up to the cap and never above it", max === 2, `max concurrent ${max}`);
  check("B: --causes limits the run to the three causes", rep.causes.length === 3);
  check("B: two good fixes are FIXED", V("s01-01")?.verdict === "FIXED" && V("s01-03")?.verdict === "FIXED", JSON.stringify(rep.causes.map((c) => [c.id, c.verdict])));
  check("B: a proven fix that conflicts with an earlier one is downgraded, not merged", V("s01-12")?.verdict === "NOT FIXED" && /conflict/.test(V("s01-12").reason) && !V("s01-12").commit, JSON.stringify(V("s01-12")));
  check("B: clean run exits 0 and the summary line leads with the counts", run.r.status === 0 && /2 of 3 root causes fixed/.test(run.md) && /DONE/.test(run.out), `exit ${run.r.status}\n${run.md.slice(0, 300)}`);
  check("B: main untouched", run.mainBefore === run.mainAfter && rep.mainTouched.length === 0 && git(fx.top, "status", "--porcelain").stdout.trim() === "");
  return fx;
}

// C: the repository's pre-commit hook refuses the commit -> nothing may be lost (patch + kept worktree + branch), hook never skipped
function scenarioC(dir) {
  const fx = makeFixture("C", { "s01-01": "good" });
  const hook = path.join(fx.top, ".git/hooks/pre-commit");
  w(hook, "#!/bin/sh\necho 'icm-index: updated (961 files)'\necho 'pre-commit: ICM structure check failed. Run: node tools/icm-check.mjs' >&2\nexit 1\n");
  try { fs.chmodSync(hook, 0o755); } catch {}
  const id = fx.cid("s01-01");
  const run = runRefactor(fx, dir, ["--parallel", "1", "--causes", id, "--timeout-min", "1"]);
  const rep = run.report;
  const r = rep?.causes.find((c) => c.id === id);
  check("C: a refused commit gives verdict NOT COMMITTED (not NOT FIXED) with the hook's full message", r?.verdict === "NOT COMMITTED" && /ICM structure check failed/.test(r.hookMessage || "") && /icm-index: updated \(961 files\)/.test(r.hookMessage || ""), JSON.stringify(r) + run.out.slice(-400));
  const patch = path.join(fx.site, ".pewp/refactor/2026-10-22", `${id}.patch`);
  check("C: the patch of the worker's changes is saved and applies to the repository", fs.existsSync(patch) && fs.statSync(patch).size > 0 && git(fx.top, "apply", "--check", patch).status === 0 && r?.patch === `.pewp/refactor/2026-10-22/${id}.patch`, git(fx.top, "apply", "--check", patch).stderr);
  const wt = path.join(fx.tmp, "wt", id);
  check("C: its worktree and branch are KEPT, with the work staged", fs.existsSync(wt) && git(fx.top, "branch", "--list", `pewp/refactor-2026-10-22-${id}`).stdout.includes(id) && /gen\.mjs/.test(git(wt, "diff", "--cached", "--name-only").stdout), git(fx.top, "worktree", "list").stdout);
  check("C: the report names the worktree, branch, patch and hook message; the run is not UNSAFE (exit 0)", run.r.status === 0 && /Proven, but not committed/.test(run.md) && run.md.includes(id) && /ICM structure check failed/.test(run.md) && /git apply/.test(run.md) && !/STOP/.test(run.md.split("\n").slice(0, 4).join("\n")) && /NOT COMMITTED/.test(run.out), `exit ${run.r.status}\n${run.md.slice(0, 500)}`);
  check("C: hooks are never skipped (the script has no --no-verify and no hook override)", !/--no-verify|core\.hooksPath|-n["']/.test(fs.readFileSync(path.join(dir, "refactor.mjs"), "utf8")));
  check("C: main untouched", run.mainBefore === run.mainAfter && git(fx.top, "status", "--porcelain").stdout.trim() === "");
  return fx;
}

// D: scope of the safety fingerprint and the start rule
function scenarioD(dir) {
  const out = [];
  // D1 uncommitted change UNDER the site root: refuse to start
  const f1 = makeFixture("D1", {});
  fs.appendFileSync(path.join(f1.site, "gen.mjs"), "// uncommitted edit\n");
  const r1 = runRefactor(f1, dir, ["--causes", f1.cid("s01-01")]);
  check("D: uncommitted changes under the site root: refuse to start, exit 2, no worktree made", r1.r.status === 2 && /refusing to start/.test(r1.out) && /gen\.mjs/.test(r1.out) && !fs.existsSync(path.join(f1.tmp, "wt")) && !r1.report, `exit ${r1.r.status} ${r1.out.slice(0, 300)}`);
  out.push(f1);
  // D2 changes ELSEWHERE in the repo (before and during the run) and a commit outside the site: notes, not UNSAFE
  const f2 = makeFixture("D2", { "s01-01": "touchoutside", "s01-12": "commitoutside" });
  fs.appendFileSync(path.join(f2.top, "README.md"), "dirty before the run\n");
  const r2 = runRefactor(f2, dir, ["--parallel", "1", "--causes", [f2.cid("s01-01"), f2.cid("s01-12")].join(",")]);
  const rep2 = r2.report;
  const V2 = (fid) => rep2?.causes.find((c) => c.id === f2.cid(fid));
  check("D: edits and a commit elsewhere in the repo do not make the run UNSAFE; both fixes stay FIXED", rep2 && r2.r.status === 0 && V2("s01-01")?.verdict === "FIXED" && V2("s01-12")?.verdict === "FIXED" && rep2.mainTouched.length === 0 && !/STOP/.test(r2.md.split("\n").slice(0, 4).join("\n")), `exit ${r2.r.status} ${JSON.stringify(rep2?.causes.map((c) => [c.id, c.verdict, c.reason]))}\n${r2.out.slice(-300)}`);
  check("D: those changes are reported as notes (the file, and that the base branch moved and nothing was rebased)", rep2 && rep2.notes.some((x) => /README\.md/.test(x)) && rep2.notes.some((x) => /base branch main moved/.test(x) && /nothing was rebased/.test(x)) && rep2.baseMoved === true && /not counted against the run/.test(r2.md) && /nothing was rebased/.test(r2.md), JSON.stringify(rep2?.notes));
  check("D: uncommitted changes elsewhere at the start are a note on the console, not a refusal", /NOTE: 1 uncommitted path\(s\) elsewhere/.test(r2.out) && /README\.md/.test(r2.out), r2.out.slice(0, 400));
  out.push(f2);
  // D3 a worker COMMITS a change to the site on the base branch: that is a change under the site root -> refused, UNSAFE
  const f3 = makeFixture("D3", { "s01-08": "commitsite" });
  const r3 = runRefactor(f3, dir, ["--parallel", "1", "--causes", f3.cid("s01-08")]);
  const V3 = r3.report?.causes[0];
  check("D: a commit to the site on the base branch is caught (the status stays clean, only the branch tip moves): refused, UNSAFE", r3.r.status === 1 && V3?.verdict === "NOT FIXED" && !!V3.refused && r3.report.mainTouched.some((x) => /committed site\/gen\.mjs on main/.test(x)), `exit ${r3.r.status} ${JSON.stringify(V3)} ${r3.report?.mainTouched}`);
  out.push(f3);
  return out;
}

// E: the cost stop (--max-workers, default 12, most severe first; over the cap with --causes dies unless --yes)
function scenarioE(dir) {
  const fx = makeFixture("E", {});
  const runnable = ["s01-01", "s01-02", "s01-03", "s01-06", "s01-07", "s01-08", "s01-09", "s01-10", "s01-11", "s01-12"].map(fx.cid);
  const e1 = runRefactor(fx, dir, ["--max-workers", "3", "--parallel", "3", "--timeout-min", "1"]);
  const sev = Object.fromEntries(fx.causes.map((c) => [c.id, c.severity]));
  const picked = e1.report?.causes.map((c) => c.id) || [];
  const passing = ["s01-06", "s01-07"].map(fx.cid); // their checks already pass on the last commit
  const pickedFailing = picked.filter((id) => runnable.includes(id) && !passing.includes(id));
  check("E: over the cap without --causes: the most severe go first, the rest are deferred and named", e1.r.status !== 2 && pickedFailing.length === 3 && picked.includes(fx.cid("s01-01")) && picked.includes(fx.cid("s01-02")) && pickedFailing.every((id) => sev[id] !== "low") && /cost stop: 8 causes still fail their checks at the baseline; this run takes the 3 most severe/.test(e1.out) && /deferred to the next run: C\d+/.test(e1.out) && e1.report?.deferred?.length === 5, `${e1.out.slice(0, 500)} picked ${picked}`);
  check("E: a cause whose checks already pass at the baseline takes no slot: it is SKIPPED-ALREADY-PASSING, never deferred, and not counted by the cost stop", passing.every((id) => e1.report?.causes.find((c) => c.id === id)?.verdict === "SKIPPED-ALREADY-PASSING" && !e1.report.deferred.includes(id)) && !/cost stop: 10 causes/.test(e1.out), JSON.stringify([e1.report?.deferred, passing.map((id) => e1.report?.causes.find((c) => c.id === id)?.verdict)]));
  const f2 = makeFixture("E2", {});
  const e2 = runRefactor(f2, dir, ["--max-workers", "3", "--causes", runnable.slice(0, 5).join(",")]);
  check("E: --causes over the cap dies (exit 2) naming the cost stop, before any worktree exists", e2.r.status === 2 && /cost stop of 3/.test(e2.out) && /--yes/.test(e2.out) && !fs.existsSync(path.join(f2.tmp, "wt")), `exit ${e2.r.status} ${e2.out.slice(0, 300)}`);
  const f3 = makeFixture("E3", {});
  const four = ["s01-01", "s01-03", "s01-06", "s01-07"].map(f3.cid);
  const e3 = runRefactor(f3, dir, ["--max-workers", "3", "--causes", four.join(","), "--yes", "--parallel", "2", "--timeout-min", "1"]);
  check("E: --yes lets a run over the cap go ahead", e3.r.status === 0 && e3.report?.causes.length === 4, `exit ${e3.r.status} ${e3.out.slice(0, 300)}`);
  const d = runRefactor(f3, dir, ["--dry"]);
  check("E: the default cap is 12 (10 runnable causes are not stopped)", d.r.status === 0 && !/cost stop/.test(d.out) && /10 would get a fix worker/.test(d.out), d.out.slice(0, 400));
  return [fx, f2, f3];
}

// F: rebuild stability (IDX-003 / SE-004 / AEO-012). The real incident (2026-10-22): a fix for "the build writes no sitemap" stamped
// `new Date()` into every <lastmod>; it passed its own check and nothing judged the rules governing the new artefact.
const smCode = (paths, lm) => String.raw`
const __sm = ${JSON.stringify(paths)};
fs.writeFileSync(path.join(here, "dist", "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + __sm.map((p) => "  <url><loc>https://f.example/" + p + "</loc><lastmod>" + (${lm}) + "</lastmod></url>").join("\n") + "\n</urlset>\n");
`;
const SITEMAP_FINDING = { fid: "s01-13", rule: "IDX-004", sev: "high", prob: "the build writes no `sitemap.xml`", fix: "write dist/sitemap.xml in gen.mjs", src: `import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] || ".");
if (!fs.existsSync(path.join(root, "dist", "index.html"))) { console.log("ERROR s01-13 cannot judge: dist missing"); process.exit(2); }
if (!fs.existsSync(path.join(root, "dist", "sitemap.xml"))) { console.log("FAIL s01-13 the build writes no sitemap.xml"); process.exit(1); }
console.log("PASS s01-13");
` };
const CLOCK = "new Date().toISOString()";
const LEDGER_LM = 'JSON.parse(fs.readFileSync(path.join(here, "ledger.json"), "utf8"))[p]';
const BUILTIN = "check-builtin-se004-idx003-sitemap-lastmod.mjs";
function scenarioF(dir) {
  const out = [];
  const one = (label, behavior, extraArgs = [], opts = {}) => {
    const fx = makeFixture(label, behavior ? { "s01-13": behavior } : {}, { extra: [SITEMAP_FINDING], ...opts });
    const id = fx.cid(opts.cause || "s01-13");
    const r = runRefactor(fx, dir, ["--parallel", "1", "--timeout-min", "1", "--causes", id, ...extraArgs]);
    out.push(fx);
    return { fx, r, V: r.report?.causes.find((c) => c.id === id) };
  };
  const f1 = one("F1", { b: "append", append: smCode(["", "about/"], CLOCK) });
  check("F: a fix that adds a sitemap whose lastmod is the build clock is REJECTED at the merge with the IDX-003 reason", f1.V?.verdict === "NOT FIXED" && /stamps the build time into sitemap <lastmod> on 2 pages \(IDX-003\/AEO-012\)/.test(f1.V.reason) && /content dates/.test(f1.V.reason) && f1.r.report.branch === null && f1.r.report.stability.rejected.length === 1, `exit ${f1.r.r.status} ${JSON.stringify(f1.V)}\n${f1.r.out.slice(-600)}`);
  check("F: the run summary line carries the stability word (stability: PASS|FAIL|NOT CHECKED)", /^REFACTOR DONE: .*; stability: PASS; report/m.test(f1.r.out) && f1.r.report.stability.status === "PASS", f1.r.out.slice(-300));
  const f2 = one("F2", { b: "append", append: smCode(["", "about/"], LEDGER_LM), files: { "ledger.json": JSON.stringify({ "": "2026-03-01T10:00:00Z", "about/": "2026-04-02T11:30:00Z" }) } });
  check("F: a fix that adds a sitemap whose lastmod comes from a committed ledger is FIXED and merged; stability PASS", f2.V?.verdict === "FIXED" && !!f2.r.report.branch && /2026-04-02T11:30:00Z/.test(git(f2.fx.top, "show", `${f2.r.report.branch}:site/dist/sitemap.xml`).stdout) && /stability: PASS/.test(f2.r.out) && f2.r.r.status === 0, `exit ${f2.r.r.status} ${JSON.stringify(f2.V)}\n${f2.r.out.slice(-600)}`);
  const f3 = one("F3", { b: "append", append: smCode(["", "about/", "a/", "b/", "c/", "d/"], CLOCK) });
  check("F: a clock-stamped 6-URL sitemap turns the built-in check from cannot-judge to FAIL: REGRESSED (newly failing) before any merge", f3.V?.verdict === "REGRESSED" && /could not judge before/.test(f3.V.reason) && f3.V.reason.includes(BUILTIN) && f3.V.newlyFailing.some((x) => x.script === BUILTIN && x.was === "error" && x.now === "open") && !f3.V.regressed.length, JSON.stringify(f3.V));
  const f4 = one("F4", { b: "append", append: smCode(["", "about/"], CLOCK) }, ["--no-stability"]);
  check("F: --no-stability skips the check and says NOT CHECKED (the clock-stamped fix then goes through)", f4.V?.verdict === "FIXED" && /stability: NOT CHECKED/.test(f4.r.out) && /Rebuild stability .*NOT CHECKED \(--no-stability/.test(f4.r.md) && f4.r.report.stability.status === "NOT CHECKED", `${JSON.stringify(f4.V)}\n${f4.r.out.slice(-400)}`);
  const f5 = one("F5", null, [], { genTail: smCode(["", "about/"], CLOCK), cause: "s01-01" });
  check("F: a defect already there at the baseline is a pre-existing finding, not a regression: an unrelated fix is merged, stability FAIL (pre-existing)", f5.V?.verdict === "FIXED" && !!f5.r.report.branch && f5.r.r.status === 0 && /stability \(baseline\): FAIL \(pre-existing/.test(f5.r.out) && /stability: FAIL \(pre-existing\)/.test(f5.r.out) && /PRE-EXISTING finding on the untouched code/.test(f5.r.md) && f5.r.report.stability.preExisting.length === 2, `exit ${f5.r.r.status} ${JSON.stringify(f5.V)}\n${f5.r.out.slice(-600)}`);
  return out;
}

// ---------------- build-mode driver ----------------
// Stand-ins that follow the CLI of the real stage scripts: intake <target> (reads .pewp/intake-answers.json, exit 3 with questions in
// intake-facts.json), research <target>, plan-site <pewp dir>, gate <pewp dir> <site dir>. A wrong argument shape exits 2.
const FAKE_STAGE_SRC = String.raw`import fs from "node:fs";
import path from "node:path";
const name = __NAME__;
const a = process.argv.slice(2);
const w = (base, rel, s) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), s); };
const bad = (m) => { console.error("fake " + name + ": bad arguments: " + m); process.exit(2); };
let pewp;
if (name === "plan-site" || name === "gate") { if (path.basename(a[0] || "") !== ".pewp") bad("first argument must be the .pewp dir, got " + a[0]); pewp = path.resolve(a[0]); }
else { if (!a[0] || path.basename(a[0]) === ".pewp") bad("first argument must be the target folder, got " + a[0]); pewp = path.join(path.resolve(a[0]), ".pewp"); }
if (name === "gate" && !a[1]) bad("gate needs the site dir as 2nd argument");
fs.appendFileSync(path.join(pewp, "stage-calls.log"), name + " " + a.slice(1).map((x) => path.basename(x)).join(" ") + "\n");
if (name === "intake") {
  const ans = fs.existsSync(path.join(pewp, "intake-answers.json")) ? JSON.parse(fs.readFileSync(path.join(pewp, "intake-answers.json"), "utf8")) : {};
  if (!ans["market.country"]) {
    w(pewp, "intake-facts.json", JSON.stringify({ questions: [{ id: "q1", field: "market.country", header: "Country", question: "Which country do the searchers live in?", options: [{ label: "US", description: "United States", value: "US" }, { label: "CA", description: "Canada", value: "CA" }], recommended: 0, freeText: true }] }));
    console.log("QUESTIONS 1"); console.log("BLOCKED: 1 answers missing."); process.exit(3);
  }
  w(pewp, "business.json", JSON.stringify({ name: "Fixture Realty", domain: "fixture.example", market: { country: ans["market.country"], language: "en" }, launchState: "planned", brand: { constraints: ["no stock photos"] }, industry: "real-estate" }));
} else if (name === "research") {
  if (!fs.existsSync(path.join(pewp, "business.json"))) { console.log("BLOCKED: no intake yet"); process.exit(3); }
  w(pewp, "targets.json", JSON.stringify({ version: 1, clusters: [{ id: "c-homes", primaryQuery: "homes for sale springfield" }] }));
  w(pewp, "research/report.md", "# research\n");
} else if (name === "plan-site") {
  w(pewp, "plan/sitemap.json", JSON.stringify({ pages: [{ path: "/homes-for-sale-springfield/", slug: "homes-for-sale-springfield", primaryQuery: "homes for sale springfield", title: "Homes for Sale in Springfield", h1: "Springfield Homes for Sale", schema: ["RealEstateAgent", "FAQPage"], brief: "plan/briefs/homes-for-sale-springfield.md" }] }));
  w(pewp, "plan/briefs/homes-for-sale-springfield.md", "# Brief: /homes-for-sale-springfield/\n\n- Primary query: homes for sale springfield\n");
} else if (name === "gate") {
  if (process.env.FAKE_GATE_FAIL) { console.log("FAIL GT-003 cannibalisation on c-homes"); process.exit(1); }
  console.log("PASS GT-001 targets");
}
`;
const STAGE_FAKE = (name) => FAKE_STAGE_SRC.replace("__NAME__", JSON.stringify(name));
function makeBuildFixture(label, { without = [] } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pewp-build-${label}-`));
  const target = path.join(tmp, "newsite");
  fs.mkdirSync(target, { recursive: true });
  const stubs = path.join(tmp, "stage-scripts");
  for (const n of ["intake", "research", "plan-site", "gate"]) if (!without.includes(n)) w(path.join(stubs, `${n}.mjs`), STAGE_FAKE(n));
  w(path.join(tmp, "brief.txt"), "We are Fixture Realty, an agent selling homes in Springfield.\n");
  return { tmp, target, stubs, brief: path.join(tmp, "brief.txt") };
}
const runBuild = (dir, fx, args, env = {}) => {
  const r = spawnSync(node, [path.join(dir, "build-site.mjs"), fx.target, "--stage-scripts", fx.stubs, ...args], { encoding: "utf8", timeout: 120_000, env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

function scenarioBuild(dir) {
  const fx = makeBuildFixture("main");
  const pewp = path.join(fx.target, ".pewp");
  const calls = () => (fs.existsSync(path.join(pewp, "stage-calls.log")) ? fs.readFileSync(path.join(pewp, "stage-calls.log"), "utf8") : "");
  const p0 = runBuild(dir, fx, ["--brief", fx.brief]);
  check("build: without --go it prints the plan (stages, nothing external) and runs nothing", p0.code === 0 && /PLAN/.test(p0.out) && /intake/.test(p0.out) && /research/.test(p0.out) && /free/i.test(p0.out) && calls() === "", p0.out);
  const s1 = runBuild(dir, fx, ["--go", "--brief", fx.brief]);
  check("build: stops at the missing intake answers with the exact question list, exit 3", s1.code === 3 && /NEEDS-INPUT/.test(s1.out) && /Which country do the searchers live in/.test(s1.out) && /US \(United States\) \[recommended\]/.test(s1.out) && /intake-answers\.json/.test(s1.out) && /market\.country/.test(s1.out), s1.out);
  check("build: nothing after the missing input ran", !/research|plan-site/.test(calls()) && !fs.existsSync(path.join(pewp, "targets.json")));
  const st1 = readJson(path.join(pewp, "state.json"));
  check("build: state.json says intake is waiting for input, mode build", st1?.mode === "build" && st1.build?.status === "needs-input" && st1.build?.stage === "intake", JSON.stringify(st1));
  w(path.join(pewp, "intake-answers.json"), JSON.stringify({ "market.country": "US" }));
  const s2 = runBuild(dir, fx, ["--go", "--brief", fx.brief]);
  const hand = path.join(pewp, "builder", "HANDOFF.md");
  const handText = fs.existsSync(hand) ? fs.readFileSync(hand, "utf8") : "";
  check("build: with the answers it runs intake -> research -> plan -> handoff in order and waits for the builder (exit 0)", s2.code === 0 && /WAITING-FOR-BUILDER/.test(s2.out) && calls().split("\n").filter(Boolean).map((l) => l.split(" ")[0]).join(",") === "intake,intake,research,plan-site", `${s2.out}\n${calls()}`);
  check("build: each stage gets its own command line (target folder / pewp dir / pewp + site dir) and the brief is kept", /^plan-site\s*$/m.test(calls()) && !/--brief|--answers/.test(calls()) && fs.existsSync(path.join(pewp, "brief.txt")), calls());
  check("build: HANDOFF.md carries the page brief, query, schema type, brand constraint, and the gate command", /\/homes-for-sale-springfield\//.test(handText) && /homes for sale springfield/.test(handText) && /Springfield Homes for Sale/.test(handText) && /RealEstateAgent, FAQPage/.test(handText) && /no stock photos/.test(handText) && /gate/i.test(handText) && /--builder-done/.test(handText), handText.slice(0, 800));
  check("build: the builder prompt file exists and points at the handoff", fs.existsSync(path.join(pewp, "builder", "builder-prompt.md")) && /HANDOFF\.md/.test(fs.readFileSync(path.join(pewp, "builder", "builder-prompt.md"), "utf8")));
  const callsBefore = calls();
  const s3 = runBuild(dir, fx, ["--go"]);
  check("build: re-running changes nothing already done (resumes at the builder wait)", s3.code === 0 && /WAITING-FOR-BUILDER/.test(s3.out) && calls() === callsBefore, s3.out);
  const g1 = runBuild(dir, fx, ["--go", "--builder-done"], { FAKE_GATE_FAIL: "1" });
  check("build: a failing gate stops the run (exit 1) and never reaches measure", g1.code === 1 && /GATE-FAILED/.test(g1.out) && !/measure/i.test(g1.out.split("GATE-FAILED").pop()) && readJson(path.join(pewp, "state.json")).build.status === "gate-failed", g1.out);
  const g2 = runBuild(dir, fx, ["--go", "--builder-done"]);
  check("build: a passing gate then reports measure BLOCKED with what unblocks it", g2.code === 0 && /PASS gate|gate: PASS/i.test(g2.out) && /measure/i.test(g2.out) && /BLOCKED/.test(g2.out) && /Search Console/.test(g2.out), g2.out);
  // stale input: business.json newer than targets.json
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(pewp, "business.json"), later, later);
  const s4 = runBuild(dir, fx, ["--go"]);
  check("build: a stage whose input changed after it ran is re-run", /research/.test(s4.out) && /stale/i.test(s4.out) && calls().split("\n").filter((l) => l.startsWith("research")).length === 2, s4.out + calls());

  const fm = makeBuildFixture("missing", { without: ["plan-site"] });
  w(path.join(fm.target, ".pewp", "intake-answers.json"), JSON.stringify({ "market.country": "US" }));
  const m1 = runBuild(dir, fm, ["--go", "--brief", fm.brief]);
  check("build: a stage script that is not built yet is BLOCKED by name (exit 4), earlier stages kept", m1.code === 4 && /BLOCKED/.test(m1.out) && /plan-site\.mjs/.test(m1.out) && fs.existsSync(path.join(fm.target, ".pewp", "targets.json")), m1.out);
  return [fx, fm];
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "no rebuild before the check", file: "refactor.mjs", from: "const rebuilt = prepare(root);", to: "const rebuilt = { ok: true };", sc: "A", expect: [/^A: an edit of built output/] },
  { name: "regressions ignored", file: "refactor.mjs", from: "  if (d.broken.length) {\n    savePatch();", to: "  if (false) {\n    savePatch();", sc: "A", expect: [/^A: a fix that breaks another check/] },
  { name: "run-all-diff never reports a regression", file: "run-all-diff.mjs", from: 'if (was === "pass" && now !== "pass")', to: 'if (was === "pass" && now === "never")', sc: "units+A", expect: [/^diff: another check going pass/, /^A: a fix that breaks another check/] },
  { name: "edit of main not detected", file: "refactor.mjs", from: "  if (d.unsafe.length) {\n    for (const r of running)", to: "  if (false) {\n    for (const r of running)", sc: "A", expect: [/^A: a worker that edits main/] },
  { name: "edited check scripts not detected", file: "refactor.mjs", from: "if (checkHash(root) !== before) {", to: "if (false) {", sc: "A", expect: [/^A: a worker that edits a check script/] },
  { name: "needs-people causes are sent to a worker", file: "refactor.mjs", from: "else if (people) {", to: "else if (false) {", sc: "A", expect: [/^A: needs-people cause is skipped/] },
  { name: "already-passing causes are sent to a worker", file: "refactor.mjs", from: 'if ((c.scripts || []).length && (c.scripts || []).every((s) => baseMap.get(s) === "pass")) {', to: "if (false) {", sc: "A", expect: [/^A: causes whose checks already pass/] },
  { name: "no parallel cap", file: "refactor.mjs", from: "Math.min(parallel, queue.length)", to: "queue.length", sc: "B", expect: [/^B: workers run in parallel up to the cap/] },
  { name: "patch never saved", file: "refactor.mjs", from: "    if (!patch.trim()) return;\n    const p = path.join(outDir, runId, `${c.id}.patch`);", to: "    return;\n    const p = path.join(outDir, runId, `${c.id}.patch`);", sc: "C", expect: [/^C: the patch of the worker's changes is saved/] },
  { name: "worktree of an uncommitted fix is removed", file: "refactor.mjs", from: 'if (results.get(j.c.id).verdict === "NOT COMMITTED") continue;', to: "if (false) continue;", sc: "C", expect: [/^C: its worktree and branch are KEPT/] },
  { name: "refused commit reported as a plain NOT FIXED", file: "refactor.mjs", from: 'return done("NOT COMMITTED",', to: 'return done("NOT FIXED",', sc: "C", expect: [/^C: a refused commit gives verdict NOT COMMITTED/] },
  { name: "fingerprint scoped to the whole repo", file: "refactor.mjs", from: "(inSite(p) ? files : outside).set(", to: "files.set(", sc: "D", expect: [/^D: edits and a commit elsewhere/] },
  { name: "a commit outside the site counts as a site change", file: "refactor.mjs", from: "const siteNames = names.filter(inSite);", to: "const siteNames = names;", sc: "D", expect: [/^D: edits and a commit elsewhere/] },
  { name: "a commit to the site on the base branch not caught", file: "refactor.mjs", from: "for (const n of siteNames) unsafe.push(", to: "for (const n of []) unsafe.push(", sc: "D", expect: [/^D: a commit to the site on the base branch/] },
  { name: "start rule off", file: "refactor.mjs", from: "if (dirtyAtStart.length) die(", to: "if (false) die(", sc: "D", expect: [/^D: uncommitted changes under the site root/] },
  { name: "cost stop removed", file: "refactor.mjs", from: 'if (!only.length && stillFailing.length > maxWorkers && !A.includes("--yes")) {', to: "if (false) {", sc: "E", expect: [/^E: over the cap without --causes/] },
  { name: "cost stop: explicit --causes over the cap not refused", file: "refactor.mjs", from: 'if (only.length && runnableNow.length > maxWorkers && !A.includes("--yes")) die(', to: "if (false) die(", sc: "E", expect: [/^E: --causes over the cap dies/] },
  { name: "cost stop counts causes that already pass at the baseline", file: "refactor.mjs", from: 'const stillFailing = runnableNow.filter((c) => !c.scripts.every((s) => baseMap.get(s) === "pass"));', to: "const stillFailing = runnableNow;", sc: "E", expect: [/^E: a cause whose checks already pass at the baseline takes no slot/] },
  { name: "decisions file not given to the worker", file: "refactor.mjs", from: '.split("{{DECISIONS}}").join(decisionFiles.length', to: '.split("{{DECISIONS}}").join(false', sc: "A", expect: [/^A: every worker is told to read the binding decisions file/] },
  { name: "--yes ignored by the cost stop", file: "refactor.mjs", from: 'if (only.length && runnableNow.length > maxWorkers && !A.includes("--yes")) die(', to: "if (only.length && runnableNow.length > maxWorkers) die(", sc: "E", expect: [/^E: --yes lets a run over the cap/] },
  { name: "cost stop takes the least severe first", file: "refactor.mjs", from: "(sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) || (b.pages || 0)", to: "(sevRank[b.severity] ?? 9) - (sevRank[a.severity] ?? 9) || (b.pages || 0)", sc: "E", expect: [/^E: over the cap without --causes/] },
  { name: "push not blocked", file: "refactor.mjs", from: "env.GIT_CONFIG_COUNT = String(cfg.length);", to: 'env.GIT_CONFIG_COUNT = "0";', sc: "A", expect: [/^A: a worker that tries to push/, /^A: worker environment has no deploy/] },
  { name: "secrets not scrubbed", file: "refactor.mjs", from: "else if (!SECRET_RE.test(k)) env[k] = v;", to: "else env[k] = v;", sc: "A", expect: [/^A: worker environment has no deploy/] },
  { name: "a fix that does not survive the combined branch is kept", file: "refactor.mjs", from: "if (!(d.targetFixed && !d.broken.length && !undone.length)) why =", to: "if (false) why =", sc: "B", expect: [/^B: a proven fix that conflicts/] },
  { name: "worker timeout not applied", file: "refactor.mjs", from: "timedOut = true; killTree(child, sup.supervised);", to: "timedOut = false; killTree(child, sup.supervised);", sc: "A", expect: [/^A: a hung worker is killed/] },
  { name: "stability after a merge ignored", file: "refactor.mjs", from: "else if (fresh.length) {", to: "else if (false) {", sc: "F", expect: [/^F: a fix that adds a sitemap whose lastmod is the build clock is REJECTED/] },
  { name: "baseline stability failures counted as the fix's", file: "refactor.mjs", from: "newFailures(stability.baseline?.status === \"FAIL\" ? stability.baseline : null, s)", to: "newFailures(null, s)", sc: "F", expect: [/^F: a defect already there at the baseline/] },
  { name: "newly failing checks ignored by the per-cause proof", file: "refactor.mjs", from: "  if (d.broken.length) {\n    savePatch();", to: "  if (d.regressed.length) {\n    savePatch();", sc: "F", expect: [/^F: a clock-stamped 6-URL sitemap/] },
  { name: "--no-stability ignored", file: "refactor.mjs", from: 'const stabilityOn = !!buildCmd && !A.includes("--no-stability");', to: "const stabilityOn = !!buildCmd;", sc: "F", expect: [/^F: --no-stability skips the check/] },
  { name: "summary line without the stability word", file: "refactor.mjs", from: "; stability: ${stabilityWord}${", to: "; ${stabilityWord}${", sc: "F", expect: [/^F: the run summary line carries the stability word/] },
  { name: "run-all-diff: cannot judge -> FAIL not newly failing", file: "run-all-diff.mjs", from: 'if (now === "open" && was !== "open") newlyFailing.push(', to: "if (false) newlyFailing.push(", sc: "units+F", expect: [/^diff: a check that could not judge before/, /^diff CLI: cannot judge -> FAIL exits 1/, /^F: a clock-stamped 6-URL sitemap/] },
  { name: "run-all-diff CLI exit ignores newly failing", file: "run-all-diff.mjs", from: "process.exit(d.broken.length ? 1 : 0);", to: "process.exit(d.regressed.length ? 1 : 0);", sc: "units", expect: [/^diff CLI: cannot judge -> FAIL exits 1/] },
  { name: "build driver ignores missing input", file: "build-site.mjs", from: "if (res.code === 3) {", to: "if (res.code === 3 && false) {", sc: "build", expect: [/^build: stops at the missing intake answers/] },
  { name: "build driver continues after a failed gate", file: "build-site.mjs", from: "if (g.status !== 0) {", to: "if (false) {", sc: "build", expect: [/^build: a failing gate stops the run/] },
  { name: "handoff drops the briefs", file: "build-site.mjs", from: "const pageLines = ", to: "const pageLines = [] || ", sc: "build", expect: [/^build: HANDOFF\.md carries/] },
  { name: "build driver never re-runs stale stages", file: "build-site.mjs", from: "const stale = ", to: "const stale = () => false; const _unusedStale = ", sc: "build", expect: [/^build: a stage whose input changed/] },
  { name: "build driver runs without --go", file: "build-site.mjs", from: "if (!go) {", to: "if (false) {", sc: "build", expect: [/^build: without --go it prints the plan/] },
];

async function runScenarios(dir, which) {
  results = [];
  const keepers = [];
  if (which.includes("units")) await units(dir);
  if (which.includes("A")) keepers.push(scenarioA(dir));
  if (which.includes("B")) keepers.push(scenarioB(dir));
  if (which.includes("C")) keepers.push(scenarioC(dir));
  if (which.includes("D")) keepers.push(...scenarioD(dir));
  if (which.includes("E")) keepers.push(...scenarioE(dir));
  if (which.includes("F")) keepers.push(...scenarioF(dir));
  if (which.includes("build")) keepers.push(...scenarioBuild(dir));
  if (!keep) for (const k of keepers.flat()) fs.rmSync(k.tmp, { recursive: true, force: true, maxRetries: 5 });
  return results;
}

const wanted = onlyWhat ? [onlyWhat] : ["units", "A", "B", "C", "D", "E", "F", "build"];
const main = await runScenarios(scriptsDir, wanted);
for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
let failed = main.filter((r) => !r.ok).length;
console.log(failed ? `REFACTOR TEST FAIL: ${failed} of ${main.length}` : `REFACTOR TEST PASS: ${main.length} of ${main.length}`);

if (!failed && !A.includes("--no-mutants") && !onlyWhat) {
  console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
  let caught = 0;
  for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
    const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mutant-"));
    const sdir = path.join(mdir, "scripts");
    for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
    for (const f of ["fix-worker-prompt.md"]) if (fs.existsSync(path.join(scriptsDir, "..", f))) fs.copyFileSync(path.join(scriptsDir, "..", f), path.join(mdir, f));
    for (const d of ["stages", "checklist", "checks-builtin"]) if (fs.existsSync(path.join(scriptsDir, "..", d))) fs.cpSync(path.join(scriptsDir, "..", d), path.join(mdir, d), { recursive: true });
    const target = path.join(sdir, mu.file);
    const src = fs.readFileSync(target, "utf8");
    const count = src.split(mu.from).length - 1;
    if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
    fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
    const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 30_000 });
    if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
    const res = await runScenarios(sdir, mu.sc.split("+"));
    const red = res.filter((r) => !r.ok);
    const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
    const ok = red.length > 0 && !missing.length;
    if (ok) caught++; else failed++;
    console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
    fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(failed ? `MUTANTS FAIL: ${caught} of ${MUTANTS.length} caught` : `MUTANTS PASS: ${caught} of ${MUTANTS.length} caught`);
}
process.exit(failed ? 1 : 0);
