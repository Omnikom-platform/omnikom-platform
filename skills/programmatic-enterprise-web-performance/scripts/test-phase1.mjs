// Usage: node test-phase1.mjs [--scripts <dir>] [--mutants [--only <id>]]  (--mutants: watched-fail for the env-file checks, see the mutants section)
// Phase 1 self-test on fixtures (no network, no real site): state layout, cache, snapshot reuse, Common Crawl authority
// and link gap on a tiny fake graph, the audit-live report (six questions in order, every number sourced, glossary
// once, preview noindex by design), the read-only guard, the doctor's shape, and the checklist builder (wrong path
// leaves it alone; a new pack and rule prefix are picked up). Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : path.dirname(fileURLToPath(import.meta.url)));
const skill = path.dirname(dir);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-p1-"));
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
const node = (script, a, opts = {}) => spawnSync(process.execPath, [path.join(dir, script), ...a], { encoding: "utf8", timeout: 120000, ...opts });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" || Buffer.isBuffer(s) ? s : JSON.stringify(s)); };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// ---------------------------------------------------------------- mutants (watched-fail for the env-file checks)
// Usage: node test-phase1.mjs --mutants [--only <id>]. Copies the skill, breaks ONE thing per mutant (a patch asserts its target text
// occurs exactly once, so "the patch never applied" cannot pass as green), runs this test on the copy and requires the NAMED check to go
// red. `patches` = several edits for one mutant where the code has two independent defences for the same case (a trim() also removes a
// BOM and a CR, so removing only the explicit handling would leave the behaviour right).
if (args.includes("--mutants")) {
  const E = "lib-env.mjs", D = "doctor.mjs";
  const MUT = [
    { id: "env-export-kept", file: E, from: 'line = line.replace(/^export\\s+/, "");', to: "", red: "env lib: parse reads export" },
    { id: "env-quotes-ignored", file: E, from: `if ((q === '"' || q === "'") && v.length > 1) {`, to: "if (false) {", red: "env lib: parse reads export" },
    { id: "env-dq-escapes-ignored", file: E, from: "if (q === '\"') v = v.replace(", to: "if (false) v = v.replace(", red: "env lib: parse reads export" },
    { id: "env-inline-comment-kept", file: E, from: 'out.set(name, v.replace(/\\s+#.*$/, "").trim());', to: "out.set(name, v.trim());", red: "env lib: parse drops an inline comment" },
    { id: "env-comment-lines-read", file: E, patches: [{ from: 'if (!line || line.startsWith("#")) continue;', to: "if (!line) continue;" }, { from: "if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;", to: "" }], red: "env lib: parse drops an inline comment" },
    { id: "env-bom-kept", file: E, patches: [{ from: 'String(text).replace(/^\\uFEFF/, "").split', to: "String(text).split" }, { from: "    line = line.trim();\n", to: '    line = line.replace(/^[ \\t]+|[ \\t\\r]+$/g, "");\n' }, { from: "const name = line.slice(0, eq).trim();", to: "const name = line.slice(0, eq);" }], red: "env lib: parse is safe with a byte-order mark" },
    { id: "env-crlf-kept", file: E, patches: [{ from: ".split(/\\r\\n|\\n|\\r/)", to: '.split("\\n")' }, { from: "    line = line.trim();\n", to: '    line = line.replace(/^[ \\t]+/, "");\n' }, { from: "let v = line.slice(eq + 1).trim();", to: "let v = line.slice(eq + 1);" }, { from: 'out.set(name, v.replace(/\\s+#.*$/, "").trim());', to: 'out.set(name, v.replace(/[ \\t]+#.*$/, ""));' }], red: "env lib: parse is safe with a byte-order mark" },
    { id: "env-overrides-existing", file: E, from: "if (isSet(name)) skipped.push(name);", to: "if (false) skipped.push(name);", red: "env lib: a name already set is never overridden" },
    { id: "env-empty-counts-as-set-removed", file: E, from: 'const isSet = (name) => typeof process.env[name] === "string" && process.env[name].trim() !== "";', to: "const isSet = (name) => false;", red: "env lib: a name already set is never overridden" },
    { id: "env-returns-values", file: E, from: "  return { file, loaded, skipped, source };", to: "  return { file, loaded, skipped, source, values: Object.fromEntries(loaded.map((n) => [n, process.env[n]])) };", red: "env lib: the result carries names only" },
    { id: "env-arg-ignored", file: E, from: "  if (envFile) {\n    const p", to: "  if (false) {\n    const p", red: "env lib: precedence" },
    { id: "env-state-ignored", file: E, from: "if (fromState && isFile(", to: "if (false && fromState && isFile(", red: "env lib: precedence" },
    { id: "env-explicit-missing-silent", file: E, from: "if (!isFile(p)) throw new EnvFileError(`--env-file: no such file: ${p}`);", to: "if (!isFile(p)) return { file: null, loaded: [], skipped: [], source: \"none\" };", red: "env lib: a missing file named explicitly" },
    { id: "env-default-missing-throws", file: E, from: "if (fromMachine && isFile(path.resolve(path.join(home, \".claude\"), fromMachine))) {", to: "if (fromMachine) {", red: "env lib: a missing file named only by a default" },
    { id: "env-arg-equals-form-lost", file: E, from: 'if (t.startsWith("--env-file=")) {', to: "if (false) {", red: "env lib: envFileArg" },
    { id: "env-arg-dotenv-lost", file: E, from: 't === "--env-file" || t === "--dotenv"', to: 't === "--env-file"', red: "env lib: envFileArg" },
    { id: "doctor-env-never-loaded", file: D, from: "loadEnv({ envFile: envFileArg(a),", to: "loadEnv({ envFile: null,", red: "doctor env: --env-file loads the names" },
    { id: "doctor-env-line-missing", file: D, from: "  console.log(envLine);\n", to: "", red: "doctor env: one line" },
    { id: "doctor-env-line-shows-values", file: D, from: "names from ${envInfo.file}${", to: "names from ${envInfo.file} ${envInfo.loaded.map((n) => process.env[n]).join()}${", red: "doctor secrecy" },
    { id: "doctor-no-env-line-changed", file: D, from: ': "env: no env file";', to: ': "env: none";', red: "doctor env: with no env file" },
    { id: "doctor-env-json-leaks-values", file: D, from: "loaded: envInfo.loaded, source", to: "loaded: envInfo.loaded.map((n) => `${n}=${process.env[n]}`), source", red: "doctor secrecy" },
    { id: "doctor-setby-env-file-lost", file: D, from: "(envInfo.loaded.includes(k) ? `env file ${envInfo.file}` :", to: "(false ? `env file ${envInfo.file}` :", red: "doctor setBy: a key the env file supplied" },
    { id: "doctor-setby-process-lost", file: D, from: ': env(k) ? "process environment" : null);', to: ": null);", red: "doctor setBy: a key already in the environment" },
    { id: "doctor-setby-token-lost", file: D, from: ": `token file ${gscFile}`);", to: ': "process environment");', red: "doctor setBy: Search Console connected by the token file" },
    { id: "doctor-terms-time-lost", file: D, from: "termsSrc.setAt = at;", to: "termsSrc.setAt = null;", red: "doctor gemini-terms" },
    { id: "doctor-terms-detail-bare", file: D, from: "termsSrc.detail = `acknowledged (set by ${termsSrc.setBy}${at ? `, file last changed ${at}` : \"\"})`;", to: 'termsSrc.detail = "acknowledged";', red: "doctor gemini-terms" },
    { id: "doctor-inputs-env-hash-lost", file: D, from: "envFileSha1: sha1Of(envInfo.file)", to: 'envFileSha1: "absent"', red: "doctor inputs" },
    { id: "doctor-inputs-token-hash-lost", file: D, from: "tokenFileSha1: sha1Of(gscFile)", to: 'tokenFileSha1: "absent"', red: "doctor inputs" },
    { id: "doctor-inputs-sa-hash-lost", file: D, from: "serviceAccountFileSha1: sha1Of(saFileOk ? saFile : null)", to: 'serviceAccountFileSha1: "absent"', red: "doctor service account: GSC_SERVICE_ACCOUNT_FILE (an existing file)" },
    { id: "doctor-psi-missing", file: D, from: 'add("psi", ', to: 'add("psi-off", ', red: "doctor psi" },
    { id: "doctor-psi-always-connected", file: D, from: 'env("PSI_API_KEY") ? "connected" : "needs"', to: '"connected"', red: "doctor psi" },
    { id: "doctor-sa-file-ignored", file: D, from: 'const gscVia = saFileOk ? "GSC_SERVICE_ACCOUNT_FILE" : saB64', to: "const gscVia = saB64", red: "doctor service account: GSC_SERVICE_ACCOUNT_FILE (an existing file)" },
    { id: "doctor-sa-b64-ignored", file: D, from: ': saB64 ? "GSC_SERVICE_ACCOUNT_JSON_B64" : null;', to: ": null;", red: "doctor service account: GSC_SERVICE_ACCOUNT_JSON_B64" },
    { id: "doctor-sa-missing-file-counts", file: D, from: "saFileOk = !!saFile && fs.existsSync(saFile) && fs.statSync(saFile).isFile()", to: "saFileOk = !!saFile", red: "doctor service account: a GSC_SERVICE_ACCOUNT_FILE that names no file" },
    { id: "doctor-sa-setby-lost", file: D, from: "gscVia ? setByOf(gscVia) :", to: "gscVia ? null :", red: "doctor service account: GSC_SERVICE_ACCOUNT_JSON_B64" },
    { id: "doctor-dotenv-usage-error-lost", file: D, from: "console.error(`usage error: ${e.message}`); process.exit(2);", to: "console.error(`usage error: ${e.message}`); process.exit(0);", red: "doctor env: a missing file named with --dotenv" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-p1mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    for (let n = 0; ; n++) { try { fs.rmSync(copy, { recursive: true, force: true }); fs.cpSync(skill, copy, { recursive: true, filter: (p) => !/[\\/](runs|site-checks|fixtures|\.git)([\\/]|$)/.test(p) && !/[\\/]scripts[\\/][^\\/.]+$/.test(p) }); break; } catch (e) { if (n > 4) return resolve({ good: false, line: `MUTANT ${m.id}: cannot copy the skill (${e.code})` }); } }
    const f = path.join(copy, "scripts", m.file);
    let src = fs.readFileSync(f, "utf8");
    for (const p of m.patches || [{ from: m.from, to: m.to }]) {
      if (src.split(p.from).length !== 2) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY exactly once (${src.split(p.from).length - 1} matches of the target text in ${m.file}: ${p.from.slice(0, 50)})` });
      src = src.replace(p.from, () => p.to);
    }
    fs.writeFileSync(f, src);
    const c = spawn(process.execPath, [path.join(copy, "scripts", "test-phase1.mjs"), "--scripts", path.join(copy, "scripts")], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 240000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5));
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (the check measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected check"} | expected "${m.red}" | failed: ${failed.map((x) => x.slice(0, 60)).join(" ; ").slice(0, 200) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

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

  // ---- env file (G1, G15, G18; contract C4) ----
  // lib-env.mjs in-process: names are LIBT_* so nothing here can touch a real key; process.env is restored afterwards.
  const libEnv = await import(pathToFileURL(path.join(dir, "lib-env.mjs")).href);
  const sha1 = (p) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
  const savedEnv = { ...process.env };
  const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv); };
  try {
    const P = libEnv.parseEnv(`﻿FIRST=1\r\n# c1\r\n#COMMENTED_KEY=zzz\r\nPLAIN=abc\r\nexport EXP=def\r\nDQ="has # hash and \\"q\\" and \\n nl"\r\nSQ='single # kept \\n raw'\r\nINL=val1 # trailing comment\r\n  SPACED = padded \r\nLAST=1\r\n`);
    check("env lib: parse reads export, double quotes (a # inside is kept; \\\" and \\n read) and single quotes (literal)",
      P.get("EXP") === "def" && P.get("DQ") === 'has # hash and "q" and \n nl' && P.get("SQ") === "single # kept \\n raw" && P.get("PLAIN") === "abc" && P.get("SPACED") === "padded", JSON.stringify([...P]));
    check("env lib: parse drops an inline comment after an unquoted value and skips comment lines", P.get("INL") === "val1" && !P.has("COMMENTED_KEY") && ![...P.keys()].some((k) => k.startsWith("#")), JSON.stringify([...P]));
    check("env lib: parse is safe with a byte-order mark and CRLF line ends (no name or value carries a BOM or CR)", P.get("FIRST") === "1" && P.get("LAST") === "1" && [...P].every(([k, v]) => !/[\r﻿]/.test(k + v)), JSON.stringify([...P]));

    // never override, names only
    process.env.LIBT_SET = "from-process"; delete process.env.LIBT_NEW;
    const ef = path.join(tmp, "lib.env"); w(ef, "LIBT_SET=from-file\nLIBT_NEW=from-file-2\n");
    const r = libEnv.loadEnv({ envFile: ef, cwd: tmp, home: path.join(tmp, "nohome") });
    check("env lib: a name already set is never overridden (it is reported as skipped); a new name is set for child processes",
      process.env.LIBT_SET === "from-process" && r.skipped.join() === "LIBT_SET" && r.loaded.join() === "LIBT_NEW" && process.env.LIBT_NEW === "from-file-2" && r.source === "--env-file" && r.file === ef, JSON.stringify(r) + process.env.LIBT_SET);
    check("env lib: the result carries names only, never a value", !JSON.stringify(r).includes("from-file") && !JSON.stringify(r).includes("from-process"), JSON.stringify(r));
    restoreEnv();

    // precedence: --env-file > state.json envFile > machine.local.json envFile
    const base = path.join(tmp, "prec"), pw = path.join(base, ".pewp"), hm = path.join(base, "home");
    w(path.join(base, "arg.env"), "LIBT_WHO=arg\n"); w(path.join(base, "state.env"), "LIBT_WHO=state\n"); w(path.join(hm, ".claude", "mach.env"), "LIBT_WHO=machine\n");
    w(path.join(pw, "state.json"), { envFile: "state.env" }); w(path.join(hm, ".claude", "machine.local.json"), { envFile: "mach.env" });
    const who = (o) => { delete process.env.LIBT_WHO; const x = libEnv.loadEnv({ cwd: base, home: hm, ...o }); const v = process.env.LIBT_WHO; delete process.env.LIBT_WHO; return `${x.source}:${v}`; };
    const pr = [who({ envFile: "arg.env", pewp: pw }), who({ pewp: pw }), who({})];
    check("env lib: precedence is --env-file, then state.json envFile, then machine.local.json envFile", pr.join() === "--env-file:arg,state.json envFile:state,machine.local.json envFile:machine", pr.join());

    // a missing file: named explicitly = usage error (exit code 2) with the path; named only by a default = silently none
    let eerr = null; try { libEnv.loadEnv({ envFile: "no-such.env", cwd: base, home: hm }); } catch (e) { eerr = e; }
    check("env lib: a missing file named explicitly is a usage error (exitCode 2) whose message carries the path", eerr?.exitCode === 2 && eerr.message.includes(path.join(base, "no-such.env")), eerr ? eerr.message : "no error thrown");
    w(path.join(base, "p2", ".pewp", "state.json"), { envFile: "gone.env" }); w(path.join(base, "home2", ".claude", "machine.local.json"), { envFile: "gone2.env" });
    let derr = null, dr = null; try { dr = libEnv.loadEnv({ pewp: path.join(base, "p2", ".pewp"), home: path.join(base, "home2"), cwd: base }); } catch (e) { derr = e; }
    check("env lib: a missing file named only by a default (state.json, machine.local.json) is silently none", !derr && dr?.file === null && dr.source === "none" && dr.loaded.length === 0, derr ? derr.message : JSON.stringify(dr));

    // the option itself
    const o1 = libEnv.envFileArg(["x", "--env-file", "a.env"]), o2 = libEnv.envFileArg(["--env-file=b.env"]), o3 = libEnv.envFileArg(["x", "--dotenv", "c.env"]), o4 = libEnv.envFileArg(["x"]);
    let o5 = null; try { libEnv.envFileArg(["--env-file"]); } catch (e) { o5 = e.exitCode; }
    check("env lib: envFileArg reads --env-file <p>, --env-file=<p>, --dotenv <p>; none = null; no path = usage error 2", [o1, o2, o3, o4 === null, o5].join() === "a.env,b.env,c.env,true,2", JSON.stringify([o1, o2, o3, o4, o5]));
  } finally { restoreEnv(); }

  // doctor as a child process with --env-file. HOME and USERPROFILE point at an empty folder so no real token file, machine.local.json or key leaks in.
  const ehome = path.join(tmp, "ehome"); fs.mkdirSync(ehome, { recursive: true });
  const KEYS = ["BING_WEBMASTER_KEY", "CRUX_API_KEY", "GEMINI_API_KEY", "PSI_API_KEY", "PEWP_GEMINI_TERMS_ACK", "GSC_TOKEN_FILE", "GSC_SERVICE_ACCOUNT_FILE", "GSC_SERVICE_ACCOUNT_JSON_B64"];
  const cleanEnv = (extra = {}) => { const e = { ...process.env, USERPROFILE: ehome, HOME: ehome }; for (const k of Object.keys(e)) if (KEYS.includes(k.toUpperCase())) delete e[k]; return { ...e, ...extra }; };
  const SEC = { bing: "bing-SECRET-aaa111", crux: "crux-SECRET-bbb222", psiFile: "psi-SECRET-ccc333", psiProc: "psi-FROMPROC-ddd444", sa: "SA-PRIVATE-KEY-eee555", b64: Buffer.from("SA-B64-SECRET-fff666").toString("base64"), token: "TOKEN-SECRET-ggg777" };
  const envA = path.join(tmp, "doctor-A.env"); // BOM + CRLF, a comment, a quoted value, `export` + inline comment; PSI is also set in the child's environment
  w(envA, Buffer.from(`﻿# keys for the doctor test\r\nBING_WEBMASTER_KEY="${SEC.bing}"\r\nexport CRUX_API_KEY=${SEC.crux} # inline note\r\nPSI_API_KEY=${SEC.psiFile}\r\nPEWP_GEMINI_TERMS_ACK=1\r\n`, "utf8"));
  const tokenFile = path.join(tmp, "gsc-token.json"); w(tokenFile, JSON.stringify({ access_token: SEC.token }));
  const saFile = path.join(tmp, "sa.json"); w(saFile, JSON.stringify({ private_key: SEC.sa, client_email: "x@y.iam.gserviceaccount.com" }));
  const cwdE = path.join(tmp, "cwd-env");
  const docOf = (host) => J(path.join(cwdE, "site-checks", host, ".pewp", "doctor.json"));
  const srcOf = (dj, id) => dj?.sources.find((s) => s.id === id);
  const envMtime = fs.statSync(envA).mtime.toISOString();
  const eA = node("doctor.mjs", ["https://a.doctor.example/", "--offline", "--cwd", cwdE, "--env-file", envA], { env: cleanEnv({ PSI_API_KEY: SEC.psiProc, GSC_TOKEN_FILE: tokenFile }) });
  const eAj = node("doctor.mjs", ["https://a.doctor.example/", "--offline", "--json", "--cwd", cwdE, "--env-file", envA], { env: cleanEnv({ PSI_API_KEY: SEC.psiProc, GSC_TOKEN_FILE: tokenFile }) });
  const dA = docOf("a.doctor.example");
  const escRe = envA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  check("doctor env: --env-file loads the names it holds (names only) and writes them to doctor.json; the name already set in the environment is not among them",
    eA.status === 0 && dA?.env?.file === envA && dA.env.loaded.slice().sort().join() === "BING_WEBMASTER_KEY,CRUX_API_KEY,PEWP_GEMINI_TERMS_ACK" && dA.env.source === "--env-file" && srcOf(dA, "bing-webmaster")?.status === "connected" && srcOf(dA, "crux")?.status === "connected",
    JSON.stringify(dA?.env) + eA.stdout.slice(0, 300) + eA.stderr);
  check("doctor env: one line 'env: loaded N names from <file>' (here 3; the one already set is mentioned as kept), names and path only",
    new RegExp(`^env: loaded 3 names from ${escRe}`, "m").test(eA.stdout) && /1 already set in the process environment, kept/.test(eA.stdout), eA.stdout.slice(0, 300));
  check("doctor setBy: a key the env file supplied says 'env file <path>' (quoted value, export + inline comment)", srcOf(dA, "bing-webmaster")?.setBy === `env file ${envA}` && srcOf(dA, "crux")?.setBy === `env file ${envA}`, JSON.stringify([srcOf(dA, "bing-webmaster")?.setBy, srcOf(dA, "crux")?.setBy]));
  check("doctor setBy: a key already in the environment says 'process environment' and the env file's value for it was not applied", srcOf(dA, "psi")?.status === "connected" && srcOf(dA, "psi")?.setBy === "process environment" && !dA.env.loaded.includes("PSI_API_KEY"), JSON.stringify(srcOf(dA, "psi")));
  check("doctor setBy: Search Console connected by the token file says 'token file <path>'; a source with no key says nothing", srcOf(dA, "search-console")?.status === "connected" && srcOf(dA, "search-console")?.setBy === `token file ${tokenFile}` && srcOf(dA, "gemini")?.status === "needs" && srcOf(dA, "gemini")?.setBy === null, JSON.stringify([srcOf(dA, "search-console"), srcOf(dA, "gemini")]));
  check("doctor gemini-terms: connected, and it says which env file set the acknowledgement and when (the file's last-change time)",
    srcOf(dA, "gemini-terms")?.status === "connected" && srcOf(dA, "gemini-terms").setBy === `env file ${envA}` && srcOf(dA, "gemini-terms").setAt === envMtime && srcOf(dA, "gemini-terms").detail.includes(envA) && srcOf(dA, "gemini-terms").detail.includes(envMtime), JSON.stringify(srcOf(dA, "gemini-terms")));
  check("doctor inputs: doctor.json carries the sha1 of the env file and of the token file, and 'absent' for the service account file (stale-result check)",
    dA?.inputs?.envFileSha1 === sha1(envA) && dA.inputs.tokenFileSha1 === sha1(tokenFile) && dA.inputs.serviceAccountFileSha1 === "absent", JSON.stringify(dA?.inputs));
  check("doctor psi: a PageSpeed Insights source exists, is connected through PSI_API_KEY and needs a key (with how) when none is set", srcOf(dA, "psi")?.usedBy?.length > 0 && (() => { const x = node("doctor.mjs", ["--json", "--offline"], { env: cleanEnv() }); try { const p = JSON.parse(x.stdout.slice(x.stdout.indexOf("{"))).sources.find((s) => s.id === "psi"); return p?.status === "needs" && /PSI_API_KEY/.test(p.unblock); } catch { return false; } })(), JSON.stringify(srcOf(dA, "psi")));

  // no env file given: a plain line, env.file null, hashes 'absent'; the service account (file) connects Search Console
  const eB = node("doctor.mjs", ["https://b.doctor.example/", "--offline", "--cwd", cwdE], { env: cleanEnv({ GSC_SERVICE_ACCOUNT_FILE: saFile }) });
  const dB = docOf("b.doctor.example");
  check("doctor env: with no env file the line says so, env.file is null, loaded is empty and the env file hash is 'absent'", /^env: no env file$/m.test(eB.stdout) && dB?.env?.file === null && dB.env.loaded.length === 0 && dB.env.source === "none" && dB.inputs.envFileSha1 === "absent", eB.stdout.slice(0, 200) + JSON.stringify(dB?.env));
  check("doctor service account: GSC_SERVICE_ACCOUNT_FILE (an existing file) connects Search Console as 'service account', setBy process environment, and its sha1 is recorded",
    srcOf(dB, "search-console")?.status === "connected" && srcOf(dB, "search-console").detail === "service account" && srcOf(dB, "search-console").setBy === "process environment" && dB.inputs.serviceAccountFileSha1 === sha1(saFile) && dB.inputs.tokenFileSha1 === "absent", JSON.stringify([srcOf(dB, "search-console"), dB?.inputs]));
  // the base64 form supplied by an env file
  const envB = path.join(tmp, "doctor-B.env"); w(envB, `GSC_SERVICE_ACCOUNT_JSON_B64=${SEC.b64}\n`);
  const eC = node("doctor.mjs", ["https://c.doctor.example/", "--offline", "--cwd", cwdE, "--env-file", envB], { env: cleanEnv() });
  const dC = docOf("c.doctor.example");
  check("doctor service account: GSC_SERVICE_ACCOUNT_JSON_B64 (non-empty) connects Search Console as 'service account' with setBy 'env file <path>'", srcOf(dC, "search-console")?.status === "connected" && srcOf(dC, "search-console").detail === "service account" && srcOf(dC, "search-console").setBy === `env file ${envB}`, JSON.stringify(srcOf(dC, "search-console")) + eC.stderr);
  // a service account path that names no file does not connect anything
  const eD = node("doctor.mjs", ["https://d.doctor.example/", "--offline", "--cwd", cwdE], { env: cleanEnv({ GSC_SERVICE_ACCOUNT_FILE: path.join(tmp, "no-such-sa.json") }) });
  const dD = docOf("d.doctor.example");
  check("doctor service account: a GSC_SERVICE_ACCOUNT_FILE that names no file does not connect Search Console (and says why)", srcOf(dD, "search-console")?.status === "needs" && /does not exist/.test(srcOf(dD, "search-console").detail) && dD.inputs.serviceAccountFileSha1 === "absent", JSON.stringify(srcOf(dD, "search-console")));
  // a missing file named with --dotenv is a usage error: exit 2, the path in the message, nothing written
  const eE = node("doctor.mjs", ["https://e.doctor.example/", "--offline", "--cwd", cwdE, "--dotenv", path.join(tmp, "missing.env")], { env: cleanEnv() });
  check("doctor env: a missing file named with --dotenv is a usage error (exit 2) that names the path, and doctor.json is not written", eE.status === 2 && eE.stderr.includes(path.join(tmp, "missing.env")) && !docOf("e.doctor.example"), eE.status + eE.stderr.slice(0, 200));
  // secrecy: no value from any of the files appears in anything doctor printed or wrote
  const everything = [eA.stdout, eA.stderr, eAj.stdout, eAj.stderr, eB.stdout, eB.stderr, eC.stdout, eC.stderr, eD.stdout, eE.stdout, eE.stderr, ...["a", "b", "c", "d"].map((h) => fs.readFileSync(path.join(cwdE, "site-checks", `${h}.doctor.example`, ".pewp", "doctor.json"), "utf8"))].join("\n");
  const leaked = Object.entries(SEC).filter(([, v]) => everything.includes(v)).map(([k]) => k);
  check("doctor secrecy: no value from the env file, the token file, the service account file or the base64 string appears in stdout, stderr or doctor.json", leaked.length === 0 && everything.includes("BING_WEBMASTER_KEY") && everything.length > 2000, `leaked: ${leaked.join(",")}`);

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
