// US vantage (Sacramento) for human-pace Google and Bing captures. Work order 43.
// Why: this machine is in Egypt, so Google's web results and footer read Egypt. This script keeps ONE dedicated Edge profile
// ("omnikom-us-vantage", never the owner's own profile), tells the browser it is in Sacramento (CDP geolocation override plus
// the geolocation permission for google.com and bing.com), and proves it before any capture. It bypasses nothing: no sign-in,
// no CAPTCHA handling, one page at a time at human pace, a robot check stops the session for 24 h.
//
//   node vantage.mjs <start|status|stop|capture> [--json] [--pewp DIR] [--egress codespace] [--out FILE]
//   start [--egress codespace]   launch the profile, set the location, then verify (same checks as status)
//   status                       VERIFY: profile, geolocation read back, (tunnel and its exit region), Google home footer
//   stop                         close the browser (and the codespace if one runs); idempotent; prove both
//   capture <url> --out FILE     ONE page: refuses inside the 45 s gap and while the 24 h stop file exists
// Exit codes: 0 ok, 2 usage, 3 BLOCKED (start --egress codespace, capture), 4 SKIPPED (status and start not verified: no allowed US egress).
// State lives in ~/.claude/state/omnikom-us-vantage (VANTAGE_HOME overrides, tests do): state.json, blocked-until.json, the profile.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { spawnBrowser } from "./lib-browser-profile.mjs";
import { randomUUID } from "node:crypto";
import { isStopped, writeStop as writeStopFile } from "./lib-stops.mjs";
import { isMain } from "./lib-main.mjs";
import { fileURLToPath } from "node:url";

export const GEO = { lat: 38.5816, lon: -121.4944, accuracy: 100, label: "Sacramento, California" };
export const ORIGINS = ["https://www.google.com", "https://www.bing.com"];
export const PROFILE_NAME = "omnikom-us-vantage";
export const GAP_MS = 45_000; // Google, Bing
export const AI_GAP_MS = 60_000; // every other host: per host
export const SETTLE_QUIET_MS = 5000, SETTLE_CAP_MS = 90_000;
export const isAi = (engine) => ["chatgpt", "perplexity", "copilot"].includes(engine);
export const isSearch = (engine) => engine === "google" || engine === "bing";
export const gapFor = (engine) => (isSearch(engine) ? GAP_MS : AI_GAP_MS);
export const STOP_MS = 24 * 3600 * 1000;
export const GOOGLE_HOME = "https://www.google.com/?gl=us&hl=en";
export const IP_LOOKUP = "https://ipinfo.io/json";
const EDGE = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
  .filter(Boolean).find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Blocked extends Error {
  constructor(what, unblocks) { super(what); this.what = what; this.unblocks = unblocks; }
}

// ---------- paths and state ----------
export const homeDir = () => process.env.VANTAGE_HOME || path.join(os.homedir(), ".claude", "state", "omnikom-us-vantage");
export const profileDir = (home = homeDir()) => path.join(home, PROFILE_NAME);
const statePath = (home = homeDir()) => path.join(home, "state.json");
export const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n"); };
export const readState = (home) => readJson(statePath(home)) || {};
export const writeState = (s, home) => writeJson(statePath(home), s);

/** The profile must be our own folder: named omnikom-us-vantage and not inside any browser's own "User Data" tree. */
export function assertOwnProfile(dir) {
  const p = path.resolve(dir).replace(/\\/g, "/").toLowerCase();
  if (path.basename(p) !== PROFILE_NAME) throw new Error(`profile folder must be named ${PROFILE_NAME}: ${dir}`);
  if (/\/user data(\/|$)/.test(p) || /\/(microsoft\/edge|google\/chrome)\b/.test(p)) throw new Error(`refusing a browser's own profile tree: ${dir}`);
  return path.resolve(dir);
}

// ---------- pace and the 24 h stop ----------
/** Milliseconds still to wait before another page from this engine ("google" | "bing"), 0 when free. */
export function gapRemaining(state, engine, now = Date.now()) {
  const last = Number((state.last || {})[engine]) || 0;
  return Math.max(0, last + gapFor(engine) - now);
}
// Stops live in the shared format (lib-stops.mjs, ~/.claude/state/omnikom-stops/<engine>.json). The real home uses that folder; any other
// home (tests) keeps its stops in <home>/stops, so a test never touches a real stop.
const DEFAULT_HOME = path.join(os.homedir(), ".claude", "state", "omnikom-us-vantage");
const stopsFor = (home) => (process.env.OMNIKOM_STOPS_DIR || path.resolve(home) === path.resolve(DEFAULT_HOME) ? undefined : path.join(home, "stops"));
/** The active stop for one engine ("google" covers google.com and its subdomains, maps and the robot-check host), or null. */
export function activeStop(home, engine, now = Date.now()) {
  const s = isStopped(engine, now, stopsFor(home));
  return s ? { ...s, untilIso: s.until } : null;
}
/** A 24 h stop for one engine; never shortens a later one already on file. */
export function writeStop(home, engine, reason, url, now = Date.now()) {
  return writeStopFile({ engine, reason, setBy: "vantage.mjs", evidence: url, now, until: now + STOP_MS, dir: stopsFor(home) });
}
// The only hosts capture will load: the two search engines, the three AI engines, and the public review/social sites WO40 C reads signed out.
const HOSTS = [
  ["google", /(^|\.)google\.[a-z.]+$/i], ["bing", /(^|\.)bing\.com$/i], ["chatgpt", /(^|\.)chatgpt\.com$/i], ["perplexity", /(^|\.)perplexity\.ai$/i],
  ["copilot", /^copilot\.microsoft\.com$/i], ["linkedin", /(^|\.)linkedin\.com$/i], ["facebook", /(^|\.)(facebook|fb)\.com$/i], ["reddit", /(^|\.)reddit\.com$/i],
  ["bbb", /(^|\.)bbb\.org$/i], ["trustpilot", /(^|\.)trustpilot\.com$/i],
];
export const engineOf = (url) => { try { const h = new URL(url).hostname; return (HOSTS.find(([, re]) => re.test(h)) || [null])[0]; } catch { return null; } };

/**
 * Wait until a page's text has stopped changing: `readText()` is polled every pollMs; the text counts as settled once it has been
 * unchanged for quietMs AND `ready(text)` holds (an answer that has not started streaming is not settled), or capMs ends the wait.
 * now and sleep are injectable so a test can drive a fake page on a fake clock.
 */
export async function settle(readText, { quietMs = SETTLE_QUIET_MS, capMs = SETTLE_CAP_MS, pollMs = 1000, ready = () => true, now = Date.now, sleep: nap = sleep } = {}) {
  const start = now();
  let text = await readText(); let changedAt = now();
  for (;;) {
    const t = now();
    if (t - changedAt >= quietMs && ready(text)) return { text, settled: true, capped: false, waitedMs: t - start };
    if (t - start >= capMs) return { text, settled: false, capped: true, waitedMs: t - start };
    await nap(pollMs);
    const next = await readText();
    if (next !== text) { text = next; changedAt = now(); }
  }
}

// A wall on an AI engine page. Page-wide wording is read only when no answer showed (an answer may talk about CAPTCHAs or sign-in).
const WALL_HARD = /captcha|verify you are (a )?human|just a moment|checking your browser|unusual (traffic|activity)|are you a robot|attention required|access denied/i;
const WALL_SIGNIN = /(log in|sign in|sign up) to (continue|chat|see|get|use)|please (log|sign) in|you must (log|sign) in|create (a free )?account to continue|sign in or create an account|log in or sign up to continue/i;
export function aiWallReason(url, text, answerLen = 0) {
  let pathname = ""; try { pathname = new URL(url).pathname; } catch { /* unreadable */ }
  if (/\/sorry\//i.test(url)) return "robot check";
  if (/^\/(auth|login|signin|sign-in)(\/|$)/i.test(pathname)) return "redirected to a sign-in page";
  if (answerLen >= 40) return null;
  if (WALL_HARD.test(text)) return "bot wall or CAPTCHA";
  if (WALL_SIGNIN.test(text)) return "sign-in wall";
  return null;
}
// In-page read of an AI engine's answer and its cited links. The selectors are UNPROVEN until a live read: an empty answer is BLOCKED, never a guess.
export const READ_AI = (engine) => `(() => {
  const sels = ${JSON.stringify({ chatgpt: ['[data-message-author-role="assistant"]'], perplexity: ['[id^="markdown-content"]', "div.prose"], copilot: ['[data-content="ai-message"]', '[class*="ai-message"]'] })}[${JSON.stringify(engine)}];
  let els = []; for (const s of sels) { els = [...document.querySelectorAll(s)]; if (els.length) break; }
  const last = els[els.length - 1];
  const own = location.hostname.replace(/^www\\./, "");
  const scope = els.length ? els : [];
  const links = new Map();
  const grab = (root) => root.querySelectorAll("a[href^='http']").forEach((a) => { let h; try { h = new URL(a.href).hostname.replace(/^www\\./, ""); } catch { return; }
    if (h === own || h.endsWith("." + own) || /(^|\\.)(microsoft|bing|openai|cloudflare)\\.com$/.test(h)) return; if (!links.has(a.href)) links.set(a.href, (a.innerText || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 120)); });
  scope.forEach(grab);
  document.querySelectorAll('[class*="source" i], [data-testid*="source" i]').forEach(grab);
  return { answer: last ? last.innerText.replace(/[ \\t]+\\n/g, "\\n").trim() : "", matched: els.length, citations: [...links].slice(0, 40).map(([url, text]) => ({ url, text })), body: document.body ? document.body.innerText.slice(0, 1500) : "", url: location.href };
})()`;

// ---------- pure readers ----------
/** Does a footer text read Sacramento or California? */
export const footerIsSacramento = (t) => /sacramento|california/i.test(String(t || ""));
/** True when the read-back position is within ~0.01 degrees (~1 km) of Sacramento. */
export const geoReadsBack = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat - GEO.lat) < 0.01 && Math.abs(p.lon - GEO.lon) < 0.01;
/** West US: a California, Oregon, Washington or Nevada exit counts (a codespace "West US" region lands in Washington or California). */
export const WEST_US = /^(california|oregon|washington|nevada)$/i;

// ---------- CDP over the browser's own websocket ----------
export async function connect(port) {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(10_000) })).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("DevTools socket did not open in 10 s")), 10_000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error("DevTools socket failed")); }; });
  let id = 1; const pending = new Map(); const listeners = new Set(); let dead = null;
  ws.onmessage = (m) => {
    let msg; try { msg = JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString("utf8")); } catch { return; }
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
    else if (msg.method) for (const l of listeners) l(msg);
  };
  ws.onclose = () => { dead = "browser connection closed"; for (const [, p] of pending) p.rej(new Error(dead)); pending.clear(); };
  const send = (method, params = {}, sessionId, ms = 30_000) => new Promise((res, rej) => {
    if (dead) return rej(new Error(dead));
    const i = id++;
    const t = setTimeout(() => { pending.delete(i); rej(new Error(`browser did not answer ${method} in ${ms / 1000} s`)); }, ms);
    pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, listeners, version: ver.Browser, userAgent: ver["User-Agent"], close: () => { try { ws.close(); } catch { /* gone */ } } };
}

/** Open a tab, give it the Sacramento location, load `url`, wait for load. Returns { sessionId, targetId }. */
export async function openPage(cdp, url, extraOrigins = []) {
  await cdp.send("Browser.grantPermissions", { origins: [...ORIGINS, ...extraOrigins], permissions: ["geolocation"] });
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Emulation.setGeolocationOverride", { latitude: GEO.lat, longitude: GEO.lon, accuracy: GEO.accuracy }, sessionId);
  const loaded = new Promise((res) => {
    const l = (m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") { cdp.listeners.delete(l); res(true); } };
    cdp.listeners.add(l); setTimeout(() => { cdp.listeners.delete(l); res(false); }, 30_000);
  });
  await cdp.send("Page.navigate", { url }, sessionId);
  const ok = await loaded;
  await sleep(2000); // let the footer and late scripts settle
  return { sessionId, targetId, loaded: ok };
}
export const evalIn = async (cdp, sessionId, expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId, 20_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
export const closePage = async (cdp, targetId) => { try { await cdp.send("Target.closeTarget", { targetId }); } catch { /* already gone */ } };

const READ_GEO = `new Promise((r) => navigator.geolocation.getCurrentPosition(
  (p) => r({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
  (e) => r({ error: e.message }), { timeout: 8000, maximumAge: 0 }))`;
// Google home page footer: the country/location line and the "From your Internet address / Use precise location" row.
export const READ_FOOTER = `(() => { const q = (s) => document.querySelector(s); const t = (e) => e ? e.innerText.replace(/\\s+/g, " ").trim() : "";
  const f = t(q("#fbar")) || t(q(".fbar")) || t(q("[role='contentinfo']")) || t(q("footer")); return { footer: f.slice(0, 300), url: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0, 600) : "" }; })()`;
const ROBOT_RE = /unusual traffic|not a robot|captcha|verify you are (a )?human|before you continue to google|\/sorry\//i;
export const looksLikeRobotCheck = (url, text) => ROBOT_RE.test(`${url}\n${text}`);

// ---------- browser process ----------
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function answers(port) { try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) }); return true; } catch { return false; } }
/** The running vantage browser's port, or null. A recorded port that does not answer counts as not running. */
export async function runningPort(home) { const s = readState(home); return s.port && alive(s.pid) && await answers(s.port) ? s.port : null; }

export async function launchBrowser({ home, proxy }) {
  if (!EDGE) throw new Blocked("Microsoft Edge not found", "install Edge or set EDGE_PATH");
  const prof = assertOwnProfile(profileDir(home));
  fs.mkdirSync(prof, { recursive: true });
  try { fs.rmSync(path.join(prof, "DevToolsActivePort"), { force: true }); } catch { /* none */ }
  const args = ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check",
    "--disable-sync", "--disable-extensions", "--lang=en-US", "--window-size=1280,900", ...(proxy ? [`--proxy-server=${proxy}`] : []), "about:blank"];
  const child = spawnBrowser({ exe: EDGE, dir: prof, args, options: { detached: true, stdio: "ignore" } }); // seeds Local State first (a first start on a new profile probes the Windows account)
  child.on("error", () => {}); child.unref();
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await sleep(150); try { port = Number(fs.readFileSync(path.join(prof, "DevToolsActivePort"), "utf8").split("\n")[0].trim()) || null; } catch { /* not yet */ } }
  if (!port || !(await answers(port))) throw new Blocked("Edge did not open its DevTools port", "close other Edge windows using this profile and run start again");
  return { pid: child.pid, port, profile: prof };
}

export async function killBrowser(home) {
  const s = readState(home);
  const port = await runningPort(home);
  if (port) { try { const c = await connect(port); try { await c.send("Browser.close", {}, undefined, 5000); } catch { /* closing */ } c.close(); } catch { /* gone */ } await sleep(800); }
  if (s.pid && alive(s.pid)) { if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(s.pid)], { stdio: "ignore", timeout: 10_000, windowsHide: true }); else { try { process.kill(s.pid, "SIGKILL"); } catch { /* gone */ } } await sleep(500); }
  return { wasRunning: !!port || !!(s.pid && alive(s.pid)), stillRunning: !!(s.pid && alive(s.pid)) };
}

// ---------- status ----------
const check = (name, ok, detail) => ({ name, ok: !!ok, detail });
export const PROOF_MAX_MS = 12 * 3600 * 1000;
export const FOOTER_QUERY = "coffee";
export const FOOTER_URL = `https://www.google.com/search?q=${FOOTER_QUERY}&gl=us&hl=en`;

/** Why start's footer proof cannot be relied on now, or null when it can: it exists, passed, is from this browser session, is under 12 h old. */
export function footerProofReason(state, now = Date.now()) {
  const p = state.footerProof;
  if (!p) return "start has not read a Google results-page footer yet";
  if (!state.session || p.session !== state.session) return "the footer proof is from another browser session";
  if (!p.ok) return `the footer proof failed: ${p.why}`;
  if (!(now - Date.parse(p.at) <= PROOF_MAX_MS)) return "the footer proof is older than 12 hours";
  return null;
}
// The footer's place name is what comes before Google's own wording ("From your Internet address", "Using precise location", "Update location"...).
// UNPROVEN against a live results page: tonight's only live results page was a robot check. Tests use synthetic strings, labelled as such.
const FOOTER_WORDING = /\s*(?:[-–—·•|]\s*)?(?:From your Internet address|Based on your (?:past activity|places)|Using precise location|Use precise location|Update location|Learn more|Help\b|Send feedback|Privacy\b|Terms\b|Results are personalized)/i;
export function footerLocationOf(footer, body = "") {
  const text = String(footer || "").replace(/\s+/g, " ").trim();
  const m = FOOTER_WORDING.exec(text);
  const head = (m ? text.slice(0, m.index) : text).replace(/[-–—·•|]\s*$/, "").trim();
  return head && head.length <= 80 && /[A-Za-z]/.test(head) ? head : null;
}
/** Does a footer location read Sacramento or California? Anything else, Egypt included, or no line at all, is a failure with the text quoted. */
export function footerVerdict(location) {
  if (!location) return { ok: false, why: "no location line found in the Google footer" };
  if (footerIsSacramento(location)) return { ok: true, why: "" };
  return { ok: false, why: `the Google footer says "${location}", not Sacramento or California` };
}

/**
 * start's footer proof: ONE Google results page for a fixed neutral query, at the normal pace. Records footer text, the location line,
 * query, url and time under state.footerProof, tied to this browser session. A robot check writes the 24 h stop file.
 */
export async function footerProof(cdp, home, shotDir) {
  const wait = gapRemaining(readState(home), "google"); if (wait) await sleep(wait);
  const st = readState(home); st.last = { ...(st.last || {}), google: Date.now() }; writeState(st, home);
  const g = await openPage(cdp, FOOTER_URL);
  const f = await evalIn(cdp, g.sessionId, READ_FOOTER);
  const proof = { ok: false, at: new Date().toISOString(), session: readState(home).session, query: FOOTER_QUERY, url: f.url, footer: f.footer, footerLocation: null, why: "" };
  if (looksLikeRobotCheck(f.url, f.body)) { writeStop(home, "google", "robot check on the footer proof page", f.url); proof.why = "Google showed a robot check; stopped for 24 h"; }
  else { proof.footerLocation = footerLocationOf(f.footer, f.body); const v = footerVerdict(proof.footerLocation); proof.ok = v.ok; proof.why = v.why; }
  try {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, g.sessionId, 20_000);
    const dir = shotDir || home; fs.mkdirSync(dir, { recursive: true });
    proof.screenshot = path.join(dir, `footer-proof-${proof.at.replace(/[:.]/g, "-")}.png`);
    fs.writeFileSync(proof.screenshot, Buffer.from(shot.data, "base64"));
  } catch { /* the proof stands without it */ }
  await closePage(cdp, g.targetId);
  const s2 = readState(home); s2.footerProof = proof; writeState(s2, home);
  return proof;
}

/**
 * VERIFY the vantage. Loads NO Google page (seo run calls this on every run): it re-reads the geolocation, the exit IP (one polite lookup),
 * the tunnel when used, and that start's footer proof exists, is fresh and is from this browser session.
 */
export async function status({ home = homeDir() } = {}) {
  const checks = []; const out = { profile: null, geo: { lat: GEO.lat, lon: GEO.lon, label: GEO.label }, tunnel: null, footer: null, verifiedAt: new Date().toISOString(), checks };
  let prof = null;
  try { prof = assertOwnProfile(profileDir(home)); out.profile = prof; checks.push(check("profile", fs.existsSync(prof), fs.existsSync(prof) ? prof : `missing ${prof}`)); }
  catch (e) { checks.push(check("profile", false, e.message)); }
  const state = readState(home);
  const stop = activeStop(home, "google");
  if (stop) checks.push(check("google-not-stopped", false, `Google stopped until ${stop.untilIso}: ${stop.reason}`)); // reported, and the rest still runs: other hosts remain usable
  const port = await runningPort(home);
  checks.push(check("browser", !!port, port ? `DevTools on 127.0.0.1:${port}` : "no vantage browser running (run start)"));
  if (!port) return finish(out, home);
  const cdp = await connect(port);
  try {
    if (state.egress === "codespace") out.tunnel = { used: true, up: false, exitIp: null, region: null };
    // one polite lookup of the exit IP, made by the browser itself so it goes through the tunnel when there is one; the geolocation
    // read-back runs on the same page (its origin is granted the permission for that)
    const ip = await openPage(cdp, IP_LOOKUP, [new URL(IP_LOOKUP).origin]);
    let ipInfo = null;
    try { ipInfo = JSON.parse(await evalIn(cdp, ip.sessionId, "document.body.innerText")); } catch { /* unreadable */ }
    const geo = await evalIn(cdp, ip.sessionId, READ_GEO);
    await closePage(cdp, ip.targetId);
    out.egress = ipInfo ? { ip: ipInfo.ip, country: ipInfo.country, region: ipInfo.region, city: ipInfo.city } : null;
    checks.push(check("egress-ip", !!ipInfo, ipInfo ? `the browser's exit IP is in ${ipInfo.city}, ${ipInfo.region}, ${ipInfo.country} (what Google sees without a tunnel)` : "the IP lookup returned nothing"));
    checks.push(check("geolocation-override", geoReadsBack(geo), geo?.error ? `read-back failed: ${geo.error}` : `browser reads ${geo?.lat}, ${geo?.lon} (accuracy ${geo?.accuracy})`));
    if (out.tunnel) {
      out.tunnel.exitIp = ipInfo?.ip || null; out.tunnel.region = ipInfo?.region || null;
      out.tunnel.up = !!ipInfo;
      checks.push(check("tunnel", out.tunnel.up && ipInfo.country === "US" && WEST_US.test(ipInfo.region || ""), ipInfo ? `exit ${ipInfo.ip} ${ipInfo.city}, ${ipInfo.region}, ${ipInfo.country}` : "tunnel lookup failed"));
    }
    const why = footerProofReason(readState(home));
    const p = readState(home).footerProof;
    if (p) { out.footer = p.footer; out.footerLocation = p.footerLocation; out.query = p.query; out.url = p.url; out.at = p.at; }
    checks.push(check("footer-proof", !why, why || `start read "${p.footerLocation}" on the Google results page for "${p.query}" at ${p.at}`));
  } catch (e) { checks.push(check("verification", false, e.message)); }
  finally { cdp.close(); }
  return finish(out, home);
}
function finish(out, home = homeDir()) {
  out.ok = out.checks.every((c) => c.ok);
  // capture reads this: only a vantage that passed every check may take a page
  const st = readState(home);
  if (out.ok) st.verified = { ok: true, at: out.verifiedAt, egressCountry: out.egress?.country ?? null, footer: out.footer, footerLocation: out.footerLocation ?? null };
  else delete st.verified;
  if (fs.existsSync(home)) writeState(st, home);
  return out;
}

// ---------- commands ----------
export function parseArgs(argv) {
  const a = { cmd: argv[0], json: false, pewp: null, egress: null, out: null, url: null };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i];
    if (x === "--json") a.json = true;
    else if (x === "--pewp") a.pewp = rest[++i];
    else if (x === "--egress") a.egress = rest[++i];
    else if (x === "--out") a.out = rest[++i];
    else if (x === "--city") a.city = rest[++i];
    else if (x === "--settle") a.settle = true;
    else if (x === "--jobs") i++; // accepted and ignored: this script never runs jobs in parallel
    else if (x.startsWith("--")) a.bad = x;
    else if (!a.url) a.url = x;
    else a.bad = x;
  }
  return a;
}

const report = (a, o) => {
  if (a.json) console.log(JSON.stringify(o)); else for (const c of o.checks || []) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
};
async function cmdStatus(a) {
  const home = homeDir();
  const o = await status({ home });
  if (a.pewp) writeJson(path.join(a.pewp, "vantage.json"), { profile: o.profile, geo: o.geo, tunnel: o.tunnel, footer: o.footer, footerLocation: o.footerLocation ?? null, query: o.query ?? null, url: o.url ?? null, at: o.at ?? null, verifiedAt: o.verifiedAt, checks: o.checks });
  report(a, o);
  if (o.ok) return 0;
  console.log("SKIPPED: no allowed US egress");
  return 4;
}
export const CODESPACE_BLOCKED = "BLOCKED: --egress codespace is not built: GitHub's Codespaces terms (github/docs, fetched 2026-11-11) say \"Additionally, Codespaces should not be used for: ... Any other activity unrelated to the development or testing of the software project associated with the repository where GitHub Codespaces is initiated.\" | unblocks: a US egress we are permitted to use (the owner's own server or VPN)";
async function cmdStart(a) {
  const home = homeDir();
  if (a.egress && a.egress !== "codespace") return usage(`--egress takes "codespace", got "${a.egress}"`);
  if (a.egress === "codespace") { console.log(CODESPACE_BLOCKED); return 3; }
  let port = await runningPort(home);
  if (port) console.log(`already running on 127.0.0.1:${port}`);
  else {
    try {
      const b = await launchBrowser({ home });
      const s = readState(home); delete s.footerProof; delete s.verified;
      writeState({ ...s, pid: b.pid, port: b.port, startedAt: new Date().toISOString(), egress: "none", session: randomUUID() }, home);
      console.log(`started Edge profile ${b.profile}, DevTools 127.0.0.1:${b.port}`);
      port = b.port;
    } catch (e) { if (e instanceof Blocked) { console.log(`BLOCKED: ${e.what} | unblocks: ${e.unblocks}`); return 3; } throw e; }
  }
  // the footer proof: the one Google results page, only here (never in status), only when this session has no passing proof yet
  if (footerProofReason(readState(home))) {
    const stop = activeStop(home, "google");
    if (stop) console.log(`Google is stopped until ${stop.untilIso} (${stop.reason}): no footer proof now; the browser stays up for other hosts`);
    else {
      const cdp = await connect(port);
      try { const p = await footerProof(cdp, home, a.pewp || undefined); console.log(`footer proof: ${p.ok ? `Google's footer reads "${p.footerLocation}"` : p.why}${p.screenshot ? ` (screenshot ${p.screenshot})` : ""}`); }
      finally { cdp.close(); }
    }
  }
  return cmdStatus(a);
}
async function cmdStop(a) {
  const home = homeDir();
  const k = await killBrowser(home);
  const s = readState(home); delete s.pid; delete s.port; delete s.verified; delete s.footerProof; delete s.session; writeState(s, home);
  const o = { stopped: !k.stillRunning, wasRunning: k.wasRunning, checks: [check("browser-stopped", !k.stillRunning, k.wasRunning ? "browser closed" : "nothing was running")] };
  report(a, o);
  if (!o.stopped) { console.log("BLOCKED: the vantage browser is still running after stop | unblocks: close the Edge window titled omnikom-us-vantage by hand"); return 3; }
  if (!a.json) console.log(k.wasRunning ? "stopped" : "nothing was running");
  return 0;
}
// ---------- capture: ONE page the agent asked for ----------
/** The address with the vantage's locale parameters filled in when the agent left them out (Google gl/hl, Bing cc/setlang). */
export function withLocale(url) {
  const u = new URL(url); const e = engineOf(url);
  const set = (k, v) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v); };
  if (e === "google") { set("gl", "us"); set("hl", "en"); } else if (e === "bing") { set("cc", "US"); set("setlang", "en-US"); }
  return u.toString();
}
/** What every capture records about where it was taken. A Google capture also carries its own footer location, so it proves its own vantage. */
export function vantageRecord({ state, footer, url, now = new Date() }) {
  const u = new URL(url);
  return {
    method: state.egress === "codespace" ? "geolocation override (CDP, Sacramento) + codespace egress (West US)" : "geolocation override (CDP, Sacramento)",
    egressCountry: state.verified?.egressCountry ?? null, footer: footer ?? null, footerLocation: footer ? footerLocationOf(footer) : null,
    gl: u.searchParams.get("gl") || u.searchParams.get("cc") || null, hl: u.searchParams.get("hl") || u.searchParams.get("setlang") || null,
    date: now.toISOString(),
  };
}
/**
 * Why a capture may not start now, or null. Order: this engine's stop file, (Google and Bing only) no verified vantage, pace gap.
 * Other hosts need no Sacramento proof: they are read signed out, and a Google stop never blocks them.
 */
export function captureRefusal(home, engine, now = Date.now()) {
  const stop = activeStop(home, engine, now);
  if (stop) return new Blocked(`24 h stop in force for ${engine} until ${stop.untilIso} (${stop.reason})`, "wait for the stop to expire; do not retry before then");
  const st = readState(home);
  if (isSearch(engine) && (!st.verified || !st.verified.ok)) return new Blocked("the vantage is not verified", "node scripts/vantage.mjs start, until every status check passes");
  const wait = gapRemaining(st, engine, now);
  if (wait) return new Blocked(`${engine} gap: ${Math.ceil(wait / 1000)} s left of the ${gapFor(engine) / 1000} s between pages`, `ask again in ${Math.ceil(wait / 1000)} s`);
  return null;
}
// A wall on any other host (LinkedIn, Facebook, Reddit, BBB, Trustpilot). Only the top of the page is read for wording: an article may talk about CAPTCHAs.
const WALL_URL = /\/(authwall|login|signin|sign-in|checkpoint|uas\/login)(\/|\?|$)/i;
export function pageWallReason(url, text) {
  if (/\/sorry\//i.test(url)) return "robot check";
  try { const u = new URL(url); if (WALL_URL.test(u.pathname + u.search)) return "redirected to a sign-in page"; } catch { /* unreadable */ }
  if (WALL_HARD.test(String(text || "").slice(0, 1500))) return "bot wall or CAPTCHA";
  return null;
}
const READ_PAGE = `(() => { const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim(); const links = new Map();
  document.querySelectorAll("a[href^='http']").forEach((a) => { if (!links.has(a.href)) links.set(a.href, clean(a.innerText || a.getAttribute("aria-label")).slice(0, 120)); });
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } }).filter(Boolean);
  return { url: location.href, title: document.title, text: document.body ? document.body.innerText.slice(0, 300000) : "", links: [...links].slice(0, 400).map(([url, text]) => ({ url, text })), jsonLd: ld.slice(0, 20) }; })()`;
const slugOf = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "x";

async function cmdCapture(a) {
  const home = homeDir();
  if (!a.url || !a.out) return usage("capture needs <url> and --out FILE.json");
  const engine = engineOf(a.url);
  if (!engine) return usage("capture takes a google, bing, chatgpt.com, perplexity.ai, copilot.microsoft.com, linkedin.com, facebook.com, reddit.com, bbb.org or trustpilot.com address");
  if (!/\.json$/i.test(a.out)) return usage("--out must end in .json (the html and png go beside it)");
  const refusal = captureRefusal(home, engine);
  if (refusal) { console.log(`BLOCKED: ${refusal.what} | unblocks: ${refusal.unblocks}`); return 3; }
  const port = await runningPort(home);
  if (!port) { console.log("BLOCKED: no vantage browser running | unblocks: node vantage.mjs start"); return 3; }
  const url = withLocale(a.url);
  const query = new URL(url).searchParams.get("q");
  if ((isSearch(engine) || isAi(engine)) && !query) return usage("the address has no q= search");
  const st = readState(home); st.last = { ...(st.last || {}), [engine]: Date.now() }; writeState(st, home); // the attempt counts, loaded or not
  const cdp = await connect(port);
  let code = 0;
  const stopFor = (why, at) => writeStop(home, engine, why, at);
  try {
    const p = await openPage(cdp, url);
    const base = a.out.replace(/\.json$/i, "");
    fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
    // answers stream in: wait until the text has stopped changing (always for the AI engines, on request for every other host)
    let settled = null;
    if (a.settle || isAi(engine)) {
      const read = isAi(engine) ? async () => (await evalIn(cdp, p.sessionId, READ_AI(engine))).answer : () => evalIn(cdp, p.sessionId, "document.body ? document.body.innerText : ''");
      settled = await settle(read, { ready: isAi(engine) ? (t) => t.length >= 40 : () => true });
    }
    fs.writeFileSync(`${base}.html`, await evalIn(cdp, p.sessionId, "document.documentElement.outerHTML"));
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, p.sessionId, 20_000);
    fs.writeFileSync(`${base}.png`, Buffer.from(shot.data, "base64"));
    const f = await evalIn(cdp, p.sessionId, READ_FOOTER);
    const settleRec = settled && { settled: settled.settled, capped: settled.capped, waitedMs: settled.waitedMs, quietMs: SETTLE_QUIET_MS, capMs: SETTLE_CAP_MS };
    if (isAi(engine)) {
      const r = await evalIn(cdp, p.sessionId, READ_AI(engine));
      const wall = aiWallReason(r.url, r.body, r.answer.length);
      if (wall) { stopFor(`${wall} on ${engine}`, r.url); console.log(`BLOCKED: ${engine} ${wall} at ${r.url}; stopped for 24 h, evidence in ${base}.html | unblocks: wait 24 h; never sign in, solve or bypass it`); code = 3; }
      else if (!r.answer) { console.log(`BLOCKED: no ${engine} answer found (selectors matched ${r.matched} element(s); settle ${settled.capped ? "hit the 90 s cap" : "ended"}) | unblocks: read ${base}.html and fix READ_AI in vantage.mjs`); code = 3; }
      else {
        const vantage = vantageRecord({ state: readState(home), footer: null, url });
        const rec = { engine, question: query, prompt: query, model: null, capturedAt: new Date().toISOString(), browser: cdp.version, location: `not stated; signed out, ${vantage.method}`, answer: r.answer, sources: r.citations.map((c) => c.url), citations: r.citations, settle: settleRec, wall: null, vantage };
        fs.writeFileSync(a.out, JSON.stringify(rec, null, 2) + "\n");
        console.log(`saved ${a.out} | answer ${r.answer.length} chars | ${r.citations.length} cited links | settle ${settled.settled ? "settled" : "CAPPED (answer may be incomplete)"} after ${Math.round(settled.waitedMs / 1000)} s`);
      }
    } else if (!isSearch(engine)) {
      const r = await evalIn(cdp, p.sessionId, READ_PAGE);
      const wall = pageWallReason(r.url, r.text);
      if (wall) { stopFor(`${wall} on ${engine}`, r.url); console.log(`BLOCKED: ${engine} ${wall} at ${r.url}; stopped for 24 h, evidence in ${base}.html | unblocks: wait 24 h; never sign in, solve or bypass it`); code = 3; }
      else {
        const vantage = vantageRecord({ state: readState(home), footer: null, url });
        fs.writeFileSync(a.out, JSON.stringify({ engine, url: r.url, requestedUrl: a.url, title: r.title, capturedAt: new Date().toISOString(), browser: cdp.version, text: r.text, links: r.links, jsonLd: r.jsonLd, settle: settleRec, wall: null, vantage }, null, 2) + "\n");
        console.log(`saved ${a.out} | "${String(r.title).slice(0, 60)}" | ${r.text.length} chars | ${r.links.length} links${settled ? ` | settle ${settled.settled ? "settled" : "CAPPED"} after ${Math.round(settled.waitedMs / 1000)} s` : ""}`);
      }
    } else if (looksLikeRobotCheck(f.url, f.body)) {
      stopFor(`robot check on ${engine}`, f.url);
      console.log(`BLOCKED: ${engine} robot check at ${f.url}; stopped for 24 h, evidence in ${base}.html | unblocks: wait 24 h; never solve or bypass it`);
      code = 3;
    } else {
      await evalIn(cdp, p.sessionId, fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "serp-capture.js"), "utf8"));
      const raw = await evalIn(cdp, p.sessionId, `window.__pewpCapture(${JSON.stringify({ query, engine, requested: GEO.label, device: "desktop", post: false })})`);
      if (typeof raw !== "string" || raw.startsWith("ERROR")) { console.log(`BLOCKED: extractor refused the page (${String(raw).slice(0, 160)}) | unblocks: check ${base}.html and the engine's markup in serp-capture.js`); code = 3; }
      else {
        const cap = JSON.parse(raw);
        cap.vantage = vantageRecord({ state: readState(home), footer: cap.location?.footer, url });
        cap.location.method = `${cap.vantage.method}; ${cap.location.method}`;
        if (settleRec) cap.settle = settleRec;
        fs.writeFileSync(a.out, JSON.stringify(cap, null, 2) + "\n");
        if (cap.robotCheck) { stopFor(`robot check on ${engine}`, f.url); console.log(`BLOCKED: ${engine} robot check in the page; stopped for 24 h | unblocks: wait 24 h`); code = 3; }
        else {
          if (a.city && cap.localPack?.length) {
            fs.writeFileSync(`${base}.localpack.json`, JSON.stringify({ query, city: a.city, location: a.city, locationShown: cap.location.footer, device: cap.device, language: cap.language, capturedAt: cap.capturedAt, capturedIn: `omnikom-us-vantage, signed out, ${cap.vantage.method}`, vantage: cap.vantage, pack: cap.localPack.map((x, i) => ({ position: i + 1, name: x.name, rating: x.rating, reviews: x.reviews })) }, null, 2) + "\n");
          }
          console.log(`saved ${a.out} | ${cap.organic.length} results | local pack ${cap.localPack.length} | footer location "${cap.vantage.footerLocation ?? "none found"}" | vantage ${cap.vantage.method}`);
        }
      }
    }
    await closePage(cdp, p.targetId);
  } finally { cdp.close(); }
  return code;
}

function usage(msg) { console.error(`usage error: ${msg}\nnode vantage.mjs <start|status|stop|capture> [--json] [--pewp DIR] [--egress codespace] [--city CITY] [--settle] [--out FILE]`); return 2; }

export async function main(argv) {
  const a = parseArgs(argv);
  if (!["start", "status", "stop", "capture"].includes(a.cmd) || a.bad) return usage(a.bad ? `unknown argument ${a.bad}` : `unknown command ${a.cmd || "(none)"}`);
  if (a.cmd === "status") return cmdStatus(a);
  if (a.cmd === "start") return cmdStart(a);
  if (a.cmd === "stop") return cmdStop(a);
  return cmdCapture(a);
}
if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
