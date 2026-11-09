// Usage: node test-authority.mjs [--scripts <dir>] [--quiet] [--mutants [--only <id>]]
// Self-test of the authority lane (stages/authority.md, rules/link-sources/, authority-classify / authority-vet / authority-outreach) on
// FIXTURES ONLY: a local http server stands in for every site, and a network guard refuses any non-local request (the guard is itself
// tested). Real example data: the link lists in the fixture are the domains found for the Francine and Eli realtor research (2026-10-22).
// --mutants: watched-fail. Copies the skill, breaks one rule at a time, runs this test on the copy and requires the named check to go
//   red (a mutant that leaves it green means the check measures nothing, or the patch never applied). Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "gap-not-first", file: "authority-lib.mjs", from: "TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score", to: "b.score", red: "classify: link gap first" },
    { id: "ai-tier-ignored", file: "authority-lib.mjs", from: "for (const x of aiCitations?.citedInstead || []) {", to: "for (const x of []) {", red: "classify: sources AI engines cited" },
    { id: "gap-needs-three", file: "authority-lib.mjs", from: 'const tier = n >= 2 ? "gap"', to: 'const tier = n >= 3 ? "gap"', red: "classify: link gap first" },
    { id: "unknown-guessed", file: "authority-lib.mjs", from: 'return hit("unclassified", null, null, "no rule matched this domain name");', to: 'return hit("directory", "low", "guess", "guess");', red: "classify: an unknown domain stays unclassified" },
    { id: "known-hosts-skipped", file: "authority-lib.mjs", from: "const kh = rules.tax.knownHosts.find((e) => hostIs(d, e.host));", to: "const kh = null;", red: "classify: chamberofcommerce.com is a directory" },
    { id: "same-brand-off", file: "authority-lib.mjs", from: "return s.length >= 6 && l.includes(s);", to: "return false;", red: "classify: a competitor's own other domain" },
    { id: "already-links-kept", file: "authority-lib.mjs", from: "if (ours.has(d)) { alreadyHave.push(", to: "if (false) { alreadyHave.push(", red: "classify: a site that already links to the business" },
    { id: "listed-citation-kept", file: "authority-lib.mjs", from: 'if (r.serp?.status === "listed") {', to: "if (false) {", red: "classify: a directory the business is already listed on" },
    { id: "fetch-without-flag", file: "authority-classify.mjs", from: "  if (o.fetch) {\n    refuseMangled", to: "  if (true) {\n    refuseMangled", red: "classify: no request without --fetch" },
    { id: "text-rules-off", file: "authority-lib.mjs", from: 'if (cls.type === "unclassified" && fetchedInfo?.title !== undefined) {', to: "if (false) {", red: "classify --fetch: a home page title classifies" },
    { id: "brokerage-guard-off", file: "authority-lib.mjs", from: 'if (pe?.onlyIf === "brokerage" && !brokerageMatches(business, pe))', to: "if (false)", red: "classify: another brokerage's roster" },
    { id: "pack-aliases-off", file: "authority-lib.mjs", from: "(p.aliases || []).map(norm).includes(n)", to: "false", red: "pack: an alias picks the pack" },
    { id: "baseline-off", file: "authority-lib.mjs", from: "if (e.baseline) {", to: "if (false) {", red: "classify: the pack's usual places" },
    { id: "truncation-silent", file: "authority-lib.mjs", from: "if (c.inGraph && (c.strongestLinkingDomains || []).length < c.linkingDomains)", to: "if (false)", red: "classify: a cut-off competitor list is said" },
    { id: "spam-rule-off", file: "authority-lib.mjs", from: "for (const r of spam) if (re(r.re).test(d))", to: "for (const r of []) if (re(r.re).test(d))", red: "classify: spam words in a domain name" },
    { id: "robots-ignored", file: "authority-lib.mjs", from: "if (!robotsAllows(rb.groups, x.pathname + x.search, ua)) return", to: "if (false) return", red: "vet: robots.txt disallow" },
    { id: "robots-agent-group-ignored", file: "authority-lib.mjs", from: "const specific = groups.filter((g) => g.agents.some((a) => a !== \"*\" && u.includes(a)));", to: "const specific = [];", red: "vet: robots.txt group for our own user agent" },
    { id: "429-not-stopped", file: "authority-lib.mjs", from: "if (r.status === 429 || r.status === 403) { stopped.set(host, r.status);", to: "if (false) { stopped.set(host, r.status);", red: "vet: a 429 stops that site" },
    { id: "403-not-stopped", file: "authority-lib.mjs", from: "r.status === 429 || r.status === 403", to: "r.status === 429", red: "vet: a 403 stops that site" },
    { id: "noindex-meta-ignored", file: "authority-lib.mjs", from: "const noindex = a.noindexMeta || /\\bnoindex\\b|\\bnone\\b/.test(xrobots);", to: "const noindex = /\\bnoindex\\b|\\bnone\\b/.test(xrobots);", red: "vet: noindex in the page" },
    { id: "xrobots-ignored", file: "authority-lib.mjs", from: "const noindex = a.noindexMeta || /\\bnoindex\\b|\\bnone\\b/.test(xrobots);", to: "const noindex = a.noindexMeta;", red: "vet: noindex in the X-Robots-Tag header" },
    { id: "xrobots-not-cached", file: "cache.mjs", from: "headers: keepHeaders(res.headers),", to: "headers: {},", red: "vet: noindex in the X-Robots-Tag header" },
    { id: "rel-ignored", file: "authority-lib.mjs", from: "l.rel.some((r) => QUALIFIED.includes(r))", to: "false", red: "vet: nofollow links are seen" },
    { id: "sells-links-ignored", file: "authority-lib.mjs", from: 'if (sells.length) s.push({ code: "SELLS_LINKS"', to: 'if (false) s.push({ code: "SELLS_LINKS"', red: "vet: a site that sells links" },
    { id: "paid-model-off", file: "authority-lib.mjs", from: 'const model = paid.length && !free.length ? "paid"', to: 'const model = false ? "paid"', red: "vet: a paid listing" },
    { id: "submit-detection-off", file: "authority-lib.mjs", from: 'kind: "free-listing", rank: 1, re: /get listed|', to: 'kind: "free-listing", rank: 1, re: /zzzzzzzz|', red: "vet: the listing page is found" },
    { id: "thin-ignored", file: "authority-lib.mjs", from: "if (words < 150) s.push(", to: "if (false) s.push(", red: "vet: a thin site" },
    { id: "exclude-ignored", file: "authority-lib.mjs", from: "if (excludes.some((r) => r.test(x.pathname)))", to: "if (false)", red: "vet: --exclude covers" },
    { id: "register-visited", file: "authority-lib.mjs", from: "const NO_VISIT = /\\b(login|log-in|signin|sign-in|register|", to: "const NO_VISIT = /\\b(zzzz|", red: "vet: a register or login path is never visited" },
    { id: "dishonest-user-agent", file: "authority-lib.mjs", from: "export const UA = `PEWP-Authority/1.0 (link-source check for a site owner; read-only, GET only; contact ${process.env.PEWP_CONTACT || \"see skill\"})`;", to: "export const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36`;", red: "vet: GET only, honest user agent" },
    { id: "deadline-ignored", file: "authority-lib.mjs", from: 'if (Date.now() > deadline) throw new Stop("run time cap reached", 4);', to: "", red: "vet: the run deadline" },
    { id: "budget-ignored", file: "authority-lib.mjs", from: "if (stats.requests >= maxRequests) throw new Stop(", to: "if (false) throw new Stop(", red: "vet: the request budget" },
    { id: "vetted-not-reused", file: "authority-vet.mjs", from: "if (old?.verdict && (!o.refresh || refused) && Date.now() - Date.parse(old.visitedAt) < maxAge) {", to: "if (false) {", red: "vet: a site vetted recently is reused" },
    { id: "redirect-elsewhere-ignored", file: "authority-lib.mjs", from: "if (rec.site.redirectedTo) return finish(", to: "if (false) return finish(", red: "vet: an address that redirects to another site" },
    { id: "origin-guard-off", file: "authority-lib.mjs", from: 'if (![\"127.0.0.1\", \"localhost\", \"[::1]\"].includes(h)) throw', to: "if (false) throw", red: "vet: --origin refuses a non-local address" },
    { id: "nofollow-only-passes", file: "authority-lib.mjs", from: 'if (outbound.label === "nofollow" && gives.followedLink !== "rare" && gives.followedLink !== undefined)', to: "if (false)", red: "vet: nofollow-only links" },
    { id: "avoid-reasons-dropped", file: "authority-lib.mjs", from: 'if (avoid.length) return finish("AVOID"', to: 'if (false) return finish("AVOID"', red: "vet: a link farm" },
    { id: "howto-avoid-listed-as-todo", file: "authority-lib.mjs", from: 'L.push("## Avoid", "", ...(group("AVOID").length ?', to: 'L.push("## Avoid", "", ...(false ?', red: "vet: howto.md lists avoided sites" },
    { id: "listed-without-evidence", file: "authority-outreach.mjs", from: 'if (status === "listed") { if (!evidence)', to: 'if (false) { if (!evidence)', red: "outreach: listed needs an evidence URL" },
    { id: "evidence-host-unchecked", file: "authority-outreach.mjs", from: "if (!hostIs(hostOf(url), domain)) throw", to: "if (false) throw", red: "outreach: the evidence must be on that site" },
    { id: "duplicate-allowed", file: "authority-outreach.mjs", from: "if (doc.entries.some((e) => e.domain === d)) throw", to: "if (false) throw", red: "outreach: a site appears once" },
    { id: "future-date-allowed", file: "authority-outreach.mjs", from: "if (date > today) throw", to: "if (false) throw", red: "outreach: dates are real and not in the future" },
    { id: "ask-without-owner", file: "authority-outreach.mjs", from: 'if (!owner) throw new Invalid("an owner is needed before a site is asked");', to: "", red: "outreach: an owner is needed before asking" },
    { id: "explain-asked-as-listed", file: "authority-outreach.mjs", from: 'if (e.status === "listed") return { domain: e.domain, explained: "outreach-listed"', to: 'if (true) return { domain: e.domain, explained: "outreach-listed"', red: "outreach: explain" },
    { id: "seed-takes-everything", file: "authority-outreach.mjs", from: "if (r.verdict !== verdict ||", to: "if (false ||", red: "outreach: seed adds only the vetted PURSUE sites" },
    { id: "follow-up-immediately", file: "authority-outreach.mjs", from: "/ 86400000 >= days).map", to: "/ 86400000 >= 0).map", red: "outreach: follow-ups are asked 21+ days ago" },
  ];
  const MUT2 = [
    { id: "unknown-kind-passes", file: "authority-lib.mjs", from: "if (typeDef?.value == null) return finish(", to: "if (false) return finish(", red: "vet: a site of an unknown kind is never PURSUE" },
    { id: "refresh-revisits-refusals", file: "authority-vet.mjs", from: "(!o.refresh || refused)", to: "(!o.refresh)", red: "vet: --refresh does not visit a site that refused us" },
    { id: "stale-results-kept", file: "authority-vet.mjs", from: "const results = new Map(); //", to: "const results = new Map(prevBy); //", red: "vet: vetting.json holds only the sites of this run" },
    { id: "bare-pricing-is-paid", file: "authority-lib.mjs", from: "\\b(pricing (and|&) plans|pricing page|", to: "\\b(pricing|", red: "vet: a bare 'pricing'" },
    { id: "ai-scope-off", file: "authority-lib.mjs", from: "if (!belongs(row.question)) { droppedQ.add(row.question); continue; }", to: "if (false) { droppedQ.add(row.question); continue; }", red: "classify: AI-cited sources only count when the question belongs" },
    { id: "ai-offer-fallback-off", file: "authority-lib.mjs", from: ".filter((t) => !places.has(t) && offerT.has(t)).length >= 1;", to: ".filter((t) => !places.has(t) && offerT.has(t)).length >= 99;", red: "classify: AI-cited sources fall back on the offer" },
    { id: "ai-unfiltered-note-lost", file: "authority-lib.mjs", from: ": \"unfiltered: no targets.json and no offer to judge questions by\"", to: ": \"filtered\"", red: "classify: with nothing to judge questions by" },
    { id: "provider-name-off", file: "authority-lib.mjs", from: "for (const src of pack?.providerPatterns || []) if (re(src).test(labelOf(d)))", to: "for (const src of []) if (re(src).test(labelOf(d)))", red: "classify: provider businesses by name" },
    { id: "provider-beats-everything", file: "authority-lib.mjs", from: "  const ph = (pack?.domainTypes || []).find((e) => hostIs(d, e.host));", to: "  for (const src of pack?.providerPatterns || []) if (re(src).test(labelOf(d))) return hit(\"provider-business\", \"medium\", \"x\", \"neighbouring service\");\n  const ph = (pack?.domainTypes || []).find((e) => hostIs(d, e.host));", red: "classify: a provider-looking name never overrides" },
    { id: "provider-text-off", file: "authority-lib.mjs", from: "const t = providerByText(txt, pack) || classifyText(txt, rules);", to: "const t = classifyText(txt, rules);", red: "classify --fetch: a provider business is recognised" },
    { id: "provider-text-too-broad", file: "authority-lib.mjs", from: "for (const src of pack?.providerText || []) { const m = t.match(re(src));", to: "for (const src of [...(pack?.providerText || []), \"real estate agents?\"]) { const m = t.match(re(src));", red: "classify: provider wording on a home page is recognised" },
    { id: "provider-vet-off", file: "authority-lib.mjs", from: "const prov = checkProvider ? providerByText(", to: "const prov = false ? providerByText(", red: "vet: a provider business of an unclassified kind" },
    { id: "provider-vet-on-typed-sites", file: "authority-vet.mjs", from: 'checkProvider: typeId === "unclassified"', to: "checkProvider: true", red: "vet: provider wording on a site already classified" },
    { id: "partner-not-demoted", file: "authority-lib.mjs", from: 'if (cls.type === "partner-supplier" && (tier === "ai" || tier === "serp")) base.tier = "partner";', to: "", red: "classify: a partner type named by the pack ranks low" },
    { id: "unclassified-ai-only-stays", file: "authority-lib.mjs", from: 'if (cls.type === "unclassified" && (tier === "ai" || tier === "serp" || tier === "baseline")) {', to: "if (false) {", red: "classify: only kinds of site that link out" },
    { id: "cc-stall-watchdog-off", file: "authority.mjs", from: "if (Date.now() - last > stallMs) {", to: "if (false) {", red: "authority.mjs: a download that stalls" },
    { id: "cc-stream-error-dropped", file: "authority.mjs", from: 'src.on("error", (e) => gunzip.destroy(e));', to: "", red: "authority.mjs: a connection cut" },
    { id: "cc-part-cleared-on-error", file: "authority.mjs", from: "    src.destroy();\n    if (cacheDone) { out.destroy();", to: "    src.destroy(); if (file) fs.rmSync(file + \".part\", { force: true });\n    if (cacheDone) { out.destroy();", red: "authority.mjs: a download that arrives whole but truncated" },
    { id: "cc-part-never-cleared", file: "authority.mjs", from: "if (cacheDone) { await cacheDone; fs.rmSync(file + \".part\", { force: true }); }", to: "if (cacheDone) { await cacheDone; }", red: "authority.mjs: a complete download is read" },
    { id: "main-check-exact-path", file: "lib-main.mjs", from: "try { return norm(fs.realpathSync(arg)) === norm(fs.realpathSync(me)); }", to: "try { return norm(arg) === norm(fs.realpathSync(me)); }", red: "authority.mjs: started through a junction" },
    { id: "vet-bad-regex-crash", file: "authority-vet.mjs", from: "const excludes = compileExcludes(o.exclude);", to: "const excludes = (o.exclude || []).map((r) => new RegExp(r));", red: "vet: an --exclude that is not a valid" },
    { id: "listing-candidate-bad-percent", file: "authority-lib.mjs", from: "const hay = `${l.text} ${safeDecode(p)}`;", to: "const hay = `${l.text} ${decodeURIComponent(p)}`;", red: "vet: a link with a stray %" },
  ];
  MUT.push(...MUT2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mut-auth-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    if (!src.includes(m.from)) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text not found in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, m.to));
    const c = spawn(process.execPath, [path.join(copy, "scripts", "test-authority.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (check measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected check"} | expected "${m.red}" | failed: ${failed.slice(0, 4).join(" ; ") || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- the network guard (installed before anything is imported)
const guardLog = [];
const isLocalHost = (h) => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(h);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const url = typeof input === "string" ? input : input?.url ?? String(input); let h = ""; try { h = new URL(url).hostname; } catch {} if (!isLocalHost(h)) { guardLog.push(url); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); } return realFetch(input, init); };
process.env.PEWP_TEST_GAP_MS = "0";

// ---------------------------------------------------------------- harness
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-authority-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 500)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 500)}`); };
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); return p; };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
const spawnP = (cmd, a, opts) => new Promise((res) => { const p = spawn(cmd, a, { ...opts, stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d)); const t = setTimeout(() => p.kill(), 120000); p.on("close", (code) => { clearTimeout(t); res({ code, out: o, err: e }); }); });
const cli = (script, a, env = {}) => spawnP(process.execPath, [path.join(dir, script), ...a], { cwd: tmp, env: { ...process.env, PEWP_TEST_GAP_MS: "0", ...env } });

// ---------------------------------------------------------------- fixture: the sites
const words = (n, seed = "guide") => Array.from({ length: n }, (_, i) => `${seed}${i % 37}`).join(" ");
const page = ({ title = "A site", desc = "A site about local things", robots = null, body = "" }) => `<!doctype html><html><head><title>${title}</title><meta name="description" content="${desc}">${robots ? `<meta name="robots" content="${robots}">` : ""}</head><body><h1>${title}</h1>${body}</body></html>`;
const ext = (n, rel = "", pre = "partner") => Array.from({ length: n }, (_, i) => `<a href="https://${pre}${i}.example/"${rel ? ` rel="${rel}"` : ""}>Partner ${i}</a>`).join(" ");
const ALLOW = "User-agent: *\nAllow: /\n";
const SITES = {
  "good-dir.example": { "/robots.txt": ALLOW, "/": page({ title: "Local Agents Directory", desc: "Find local agents", body: `<p>${words(400)}</p>${ext(5)}<a href="/add-your-business">Add your business - it's free</a>` }), "/add-your-business": page({ title: "Add your business", body: `<p>Claim your free listing. Get listed today. ${words(120)}</p>${ext(2, "", "member")}` }) },
  "link-farm.example": { "/robots.txt": ALLOW, "/": page({ title: "SEO Links Hub", body: `<p>Buy backlinks and paid links here. Dofollow links for every niche. ${words(300)}</p>${ext(80, "", "farm")}` }) },
  "noindex.example": { "/robots.txt": ALLOW, "/": page({ title: "Hidden Directory", robots: "noindex, follow", body: `<p>${words(400)} Add your business free.</p>${ext(4)}` }) },
  "xrobots.example": { "/robots.txt": ALLOW, "/": { headers: { "x-robots-tag": "noindex" }, body: page({ title: "Header Hidden", body: `<p>${words(400)}</p>${ext(4)}<a href="/get-listed">Get listed</a>` }) } },
  "robots-closed.example": { "/robots.txt": "User-agent: *\nDisallow: /\n", "/": page({ title: "Closed", body: `<p>${words(300)}</p>` }) },
  "robots-ua.example": { "/robots.txt": "User-agent: pewp-authority\nDisallow: /\n\nUser-agent: *\nAllow: /\n", "/": page({ title: "Closed to us", body: `<p>${words(300)}</p>` }) },
  "rate-limited.example": { "/": { status: 429, body: "slow down" } },
  "forbidden.example": { "/": { status: 403, body: "no" } },
  "nofollow-dir.example": { "/robots.txt": ALLOW, "/": page({ title: "All Nofollow Guide", body: `<p>${words(400)} Add your business for free.</p>${ext(6, "nofollow")}<a href="/get-listed">Get listed</a>` }), "/get-listed": page({ title: "Get listed", body: `<p>Submit your business. ${words(100)}</p>${ext(2, "nofollow", "m")}` }) },
  "profile-site.example": { "/robots.txt": ALLOW, "/": page({ title: "Profile Platform", body: `<p>${words(400)}</p>${ext(6, "nofollow ugc")}<a href="/claim">Claim your profile</a>` }), "/claim": page({ title: "Claim", body: `<p>Claim your free profile. ${words(100)}</p>` }) },
  "editorial.example": { "/robots.txt": ALLOW, "/": page({ title: "Valley News", body: `<p>${words(400)}</p>${ext(4)}<a href="/write-for-us">Write for us</a>` }), "/write-for-us": page({ title: "Write for us", body: `<p>Our editors review every pitch. Guest contributor guidelines: ${words(120)}</p>` }) },
  "paid.example": { "/robots.txt": ALLOW, "/": page({ title: "Premium Directory", body: `<p>${words(400)} Premium listing $49 per month. Featured listing. Pricing and plans.</p>${ext(4)}<a href="/advertise">Advertise with us</a>` }), "/advertise": page({ title: "Advertise", body: `<p>Pricing. Choose a plan. ${words(80)}</p>` }) },
  "thin.example": { "/robots.txt": ALLOW, "/": page({ title: "Tiny", body: `<p>${words(30)}</p>${ext(3)}<a href="/get-listed">Get listed</a>` }), "/get-listed": page({ title: "Get listed", body: "<p>Free listing.</p>" }) },
  "parked.example": { "/robots.txt": ALLOW, "/": page({ title: "parked", body: `<p>This domain is for sale. Buy this domain today.</p>` }) },
  "redirect.example": { "/robots.txt": ALLOW, "/": { status: 301, headers: { location: "/new" }, body: "" }, "/new": page({ title: "Moved Within", body: `<p>${words(400)} Add your business free.</p>${ext(4)}<a href="/add">Add your business</a>` }), "/add": page({ title: "Add", body: `<p>Get listed free. ${words(100)}</p>` }) },
  "moved.example": { "/robots.txt": ALLOW, "/": { status: 301, headers: { location: "https://other-site.example/" }, body: "" } },
  "other-site.example": { "/robots.txt": ALLOW, "/": page({ title: "Some Other Company", body: `<p>${words(400)}</p>` }) },
  "dead.example": { "/robots.txt": ALLOW, "/": { status: 404, body: "gone" } },
  "slow.example": { "/robots.txt": ALLOW, "/": { delay: 1500, body: page({ title: "Slow", body: `<p>${words(300)}</p>` }) } },
  "excluded-listing.example": { "/robots.txt": ALLOW, "/": page({ title: "Has A Listing Page", body: `<p>${words(400)} Add your business free.</p>${ext(4)}<a href="/claim-listing">Claim your listing</a>` }), "/claim-listing": page({ title: "Claim", body: `<p>Free. ${words(100)}</p>` }) },
  "trap.example": { "/robots.txt": ALLOW, "/": page({ title: "Has Account Links", body: `<p>${words(400)}</p>${ext(4)}<a href="/register">Register your business</a> <a href="/login">Log in to claim</a> <a href="/checkout">Get listed (checkout)</a> <a href="/submit">Submit your business</a>` }), "/submit": page({ title: "Submit", body: `<p>Free listing. ${words(100)}</p>` }), "/register": page({ title: "Register", body: "<p>register</p>" }) },
  // classify --fetch fixtures
  "goflydragon.com": { "/robots.txt": ALLOW, "/": page({ title: "Bay Area Real Estate Podcast", desc: "Weekly interviews with local agents", body: `<p>${words(200)}</p>` }) },
  "apexleadsource.com": { "/robots.txt": "User-agent: *\nDisallow: /\n", "/": page({ title: "Apex Lead Source", body: "<p>secret</p>" }) },
  "nelsonmaid.com": { "/": { status: 429, body: "slow down" } },
  "zzunknownlist.com": { "/robots.txt": ALLOW, "/": page({ title: "We Buy Houses Fast - Get a Cash Offer", desc: "Sell your house fast for cash", body: `<p>${words(200)}</p>` }) },
  "sangama.us": { "/robots.txt": ALLOW, "/": page({ title: "Sangama Cultural Society Events", body: `<p>${words(200)}</p>` }) },
  "cash-buyer.example": { "/robots.txt": ALLOW, "/": page({ title: "Bay Area Cash Home Buyers", desc: "We buy houses in any condition. Get a cash offer today.", body: `<p>${words(400)}</p>${ext(4)}<a href="/contact">Contact us</a>` }) },
  "unknown-kind.example": { "/robots.txt": ALLOW, "/": page({ title: "Some Resource Site", body: `<p>${words(400)} Add your business free.</p>${ext(4)}<a href="/add">Add your business</a>` }), "/add": page({ title: "Add", body: `<p>Get listed free. ${words(100)}</p>` }) },
  "directory-says-we-buy.example": { "/robots.txt": ALLOW, "/": page({ title: "Agent Directory", desc: "Find agents. Some sell your house fast for cash.", body: `<p>${words(400)} Add your business free.</p>${ext(4)}<a href="/add">Add your business</a>` }), "/add": page({ title: "Add", body: `<p>Get listed free. ${words(100)}</p>` }) },
  "ark7.com": { "/robots.txt": ALLOW, "/": page({ title: "Own shares of rental homes", desc: "Fractional property investing", body: `<p>${words(200)}</p>` }) },
};
const LOG = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const [, dom, ...rest] = u.pathname.split("/");
  const p = "/" + rest.join("/");
  LOG.push({ dom, path: p, method: req.method, ua: req.headers["user-agent"] || "" });
  if (req.method !== "GET") { res.writeHead(405); return res.end(); }
  const site = SITES[dom];
  if (!site) { res.writeHead(404); return res.end("no such site"); }
  let r = site[p];
  if (r === undefined) { res.writeHead(404); return res.end("not found"); }
  if (typeof r === "string") r = { status: 200, body: r };
  const send = () => { res.writeHead(r.status || 200, { "content-type": "text/html; charset=utf-8", ...(r.headers || {}) }); res.end(r.body ?? ""); };
  if (r.delay) setTimeout(send, r.delay); else send();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const PORT = server.address().port;
const origins = new Map(Object.keys(SITES).map((d) => [d, `http://127.0.0.1:${PORT}/${d}`]));
const originArgs = Object.entries(Object.fromEntries(origins)).flatMap(([d, u]) => ["--origin", `${d}=${u}`]);
const countFor = (dom, p = null) => LOG.filter((l) => l.dom === dom && (p === null || l.path === p)).length;

// ---------------------------------------------------------------- fixture: the link data (domains from the realtor research)
const L = (d, h = null) => ({ domain: d, harmonicPos: h });
const AUTH = {
  fetchedAt: "2026-10-22T00:00:00Z", source: "Common Crawl web graph cc-test (domain level)", release: "cc-test", target: "valleytovalleyrealty.com",
  results: [
    { domain: "valleytovalleyrealty.com", role: "target", inGraph: true, linkingDomains: 1, strongestLinkingDomains: [L("linktr.ee", 90000)] },
    { domain: "ramamehra.com", role: "competitor", inGraph: true, linkingDomains: 9, strongestLinkingDomains: [L("expertise.com", 13314), L("activerain.com", 8000000), L("giftofvision.org"), L("1888pressrelease.com"), L("findinmyzip.com", 19595491), L("sangama.us"), L("linktr.ee", 90000), L("casino-links-seo.xyz"), L("laurelbuyshouses.com")] },
    { domain: "josephsabehgroup.com", role: "competitor", inGraph: true, linkingDomains: 7, strongestLinkingDomains: [L("expertise.com", 13314), L("msjchamber.org"), L("goflydragon.com", 6693589), L("nelsonmaid.com"), L("josephsabeh.com"), L("apexleadsource.com"), L("chamberofcommerce.com")] },
    { domain: "joeschembri.com", role: "competitor", inGraph: true, linkingDomains: 12, strongestLinkingDomains: [L("ark7.com"), L("sanjoseinsider.org"), L("goflydragon.com", 6693589), L("top100realestateagents.com"), L("listingnearme.com"), L("findinmyzip.com", 19595491), L("someschool.edu"), L("linktr.ee", 90000)] },
    { domain: "notinthegraph.com", role: "competitor", inGraph: false, note: "not in this release" },
  ],
  linkGap: [{ domain: "expertise.com", linksToCompetitors: 2, harmonicPos: 13314 }, { domain: "goflydragon.com", linksToCompetitors: 2, harmonicPos: 6693589 }, { domain: "findinmyzip.com", linksToCompetitors: 2, harmonicPos: 19595491 }],
};
const BUS = { name: "Valley To Valley Realty", domain: "valleytovalleyrealty.com", industry: "real-estate-agent", offer: "Residential real estate: helping people buy and sell homes in the Central Valley", competitors: ["ramamehra.com", "josephsabehgroup.com", "joeschembri.com"], phone: "(209) 555-0100", locations: [{ address: "1 Main St, Tracy, CA 95376" }], credentials: { brokerage: "Valley Realty Group" } };
const CIT = { step: "citations", status: "ok", sources: [
  { domain: "yelp.com", why: "portal that fills many captured results pages", searches: 8, bestPosition: 1, linkedCompetitors: 0, inLinkGap: false, status: "unknown", statusEvidence: "not checked", evidence: [] },
  { domain: "zillow.com", why: "portal that fills many captured results pages", searches: 63, bestPosition: 1, linkedCompetitors: 0, inLinkGap: false, status: "listed", statusEvidence: "business.json links https://www.zillow.com/profile/x", evidence: [] },
  { domain: "compass.com", why: "its pages read like a directory", searches: 19, bestPosition: 2, linkedCompetitors: 0, inLinkGap: false, status: "unknown", statusEvidence: "not checked", evidence: [] },
] };
const aiRows = [];
const addRows = (q, n, cited) => { for (let k = 0; k < n; k++) aiRows.push({ question: q, engine: "engine" + k, citedSources: cited(k) }); };
// answers to the client's own questions (they match clusters of targets.json): fastexpert in 12, expertise in 5, mapbox 2, google 1, the competitor 3, a provider 3, a partner 3, unknown lists
addRows("best realtor in Tracy, CA", 12, (k) => ["fastexpert.com", ...(k < 5 ? ["expertise.com"] : []), ...(k < 2 ? ["mapbox.com", "mystery-list.example"] : []), ...(k < 1 ? ["accounts.google.com"] : []), ...(k < 3 ? ["ramamehra.com", "sellwithdealmate.com", "firstchoiceescrow.com"] : []), ...(k < 4 ? ["zzunknownlist.com"] : [])]);
// answers to questions that are NOT about the client's business (cash buyers): none of these domains may count
addRows("we buy houses Tracy CA", 6, () => ["kindpathhomebuyers.com", "maplehomebuyers.com", "fastexpert.com"]);
addRows("who buys houses for cash in Tracy, CA", 3, () => ["cashbuyerdirectory.example", "fastexpert.com"]);
const AI = { step: "ai-citations", status: "ok", rows: aiRows, citedInstead: [{ domain: "fastexpert.com", answers: 21 }, { domain: "kindpathhomebuyers.com", answers: 6 }, { domain: "maplehomebuyers.com", answers: 6 }, { domain: "cashbuyerdirectory.example", answers: 3 }] };
const TARGETS = { version: 1, business: "valleytovalleyrealty.com", clusters: [{ id: "c1", primaryQuery: "realtor in tracy ca", queries: ["realtor in tracy ca", "real estate agent tracy ca"] }, { id: "c2", primaryQuery: "home value tracy ca", queries: ["home value tracy ca"] }, { id: "c3", primaryQuery: "[def-05: record only, no page or copy] sell house fast cash buyer tracy ca", queries: ["sell house fast cash buyer tracy ca"] }] };
const mkTarget = (name, { auth = AUTH, bus = BUS, cit = CIT, ai = AI, targets = TARGETS } = {}) => {
  const root = path.join(tmp, name), pewp = path.join(root, "site-checks", "valleytovalleyrealty.com", ".pewp");
  if (auth) w(path.join(pewp, "authority.json"), auth);
  if (bus) w(path.join(pewp, "business.json"), bus);
  if (cit) w(path.join(pewp, "research", "citations.json"), cit);
  if (ai) w(path.join(pewp, "research", "ai-citations.json"), ai);
  if (targets) w(path.join(pewp, "targets.json"), targets);
  return { root, pewp, url: "https://valleytovalleyrealty.com/" };
};

try {
  const Lib = await imp("authority-lib.mjs");
  const C = await imp("authority-classify.mjs");
  const V = await imp("authority-vet.mjs");
  const O = await imp("authority-outreach.mjs");
  const R = await imp("research-lib.mjs");
  const rules = Lib.loadRules();

  // ================================================================ the guard itself
  let refused = false; try { await fetch("https://example.com/", { signal: AbortSignal.timeout(10000) }); } catch (e) { refused = /NETWORK GUARD/.test(e.message); }
  check("guard: a non-local request is refused", refused && guardLog.length === 1, JSON.stringify(guardLog));
  guardLog.length = 0;

  // ================================================================ rules: taxonomy and packs
  const need = ["provider-business", "not-a-source", "directory", "editorial-list", "professional-association", "parent-roster", "platform-profile", "chamber-local", "local-news", "press-release", "sponsorship-charity", "partner-supplier", "podcast-guest", "own-property", "social-link-hub"];
  check("rules: the taxonomy holds every source type the playbook names", need.every((t) => rules.tax.types[t]) && ["unclassified", "spam-suspect", "competitor-own-property", "edu-gov"].every((t) => rules.tax.types[t]), need.filter((t) => !rules.tax.types[t]).join(","));
  const badType = Object.entries(rules.tax.types).filter(([k, t]) => !t.label || !t.what || t.actionable === undefined || !t.gives || !("value" in t) || !("effort" in t) || !t.cost || !t.risk || (t.actionable && k !== "unclassified" && !(t.howTo?.length)));
  check("rules: every type says what it gives, effort, cost, risk and how to get on it", badType.length === 0, badType.map(([k]) => k).join(","));
  const givesOk = need.every((t) => ["followedLink", "citation", "entity", "referral"].every((k) => rules.tax.types[t].gives[k]));
  check("rules: every real type rates followed link, citation, entity signal and referral", givesOk, "");
  const slugs = ["real-estate-agent", "cash-home-buyer", "home-services", "legal", "medical-dental", "restaurant-hospitality", "saas-b2b", "ecommerce", "local-generic"];
  check("rules: the nine industry packs exist", slugs.every((s) => rules.packs.has(s)), slugs.filter((s) => !rules.packs.has(s)).join(","));
  const allRules = [...rules.tax.domainRules, ...rules.tax.tldRules, ...rules.tax.textRules, ...[...rules.packs.values()].flatMap((p) => [...(p.patterns || []), ...(p.providerPatterns || []).map((re) => ({ re })), ...(p.providerText || []).map((re) => ({ re }))])];
  let rxBad = []; for (const r of allRules) { try { new RegExp(r.re, "i"); } catch { rxBad.push(r.re); } }
  const typeBad = [...rules.tax.domainRules, ...rules.tax.tldRules, ...rules.tax.textRules, ...rules.tax.knownHosts, ...[...rules.packs.values()].flatMap((p) => [...(p.patterns || []), ...(p.domainTypes || [])])].filter((r) => !rules.tax.types[r.type]).map((r) => r.type);
  check("rules: every regex compiles and every rule names a real type", !rxBad.length && !typeBad.length, `${rxBad} ${typeBad}`);
  const packBad = [...rules.packs.values()].filter((p) => !p.title || !p.aliases?.length || !p.basis || !/UNVERIFIED/.test(p.basis) || (p.angles || []).length < 3 || (p.avoid || []).length < 2 || (p.domainTypes || []).some((e) => !e.host || e.host !== e.host.toLowerCase() || /^www\.|\//.test(e.host) || !e.cost) || (p.extends || []).some((x) => !rules.packs.has(x)));
  check("rules: each pack has title, aliases, a basis marked UNVERIFIED, 3+ angles, 2+ things to avoid, clean hosts with a cost", packBad.length === 0, packBad.map((p) => p.slug).join(","));
  check("rules: every pack has provider name patterns and wording that compile; the realtor and cash-buyer packs name the cash-buyer shapes", [...rules.packs.values()].every((p) => Array.isArray(p.providerPatterns) && Array.isArray(p.providerText)) && ["real-estate-agent", "cash-home-buyer"].every((k) => /cashfor/.test(rules.packs.get(k).providerPatterns[0]) && /we buy/.test(rules.packs.get(k).providerText[0])), "");
  check("rules: pack aliases are unique across packs", (() => { const seen = new Map(); for (const p of rules.packs.values()) for (const a of [p.slug, ...p.aliases].map(Lib.norm)) { if (seen.has(a) && seen.get(a) !== p.slug) return false; seen.set(a, p.slug); } return true; })(), "");

  // ================================================================ pack selection
  const pick = (b, o) => Lib.pickPack(rules, b, o);
  check("pack: the industry in business.json picks its pack", pick({ industry: "real-estate-agent" }).pack.slug === "real-estate-agent" && pick({ kind: "cash-home-buyer" }).pack.slug === "cash-home-buyer", "");
  check("pack: an alias picks the pack", pick({ industry: "Realtor" }).pack.slug === "real-estate-agent" && pick({ industry: "Plumber" }).pack.slug === "home-services" && pick({ industry: "Dentist" }).pack.slug === "medical-dental", `${pick({ industry: "Realtor" }).pack.slug}`);
  const fb = pick({ industry: "underwater basket weaving" });
  check("pack: an unknown industry falls back to local-generic and says so", fb.pack.slug === "local-generic" && fb.via === "fallback" && /no pack/.test(fb.note), JSON.stringify(fb.note));
  check("pack: insurance-agency is picked by slug, by alias, and by kind; it extends local-generic and names its trade associations and its competitor shapes", pick({ industry: "insurance-agency" }).pack.slug === "insurance-agency" && pick({ industry: "Life Insurance Agent" }).pack.slug === "insurance-agency" && pick({ kind: "imo" }).pack.slug === "insurance-agency" && Lib.mergedPack(rules, rules.packs.get("insurance-agency")).chain.join(">") === "insurance-agency>local-generic" && rules.packs.get("insurance-agency").domainTypes.some((e) => e.host === "naifa.org" && e.type === "professional-association") && new RegExp(rules.packs.get("insurance-agency").providerPatterns[0], "i").test("bestlifeinsuranceagency") && new RegExp(rules.packs.get("insurance-agency").providerText[0], "i").test("Get a free life insurance quote from our licensed agents"), "");
  check("pack: --industry overrides business.json", pick({ industry: "legal" }, "saas-b2b").pack.slug === "saas-b2b", "");
  const mp = Lib.mergedPack(rules, rules.packs.get("real-estate-agent"));
  check("pack: a local pack extends local-generic (own entries first)", mp.chain.join(">") === "real-estate-agent>local-generic" && mp.domainTypes[0].pack === "real-estate-agent" && mp.domainTypes.some((e) => e.host === "yelp.com"), mp.chain.join(">"));

  // ================================================================ classify: domain names
  const base = { rules, pack: mp, target: "valleytovalleyrealty.com", competitors: ["ramamehra.com", "josephsabehgroup.com", "joeschembri.com"] };
  const cl = (d, ctx = base) => Lib.classifyDomain(d, ctx);
  check("classify: a pack host is named by the pack", cl("activerain.com").type === "professional-association" && cl("zillow.com").type === "platform-profile" && cl("www.Zillow.com").type === "platform-profile", cl("activerain.com").type);
  check("classify: expertise.com is an editorial list", cl("expertise.com").type === "editorial-list" && cl("expertise.com").confidence === "high", "");
  check("classify: chamberofcommerce.com is a directory, not a chamber", cl("chamberofcommerce.com").type === "directory" && cl("msjchamber.org").type === "chamber-local", `${cl("chamberofcommerce.com").type} ${cl("msjchamber.org").type}`);
  check("classify: press-release, charity, news and ranking-list names", cl("1888pressrelease.com").type === "press-release" && cl("giftofvision.org").type === "sponsorship-charity" && cl("sanjoseinsider.org").type === "local-news" && cl("top100realestateagents.com").type === "editorial-list", [cl("1888pressrelease.com").type, cl("giftofvision.org").type, cl("sanjoseinsider.org").type, cl("top100realestateagents.com").type].join(","));
  check("classify: link hubs, schools and government", cl("linktr.ee").type === "social-link-hub" && cl("someschool.edu").type === "edu-gov" && cl("cityoftracy.gov").type === "edu-gov" && cl("facebook.com").type === "social-link-hub", "");
  check("classify: spam words in a domain name", cl("casino-links-seo.xyz").type === "spam-suspect" && cl("buy-backlinks-now.com").type === "spam-suspect", cl("casino-links-seo.xyz").type);
  check("classify: a competitor's own other domain", cl("josephsabeh.com").type === "competitor-own-property" && cl("ramamehra.com").type === "competitor-own-property", `${cl("josephsabeh.com").type} ${cl("ramamehra.com").type}`);
  check("classify: the business's own other domain", cl("valleytovalleyrealty.net").type === "own-property", cl("valleytovalleyrealty.net").type);
  check("classify: an unknown domain stays unclassified", ["goflydragon.com", "apexleadsource.com", "nelsonmaid.com", "sangama.us", "ark7.com", "elationre.com"].every((d) => cl(d).type === "unclassified" && cl(d).ruleId === null && cl(d).confidence === null), ["goflydragon.com", "apexleadsource.com", "sangama.us"].map((d) => cl(d).type).join(","));
  check("classify: a different industry pack changes the answer", Lib.classifyDomain("avvo.com", { ...base, pack: Lib.mergedPack(rules, rules.packs.get("legal")) }).type === "platform-profile" && cl("avvo.com").type === "unclassified", "");
  check("classify: a home page title classifies by the text rules only", Lib.classifyText("Bay Area Real Estate Podcast", rules)?.type === "podcast-guest" && Lib.classifyText("Own shares of rental homes", rules) === null && Lib.classifyText("", rules) === null, "");

  // ================================================================ classify: opportunities from the link data
  const tgt = mkTarget("t1");
  const ctx1 = R.context(tgt.url, { cwd: tgt.root });
  const r1 = await C.run(ctx1, {});
  const o1 = r1.out, open = o1.opportunities, byD = Object.fromEntries(open.map((o) => [o.domain, o]));
  check("classify: link gap first", open.slice(0, 3).map((o) => o.domain).sort().join() === "expertise.com,findinmyzip.com,goflydragon.com" && open.slice(0, 3).every((o) => o.tier === "gap") && open.slice(3).every((o) => o.tier !== "gap") && byD["goflydragon.com"].rank < byD["activerain.com"].rank, open.slice(0, 5).map((o) => o.domain + ":" + o.tier).join(" "));
  const everyList = (d) => [...open, ...o1.unclassified, ...o1.notActionable, ...o1.alreadyHave].some((o) => o.domain === d);
  check("classify: sources AI engines cited instead of the business come right after the gap", (() => { const i = open.findIndex((o) => o.tier === "ai"); return i === 3 && open.filter((o) => o.tier === "ai").map((o) => o.domain).join() === "fastexpert.com" && byD["fastexpert.com"].aiAnswers === 12 && /cited by AI engines in 12/.test(byD["fastexpert.com"].evidence[0]); })() && byD["expertise.com"].tier === "gap" && byD["expertise.com"].evidence.some((e) => /AI engines in 5/.test(e)) && o1.notActionable.some((a) => a.domain === "ramamehra.com") && ["mapbox.com", "accounts.google.com"].every((d) => o1.notActionable.some((a) => a.domain === d && a.type === "not-a-source")), open.slice(0, 6).map((o) => o.domain + ":" + o.tier).join(" "));
  check("classify: AI-cited sources only count when the question belongs to the client's clusters", byD["fastexpert.com"].aiAnswers === 12 && !["kindpathhomebuyers.com", "maplehomebuyers.com", "cashbuyerdirectory.example"].some(everyList) && o1.aiFilter.rows === 21 && o1.aiFilter.kept === 12 && o1.aiFilter.dropped === 9 && o1.aiFilter.droppedQuestions.includes("we buy houses Tracy CA") && /targets\.json/.test(o1.aiFilter.mode), JSON.stringify(o1.aiFilter));
  const tOffer = mkTarget("t-offer", { targets: null });
  const oOffer = (await C.run(R.context(tOffer.url, { cwd: tOffer.root }), {})).out;
  check("classify: AI-cited sources fall back on the offer in business.json when there is no targets.json", /offer in business\.json/.test(oOffer.aiFilter.mode) && oOffer.aiFilter.kept === 12 && oOffer.aiFilter.dropped === 9 && !["kindpathhomebuyers.com", "cashbuyerdirectory.example"].some((d) => [...oOffer.opportunities, ...oOffer.unclassified, ...oOffer.notActionable].some((o) => o.domain === d)), JSON.stringify(oOffer.aiFilter));
  const tAll = mkTarget("t-all", { targets: null, bus: { ...BUS, offer: undefined, industry: undefined, kind: undefined } });
  const oAll = (await C.run(R.context(tAll.url, { cwd: tAll.root }), {})).out;
  check("classify: with nothing to judge questions by, every AI answer is kept and the output says so", /^unfiltered/.test(oAll.aiFilter.mode) && oAll.aiFilter.kept === 21 && oAll.aiFilter.dropped === 0, JSON.stringify(oAll.aiFilter));
  const pn = ["cashforhousesca.com", "maplehomebuyers.com", "webuyhouses.com", "laurelbuyshouses.com", "kindpathhomebuyers.com", "eugenebayareahomebuyers.com", "webuy510homes.com", "westencorehomes.com", "svsellingsolutions.com", "johnbuysbayareahouses.com", "housebuyercalifornia.com", "sellwithdealmate.com", "ibuyer.com", "asanterealty.com"];
  check("classify: provider businesses by name (another agent, a cash buyer, a brokerage) are provider-business", pn.every((d) => cl(d).type === "provider-business"), pn.filter((d) => cl(d).type !== "provider-business").map((d) => d + ":" + cl(d).type).join());
  check("classify: a provider-looking name never overrides a pack host, a directory or a partner", cl("realtor.com").type === "platform-profile" && cl("homes.com").type === "platform-profile" && cl("top100realestateagents.com").type === "editorial-list" && cl("findinmyzip.com").type === "directory" && cl("firstchoiceescrow.com").type === "partner-supplier" && cl("listingnearme.com").type === "directory", ["realtor.com", "top100realestateagents.com", "findinmyzip.com", "firstchoiceescrow.com"].map((d) => cl(d).type).join());
  check("classify: a provider business is set aside with its reason, even when a competitor's list holds it", !byD["laurelbuyshouses.com"] && o1.notActionable.some((a) => a.domain === "laurelbuyshouses.com" && a.type === "provider-business" && /neighbouring service/.test(a.why)) && o1.notActionable.some((a) => a.domain === "sellwithdealmate.com" && a.type === "provider-business") && o1.summary.providers >= 2, JSON.stringify(o1.summary.providers));
  check("classify: provider wording on a home page is recognised, directory wording is not", Lib.providerByText("We Buy Houses Fast - Get a Cash Offer", mp)?.type === "provider-business" && Lib.providerByText("Sell your house fast for cash", mp)?.type === "provider-business" && Lib.providerByText("Find the best real estate agents in Tracy. Compare agents and read reviews.", mp) === null && Lib.providerByText("Bay Area Real Estate Podcast", mp) === null && Lib.providerByText("", mp) === null, "");
  const iEsc = open.findIndex((o) => o.domain === "firstchoiceescrow.com");
  check("classify: a partner type named by the pack ranks low", byD["firstchoiceescrow.com"]?.tier === "partner" && byD["firstchoiceescrow.com"].type === "partner-supplier" && iEsc > open.map((o) => o.tier).lastIndexOf("serp") && iEsc < open.map((o) => o.tier).indexOf("baseline"), open.map((o) => o.domain + ":" + o.tier).slice(-14).join(" "));
  check("classify: only kinds of site that link out are opportunities (an unclassified site needs a competitor link)", o1.unclassified.some((o) => o.domain === "mystery-list.example") && !byD["mystery-list.example"] && byD["goflydragon.com"]?.type === "unclassified" && open.every((o) => (rules.tax.types[o.type].actionable && o.type !== "unclassified") || (o.type === "unclassified" && o.linksToCompetitors >= 1)) && /not opportunities until classified|until classified/.test(fs.readFileSync(path.join(tgt.pewp, "authority", "opportunities.md"), "utf8")), JSON.stringify(o1.unclassified.map((o) => o.domain)));
  check("classify: inside a group the order is value x ease, then competitors", open.slice(0, 3).map((o) => o.domain).join() === "findinmyzip.com,expertise.com,goflydragon.com" && (() => { const t = open.filter((o) => o.tier === "competitor"); return t.every((o, i) => i === 0 || t[i - 1].score >= o.score); })(), open.slice(0, 3).map((o) => o.domain + ":" + o.score).join(" "));
  check("classify: a site that already links to the business is not an opportunity", !byD["linktr.ee"] && o1.alreadyHave.some((a) => a.domain === "linktr.ee" && /already links/.test(a.reason)), "");
  check("classify: a directory the business is already listed on", !byD["zillow.com"] && o1.alreadyHave.some((a) => a.domain === "zillow.com" && /already listed/.test(a.reason)) && byD["yelp.com"]?.tier === "serp", "");
  check("classify: a competitor's own site and spam are shown as not actionable, not ranked", !byD["josephsabeh.com"] && !byD["casino-links-seo.xyz"] && o1.notActionable.some((a) => a.domain === "josephsabeh.com") && o1.notActionable.some((a) => a.domain === "casino-links-seo.xyz"), o1.notActionable.map((a) => a.domain).join());
  check("classify: another brokerage's roster is not an opportunity unless it is the client's brokerage", !byD["compass.com"] && o1.notActionable.some((a) => a.domain === "compass.com" && /another brokerage/.test(a.reason)), "");
  const t2 = mkTarget("t2", { bus: { ...BUS, credentials: { brokerage: "Compass" } } });
  const o2 = (await C.run(R.context(t2.url, { cwd: t2.root }), {})).out;
  check("classify: the client's own brokerage roster is an opportunity", o2.opportunities.some((o) => o.domain === "compass.com" && o.type === "parent-roster"), "");
  check("classify: the pack's usual places are listed last, marked recalled and unverified", open.filter((o) => o.tier === "baseline").length >= 4 && open.at(-1).tier === "baseline" && byD["nar.realtor"] && /UNVERIFIED/.test(byD["nar.realtor"].evidence[0]), open.at(-1)?.tier);
  check("classify: a cut-off competitor list is said", o1.notes.some((n) => /joeschembri\.com: 12 linking domains/.test(n)) && o1.notes.some((n) => /notinthegraph\.com is not in the Common Crawl release/.test(n)), JSON.stringify(o1.notes));
  check("classify: every opportunity carries its source and what it gives", open.every((o) => o.evidence.length && o.sources.length && o.cost && o.risk && o.gives), "");
  check("classify: the types competitors have and the business lacks are named", o1.summary.typesCompetitorsHaveAndWeLack.includes("editorial-list") && o1.summary.typesCompetitorsHaveAndWeLack.includes("chamber-local") && !o1.summary.typesCompetitorsHaveAndWeLack.includes("social-link-hub"), o1.summary.typesCompetitorsHaveAndWeLack.join());
  const md = fs.readFileSync(path.join(tgt.pewp, "authority", "opportunities.md"), "utf8");
  check("classify: opportunities.md says how to read it and what is unclassified", /link gap/i.test(md) && /Unclassified/.test(md) && /goflydragon\.com/.test(md) && /not as absolute numbers/.test(md) && !/harmonic/i.test(md), "");
  check("classify: no request without --fetch", LOG.length === 0 && guardLog.length === 0, `server ${LOG.length} guard ${guardLog.length}`);
  const tNo = mkTarget("t-noauth", { auth: null });
  const blocked = await cli("authority-classify.mjs", [tNo.url, "--cwd", tNo.root]);
  check("classify: no authority.json is BLOCKED (exit 3) with the step that unblocks it", blocked.code === 3 && /BLOCKED: .*authority\.mjs/.test(blocked.out), blocked.out + blocked.err);
  const usage = await cli("authority-classify.mjs", []);
  check("classify: no target is a usage error (exit 2)", usage.code === 2, `${usage.code}`);
  // politeness numbers: "--gap-ms abc" used to be NaN (a ~1 ms gap) and "--max-requests abc" no cap at all; a gap under 1000 ms to
  // the sites we vet is refused too. Each is exit 2 before any request (the server log and the network guard stay empty).
  const before = LOG.length + guardLog.length, polite = [];
  for (const [s, extra] of [["authority-classify.mjs", ["--fetch", "--gap-ms", "abc"]], ["authority-classify.mjs", ["--fetch", "--gap-ms", "10"]], ["authority-classify.mjs", ["--fetch", "--max-fetch", "x"]],
    ["authority-vet.mjs", ["--gap-ms", "abc"]], ["authority-vet.mjs", ["--gap-ms", "999"]], ["authority-vet.mjs", ["--max-requests", "abc"]], ["authority-vet.mjs", ["--limit", "0"]]]) {
    const r = await cli(s, [tNo.url, "--cwd", tNo.root, ...extra]);
    if (r.code !== 2 || !/usage: --/.test(r.err)) polite.push(`${s} ${extra.join(" ")} -> exit ${r.code} ${(r.out + r.err).slice(0, 120)}`);
  }
  check("classify/vet: a numeric option that is not a number, or a --gap-ms under 1000, is a usage error (exit 2) with no request", !polite.length && LOG.length + guardLog.length === before, polite.join(" | "));

  // ================================================================ classify --fetch (read-only, polite)
  const t3 = mkTarget("t3");
  const r3 = await C.run(R.context(t3.url, { cwd: t3.root }), { fetch: true, maxFetch: 6, origins, gapMs: 0 });
  const f3 = Object.fromEntries(r3.out.opportunities.map((o) => [o.domain, o]));
  check("classify --fetch: a home page title classifies", f3["goflydragon.com"]?.type === "podcast-guest" && f3["goflydragon.com"].classifiedFrom.includes("title") && f3["goflydragon.com"].fetched.title === "Bay Area Real Estate Podcast", JSON.stringify(f3["goflydragon.com"]?.type));
  check("classify --fetch: a provider business is recognised from its home page and set aside", r3.out.notActionable.some((a) => a.domain === "zzunknownlist.com" && a.type === "provider-business" && /home page/.test(a.classifiedFrom)) && !f3["zzunknownlist.com"], JSON.stringify(r3.out.notActionable.map((a) => a.domain + ":" + a.type)));
  check("classify --fetch: what no rule decides stays unclassified (nothing invented)", f3["ark7.com"]?.type === "unclassified" && f3["ark7.com"].fetched.title === "Own shares of rental homes", JSON.stringify(f3["ark7.com"]?.type));
  check("classify --fetch: robots.txt is read first and obeyed", countFor("apexleadsource.com", "/robots.txt") === 1 && countFor("apexleadsource.com", "/") === 0 && f3["apexleadsource.com"]?.type === "unclassified", `${countFor("apexleadsource.com", "/robots.txt")} ${countFor("apexleadsource.com", "/")}`);
  check("classify --fetch: a 429 stops that site and is not retried", countFor("nelsonmaid.com", "/") === 1 && r3.out.fetch.stoppedHosts.some((h) => h.host === "nelsonmaid.com" && h.status === 429), `${countFor("nelsonmaid.com", "/")}`);
  check("classify --fetch: only GET, honest user agent, only unclassified sites, at most --max-fetch", LOG.every((l) => l.method === "GET" && /^PEWP-Authority\/1\.0/.test(l.ua)) && !LOG.some((l) => ["expertise.com", "activerain.com"].includes(l.dom)) && new Set(LOG.map((l) => l.dom)).size <= 6 && guardLog.length === 0, JSON.stringify([...new Set(LOG.map((l) => l.dom))]) + guardLog.join());
  const logBefore = LOG.length;
  await C.run(R.context(t3.url, { cwd: t3.root }), { fetch: true, maxFetch: 6, origins, gapMs: 0 });
  check("classify --fetch: a second run re-uses the cache for what answered 200", LOG.filter((l, i) => i >= logBefore && ["goflydragon.com", "ark7.com"].includes(l.dom) && l.path === "/").length === 0, JSON.stringify(LOG.slice(logBefore).map((l) => l.dom + l.path)));
  let origErr = ""; try { Lib.createClient({ pewp: tmp, originMap: new Map([["x.example", "https://evil.example/"]]) }); } catch (e) { origErr = e.message; }
  check("vet: --origin refuses a non-local address", /only point at a local address/.test(origErr), origErr);

  // ================================================================ vet
  const T = {
    "good-dir.example": "directory", "link-farm.example": "directory", "noindex.example": "directory", "xrobots.example": "directory", "robots-closed.example": "directory", "robots-ua.example": "directory",
    "rate-limited.example": "directory", "forbidden.example": "directory", "nofollow-dir.example": "editorial-list", "profile-site.example": "platform-profile", "editorial.example": "local-news", "paid.example": "directory",
    "thin.example": "directory", "parked.example": "directory", "redirect.example": "directory", "moved.example": "directory", "dead.example": "directory", "excluded-listing.example": "directory", "trap.example": "directory", "cash-buyer.example": "unclassified", "unknown-kind.example": "unclassified", "directory-says-we-buy.example": "directory",
  };
  const tv = mkTarget("tv");
  w(path.join(tv.pewp, "authority", "opportunities.json"), { target: "valleytovalleyrealty.com", opportunities: Object.entries(T).map(([domain, type], i) => ({ domain, type, typeLabel: rules.tax.types[type].label, evidence: [`links to a competitor`], rank: i + 1 })), alreadyHave: [], notActionable: [] });
  const ctxv = R.context(tv.url, { cwd: tv.root });
  LOG.length = 0;
  const rv = await V.run(ctxv, { limit: 30, origins, gapMs: 0, exclude: ["^/claim-listing"], timeoutS: 5 });
  const vr = Object.fromEntries(rv.doc.results.map((r) => [r.domain, r]));
  const codes = (d) => (vr[d]?.reasons || []).map((r) => r.code);
  check("vet: a free directory is PURSUE with its listing page found and read", vr["good-dir.example"]?.verdict === "PURSUE" && vr["good-dir.example"].listing.model === "free" && /\/add-your-business$/.test(vr["good-dir.example"].listing.submitUrl) && vr["good-dir.example"].pages.length === 2 && vr["good-dir.example"].indexable.homepage === true, JSON.stringify(vr["good-dir.example"]?.verdict + " " + codes("good-dir.example") + " " + vr["good-dir.example"]?.listing?.submitUrl));
  check("vet: the listing page is found (free, editorial and membership wording)", /\/get-listed$/.test(vr["nofollow-dir.example"].listing.submitUrl) && /\/write-for-us$/.test(vr["editorial.example"].listing.submitUrl) && /\/claim$/.test(vr["profile-site.example"].listing.submitUrl), [vr["nofollow-dir.example"].listing.submitUrl, vr["editorial.example"].listing.submitUrl].join());
  check("vet: followed links are seen as followed", vr["good-dir.example"].outbound.label === "followed" && vr["good-dir.example"].outbound.followed >= 5, JSON.stringify(vr["good-dir.example"].outbound));
  check("vet: nofollow links are seen", vr["nofollow-dir.example"].outbound.label === "nofollow" && vr["profile-site.example"].outbound.label === "nofollow", JSON.stringify(vr["nofollow-dir.example"].outbound));
  check("vet: nofollow-only links make a doubtful kind CHECK BY HAND", vr["nofollow-dir.example"].verdict === "CHECK BY HAND" && codes("nofollow-dir.example").includes("NOFOLLOW_ONLY"), vr["nofollow-dir.example"].verdict + codes("nofollow-dir.example"));
  check("vet: nofollow is normal for a platform profile (PURSUE, said plainly)", vr["profile-site.example"].verdict === "PURSUE" && codes("profile-site.example").includes("NOFOLLOW_OK"), vr["profile-site.example"].verdict + codes("profile-site.example"));
  check("vet: an editorial site is PURSUE as a pitch", vr["editorial.example"].verdict === "PURSUE" && vr["editorial.example"].listing.model === "editorial", vr["editorial.example"].verdict + vr["editorial.example"].listing.model);
  check("vet: a site that sells links is AVOID", vr["link-farm.example"].verdict === "AVOID" && codes("link-farm.example").includes("SELLS_LINKS"), vr["link-farm.example"].verdict + codes("link-farm.example"));
  check("vet: a link farm (many outbound domains) is flagged", codes("link-farm.example").includes("LINK_HEAVY") && vr["link-farm.example"].outbound.distinctDomains >= 80, JSON.stringify(vr["link-farm.example"].outbound.distinctDomains));
  check("vet: noindex in the page is AVOID", vr["noindex.example"].verdict === "AVOID" && codes("noindex.example").includes("NOT_INDEXABLE") && vr["noindex.example"].indexable.homepage === false, vr["noindex.example"].verdict);
  check("vet: noindex in the X-Robots-Tag header is AVOID", vr["xrobots.example"].verdict === "AVOID" && /X-Robots-Tag/.test(vr["xrobots.example"].indexable.evidence), vr["xrobots.example"].verdict + JSON.stringify(vr["xrobots.example"].indexable));
  check("vet: a paid listing is CHECK BY HAND", vr["paid.example"].verdict === "CHECK BY HAND" && vr["paid.example"].listing.model === "paid" && codes("paid.example").includes("PAID_LISTING"), vr["paid.example"].verdict + vr["paid.example"].listing.model);
  check("vet: a thin site is CHECK BY HAND", vr["thin.example"].verdict === "CHECK BY HAND" && codes("thin.example").includes("THIN"), vr["thin.example"].verdict + codes("thin.example"));
  check("vet: a parked domain is AVOID", vr["parked.example"].verdict === "AVOID" && codes("parked.example").includes("PARKED"), vr["parked.example"].verdict + codes("parked.example"));
  check("vet: a redirect inside the site is followed", vr["redirect.example"].verdict === "PURSUE" && /\/new$/.test(vr["redirect.example"].site.finalUrl), vr["redirect.example"].verdict + vr["redirect.example"].site?.finalUrl);
  check("vet: an address that redirects to another site is CHECK BY HAND", vr["moved.example"].verdict === "CHECK BY HAND" && codes("moved.example").includes("REDIRECTS_ELSEWHERE") && vr["moved.example"].site.redirectedTo === "other-site.example", vr["moved.example"].verdict + codes("moved.example"));
  check("vet: a provider business of an unclassified kind is NOT AN OPPORTUNITY", vr["cash-buyer.example"]?.verdict === "NOT AN OPPORTUNITY" && codes("cash-buyer.example").includes("PROVIDER_BUSINESS") && rv.doc.summary["NOT AN OPPORTUNITY"] === 1, JSON.stringify(vr["cash-buyer.example"]?.verdict + codes("cash-buyer.example")));
  check("vet: provider wording on a site already classified as a directory does not make it a provider", vr["directory-says-we-buy.example"]?.verdict !== "NOT AN OPPORTUNITY", vr["directory-says-we-buy.example"]?.verdict);
  check("vet: a site of an unknown kind is never PURSUE (CHECK BY HAND, KIND_UNKNOWN)", vr["unknown-kind.example"]?.verdict === "CHECK BY HAND" && codes("unknown-kind.example").includes("KIND_UNKNOWN") && vr["unknown-kind.example"].listing.model === "free", JSON.stringify(vr["unknown-kind.example"]?.verdict + codes("unknown-kind.example")));
  check("vet: a dead site is CHECK BY HAND", vr["dead.example"].verdict === "CHECK BY HAND" && codes("dead.example").includes("SITE_ERROR"), codes("dead.example").join());
  check("vet: robots.txt disallow is obeyed (only robots.txt requested)", vr["robots-closed.example"].verdict === "CHECK BY HAND" && codes("robots-closed.example").includes("ROBOTS_DISALLOW") && countFor("robots-closed.example") === 1 && countFor("robots-closed.example", "/") === 0, `${countFor("robots-closed.example")} requests`);
  check("vet: robots.txt group for our own user agent is obeyed", codes("robots-ua.example").includes("ROBOTS_DISALLOW") && countFor("robots-ua.example", "/") === 0, codes("robots-ua.example").join());
  check("vet: a 429 stops that site (one request, no retry)", codes("rate-limited.example").includes("HOST_REFUSED") && countFor("rate-limited.example", "/") === 1, `${countFor("rate-limited.example", "/")}`);
  check("vet: a 403 stops that site (one request, no retry)", codes("forbidden.example").includes("HOST_REFUSED") && countFor("forbidden.example", "/") === 1, `${countFor("forbidden.example", "/")}`);
  check("vet: a 429 on one site does not stop the others", rv.doc.summary.PURSUE >= 4 && rv.doc.requests.stoppedHosts.length === 2, JSON.stringify(rv.doc.requests.stoppedHosts));
  check("vet: --exclude covers the listing page", countFor("excluded-listing.example", "/claim-listing") === 0 && vr["excluded-listing.example"].listing.candidates.some((c) => /claim-listing/.test(c.url)) && vr["excluded-listing.example"].listing.pageRead === null, `${countFor("excluded-listing.example", "/claim-listing")}`);
  check("vet: a register or login path is never visited", countFor("trap.example", "/register") === 0 && countFor("trap.example", "/login") === 0 && countFor("trap.example", "/checkout") === 0 && countFor("trap.example", "/submit") === 1, JSON.stringify(LOG.filter((l) => l.dom === "trap.example").map((l) => l.path)));
  check("vet: GET only, honest user agent on every request", LOG.length > 20 && LOG.every((l) => l.method === "GET" && /^PEWP-Authority\/1\.0/.test(l.ua) && !/Mozilla|Chrome/.test(l.ua)), JSON.stringify([...new Set(LOG.map((l) => l.ua))]));
  check("vet: every visited site records what it is (title, description)", vr["good-dir.example"].site.title === "Local Agents Directory" && vr["good-dir.example"].site.description === "Find local agents", JSON.stringify(vr["good-dir.example"].site));
  check("vet: no non-local request left the test", guardLog.length === 0, guardLog.join());
  const vet = J(path.join(tv.pewp, "authority", "vetting.json"));
  check("vet: vetting.json carries the options, user agent and request counts", vet.ua.startsWith("PEWP-Authority/1.0") && vet.options.getOnly === true && vet.options.exclude[0] === "^/claim-listing" && vet.requests.network > 20, JSON.stringify(vet.requests));
  const how = fs.readFileSync(path.join(tv.pewp, "authority", "howto.md"), "utf8");
  check("vet: howto.md is plain words with the steps, the address and the business details", /## Pursue/.test(how) && /## Avoid/.test(how) && how.includes("/add-your-business") && how.includes("(209) 555-0100") && how.includes("1 Main St, Tracy, CA 95376") && /never pay for a link unless the page marks it as sponsored/.test(how) && !/harmonic|PageRank|Poisson/i.test(how), how.slice(0, 300));
  check("vet: howto.md sets providers aside with no steps", /## Not an opportunity/.test(how) && /- cash-buyer\.example: /.test(how) && !/### cash-buyer\.example/.test(how), how.split("## Not an opportunity")[1]?.slice(0, 200));
  check("vet: howto.md lists avoided sites with the reason and no steps", /### good-dir\.example/.test(how) && !/### link-farm\.example/.test(how) && /- link-farm\.example: .*buying links|- link-farm\.example: .*selling or buying links/.test(how), how.split("## Avoid")[1]?.slice(0, 300));

  // reuse and cache
  const n0 = LOG.length;
  const rv2 = await V.run(ctxv, { limit: 30, origins, gapMs: 0, exclude: ["^/claim-listing"], timeoutS: 5 });
  check("vet: a site vetted recently is reused, not visited again", LOG.length === n0 && rv2.doc.summary.reusedWithoutVisit.length === Object.keys(T).length - 0, `${LOG.length - n0} new requests; reused ${rv2.doc.summary.reusedWithoutVisit.length}`);
  const n1 = LOG.length;
  await V.run(ctxv, { limit: 30, origins, gapMs: 0, exclude: ["^/claim-listing"], timeoutS: 5, refresh: true });
  check("vet: --refresh still answers 200 pages from the cache (no new request for good-dir)", LOG.slice(n1).filter((l) => l.dom === "good-dir.example").length === 0, JSON.stringify(LOG.slice(n1).filter((l) => l.dom === "good-dir.example")));

  check("vet: --refresh does not visit a site that refused us (403/429) again", countFor("rate-limited.example", "/") === 1 && countFor("forbidden.example", "/") === 1, `${countFor("rate-limited.example", "/")} ${countFor("forbidden.example", "/")}`);
  const rOne = await V.run(ctxv, { domains: ["good-dir.example"], origins, gapMs: 0, timeoutS: 5 });
  check("vet: vetting.json holds only the sites of this run", rOne.doc.results.length === 1 && rOne.doc.results[0].domain === "good-dir.example" && !/thin\.example/.test(fs.readFileSync(path.join(tv.pewp, "authority", "howto.md"), "utf8")), JSON.stringify(rOne.doc.results.map((r) => r.domain)));
  check("vet: a bare 'pricing' (home pricing, price list) is not paid-listing wording", Lib.listingModel("Home pricing guide and pricing trends in Tracy").model === "unknown" && Lib.listingModel("Pricing and plans: premium listing $49 per month").model === "paid", JSON.stringify(Lib.listingModel("Home pricing guide")));

  // time limits
  const tt = mkTarget("tt");
  const ctxt = R.context(tt.url, { cwd: tt.root });
  LOG.length = 0;
  const rt = await V.run(ctxt, { domains: ["slow.example"], origins, gapMs: 0, timeoutS: 0.3 });
  check("vet: a request has a time limit", rt.doc.results[0].verdict === "CHECK BY HAND" && (rt.doc.results[0].reasons[0].code === "UNREACHABLE" && /timeout/.test(rt.doc.results[0].reasons[0].text)), JSON.stringify(rt.doc.results[0].reasons));
  LOG.length = 0;
  const rd = await V.run(R.context(mkTarget("td").url, { cwd: path.join(tmp, "td") }), { domains: ["good-dir.example", "thin.example"], origins, gapMs: 0, maxMinutes: -1 });
  check("vet: the run deadline stops the run (nothing fetched, sites listed as not visited)", LOG.length === 0 && rd.stopped && rd.doc.results.every((r) => r.verdict === null && r.notVisited) && rd.doc.summary.notVisited === 2, `${LOG.length} ${rd.stopped}`);
  LOG.length = 0;
  const rb = await V.run(R.context(mkTarget("tb").url, { cwd: path.join(tmp, "tb") }), { domains: ["good-dir.example", "editorial.example", "thin.example"], origins, gapMs: 0, maxRequests: 2 });
  check("vet: the request budget stops the run", LOG.length <= 2 && rb.stopped && /budget/.test(rb.stopped) && rb.doc.results.some((r) => r.notVisited), `${LOG.length} ${rb.stopped}`);
  const rtc = await cli("authority-vet.mjs", ["https://valleytovalleyrealty.com/", "--cwd", tt.root, "--domain", "good-dir.example", ...originArgs, "--max-minutes", "-1"]);
  check("vet: the CLI exits 4 when a cap stops the run", rtc.code === 4 && /STOPPED/.test(rtc.out), `${rtc.code} ${rtc.out}`);
  const rbl = await cli("authority-vet.mjs", ["https://valleytovalleyrealty.com/", "--cwd", path.join(tmp, "nothing")]);
  check("vet: no opportunities and no --domain is BLOCKED (exit 3)", rbl.code === 3 && /BLOCKED/.test(rbl.out), `${rbl.code} ${rbl.out}`);
  const rmg = await cli("authority-vet.mjs", ["https://valleytovalleyrealty.com/", "--cwd", tt.root, "--domain", "x.example", "--exclude", "C:/Program Files/Git/x"]);
  check("vet: a path the shell rewrote is refused before any request", rmg.code === 1 && /REFUSED/.test(rmg.err), `${rmg.code} ${rmg.err.slice(0, 200)}`);
  const rrx = await cli("authority-vet.mjs", ["https://valleytovalleyrealty.com/", "--cwd", tt.root, "--domain", "x.example", "--exclude", "(unclosed"]);
  check("vet: an --exclude that is not a valid regular expression is a usage error (exit 2) before any request, not a crash", rrx.code === 2 && /not a valid regular expression/.test(rrx.err) && !/at .*\.mjs:\d+/.test(rrx.err), `${rrx.code} ${rrx.err.slice(0, 300)}`);
  const strayPct = (() => { try { return Lib.listingCandidates([{ href: "https://x.example/50%-off/add-your-business", text: "Add your business", rel: [] }], "https://x.example/"); } catch (e) { return e.message; } })();
  check("vet: a link with a stray % in its path is read as a listing candidate, not a crash of the whole run", Array.isArray(strayPct) && strayPct.length === 1 && strayPct[0].kind === "free-listing", JSON.stringify(strayPct));

  // ================================================================ outreach
  const doc = O.emptyOutreach("valleytovalleyrealty.com");
  const TODAY = "2026-10-22";
  const bad = (fn) => { try { fn(); return null; } catch (e) { return e instanceof O.Invalid ? e.message : "other: " + e.message; } };
  O.addEntry(doc, { domain: "https://www.Expertise.com/x", type: "editorial-list", owner: "Dave" }, TODAY);
  check("outreach: add normalises the domain and starts as planned", doc.entries[0].domain === "expertise.com" && doc.entries[0].status === "planned" && doc.entries[0].history.length === 1, JSON.stringify(doc.entries[0]));
  check("outreach: a site appears once", /already in the tracker/.test(bad(() => O.addEntry(doc, { domain: "expertise.com" }, TODAY))) && doc.entries.length === 1, "");
  const noOwnerAdd = bad(() => O.addEntry(O.emptyOutreach("x"), { domain: "msjchamber.org", status: "asked", date: TODAY }, TODAY));
  O.addEntry(doc, { domain: "msjchamber.org" }, TODAY);
  const noOwnerSet = bad(() => O.setStatus(doc, { domain: "msjchamber.org", status: "asked" }, TODAY));
  check("outreach: an owner is needed before asking", /owner is needed/.test(noOwnerAdd || "no error") && /give msjchamber.org an owner/.test(noOwnerSet || "no error") && doc.entries[1].status === "planned", noOwnerAdd + " | " + noOwnerSet);
  O.setStatus(doc, { domain: "msjchamber.org", status: "asked", date: "2026-09-20", owner: "Abdo" }, TODAY);
  check("outreach: set records the status, date and history", doc.entries[1].status === "asked" && doc.entries[1].date === "2026-09-20" && doc.entries[1].history.length === 2, JSON.stringify(doc.entries[1]));
  check("outreach: listed needs an evidence URL", /cannot be "listed" without --evidence/.test(bad(() => O.setStatus(doc, { domain: "msjchamber.org", status: "listed", date: TODAY }, TODAY)) || "no error") && doc.entries[1].status === "asked", "");
  check("outreach: the evidence must be on that site", /not on msjchamber\.org/.test(bad(() => O.setStatus(doc, { domain: "msjchamber.org", status: "listed", evidence: "https://other.example/members" }, TODAY)) || "no error") && /not a web address/.test(bad(() => O.setStatus(doc, { domain: "msjchamber.org", status: "listed", evidence: "see email" }, TODAY)) || "no error"), "");
  O.setStatus(doc, { domain: "msjchamber.org", status: "listed", evidence: "https://www.msjchamber.org/members/valley", date: TODAY }, TODAY);
  check("outreach: listed with proof on the site is accepted", doc.entries[1].status === "listed" && doc.entries[1].evidenceUrl === "https://www.msjchamber.org/members/valley", "");
  check("outreach: only the four statuses are accepted", /must be one of/.test(bad(() => O.setStatus(doc, { domain: "expertise.com", status: "done" }, TODAY)) || "no error"), "");
  check("outreach: dates are real and not in the future", /future/.test(bad(() => O.setStatus(doc, { domain: "expertise.com", status: "planned", date: "2026-12-01" }, TODAY)) || "no error") && /not a real day/.test(bad(() => O.checkDate("2026-02-30", TODAY)) || "no error") && /YYYY-MM-DD/.test(bad(() => O.checkDate("22/10/2026", TODAY)) || "no error"), "");
  check("outreach: an unknown site cannot be set", /not in the tracker/.test(bad(() => O.setStatus(doc, { domain: "nothere.com", status: "asked" }, TODAY)) || "no error"), "");
  O.addEntry(doc, { domain: "giftofvision.org", owner: "Dave", status: "asked", date: "2026-10-20" }, TODAY);
  O.addEntry(doc, { domain: "sanjoseinsider.org", owner: "Dave" }, TODAY);
  O.setStatus(doc, { domain: "sanjoseinsider.org", status: "refused", note: "no free guest posts" }, TODAY);
  const fu = O.followUps(doc, TODAY);
  check("outreach: follow-ups are asked 21+ days ago with no answer", fu.length === 0, JSON.stringify(fu));
  O.addEntry(doc, { domain: "activerain.com", owner: "Abdo", status: "asked", date: "2026-09-25" }, TODAY);
  const fu2 = O.followUps(doc, TODAY);
  check("outreach: follow-ups are asked 21+ days ago with no answer (an old ask is listed)", fu2.length === 1 && fu2[0].domain === "activerain.com" && fu2[0].daysWaiting === 27, JSON.stringify(fu2));
  const ex = O.explainReferringDomains(doc, ["msjchamber.org", "giftofvision.org", "expertise.com", "randomblog.com"], ["msjchamber.org", "sanjoseinsider.org"]);
  check("outreach: explain separates gains we earned (with proof) from asked, planned and unknown", ex.gained[0].explained === "outreach-listed" && /proof: https:\/\/www\.msjchamber\.org/.test(ex.gained[0].text) && ex.gained[1].explained === "asked-not-confirmed" && ex.gained[2].explained === "planned-only" && ex.gained[3].explained === "no" && ex.gainedExplainedByOutreach === 1, JSON.stringify(ex.gained.map((g) => g.explained)));
  check("outreach: explain names a lost listing we earned", ex.lost[0].explained === "lost-our-listing" && ex.lost[1].explained === "no" && ex.lostOurListings === 1, JSON.stringify(ex.lost.map((g) => g.explained)));
  const vetFix = { generatedAt: "2026-10-22T00:00:00Z", results: [{ domain: "good-dir.example", verdict: "PURSUE", type: "directory", listing: { submitUrl: "https://good-dir.example/add" }, reasons: [{ text: "looks free" }] }, { domain: "link-farm.example", verdict: "AVOID", type: "directory", reasons: [{ text: "sells links" }] }, { domain: "paid.example", verdict: "CHECK BY HAND", type: "directory", reasons: [{ text: "paid" }] }] };
  const d2 = O.emptyOutreach("x"); const n = O.seedFromVetting(d2, vetFix, { owner: "Dave" }, TODAY);
  check("outreach: seed adds only the vetted PURSUE sites, as planned", n === 1 && d2.entries.length === 1 && d2.entries[0].domain === "good-dir.example" && d2.entries[0].status === "planned" && d2.entries[0].listingUrl === "https://good-dir.example/add" && O.seedFromVetting(d2, vetFix, { owner: "Dave" }, TODAY) === 0, JSON.stringify(d2.entries));
  // the CLI end to end
  const tc = mkTarget("tcli", { auth: null, cit: null });
  const run = (a) => cli("authority-outreach.mjs", [tc.url, "--cwd", tc.root, ...a]);
  const a1 = await run(["add", "--domain", "msjchamber.org", "--owner", "Abdo", "--type", "chamber-local"]);
  const a2 = await run(["set", "--domain", "msjchamber.org", "--status", "listed", "--date", "2026-10-21"]);
  const a3 = await run(["set", "--domain", "msjchamber.org", "--status", "listed", "--date", "2026-10-21", "--evidence", "https://msjchamber.org/members/valley"]);
  const a4 = await run(["explain", "--gained", "msjchamber.org,zzz.com"]);
  const a5 = await run(["list"]);
  const a6 = await run(["frobnicate"]);
  const file = J(O.outreachFile(path.join(tc.root, "site-checks", "valleytovalleyrealty.com", ".pewp")));
  check("outreach: the CLI adds, refuses a listing without proof (exit 2), then accepts it", a1.code === 0 && a2.code === 2 && /REFUSED/.test(a2.err) && a3.code === 0 && file.entries[0].status === "listed", `${a1.code} ${a2.code} ${a3.code} ${a2.err}`);
  check("outreach: the CLI explains, lists and rejects an unknown command", /outreach-listed/.test(a4.out) && /msjchamber\.org/.test(a5.out) && a6.code === 2, `${a4.code} ${a6.code}`);
  check("outreach: the file measure reads is <pewp>/authority/outreach.json (readOutreach)", O.readOutreach(path.join(tc.root, "site-checks", "valleytovalleyrealty.com", ".pewp"))?.entries?.length === 1 && file.version === 1, "");

  // ================================================================ authority.mjs: the Common Crawl graph reader (a local server only)
  {
    const A = await imp("authority.mjs");
    const gz = zlib.gzipSync(Buffer.from("1\tcom.example\t3\n2\tcom.other\t1\n"));
    const cc = http.createServer((req, res) => {
      if (req.url === "/stall.gz") { res.writeHead(200, { "content-type": "application/gzip" }); res.write(gz.subarray(0, 8)); return; } // 8 bytes, then silence
      if (req.url === "/reset.gz") { res.writeHead(200, { "content-type": "application/gzip" }); res.write(gz.subarray(0, 8)); setTimeout(() => req.socket.destroy(), 100); return; }
      if (req.url === "/ok.gz") { res.writeHead(200, { "content-type": "application/gzip" }); res.end(gz); return; }
      if (req.url === "/truncated.gz") { res.writeHead(200, { "content-type": "application/gzip" }); res.end(gz.subarray(0, gz.length - 12)); return; } // a whole answer, a cut gzip
      res.writeHead(404); res.end();
    });
    await new Promise((ok) => cc.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${cc.address().port}`, cacheD = path.join(tmp, "cc-cache");
    const within = (p, ms) => Promise.race([p.then(() => "resolved", (e) => e.message), new Promise((r) => setTimeout(() => r("HUNG"), ms))]);
    let t0 = Date.now();
    const st = await within(A.eachLine(`${base}/stall.gz`, cacheD, "stall", () => {}, { stallMs: 600 }), 8000);
    check("authority.mjs: a download that stalls is stopped by the stall watchdog with a named error (not a hang, not a 3 h wait)", /stall: the download of .* stalled \(no data for 0\.6 s\)/.test(st) && Date.now() - t0 < 6000 && fs.existsSync(path.join(cacheD, "stall.gz.part")), `${st} after ${Date.now() - t0} ms`);
    const rs = await within(A.eachLine(`${base}/reset.gz`, cacheD, "reset", () => {}, { stallMs: 60000 }), 8000);
    check("authority.mjs: a connection cut mid-download reaches the reader as an error (src.pipe() dropped it and the read hung)", /^reset: reading .* failed/.test(rs) && fs.existsSync(path.join(cacheD, "reset.gz.part")), rs);
    const tr = await within(A.eachLine(`${base}/truncated.gz`, cacheD, "trunc", () => {}, { stallMs: 5000 }), 8000);
    check("authority.mjs: a download that arrives whole but truncated is an error and never trusted as a cache file (.part marker kept)", /^trunc: reading .* failed/.test(tr) && fs.existsSync(path.join(cacheD, "truncated.gz.part")), `${tr} part=${fs.existsSync(path.join(cacheD, "truncated.gz.part"))}`);
    const got = []; t0 = Date.now();
    const okr = await within(A.eachLine(`${base}/ok.gz`, cacheD, "ok", (s, a, b) => got.push(s.slice(a, b)), { stallMs: 5000 }), 8000);
    const again = []; await within(A.eachLine(`${base}/ok.gz`, cacheD, "ok", (s, a, b) => again.push(s.slice(a, b)), { stallMs: 5000 }), 8000);
    check("authority.mjs: a complete download is read line by line, cached without a .part marker, and re-read from the cache", okr === "resolved" && got.length === 2 && got[1] === "2\tcom.other\t1" && fs.existsSync(path.join(cacheD, "ok.gz")) && !fs.existsSync(path.join(cacheD, "ok.gz.part")) && again.join("|") === got.join("|"), `${okr} ${JSON.stringify(got)} ${JSON.stringify(again)}`);
    cc.close();
    // the main-module check: through a junction the CLI runs (no arguments: usage, exit 2); imported by another *authority.mjs it does not
    const jx = path.join(tmp, "jx-scripts"); fs.symlinkSync(dir, jx, "junction");
    const ju = await spawnP(process.execPath, [path.join(jx, "authority.mjs")], { cwd: tmp });
    check("authority.mjs: started through a junction it still runs its CLI (no arguments: usage, exit 2), not a silent exit 0", ju.code === 2 && /usage: node authority\.mjs/.test(ju.err), `exit ${ju.code} ${ju.err.slice(0, 200)}`);
    fs.rmSync(jx, { recursive: true, force: true }); // the link only
    const side = w(path.join(tmp, "my-authority.mjs"), `await import(${JSON.stringify(pathToFileURL(path.join(dir, "authority.mjs")).href)});\nconsole.log("imported ok");\n`);
    const im = await spawnP(process.execPath, [side], { cwd: tmp });
    check("authority.mjs: importing it from another script whose name ends in authority.mjs does not run its CLI (the old endsWith check did)", im.code === 0 && /imported ok/.test(im.out) && !/usage/.test(im.err), `exit ${im.code} ${im.out.slice(0, 100)} ${im.err.slice(0, 200)}`);
  }

  // ================================================================ the playbook and hygiene
  const stage = path.join(skill, "stages", "authority.md");
  const st = fs.existsSync(stage) ? fs.readFileSync(stage, "utf8") : "";
  const tokens = Math.round(st.length / 4);
  check("doc: stages/authority.md exists and is 4,000 to 8,000 tokens", st.length > 0 && tokens >= 4000 && tokens <= 8000, `~${tokens} tokens (chars/4)`);
  const topics = [["directory", /director/i], ["editorial lists", /best of|editorial list/i], ["associations", /association/i], ["brokerage roster", /brokerage|franchise|employer/i], ["platform profiles", /Zillow|Avvo|Healthgrades|G2/], ["chamber", /chamber of commerce/i], ["local news", /local news/i], ["press releases", /press release/i], ["sponsorship", /sponsor/i], ["partners", /partner/i], ["podcasts", /podcast/i], ["own properties", /own other|other propert|own propert/i], ["social/link hubs", /link hub|sameAs|social profile/i], ["NAP", /NAP|name, address/i], ["map pack", /map pack/i], ["reviews", /review/i], ["link schemes", /link scheme|link spam/i], ["sponsored", /rel="sponsored"/], ["private blog networks", /private blog network|PBN/i], ["AI engines", /AI engine|answer engine/i], ["sameAs", /sameAs/], ["research-ai", /research-ai|ai-citations/], ["no guarantee", /no guarantee|cannot promise|never promise/i]];
  const miss = topics.filter(([, rx]) => !rx.test(st)).map(([n]) => n);
  check("doc: the playbook covers every source type, NAP, reviews, what to avoid and how AI engines pick sources", miss.length === 0, miss.join(", "));
  const types3 = need.filter((t) => !new RegExp("`" + t + "`").test(st));
  check("doc: the playbook names each taxonomy type by its id", types3.length === 0, types3.join(","));
  const cmds = ["authority-classify.mjs", "authority-vet.mjs", "authority-outreach.mjs", "authority.mjs", "opportunities.json", "vetting.json", "howto.md", "outreach.json"];
  check("doc: the playbook names the commands and files of the lane", cmds.every((c) => st.includes(c)), cmds.filter((c) => !st.includes(c)).join(","));
  check("doc: every pack is named in the playbook", slugs.every((s) => st.includes("`" + s + "`")), slugs.filter((s) => !st.includes("`" + s + "`")).join(","));
  const mine = ["scripts/authority-lib.mjs", "scripts/authority-classify.mjs", "scripts/authority-vet.mjs", "scripts/authority-outreach.mjs", "scripts/test-authority.mjs", "stages/authority.md", ...fs.readdirSync(path.join(skill, "rules", "link-sources")).map((f) => "rules/link-sources/" + f)];
  const crlf = mine.filter((f) => fs.existsSync(path.join(skill, f)) && fs.readFileSync(path.join(skill, f)).includes(13));
  check("hygiene: no CRLF, and every JSON file parses", crlf.length === 0 && mine.filter((f) => f.endsWith(".json")).every((f) => J(path.join(skill, f))), crlf.join());
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
