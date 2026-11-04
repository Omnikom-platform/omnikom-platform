// Launch: a V2 preview becomes a production site through one ledger with a stop condition (stages/launch.md, sops/clients/launch.md,
// Omnikom Platform DECISIONS 19).
// Usage:
//   node launch.mjs --init <pewp> [--site-url URL] [--pages URL,URL] [--site-dir DIR] [--waive ID,ID] [--build "<cmd>"] [--build-cwd DIR]
//                   [--redirects FILE|"none: <reason>"] [--old-origin URL] [--sitemap-url URL] [--detailed-seo FILE] [--omnikom-user EMAIL] [--force]
//   node launch.mjs --access <pewp> [--json]                      the owner access checklist as pickable questions (AskUserQuestion shape)
//   node launch.mjs --access-set <pewp> <key>=<granted|pending|client|na> --by NAME
//   node launch.mjs --check <pewp> [--only L-B8,L-B9] [--psi-fixture FILE] [--env-file FILE] [--gap-ms 1000] [--today YYYY-MM-DD]
//   node launch.mjs --status <pewp> [--today YYYY-MM-DD]           re-evaluates the ledger without running a check
//   node launch.mjs --task <pewp>                                  prints the one-shot agent brief
//   node launch.mjs --record <pewp> <L-id> --proof <http(s) URL|file> --by NAME [--note TEXT]     an OWNER-PROOF
//   node launch.mjs --block <pewp> <L-id> --reason owner-access|client-answer|owner-proof|third-party-outage --what TEXT --unblocks TEXT --by NAME
//   node launch.mjs --unblock <pewp> <L-id> --by NAME
//   node launch.mjs --config <pewp> key=value [key=value ...]      e.g. gate.siteDir=dist-launch  pages=https://a/,https://a/b/  commands.L-A1="node x.mjs"
// The ledger is <pewp>/launch.json. Each L-item has its "done when", its checks and/or an OWNER-PROOF slot, a status
// (OPEN, PASS, FAIL, BLOCKED) and the proof line it passed with. --check runs every automatable check again, every time:
//   gate          scripts/gate.mjs <pewp> <site dir> --strict (always strict) [--waive ...] [--build ...]
//   live-headers  every page: HTTP 200 (no redirect), no noindex (X-Robots-Tag or meta robots), robots.txt allows it for
//                 Googlebot and Bingbot, X-Content-Type-Options nosniff, Strict-Transport-Security and Cross-Origin-Opener-Policy on https
//   canonical     every page: rel=canonical equals the page URL, exactly one H1, a title of 1-60 characters
//   writing       scripts/writing-gate.mjs on the launch build (gate.siteDir) with --url <site url> and the ledger's pages (L-B9, next to
//                 psi): the 7 writing rules WG-1..WG-7 (critical CSS inline, unused CSS, image sizes, forced reflow, ARIA roles, llms.txt,
//                 HSTS + COOP). It reads the raw PageSpeed answers that the psi check saved under <pewp>/launch/psi/ as evidence.
//                 Config writing.viewports (e.g. 390x844) narrows the browser runs. PASS line = the gate's summary line.
//                 LAUNCH_WRITING_ONLY=WG-1,WG-6 (tests only, like PSI_API_BASE) runs those rules alone; such a run can FAIL but never PASSes
//                 (NOT RUN, "narrowed ... not a launch proof"), so it can never close L-B9.
//   psi           PageSpeed Insights v5, mobile and desktop: performance >= 90, accessibility, best practices and SEO = 100.
//                 Every answer is saved (scrubbed) as <pewp>/launch/psi/psi-<strategy>-<page>.json for the writing check.
//                 Key: $PSI_API_KEY (or --env-file), never printed or stored. No key = BLOCKED owner-access psi-key.
//                 --psi-fixture FILE answers from a file instead ({"mobile": <v5 answer>, "desktop": ..., "mobile <url>": ...});
//                 refused unless the site URL is a local host (localhost, 127.0.0.1, ::1, *.localhost, *.test): a fixture never proves a live site.
//   redirects     every rule of the 301 map (Cloudflare `_redirects` lines or JSON [{from,to}]): the old URL answers 301 with a
//                 Location equal to the target. Pattern rules (* or :name) are listed as NOT CHECKED.
//   sitemap       the sitemap file answers 200, is a urlset or sitemapindex, has at least one <loc>, every <loc> on the site's host
//   detailed-seo  if the CLI is present (config detailedSeo, e.g. E:\Alex Sevilla\tools\detailed-seo\run.mjs): its panel per page
//                 (canonical = URL, robots not noindex, one H1, title <= 60). Absent = SKIP, said in the proof line.
//   command       a site-specific command from config commands.<L-id>: exit 0 = PASS, its last output line is the proof line.
// Stop condition: every L-item is PASS with its proof line, or BLOCKED with an allowed reason and what unblocks it.
// Allowed BLOCKED reasons: owner-access (an access key of --access, or owner-click for an outward action), client-answer (Q-n),
// owner-proof (an item with an OWNER-PROOF slot whose checks do not fail), third-party-outage (expires after 24 h), and
// not-yet-due (set by the script only: C/D items before launch + their window).
// Exit (--check, --status): 0 every item PASS or allowed BLOCKED; 3 items open. Other modes: 0 done. All: 2 usage; 1 crash. Network: only --check (the site's own pages, PSI).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { loadEnv, envFileArg, EnvFileError } from "./lib-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = "omnikom-launch-ledger/1";
const UA = "omnikom-launch-check/1 (read-only; GET only)";
const USAGE = `usage: node launch.mjs --init <pewp> [--site-url URL] [--pages URL,URL] [--site-dir DIR] [--waive ID,ID] [--build "<cmd>"] [--build-cwd DIR] [--redirects FILE|"none: <reason>"] [--old-origin URL] [--sitemap-url URL] [--detailed-seo FILE] [--omnikom-user EMAIL] [--force]
       node launch.mjs --access <pewp> [--json]
       node launch.mjs --access-set <pewp> <key>=<granted|pending|client|na> --by NAME
       node launch.mjs --check <pewp> [--only L-B8,L-B9] [--psi-fixture FILE] [--env-file FILE] [--gap-ms 1000] [--today YYYY-MM-DD]
       node launch.mjs --status <pewp> [--today YYYY-MM-DD]
       node launch.mjs --task <pewp>
       node launch.mjs --record <pewp> <L-id> --proof <http(s) URL|file> --by NAME [--note TEXT]
       node launch.mjs --block <pewp> <L-id> --reason owner-access|client-answer|owner-proof|third-party-outage --what TEXT --unblocks TEXT --by NAME
       node launch.mjs --unblock <pewp> <L-id> --by NAME
       node launch.mjs --config <pewp> key=value [key=value ...]
Exit: 0 every item PASS or allowed BLOCKED; 3 items open; 2 usage; 1 crash.`;

// ---------------- the items (sops/clients/launch.md is the same list in words) ----------------
export const ITEMS = [
  ["L-A1", "A", "Client answers applied", "Every answer from the client question sheet (at most 12 questions, sops/clients/client-questions.md) is applied as a content row; the internal view shows 0 open questions; the rebuild passes the strict gate.", { checks: ["command"] }],
  ["L-A2", "A", "Platform dashboard and CRM live", "One real test lead goes form -> /api/lead -> captureLead -> a CRM record with every mapped field, plus the alert email, on staging and then on production.", { owner: true }],
  ["L-A3", "A", "Legal sign-off", "The client's approver (broker, lawyer or compliance) approved Privacy, Terms and Accessibility in writing; the approval is filed and the effective date is set on the pages.", { owner: true }],
  ["L-A4", "A", "Third-party logo permissions", "A written OK is filed for every partner or brand logo on the site, or the logo strip falls back to names only.", { owner: true }],
  ["L-A5", "A", "Domain and DNS access, email-safe", "Access is granted at the minimum role (no password shared); the zone is exported before any change and the plan keeps MX, SPF, DKIM and DMARC records untouched; every subdomain in use is decided.", { owner: true, access: ["registrar-dns", "cloudflare"] }],
  ["L-A6", "A", "Redirects from the old site", "A 301 map covers every old URL with traffic or links; every old URL answers 301 to its new page, tested.", { checks: ["redirects"] }],
  ["L-B7", "B", "Launch build passes the strict gate", "The launch build (noindex off, robots allow, samples dropped) passes gate.mjs --strict on the launch output.", { checks: ["gate"] }],
  ["L-B8", "B", "Custom domain live with HTTPS and headers", "Every key page answers 200 on the production URL, is indexable (no noindex header or meta), robots.txt allows it, and the security headers (nosniff, HSTS, Cross-Origin-Opener-Policy) are present; the preview host is retired or redirected.", { checks: ["live-headers"] }],
  ["L-B9", "B", "PageSpeed Insights on the live domain", "Mobile and desktop on every template page: performance 90+, accessibility 100, best practices 100, SEO 100; and the launch build passes the writing gate (writing-gate.mjs, 7 rules).", { checks: ["psi", "writing"] }],
  ["L-B10", "B", "Page tags on every template", "The canonical equals the URL, robots reads index/follow, there is one H1 and no cut-off title (60 characters or fewer); the Detailed SEO CLI agrees when it is present.", { checks: ["canonical", "detailed-seo"] }],
  ["L-B11", "B", "Search Console and Bing Webmaster", "The sitemap file is reachable and lists only production URLs; the Domain property is verified, the sitemap is submitted, URL inspection says indexable on the home page and 3 key pages; Bing has the site.", { checks: ["sitemap"], owner: true, access: ["search-console", "bing-webmaster"] }],
  ["L-B12", "B", "Rich results valid", "Google's Rich Results Test is valid for the site's main schema types (the business, a person, FAQ) on sample pages.", { owner: true }],
  ["L-B13", "B", "Analytics and conversions", "Page views and a conversion on every lead form submit are recorded (platform analytics or GA4); the consent text matches what is recorded.", { owner: true, access: ["analytics"] }],
  ["L-C14", "C", "Business Profile(s) verified", "Each Business Profile is verified, with the name, address and phone identical to the site, the right primary category, the website linked, and the review link shared with past clients.", { owner: true, due: 30, access: ["business-profile"] }],
  ["L-C15", "C", "Listings and citations, one identical NAP", "Every listing profile the industry uses (e.g. Zillow, Realtor.com, Yelp, Bing Places, Apple Business Connect) links to the new site with the same name, address and phone.", { owner: true, due: 30, access: ["listing-profiles"] }],
  ["L-C16", "C", "Stale third-party data fixed", "Profiles that show an old fact (a past employer or brokerage, an old address or phone) are corrected; the AI-answer re-check of the measure run no longer shows the old fact.", { owner: true, due: 30 }],
  ["L-C17", "C", "Partner sites link to the new site", "Every partner, broker or association page that lists the business links to the new site.", { owner: true, due: 30, access: ["partner-sites"] }],
  ["L-C18", "C", "Reviews flow into the site", "Reviews from the Business Profile (or another verified source) show in the site's review sections with their source and date.", { owner: true, due: 30 }],
  ["L-D19", "D", "Weekly measure report", "The skill's measure mode runs weekly (rankings and AI citations for the plan's queries); changes are proposed through iterate for approval.", { owner: true, due: 7 }],
  ["L-D20", "D", "Real-user speed (CrUX)", "After about 28 days of traffic, at the 75th percentile: LCP 2.5 s or less, CLS 0.1 or less, INP 200 ms or less.", { owner: true, due: 28 }],
  ["L-D21", "D", "Content cadence from the dashboard", "Placeholders are replaced by real rows from the client dashboard; publishing never breaks the gate.", { owner: true, due: 30 }],
  ["L-D22", "D", "Monitoring", "Uptime alerts are on, a test lead runs end to end every week, and the 404 log is checked and redirected.", { owner: true, due: 7 }],
];

// ---------------- the owner access checklist ----------------
export const ACCESS = [
  { key: "registrar-dns", header: "Domain/DNS", name: "Registrar and DNS", why: "point the domain at the site and keep the email records (MX, SPF, DKIM, DMARC) exactly as they are", role: "DNS editor for this one domain (the registrar's delegate access limited to DNS, or a DNS-only member role). Never the account owner, never transfer rights" },
  { key: "cloudflare", header: "Cloudflare", name: "Cloudflare (Pages + DNS)", why: "attach the custom domain to the Pages project, HTTPS, redirects and headers", role: "an API token scoped to Account > Cloudflare Pages: Edit (one account) and Zone > DNS: Edit + Zone: Read (one zone). Never the Global API Key" },
  { key: "search-console", header: "Search Cons.", name: "Google Search Console", why: "verify the Domain property, submit the sitemap, inspect URLs, read search data for measure", role: "Full user; Owner only if Omnikom verifies the Domain property through a DNS TXT record" },
  { key: "business-profile", header: "Biz Profile", name: "Google Business Profile", why: "verify the profile, match name/address/phone to the site, link the site, bring reviews in", role: "Manager (never Primary owner)" },
  { key: "bing-webmaster", header: "Bing", name: "Bing Webmaster Tools", why: "the site in Bing and in the AI answers that read Bing", role: "import from Search Console, or add omnikom as a Read/Write user" },
  { key: "analytics", header: "Analytics", name: "Analytics (platform or GA4)", why: "page views and a conversion on every lead form", role: "Editor on the one property (not the account); none if the platform's own analytics is used" },
  { key: "listing-profiles", header: "Listings", name: "Listing profiles (Zillow and similar for the industry)", why: "one identical name, address and phone everywhere, each linking to the new site", role: "a team or user seat where the platform has one; where it has none (a personal agent profile), the client makes the change from our exact text" },
  { key: "partner-sites", header: "Partner site", name: "Broker and partner websites", why: "links from the pages that already list the business", role: "none: their web admin makes the change; we send the exact URL and link text" },
  { key: "psi-key", header: "PSI key", name: "PageSpeed Insights API key (Omnikom's own)", why: "the launch speed check on the live domain", role: "a key from Omnikom's Google Cloud project, restricted to the PageSpeed Insights API, kept in the env file; never pasted in chat or printed" },
];
const ACCESS_KEYS = new Set(ACCESS.map((a) => a.key));
const ACCESS_STATES = new Set(["granted", "pending", "client", "na"]);
export const ALLOWED_MANUAL = ["owner-access", "client-answer", "owner-proof", "third-party-outage"];
const OUTAGE_HOURS = 24;

// ---------------- small helpers ----------------
class Usage extends Error {}
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const VALUE_FLAGS = new Set(["--site-url", "--pages", "--site-dir", "--waive", "--build", "--build-cwd", "--redirects", "--old-origin", "--sitemap-url", "--detailed-seo", "--omnikom-user", "--only", "--psi-fixture", "--env-file", "--dotenv", "--gap-ms", "--today", "--proof", "--by", "--note", "--reason", "--what", "--unblocks"]);
const positionals = () => argv.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const isUrl = (s) => /^https?:\/\//i.test(String(s || ""));
export const isLocalHost = (h) => /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(h) || /\.(localhost|test)$/i.test(h);
const todayArg = () => { const t = val("--today"); if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Usage("--today wants YYYY-MM-DD"); return t || new Date().toISOString().slice(0, 10); };
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const ledgerPath = (pewp) => path.join(pewp, "launch.json");
const readLedger = (pewp) => {
  const f = ledgerPath(pewp);
  if (!fs.existsSync(f)) throw new Usage(`no ledger at ${f}: run --init first`);
  const l = JSON.parse(fs.readFileSync(f, "utf8"));
  if (l.schema !== SCHEMA) throw new Usage(`${f} is not a launch ledger (${l.schema})`);
  return l;
};
const writeLedger = (pewp, l) => { l.updatedAt = new Date().toISOString(); fs.writeFileSync(ledgerPath(pewp), JSON.stringify(l, null, 2) + "\n"); };
const note = (l, action, item, by, detail) => l.history.push({ at: new Date().toISOString(), action, item: item || null, by: by || null, detail: detail || null });
const needBy = () => { const b = val("--by"); if (!b) throw new Usage("--by NAME is required (who decided)"); return b; };
const findItem = (l, id) => { const it = l.items.find((x) => x.id === id); if (!it) throw new Usage(`no item ${id} (items: ${l.items.map((x) => x.id).join(" ")})`); return it; };

// ---------------- init ----------------
function cmdInit(pewp) {
  fs.mkdirSync(pewp, { recursive: true });
  const f = ledgerPath(pewp);
  if (fs.existsSync(f)) {
    if (!has("--force")) throw new Usage(`${f} exists; --force starts over (the old ledger is kept as launch.<time>.json)`);
    fs.renameSync(f, path.join(pewp, `launch.${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  }
  let siteUrl = val("--site-url");
  if (!siteUrl) {
    const m = path.resolve(pewp).split(path.sep).join("/").match(/site-checks\/([^/]+)\/\.pewp$/);
    if (m) siteUrl = `https://${m[1]}/`;
  }
  if (!siteUrl || !isUrl(siteUrl)) throw new Usage("--site-url https://... is required (the production URL) when the pewp folder is not site-checks/<host>/.pewp");
  siteUrl = new URL(siteUrl).href;
  const pages = (val("--pages") || siteUrl).split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of pages) if (!isUrl(p)) throw new Usage(`--pages: ${p} is not an http(s) URL`);
  const abs = (p) => (p ? path.resolve(p) : null);
  const redirects = val("--redirects");
  const config = {
    siteUrl, pages: pages.map((p) => new URL(p).href),
    gate: { siteDir: abs(val("--site-dir")), waive: (val("--waive") || "").split(",").filter(Boolean), build: val("--build"), buildCwd: abs(val("--build-cwd")) },
    redirects: redirects ? (/^none:/i.test(redirects) ? redirects : path.resolve(redirects)) : null,
    oldOrigin: val("--old-origin"), sitemapUrl: val("--sitemap-url"),
    detailedSeo: abs(val("--detailed-seo")), omnikomUser: val("--omnikom-user"),
    commands: {}, commandsCwd: path.dirname(path.resolve(pewp)), gapMs: 1000, launchDate: null,
  };
  const items = ITEMS.map(([id, group, title, doneWhen, o]) => ({
    id, group, title, doneWhen,
    checks: o.checks || [], ownerProof: !!o.owner, dueDays: o.due ?? null, access: o.access || [],
    proof: [...(o.checks || []).map((c) => `check:${c}`), ...(o.owner ? ["OWNER-PROOF"] : [])].join(" + "),
    status: "OPEN", proofLine: null, results: {}, owner: null, blocked: null, activeBlock: null, needs: [],
  }));
  const l = { schema: SCHEMA, createdAt: new Date().toISOString(), updatedAt: null, pewp: path.resolve(pewp), config, launchedAt: null, access: {}, items, history: [] };
  note(l, "init", null, null, `${items.length} items, site ${siteUrl}`);
  writeLedger(pewp, l);
  console.log(`launch ledger written: ${f}`);
  console.log(`${items.length} items OPEN (A ${items.filter((i) => i.group === "A").length}, B ${items.filter((i) => i.group === "B").length}, C ${items.filter((i) => i.group === "C").length}, D ${items.filter((i) => i.group === "D").length}); site ${siteUrl}; ${config.pages.length} page(s)`);
  const missing = [];
  if (!config.gate.siteDir) missing.push("gate.siteDir (--site-dir: the launch build output)");
  if (!config.redirects) missing.push("redirects (--redirects: the 301 map, or \"none: <reason>\")");
  if (config.pages.length < 2) missing.push("pages (--pages: one URL per template)");
  if (missing.length) console.log(`still to configure (--config): ${missing.join("; ")}`);
  return 0;
}

// ---------------- config ----------------
const PATH_KEYS = new Set(["gate.siteDir", "gate.buildCwd", "detailedSeo", "commandsCwd"]);
function cmdConfig(pewp) {
  const l = readLedger(pewp);
  const pairs = positionals().slice(1);
  if (!pairs.length) throw new Usage("--config wants key=value pairs");
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 1) throw new Usage(`--config: ${p} is not key=value`);
    const key = p.slice(0, i), raw = p.slice(i + 1);
    let v;
    if (key === "pages" || key === "gate.waive") v = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else if (PATH_KEYS.has(key)) v = raw ? path.resolve(raw) : null;
    else if (key === "redirects") v = /^none:/i.test(raw) ? raw : path.resolve(raw);
    else { try { v = JSON.parse(raw); } catch { v = raw; } }
    if (key === "pages") for (const u of v) if (!isUrl(u)) throw new Usage(`pages: ${u} is not an http(s) URL`);
    if (key === "siteUrl" && !isUrl(v)) throw new Usage("siteUrl must be an http(s) URL");
    const parts = key.split(".");
    let o = l.config;
    for (const k of parts.slice(0, -1)) { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; }
    o[parts[parts.length - 1]] = v;
    console.log(`config ${key} = ${JSON.stringify(v)}`);
    note(l, "config", null, val("--by"), `${key}=${JSON.stringify(v)}`);
  }
  writeLedger(pewp, l);
  return 0;
}

// ---------------- access ----------------
function accessQuestions(l) {
  const user = l.config.omnikomUser || "the Omnikom account";
  return ACCESS.map((a) => ({
    key: a.key, header: a.header, multiSelect: false,
    question: `${a.name}: is omnikom (${user}) added as a user? Never send passwords: add omnikom as a user.`,
    why: a.why, minimumRole: a.role, stateNow: l.access[a.key]?.state || "not asked",
    options: [
      { label: "Granted", description: `omnikom was added as: ${a.role.split(". ")[0]}; no password was shared`, value: "granted" },
      { label: "Asked, waiting", description: "the owner or client has been asked and has not added omnikom yet", value: "pending" },
      { label: "Client does it", description: "no user seat possible: the client makes the change from our exact steps", value: "client" },
      { label: "Not used", description: "the business has no such account; the item that needs it uses its fallback", value: "na" },
    ],
  }));
}
function cmdAccess(pewp) {
  const l = readLedger(pewp);
  const qs = accessQuestions(l);
  const outDir = path.join(pewp, "launch");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "access-questions.json");
  fs.writeFileSync(file, JSON.stringify({ askedWith: "AskUserQuestion (at most 4 questions per call; the first option is first, a typed Other is a note)", record: `node launch.mjs --access-set ${pewp} <key>=<granted|pending|client|na> --by NAME`, questions: qs }, null, 2) + "\n");
  if (has("--json")) { console.log(JSON.stringify(qs, null, 2)); return 0; }
  console.log(`ACCESS CHECKLIST (${qs.length} items). Never send passwords: add omnikom as a user. The main session asks these as pickable questions; this script never prompts.`);
  qs.forEach((q, i) => {
    console.log(`${i + 1}. [${q.header}] ${q.question}`);
    console.log(`   why: ${q.why}`);
    console.log(`   minimum role: ${q.minimumRole}`);
    console.log(`   options: ${q.options.map((o) => `${o.label} (${o.value})`).join(" | ")}   state now: ${q.stateNow}`);
  });
  console.log(`record each answer: node launch.mjs --access-set ${pewp} <key>=<state> --by NAME`);
  console.log(`questions (JSON): ${file}`);
  return 0;
}
function cmdAccessSet(pewp) {
  const l = readLedger(pewp);
  const by = needBy();
  const pairs = positionals().slice(1);
  if (!pairs.length) throw new Usage("--access-set wants <key>=<state>");
  for (const p of pairs) {
    const [k, s] = p.split("=");
    if (!ACCESS_KEYS.has(k)) throw new Usage(`unknown access key ${k} (keys: ${[...ACCESS_KEYS].join(" ")})`);
    if (!ACCESS_STATES.has(s)) throw new Usage(`state must be one of ${[...ACCESS_STATES].join("|")}`);
    l.access[k] = { state: s, by, at: new Date().toISOString() };
    note(l, "access", null, by, `${k}=${s}`);
    console.log(`access ${k} = ${s} (by ${by})`);
  }
  evaluateAll(l, todayArg());
  writeLedger(pewp, l);
  return 0;
}

// ---------------- evaluation: the stop condition lives here ----------------
export function blockValidity(b, item, l, today) {
  if (!b) return "no block";
  if (!b.unblocks || !String(b.unblocks).trim()) return "a block must say what unblocks it";
  const failing = item.checks.some((c) => item.results[c]?.status === "FAIL");
  switch (b.reason) {
    case "owner-access": {
      if (b.access !== "owner-click" && !ACCESS_KEYS.has(b.access)) return `owner-access must name an access key (${[...ACCESS_KEYS].join(" ")}) or owner-click`;
      const st = l.access[b.access]?.state;
      if (st === "granted" || st === "na") return `access ${b.access} is recorded as ${st}: the block no longer holds`;
      return null;
    }
    case "client-answer": return /\bQ-?\d+\b/i.test(b.what || "") ? null : "client-answer must name the question (Q-n)";
    case "owner-proof":
      if (!item.ownerProof) return `${item.id} has no OWNER-PROOF slot (its proof is ${item.proof})`;
      if (failing) return "a check of this item fails: fix it before waiting on the owner's proof";
      return null;
    case "third-party-outage": {
      if (!b.what || !String(b.what).trim()) return "third-party-outage must name the service and what was seen";
      const age = (Date.now() - Date.parse(b.at)) / 36e5;
      return age <= OUTAGE_HOURS ? null : `the outage block is older than ${OUTAGE_HOURS} h: check again`;
    }
    case "not-yet-due": return b.auto ? null : "not-yet-due is set by the script only";
    default: return `reason ${b.reason} is not allowed (allowed: ${ALLOWED_MANUAL.join(", ")})`;
  }
}
function dueBlock(item, l, today) {
  if (item.dueDays == null) return null;
  const launch = l.config.launchDate || l.launchedAt;
  if (!launch) return { reason: "not-yet-due", auto: true, what: "the site is not launched yet (L-B8 has not passed)", unblocks: `launch day; then due ${item.dueDays} days after it` };
  const due = addDays(launch, item.dueDays);
  if (today < due) return { reason: "not-yet-due", auto: true, what: `due ${due}`, unblocks: `${due} (launch ${launch} + ${item.dueDays} days)` };
  return null;
}
function ownerProofValid(item) {
  const o = item.owner;
  if (!o) return "no OWNER-PROOF recorded";
  if (o.kind === "file") {
    if (!fs.existsSync(o.value)) return `the proof file is gone: ${o.value}`;
    if (sha256(fs.readFileSync(o.value)) !== o.sha256) return `the proof file changed after it was recorded: ${o.value}`;
  }
  return null;
}
export function evaluate(item, l, today) {
  const res = item.checks.map((c) => item.results[c] || { status: "NOT-RUN", line: `${c}: not run yet (run --check)` });
  const unproven = res.filter((r) => r.status === "PASS" && !(typeof r.line === "string" && r.line.startsWith(`${r.check} `)));
  const autoOk = res.every((r) => (r.status === "PASS" || r.status === "SKIP")) && !unproven.length;
  const ownerErr = item.ownerProof ? ownerProofValid(item) : null;
  item.needs = [];
  if (autoOk && !ownerErr) {
    item.status = "PASS"; item.blocked = null; item.activeBlock = null;
    item.proofLine = [...res.map((r) => r.line), ...(item.ownerProof ? [`OWNER-PROOF ${item.owner.value} (by ${item.owner.by}, ${item.owner.at.slice(0, 10)})`] : [])].join(" | ");
    return item;
  }
  item.proofLine = null;
  for (const b of [item.blocked, ...res.filter((r) => r.status === "BLOCKED").map((r) => r.block), dueBlock(item, l, today)]) {
    if (b && !blockValidity(b, item, l, today)) { item.status = "BLOCKED"; item.activeBlock = b; return item; }
  }
  item.activeBlock = null;
  if (item.blocked) item.needs.push(`block not accepted: ${blockValidity(item.blocked, item, l, today)}`);
  for (const r of unproven) item.needs.push(`${r.check} says PASS without its check's own output line: not accepted (run --check)`);
  for (const r of res) if (r.status !== "PASS" && r.status !== "SKIP") item.needs.push(r.line);
  if (item.ownerProof && ownerErr) item.needs.push(`OWNER-PROOF: ${ownerErr} (node launch.mjs --record <pewp> ${item.id} --proof <url|file> --by NAME)`);
  item.status = res.some((r) => r.status === "FAIL") ? "FAIL" : "OPEN";
  return item;
}
export function evaluateAll(l, today) {
  for (const it of l.items) for (const [c, r] of Object.entries(it.results)) if (r && !r.check) r.check = c;
  for (const it of l.items) evaluate(it, l, today);
  const b8 = l.items.find((i) => i.id === "L-B8");
  if (b8?.status === "PASS" && !l.launchedAt) { l.launchedAt = today; note(l, "launched", "L-B8", null, `L-B8 passed on ${today}`); for (const it of l.items) evaluate(it, l, today); }
  const count = (s) => l.items.filter((i) => i.status === s).length;
  const done = l.items.every((i) => i.status === "PASS" || i.status === "BLOCKED");
  return { done, pass: count("PASS"), blocked: count("BLOCKED"), fail: count("FAIL"), open: count("OPEN"), total: l.items.length };
}
function printLedger(l, s) {
  for (const it of l.items) {
    const head = `${it.status.padEnd(7)} ${it.id.padEnd(5)} ${it.title}`;
    if (it.status === "PASS") console.log(`${head}: ${it.proofLine}`);
    else if (it.status === "BLOCKED") console.log(`${head}: BLOCKED ${it.activeBlock.reason}${it.activeBlock.access ? " " + it.activeBlock.access : ""} (${it.activeBlock.what || ""}); unblocks: ${it.activeBlock.unblocks}`);
    else console.log(`${head}: ${it.needs.join("; ") || "open"}`);
  }
  const line = `${s.pass} PASS, ${s.blocked} BLOCKED (allowed), ${s.fail} FAIL, ${s.open} OPEN of ${s.total}`;
  console.log(s.done ? `LEDGER DONE: ${line} (exit 0)` : `LEDGER OPEN: ${line} (exit 3)`);
  return s.done ? 0 : 3;
}

// ---------------- the checks ----------------
function makeFetcher(gapMs) {
  const cache = new Map();
  let last = 0;
  return async function get(url, { cacheIt = true } = {}) {
    if (cacheIt && cache.has(url)) return cache.get(url);
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    let out;
    // a kept-alive connection that the site closed while a long check ran (the gate and the writing check block this process for
    // minutes) resets on first use: one retry on a fresh connection is not a second attempt at an obstacle
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(20000) });
        const body = (await r.text()).slice(0, 3e6);
        out = { status: r.status, headers: r.headers, body };
        break;
      } catch (e) {
        out = { status: 0, error: e.name === "TimeoutError" ? "no answer in 20 s" : (e.cause?.code || e.message), headers: new Headers(), body: "" };
        if (!/^(ECONNRESET|UND_ERR_SOCKET|EPIPE)$/.test(String(e.cause?.code || ""))) break;
      }
    }
    last = Date.now();
    if (cacheIt) cache.set(url, out);
    return out;
  };
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[1] ?? m[2] ?? m[3]) : null; };
const metaRobotsNoindex = (html) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const n = (attr(tag, "name") || "").toLowerCase();
    if (/^(robots|googlebot|bingbot)$/.test(n) && /\b(noindex|none)\b/i.test(attr(tag, "content") || "")) return `meta ${n}="${attr(tag, "content")}"`;
  }
  return null;
};
const headerNoindex = (h) => { const x = h.get("x-robots-tag"); return x && /\b(noindex|none)\b/i.test(x) ? `X-Robots-Tag: ${x}` : null; };
export function robotsAllows(txt, urlPath, agent) {
  const groups = []; let cur = null, lastWasUa = false;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!lastWasUa || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasUa = true; continue; }
    lastWasUa = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
  }
  const a = agent.toLowerCase();
  let picked = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  if (!picked.length) picked = groups.filter((g) => g.agents.includes("*"));
  const rules = picked.flatMap((g) => g.rules).filter((r) => r.path !== "");
  const match = (pat) => {
    const anchored = pat.endsWith("$"), body = (anchored ? pat.slice(0, -1) : pat).split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp("^" + body + (anchored ? "$" : "")).test(urlPath);
  };
  let best = null;
  for (const r of rules) if (match(r.path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  return !best || best.allow;
}
export async function checkLiveHeaders(l, get) {
  const pages = l.config.pages, bad = [], robotsCache = new Map();
  for (const p of pages) {
    const r = await get(p);
    if (r.status !== 200) { bad.push(`${p} answered ${r.status || r.error}${r.headers.get("location") ? " to " + r.headers.get("location") : ""} (want 200)`); continue; }
    const ni = headerNoindex(r.headers) || metaRobotsNoindex(r.body);
    if (ni) bad.push(`${p} is noindex (${ni})`);
    if ((r.headers.get("x-content-type-options") || "").toLowerCase() !== "nosniff") bad.push(`${p} has no X-Content-Type-Options: nosniff`);
    if (p.startsWith("https:") && !r.headers.get("strict-transport-security")) bad.push(`${p} has no Strict-Transport-Security`);
    if (p.startsWith("https:") && !r.headers.get("cross-origin-opener-policy")) bad.push(`${p} has no Cross-Origin-Opener-Policy`);
    const u = new URL(p), origin = u.origin;
    if (!robotsCache.has(origin)) robotsCache.set(origin, await get(origin + "/robots.txt"));
    const rb = robotsCache.get(origin);
    if (rb.status >= 500 || rb.status === 0) bad.push(`${origin}/robots.txt answered ${rb.status || rb.error} (an unreachable robots.txt blocks crawling)`);
    else if (rb.status === 200) for (const bot of ["Googlebot", "Bingbot"]) if (!robotsAllows(rb.body, u.pathname + u.search, bot)) bad.push(`robots.txt disallows ${u.pathname} for ${bot}`);
  }
  const tail = pages.some((p) => p.startsWith("https:")) ? "nosniff, HSTS, COOP" : "nosniff";
  return bad.length ? { status: "FAIL", line: `live-headers FAIL ${bad.length} problem(s) on ${pages.length} page(s): ${bad.slice(0, 6).join("; ")}` }
    : { status: "PASS", line: `live-headers PASS ${pages.length}/${pages.length} pages: 200, indexable (no noindex header or meta), robots.txt allows Googlebot and Bingbot, ${tail}` };
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
async function checkCanonical(l, get) {
  const pages = l.config.pages, bad = [];
  for (const p of pages) {
    const r = await get(p);
    if (r.status !== 200) { bad.push(`${p} answered ${r.status || r.error}`); continue; }
    const tag = (r.body.match(/<link\b[^>]*>/gi) || []).find((t) => /(^|\s)canonical(\s|$)/i.test(attr(t, "rel") || ""));
    const href = tag ? attr(tag, "href") : null;
    let canon = null; try { canon = href ? new URL(decode(href), p).href : null; } catch {}
    if (!canon) bad.push(`${p} has no canonical`);
    else if (canon !== new URL(p).href) bad.push(`${p} canonical is ${canon}`);
    const h1 = (r.body.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) bad.push(`${p} has ${h1} H1`);
    const t = r.body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i), title = t ? decode(t[1]) : "";
    if (!title) bad.push(`${p} has no title`);
    else if (title.length > 60) bad.push(`${p} title is ${title.length} characters (cut off above about 60): "${title.slice(0, 70)}"`);
  }
  return bad.length ? { status: "FAIL", line: `canonical FAIL ${bad.length} problem(s): ${bad.slice(0, 6).join("; ")}` }
    : { status: "PASS", line: `canonical PASS ${pages.length}/${pages.length} pages: canonical = URL, one H1, title 1-60 characters` };
}
function parseRedirects(text, file) {
  if (/\.json$/i.test(file)) return JSON.parse(text).map((r) => ({ from: r.from, to: r.to, code: String(r.status || r.code || 301) }));
  return text.split(/\r?\n/).map((s) => s.replace(/#.*$/, "").trim()).filter(Boolean).map((s) => { const [from, to, code = "302"] = s.split(/\s+/); return { from, to, code }; });
}
async function checkRedirects(l, get) {
  const cfg = l.config.redirects;
  if (!cfg) return { status: "NOT-CONFIGURED", line: "redirects: no 301 map configured (--config redirects=<_redirects or JSON file> or \"none: <reason>\")" };
  if (/^none:/i.test(cfg)) return { status: "PASS", line: `redirects PASS no old site: ${cfg.replace(/^none:\s*/i, "")}` };
  if (!fs.existsSync(cfg)) return { status: "NOT-CONFIGURED", line: `redirects: the map file is missing: ${cfg}` };
  const rules = parseRedirects(fs.readFileSync(cfg, "utf8"), cfg);
  const site = new URL(l.config.siteUrl), oldOrigin = l.config.oldOrigin || site.origin;
  const patterns = rules.filter((r) => /[*:]/.test(r.from.replace(/^https?:\/\//, ""))), stat = rules.filter((r) => !patterns.includes(r));
  if (!stat.length) return { status: "FAIL", line: `redirects FAIL the map ${path.basename(cfg)} has no static rule to test` };
  const bad = [];
  for (const r of stat) {
    const from = isUrl(r.from) ? r.from : oldOrigin.replace(/\/$/, "") + r.from;
    const want = new URL(r.to, site.origin).href;
    const res = await get(from, { cacheIt: false });
    const loc = res.headers.get("location");
    const got = loc ? new URL(loc, from).href : null;
    if (res.status !== 301 || got !== want) bad.push(`${from} answered ${res.status || res.error}${got ? " to " + got : ""} (want 301 to ${want})`);
  }
  const nc = patterns.length ? `; ${patterns.length} pattern rule(s) NOT CHECKED` : "";
  return bad.length ? { status: "FAIL", line: `redirects FAIL ${bad.length} of ${stat.length}: ${bad.slice(0, 6).join("; ")}${nc}` }
    : { status: "PASS", line: `redirects PASS ${stat.length}/${stat.length} old URLs answer 301 to their target (${path.basename(cfg)})${nc}` };
}
async function checkSitemap(l, get) {
  const site = new URL(l.config.siteUrl);
  const url = l.config.sitemapUrl || site.origin + "/sitemap.xml";
  const r = await get(url, { cacheIt: false });
  if (r.status !== 200) return { status: "FAIL", line: `sitemap FAIL ${url} answered ${r.status || r.error} (want 200)` };
  const kind = /<urlset\b/i.test(r.body) ? "urlset" : /<sitemapindex\b/i.test(r.body) ? "sitemapindex" : null;
  if (!kind) return { status: "FAIL", line: `sitemap FAIL ${url} is not a urlset or sitemapindex` };
  const locs = [...r.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  if (!locs.length) return { status: "FAIL", line: `sitemap FAIL ${url} lists no <loc>` };
  const off = locs.filter((u) => { try { return new URL(u).host !== site.host; } catch { return true; } });
  if (off.length) return { status: "FAIL", line: `sitemap FAIL ${off.length} of ${locs.length} <loc> not on ${site.host}: ${off.slice(0, 3).join(", ")}` };
  return { status: "PASS", line: `sitemap PASS ${url}: 200, ${kind}, ${locs.length} URL(s), all on ${site.host}` };
}
function checkGate(l) {
  const g = l.config.gate || {};
  if (!g.siteDir) return { status: "NOT-CONFIGURED", line: "gate: no launch build folder configured (--config gate.siteDir=<dist-launch>)" };
  if (!fs.existsSync(g.siteDir)) return { status: "FAIL", line: `gate FAIL the launch build folder is missing: ${g.siteDir}` };
  const out = path.join(l.pewp, "launch", "gate");
  const args = [path.join(HERE, "gate.mjs"), l.pewp, g.siteDir, "--strict", "--out", out];
  if (g.waive?.length) args.push("--waive", g.waive.join(","));
  if (g.build) { args.push("--build", g.build); if (g.buildCwd) args.push("--build-cwd", g.buildCwd); }
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30 * 60000, maxBuffer: 64 * 1024 * 1024 });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "output.txt"), `${process.execPath} ${args.join(" ")}\nexit ${r.status}\n${r.stdout || ""}${r.stderr || ""}`);
  const lines = (r.stdout || "").split(/\r?\n/);
  const summary = lines.filter((s) => /^(PASS|FAIL|ERROR) gate /.test(s)).pop() || `gate.mjs exit ${r.status} ${(r.stderr || "").trim().split("\n").pop() || ""}`;
  const waived = g.waive?.length ? ` (strict, waived ${g.waive.join(",")})` : " (strict)";
  if (r.status === 0) return { status: "PASS", line: `gate ${summary}${waived}` };
  const fails = lines.filter((s) => /^(FAIL|ERROR) GT-/.test(s)).slice(0, 3);
  return { status: "FAIL", line: `gate FAIL exit ${r.status}: ${summary}${waived}${fails.length ? "; " + fails.join("; ") : ""}` };
}
function checkDetailedSeo(l) {
  const cli = l.config.detailedSeo;
  if (!cli || !fs.existsSync(cli)) return { status: "SKIP", line: `detailed-seo NOT RUN: CLI not present${cli ? " at " + cli : " (config detailedSeo not set)"}` };
  const out = path.join(l.pewp, "launch", "detailed-seo"), bad = [];
  fs.mkdirSync(out, { recursive: true });
  for (const p of l.config.pages) {
    const r = spawnSync(process.execPath, [cli, p, "--out", out], { encoding: "utf8", timeout: 180000 });
    if (r.status !== 0) { bad.push(`${p}: the CLI exited ${r.status}${r.status === 3 ? " (robot check or rate limit: stopped)" : ""}`); continue; }
    let data = null;
    for (const d of fs.readdirSync(out)) { const f = path.join(out, d, "data.json"); if (fs.existsSync(f)) { try { const j = JSON.parse(fs.readFileSync(f, "utf8")); if (j.url === p) data = j; } catch {} } }
    if (!data) { bad.push(`${p}: no data.json from the CLI`); continue; }
    const panel = data.panel || {}, page = data.page || {};
    const canon = panel.canonical || null;
    if (canon !== p) bad.push(`${p}: panel canonical ${canon}`);
    if (/\b(noindex|none)\b/i.test(panel.robotsTag || "")) bad.push(`${p}: panel robots ${panel.robotsTag}`);
    const h1 = panel.h1 || page.h1 || [];
    if (h1.length !== 1) bad.push(`${p}: panel shows ${h1.length} H1`);
    const title = String(panel.title || page.title || "");
    if (!title || title.length > 60) bad.push(`${p}: panel title ${title.length} characters`);
  }
  return bad.length ? { status: "FAIL", line: `detailed-seo FAIL ${bad.length} problem(s): ${bad.slice(0, 6).join("; ")}` }
    : { status: "PASS", line: `detailed-seo PASS ${l.config.pages.length}/${l.config.pages.length} pages (${path.basename(path.dirname(cli))}): canonical = URL, robots indexable, one H1, title <= 60` };
}
function checkCommand(l, item) {
  const cmd = l.config.commands?.[item.id];
  if (!cmd) return { status: "NOT-CONFIGURED", line: `command: no command configured for ${item.id} (--config commands.${item.id}="<command that exits 0 when done>")` };
  const r = spawnSync(cmd, { shell: true, cwd: l.config.commandsCwd || path.dirname(l.pewp), encoding: "utf8", timeout: 10 * 60000 });
  const last = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || (r.stderr || "").trim().split(/\r?\n/).pop() || "(no output)";
  return r.status === 0 ? { status: "PASS", line: `command PASS \`${cmd}\`: ${last}` } : { status: "FAIL", line: `command FAIL \`${cmd}\` exit ${r.status}: ${last}` };
}
// writing-gate.mjs on the launch build (stages/launch.md). Exit 0 PASS, 1 FAIL, 2 a rule could not run (NOT-RUN: the item stays open).
function checkWriting(l) {
  const g = l.config.gate || {};
  if (!g.siteDir) return { status: "NOT-CONFIGURED", line: "writing: no launch build folder configured (--config gate.siteDir=<dist-launch>)" };
  if (!fs.existsSync(g.siteDir)) return { status: "FAIL", line: `writing FAIL the launch build folder is missing: ${g.siteDir}` };
  const out = path.join(l.pewp, "launch", "writing"), psiDir = path.join(l.pewp, "launch", "psi");
  fs.mkdirSync(out, { recursive: true });
  const pagePaths = [...new Set(l.config.pages.map((p) => new URL(p).pathname))];
  const args = [path.join(HERE, "writing-gate.mjs"), g.siteDir, "--url", l.config.siteUrl, "--pages", pagePaths.join(","), "--json", path.join(out, "report.json")];
  if (fs.existsSync(psiDir) && fs.readdirSync(psiDir).some((f) => f.endsWith(".json"))) args.push("--psi-dir", psiDir);
  if (l.config.writing?.viewports) args.push("--viewports", String(l.config.writing.viewports));
  const narrow = process.env.LAUNCH_WRITING_ONLY || "";
  if (narrow) args.push("--only", narrow);
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 20 * 60000, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, "output.txt"), `${process.execPath} ${args.join(" ")}\nexit ${r.status}\n${r.stdout || ""}${r.stderr || ""}`);
  const lines = (r.stdout || "").split(/\r?\n/);
  const summary = lines.filter((s) => /^(PASS|FAIL|ERROR) writing-gate /.test(s)).pop() || `writing-gate.mjs exit ${r.status} ${(r.stderr || "").trim().split("\n").pop() || ""}`;
  if (r.status === 0) return narrow ? { status: "NOT-RUN", line: `writing NOT RUN narrowed to ${narrow} by LAUNCH_WRITING_ONLY (a test knob, not a launch proof): ${summary}` } : { status: "PASS", line: `writing ${summary}` };
  if (r.status === 2 && /^ERROR writing-gate /.test(summary)) {
    const nr = lines.filter((s) => /^NOT RUN WG-/.test(s)).slice(0, 3);
    return { status: "NOT-RUN", line: `writing NOT RUN exit 2: ${summary}${nr.length ? "; " + nr.join("; ") : ""}` };
  }
  const fails = lines.filter((s) => /^FAIL WG-/.test(s)).slice(0, 3);
  return { status: "FAIL", line: `writing FAIL exit ${r.status}: ${summary}${fails.length ? "; " + fails.join("; ") : ""}` };
}
const PSI_THRESH = { performance: 90, accessibility: 100, "best-practices": 100, seo: 100 };
async function checkPsi(l, fixtureFile, gapMs) {
  const pages = l.config.pages, strategies = ["mobile", "desktop"];
  // the raw answers are kept for the writing check (its evidence lines); the folder is emptied first so no old answer is read
  const psiDir = path.join(l.pewp, "launch", "psi");
  fs.mkdirSync(psiDir, { recursive: true });
  for (const f of fs.readdirSync(psiDir)) if (f.endsWith(".json")) fs.rmSync(path.join(psiDir, f), { force: true });
  const keep = (st, p, text) => fs.writeFileSync(path.join(psiDir, `psi-${st}-${new URL(p).pathname.replace(/[^a-z0-9]+/gi, "_")}.json`), text);
  let fixture = null, key = null;
  if (fixtureFile) fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  else {
    key = process.env.PSI_API_KEY || null;
    if (!key) return { status: "BLOCKED", line: "psi: no PSI_API_KEY", block: { reason: "owner-access", access: "psi-key", what: "PSI_API_KEY is not set", unblocks: "a PageSpeed Insights API key in the env file (--env-file) or the environment as PSI_API_KEY" } };
  }
  const scrub = (s) => { let t = String(s); if (key) for (const k of new Set([key, encodeURIComponent(key)])) t = t.split(k).join("[key removed]"); return t; };
  const base = (process.env.PSI_API_BASE || "https://www.googleapis.com/pagespeedonline/v5/runPagespeed").replace(/\/$/, "");
  const bad = [], seen = []; let first = true;
  for (const p of pages) for (const st of strategies) {
    let ans;
    if (fixture) {
      ans = fixture[`${st} ${p}`] || fixture[st];
      if (!ans) { bad.push(`${st} ${p}: the fixture has no answer`); continue; }
      keep(st, p, JSON.stringify(ans));
    } else {
      if (!first) await sleep(Math.max(gapMs, 1000));
      first = false;
      const q = new URLSearchParams({ url: p, strategy: st });
      for (const c of Object.keys(PSI_THRESH)) q.append("category", c);
      q.append("key", key);
      try {
        const r = await fetch(`${base}?${q}`, { signal: AbortSignal.timeout(Number(process.env.PSI_TIMEOUT_MS) || 120000) });
        const text = await r.text();
        if (r.status === 429 || r.status >= 500) return { status: "BLOCKED", line: scrub(`psi: PageSpeed Insights answered ${r.status}`), block: { reason: "third-party-outage", what: scrub(`PageSpeed Insights answered ${r.status} at ${new Date().toISOString()}`), unblocks: "run --check again later", at: new Date().toISOString() } };
        if (r.status !== 200) { let msg = text; try { msg = JSON.parse(text).error?.message || text; } catch {} bad.push(`${st} ${p}: PageSpeed Insights answered ${r.status} ${scrub(String(msg)).slice(0, 400)}`); continue; } // scrub BEFORE cutting: a cut key is no longer found by the scrub
        ans = JSON.parse(text);
        keep(st, p, scrub(text));
      } catch (e) { bad.push(scrub(`${st} ${p}: ${e.name === "TimeoutError" ? "no answer in time" : e.message}`)); continue; }
    }
    const cats = ans?.lighthouseResult?.categories || {};
    const sc = Object.fromEntries(Object.keys(PSI_THRESH).map((c) => [c, typeof cats[c]?.score === "number" ? Math.round(cats[c].score * 100) : null]));
    const miss = Object.entries(PSI_THRESH).filter(([c, t]) => sc[c] == null || sc[c] < t).map(([c, t]) => `${c} ${sc[c] ?? "missing"} (want ${t === 100 ? "100" : t + "+"})`);
    seen.push(`${st} ${new URL(p).pathname} ${sc.performance}/${sc.accessibility}/${sc["best-practices"]}/${sc.seo}`);
    if (miss.length) bad.push(`${st} ${p}: ${miss.join(", ")}`);
  }
  const src = fixture ? `fixture ${path.basename(fixtureFile)}, not a live measurement` : "PageSpeed Insights v5 live";
  return bad.length ? { status: "FAIL", line: scrub(`psi FAIL ${bad.length} of ${pages.length * 2} runs (${src}): ${bad.slice(0, 6).join("; ")}`) }
    : { status: "PASS", line: `psi PASS ${pages.length * 2}/${pages.length * 2} runs (${src}), perf/a11y/bp/seo: ${seen.join(", ")}` };
}

async function cmdCheck(pewp) {
  const l = readLedger(pewp);
  const today = todayArg();
  const fixtureFile = val("--psi-fixture") ? path.resolve(val("--psi-fixture")) : null;
  if (fixtureFile) {
    if (!fs.existsSync(fixtureFile)) throw new Usage(`--psi-fixture: no such file ${fixtureFile}`);
    const hosts = [l.config.siteUrl, ...l.config.pages].map((u) => new URL(u).hostname);
    const live = hosts.filter((h) => !isLocalHost(h));
    if (live.length) throw new Usage(`--psi-fixture is refused for a live host (${live[0]}): a fixture never proves a live site; use PSI_API_KEY`);
  }
  try { loadEnv({ envFile: envFileArg(argv), pewp, cwd: process.cwd() }); } catch (e) { if (e instanceof EnvFileError) throw new Usage(e.message); throw e; }
  const gapMs = val("--gap-ms") != null ? Number(val("--gap-ms")) : (l.config.gapMs ?? 1000);
  if (!Number.isFinite(gapMs) || gapMs < 0) throw new Usage("--gap-ms wants a number of milliseconds");
  const only = val("--only") ? new Set(val("--only").split(",")) : null;
  const items = l.items.filter((i) => !only || only.has(i.id));
  const get = makeFetcher(gapMs);
  const shared = {};
  const run = async (c, item) => {
    if (c === "command") return checkCommand(l, item);
    if (!(c in shared)) {
      shared[c] = c === "gate" ? checkGate(l) : c === "live-headers" ? await checkLiveHeaders(l, get) : c === "canonical" ? await checkCanonical(l, get)
        : c === "redirects" ? await checkRedirects(l, get) : c === "sitemap" ? await checkSitemap(l, get) : c === "detailed-seo" ? checkDetailedSeo(l)
        : c === "psi" ? await checkPsi(l, fixtureFile, gapMs) : c === "writing" ? checkWriting(l) : { status: "FAIL", line: `${c}: unknown check` };
    }
    return shared[c];
  };
  for (const it of items) for (const c of it.checks) {
    const r = await run(c, it);
    it.results[c] = { ...r, check: c, at: new Date().toISOString() };
  }
  note(l, "check", only ? [...only].join(",") : "all", null, null);
  const s = evaluateAll(l, today);
  writeLedger(pewp, l);
  const lines = [];
  const orig = console.log; console.log = (...a) => { lines.push(a.join(" ")); orig(...a); };
  let code;
  try { code = printLedger(l, s); } finally { console.log = orig; }
  const runs = path.join(pewp, "runs");
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, `${today}-launch.md`), `# launch --check ${today}\n\nCommand: node launch.mjs ${argv.join(" ")}\nExit: ${code}\n\n\`\`\`\n${lines.slice(0, 40).join("\n")}\n\`\`\`\n`);
  return code;
}
function cmdStatus(pewp) {
  const l = readLedger(pewp);
  const s = evaluateAll(l, todayArg());
  writeLedger(pewp, l);
  return printLedger(l, s);
}

// ---------------- owner proof, blocks ----------------
function cmdRecord(pewp) {
  const l = readLedger(pewp);
  const it = findItem(l, positionals()[1]);
  const by = needBy(), proof = val("--proof");
  if (!it.ownerProof) throw new Usage(`${it.id} is proven by its check only (${it.proof}); --record is refused`);
  if (!proof) throw new Usage("--proof <http(s) URL or file> is required");
  let owner;
  if (isUrl(proof)) owner = { kind: "url", value: proof };
  else {
    const f = path.resolve(proof);
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Usage(`--proof: no such file ${f}`);
    owner = { kind: "file", value: f, sha256: sha256(fs.readFileSync(f)) };
  }
  it.owner = { ...owner, by, at: new Date().toISOString(), note: val("--note") };
  note(l, "record", it.id, by, owner.value);
  const s = evaluateAll(l, todayArg());
  writeLedger(pewp, l);
  console.log(`${it.id} OWNER-PROOF recorded: ${owner.value} (by ${by}); status ${it.status}${it.status === "PASS" ? "" : ": " + it.needs.join("; ")}`);
  return 0;
}
function cmdBlock(pewp) {
  const l = readLedger(pewp);
  const it = findItem(l, positionals()[1]);
  const by = needBy(), reason = val("--reason"), what = val("--what"), unblocks = val("--unblocks");
  if (!ALLOWED_MANUAL.includes(reason)) throw new Usage(`--reason ${reason} is not allowed. Allowed: ${ALLOWED_MANUAL.join(", ")}. Anything else is work to do, not a block.`);
  if (!what || !unblocks) throw new Usage("--what and --unblocks are required");
  const b = { reason, what, unblocks, by, at: new Date().toISOString() };
  if (reason === "owner-access") b.access = what.split(/[\s:]/)[0];
  const err = blockValidity(b, it, l, todayArg());
  if (err) throw new Usage(`block refused for ${it.id}: ${err}`);
  it.blocked = b;
  note(l, "block", it.id, by, `${reason}: ${what}; unblocks: ${unblocks}`);
  const s = evaluateAll(l, todayArg());
  writeLedger(pewp, l);
  console.log(`${it.id} ${it.status}${it.status === "BLOCKED" ? ` ${it.activeBlock.reason}` : ""}: ${what}; unblocks: ${unblocks}`);
  return 0;
}
function cmdUnblock(pewp) {
  const l = readLedger(pewp);
  const it = findItem(l, positionals()[1]);
  const by = needBy();
  it.blocked = null;
  note(l, "unblock", it.id, by, null);
  const s = evaluateAll(l, todayArg());
  writeLedger(pewp, l);
  console.log(`${it.id} block removed; status ${it.status}`);
  return 0;
}

// ---------------- the agent brief ----------------
function cmdTask(pewp) {
  const l = readLedger(pewp);
  const s = evaluateAll(l, todayArg());
  const me = `node "${fileURLToPath(import.meta.url)}"`, P = `"${path.resolve(pewp)}"`;
  const open = l.items.filter((i) => i.status !== "PASS" && i.status !== "BLOCKED");
  const out = [
    `# Launch task: ${l.config.siteUrl} (one shot)`,
    ``,
    `You take this site from preview to production. Work the ledger ${ledgerPath(path.resolve(pewp))} to the end, in one session.`,
    `Sources: stages/launch.md (skill), E:\\Omnikom Platform\\code\\main\\sops\\clients\\launch.md (what each item means), docs/product/7-sites.md "Launch".`,
    ``,
    `## Stop condition (the only way this task ends)`,
    `Every L-item is PASS with its proof line, or BLOCKED with an allowed reason and what unblocks it. Nothing else ends the task:`,
    `not a time limit, not "mostly done", not a hard item. \`${me} --status ${P}\` exits 0 only then; exit 3 means keep working.`,
    ``,
    `## Allowed BLOCKED reasons (nothing else)`,
    `- owner-access: waiting on owner access X (a key from --access, or owner-click for an outward action the owner must click: DNS change, going live, sending).`,
    `  \`${me} --block ${P} <L-id> --reason owner-access --what "<access key>: <detail>" --unblocks "<what the owner does>" --by "<you>"\``,
    `- client-answer: waiting on client answer Q-n. \`--reason client-answer --what "Q-7: <question>" --unblocks "<the answer, applied as a row>"\``,
    `- owner-proof: needs OWNER-PROOF (a screenshot or URL only the owner can give: Search Console, Business Profile verification, Rich Results Test). Only for items with an OWNER-PROOF slot whose checks do not fail.`,
    `- third-party-outage: a named service is down; say what you saw. It expires after ${OUTAGE_HOURS} h.`,
    `- not-yet-due: set by the script only (C and D items before launch + their window). Start them anyway when you can.`,
    `A block is refused when its reason does not hold (for example the access is recorded as granted).`,
    ``,
    `## The loop`,
    `1. \`${me} --check ${P}\` runs every automatable check and prints one line per item.`,
    `2. Take each item that is OPEN or FAIL. Fix the cause (the site build, the redirect map, the config), then run --check again.`,
    `3. An item with an OWNER-PROOF slot: prepare everything, then ask the owner for the screenshot or URL; record it with`,
    `   \`${me} --record ${P} <L-id> --proof <url|file> --by "<owner>"\`. Until then block it with reason owner-proof.`,
    `4. Missing access: \`${me} --access ${P}\`; the main session asks the owner (pickable options) and records \`--access-set\`.`,
    `5. Repeat until --status exits 0. Then report: the final --check output, pasted.`,
    ``,
    `## Rules`,
    `- Never mark PASS without the check's own output line. You cannot: PASS comes only from --check or a recorded owner proof. Never edit launch.json by hand; --check re-runs every check and overwrites it.`,
    `- Outward actions (DNS changes, going live, sending email, account settings) need the owner's click. Prepare them; block with owner-access owner-click.`,
    `- Read only on every third-party site: no form, no login, no sign-up. First rate limit or robot check: stop that host.`,
    `- Never print or paste a key. PSI_API_KEY comes from the env file.`,
    `- L-B9 also runs the writing gate (7 rules, stages/build.md): its FAIL lines name the rule (WG-1..WG-7). Fix the site's build so it obeys the rule; do not edit the check, and do not narrow it.`,
    `- Two failed approaches to the same obstacle: block it with the honest reason, or report it FAIL with the command and its output. Do not retry forever.`,
    ``,
    `## Now: ${s.pass} PASS, ${s.blocked} BLOCKED, ${s.fail} FAIL, ${s.open} OPEN of ${s.total}`,
    ...open.map((i) => `- ${i.status} ${i.id} ${i.title}. Done when: ${i.doneWhen} Proof: ${i.proof}.${i.needs.length ? " Needs: " + i.needs.join("; ") : ""}`),
  ];
  console.log(out.join("\n"));
  return 0;
}

// ---------------- main ----------------
export async function main() {
  if (has("--help") || has("-h") || !argv.length) { console.log(USAGE); return argv.length ? 0 : 2; }
  const modes = ["--init", "--access", "--access-set", "--check", "--status", "--task", "--record", "--block", "--unblock", "--config"].filter(has);
  if (modes.length !== 1) throw new Usage(`pick exactly one of --init --access --access-set --check --status --task --record --block --unblock --config\n${USAGE}`);
  const pewp = positionals()[0];
  if (!pewp) throw new Usage(`${modes[0]} needs <pewp> (the site-checks/<host>/.pewp folder)`);
  const P = path.resolve(pewp);
  switch (modes[0]) {
    case "--init": return cmdInit(P);
    case "--access": return cmdAccess(P);
    case "--access-set": return cmdAccessSet(P);
    case "--check": return await cmdCheck(P);
    case "--status": return cmdStatus(P);
    case "--task": return cmdTask(P);
    case "--record": return cmdRecord(P);
    case "--block": return cmdBlock(P);
    case "--unblock": return cmdUnblock(P);
    case "--config": return cmdConfig(P);
  }
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code ?? 0), (e) => {
    if (e instanceof Usage) { console.error(`usage error: ${e.message}`); process.exit(2); }
    console.error(`launch.mjs crashed: ${e.stack || e.message}`); process.exit(1);
  });
}
