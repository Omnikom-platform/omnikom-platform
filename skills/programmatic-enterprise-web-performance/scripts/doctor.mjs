// Usage: node doctor.mjs <target> [--cwd DIR] [--json] [--offline]
// Lists every FREE data source the skill can use (owner decision 2026-10-22: free only) as
//   connected | needs (the exact step to unblock it) | not available
// and writes <pewp>/doctor.json. A stage whose source is not connected reports that part BLOCKED; it never guesses.
// The claude-in-chrome browser (owner-supervised captures) can only be checked by the main session: listed as "main session".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { locate } from "./state.mjs";
import { CHROME_PATH } from "./cdp-measure.mjs";
import { defaultCache, cachedRelease } from "./authority.mjs";
import { whichExe } from "./lib-freshness.mjs";

const a = process.argv.slice(2);
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const target = a[0] && !a[0].startsWith("--") ? a[0] : null;
const offline = a.includes("--offline");
const env = (k) => (process.env[k] && process.env[k].trim()) || null;
const sources = [];
const add = (id, label, status, detail, unblock, usedBy) => sources.push({ id, label, status, detail, unblock: status === "connected" ? null : unblock, usedBy });

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
add("search-console", "Google Search Console API (real queries, clicks, positions)", fs.existsSync(gscFile) ? "connected" : "needs", fs.existsSync(gscFile) ? gscFile : "no token",
  "The site owner adds our Google account as a user of the Search Console property, then we save an OAuth token at ~/.config/pewp/gsc-token.json (or set GSC_TOKEN_FILE).", ["audit-live Q2", "research demand", "measure"]);
add("bing-webmaster", "Bing Webmaster Tools API (free key; keyword volumes)", env("BING_WEBMASTER_KEY") ? "connected" : "needs", env("BING_WEBMASTER_KEY") ? "key set" : "no key",
  "Verify the site in Bing Webmaster Tools, create an API key (Settings > API access), set BING_WEBMASTER_KEY.", ["research demand", "measure"]);
add("crux", "Chrome UX Report API (free; real-visitor speed)", env("CRUX_API_KEY") ? "connected" : "needs", env("CRUX_API_KEY") ? "key set" : "no key",
  "Google Cloud console: enable 'Chrome UX Report API', create a free API key, set CRUX_API_KEY. Low-traffic sites may have no field data (a result, not a failure).", ["audit-live Q1 speed", "measure"]);
add("gemini", "Gemini API free tier with Google Search grounding (AI citations)", env("GEMINI_API_KEY") ? "connected" : "needs", env("GEMINI_API_KEY") ? "key set" : "no key",
  "aistudio.google.com: create a free API key, set GEMINI_API_KEY.", ["audit-live Q5", "measure AI citations"]);
add("keyword-planner", "Google Ads Keyword Planner export (free account; volume ranges)", "needs", "imported as a CSV file",
  "In Google Ads > Keyword Planner, export the keyword ideas as CSV and give the file path to the research stage.", ["research demand"]);
add("business-profile", "Business Profile data (owner's free API export or a dated manual capture)", "needs", "imported as a file",
  "The owner exports the Business Profile (categories, services, reviews) or the main session saves a dated capture of the public listing; give the file to local-profile.mjs.", ["local", "research", "measure"]);
add("map-pack-captures", "Google map-pack captures per city and device (owner-supervised)", "main session", "saved captures under <pewp>/captures/local/",
  "The main session captures the map pack for each service-area city at human pace and saves them; local-pack.mjs imports them.", ["local", "measure"]);
add("gemini-terms", "Gemini terms acknowledged for storing derived citation data", process.env.PEWP_GEMINI_TERMS_ACK === "1" ? "connected" : "needs", process.env.PEWP_GEMINI_TERMS_ACK === "1" ? "acknowledged" : "not acknowledged",
  "The owner confirms we may keep derived fields (cited domains, whether we are cited) from grounded Gemini answers; then set PEWP_GEMINI_TERMS_ACK=1 (or ai.geminiTermsAcknowledged in the measure config).", ["measure AI citations", "research AI citations"]);
add("local-grid", "Local grid captures (owner-supervised map-pack captures at grid points around each service-area city, mobile)", "main session", "captures/local/grid/*.json read by scripts/local-grid.mjs import; plan with scripts/local-grid.mjs plan", "Add the city centres (lat, lng, source, date) to captures/local/grid/cities.json, run local-grid.mjs plan, then capture requests.json at human pace (45 s apart, stop at the first robot check) with the browser's location override set to each point and the page footer confirming the place.", ["measure MSR-010", "local"]);
add("browser-capture", "Owner-supervised browser capture (Google results, People Also Ask, local pack, ChatGPT, Perplexity)", "main session", "checked by the main session (claude-in-chrome); human pace, stop at the first robot check",
  "The main session confirms the claude-in-chrome extension is connected and the owner is present.", ["research SERP", "audit-live Q3/Q5"]);
add("analytics", "Conversions (the owner's analytics export, e.g. GA4; no API)", "needs", "imported as a file",
  "The owner exports conversions per landing page as JSON [{ page, goal, conversions, start, end }] to <pewp>/captures/conversions.json (stages/measure.md); measure rule MSR-009 reads it.", ["measure MSR-009"]);

const doc = { checkedAt: new Date().toISOString(), policy: "free sources only (owner decision 2026-10-22)", sources };
if (target) {
  const loc = locate(target, { cwd: opt("--cwd") || process.cwd() });
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
if (a.includes("--json")) console.log(JSON.stringify(doc, null, 1));
else {
  for (const s of sources) console.log(`${s.status.toUpperCase().padEnd(13)} ${s.label}: ${s.detail}${"lastSuccessfulCall" in s ? ` (last successful call for this target: ${s.lastSuccessfulCall || "none"})` : ""}${s.unblock ? `\n              -> ${s.unblock}` : ""}`);
  if (doc.file) console.log(`wrote ${doc.file}`);
}
