// Usage: node test-freshness.mjs [--no-mutants] [--mutant <name part>] [--keep]
// Proof of the no-fake-freshness rules (IDX-003, SE-004, AEO-012): lib-freshness.mjs, check-stability.mjs, the built-in check
// checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs, gate GT-013 (gate-freshness.mjs) and merge.mjs copying the built-ins.
// Fixtures: fixtures/freshness-sites.mjs (tiny git repos whose build stamps the clock, or reads a committed ledger).
// Mutants: each breaks the code one assertion guards, in a copy of the skill; the named assertions must go red. Exit 0 = all green, all caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const run = (cwd, file, args = [], ms = 180_000) => {
  const r = spawnSync(node, [file, ...args], { cwd, encoding: "utf8", timeout: ms, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error?.code === "ETIMEDOUT" ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", timeout: 60_000 });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

let results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail) });

async function suite(skill) {
  results = [];
  const S = (f) => path.join(skill, "scripts", f);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-fresh-"));
  try {
    const { makeFreshnessSites } = await import(pathToFileURL(path.join(skill, "fixtures", "freshness-sites.mjs")).href + `?u=${Math.random()}`);
    const sites = makeFreshnessSites(path.join(tmp, "sites"));
    const stab = (name, extra = []) => run(sites[name], S("check-stability.mjs"), [sites[name], "--build", "node build.mjs", ...extra]);
    const clean = (dir) => git(dir, "status", "--porcelain").stdout.trim() === "";

    // ---- check-stability: two builds of the same commit ----
    const cs = stab("clock-sitemap");
    check("stability: a sitemap whose lastmod is the build clock FAILS (IDX-003/AEO-012) with URL, field and both values", cs.code === 1 && /FAIL IDX-003\/AEO-012 https:\/\/fixture\.example\/about\/ sitemap <lastmod>: build 1 "2\d{3}-[^"]+" vs build 2 "2\d{3}-[^"]+"/.test(cs.out), cs.out);
    check("stability: the working tree is restored to the commit afterwards (tracked output rewritten by the builds is put back)", clean(sites["clock-sitemap"]) && /working tree is restored/.test(cs.out), git(sites["clock-sitemap"], "status", "--porcelain").stdout + cs.out);
    const sec = stab("clock-seconds");
    check("stability: a build clock with whole seconds still FAILS (the second build starts more than 1 s after the first)", sec.code === 1 && /sitemap <lastmod>: build 1/.test(sec.out), sec.out);
    const jl = stab("clock-jsonld");
    check("stability: JSON-LD dateModified inside @graph stamped at build time FAILS", jl.code === 1 && /dist\/about\/index\.html JSON-LD dateModified: build 1/.test(jl.out), jl.out);
    const mt = stab("clock-meta");
    check("stability: <meta property=article:modified_time> stamped at build time FAILS", mt.code === 1 && /<meta article:modified_time>: build 1/.test(mt.out), mt.out);
    const lg = stab("ledger", ["--out", path.join(tmp, "out-ledger")]);
    check("stability: dates from a committed ledger PASS (sitemap + JSON-LD compared)", lg.code === 0 && /^PASS stability/.test(lg.out) && /18 date field\(s\) compared/.test(lg.out), lg.out);
    check("stability: --out writes stability.json and stability.txt", fs.existsSync(path.join(tmp, "out-ledger", "stability.json")) && /PASS stability/.test(fs.readFileSync(path.join(tmp, "out-ledger", "stability.txt"), "utf8")));
    const dO = stab("date-only");
    check("stability: a date-only lastmod FAILS SE-004 (even though it is stable)", dO.code === 1 && /FAIL SE-004 https:\/\/fixture\.example\/ sitemap <lastmod> "2026-01-10": date-only/.test(dO.out), dO.out);
    const fu = stab("future");
    check("stability: a lastmod more than a day in the future FAILS SE-004", fu.code === 1 && /sell\/ sitemap <lastmod> "2031-01-01T00:00:00Z": in the future/.test(fu.out), fu.out);
    const tz = stab("no-tz");
    check("stability: a lastmod without a timezone FAILS SE-004", tz.code === 1 && /"2026-01-10T09:30:00": no timezone/.test(tz.out), tz.out);
    const ix = stab("index");
    check("stability: a sitemap index is followed on disk to its child (maps/pages.xml) and the clock there FAILS", ix.code === 1 && /https:\/\/fixture\.example\/about\/ sitemap <lastmod>: build 1/.test(ix.out), ix.out);
    const no = stab("none");
    check("stability: no sitemap and no date fields PASS with a note", no.code === 0 && /no sitemap and no date fields/.test(no.out), no.out);
    const nd = stab("nondeterministic");
    check("stability: another file that differs between builds is a WARN, not a FAIL", nd.code === 0 && /WARN non-deterministic build: dist\/build-id\.txt/.test(nd.out), nd.out);
    // a build that leaves a NEW untracked file: removed by the restore
    const ex = makeFreshnessSites(path.join(tmp, "extra"), ["ledger"]).ledger;
    w(path.join(ex, "extra.mjs"), 'import fs from "node:fs";\nfs.writeFileSync("dist/extra-" + Date.now() + ".txt", "x\\n");\n');
    git(ex, "add", "-A"); git(ex, "-c", "user.name=f", "-c", "user.email=f@localhost", "commit", "-q", "-m", "extra");
    const exr = run(ex, S("check-stability.mjs"), [ex, "--build", "node build.mjs && node extra.mjs"]);
    check("stability: new untracked files a build leaves are removed by the restore", exr.code === 0 && clean(ex) && !fs.readdirSync(path.join(ex, "dist")).some((f) => f.startsWith("extra-")), git(ex, "status", "--porcelain").stdout + exr.out);
    // a folder with an uncommitted edit: built in place, never restored (the edit survives)
    const dy = makeFreshnessSites(path.join(tmp, "dirty"), ["ledger"]).ledger;
    fs.appendFileSync(path.join(dy, "build.mjs"), "// my uncommitted edit\n");
    const dyr = run(dy, S("check-stability.mjs"), [dy, "--build", "node build.mjs"]);
    check("stability: a folder with uncommitted changes is built in place and NOT restored (the uncommitted edit survives)", dyr.code === 0 && /NOT restored/.test(dyr.out) && /my uncommitted edit/.test(fs.readFileSync(path.join(dy, "build.mjs"), "utf8")), dyr.out);
    // git itself failing (a corrupt index) must not be read as "clean": no restore is run or claimed
    const bi = makeFreshnessSites(path.join(tmp, "badindex"), ["ledger"]).ledger;
    fs.writeFileSync(path.join(bi, ".git", "index"), "not an index\n");
    const bir = run(bi, S("check-stability.mjs"), [bi, "--build", "node build.mjs"]);
    check("stability: when git status fails the folder is NOT restored and no restore is claimed", /git status failed/.test(bir.out) && !/working tree is restored/.test(bir.out), bir.out);
    const bf = run(sites.ledger, S("check-stability.mjs"), [sites.ledger, "--build", "node does-not-exist.mjs"]);
    check("stability: a build that fails is cannot judge (exit 2), not PASS", bf.code === 2 && /^ERROR stability cannot judge: the build failed/.test(bf.out), bf.out);

    // ---- lib units ----
    const L = await import(pathToFileURL(S("lib-freshness.mjs")).href + `?u=${Math.random()}`);
    const now = Date.parse("2026-10-22T12:00:00Z");
    check("lib: SE-004 format rules (seconds + timezone; date-only, no tz, no seconds, future all named)", L.lastmodProblem("2026-10-01T10:00:00Z", now) === null && L.lastmodProblem("2026-10-01T10:00:00+02:00", now) === null && L.lastmodProblem("2026-10-01T10:00:00.123Z", now) === null && /date-only/.test(L.lastmodProblem("2026-10-01", now)) && L.lastmodProblem("2026-10-01T10:00:00", now) === "no timezone" && L.lastmodProblem("2026-10-01T10:00Z", now) === "no seconds" && L.lastmodProblem("2026-10-24T12:00:00Z", now) === "in the future" && L.lastmodProblem("2026-10-23T11:00:00Z", now) === null);
    const base = { failures: [{ rule: "IDX-003/AEO-012", url: "u1", field: "sitemap <lastmod>" }], se004: [] };
    const nowRes = { failures: [{ rule: "IDX-003/AEO-012", url: "u1", field: "sitemap <lastmod>" }, { rule: "IDX-003/AEO-012", url: "u2", field: "JSON-LD dateModified" }], se004: [{ rule: "SE-004", url: "u3", field: "sitemap <lastmod>", why: "date-only (no time and timezone)" }] };
    const nf = L.newFailures(base, nowRes);
    check("lib: newFailures leaves out what the baseline already had", nf.length === 2 && !nf.some((f) => f.url === "u1"), JSON.stringify(nf));
    // a build that times out is stopped with everything it started (cmd.exe -> node here): nothing writes into the folder afterwards
    const lt = path.join(tmp, "late"); w(path.join(lt, "late.mjs"), 'import fs from "node:fs";\nsetTimeout(() => fs.writeFileSync("late.txt", "x"), 4000);\n');
    const rs = L.runShell("node late.mjs", lt, 1500);
    await new Promise((r) => setTimeout(r, 6500));
    check("lib: runShell stops a timed-out build's whole process tree (exit 124; its child never writes afterwards)", rs.code === 124 && rs.timedOut && !fs.existsSync(path.join(lt, "late.txt")), JSON.stringify({ ...rs, late: fs.existsSync(path.join(lt, "late.txt")) }));
    // supervised(): every argument reaches the child byte-identical. The wrapper used ConvertFrom-Json, which turned an ISO date-time
    // string into a PowerShell date ("2026-10-23T00:00:00Z" arrived as "10/23/2026 00:00:00").
    const argvIn = ["2026-10-23T00:00:00Z", "2026-10-23T10:00:00+02:00", "2026-10-23", "true", "12", "null", "a b", "x & y|z<w>^%PATH%", 'say "hi"', "", "héllo ✓ 日本 €", "C:\\x\\", "[1,2]", '{"k":1}', "-e"];
    const sv = L.supervised(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...argvIn], { timeoutMs: 60_000 });
    const svr = spawnSync(sv.command, sv.args, { env: sv.env, encoding: "utf8", timeout: 120_000, windowsHide: true });
    let svGot = null; try { svGot = JSON.parse(svr.stdout); } catch {}
    check("lib: supervised passes every argument byte-identical (ISO dates, true, 12, null, spaces, &, quotes, empty, Unicode, trailing \\)", (sv.supervised || process.platform !== "win32") && JSON.stringify(svGot) === JSON.stringify(argvIn), `supervised=${sv.supervised} status ${svr.status} got ${svr.stdout} ${String(svr.stderr).slice(0, 300)}`);
    check("lib: the plain reason names the field, the page count and the rules", L.plainReason(nf) === "it stamps the build time into JSON-LD dateModified on 1 page (IDX-003/AEO-012); its sitemap lastmod is date-only (no time and timezone) on 1 URL (SE-004)", L.plainReason(nf));

    // ---- built-in check (one build read) ----
    const BI = path.join(skill, "checks-builtin", "check-builtin-se004-idx003-sitemap-lastmod.mjs");
    run(sites["clock-sitemap"], "build.mjs");
    const b1 = run(sites["clock-sitemap"], BI, [sites["clock-sitemap"]]);
    check("builtin: >= 5 URLs sharing one lastmod written at build time FAIL (IDX-003 build-clock signature)", b1.code === 1 && /^FAIL builtin-se004-idx003 .*IDX-003 dist\/sitemap\.xml: all 6 URLs share one lastmod/.test(b1.out), b1.out);
    const b2 = run(sites.ledger, BI, [sites.ledger]);
    check("builtin: ledger dates PASS", b2.code === 0 && /^PASS builtin-se004-idx003 6 URL/.test(b2.out), b2.out);
    const b3 = run(sites["date-only"], BI, [sites["date-only"]]);
    check("builtin: date-only lastmod FAILS SE-004", b3.code === 1 && /SE-004 https:\/\/fixture\.example\/ lastmod "2026-01-10" date-only/.test(b3.out), b3.out);
    const b4 = run(sites.none, BI, [sites.none]);
    check("builtin: no sitemap built = cannot judge (exit 2), never FAIL", b4.code === 2 && /^ERROR builtin-se004-idx003 cannot judge/.test(b4.out), b4.out);
    const b5 = run(sites.future, BI, [sites.future]);
    check("builtin: a lastmod in the future FAILS", b5.code === 1 && /in the future/.test(b5.out), b5.out);
    run(sites.index, "build.mjs");
    const b6 = run(sites.index, BI, [sites.index]);
    check("builtin: follows a sitemap index to its child on disk", b6.code === 1 && /IDX-003 dist\/maps\/pages\.xml: all 6 URLs share one lastmod/.test(b6.out), b6.out);
    const old = path.join(tmp, "old-shared");
    w(path.join(old, "sitemap.xml"), "<urlset>" + ["a", "b", "c", "d", "e", "f"].map((p) => `<url><loc>https://x.example/${p}</loc><lastmod>2026-01-01T00:00:00Z</lastmod></url>`).join("") + "</urlset>\n");
    const b7 = run(old, BI, [old]);
    check("builtin: one shared lastmod far from the time the sitemap was written is not the build clock (PASS)", b7.code === 0, b7.out);
    const smAt = (dir, f) => w(path.join(dir, "sitemap.xml"), "<urlset>" + ["a", "b", "c", "d", "e", "f"].map((p, i) => `<url><loc>https://x.example/${p}</loc><lastmod>${new Date(f(i)).toISOString()}</lastmod></url>`).join("") + "</urlset>\n");
    const per = path.join(tmp, "per-url"); smAt(per, (i) => Date.now() - 3000 + i * 500);
    const b8 = run(per, BI, [per]);
    check("builtin: `new Date()` read once per URL (stamps milliseconds apart, all within a minute) is still the build clock (FAIL)", b8.code === 1 && /all 6 URLs share one lastmod/.test(b8.out), b8.out);
    const spread = path.join(tmp, "spread"); smAt(spread, (i) => Date.now() - i * 20 * 60_000);
    const b9 = run(spread, BI, [spread]);
    check("builtin: lastmods spread over hours (content dates) PASS", b9.code === 0, b9.out);
    const pct = path.join(tmp, "bad-escape"); w(path.join(pct, "sitemap.xml"), "<sitemapindex><sitemap><loc>https://x.example/bad%E0%A4%A.xml</loc></sitemap></sitemapindex>\n");
    const b10 = run(pct, BI, [pct]);
    check("builtin: a malformed %-escape in a sitemap index is read as written, not a crash read as FAIL", b10.code === 0 && /^PASS builtin-se004-idx003/.test(b10.out), b10.out);

    // ---- gate GT-013 ----
    const pewp = path.join(tmp, "pewp"); fs.mkdirSync(pewp, { recursive: true });
    const GF = S("gate-freshness.mjs");
    const g1 = run(SKILL, GF, [pewp, path.join(sites["clock-sitemap"], "dist")]);
    check("gate GT-013 without a build command: the build-clock signature in the built sitemap FAILS, the two-build test is NOT CHECKED", g1.code === 1 && /^FAIL GT-013/.test(g1.out) && /IDX-003/.test(g1.out) && /NOT CHECKED/.test(g1.out), g1.out);
    const g2s = run(SKILL, GF, [pewp, path.join(sites["clock-jsonld"], "dist")]);
    const g2 = run(SKILL, GF, [pewp, path.join(sites["clock-jsonld"], "dist"), "--build", "node build.mjs", "--build-cwd", sites["clock-jsonld"]]);
    check("gate GT-013 with a build command builds twice: the JSON-LD clock (invisible to one read) FAILS", g2s.code === 0 && g2.code === 1 && /JSON-LD dateModified: build 1/.test(g2.out) && clean(sites["clock-jsonld"]), g2s.out + "\n" + g2.out);
    const g3 = run(SKILL, GF, [pewp, path.join(sites.ledger, "dist"), "--build", "node build.mjs", "--build-cwd", sites.ledger]);
    check("gate GT-013 with a build command: a ledger site PASSES", g3.code === 0 && /^PASS GT-013 two builds give the same dates/.test(g3.out), g3.out);
    const G = await import(pathToFileURL(S("gate.mjs")).href + `?u=${Math.random()}`);
    check("gate: GT-013 is wired into gate.mjs", G.CHECKS.some((c) => c.id === "GT-013"));

    // ---- merge.mjs copies the built-ins into an audit that found no sitemap ----
    const au = path.join(tmp, "audit");
    w(path.join(au, "index.html"), "<!doctype html><html><head><title>x</title></head><body><h1>x</h1></body></html>\n");
    w(path.join(au, ".checks/plan.json"), JSON.stringify({ slices: [{ id: "s01", files: ["index.html"] }], skipped: {} }));
    w(path.join(au, ".checks/findings/s01.md"), "| id | severity | file:line | problem | why it matters | fix | check script | root cause |\n|---|---|---|---|---|---|---|---|\n| s01-01 | low | index.html:1 | MET-002: no meta description | snippets | add one | check-s01-01.mjs | index.html:1 |\n");
    w(path.join(au, ".checks/scripts/check-s01-01.mjs"), 'console.log("FAIL s01-01 none"); process.exit(1);\n');
    const mg = run(au, S("merge.mjs"), [au]);
    const rep = fs.existsSync(path.join(au, ".checks/REPORT.md")) ? fs.readFileSync(path.join(au, ".checks/REPORT.md"), "utf8") : "";
    const ra = run(au, path.join(au, ".checks/run-all.mjs"), ["--json"]);
    let raj = null; try { raj = JSON.parse(ra.out); } catch {}
    check("merge: the built-in sitemap check is in .checks/scripts of an audit with no sitemap finding, marked builtin in REPORT.md, and run-all runs it", fs.existsSync(path.join(au, ".checks/scripts/check-builtin-se004-idx003-sitemap-lastmod.mjs")) && /`check-builtin-se004-idx003-sitemap-lastmod\.mjs` builtin: cannot judge yet/.test(rep) && raj?.scripts?.some((s) => s.script === "check-builtin-se004-idx003-sitemap-lastmod.mjs" && s.status === "error"), mg.out + rep.slice(-400));

    // ---- AEO-012 across time on a LIVE site: two snapshots of one host (compare.mjs --freshness) ----
    const zlib = await import("node:zlib");
    const html = (main, extra = "") => `<!doctype html><html><head><title>t</title></head><body><nav>menu ${extra}</nav><main><h1>Homes</h1><p>Same   words&nbsp;here.</p><time datetime="x">${extra}</time></main></body></html>`;
    const snap = (dir, at, pages, record = true) => {
      w(path.join(dir, "_site.json"), JSON.stringify({ finishedAt: at, pages: pages.map((p) => ({ url: p.url, slug: p.slug, status: 200 })) }));
      w(path.join(dir, "site/sitemaps.json"), JSON.stringify({ urls: pages.map((p) => ({ kind: "url", loc: p.url, lastmod: p.lastmod })) }));
      for (const p of pages) {
        fs.mkdirSync(path.join(dir, "pages", p.slug), { recursive: true });
        fs.writeFileSync(path.join(dir, "pages", p.slug, "raw.html.gz"), zlib.gzipSync(p.html));
        w(path.join(dir, "pages", p.slug, "response.json"), JSON.stringify({ url: p.url, status: 200, ...(record ? { mainTextHash: L.mainTextHash(p.html) } : {}) }));
      }
    };
    const host = path.join(tmp, "cwd", "site-checks", "fixture.example", "snapshots");
    snap(path.join(host, "2026-10-01"), "2026-10-01T10:00:00Z", [
      { url: "https://fixture.example/", slug: "home", lastmod: "2026-09-01T00:00:00Z", html: html("a", "Sept 1") },
      { url: "https://fixture.example/sell/", slug: "sell", lastmod: "2026-09-01T00:00:00Z", html: html("a").replace("Same", "Old") },
      { url: "https://fixture.example/buy/", slug: "buy", lastmod: "2026-09-01T00:00:00Z", html: html("a") },
    ], false);
    snap(path.join(host, "2026-10-22"), "2026-10-22T10:00:00Z", [
      { url: "https://fixture.example/", slug: "home", lastmod: "2026-10-21T00:00:00Z", html: html("a", "Oct 21") }, // lastmod moved; only <time> and nav changed
      { url: "https://fixture.example/sell/", slug: "sell", lastmod: "2026-10-21T00:00:00Z", html: html("a").replace("Same", "New") }, // real change
      { url: "https://fixture.example/buy/", slug: "buy", lastmod: "2026-09-01T00:00:00Z", html: html("a") },
    ]);
    const cmpS = S("compare.mjs");
    const fr = run(SKILL, cmpS, ["--freshness", "https://fixture.example/", "--cwd", path.join(tmp, "cwd")]);
    check("live AEO-012: a page whose sitemap lastmod moved while its main text did not (only <time> and the menu changed) FAILS; a real text change does not", fr.code === 1 && /^FAIL AEO-012 1 page/.test(fr.out) && /https:\/\/fixture\.example\/ lastmod 2026-09-01T00:00:00Z -> 2026-10-21T00:00:00Z, main text unchanged/.test(fr.out) && !/\/sell\/ lastmod/.test(fr.out), fr.out);
    check("live AEO-012: an older snapshot without a recorded mainTextHash is hashed from raw.html.gz, and the result is written to .pewp/freshness/", /computed from raw\.html\.gz/.test(fr.out) && fs.existsSync(path.join(tmp, "cwd", "site-checks", "fixture.example", ".pewp", "freshness", "2026-10-01-vs-2026-10-22.json")), fr.out);
    const fr1 = run(SKILL, cmpS, ["--freshness", path.join(host, "2026-10-22"), path.join(host, "2026-10-22")]);
    check("live AEO-012: two identical snapshots PASS", fr1.code === 0 && /^PASS AEO-012/.test(fr1.out), fr1.out);
    fs.rmSync(path.join(host, "2026-10-01"), { recursive: true, force: true });
    const fr2 = run(SKILL, cmpS, ["--freshness", "https://fixture.example/", "--cwd", path.join(tmp, "cwd")]);
    check("live AEO-012: one snapshot only = cannot judge (exit 2)", fr2.code === 2 && /needs two/.test(fr2.out), fr2.out);
  } finally {
    if (!A.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  return results;
}

const MUTANTS = [
  { name: "two builds never compared", file: "scripts/lib-freshness.mjs", from: "    if (x?.value === y?.value) continue;", to: "    continue;", expect: [/^stability: a sitemap whose lastmod is the build clock FAILS/, /^stability: JSON-LD dateModified/] },
  { name: "JSON-LD not walked into @graph", file: "scripts/lib-freshness.mjs", from: "      else visit(v, `${at}.${k}`);", to: "      else {}", expect: [/^stability: JSON-LD dateModified inside @graph/] },
  { name: "meta modified_time not read", file: "scripts/lib-freshness.mjs", from: '"article:modified_time": "<meta article:modified_time>", ', to: "", expect: [/^stability: <meta property=article:modified_time>/] },
  { name: "date-only not named", file: "scripts/lib-freshness.mjs", from: '  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return "date-only (no time and timezone)";\n', to: "", expect: [/^stability: a date-only lastmod FAILS SE-004/, /^lib: SE-004 format rules/] },
  { name: "future lastmod allowed", file: "scripts/lib-freshness.mjs", from: '  if (t > now + 86_400_000) return "in the future";', to: "", expect: [/^stability: a lastmod more than a day in the future/] },
  { name: "SE-004 not part of the verdict", file: "scripts/lib-freshness.mjs", from: 'status: failures.length || se004.length ? "FAIL" : "PASS"', to: 'status: failures.length ? "FAIL" : "PASS"', expect: [/^stability: a date-only lastmod FAILS SE-004/, /^stability: a lastmod without a timezone/] },
  { name: "sitemap index not followed", file: "scripts/lib-freshness.mjs", from: "      if (hit) queue.push(hit);", to: "      if (false) queue.push(hit);", expect: [/^stability: a sitemap index is followed/] },
  { name: "other differing files counted as FAIL", file: "scripts/lib-freshness.mjs", from: 'status: failures.length || se004.length ? "FAIL" : "PASS"', to: 'status: failures.length || se004.length || warns.length ? "FAIL" : "PASS"', expect: [/^stability: another file that differs between builds is a WARN/] },
  { name: "tracked output not restored", file: "scripts/lib-freshness.mjs", from: '      const co = git(dir, "checkout", "HEAD", "--", ".");', to: "      const co = { code: 0 };", expect: [/^stability: the working tree is restored/] },
  { name: "new untracked files not removed", file: "scripts/lib-freshness.mjs", from: "      if (now) for (const f of now) if (!untrackedBefore.has(f)) fs.rmSync(path.join(top, f), { force: true });", to: "", expect: [/^stability: new untracked files a build leaves are removed/] },
  { name: "a dirty folder is restored (destroys the uncommitted edit)", file: "scripts/lib-freshness.mjs", from: "  const clean = !!top && !!st0 && st0.length === 0 && !!head && !!untrackedBefore;", to: "  const clean = !!top && !!head;", expect: [/^stability: a folder with uncommitted changes/] },
  { name: "a failed git status read as clean", file: "scripts/lib-freshness.mjs", from: 'return r.code === 0 ? r.out.split("\\n").filter((l) => l && !OURS.test(l.slice(3))) : null; };', to: 'return r.out.split("\\n").filter((l) => l && !OURS.test(l.slice(3))); };', expect: [/^stability: when git status fails/] },
  { name: "a timed-out build's children keep running (no job supervisor)", file: "scripts/lib-freshness.mjs", from: 'if (process.platform === "win32" && pwsh()) {', to: "if (false) {", expect: [/^lib: runShell stops a timed-out build's whole process tree/] },
  { name: "supervised arguments typed by ConvertFrom-Json (the old bug: ISO dates become PowerShell dates)", file: "scripts/lib-freshness.mjs", from: "$psi.ArgumentList.Add([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)))", to: "$psi.ArgumentList.Add([string](ConvertFrom-Json (ConvertTo-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))))))", expect: [/^lib: supervised passes every argument byte-identical/] },
  { name: "supervised arguments decoded as ASCII (Unicode damaged)", file: "scripts/lib-freshness.mjs", from: "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))", to: "[Text.Encoding]::ASCII.GetString([Convert]::FromBase64String($b))", expect: [/^lib: supervised passes every argument byte-identical/] },
  { name: "builtin: malformed %-escape crashes", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: "    try { pn = decodeURIComponent(pn); } catch {} // a malformed %-escape stays as written", to: "    pn = decodeURIComponent(pn);", expect: [/^builtin: a malformed %-escape/] },
  { name: "baseline failures counted as new", file: "scripts/lib-freshness.mjs", from: "  const had = new Set([...(base?.failures || []), ...(base?.se004 || [])].map(keyOf));", to: "  const had = new Set();", expect: [/^lib: newFailures leaves out/] },
  { name: "check-stability exits 0 on FAIL", file: "scripts/check-stability.mjs", from: 'process.exit(res.status === "PASS" ? 0 : res.status === "FAIL" ? 1 : 2);', to: 'process.exit(res.status === "ERROR" ? 2 : 0);', expect: [/^stability: a sitemap whose lastmod is the build clock FAILS/] },
  { name: "builtin: build-clock signature off", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: "    const oneStamp = ts.every(Number.isFinite) && t - lo <= 60_000;", to: "    const oneStamp = false;", expect: [/^builtin: >= 5 URLs sharing one lastmod/, /^builtin: follows a sitemap index/] },
  { name: "builtin: the 10-minute window ignored", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: "if (oneStamp && Math.abs(t - m.mtimeMs) <= 10 * 60_000)", to: "if (oneStamp)", expect: [/^builtin: one shared lastmod far from the time/] },
  { name: "builtin: per-URL clock reads not seen as one stamp", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: "t - lo <= 60_000;", to: "t - lo <= 0;", expect: [/^builtin: `new Date\(\)` read once per URL/] },
  { name: "builtin: any spread counts as one stamp", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: "t - lo <= 60_000;", to: "true;", expect: [/^builtin: lastmods spread over hours/] },
  { name: "builtin: date-only accepted", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: '  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return "date-only";\n', to: "", expect: [/^builtin: date-only lastmod FAILS SE-004/] },
  { name: "builtin: no sitemap passes", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: "build the site first; a site with no sitemap has nothing to date)`); process.exit(2); }", to: "build the site first; a site with no sitemap has nothing to date)`); process.exit(0); }", expect: [/^builtin: no sitemap built = cannot judge/] },
  { name: "builtin: future accepted", file: "checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs", from: '  if (t > now + 86_400_000) return "in the future";', to: "", expect: [/^builtin: a lastmod in the future FAILS/] },
  { name: "gate GT-013 never builds", file: "scripts/gate-freshness.mjs", from: "  if (ctx.build) {", to: "  if (false) {", expect: [/^gate GT-013 with a build command builds twice/] },
  { name: "gate GT-013 ignores the build-clock signature", file: "scripts/gate-freshness.mjs", from: "  const clock = snap.sitemaps.map((s) => buildClockSignature(s)).filter(Boolean);", to: "  const clock = [];", expect: [/^gate GT-013 without a build command/] },
  { name: "gate GT-013 not wired", file: "scripts/gate.mjs", from: "coverage, intentFit, freshness];", to: "coverage, intentFit];", expect: [/^gate: GT-013 is wired/] },
  { name: "live AEO-012: lastmod change alone not flagged", file: "scripts/lib-freshness.mjs", from: '    if (la !== lb) findings.push({ rule: "AEO-012"', to: '    if (false) findings.push({ rule: "AEO-012"', expect: [/^live AEO-012: a page whose sitemap lastmod moved/] },
  { name: "live AEO-012: <time> counted as content", file: "scripts/lib-freshness.mjs", from: ".replace(/<(time|script|style|noscript|template)\\b", to: ".replace(/<(script|style|noscript|template)\\b", expect: [/^live AEO-012: a page whose sitemap lastmod moved/] },
  { name: "live AEO-012: text changes ignored", file: "scripts/lib-freshness.mjs", from: "    if (pa.hash !== pb.hash) { changedText++; continue; }", to: "", expect: [/^live AEO-012: a page whose sitemap lastmod moved/] },
  { name: "live AEO-012: old snapshots not hashed from raw.html.gz", file: "scripts/lib-freshness.mjs", from: '    if (!h) { try { h = mainTextHash(', to: '    if (false) { try { h = mainTextHash(', expect: [/^live AEO-012: a page whose sitemap lastmod moved/] },
  { name: "merge does not copy the built-ins", file: "scripts/merge.mjs", from: "for (const f of builtins) fs.copyFileSync(", to: "for (const f of []) fs.copyFileSync(", expect: [/^merge: the built-in sitemap check is in \.checks\/scripts/] },
];

const main = await suite(SKILL);
for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
let failed = main.filter((r) => !r.ok).length;
console.log(failed ? `FRESHNESS TEST FAIL: ${failed} of ${main.length}` : `FRESHNESS TEST PASS: ${main.length} of ${main.length}`);
if (!failed && !A.includes("--no-mutants")) {
  console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
  let caught = 0;
  const list = MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")));
  for (const mu of list) {
    const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-fresh-mut-"));
    for (const d of ["scripts", "checks-builtin", "fixtures", "checklist", "rules"]) if (fs.existsSync(path.join(SKILL, d))) fs.cpSync(path.join(SKILL, d), path.join(mdir, d), { recursive: true, filter: (s) => !/[\\/]fixtures[\\/](site|site-clean|measure|pewp)([\\/]|$)/.test(s) });
    const target = path.join(mdir, mu.file);
    const src = fs.readFileSync(target, "utf8");
    const count = src.split(mu.from).length - 1;
    if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
    fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
    const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 30_000 });
    if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${(chk.stderr || "").slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
    const res = await suite(mdir);
    const red = res.filter((r) => !r.ok);
    const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
    const ok = red.length > 0 && !missing.length;
    if (ok) caught++; else failed++;
    console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
    fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(failed ? `MUTANTS FAIL: ${caught} of ${list.length} caught` : `MUTANTS PASS: ${caught} of ${list.length} caught`);
}
process.exit(failed ? 1 : 0);
