// Usage: node test-social-words.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of import-social.mjs and of its reader report-live.mjs on INVENTED captures: a profile with posts and no newest post date read is NOT JUDGED (never
// "not active", never "none"); a profile with 0 posts is not active; the report names each state; a broken link is said to be on the profile. Old summaries print as before.
// No network (netguard-import.mjs), no browser. Captures sit in a temp folder, the real importer runs, then the real report on its output.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runner, W, J, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "every-profile-judged", file: "import-social.mjs", from: "judged: d != null || posts === 0,", to: "judged: true,", red: "case 1:" },
    { id: "zero-posts-not-judged", file: "import-social.mjs", from: "judged: d != null || posts === 0,", to: "judged: d != null,", red: "case 4:" },
    { id: "old-date-not-judged", file: "import-social.mjs", from: "judged: d != null || posts === 0,", to: "judged: d != null && d <= 90,", red: "case 1:" },
    { id: "any-dated-post-active", file: "import-social.mjs", from: "active: d != null && d <= 90,", to: "active: d != null,", red: "case 1:" },
    { id: "active-platform-also-not-judged", file: "import-social.mjs", from: "!r.judged && !act.has(r.platform)", to: "!r.judged", red: "case 1:" },
    { id: "not-judged-also-not-active", file: "import-social.mjs", from: "!act.has(r.platform) && !nj.has(r.platform)", to: "!act.has(r.platform)", red: "case 1:" },
    { id: "report-says-none-with-unjudged", file: "report-live.mjs", from: "act.length || !nj.length ?", to: "true ?", red: "case 5:" },
    { id: "report-drops-not-judged-part", file: "report-live.mjs", from: '...(nj.length ? [`not judged (post date not read): ${nj.join(", ")}`] : [])', to: "...[]", red: "case 2:" },
    { id: "report-calls-not-judged-not-active", file: "report-live.mjs", from: "not judged (post date not read): ", to: "not active on: ", red: "case 2:" },
    { id: "links-from-the-site-again", file: "report-live.mjs", from: 'Links on the ${names.join(", ")} profile', to: 'Links from the site on the ${names.join(", ")} profile', red: "case 7:" },
    { id: "link-line-loses-the-path", file: "report-live.mjs", from: '${p ? ` to ${p}` : ""}', to: "", red: "case 7:" },
    { id: "link-line-without-a-link", file: "report-live.mjs", from: "if (rest.length) brokenLines.push(", to: "brokenLines.push(", red: "case 9:" },
    { id: "platforms-not-grouped", file: "report-live.mjs", from: "names = [...new Set(ps)].sort()", to: "names = [...new Set(ps)].slice(0, 1)", red: "case 8:" },
    { id: "old-summary-fallback-gone", file: "report-live.mjs", from: ".filter((u) => !dead.some((r) => r.profileUrl === u))", to: ".filter(() => false)", red: "case 10:" },
    { id: "none-line-without-a-link-read", file: "report-live.mjs", from: '!brokenLines.length && (d.rows || []).some((r) => r.status === "ok" && r.linkStatus != null)', to: "!brokenLines.length", red: "case 11:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socialwords-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-social-words.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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

const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test";
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const cap = (subject, site, o) => ({ capturedAt: ago(1), browser: "owner's Edge", subject, site, ...o });
const day = (d) => ago(d).slice(0, 10), OLD = SITE + "old-listing";
const prof = (platform, o) => ({ capturedAt: ago(1), browser: "owner's Edge", platform, handle: "svr", profileUrl: `https://www.${platform}.example/svr`, ...o });
const NONE = { linkTarget: null, linkStatus: null };
const PA = {
  "youtube.json": prof("youtube", { followers: 1200, posts: 58, newestPostDate: day(10), linkTarget: SITE, linkStatus: 200 }),
  "youtube-2.json": prof("youtube", { handle: "svr2", profileUrl: "https://www.youtube.example/svr2", followers: 10, posts: 3, newestPostDate: null, ...NONE }),
  "instagram.json": prof("instagram", { followers: 300, posts: 12, newestPostDate: day(200), linkTarget: OLD, linkStatus: 404 }),
  "facebook.json": prof("facebook", { followers: 50, posts: 5, newestPostDate: null, ...NONE }) };
const PB = {
  "instagram.json": prof("instagram", { followers: 300, posts: 12, newestPostDate: day(200), linkTarget: SITE, linkStatus: 200 }),
  "x.json": prof("x", { followers: 20, posts: 0, newestPostDate: null, ...NONE }) };
const PC = {
  "instagram.json": prof("instagram", { followers: 300, posts: 12, newestPostDate: day(200), linkTarget: OLD, linkStatus: 404 }),
  "tiktok.json": prof("tiktok", { followers: 40, posts: null, newestPostDate: null, linkTarget: OLD, linkStatus: 404 }) };
const PE = {
  "tiktok.json": prof("tiktok", { followers: 40, posts: 4, newestPostDate: day(5), ...NONE }) };
const LA = "- 4 profiles read; 1,560 followers in total; active on: youtube; not active on: instagram; not judged (post date not read): facebook";
const LB = "- 2 profiles read; 320 followers in total; active on: none; not active on: instagram, x";
const LC = "- 2 profiles read; 340 followers in total; not active on: instagram; not judged (post date not read): tiktok";
const LD = "- 2 profiles read; 1,500 followers in total; active on: instagram", LDL = "- Links on the social profiles that do not open: https://tiktok.example/x1";
const tmp = mkTmp("social-words"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
let n = 0;
const world = () => { const cwd = path.join(tmp, `w${n++}`); return { cwd, pewp: path.join(cwd, "site-checks", HOST, ".pewp") }; };
const report = async (w) => {
  const sd = path.join(w.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
  W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
  W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg });
  W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
  const r = await run("report-live.mjs", [SITE, "--cwd", w.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(w.pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const sec = (md.split("### Social profiles")[1] || "").split("\n### ")[0];
  return { code: r.code, sec, line: (s) => sec.split("\n").find((l) => l.startsWith("- " + s)) || "(no line for " + s + ")" };
};
const go = async (files) => {
  const w = world();
  for (const [f, b] of Object.entries(files)) W(path.join(w.pewp, "captures", "social", f), b);
  const ri = await run("import-social.mjs", [SITE, "--cwd", w.cwd]), o = path.join(w.pewp, "research", "social.json");
  const doc = ri.code === 0 && fs.existsSync(o) ? J(o) : { summary: {}, rows: [] };
  return { code: ri.code, s: doc.summary || {}, rows: doc.rows || [], rp: await report(w) };
};
const first = (g) => g.rp.sec.split("\n").find((l) => l.startsWith("- ") && /profiles? read/.test(l)) || "(no profiles line)";
const links = (g) => g.rp.sec.split("\n").filter((l) => /^- Links/.test(l));
const lists = (g) => JSON.stringify([g.s.platformsActive, g.s.platformsNotActive, g.s.platformsNotJudged]);
const row = (g, f) => g.rows.find((r) => r.file === f) || {};
try {
  const A = await go(PA), B = await go(PB), C = await go(PC), E = await go(PE), O = world();
  W(path.join(O.pewp, "research", "social.json"), { rows: [{ file: "a.json", capturedAt: "2026-10-20T10:00:00Z", ageDays: 1, stale: false }], summary: { profilesRead: 2, blocked: 0, totalFollowers: 1500, platformsActive: ["instagram"], linksBroken: ["https://tiktok.example/x1"] } });
  const D = { rp: await report(O) };
  const ok = [A, B, C, E].every((g) => g.code === 0 && g.rp.code === 0) && D.rp.code === 0, d = (g) => `${lists(g)} | ${first(g)} | ${links(g).join(" / ")}`;
  check("case 1: the summary names three states: youtube active (one profile active, one not judged), instagram not active (old date), facebook not judged (5 posts, no date read)", ok && lists(A) === '[["youtube"],["instagram"],["facebook"]]', d(A));
  check("case 2: the report says each state in words: active on, not active on, not judged (post date not read); it never says none here", ok && first(A) === LA && !/none/.test(first(A)), first(A));
  check("case 3: every platform judged and none active: the report says none are active and names the platforms not active, no not-judged part", ok && lists(B) === '[[],["instagram","x"],[]]' && first(B) === LB, d(B));
  check("case 4: a profile read with 0 posts is judged and not active; a profile with 5 posts and no date is not judged and its active stays false", ok && row(B, "x.json").judged === true && row(B, "x.json").active === false && row(A, "facebook.json").judged === false && row(A, "facebook.json").active === false && row(A, "facebook.json").daysSinceNewest === null && row(A, "instagram.json").judged === true, JSON.stringify([row(B, "x.json"), row(A, "facebook.json")]));
  check("case 5: nothing active and one platform with an unknown post count and no date: the report names it as not judged and never says none", ok && lists(C) === '[[],["instagram"],["tiktok"]]' && first(C) === LC && !/none/.test(first(C)), d(C));
  check("case 6: what the summary already said keeps its meaning: profiles, blocked, followers, active platforms and the broken link address", ok && A.s.profilesRead === 4 && A.s.blocked === 0 && A.s.totalFollowers === 1560 && JSON.stringify(A.s.platformsActive) === '["youtube"]' && JSON.stringify(A.s.linksBroken) === '["https://www.instagram.example/svr"]' && row(A, "youtube.json").active === true && row(A, "instagram.json").active === false, JSON.stringify(A.s));
  check("case 7: a profile's link to a page of the site that answers 404: the line says the link is on the profile and holds no from the site", ok && JSON.stringify(links(A)) === '["- Links on the instagram profile to /old-listing open a 404 page"]' && !/from the site/i.test(A.rp.sec), links(A).join(" / "));
  check("case 8: two profiles with the same dead target are one line naming both platforms, profiles in the plural", ok && JSON.stringify(links(C)) === '["- Links on the instagram, tiktok profiles to /old-listing open a 404 page"]', links(C).join(" / "));
  check("case 9: no broken link and a link status was read: the block still says the links were looked at, in one true line", ok && B.s.linksBroken.length === 0 && JSON.stringify(links(B)) === '["- Links on the profiles that do not open: none"]' && !/from the site/i.test(B.rp.sec), links(B).join(" / ") || "(no link line)");
  check("case 10: a summary written by the old importer (no new keys, no rows detail) prints its activity as before and its broken address in the fallback line", D.rp.code === 0 && first(D) === LD && JSON.stringify(links(D)) === JSON.stringify([LDL]) && !/not judged|from the site/i.test(D.rp.sec), `${first(D)} | ${links(D).join(" / ")}`);
  check("case 11: no link status read on any profile: no link line at all, never the none line (nothing was looked at)", ok && E.s.linksBroken.length === 0 && links(E).length === 0 && first(E) === "- 1 profile read; 40 followers in total; active on: tiktok", `${first(E)} | ${links(E).join(" / ") || "(no link line)"}`);
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
