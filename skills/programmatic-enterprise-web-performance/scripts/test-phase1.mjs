// Usage: node test-phase1.mjs [--scripts <dir>]
// Phase 1 self-test on fixtures (no network, no real site): state layout, cache, snapshot reuse, Common Crawl authority
// and link gap on a tiny fake graph, the audit-live report (six questions in order, every number sourced, glossary
// once, preview noindex by design), the read-only guard, the doctor's shape, and the checklist builder (wrong path
// leaves it alone; a new pack and rule prefix are picked up). Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-p1-"));
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
const node = (script, a, opts = {}) => spawnSync(process.execPath, [path.join(dir, script), ...a], { encoding: "utf8", timeout: 120000, ...opts });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" || Buffer.isBuffer(s) ? s : JSON.stringify(s)); };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

try {
  // ---- state ----
  const st = await import(pathToFileURL(path.join(dir, "state.mjs")).href);
  const lu = st.locate("https://www.Example.com/a?b", { cwd: tmp });
  check("state: URL target lives in site-checks/<host>/.pewp", lu.pewp === path.join(tmp, "site-checks", "example.com", ".pewp") && lu.snapshots === path.join(tmp, "site-checks", "example.com", "snapshots"), JSON.stringify(lu));
  st.init(lu, "audit-live"); st.markStage(lu, "doctor", { "doctor.json": "x" });
  const s1 = J(path.join(lu.pewp, "state.json"));
  check("state: init + markStage recorded, URL .pewp gitignored", s1?.mode === "audit-live" && s1.stages.doctor?.doneAt && fs.readFileSync(path.join(lu.pewp, ".gitignore"), "utf8").trim() === "*");
  const lr = st.locate(path.join(tmp, "repo"), { cwd: tmp });
  check("state: repo target lives in <repo>/.pewp", lr.kind === "repo" && lr.pewp === path.join(tmp, "repo", ".pewp"));

  // ---- cache ----
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ n: hits })); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { cachedFetch } = await import(pathToFileURL(path.join(dir, "cache.mjs")).href);
  const u = `http://127.0.0.1:${server.address().port}/x?key=SECRET123`;
  const c1 = await cachedFetch(lu.pewp, "test", u);
  const c2 = await cachedFetch(lu.pewp, "test", u);
  check("cache: second fetch served from the cache file", !c1.fromCache && c2.fromCache && hits === 1 && c1.cacheFile === c2.cacheFile && c2.json().n === 1);
  fs.writeFileSync(c1.cacheFile, '{"source":"test","sta'); // cut short, as a crash mid-write leaves it
  let c3 = null, c3err = "";
  try { c3 = await cachedFetch(lu.pewp, "test", u); } catch (e) { c3err = e.message; }
  server.close();
  check("cache: a cache file cut short is a miss (fetched again and rewritten), not a crash", c3 && !c3.fromCache && hits === 2 && J(c1.cacheFile)?.status === 200, c3err || JSON.stringify(c3));
  check("cache: API keys never stored", !fs.readFileSync(c1.cacheFile, "utf8").includes("SECRET123"));

  // ---- snapshot reuse ----
  const { latestComplete } = await import(pathToFileURL(path.join(dir, "live-target.mjs")).href);
  const snaps = lu.snapshots;
  w(path.join(snaps, "2026-01-01", "_site.json"), { finishedAt: "2026-01-01T00:00:00Z", pages: [{ slug: "home" }], stoppedEarly: null });
  w(path.join(snaps, "2026-02-01", "_site.json"), { finishedAt: "2026-02-01T00:00:00Z", pages: [{ slug: "home" }], stoppedEarly: "second 429" });
  check("reuse: newest COMPLETE snapshot chosen (a stopped one is skipped)", latestComplete(snaps)?.dir.endsWith("2026-01-01"), latestComplete(snaps)?.dir);
  const r1 = node("live-target.mjs", ["https://www.example.com/", "--cwd", tmp, "--max-age-days", "100000"]);
  check("reuse: a young enough snapshot is reused, nothing fetched", r1.status === 0 && /^REUSE .*2026-01-01/.test(r1.stdout), r1.stdout + r1.stderr);

  // ---- authority on a tiny fake Common Crawl graph ----
  const cc = path.join(tmp, "cc");
  const rel = "cc-test-rel";
  const gz = (name, lines) => w(path.join(cc, `${rel}-domain-${name}.txt.gz`), zlib.gzipSync(lines.join("\n") + "\n"));
  const V = { "com.target": 0, "com.c1": 1, "com.c2": 2, "com.a": 3, "com.b": 4, "com.z": 5 };
  gz("vertices", Object.entries(V).map(([d, id]) => `${id}\t${d}\t1`));
  gz("edges", ["4\t0", "4\t1", "3\t1", "3\t2", "5\t1"]); // b->target, b->c1, a->c1, a->c2, z->c1 (only one competitor)
  gz("ranks", ["#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts", "1\t9\t1\t9\tcom.a\t1", "2\t8\t2\t8\tcom.b\t1", "3\t7\t3\t7\tcom.target\t1", "4\t6\t4\t6\tcom.c1\t1", "5\t5\t5\t5\tcom.c2\t1", "6\t4\t6\t4\tcom.z\t1"]);
  const authOut = path.join(lu.pewp, "authority.json");
  const ra = node("authority.mjs", [authOut, "--target", "www.target.com", "--competitor", "c1.com", "--competitor", "c2.com", "--cache", cc, "--release", rel]);
  const au = J(authOut);
  const tg = au?.results.find((r) => r.role === "target");
  check("authority: referring domains counted from the graph", tg?.linkingDomains === 1 && tg.strongestLinkingDomains[0].domain === "b.com" && tg.harmonicPos === 3, ra.stdout + ra.stderr);
  check("authority: link gap = links to 2+ competitors, not to us", au?.linkGap.length === 1 && au.linkGap[0].domain === "a.com", JSON.stringify(au?.linkGap));
  const rb = node("authority.mjs", [path.join(tmp, "x.json"), "--target", "t.com", "--cache", path.join(tmp, "empty-cache")]);
  check("authority: no cached release = BLOCKED (exit 3), nothing downloaded", rb.status === 3 && /BLOCKED/.test(rb.stderr), rb.stderr);

  // ---- report-live on a fixture snapshot ----
  const sd = path.join(snaps, "2026-03-01");
  const pg = (slug, extra = {}) => ({ url: `https://example.com/${slug}`, measuredAt: "2026-03-01T00:00:00Z", vitals: { lcpMs: 3000, cls: 0.01, tbtMs: 400 }, totals: { bytes: 2048000, requests: 30 },
    page: { canonical: `https://example.com/${slug}`, metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [], ...extra } });
  w(path.join(sd, "_site.json"), { finishedAt: "2026-03-01T00:00:00Z", runs: 3, stoppedEarly: null, pages: [{ url: "https://example.com/", slug: "home", status: 200 }, { url: "https://example.com/a", slug: "a", status: 200 }] });
  w(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }, { agents: ["gptbot"], rules: [{ allow: false, path: "/" }] }] });
  w(path.join(sd, "site/sitemaps.json"), { urlCount: 2 });
  w(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  w(path.join(sd, "pages/home/browser-mobile.json"), pg("", { structuredData: [] }));
  w(path.join(sd, "pages/a/browser-mobile.json"), pg("a", { robotsMeta: ["robots: noindex, nofollow"] }));
  w(path.join(sd, "pages/home/response.json"), { headers: {} }); w(path.join(sd, "pages/a/response.json"), { headers: {} });
  w(path.join(sd, ".checks/causes.json"), [{ id: "C01", severity: "high", rules: ["URL-004"], problem: "no canonical", fix: "add it", pages: 9, fixAt: ["lib.mjs"], scripts: ["check-1.mjs"] }, { id: "C02", severity: "low", rules: ["MET-004"], problem: "long title", fix: "shorten", pages: 1, scripts: [] }]);
  const rep = (ls) => node("report-live.mjs", ["https://www.example.com/", "--cwd", tmp, "--snapshot", sd, "--launch-state", ls]);
  const rl = rep("live");
  const md = fs.existsSync(path.join(lu.pewp, "report.md")) ? fs.readFileSync(path.join(lu.pewp, "report.md"), "utf8") : "";
  const rj = J(path.join(lu.pewp, "report.json"));
  const heads = [...md.matchAll(/^## (\d)\. /gm)].map((m) => Number(m[1]));
  check("report: the six questions, in order", heads.join(",") === "1,2,3,4,5,6", heads.join(",") + rl.stderr);
  check("report: one-line answer first", /^# .*\n\n\*\*Short answer:\*\* /.test(md));
  const facts = [];
  const walk = (o) => { if (o && typeof o === "object") { if ("value" in o && "source" in o) facts.push(o); else Object.values(o).forEach(walk); } };
  walk(rj?.questions);
  check("report: every number has value, source, fetchedAt, cacheFile", facts.length >= 10 && facts.every((f) => f.source && f.fetchedAt && "cacheFile" in f && f.cacheFile), `${facts.length} facts; bad: ${JSON.stringify(facts.find((f) => !(f.source && f.fetchedAt && f.cacheFile)))}`);
  const words = md.split("## Words used")[1] || "";
  const terms = Object.keys(rj?.glossary || {});
  check("report: each term used is explained exactly once", terms.length >= 5 && terms.every((t) => words.split(`**${t}**`).length === 2), terms.join(", "));
  check("report: blocked AI crawler and live noindex are problems", /blocks GPTBot/.test(md) && /1 page asks to be left out/.test(md), md.split("## 2.")[0].slice(-600));
  check("report: Q4 answered from authority, Q2/Q3/Q5 BLOCKED with what unblocks", rj?.questions[3].status === "answered" && [1, 2, 4].every((i) => rj.questions[i].status === "BLOCKED" && rj.questions[i].needs.length));
  check("report: fix order = severity then pages, each with its proof", rj?.questions[5].fixes[0].cause === "C01" && /run-all/.test(rj.questions[5].fixes[0].provedBy));
  rep("preview");
  const mdp = fs.readFileSync(path.join(lu.pewp, "report.md"), "utf8");
  check("report: a preview's noindex is by design, not a problem", !/asks? to be left out/.test(mdp.split("- robots.txt")[0]) && /by design: preview/.test(mdp));
  // a snapshot with no browser measurements and no checker results: no number is invented (LCP is null, not 0) and the checklist
  // size comes from checklist/INDEX.md, never a typed-in count
  const sd2 = path.join(tmp, "site-checks", "nobrowser.example", "snapshots", "2026-03-02");
  w(path.join(sd2, "_site.json"), { finishedAt: "2026-03-02T00:00:00Z", runs: 1, stoppedEarly: null, pages: [{ url: "https://nobrowser.example/", slug: "home", status: 200 }] });
  w(path.join(sd2, "site/robots.json"), { status: 200, groups: [] }); w(path.join(sd2, "site/sitemaps.json"), { urlCount: 1 }); w(path.join(sd2, "site/probes.json"), { notFound: { finalStatus: 404 } });
  w(path.join(sd2, "pages/home/response.json"), { headers: {} });
  const rn = node("report-live.mjs", ["https://nobrowser.example/", "--cwd", tmp, "--snapshot", sd2]);
  const rjn = J(path.join(tmp, "site-checks", "nobrowser.example", ".pewp", "report.json")), mdn = fs.existsSync(path.join(tmp, "site-checks", "nobrowser.example", ".pewp", "report.md")) ? fs.readFileSync(path.join(tmp, "site-checks", "nobrowser.example", ".pewp", "report.md"), "utf8") : "";
  const rulesN = (fs.readFileSync(path.join(dir, "..", "checklist", "INDEX.md"), "utf8").match(/(\d+) rules/) || [])[1];
  const f1n = rjn?.questions?.[0]?.facts || {};
  check("report: with no browser measurement the speed numbers are null and say NOT MEASURED (never a 0)", rn.status === 0 && f1n.lcpMedianMs?.value === null && /NOT MEASURED/.test(f1n.lcpMedianMs?.source || "") && f1n.tbtMedianMs?.value === null && /typical LCP n\/a/.test(mdn), rn.stderr + JSON.stringify(f1n.lcpMedianMs) + mdn.split("## 2.")[0].slice(-300));
  check("report: the checklist size in the report comes from checklist/INDEX.md (no hard-coded rule count)", !!rulesN && mdn.includes(`${rulesN} rules`) && /has not run on this snapshot/.test(mdn) && !/525-rule/.test(mdn), mdn.split("## 2.")[0].slice(-300));

  // ---- started through a junction (a linked skill folder): a CLI must still run, never exit 0 with no output ----
  const jn = path.join(tmp, "linked-scripts");
  fs.symlinkSync(dir, jn, "junction");
  const viaJ = (script, a) => spawnSync(process.execPath, [path.join(jn, script), ...a], { encoding: "utf8", timeout: 120000 });
  const jl = viaJ("live-target.mjs", []), jd = viaJ("run-all-diff.mjs", []), ja = viaJ("approve.mjs", []), js = viaJ("state.mjs", [path.join(tmp, "jrepo")]);
  check("junction: live-target, run-all-diff, approve and state run their CLI when started through a junction (usage error exit 2 / state JSON), not a silent exit 0",
    jl.status === 2 && /usage: node live-target/.test(jl.stderr) && jd.status === 2 && /usage: node run-all-diff/.test(jd.stderr) && ja.status === 2 && /usage: node approve/.test(ja.stderr) && js.status === 0 && /"location"/.test(js.stdout),
    JSON.stringify([jl.status, jl.stderr.slice(0, 80), jd.status, ja.status, js.status, js.stdout.slice(0, 60)]));

  // ---- read-only guard ----
  const gr = path.join(tmp, "gitrepo");
  fs.mkdirSync(gr, { recursive: true });
  spawnSync("git", ["init", "-q", gr], { timeout: 60000 }); w(path.join(gr, "a.txt"), "a");
  spawnSync("git", ["-C", gr, "add", "."], { timeout: 60000 }); spawnSync("git", ["-C", gr, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { timeout: 60000 });
  node("guard-readonly.mjs", [gr, "--before"]);
  w(path.join(gr, ".checks/findings/s01.md"), "x");
  const g1 = node("guard-readonly.mjs", [gr, "--after"]);
  w(path.join(gr, "a.txt"), "changed");
  const g2 = node("guard-readonly.mjs", [gr, "--after"]);
  check("guard: writes under .checks/ pass, a changed source file fails", g1.status === 0 && g2.status === 1 && /a\.txt/.test(g2.stdout), g1.stdout + g2.stdout);
  const ng = path.join(tmp, "not-a-repo"); fs.mkdirSync(ng, { recursive: true });
  const g3 = node("guard-readonly.mjs", [ng, "--after"]);
  fs.writeFileSync(path.join(gr, ".git", "index"), "not an index\n"); // git status now fails inside a real repo
  const g4 = node("guard-readonly.mjs", [gr, "--after"]);
  check("guard: a folder outside git passes (nothing to guard), but a git failure inside a repo is cannot judge (exit 2), never a pass", g3.status === 0 && /not a git repo/.test(g3.stdout) && g4.status === 2 && /^ERROR guard cannot judge/.test(g4.stdout), g3.stdout + " | " + g4.stdout);

  // ---- doctor ----
  const d = node("doctor.mjs", ["--json", "--offline"], { env: { ...process.env, GEMINI_API_KEY: "", CRUX_API_KEY: "" } });
  let dj = null; try { dj = JSON.parse(d.stdout.slice(d.stdout.indexOf("{"))); } catch {}
  check("doctor: free-only policy; every source has a status; not-connected ones say how to unblock", dj?.policy?.includes("free") && dj.sources.length >= 8 && dj.sources.every((s) => ["connected", "needs", "not available", "main session"].includes(s.status) && (s.status === "connected" || s.unblock)), d.stdout.slice(0, 300) + d.stderr);
  check("doctor: every TR-210 capability has a free source listed, analytics (conversions export) included", ["search-console", "bing-webmaster", "crux", "gemini", "commoncrawl-graph", "keyword-planner", "browser-capture", "analytics"].every((id) => dj?.sources.some((s) => s.id === id && (s.status === "connected" || s.unblock))), JSON.stringify(dj?.sources.map((s) => s.id)));
  const dt = "https://doc.example/", dl = st.locate(dt, { cwd: tmp });
  w(path.join(dl.pewp, "cache", "gsc", "abc.json"), "{}");
  const d2 = node("doctor.mjs", [dt, "--json", "--offline", "--cwd", tmp], { env: { ...process.env, GEMINI_API_KEY: "", CRUX_API_KEY: "" } });
  let dj2 = null; try { dj2 = JSON.parse(d2.stdout.slice(d2.stdout.indexOf("{"))); } catch {}
  const src2 = (id) => dj2?.sources.find((s) => s.id === id);
  check("doctor: with a target, each API source reports its last successful call (newest cache file) or null (TR-210)", !!src2("search-console")?.lastSuccessfulCall && !Number.isNaN(Date.parse(src2("search-console").lastSuccessfulCall)) && src2("bing-webmaster")?.lastSuccessfulCall === null && src2("crux")?.lastSuccessfulCall === null && !("lastSuccessfulCall" in (src2("keyword-planner") || {})), JSON.stringify([src2("search-console"), src2("bing-webmaster")]) + d2.stderr);

  // ---- checklist builder ----
  const out = path.join(tmp, "checklist-out");
  w(path.join(out, "INDEX.md"), "KEEP");
  const b1 = node("build-checklist.mjs", [path.join(tmp, "nope"), "--out", out]);
  check("checklist: a wrong shipgate path leaves the checklist untouched", b1.status === 2 && fs.readFileSync(path.join(out, "INDEX.md"), "utf8") === "KEEP", b1.stderr);
  const sg = path.join(tmp, "shipgate");
  w(path.join(sg, "SPEC.md"), "spec 9.1.0");
  w(path.join(sg, "spec/packs/targets.md"), "- **TGT-001** · P1 · site — every cluster has exactly one page: text\n");
  const b2 = node("build-checklist.mjs", [sg, "--out", out]);
  check("checklist: a new pack and rule prefix are picked up", b2.status === 0 && /TGT-001 P1 \[site\]/.test(fs.readFileSync(path.join(out, "targets.md"), "utf8")) && /9\.1\.0, 1 rules/.test(fs.readFileSync(path.join(out, "INDEX.md"), "utf8")), b2.stdout + b2.stderr);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `  ${String(r.detail).slice(0, 400)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `PHASE 1 TEST FAIL: ${failed} of ${results.length}` : `PHASE 1 TEST PASS: ${results.length} of ${results.length}`);
process.exit(failed ? 1 : 0);
