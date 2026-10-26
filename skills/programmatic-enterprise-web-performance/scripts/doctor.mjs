// Usage: node doctor.mjs <target> [--cwd DIR] [--json] [--offline] [--env-file <path to a .env file>]
// (--dotenv <path> is the same option: Node 24 scans the whole command line for --env-file and exits 9 itself on a missing file, before this script runs)
// Keys are read from the process environment AND from a project .env file (--env-file, else `envFile` in <pewp>/state.json, else in
// ~/.claude/machine.local.json; scripts/lib-env.mjs). A name already set in the process environment is never overridden. The
// file is named by path only: no value is ever printed or written. doctor.json records `env` (file, names loaded, where the file
// came from), `setBy` per key-based source ("env file <path>" | "process environment" | "token file <path>") and `inputs` (sha1 of
// the env file, the Search Console token file and the service account file, "absent" when none) so a later stage can tell that
// this result is stale. Exit 2 = --env-file names a file that does not exist.
// Lists every FREE data source the skill can use (owner decision 2026-10-22: free only) as
//   connected | needs (the exact step to unblock it) | not available
// and writes <pewp>/doctor.json. A stage whose source is not connected reports that part BLOCKED; it never guesses.
// The claude-in-chrome browser (owner-supervised captures) can only be checked by the main session: listed as "main session".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { locate } from "./state.mjs";
import { CHROME_PATH } from "./cdp-measure.mjs";
import { defaultCache, cachedRelease } from "./authority.mjs";
import { whichExe } from "./lib-freshness.mjs";
import { loadEnv, envFileArg, EnvFileError } from "./lib-env.mjs";

const a = process.argv.slice(2);
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const target = a[0] && !a[0].startsWith("--") ? a[0] : null;
const offline = a.includes("--offline");
// The env file is loaded FIRST: every read below sees process.env with the file's names added (never overriding a name already set).
const loc = target ? locate(target, { cwd: opt("--cwd") || process.cwd() }) : null;
let envInfo;
try { envInfo = loadEnv({ envFile: envFileArg(a), pewp: loc?.pewp || null, cwd: process.cwd() }); }
catch (e) { if (e instanceof EnvFileError) { console.error(`usage error: ${e.message}`); process.exit(2); } throw e; }
const env = (k) => (process.env[k] && process.env[k].trim()) || null;
// Where a name's value came from (never the value): the env file that set it, or the process environment it was already in.
const setByOf = (k) => (envInfo.loaded.includes(k) ? `env file ${envInfo.file}` : env(k) ? "process environment" : null);
const sha1Of = (p) => { try { return p && fs.statSync(p).isFile() ? crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex") : "absent"; } catch { return "absent"; } };
const sources = [];
const add = (id, label, status, detail, unblock, usedBy, setBy = null) => sources.push({ id, label, status, detail, setBy: status === "connected" ? setBy : null, unblock: status === "connected" ? null : unblock, usedBy });

const nodeMajor = Number(process.versions.node.split(".")[0]);
add("node", "Node.js", nodeMajor >= 20 ? "connected" : "needs", `v${process.versions.node}`, "Install Node 20 or newer.", ["every script"]);
// Checked the way the workers start it (launch-workers.mjs, refactor.mjs): the executable found on PATH, no shell.
const claudeExe = whichExe("claude");
// (a .cmd shim cannot be started without cmd.exe: the worker supervisor starts it that way, so the check does too)
const cl = !claudeExe ? { status: null, stdout: "", stderr: "not found on PATH" }
  : /\.(cmd|bat)$/i.test(claudeExe) ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${claudeExe}" --version"`], { encoding: "utf8", timeout: 20000, windowsHide: true, windowsVerbatimArguments: true })
  : spawnSync(claudeExe, ["--version"], { encoding: "utf8", timeout: 20000, windowsHide: true });
add("claude-cli", "Claude CLI (headless check workers)", cl.status === 0 ? "connected" : "not available", (cl.error ? `${claudeExe}: ${cl.error.code || cl.error.message}` : (cl.stdout || cl.stderr || "").trim().split("\n")[0]).slice(0, 80), "Install Claude Code and make `claude` runnable from a terminal.", ["audit workers"]);
add("chrome", "Chrome or Edge (lab speed, rendered pages)", CHROME_PATH ? "connected" : "not available", CHROME_PATH || "none found", "Install Chrome, or set CHROME_PATH to chrome.exe / msedge.exe.", ["snapshot-site", "audit-live Q1", "speed"]);

const cache = defaultCache();
const rel = cachedRelease(cache);
let latest = null;
if (!offline) {
  try { const r = await fetch("https://index.commoncrawl.org/graphinfo.json", { signal: AbortSignal.timeout(10000) }); const j = await r.json(); latest = (Array.isArray(j) ? j : j.graphs || [])[0]?.id || null; } catch {}
}
add("commoncrawl-graph", "Common Crawl web graph (free backlinks and authority)", rel ? "connected" : "needs",
  rel ? `release ${rel} in ${cache}${latest && latest !== rel ? `; a newer release exists: ${latest}` : latest ? " (latest)" : ""}` : `no complete release in ${cache || "(no seoKitCache in machine.local.json)"}`,
  `Set "seoKitCache" in ~/.claude/machine.local.json, then run: node scripts/authority.mjs out.json --target <domain> --release ${latest || "<release>"} (downloads about 11 GB once).`, ["audit-live Q4", "research authority"]);

const gscFile = env("GSC_TOKEN_FILE") || path.join(os.homedir(), ".config", "pewp", "gsc-token.json");
// Search Console is connected by a service account (GSC_SERVICE_ACCOUNT_FILE = path to the JSON file that exists, or
// GSC_SERVICE_ACCOUNT_JSON_B64 = the file base64-encoded) or by the OAuth token file. The content of those is never read here, only hashed.
const saFile = env("GSC_SERVICE_ACCOUNT_FILE"), saFileOk = !!saFile && fs.existsSync(saFile) && fs.statSync(saFile).isFile(), saB64 = !!env("GSC_SERVICE_ACCOUNT_JSON_B64"), tokenOk = fs.existsSync(gscFile);
const gscVia = saFileOk ? "GSC_SERVICE_ACCOUNT_FILE" : saB64 ? "GSC_SERVICE_ACCOUNT_JSON_B64" : null;
add("search-console", "Google Search Console API (real queries, clicks, positions)", gscVia || tokenOk ? "connected" : "needs", gscVia ? "service account" : tokenOk ? gscFile : saFile ? "no token; GSC_SERVICE_ACCOUNT_FILE is set but that file does not exist" : "no token",
  "The site owner adds our Google account (or the service account's email) as a user of the Search Console property, then either set GSC_SERVICE_ACCOUNT_FILE to the service account's JSON key file (or GSC_SERVICE_ACCOUNT_JSON_B64), or save an OAuth token at ~/.config/pewp/gsc-token.json (or set GSC_TOKEN_FILE).", ["audit-live Q2", "research demand", "measure"],
  gscVia ? setByOf(gscVia) : `token file ${gscFile}`);
add("bing-webmaster", "Bing Webmaster Tools API (free key; keyword volumes)", env("BING_WEBMASTER_KEY") ? "connected" : "needs", env("BING_WEBMASTER_KEY") ? "key set" : "no key",
  "Verify the site in Bing Webmaster Tools, create an API key (Settings > API access), set BING_WEBMASTER_KEY (in the environment or in the .env file given with --env-file).", ["research demand", "measure"], setByOf("BING_WEBMASTER_KEY"));
add("crux", "Chrome UX Report API (free; real-visitor speed)", env("CRUX_API_KEY") ? "connected" : "needs", env("CRUX_API_KEY") ? "key set" : "no key",
  "Google Cloud console: enable 'Chrome UX Report API', create a free API key, set CRUX_API_KEY. Low-traffic sites may have no field data (a result, not a failure).", ["audit-live Q1 speed", "measure"], setByOf("CRUX_API_KEY"));
add("psi", "PageSpeed Insights API (free key; Google's own phone speed test, the trusted number when this machine is busy)", env("PSI_API_KEY") ? "connected" : "needs", env("PSI_API_KEY") ? "key set" : "no key",
  "Google Cloud console: enable 'PageSpeed Insights API', create a free API key, set PSI_API_KEY (in the environment or in the .env file given with --env-file).", ["psi.mjs", "audit-live Q1 speed", "report-live"], setByOf("PSI_API_KEY"));
add("gemini", "Gemini API free tier with Google Search grounding (AI citations)", env("GEMINI_API_KEY") ? "connected" : "needs", env("GEMINI_API_KEY") ? "key set" : "no key",
  "aistudio.google.com: create a free API key, set GEMINI_API_KEY.", ["audit-live Q5", "measure AI citations"], setByOf("GEMINI_API_KEY"));
add("keyword-planner", "Google Ads Keyword Planner export (free account; volume ranges)", "needs", "imported as a CSV file",
  "In Google Ads > Keyword Planner, export the keyword ideas as CSV and give the file path to the research stage.", ["research demand"]);
add("business-profile", "Business Profile data (owner's free API export or a dated manual capture)", "needs", "imported as a file",
  "The owner exports the Business Profile (categories, services, reviews) or the main session saves a dated capture of the public listing; give the file to local-profile.mjs.", ["local", "research", "measure"]);
add("map-pack-captures", "Google map-pack captures per city and device (owner-supervised)", "main session", "saved captures under <pewp>/captures/local/",
  "The main session captures the map pack for each service-area city at human pace and saves them; local-pack.mjs imports them.", ["local", "measure"]);
add("gemini-terms", "Gemini terms acknowledged for storing derived citation data", process.env.PEWP_GEMINI_TERMS_ACK === "1" ? "connected" : "needs", process.env.PEWP_GEMINI_TERMS_ACK === "1" ? "acknowledged" : "not acknowledged",
  "The owner confirms we may keep derived fields (cited domains, whether we are cited) from grounded Gemini answers; then set PEWP_GEMINI_TERMS_ACK=1 (or ai.geminiTermsAcknowledged in the measure config).", ["measure AI citations", "research AI citations"], setByOf("PEWP_GEMINI_TERMS_ACK"));
// G15: say which file set the acknowledgement and when (the env file's last-change time). The gate itself is unchanged: PEWP_GEMINI_TERMS_ACK === "1".
const termsSrc = sources[sources.length - 1];
if (termsSrc.status === "connected") {
  let at = null;
  if (envInfo.loaded.includes("PEWP_GEMINI_TERMS_ACK")) { try { at = fs.statSync(envInfo.file).mtime.toISOString(); } catch {} }
  termsSrc.setAt = at;
  termsSrc.detail = `acknowledged (set by ${termsSrc.setBy}${at ? `, file last changed ${at}` : ""})`;
}
add("local-grid", "Local grid captures (owner-supervised map-pack captures at grid points around each service-area city, mobile)", "main session", "captures/local/grid/*.json read by scripts/local-grid.mjs import; plan with scripts/local-grid.mjs plan", "Add the city centres (lat, lng, source, date) to captures/local/grid/cities.json, run local-grid.mjs plan, then capture requests.json at human pace (45 s apart, stop at the first robot check) with the browser's location override set to each point and the page footer confirming the place.", ["measure MSR-010", "local"]);
add("browser-capture", "Owner-supervised browser capture (Google results, People Also Ask, local pack, ChatGPT, Perplexity)", "main session", "checked by the main session (claude-in-chrome); human pace, stop at the first robot check",
  "The main session confirms the claude-in-chrome extension is connected and the owner is present.", ["research SERP", "audit-live Q3/Q5"]);
add("analytics", "Conversions (the owner's analytics export, e.g. GA4; no API)", "needs", "imported as a file",
  "The owner exports conversions per landing page as JSON [{ page, goal, conversions, start, end }] to <pewp>/captures/conversions.json (stages/measure.md); measure rule MSR-009 reads it.", ["measure MSR-009"]);

// G18: what this result was computed from. A later stage compares these with the current files; a difference = this result is stale.
// Hashes only: the content of an env, token or service account file is never stored.
const inputs = { envFileSha1: sha1Of(envInfo.file), tokenFileSha1: sha1Of(gscFile), serviceAccountFileSha1: sha1Of(saFileOk ? saFile : null) };
const doc = { checkedAt: new Date().toISOString(), policy: "free sources only (owner decision 2026-10-22)", env: { file: envInfo.file, loaded: envInfo.loaded, source: envInfo.source }, inputs, sources };
if (target) {
  // TR-210: each API source also reports its last successful call. The cache keeps only 2xx answers (cache.mjs), so the newest
  // cache file under <pewp>/cache/<source>/ is that call; no file = never called successfully for this target.
  const CACHE_OF = { "search-console": ["gsc", "gsc-inspect"], "bing-webmaster": ["bing"], crux: ["crux"] };
  for (const s of sources) if (CACHE_OF[s.id]) {
    const times = CACHE_OF[s.id].flatMap((d) => { try { const dir = path.join(loc.pewp, "cache", d); return fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtime.getTime()); } catch { return []; } });
    s.lastSuccessfulCall = times.length ? new Date(Math.max(...times)).toISOString() : null;
  }
  fs.mkdirSync(loc.pewp, { recursive: true });
  fs.writeFileSync(path.join(loc.pewp, "doctor.json"), JSON.stringify(doc, null, 1) + "\n");
  doc.file = path.join(loc.pewp, "doctor.json");
}
const envLine = envInfo.file ? `env: loaded ${envInfo.loaded.length} names from ${envInfo.file}${envInfo.skipped.length ? ` (${envInfo.skipped.length} already set in the process environment, kept)` : ""}` : "env: no env file";
if (a.includes("--json")) { console.error(envLine); console.log(JSON.stringify(doc, null, 1)); }
else {
  console.log(envLine);
  for (const s of sources) console.log(`${s.status.toUpperCase().padEnd(13)} ${s.label}: ${s.detail}${"lastSuccessfulCall" in s ? ` (last successful call for this target: ${s.lastSuccessfulCall || "none"})` : ""}${s.unblock ? `\n              -> ${s.unblock}` : ""}`);
  if (doc.file) console.log(`wrote ${doc.file}`);
}
