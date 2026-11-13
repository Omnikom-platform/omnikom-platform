// Usage: node test-reports.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--group <letter>[,<letter>]]
// Proof of the owner-facing reports of the overhaul (contract C7, brief G9 display, G10, G18, G22):
//   W  words      plan/summary.md, report.md and the stage files call plan/sitemap.json "the page plan"; the real file is "the sitemap file (sitemap.xml)"
//   P  picture    plan-picture.mjs: the page plan drawn as SVG (every page, NEW/EXISTING, volume, parents, legend, 6 boxes a row, wrapped text) + table
//   N  png        the SVG rendered to PNG by headless Chrome (cdp-measure.mjs); no Chrome = the BLOCKED line. This test says which branch it took.
//   A  approval   plan-site.mjs --require-approved-business refuses until approved/business.json is the current business.json
//   D  doctor     report-live.mjs says the date of the doctor result and says STALE when the env/token files changed since (doctor.json inputs)
//   S  speed      report-live.mjs shows lab and PageSpeed Insights side by side; PSI is the trusted number when the lab run was UNTRUSTED
//   Q  authority  report-live.mjs question 4: a site (target or competitor) the Common Crawl link graph does not hold is "not found in the link data", never 0;
//                 with the target not found, the link gap line and the links plan row do not claim "but not to you"
//   X  extras     report-live.mjs section 7: the Chrome UX Report (crux.json) and the six importers' files (index, trends, AI answers, reputation, social, ads): a block with the
//                 data and its capture date for each source that has data, a BLOCKED line with "| unblocks:" for each that has none (never a zero), no data (too little traffic) said as a result
//   C  checks     report-live.mjs --checks DIR (SKILL-REPORT-1): the root causes and their date come from DIR, not <snapshot>/.checks
//                 (without it: as before); no readable list of causes there is BLOCKED (exit 3, no report); --checks with no DIR is exit 2
//   G  groups     this file's own --group option: only the chosen scenario groups run, and only the mutants whose group is among them
//   --group Q,W runs just those groups and the mutants whose group is among them
// Fixtures only: no network, no model. Chrome is used only for the PNG check (local file:// page). Mutants: each patches ONE string in a copy of the
// skill (the patch must apply exactly once, so "the patch never applied" cannot pass as green), the named assertions must go red.
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir0 = path.resolve(opt("--scripts", here));
const nodeBin = process.execPath;
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); };
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const rt = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const BARE_SITEMAP = /\bsitemap\b(?!\.json|\.xml| file)/gi; // "sitemap" alone: the page plan and the file are two things and must not share a word
const bare = (text) => [...String(text).matchAll(BARE_SITEMAP)].map((m) => text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, " "));
const section = (md, n) => (md.split(new RegExp(`^## ${n}\\. `, "m"))[1] || "").split(/^## \d\. /m)[0].split("\n").slice(1).join("\n"); // without the heading's own words

const GROUPS = ["W", "P", "N", "A", "D", "S", "Q", "X", "C", "G"];
function parseGroups(raw) { // "q, w" -> ["Q", "W"]; an unknown letter is an error, never a silent empty run
  const gs = [...new Set(String(raw).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const bad = gs.filter((g) => !GROUPS.includes(g));
  if (bad.length || !gs.length) throw new Error(`unknown group ${bad.join(", ") || `"${raw}"`}; the groups are ${GROUPS.join(", ")}`);
  return gs;
}

async function runScenarios(skill, groups = null) {
  const scripts = path.join(skill, "scripts");
  const results = [];
  // G starts this file again; the child must not start it a third time
  const want = (g) => (!groups || groups.includes(g)) && !(g === "G" && process.env.PEWP_REPORTS_NESTED);
  const check = (g, name, ok, detail = "") => results.push({ name: `${g}: ${name}`, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900) });
  const run = (script, args, env = {}) => spawnSync(nodeBin, [path.join(scripts, script), ...args], { encoding: "utf8", timeout: 120_000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "", ...env } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-reports-"));
  const fresh = (name) => path.join(root, name);
  const copyFixture = (name) => { const d = fresh(name); fs.cpSync(path.join(skill, "fixtures", "pewp"), d, { recursive: true }); return d; };
  const TODAY = "2026-10-20";

  // ---------- the report-live fixture snapshot (a host per case, so cases never share a .pewp) ----------
  const pg = (vit) => ({ measuredAt: "2026-10-24T10:00:00Z", vitals: vit, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://x.example/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } });
  function snapshot(host, { pages, machineLoad = null, urlCount = 3 } = {}) {
    const base = path.join(root, "site-checks", host), sd = path.join(base, "snapshots", "2026-10-24");
    w(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad, pages: pages.map((p) => ({ url: `https://${host}${p.path}`, slug: p.slug, status: 200, ...(p.trust ? { speedTrust: p.trust } : {}) })) });
    w(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
    w(path.join(sd, "site/sitemaps.json"), { urlCount });
    w(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
    for (const p of pages) { w(path.join(sd, "pages", p.slug, "browser-mobile.json"), { url: `https://${host}${p.path}`, ...pg({ lcpMs: p.lcp, cls: 0.01, tbtMs: p.tbt ?? 100 }) }); w(path.join(sd, "pages", p.slug, "response.json"), { headers: {} }); }
    return { sd, pewp: path.join(base, ".pewp"), url: `https://${host}/` };
  }
  const report = (s, env = {}, extra = []) => { const r = run("report-live.mjs", [s.url, "--cwd", root, "--snapshot", s.sd, ...extra], env); return { r, md: rt(path.join(s.pewp, "report.md")), json: rj(path.join(s.pewp, "report.json")) }; };
  const BASE_ENV = { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" };

  // =============================== W: words ===============================
  if (want("W")) {
    const pewp = copyFixture("w-pewp");
    const pr = run("plan-site.mjs", [pewp, "--today", TODAY]);
    const summary = rt(path.join(pewp, "plan", "summary.md"));
    check("W", "plan-site writes plan/summary.md", pr.status === 0 && summary.length > 100, pr.stdout + pr.stderr);
    check("W", "summary.md names the blueprint 'the page plan' (plan/sitemap.json) and never uses the bare word sitemap", /page plan/.test(summary) && /plan\/sitemap\.json/.test(summary) && !bare(summary).length, bare(summary).join(" | ") || summary.slice(0, 300));
    check("W", "summary.md says the sitemap file search engines read is sitemap.xml", /sitemap\.xml/.test(summary) && /search engines read/.test(summary), summary.slice(0, 400));
    const s = snapshot("w1.example", { pages: [{ path: "/", slug: "home", lcp: 1500 }], urlCount: 0 });
    const { r, md } = report(s, BASE_ENV);
    check("W", "report.md: no bare 'sitemap' anywhere (the file is 'sitemap file (sitemap.xml)')", r.status === 0 && md.length > 500 && !bare(md).length, bare(md).join(" | ") || r.stderr);
    check("W", "report.md: the missing sitemap is called the sitemap file, and the term is explained once", /no sitemap file \(sitemap\.xml\) was found/.test(md) && /- sitemap file: 0 addresses listed/.test(md) && md.split("**sitemap file**").length === 2, md.split("## 2.")[0].slice(-700));
    const stageBad = ["plan", "gate", "build"].flatMap((n) => bare(rt(path.join(skill, "stages", `${n}.md`))).map((x) => `${n}.md: ${x}`));
    check("W", "stages/plan.md, gate.md, build.md: no bare 'sitemap' (page plan (plan/sitemap.json) or sitemap file (sitemap.xml))", !stageBad.length, stageBad.join("\n"));
    const planMd = rt(path.join(skill, "stages", "plan.md"));
    check("W", "stages/plan.md tells the main session to draw the page plan (plan-picture.mjs) and names --require-approved-business", /plan-picture\.mjs/.test(planMd) && /--require-approved-business/.test(planMd), planMd.slice(0, 200));
  }

  // =============================== P: the picture ===============================
  if (want("P") || want("N")) {
    const pewp = copyFixture("p-pewp");
    run("plan-site.mjs", [pewp, "--today", TODAY]);
    const sm = rj(path.join(pewp, "plan", "sitemap.json")) || { pages: [] };
    const nNew = sm.pages.filter((x) => x.isNew).length;
    const xmlEsc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    if (want("P")) {
      fs.writeFileSync(path.join(pewp, "plan", "page-plan.png"), "stale picture"); // a leftover from an earlier run must not survive
      const r = run("plan-picture.mjs", [pewp, "--today", TODAY], { PEWP_NO_CHROME: "1" });
      const svg = rt(path.join(pewp, "plan", "page-plan.svg")), md = rt(path.join(pewp, "plan", "page-plan.md"));
      check("P", "plan-picture runs on the fixture plan: exit 0 and the one-line summary 'page plan picture: N pages, M new'", r.status === 0 && sm.pages.length === 6 && r.stdout.includes(`page plan picture: ${sm.pages.length} pages, ${nNew} new`), r.stdout + r.stderr);
      const missing = sm.pages.filter((x) => !svg.includes(`data-page="${xmlEsc(x.path)}"`)).map((x) => x.path);
      check("P", "the SVG holds a box for every planned path", svg.startsWith("<svg") && sm.pages.length > 0 && !missing.length, missing.join(", ") || svg.slice(0, 100));
      check("P", "the SVG says NEW for each new page and EXISTING for each existing one", (svg.match(/>NEW</g) || []).length === nNew && (svg.match(/>EXISTING</g) || []).length === sm.pages.length - nNew && nNew >= 1, `NEW ${(svg.match(/>NEW</g) || []).length} of ${nNew}, EXISTING ${(svg.match(/>EXISTING</g) || []).length}`);
      check("P", "the SVG is 1400 px wide and carries a legend", /width="1400"/.test(svg) && /data-legend="1"/.test(svg) && /NEW: a page that has to be built/.test(svg) && /EXISTING: a page the site already has/.test(svg), svg.slice(0, 300));
      check("P", "the SVG shows each page's target search and its volume (a range with 'estimate', a plain number, or 'no number')", sm.pages.filter((x) => x.primaryQuery).every((x) => { const g = svg.split(`<g data-page="${xmlEsc(x.path)}">`)[1]?.split("</g>")[0] || ""; return [...g.matchAll(/<text [^>]*>([^<]*)</g)].map((m) => m[1]).join(" ").includes(x.primaryQuery); }) && /Volume: 100 to 1,000 \(estimate\)/.test(svg) && /Volume: 1,900/.test(svg), svg.slice(0, 600));
      const parents = sm.pages.filter((x) => x.parent && sm.pages.some((y) => y.path === x.parent));
      check("P", "a line joins every page to its parent", (svg.match(/data-from=/g) || []).length === parents.length && parents.length >= 5, `${(svg.match(/data-from=/g) || []).length} lines, ${parents.length} parents`);
      const rows = md.split("\n").filter((l) => /^\| \//.test(l));
      check("P", "page-plan.md: a header and one row per page (page, under, target search, volume, new/existing)", rows.length === sm.pages.length && /\| Page \| Under \| Target search \| Volume \| New or existing \|/.test(md) && rows.some((l) => /\| NEW \|$/.test(l)), md);
      check("P", "without Chrome: the BLOCKED line, SVG and table written, exit 0, and no stale PNG left behind", r.status === 0 && r.stdout.includes("PNG BLOCKED: no Chrome (set CHROME_PATH); SVG and table written") && !fs.existsSync(path.join(pewp, "plan", "page-plan.png")), r.stdout);
      const out = fresh("p-out");
      const ro = run("plan-picture.mjs", [pewp, "--out-dir", out], { PEWP_NO_CHROME: "1" });
      check("P", "--out-dir writes the files there", ro.status === 0 && fs.existsSync(path.join(out, "page-plan.svg")) && fs.existsSync(path.join(out, "page-plan.md")), ro.stdout + ro.stderr);
      const empty = fresh("p-empty"); fs.mkdirSync(empty, { recursive: true });
      const re = run("plan-picture.mjs", [empty], { PEWP_NO_CHROME: "1" });
      const noTargets = copyFixture("p-notargets"); fs.mkdirSync(path.join(noTargets, "plan"), { recursive: true }); fs.copyFileSync(path.join(pewp, "plan", "sitemap.json"), path.join(noTargets, "plan", "sitemap.json")); fs.rmSync(path.join(noTargets, "targets.json"));
      const rn = run("plan-picture.mjs", [noTargets], { PEWP_NO_CHROME: "1" });
      check("P", "missing inputs exit 2 (no page plan; no targets.json) and say which file", re.status === 2 && /page plan/.test(re.stderr) && rn.status === 2 && /targets\.json/.test(rn.stderr), `${re.status} ${re.stderr} | ${rn.status} ${rn.stderr}`);

      // a bigger tree: 14 children under the home, 2 grandchildren, one with no volume, long and awkward text
      const lib = await import(pathToFileURL(path.join(scripts, "plan-picture.mjs")).href + `?t=${Date.now()}${Math.random()}`);
      const kids = Array.from({ length: 14 }, (_, i) => ({ path: `/page-${i + 1}/`, parent: "/", cluster: `c${i + 1}`, primaryQuery: i === 0 ? "luxury & historic <homes> for sale with a very long search phrase that must wrap" : `search number ${i + 1}`, isNew: i % 2 === 0 }));
      const grand = [{ path: "/page-1/deep-a/", parent: "/page-1/", cluster: "g1", primaryQuery: "deep a", isNew: true }, { path: "/page-1/an-extremely-long-path-segment-with-no-break-at-all-xxxxxxxxxxxxxxxxxxxx/", parent: "/page-1/", cluster: null, primaryQuery: null, isNew: false }];
      const big = { business: "x.example", pages: [{ path: "/", parent: null, cluster: "h", primaryQuery: "home query", isNew: false }, ...kids, ...grand] };
      const tg = { clusters: [...kids.map((k, i) => ({ id: k.cluster, primaryQuery: k.primaryQuery, volume: i === 1 ? { value: null } : { value: 100 * (i + 1) } })), { id: "g1", primaryQuery: "deep a", volume: { value: [10, 20], estimate: true } }, { id: "h", primaryQuery: "home query", volume: { value: 5000 } }] };
      const pic = lib.buildPicture(big, tg, { today: TODAY });
      const boxes = [...pic.svg.matchAll(/<g data-page="([^"]*)">\s*<rect x="(\d+)" y="(\d+)" width="(\d+)"/g)].map((m) => ({ path: m[1], x: +m[2], y: +m[3], w: +m[4] }));
      const perRow = {}; for (const b of boxes) perRow[b.y] = (perRow[b.y] || 0) + 1;
      check("P", "a big plan: 17 pages all drawn, at most 6 boxes in a row, rows stacked top to bottom", boxes.length === big.pages.length && Math.max(...Object.values(perRow)) <= 6 && Object.keys(perRow).length >= 4, JSON.stringify(perRow));
      check("P", "a big plan: every box sits inside the 1400 px width", boxes.every((b) => b.x >= 0 && b.x + b.w <= 1400), JSON.stringify(boxes.filter((b) => b.x < 0 || b.x + b.w > 1400)));
      const yOf = (p) => boxes.find((b) => b.path === p)?.y;
      check("P", "a big plan: the home is on top, children under it, grandchildren under their parent", yOf("/") < yOf("/page-1/") && yOf("/page-1/") < yOf("/page-1/deep-a/") && yOf("/page-1/deep-a/") > Math.max(...kids.map((k) => yOf(k.path))), `${yOf("/")} ${yOf("/page-1/")} ${yOf("/page-1/deep-a/")}`);
      const boxText = [...pic.svg.matchAll(/<g data-page="[^"]*">([\s\S]*?)<\/g>/g)].flatMap((g) => [...g[1].matchAll(/<text [^>]*>([^<]*)</g)].map((m) => m[1].replace(/&[a-z]+;/g, "x")));
      const longest = Math.max(...boxText.map((t) => t.length));
      check("P", "a big plan: long search text and a long unbroken path are wrapped to the box width (no line over 30 characters in a box)", boxText.length > 40 && longest <= 30, `longest ${longest} of ${boxText.length} lines`);
      check("P", "a big plan: '&' and '<' in a search are escaped (valid SVG text), 'no number' shown for a missing volume, a range as 'a to b (estimate)'", !/&(?!amp;|lt;|gt;|quot;)/.test(pic.svg) && !/<homes>/.test(pic.svg) && /&amp;/.test(pic.svg) && /Volume: no number/.test(pic.svg) && /Volume: 10 to 20 \(estimate\)/.test(pic.svg), pic.svg.slice(0, 200));
    }
    if (want("N")) {
      const outDir = fresh("n-out");
      const r = run("plan-picture.mjs", [pewp, "--out-dir", outDir]);
      const cdp = await import(pathToFileURL(path.join(scripts, "cdp-measure.mjs")).href + `?t=${Date.now()}`);
      const png = path.join(outDir, "page-plan.png");
      if (cdp.CHROME_PATH) {
        const b = fs.existsSync(png) ? fs.readFileSync(png) : Buffer.alloc(0);
        const sig = b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        check("N", `[branch: Chrome found at ${path.basename(cdp.CHROME_PATH)}] page-plan.png is a PNG (signature bytes), 1400 px wide, and the run did not print BLOCKED`, r.status === 0 && sig && b.readUInt32BE(16) === 1400 && !/PNG BLOCKED/.test(r.stdout), `${r.stdout} ${r.stderr} size ${b.length}`);
      } else {
        check("N", "[branch: no Chrome on this machine] the BLOCKED line is printed, SVG and table written, no PNG, exit 0", r.status === 0 && r.stdout.includes("PNG BLOCKED: no Chrome (set CHROME_PATH); SVG and table written") && !fs.existsSync(png) && fs.existsSync(path.join(outDir, "page-plan.svg")), r.stdout + r.stderr);
      }
      results[results.length - 1].branch = cdp.CHROME_PATH ? "chrome" : "no-chrome";
    }
  }

  // =============================== A: --require-approved-business ===============================
  if (want("A")) {
    const MSG = "business.json is not approved by the owner: run approve.mjs <target> business --by NAME (or intake again if it changed)";
    const mk = (name) => { const d = copyFixture(name); const b = rj(path.join(d, "business.json")); b.vocabulary = ["historic homes"]; b.provenance = Object.fromEntries(["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary"].map((k) => [k, "owner"])); w(path.join(d, "business.json"), b); return d; };
    const a1 = mk("a1");
    const r1 = run("plan-site.mjs", [a1, "--today", TODAY, "--require-approved-business"]);
    check("A", "no approval: refused, exit 1, the message says how to fix, nothing written", r1.status === 1 && r1.stderr.includes(MSG) && !fs.existsSync(path.join(a1, "plan", "sitemap.json")), `${r1.status} ${r1.stderr}${r1.stdout}`);
    const r0 = run("plan-site.mjs", [a1, "--today", TODAY]);
    check("A", "without the flag nothing changes: the plan is written although the business is not approved", r0.status === 0 && fs.existsSync(path.join(a1, "plan", "sitemap.json")), r0.stdout + r0.stderr);
    fs.rmSync(path.join(a1, "plan", "sitemap.json"), { force: true });
    const ap = run("approve.mjs", [a1, "business", "--by", "Test Owner", "--pewp", a1]);
    const r2 = run("plan-site.mjs", [a1, "--today", TODAY, "--require-approved-business"]);
    check("A", "approved by approve.mjs (the owner's own fields): the plan is written, exit 0", ap.status === 0 && r2.status === 0 && /^PASS plan/.test(r2.stdout), `${ap.status} ${ap.stdout}${ap.stderr} | ${r2.status} ${r2.stdout}${r2.stderr}`);
    const b = rj(path.join(a1, "business.json")); b.name = b.name + " Changed"; w(path.join(a1, "business.json"), b);
    fs.rmSync(path.join(a1, "plan", "sitemap.json"), { force: true });
    const r3 = run("plan-site.mjs", [a1, "--today", TODAY, "--require-approved-business"]);
    check("A", "business.json changed after the approval: refused again (exit 1, same message), nothing written", r3.status === 1 && r3.stderr.includes(MSG) && !fs.existsSync(path.join(a1, "plan", "sitemap.json")), `${r3.status} ${r3.stderr}`);
  }

  // =============================== D: the doctor result's date and STALE ===============================
  if (want("D")) {
    const env1 = fresh("d.env"), tok = fresh("d-token.json"), sa = fresh("d-sa.json");
    w(env1, "SOME_NAME=1\n"); w(tok, "{\"x\":1}"); w(sa, "{\"y\":2}");
    const doctorFor = (s, over = {}) => w(path.join(s.pewp, "doctor.json"), { checkedAt: "2026-10-01T10:00:00.000Z", env: { file: env1, loaded: ["SOME_NAME"], source: "--env-file" }, inputs: { envFileSha1: sha1(rt(env1)), tokenFileSha1: sha1(rt(tok)), serviceAccountFileSha1: "absent" },
      sources: [{ id: "search-console", status: "needs", unblock: "add a token" }, { id: "bing-webmaster", status: "connected" }], ...over });
    const pagesD = [{ path: "/", slug: "home", lcp: 1500 }];
    const ENV = { ...BASE_ENV, GSC_TOKEN_FILE: tok };
    const STALE = "STALE doctor result (2026-10-01): the env or token files changed since; run doctor again";

    const s1 = snapshot("d1.example", { pages: pagesD }); doctorFor(s1);
    const c1 = report(s1, ENV), sec1 = section(c1.md, 2);
    check("D", "same hashes: section 2 shows the date of the doctor result, no STALE, and the source status as the doctor wrote it", c1.r.status === 0 && /Source status below is from the doctor result of 2026-10-01\./.test(sec1) && !/STALE/.test(c1.md) && /needs/.test(sec1) && c1.json?.doctor?.stale === false, sec1.slice(0, 700) + c1.r.stderr);
    check("D", "the sources lines carry the date too ('source status from the doctor result of <date>')", /What unblocks it \(source status from the doctor result of 2026-10-01\)/.test(sec1), sec1.slice(0, 700));

    const s2 = snapshot("d2.example", { pages: pagesD }); doctorFor(s2);
    w(env1, "SOME_NAME=2\nNEW_KEY=x\n"); // the env file changed after doctor ran
    const c2 = report(s2, ENV), sec2 = section(c2.md, 2);
    const firstLine = sec2.split("\n").map((l) => l.trim()).find(Boolean) || "";
    check("D", "env file changed since doctor: section 2 opens with the STALE line (date included)", firstLine.includes(STALE) && c2.json?.doctor?.stale === true && c2.json.doctor.staleBecause.includes("envFileSha1"), firstLine + " | " + JSON.stringify(c2.json?.doctor));
    check("D", "stale: the old per-source text (needs) is not repeated in section 2", !/: needs\b/i.test(sec2) && !/NEEDS/.test(sec2) && /run doctor again/.test(sec2), sec2.slice(0, 800));
    w(env1, "SOME_NAME=1\n");

    const s3 = snapshot("d3.example", { pages: pagesD }); doctorFor(s3); w(tok, "{\"x\":2}");
    const c3 = report(s3, ENV);
    check("D", "token file changed since doctor: STALE", firstOf(section(c3.md, 2)).includes(STALE) && c3.json?.doctor?.staleBecause?.includes("tokenFileSha1"), section(c3.md, 2).slice(0, 300));
    w(tok, "{\"x\":1}");

    const s4 = snapshot("d4.example", { pages: pagesD }); doctorFor(s4, { inputs: { envFileSha1: sha1(rt(env1)), tokenFileSha1: sha1(rt(tok)), serviceAccountFileSha1: sha1("{\"y\":1}") } });
    const c4 = report(s4, { ...ENV, GSC_SERVICE_ACCOUNT_FILE: sa });
    check("D", "service account file differs from the one doctor hashed: STALE", firstOf(section(c4.md, 2)).includes(STALE) && c4.json?.doctor?.staleBecause?.includes("serviceAccountFileSha1"), section(c4.md, 2).slice(0, 300));

    const s5 = snapshot("d5.example", { pages: pagesD }); doctorFor(s5, { inputs: undefined });
    const c5 = report(s5, ENV), sec5 = section(c5.md, 2);
    check("D", "an older doctor.json without input hashes: the date is shown, no STALE, and the report says it cannot tell", !/STALE/.test(c5.md) && /doctor result of 2026-10-01 \(it records no file hashes/.test(sec5) && c5.json?.doctor?.hasInputHashes === false, sec5.slice(0, 400));
  }

  // =============================== S: lab speed trust and PageSpeed Insights ===============================
  if (want("S")) {
    const load = { cpuPctAvg: 62.5, cpuPctMax: 91, samples: 20, thresholdPct: 35 };
    const pagesS = [{ path: "/faq", slug: "faq", lcp: 7700, tbt: 400, trust: "UNTRUSTED: machine busy (cpu avg 62%)" }, { path: "/", slug: "home", lcp: 2400, tbt: 100, trust: "trusted" }];
    const psi = (host, date, faqLcp) => w(path.join(root, "site-checks", host, ".pewp", "psi", `${date}.json`), { pages: [
      { url: `https://${host}/faq`, strategy: "mobile", performance: 94, lcpMs: faqLcp, cls: 0.01, tbtMs: 120, fetchedAt: `${date}T20:00:00Z` },
      { url: `https://${host}/faq`, strategy: "desktop", performance: 99, lcpMs: 900, cls: 0, tbtMs: 10, fetchedAt: `${date}T20:00:00Z` },
      { url: `https://${host}/`, strategy: "mobile", performance: 88, lcpMs: 3100, cls: 0.02, tbtMs: 200, fetchedAt: `${date}T20:00:00Z` }] });
    const rowOf = (md, start) => md.split("\n").find((l) => l.startsWith(start)) || "";

    const s1 = snapshot("s1.example", { pages: pagesS, machineLoad: load }); psi("s1.example", "2026-10-20", 9999); psi("s1.example", "2026-10-25", 2800);
    const c1 = report(s1, BASE_ENV), md1 = c1.md;
    check("S", "a busy machine: the speed line says the lab speed is UNTRUSTED, with the CPU figures", /Lab speed UNTRUSTED\*\* on 1 page/.test(md1) && /UNTRUSTED, see below/.test(md1) && /CPU use 62\.5% on average \(highest 91%, 20 samples\); lab speed is only trusted up to 35%/.test(md1), md1.split("## 2.")[0].slice(-1500));
    const faq = rowOf(md1, "| /faq/ | phone");
    check("S", "lab and PSI side by side for the measured page: lab 7.7 s next to PSI 2.8 s, and PSI is named the trusted number", /PageSpeed Insights of 2026-10-25/.test(md1) && faq.includes("7.7 s") && faq.includes("UNTRUSTED") && faq.includes("score 94, LCP 2.8 s") && faq.endsWith("| PSI |"), faq + " || " + md1.split("## 2.")[0].slice(-1200));
    check("S", "the newest PSI file is used (the older one, LCP 10.0 s, is ignored)", !md1.includes("10.0 s") && c1.json?.questions?.[0]?.facts?.psiSpeed?.value?.date === "2026-10-25", JSON.stringify(c1.json?.questions?.[0]?.facts?.psiSpeed));
    check("S", "a page whose lab run was trusted: both numbers are listed and the trusted column says 'lab and PSI'; a desktop row says lab runs are phone only", rowOf(md1, "| / | phone").endsWith("| lab and PSI |") && rowOf(md1, "| /faq/ | desktop").includes("lab runs are phone only"), rowOf(md1, "| / | phone") + " || " + rowOf(md1, "| /faq/ | desktop"));
    check("S", "the untrusted lab speed is not counted as a finding; the slow phone speed PSI measured is (a problem line from PSI)", /the phone speed measured here is not trusted/.test(md1) && /slow on phones according to PageSpeed Insights/.test(md1) && !/pages are slow on phones: the typical page/.test(md1), md1.split("- robots.txt")[0].slice(-900));
    check("S", "report.json carries the trust and PSI as sourced facts (value, source, fetchedAt, cacheFile)", (() => { const f = c1.json?.questions?.[0]?.facts || {}; return f.labSpeedTrust?.value?.trusted === false && f.psiSpeed?.value?.trustedNumber === "PSI" && f.psiSpeed.source && f.psiSpeed.fetchedAt && f.psiSpeed.cacheFile && f.labSpeedTrust.cacheFile; })(), JSON.stringify(c1.json?.questions?.[0]?.facts?.psiSpeed));

    const s2 = snapshot("s2.example", { pages: pagesS, machineLoad: load });
    const c2 = report(s2, BASE_ENV);
    check("S", "UNTRUSTED lab speed and no PSI file: says so and says how to get the trusted number (psi.mjs, PSI_API_KEY); no table", /Lab speed UNTRUSTED/.test(c2.md) && /Run psi\.mjs \(needs PSI_API_KEY/.test(c2.md) && !/PageSpeed Insights of/.test(c2.md), c2.md.split("## 2.")[0].slice(-900));

    const s3 = snapshot("s3.example", { pages: [{ path: "/faq", slug: "faq", lcp: 2100, trust: "trusted" }], machineLoad: { cpuPctAvg: 9, cpuPctMax: 20, samples: 10, thresholdPct: 35 } }); psi("s3.example", "2026-10-25", 2800);
    const c3 = report(s3, BASE_ENV);
    check("S", "a quiet machine: nothing is called UNTRUSTED, both numbers are shown", !/UNTRUSTED/.test(c3.md) && /both are shown/.test(c3.md) && rowOf(c3.md, "| /faq/ | phone").endsWith("| lab and PSI |") && /CPU use 9% on average/.test(c3.md), rowOf(c3.md, "| /faq/ | phone") + c3.md.split("## 2.")[0].slice(-600));
  }

  // =============================== Q: authority, "not in the link data" is not zero (work order 27) ===============================
  if (want("Q")) {
    const NOT = "not found in the link data";
    // the shapes authority.mjs writes: a site in the graph has role, counts and ranks; a site NOT in the graph has only domain, inGraph:false and note (no role, no count)
    const IN = (domain, role, n, pos) => ({ domain, role, inGraph: true, hosts: 1, harmonicPos: pos, pageRankPos: pos, linkingDomains: n, strongestLinkingDomains: [{ domain: "l1.example", harmonicPos: 5 }] });
    const OUT = (domain) => ({ domain, inGraph: false, note: "not in this Common Crawl release (too few links or not crawled)" });
    const authDoc = (results) => ({ fetchedAt: "2026-10-23T08:00:00Z", source: "Common Crawl web graph cc-test (domain level)", release: "cc-test", target: results[0].domain, results, linkGap: [{ domain: "g1.example", linksToCompetitors: 2, harmonicPos: 50 }] });
    const put = (s, results) => w(path.join(s.pewp, "authority.json"), authDoc(results));
    const pagesQ = [{ path: "/", slug: "home", lcp: 1500 }];
    const q4Of = (c) => c.json?.questions?.find((x) => x.n === 4);
    const q6Of = (c) => c.json?.questions?.find((x) => x.n === 6);
    const line = (sec, start) => sec.split("\n").find((l) => l.startsWith(start)) || "";

    // Q1: the target and one of two competitors are not in the graph; no site cites the target (so the "why" sentence about links is written)
    const s1 = snapshot("q1.example", { pages: pagesQ });
    put(s1, [OUT("q1.example"), IN("rival-a.example", "competitor", 120, 900), OUT("rival-b.example")]);
    w(path.join(s1.pewp, "research", "ai-citations.json"), { rows: [{ question: "who is the best", engine: "gemini", runs: 3, citedShare: { value: 0 }, ourDomainCited: false, citedSources: ["other.example"] }] });
    const c1 = report(s1, BASE_ENV), f1 = q4Of(c1)?.facts || {}, sec1 = section(c1.md, 4), rows1 = f1.competitors?.value || [];
    const a = rows1.find((r) => r.domain === "rival-a.example"), b = rows1.find((r) => r.domain === "rival-b.example");
    check("Q", "target not in the graph: referringDomains is null (never 0), inGraph is false, strengthRank is null", c1.r.status === 0 && f1.referringDomains?.value === null && f1.inGraph?.value === false && f1.strengthRank?.value === null, JSON.stringify(f1).slice(0, 400) + c1.r.stderr);
    check("Q", "competitors: the one in the graph keeps its count and rank (inGraph true); the one not in the graph, which authority.json gives no role, is still listed with referringDomains null and inGraph false", rows1.length === 2 && a?.referringDomains === 120 && a.inGraph === true && a.strengthRank === 900 && b?.referringDomains === null && b.inGraph === false && b.strengthRank === null, JSON.stringify(rows1));
    check("Q", "section 4 says 'not found in the link data' for the target and for the competitor, and prints no 0 for either", /referring domains: not found in the link data/.test(sec1) && line(sec1, "- Competitor rival-b.example").includes(NOT) && !/: 0\b/.test(sec1) && !/\b0 referring domains/.test(sec1), sec1.slice(0, 900));
    check("Q", "section 4: a competitor in the graph still shows its number and rank; strongest linkers of the target are 'not found', not 'none'", line(sec1, "- Competitor rival-a.example").includes("120 referring domains, strength rank 900") && line(sec1, "- Strongest sites linking here").includes(NOT), sec1.slice(0, 900));
    check("Q", "the short answer says the site is not found in the link data and does not say '0 other websites link to it'", String(c1.json?.shortAnswer).includes(NOT) && !/\b0 other websites/.test(c1.json?.shortAnswer), c1.json?.shortAnswer);
    const why1 = (c1.json?.questions?.find((x) => x.n === 5)?.why || []).find((x) => /too few other sites linking/.test(x)) || "";
    check("Q", "question 5's 'why' sentence about too few links says not found in the link data, not '0 referring domains'", why1.includes(NOT) && !/\b0 referring domain/.test(why1), why1 || JSON.stringify(c1.json?.questions?.find((x) => x.n === 5)).slice(0, 300));
    // work order 28: the link gap is the sites that link to 2+ competitors and "not to you"; for a target the graph does not hold, that second half cannot be judged
    const gapLine1 = sec1.split("\n").find((l) => l.includes("g1.example")) || "";
    check("Q", "target not in the graph: the link gap line lists the sites that link to two or more competitors, says whether they link here cannot be judged (not found in the link data), and never says 'not to you'", gapLine1.includes("two or more competitors") && gapLine1.includes("cannot be judged") && gapLine1.includes(NOT) && !/not to (you|this site|us)/.test(gapLine1), gapLine1 || sec1);
    const links1 = (q6Of(c1)?.plan || []).find((p) => p.kind === "links");
    check("Q", "target not in the graph: the 'links' plan row does not say 'but not to you', says it cannot be judged, and is proved by the site appearing in the next authority run (not by referring domains rising)", !!links1 && !/but not to you/.test(links1.what) && /cannot be judged/.test(links1.what) && links1.what.includes(NOT) && links1.what.includes("g1.example") && /appears in the next authority run/.test(links1.provedBy) && !/referring domains rise/.test(links1.provedBy) && !/but not to you/.test(c1.md), JSON.stringify(links1) + " | in report.md: " + (c1.md.match(/.{30}but not to you.{20}/) || [""])[0]);

    // Q2: everything in the graph: today's behaviour
    const s2 = snapshot("q2.example", { pages: pagesQ });
    put(s2, [IN("q2.example", "target", 14, 900), IN("rival-a.example", "competitor", 120, 800)]);
    const c2 = report(s2, BASE_ENV), f2 = q4Of(c2)?.facts || {}, sec2 = section(c2.md, 4);
    check("Q", "target and competitor in the graph: counts, ranks and inGraph true as before, and the words 'not found in the link data' appear nowhere", f2.referringDomains?.value === 14 && f2.inGraph?.value === true && f2.competitors?.value?.[0]?.referringDomains === 120 && f2.competitors.value[0].inGraph === true && /referring domains: 14 \(strength rank 900;/.test(sec2) && line(sec2, "- Competitor rival-a.example").includes("120 referring domains, strength rank 800") && String(c2.json?.shortAnswer).includes("14 other websites link to it") && !c2.md.includes(NOT), sec2.slice(0, 700) + c2.json?.shortAnswer);
    const links2 = (q6Of(c2)?.plan || []).find((p) => p.kind === "links");
    check("Q", "target in the graph: the link gap line and the 'links' plan row keep today's words ('link gap: 1 sites', 'but not to you', proved by referring domains rising)", line(sec2, "- link gap").startsWith("- link gap: 1 sites, strongest first: g1.example") && !!links2 && /but not to you: g1\.example/.test(links2.what) && links2.provedBy === "referring domains rise in the next authority run" && !/cannot be judged/.test(c2.md), line(sec2, "- link gap") + JSON.stringify(links2));

    // Q3: the "since the last report" line across a change between counted and not found, both ways, never a number made from the null
    const s3 = snapshot("q3.example", { pages: pagesQ });
    put(s3, [IN("q3.example", "target", 14, 900)]); report(s3, BASE_ENV);
    put(s3, [OUT("q3.example")]);
    const c3 = report(s3, BASE_ENV), ch3 = c3.json?.sinceLast?.changes?.find((x) => x.metric === "refdom");
    check("Q", "since the last report, counted -> not found: 'referring domains: 14 to not found in the link data'", c3.md.includes(`referring domains: 14 to ${NOT}`) && ch3?.beforeText === "14" && ch3.afterText === NOT && ch3.afterValue === null, c3.md.split("\n").find((l) => l.includes("Since the last")) + JSON.stringify(ch3));
    put(s3, [IN("q3.example", "target", 20, 700)]);
    const c4 = report(s3, BASE_ENV), ch4 = c4.json?.sinceLast?.changes?.find((x) => x.metric === "refdom");
    check("Q", "since the last report, not found -> counted: 'referring domains: not found in the link data to 20'", c4.md.includes(`referring domains: ${NOT} to 20`) && ch4?.beforeText === NOT && ch4.afterText === "20" && ch4.before?.value === null, c4.md.split("\n").find((l) => l.includes("Since the last")) + JSON.stringify(ch4));
    put(s3, [OUT("q3.example")]); report(s3, BASE_ENV);
    const c5 = report(s3, BASE_ENV);
    check("Q", "since the last report, not found twice: no change line for referring domains, counted as unchanged", !/Since the last report[^\n]*referring domains/.test(c5.md), c5.md.split("\n").find((l) => l.includes("Since the last")));
  }

  // =============================== G: --group (work order 28) ===============================
  if (want("G")) {
    const self = path.join(scripts, "test-reports.mjs");
    const sub = (args) => run("test-reports.mjs", args, { PEWP_REPORTS_NESTED: "1" });
    const lines = (r) => (r.stdout || "").split("\n");
    const help = sub(["--help"]);
    check("G", "usage lines (the comment on line 1 and --help) name --group and no longer name --keep, which nothing read", help.status === 0 && /--group/.test(help.stdout) && !/--keep/.test(help.stdout) && /--group/.test(rt(self).split("\n")[0]) && !/--keep/.test(rt(self).split("\n")[0]), (help.stdout + help.stderr).slice(0, 300) + " | line 1: " + rt(self).split("\n")[0]);
    const ad = sub(["--group", "A,D", "--no-mutants"]);
    const adLines = lines(ad).filter((l) => /^(PASS|FAIL) [A-Z]:/.test(l));
    check("G", "--group A,D runs only the scenarios of groups A and D (no W, P, N, S, Q line) and exits 0", ad.status === 0 && adLines.some((l) => l.startsWith("PASS A:")) && adLines.some((l) => l.startsWith("PASS D:")) && adLines.every((l) => /^PASS [AD]:/.test(l)) && /REPORTS TEST PASS: \d+ of \d+/.test(ad.stdout), `${ad.status} ${adLines.map((l) => l.slice(0, 40)).join(" | ")}`.slice(0, 500) + ad.stderr.slice(0, 200));
    const bad = sub(["--group", "Z"]);
    check("G", "--group with an unknown letter is refused with exit 2 and names the groups, not run as an empty pass", bad.status === 2 && /unknown group Z/.test(bad.stderr) && !/TEST PASS/.test(bad.stdout), `${bad.status} ${bad.stdout.slice(0, 120)} ${bad.stderr.slice(0, 200)}`);
    const inG = sub(["--group", "A", "--mutant", "A: the refusal exits 0"]);
    const outG = sub(["--group", "D", "--mutant", "A: the refusal exits 0"]);
    check("G", "--group selects mutants too: an A mutant runs under --group A and not under --group D", inG.status === 0 && /RED \(caught\) A: the refusal exits 0/.test(inG.stdout) && /MUTANTS PASS: 1 of 1 caught/.test(inG.stdout) && outG.status === 0 && !/RED \(caught\)/.test(outG.stdout) && /MUTANTS PASS: 0 of 0 caught/.test(outG.stdout), `${inG.status}: ${inG.stdout.split("\n").slice(-4).join(" | ")} || ${outG.status}: ${outG.stdout.split("\n").slice(-4).join(" | ")}`.slice(0, 600));
  }

  // =============================== X: the extras (crux + six importers) ===============================
  if (want("X")) {
    const DAY = "2026-10-24", ISO = DAY + "T10:00:00Z";
    const put = (s0, rel, o) => w(path.join(s0.pewp, rel), o);
    const row = (extra) => ({ file: "a.json", capturedAt: ISO, ageDays: 1, stale: false, ...extra });
    const full = snapshot("x1.example", { pages: [{ path: "/", slug: "home", lcp: 1500 }] });
    put(full, "crux/" + DAY + ".json", { generatedAt: ISO, failures: [], rows: [
      { scope: "url", target: "https://x1.example/", formFactor: "PHONE", status: "data", metrics: { lcp: { p75: 2300 }, inp: { p75: 180 }, cls: { p75: 0.04 } }, collectionPeriod: { first: "2026-09-01", last: "2026-09-28" }, fetchedAt: ISO, cacheFile: null },
      { scope: "origin", target: "https://x1.example", formFactor: "PHONE", status: "no data", metrics: null, collectionPeriod: null, fetchedAt: ISO, cacheFile: null }] });
    put(full, "research/index.json", { rows: [row({ engine: "google" })], summary: { google: { indexedCount: 230, listedUrls: 12 }, bing: { indexedCount: null, listedUrls: 0 }, servicesChecked: 4, servicesListed: 3, servicesMissing: ["bridge loans"] } });
    put(full, "research/trends.json", { rows: [row({})], summary: { scale: "0-100, relative interest", services: 3, bestRank: { service: "hard money loans", stateRank: 2 }, worstRank: { service: "bridge loans", stateRank: 31 } } });
    put(full, "research/ai-answers.json", { rows: [row({ engine: "chatgpt" })], summary: { engines: [{ engine: "chatgpt", status: "ok", questions: 6, named: 1, shareNamed: 0.17 }], blockedEngines: [{ engine: "gemini", reason: "sign-in wall" }], questions: 6, namedAnswers: 1, shareNamed: 0.17, competitors: [{ name: "Acme Lending", count: 4 }], citedDomains: [{ name: "acme.example", count: 3 }], ownDomainCited: false } });
    put(full, "research/reputation.json", { rows: [row({})], staleCount: 0, summary: { subjects: [{ subject: "x1.example", sitesChecked: 3, sitesListed: 2, totalReviews: 41, weightedRating: 4.6, complaints: 1, newestReviewDate: "2026-10-01" }] } });
    put(full, "research/social.json", { rows: [row({})], summary: { profilesRead: 2, blocked: 1, totalFollowers: 1500, platformsActive: ["instagram"], linksBroken: ["https://tiktok.example/x1"] } });
    put(full, "research/ads.json", { rows: [row({})], summary: { advertisers: [{ advertiser: "x1.example", librariesChecked: 2, running: false, adCount: 0 }], advertisersChecked: 3, advertisersRunning: 1, clientRunning: false, competitorsRunning: 1 } });
    const { r: rF, md: mdF, json: jF } = report(full, BASE_ENV);
    const secF = section(mdF, 7);
    check("X", "report.md has a section 7 with a block for each of the seven sources that has data: " + "real-visitor speed, pages in the index, search interest, AI answers, reviews, social profiles, ads", rF.status === 0 && ["Real-visitor speed", "Pages in the search index", "Search interest", "AI answers", "Reviews", "Social profiles", "Ads"].every((h) => secF.includes("### " + h)), rF.stderr + secF.slice(0, 400));
    check("X", "with all seven present the section holds no BLOCKED line", !/BLOCKED/.test(secF), secF.slice(0, 400));
    check("X", "crux: the url's phone figures (LCP 2.3 s, INP 180 ms, CLS 0.04) and the origin's 'no data' (too little traffic) are both said, with the collection period", /LCP 2\.3 s/.test(secF) && /INP 180 ms/.test(secF) && /CLS 0\.04/.test(secF) && /no data/i.test(secF) && /too little traffic/.test(secF) && /2026-09-01/.test(secF), secF.slice(0, 700));
    check("X", "index: Google 230 pages, Bing 'not shown' (never 0), 3 of 4 services listed and the missing one named", /230/.test(secF) && /not shown/.test(secF) && /3 of 4/.test(secF) && /bridge loans/.test(secF), secF.slice(0, 900));
    check("X", "trends: the best and worst ranked service are named with their ranks", /hard money loans/.test(secF) && /rank 2/.test(secF) && /bridge loans/.test(secF) && /rank 31/.test(secF), secF.slice(0, 900));
    check("X", "AI answers: share named (17%), the engine that was blocked (gemini, sign-in wall), the competitor named most", /17%/.test(secF) && /gemini/.test(secF) && /sign-in wall/.test(secF) && /Acme Lending/.test(secF), secF.slice(0, 900));
    check("X", "reviews, social and ads: 41 reviews at 4.6, 2 profiles read with the broken link named, 1 of 3 advertisers running", /41 reviews/.test(secF) && /4\.6/.test(secF) && /tiktok\.example/.test(secF) && /1 of 3/.test(secF), secF.slice(0, 1200));
    check("X", "every block says where its data came from (the file) and when it was captured (the date)", ["crux/" + DAY + ".json", "research/index.json", "research/trends.json", "research/ai-answers.json", "research/reputation.json", "research/social.json", "research/ads.json"].every((p) => secF.includes(p)) && (secF.match(/2026-10-24/g) || []).length >= 7, secF.slice(0, 600));
    check("X", "report.json carries the same: extras.<id> with status 'answered' and the source file, for all seven", ["crux", "index", "trends", "ai", "reputation", "social", "ads"].every((k) => jF?.extras?.[k]?.status === "answered" && typeof jF.extras[k].source === "string"), JSON.stringify(jF?.extras || null).slice(0, 400));

    const bare0 = snapshot("x2.example", { pages: [{ path: "/", slug: "home", lcp: 1500 }] });
    const { r: rB, md: mdB, json: jB } = report(bare0, BASE_ENV);
    const secB = section(mdB, 7), blockedB = secB.split("\n").filter((l) => /BLOCKED/.test(l));
    check("X", "with none of the seven present the section says BLOCKED seven times, each with '| unblocks:' and the script that would fill it (crux.mjs, import-index.mjs, import-trends.mjs, import-ai.mjs, import-reputation.mjs, import-social.mjs, import-ads.mjs)", rB.status === 0 && blockedB.length === 7 && blockedB.every((l) => / \| unblocks: /.test(l)) && ["crux.mjs", "import-index.mjs", "import-trends.mjs", "import-ai.mjs", "import-reputation.mjs", "import-social.mjs", "import-ads.mjs"].every((n) => blockedB.some((l) => l.includes(n))), rB.stderr + secB.slice(0, 900));
    check("X", "a source with no data is never shown as zero (no '0 pages', '0 reviews', '0%' in the empty section) and report.json says BLOCKED for each", !/\b0 (pages|reviews|profiles|advertisers)|\b0%/.test(secB) && ["crux", "index", "trends", "ai", "reputation", "social", "ads"].every((k) => jB?.extras?.[k]?.status === "BLOCKED" && / /.test(jB.extras[k].unblock || "")), JSON.stringify(jB?.extras || null).slice(0, 400));

    const mix = snapshot("x3.example", { pages: [{ path: "/", slug: "home", lcp: 1500 }] });
    put(mix, "crux/" + DAY + ".json", { generatedAt: ISO, failures: [], rows: [{ scope: "url", target: "https://x3.example/", formFactor: "PHONE", status: "no data", metrics: null, collectionPeriod: null, fetchedAt: ISO, cacheFile: null }] });
    put(mix, "research/reputation.json", { rows: [], staleCount: 0, summary: { subjects: [] } });
    put(mix, "research/index.json", { rows: [row({ engine: "google", stale: true })], staleCount: 1, summary: { google: { indexedCount: 5, listedUrls: 5 }, bing: { indexedCount: 4, listedUrls: 4 }, servicesChecked: 2, servicesListed: 2, servicesMissing: [] } });
    const { md: mdM, json: jM } = report(mix, BASE_ENV);
    const secM = section(mdM, 7);
    check("X", "crux with only 'no data' rows is a result, not BLOCKED: it says no data / too little traffic, and report.json status is 'no data'", /too little traffic/.test(secM) && jM?.extras?.crux?.status === "no data", JSON.stringify(jM?.extras?.crux));
    check("X", "an importer file with no rows is BLOCKED (nothing usable was read), not a block of zeros", jM?.extras?.reputation?.status === "BLOCKED" && /Reviews[\s\S]*BLOCKED/.test(secM), JSON.stringify(jM?.extras?.reputation));
    check("X", "a stale capture is shown as stale with its count", /stale/i.test(secM.split("### Pages in the search index")[1] || ""), secM.slice(0, 700));
  }

  // =============================== C: the checker's result where the manifest's checker step writes it (SKILL-REPORT-1) ===============================
  if (want("C")) {
    const cause = (id, severity, problem, pages) => ({ id, severity, rules: ["MET-001"], problem, fix: "fix it", pages, fixAt: ["index.html"], scripts: [] });
    const ck = (host, work = true) => {
      const s0 = snapshot(host, { pages: [{ path: "/", slug: "home", lcp: 1500 }] }), wk = path.join(root, "site-checks", host, "work", "checker", ".checks");
      w(path.join(s0.sd, ".checks", "causes.json"), [cause("S01", "low", "snapshot copy cause", 1)]); w(path.join(s0.sd, ".checks", "plan.json"), { createdAt: "2026-10-24T11:00:00Z" });
      if (work) { w(path.join(wk, "causes.json"), [cause("W01", "critical", "work copy cause one", 5), cause("W02", "high", "work copy cause two", 2), cause("W03", "medium", "work copy cause three", 1)]); w(path.join(wk, "plan.json"), { createdAt: "2026-11-01T09:00:00Z" }); }
      return { ...s0, wk };
    };
    const rc = (c) => c.json?.questions?.[0]?.facts?.rootCauses, last = (c) => String(c.r.stdout || "").trim().split("\n").pop();
    const none = (s0) => !fs.existsSync(path.join(s0.pewp, "report.json")) && !fs.existsSync(path.join(s0.pewp, "report.md"));
    const BL = /^BLOCKED: no readable checker result at .*causes\.json \(a list of root causes\) \| unblocks: the checker step of pipeline\.json writes it there; run that step, then report-live again$/;
    const s1 = ck("c1.example"), c1 = report(s1, BASE_ENV);
    check("C", "C1 without --checks the snapshot's own .checks is read as before: 1 cause, cacheFile snapshots/2026-10-24/.checks/causes.json, dated by that plan.json (control)", c1.r.status === 0 && rc(c1)?.value?.total === 1 && rc(c1).cacheFile === "snapshots/2026-10-24/.checks/causes.json" && rc(c1).fetchedAt === "2026-10-24T11:00:00Z", JSON.stringify(rc(c1)) + c1.r.stderr);
    const s2 = ck("c2.example"), c2 = report(s2, BASE_ENV, ["--checks", s2.wk]);
    check("C", "C2 with --checks the checker step's result is read: 3 causes by severity, cacheFile work/checker/.checks/causes.json, dated by that folder's plan.json", c2.r.status === 0 && JSON.stringify(rc(c2)?.value) === '{"total":3,"critical":1,"high":1,"medium":1,"low":0}' && rc(c2).cacheFile === "work/checker/.checks/causes.json" && rc(c2).fetchedAt === "2026-11-01T09:00:00Z", JSON.stringify(rc(c2)) + c2.r.stderr);
    check("C", "C2 questions 1 and 6 carry those causes: 'found 3 root causes: 1 critical, 1 high, 1 medium, 0 low', fix order W01, W02, W03, the short answer '3 root causes (2 serious)', nothing of the snapshot's copy", /found 3 root causes: 1 critical, 1 high, 1 medium, 0 low/.test(c2.md) && (c2.json?.questions?.[5]?.fixes || []).map((f) => f.cause).join() === "W01,W02,W03" && /the checker found 3 root causes \(2 serious\)/.test(c2.json?.shortAnswer || "") && !c2.md.includes("snapshot copy cause"), section(c2.md, 6).slice(0, 600));
    const s3 = ck("c3.example", false), c3a = report(s3, BASE_ENV, ["--checks", s3.wk]);
    w(path.join(s3.wk, "causes.json"), "{ not json"); const c3b = report(s3, BASE_ENV, ["--checks", s3.wk]);
    check("C", "C3 with --checks and no causes.json there, or one that is not JSON: exit 3, the last line is the BLOCKED line naming the checker step, no report written (the snapshot's copy is not used instead)", [c3a, c3b].every((c) => c.r.status === 3 && BL.test(last(c))) && none(s3), `${c3a.r.status} ${last(c3a)} | ${c3b.r.status} ${last(c3b)}`);
    const s4 = ck("c4.example", false); w(path.join(s4.wk, "causes.json"), { causes: [] }); const c4 = report(s4, BASE_ENV, ["--checks", s4.wk]);
    check("C", "C4 with --checks and a causes.json that is JSON but not a list: the same BLOCKED line, exit 3, no report", c4.r.status === 3 && BL.test(last(c4)) && none(s4), `${c4.r.status} ${last(c4)} ${c4.r.stderr.slice(0, 200)}`);
    const s5 = ck("c5.example"), c5a = report(s5, BASE_ENV, ["--checks"]), c5b = report(s5, BASE_ENV, ["--checks", "--launch-state", "live"]);
    check("C", "C5 --checks with no folder (the last argument, or another option next) is a usage error: exit 2, the usage line names [--checks DIR], no report", [c5a, c5b].every((c) => c.r.status === 2 && /\[--checks DIR\]/.test(c.r.stderr)) && none(s5), `${c5a.r.status} ${c5a.r.stderr} | ${c5b.r.status} ${c5b.r.stderr}`);
  }

  function firstOf(sec) { return sec.split("\n").map((l) => l.trim()).find(Boolean) || ""; }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return results;
}

// ---------------- mutants: [name, file (from the skill root), from, to, groups to run, assertions that must go red] ----------------
const S0 = "scripts/report-live.mjs", PS = "scripts/plan-site.mjs", PP = "scripts/plan-picture.mjs";
const MUTANTS = [
  { name: "W: summary.md calls the plan the sitemap", file: PS, from: "This is the page plan (the file plan/sitemap.json)", to: "This is the sitemap (the file plan/sitemap.json)", sc: "W", expect: [/^W: summary\.md names the blueprint/] },
  { name: "W: summary.md forgets the sitemap file", file: PS, from: "It is not the sitemap file search engines read (sitemap.xml); that file is made later", to: "It is not the other file; that file is made later", sc: "W", expect: [/^W: summary\.md says the sitemap file/] },
  { name: "W: report.md says sitemap for the file", file: S0, from: '`- ${term("sitemap file")}: ${sitemaps.urlCount ?? 0} addresses listed`,', to: '`- ${term("sitemap")}: ${sitemaps.urlCount ?? 0} addresses listed`,', sc: "W", expect: [/^W: report\.md: no bare/, /^W: report\.md: the missing sitemap/] },
  { name: "W: the problem line says sitemap", file: S0, from: 'problemsQ1.push("no sitemap file (sitemap.xml) was found")', to: 'problemsQ1.push("no sitemap was found")', sc: "W", expect: [/^W: report\.md: no bare/, /^W: report\.md: the missing sitemap/] },
  { name: "W: build.md says sitemap pages", file: "stages/build.md", from: "The pages of the page plan (`plan/sitemap.json`) are read as", to: "The sitemap pages are read as", sc: "W", expect: [/^W: stages\/plan\.md, gate\.md, build\.md/] },
  { name: "W: plan.md no longer mentions the picture", file: "stages/plan.md", from: "`node scripts/plan-picture.mjs <pewp dir> [--out-dir DIR]`", to: "`draw it`", sc: "W", expect: [/^W: stages\/plan\.md tells the main session/] },
  { name: "P: a page is not drawn", file: PP, from: "  for (const p of view) {\n    const b = boxes.get(p.path);\n    const fill", to: "  for (const p of view.slice(1)) {\n    const b = boxes.get(p.path);\n    const fill", sc: "P", expect: [/^P: the SVG holds a box for every planned path/, /^P: a big plan: 17 pages all drawn/] },
  { name: "P: NEW label is always EXISTING", file: PP, from: '${p.isNew ? "NEW" : "EXISTING"}</text>`);', to: '${"EXISTING"}</text>`);', sc: "P", expect: [/^P: the SVG says NEW/] },
  { name: "P: volume never shown", file: PP, from: "const v = cluster?.volume;", to: "const v = null;", sc: "P", expect: [/^P: the SVG shows each page's target search and its volume/] },
  { name: "P: no lines to parents", file: PP, from: "if (!b || !pb || pb === b) continue;", to: "continue;", sc: "P", expect: [/^P: a line joins every page to its parent/] },
  { name: "P: the table loses a row", file: PP, from: "...view.map((p) => `| ${mdCell(p.path)}", to: "...view.slice(1).map((p) => `| ${mdCell(p.path)}", sc: "P", expect: [/^P: page-plan\.md: a header and one row per page/] },
  { name: "P: eight boxes in a row", file: PP, from: "PER_ROW = 6,", to: "PER_ROW = 8,", sc: "P", expect: [/^P: a big plan: 17 pages all drawn, at most 6/] },
  { name: "P: text is not wrapped", file: PP, from: "const CHARS = 27; ", to: "const CHARS = 270;", sc: "P", expect: [/^P: a big plan: long search text/] },
  { name: "P: text is not escaped", file: PP, from: 'const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")', to: 'const esc = (x) => String(x ?? "").replace(/&/g, "&").replace(/</g, "<")', sc: "P", expect: [/^P: a big plan: '&' and '<'/] },
  { name: "P: children are not placed below their parent", file: PP, from: "const d = par && par !== p ? depthOf(par, seen) + 1 : 1;", to: "const d = 1;", sc: "P", expect: [/^P: a big plan: the home is on top/] },
  { name: "P: the summary line counts every page as new", file: PP, from: "${pic.newCount} new`);", to: "${pic.pages} new`);", sc: "P", expect: [/^P: plan-picture runs on the fixture plan/] },
  { name: "P: the BLOCKED line changes", file: PP, from: '"PNG BLOCKED: no Chrome (set CHROME_PATH); SVG and table written" :', to: '"PNG skipped" :', sc: "P", expect: [/^P: without Chrome: the BLOCKED line/] },
  { name: "P: a stale PNG is left in place", file: PP, from: "fs.rmSync(pngFile, { force: true });", to: "", sc: "P", expect: [/^P: without Chrome: the BLOCKED line/] },
  { name: "P: --out-dir ignored", file: PP, from: 'const outDir = path.resolve(opt("--out-dir", path.join(pewp, "plan")));', to: 'const outDir = path.join(pewp, "plan");', sc: "P", expect: [/^P: --out-dir writes the files there/] },
  { name: "P: a missing page plan exits 0", file: PP, from: "(${e.code === \"ENOENT\" ? \"missing: run plan-site.mjs first\" : e.message})`); return 2; }", to: "(${e.code === \"ENOENT\" ? \"missing: run plan-site.mjs first\" : e.message})`); return 0; }", sc: "P", expect: [/^P: missing inputs exit 2/] },
  { name: "N: the screenshot is a JPEG", file: PP, from: 'format: "png"', to: 'format: "jpeg"', sc: "N", needsChrome: true, expect: [/^N: \[branch: Chrome found/] },
  { name: "N: the picture is never rendered", file: PP, from: "const r = await renderPng(svgFile, pngFile, pic.width, pic.height);", to: 'const r = { ok: false, reason: "no Chrome" };', sc: "N", needsChrome: true, expect: [/^N: \[branch: Chrome found/] },
  { name: "A: the flag is ignored", file: PS, from: 'if (args.includes("--require-approved-business") && !businessApproved()) {', to: 'if (false) {', sc: "A", expect: [/^A: no approval: refused/, /^A: business\.json changed after/] },
  { name: "A: any business counts as approved", file: PS, from: 'return approveLib.approvedMatches(pewp, "business").ok === true;', to: 'return true;', sc: "A", expect: [/^A: no approval: refused/, /^A: business\.json changed after/] },
  { name: "A: the refusal exits 0", file: PS, from: '(or intake again if it changed)");\n  process.exit(1);', to: '(or intake again if it changed)");\n  process.exit(0);', sc: "A", expect: [/^A: no approval: refused/] },
  { name: "A: the refusal is applied without the flag", file: PS, from: 'if (args.includes("--require-approved-business") && !businessApproved()) {', to: 'if (!businessApproved()) {', sc: "A", expect: [/^A: without the flag nothing changes/] },
  { name: "D: a stale doctor result is never detected", file: S0, from: "return { stale: why.length > 0, hashed: true, why };", to: "return { stale: false, hashed: true, why };", sc: "D", expect: [/^D: env file changed since doctor/, /^D: token file changed/, /^D: service account file differs/, /^D: stale: the old per-source text/] },
  { name: "D: the env file hash is ignored", file: S0, from: "envFileSha1: sha1Of(envFile),", to: "envFileSha1: inp.envFileSha1,", sc: "D", expect: [/^D: env file changed since doctor/] },
  { name: "D: the token file hash is ignored", file: S0, from: 'tokenFileSha1: sha1Of(val("GSC_TOKEN_FILE") || path.join(os.homedir(), ".config", "pewp", "gsc-token.json"))', to: "tokenFileSha1: inp.tokenFileSha1", sc: "D", expect: [/^D: token file changed/] },
  { name: "D: the service account hash is ignored", file: S0, from: 'serviceAccountFileSha1: sha1Of(val("GSC_SERVICE_ACCOUNT_FILE"))', to: "serviceAccountFileSha1: inp.serviceAccountFileSha1", sc: "D", expect: [/^D: service account file differs/] },
  { name: "D: the date of the doctor result is not shown", file: S0, from: ": doctorDate ? [`Source status below is from the doctor result of", to: ": false ? [`Source status below is from the doctor result of", sc: "D", expect: [/^D: same hashes/, /^D: an older doctor\.json/] },
  { name: "D: the sources lines carry no date", file: S0, from: '`What unblocks it${doctorDate && !doctorStale ?', to: '`What unblocks it${false ?', sc: "D", expect: [/^D: the sources lines carry the date too/] },
  { name: "D: a stale result still prints the old statuses", file: S0, from: "const srcStatus = (id) => (doctorStale ?", to: "const srcStatus = (id) => (false ?", sc: "D", expect: [/^D: stale: the old per-source text/] },
  { name: "D: the STALE line is not at the top of section 2", file: S0, from: "  ...doctorLines,\n  ...q2Lines(),", to: "  ...q2Lines(),\n  ...doctorLines,", sc: "D", expect: [/^D: env file changed since doctor/, /^D: token file changed/, /^D: service account file differs/] },
  { name: "S: an UNTRUSTED lab run is not recognised", file: S0, from: 'const isUntrusted = (p) => /^UNTRUSTED/i.test(String(p?.speedTrust || ""));', to: "const isUntrusted = (p) => false;", sc: "S", expect: [/^S: a busy machine/, /^S: lab and PSI side by side/, /^S: UNTRUSTED lab speed and no PSI/] },
  { name: "S: the oldest PSI file is used", file: S0, from: ".filter(Boolean).sort().reverse() : [];", to: ".filter(Boolean).sort() : [];", sc: "S", expect: [/^S: the newest PSI file is used/] },
  { name: "S: PSI is never the trusted number", file: S0, from: 'const trusted = lab && !isUntrusted(lab) ? "lab and PSI" : "PSI";', to: 'const trusted = "lab and PSI";', sc: "S", expect: [/^S: lab and PSI side by side/] },
  { name: "S: a trusted lab run is shown as PSI only", file: S0, from: 'const trusted = lab && !isUntrusted(lab) ? "lab and PSI" : "PSI";', to: 'const trusted = "PSI";', sc: "S", expect: [/^S: a page whose lab run was trusted/, /^S: a quiet machine/] },
  { name: "S: the machine load line is dropped", file: S0, from: "if (machineLoad) speedTrustLines.push(", to: "if (false) speedTrustLines.push(", sc: "S", expect: [/^S: a busy machine/, /^S: a quiet machine/] },
  { name: "S: PSI is left out of report.json", file: S0, from: "if (psiRows.length) q1Facts.psiSpeed =", to: "if (false) q1Facts.psiSpeed =", sc: "S", expect: [/^S: the newest PSI file is used/, /^S: report\.json carries the trust/] },
  { name: "S: the untrusted lab speed is still a finding", file: S0, from: "if (labUntrusted) {\n  problemsQ1.push(", to: "if (false) {\n  problemsQ1.push(", sc: "S", expect: [/^S: the untrusted lab speed is not counted/] },
  { name: "S: PSI's own slow phone speed is not reported", file: S0, from: "psiMedianLcp != null && psiMedianLcp > 2500", to: "psiMedianLcp != null && psiMedianLcp > 25000000", sc: "S", expect: [/^S: the untrusted lab speed is not counted/] },
  { name: "S: PSI rows are not read", file: S0, from: 'const psiRows = ((psiFile && J(psiFile))?.pages || []).filter((r) => r && r.url);', to: "const psiRows = [];", sc: "S", expect: [/^S: lab and PSI side by side/, /^S: a page whose lab run was trusted/, /^S: a quiet machine/] },
  { name: "S: a quiet machine is called untrusted", file: S0, from: 'const untrustedPages = measured.filter(isUntrusted);', to: "const untrustedPages = measured;", sc: "S", expect: [/^S: a quiet machine/] },
  { name: "Q: the target not in the graph is 0 again", file: S0, from: "referringDomains: f(me.inGraph ? me.linkingDomains : null),", to: "referringDomains: f(me.inGraph ? me.linkingDomains : 0),", sc: "Q", expect: [/^Q: target not in the graph/] },
  { name: "Q: a competitor not in the graph is 0 again", file: S0, from: "referringDomains: c.inGraph ? c.linkingDomains : null,", to: "referringDomains: c.inGraph ? c.linkingDomains : 0,", sc: "Q", expect: [/^Q: competitors: the one in the graph/] },
  { name: "Q: a competitor with no role is dropped again", file: S0, from: "const comps = auth.results.filter((r) => r !== me);", to: 'const comps = auth.results.filter((r) => r.role === "competitor");', sc: "Q", expect: [/^Q: competitors: the one in the graph/, /^Q: section 4 says/] },
  { name: "Q: inGraph false is not recorded", file: S0, from: "inGraph: f(!!me.inGraph),", to: "inGraph: f(true),", sc: "Q", expect: [/^Q: target not in the graph/, /^Q: section 4 says/, /^Q: the short answer says/] },
  { name: "Q: section 4 prints a competitor not in the graph as a count", file: S0, from: "c.inGraph === false ? `- Competitor ${c.domain}: ${NOT_IN_GRAPH}`", to: "false ? `- Competitor ${c.domain}: ${NOT_IN_GRAPH}`", sc: "Q", expect: [/^Q: section 4 says/] },
  { name: "Q: section 4 prints the target not in the graph as a count", file: S0, from: "    ? [inGraphQ4 ? `- ${term(", to: "    ? [true ? `- ${term(", sc: "Q", expect: [/^Q: section 4 says/] },
  { name: "Q: section 4 says none for the strongest linkers of a site not found", file: S0, from: 'inGraphQ4 ? q4.strongestLinkers.join(", ") || "none" : NOT_IN_GRAPH}', to: 'q4.strongestLinkers.join(", ") || "none"}', sc: "Q", expect: [/^Q: section 4: a competitor in the graph/] },
  { name: "Q: the short answer counts the null", file: S0, from: '"" : inGraphQ4 ? `; ${q4.facts.referringDomains.value} other websites', to: '"" : true ? `; ${q4.facts.referringDomains.value} other websites', sc: "Q", expect: [/^Q: the short answer says/] },
  { name: "Q: question 5's why sentence counts the null", file: S0, from: '"" : inGraphQ4 ? ` (${q4.facts.referringDomains.value} referring domain', to: '"" : true ? ` (${q4.facts.referringDomains.value} referring domain', sc: "Q", expect: [/^Q: question 5's 'why' sentence/] },
  { name: "Q: the change line drops a site not found", file: S0, from: "if (f4.inGraph?.value === false) out.refdom =", to: "if (false) out.refdom =", sc: "Q", expect: [/^Q: since the last report, counted -> not found/, /^Q: since the last report, not found -> counted/] },
  { name: "Q: the change line prints the null as a number", file: S0, from: "(m.notFound ? NOT_IN_GRAPH : m.pct", to: "(m.pct", sc: "Q", expect: [/^Q: since the last report, counted -> not found/, /^Q: since the last report, not found -> counted/] },
  { name: "Q: the link gap line claims 'not to you' for a site not found", file: S0, from: "       inGraphQ4 ? `- ${term(\"link gap\")}:", to: "       true ? `- ${term(\"link gap\")}:", sc: "Q", expect: [/^Q: target not in the graph: the link gap line/] },
  { name: "Q: the links plan row claims 'but not to you' for a site not found", file: S0, from: "plan.push(inGraphQ4\n  ?", to: "plan.push(true\n  ?", sc: "Q", expect: [/^Q: target not in the graph: the 'links' plan row/] },
  { name: "Q: the links plan row is proved by referring domains rising for a site not found", file: S0, from: 'provedBy: "this site appears in the next authority run (it is found in the link data)" }', to: 'provedBy: "referring domains rise in the next authority run" }', sc: "Q", expect: [/^Q: target not in the graph: the 'links' plan row/] },
  { name: "Q: the links plan row for a site in the graph is proved by the site appearing", file: S0, from: 'provedBy: "referring domains rise in the next authority run" }\n  :', to: 'provedBy: "this site appears in the next authority run (it is found in the link data)" }\n  :', sc: "Q", expect: [/^Q: target in the graph: the link gap line and the 'links' plan row/] },
  { name: "G: --group is ignored", file: "scripts/test-reports.mjs", from: "  const main = await runScenarios(skill0, " + "groups);", to: "  const main = await runScenarios(skill0, null);", sc: "G", expect: [/^G: --group A,D runs only/] },
  { name: "G: an unknown group letter is accepted", file: "scripts/test-reports.mjs", from: "if (bad.length || " + "!gs.length) throw new Error(", to: "if (false) throw new Error(", sc: "G", expect: [/^G: --group with an unknown letter/] },
  { name: "G: a mutant outside the chosen groups still runs", file: "scripts/test-reports.mjs", from: '!groups || m.sc.split("+").' + 'every((g) => groups.includes(g))', to: "true", sc: "G", expect: [/^G: --group selects mutants too/] },
  { name: "G: --keep is back in the usage line", file: "scripts/test-reports.mjs", from: '[--group <letter>[,<letter>]]"); ' + 'process.exit(0); }', to: '[--keep]"); process.exit(0); }', sc: "G", expect: [/^G: usage lines/] },
  { name: "X: the crux file is never read", file: S0, from: "const cdoc = cfile ? J(path.join(cdir, cfile)) : null;", to: "const cdoc = null;", sc: "X", expect: [/^X: with all seven present the section holds no BLOCKED line/, /^X: crux: the url's phone figures/, /^X: report\.json carries the same/] },
  { name: "X: a BLOCKED line has no 'unblocks'", file: S0, from: "**BLOCKED.** ${x.why} | unblocks: ${x.unblock}", to: "**BLOCKED.** ${x.why}", sc: "X", expect: [/^X: with none of the seven present/] },
  { name: "X: an importer file with no rows counts as data", file: S0, from: "if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) { out.push(blockedOf(imp.id,", to: "if (!doc || !Array.isArray(doc.rows)) { out.push(blockedOf(imp.id,", sc: "X", expect: [/^X: an importer file with no rows is BLOCKED/] },
  { name: "X: an engine count that is not shown becomes 0", file: S0, from: "v == null ? \"not shown\"", to: "v == null ? \"0\"", sc: "X", expect: [/^X: index: Google 230 pages/] },
  { name: "X: crux with only no-data rows is BLOCKED", file: S0, from: "status: data ? \"answered\" : \"no data\"", to: "status: data ? \"answered\" : \"BLOCKED\"", sc: "X", expect: [/^X: crux with only 'no data' rows is a result/] },
  { name: "X: the source file and capture date are left out", file: S0, from: "Source: ${x.source}, captured ${dayTxt(x.capturedAt)}", to: "Source:", sc: "X", expect: [/^X: every block says where its data came from/] },
  { name: "X: stale captures are not counted", file: S0, from: "${x.stale ? `; ${x.stale} capture${s(x.stale)} stale (older than the freshness limit: capture again)` : \"\"}", to: "", sc: "X", expect: [/^X: a stale capture is shown as stale/] },
  { name: "X: report.json has no extras", file: S0, from: "extras: Object.fromEntries(extras.map(({ id, lines, ...rest }) => [id, rest])),", to: "extras: {},", sc: "X", expect: [/^X: report\.json carries the same/, /^X: a source with no data is never shown as zero/] },
  { name: "X: the AI engines that could not be read are hidden", file: S0, from: "if ((y.blockedEngines || []).length) L.push(", to: "if (false) L.push(", sc: "X", expect: [/^X: AI answers: share named/] },
  { name: "X: the ads block is missing", file: S0, from: "{ id: \"ads\", title: \"Ads\",", to: "{ id: \"adsX\", title: \"Ads\",", sc: "X", expect: [/^X: report\.json carries the same/, /^X: a source with no data is never shown as zero/] },
  { name: "X: the trends rank of the weakest service is left out", file: S0, from: "(rank ${y.worstRank?.stateRank ?? \"n/a\"})", to: "", sc: "X", expect: [/^X: trends: the best and worst ranked service/] },
  { name: "C: --checks is ignored (the snapshot's .checks is read)", file: S0, from: 'path.join(checksDir || path.join(snapDir, ".checks"), "causes.json")', to: 'path.join(snapDir, ".checks", "causes.json")', sc: "C", expect: [/^C: C2 with --checks/, /^C: C2 questions 1 and 6/, /^C: C3 /] },
  { name: "C: plan.json is read from the snapshot", file: S0, from: 'J(path.join(path.dirname(causesFile), "plan.json"))', to: 'J(path.join(snapDir, ".checks", "plan.json"))', sc: "C", expect: [/^C: C2 with --checks/] },
  { name: "C: a missing checker result is not BLOCKED", file: S0, from: "if (checksDir && !Array.isArray(causes)) {", to: "if (false) {", sc: "C", expect: [/^C: C3 /, /^C: C4 /] },
  { name: "C: a causes.json that is not a list passes", file: S0, from: "!Array.isArray(causes)) {", to: "causes === null) {", sc: "C", expect: [/^C: C4 /] },
  { name: "C: a BLOCKED checker result exits 1", file: S0, from: "then report-live again`); process.exit(3); }", to: "then report-live again`); process.exit(1); }", sc: "C", expect: [/^C: C3 /, /^C: C4 /] },
  { name: "C: --checks with no folder falls back to the snapshot", file: S0, from: ' || (a.includes("--checks") && !/^[^-]/.test(opt("--checks") || ""))', to: "", sc: "C", expect: [/^C: C5 /] },
];

const mutantsIn = (groups) => MUTANTS.filter((m) => !groups || m.sc.split("+").every((g) => groups.includes(g))); // all of a mutant's groups must be chosen

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-reports.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--group <letter>[,<letter>]]"); process.exit(0); }
  let groups = null;
  if (A.includes("--group")) { try { groups = parseGroups(opt("--group")); } catch (e) { console.error(e.message); process.exit(2); } }
  const skill0 = path.dirname(scriptsDir0);
  const main = await runScenarios(skill0, groups);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
  let failed = main.filter((r) => !r.ok).length;
  const branch = main.find((r) => r.branch)?.branch;
  console.log(`PNG branch taken on this machine: ${branch === "chrome" ? "Chrome found, a real PNG was rendered and checked" : branch === "no-chrome" ? "no Chrome, the BLOCKED line was checked" : "not run"}`);
  console.log(failed ? `REPORTS TEST FAIL: ${failed} of ${main.length}` : `REPORTS TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    const cdp0 = await import(pathToFileURL(path.join(scriptsDir0, "cdp-measure.mjs")).href);
    for (const mu of mutantsIn(groups).filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      if (mu.needsChrome && !cdp0.CHROME_PATH) { console.log(`SKIP (no Chrome on this machine) ${mu.name}`); continue; }
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-reports-mutant-"));
      for (const d of ["scripts", "rules", "checklist", "schemas", "fixtures", "stages"]) fs.cpSync(path.join(skill0, d), path.join(mdir, d), { recursive: true });
      const target = path.join(mdir, mu.file), src = fs.readFileSync(target, "utf8"), count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      if (target.endsWith(".mjs")) { const chk = spawnSync(nodeBin, ["--check", target], { encoding: "utf8", timeout: 60_000 }); if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; } }
      const res = await runScenarios(mdir, mu.sc.split("+"));
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  process.exit(failed ? 1 : 0);
}
