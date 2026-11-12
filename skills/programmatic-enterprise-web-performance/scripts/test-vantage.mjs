// Tests for vantage.mjs (work order 43). No network and no browser: pure functions and a temp VANTAGE_HOME.
// Run: node test-vantage.mjs   Mutants: node mutants-vantage.mjs (each patches a temp copy of vantage.mjs, must go red; VANTAGE_UNDER_TEST points here)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.env.VANTAGE_UNDER_TEST || path.join(here, "vantage.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "vantage-test-"));
process.env.VANTAGE_HOME = home;
const V = await import(pathToFileURL(target).href + `?t=${Date.now()}`);

let fails = 0, n = 0;
const pending = [];
const t = (name, fn) => { n++; pending.push((async () => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } })()); };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const throws = (fn, re) => { try { fn(); } catch (e) { if (!re.test(e.message)) throw new Error(`wrong error: ${e.message}`); return; } throw new Error("did not throw"); };

t("the profile folder is ours, under the vantage home", () => {
  eq(path.basename(V.profileDir()), "omnikom-us-vantage");
  eq(V.assertOwnProfile(V.profileDir()), path.resolve(V.profileDir()));
});
t("the profile is never the owner's default Edge or Chrome profile", () => {
  throws(() => V.assertOwnProfile("C:/Users/x/AppData/Local/Microsoft/Edge/User Data/Default"), /must be named|own profile/);
  throws(() => V.assertOwnProfile("C:/Users/x/AppData/Local/Microsoft/Edge/User Data/omnikom-us-vantage"), /own profile tree/);
  throws(() => V.assertOwnProfile("C:/Users/x/AppData/Local/Google/Chrome/omnikom-us-vantage"), /own profile tree/);
  throws(() => V.assertOwnProfile("D:/elsewhere/other-profile"), /must be named/);
});
t("gap refusal: 45 s between pages of one engine, the other engine is free", () => {
  const now = 1_000_000;
  const st = { last: { google: now - 10_000 } };
  eq(V.gapRemaining(st, "google", now), 35_000);
  eq(V.gapRemaining(st, "bing", now), 0);
  eq(V.gapRemaining(st, "google", now - 10_000 + 45_000), 0);
  eq(V.gapRemaining({}, "google", now), 0);
});
t("the stop file blocks for 24 h and then expires", () => {
  eq(V.activeStop(home, "google"), null);
  const now = Date.now();
  V.writeStop(home, "google", "robot check", "https://www.google.com/sorry/index", now);
  const s = V.activeStop(home, "google", now + 3600_000);
  eq(s && s.reason, "robot check");
  eq(V.activeStop(home, "google", now + 23 * 3600_000) !== null, true, "still active at 23 h");
  eq(V.activeStop(home, "google", now + 24 * 3600_000 + 1000), null, "expired after 24 h");
  fs.rmSync(path.join(home, "stops", "google.json"));
});
t("a robot-check page is recognised by address or text", () => {
  eq(V.looksLikeRobotCheck("https://www.google.com/sorry/index?continue=x", ""), true);
  eq(V.looksLikeRobotCheck("https://www.google.com/search?q=x", "Our systems have detected unusual traffic from your computer network"), true);
  eq(V.looksLikeRobotCheck("https://www.bing.com/search?q=x", "Please solve this CAPTCHA"), true);
  eq(V.looksLikeRobotCheck("https://www.google.com/search?q=business+loans", "Business loans - Sacramento"), false);
});
t("the footer reads Sacramento or California, never Egypt", () => {
  eq(V.footerIsSacramento("Sacramento, California From your Internet address"), true);
  eq(V.footerIsSacramento("Egypt Use precise location Learn more"), false);
  eq(V.footerIsSacramento(""), false);
  eq(V.footerIsSacramento(null), false);
});
t("the geolocation read-back must be Sacramento", () => {
  eq(V.geoReadsBack({ lat: 38.5816, lon: -121.4944, accuracy: 100 }), true);
  eq(V.geoReadsBack({ lat: 30.0444, lon: 31.2357 }), false, "Cairo");
  eq(V.geoReadsBack({ error: "denied" }), false);
  eq(V.geoReadsBack(null), false);
});
t("main exits 2 on a usage error and 4 while no browser runs (status)", () => {
  const r = spawnSync(process.execPath, [target, "frobnicate"], { encoding: "utf8", env: process.env, timeout: 30_000 });
  eq(r.status, 2);
  const r2 = spawnSync(process.execPath, [target, "status"], { encoding: "utf8", env: process.env, timeout: 60_000 });
  eq(r2.status, 4);
  eq(r2.stdout.trim().split("\n").pop(), "SKIPPED: no allowed US egress", "last line");
});
t("stop is idempotent: exit 0 when nothing runs, and status is 4 after it", () => {
  const r = spawnSync(process.execPath, [target, "stop"], { encoding: "utf8", env: process.env, timeout: 60_000 });
  eq(r.status, 0);
  eq(/nothing was running/.test(r.stdout), true);
  const r2 = spawnSync(process.execPath, [target, "status"], { encoding: "utf8", env: process.env, timeout: 60_000 });
  eq(r2.status, 4);
  eq(r2.stdout.trim().split("\n").pop(), "SKIPPED: no allowed US egress", "last line");
});

const cap = (h, ...args) => spawnSync(process.execPath, [target, "capture", ...args], { encoding: "utf8", env: { ...process.env, VANTAGE_HOME: h }, timeout: 60_000 });
// stops: { google: {...}, bing: {...} }, one file per engine
const tmpHome = (state, stops = {}) => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "vantage-cap-")); if (state) fs.writeFileSync(path.join(h, "state.json"), JSON.stringify(state)); for (const [e, s] of Object.entries(stops)) { fs.mkdirSync(path.join(h, "stops"), { recursive: true }); fs.writeFileSync(path.join(h, "stops", `${e}.json`), JSON.stringify({ engine: e, hosts: [`${e}.com`], ...s })); } return h; };
const STOP_G = { until: new Date(Date.now() + 3600_000).toISOString(), reason: "robot check on google", setBy: "test", setAt: new Date().toISOString(), evidence: null };
const lastLine = (r) => r.stdout.trim().split("\n").pop();
const G = "https://www.google.com/search?q=business+loans";
const verified = { verified: { ok: true, at: new Date().toISOString(), egressCountry: "EG" } };

t("capture usage: no address, a non-search host, a non-json out are exit 2", () => {
  const h = tmpHome(verified);
  eq(cap(h).status, 2); eq(cap(h, "https://example.com/?q=x", "--out", "x.json").status, 2); eq(cap(h, G, "--out", "x.txt").status, 2);
});
t("capture refuses inside the 45 s gap (exit 3) and names the wait", () => {
  const h = tmpHome({ ...verified, last: { google: Date.now() - 5000 } });
  const r = cap(h, G, "--out", path.join(h, "x.json"));
  eq(r.status, 3); eq(/gap: \d+ s left/.test(r.stdout), true, r.stdout); eq(/^BLOCKED: .* \| unblocks: .*/.test(lastLine(r)), true);
});
t("the gap is per engine: a Bing page is not refused for a Google page's gap (it reaches the browser check)", () => {
  const h = tmpHome({ ...verified, last: { google: Date.now() - 5000 } });
  const r = cap(h, "https://www.bing.com/search?q=business+loans", "--out", path.join(h, "x.json"));
  eq(r.status, 3); eq(/no vantage browser running/.test(r.stdout), true, r.stdout);
});
t("capture refuses while the 24 h stop file exists (exit 3), even with the gap clear", () => {
  const h = tmpHome(verified, { google: STOP_G });
  const r = cap(h, G, "--out", path.join(h, "x.json"));
  eq(r.status, 3); eq(/24 h stop in force for google/.test(r.stdout), true, r.stdout);
});
t("a Google stop refuses google.com and allows chatgpt.com (it reaches the browser check)", () => {
  const h = tmpHome(verified, { google: STOP_G });
  const g = cap(h, G, "--out", path.join(h, "g.json")), c = cap(h, "https://chatgpt.com/?q=business+loans", "--out", path.join(h, "c.json"));
  eq([g.status, /stop in force for google/.test(g.stdout)], [3, true]);
  eq([c.status, /stop in force/.test(c.stdout), /no vantage browser running/.test(c.stdout)], [3, false, true], c.stdout);
  eq(V.captureRefusal(h, "chatgpt"), null, "no refusal at all for chatgpt");
  eq(V.captureRefusal(h, "google") !== null, true);
});
t("a Bing stop does not block Google, and a Google stop does not block Bing", () => {
  const h = tmpHome(verified, { bing: STOP_G });
  eq(V.captureRefusal(h, "google"), null); eq(V.captureRefusal(h, "bing") !== null, true);
  const h2 = tmpHome(verified, { google: STOP_G });
  eq(V.captureRefusal(h2, "bing"), null);
});
t("hosts other than Google and Bing need no Sacramento proof, only the browser", () => {
  const h = tmpHome({});
  for (const e of ["chatgpt", "perplexity", "copilot", "linkedin", "facebook", "reddit", "bbb", "trustpilot"]) eq(V.captureRefusal(h, e), null, e);
  eq(V.captureRefusal(h, "google") !== null, true, "google still needs the verified vantage");
  eq(V.captureRefusal(h, "bing") !== null, true, "bing too");
});
t("capture refuses when the vantage is not verified (exit 3)", () => {
  const r = cap(tmpHome({}), G, "--out", "x.json");
  eq(r.status, 3); eq(/not verified/.test(r.stdout), true, r.stdout);
});
t("capture adds the locale parameters only when the agent left them out", () => {
  eq(V.withLocale("https://www.google.com/search?q=a"), "https://www.google.com/search?q=a&gl=us&hl=en");
  eq(V.withLocale("https://www.google.com/search?q=a&gl=ca&hl=fr"), "https://www.google.com/search?q=a&gl=ca&hl=fr");
  eq(V.withLocale("https://www.bing.com/search?q=a"), "https://www.bing.com/search?q=a&cc=US&setlang=en-US");
});
t("the capture shape records the vantage: method, egress country, footer, gl, hl, date", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  const r = V.vantageRecord({ state: { egress: "none", verified: { ok: true, egressCountry: "EG" } }, footer: "Sacramento, California", url: "https://www.google.com/search?q=a&gl=us&hl=en", now });
  eq(r, { method: "geolocation override (CDP, Sacramento)", egressCountry: "EG", footer: "Sacramento, California", footerLocation: "Sacramento, California", gl: "us", hl: "en", date: "2026-11-11T10:00:00.000Z" });
  const b = V.vantageRecord({ state: { egress: "codespace", verified: { ok: true, egressCountry: "US" } }, footer: "x", url: "https://www.bing.com/search?q=a&cc=US&setlang=en-US", now });
  eq([b.method.includes("codespace egress"), b.gl, b.hl, b.egressCountry], [true, "US", "en-US", "US"]);
});

// A fake page on a fake clock: its text changes at given times, then stops. No real waiting.
const fakePage = (script) => { let clock = 0; const text = () => { let cur = ""; for (const [at, t] of script) if (clock >= at) cur = t; return cur; }; return { now: () => clock, sleep: async (ms) => { clock += ms; }, read: async () => text(), clockNow: () => clock }; };

t("settle: text that changes and then stops is saved 5 s after the last change", async () => {
  const pg = fakePage([[0, "Thinking"], [2000, "Thinking. Business loans are"], [6000, "Business loans are funds a lender provides to a company."]]);
  const r = await V.settle(pg.read, { now: pg.now, sleep: pg.sleep });
  eq(r.text, "Business loans are funds a lender provides to a company.");
  eq([r.settled, r.capped, r.waitedMs], [true, false, 11000], "last change at 6 s + 5 s quiet");
});
t("settle: text that never stops changing ends at the 90 s cap, not settled", async () => {
  const script = []; for (let i = 0; i < 200; i++) script.push([i * 1000, `word ${i}`]);
  const pg = fakePage(script);
  const r = await V.settle(pg.read, { now: pg.now, sleep: pg.sleep });
  eq([r.settled, r.capped, r.waitedMs], [false, true, 90_000]);
});
t("settle: an answer that has not started streaming is not settled (ready gate)", async () => {
  const pg = fakePage([[0, ""], [12_000, "The answer begins here and goes on for a while."]]);
  const r = await V.settle(pg.read, { now: pg.now, sleep: pg.sleep, ready: (x) => x.length >= 40 });
  eq(r.text, "The answer begins here and goes on for a while.");
  eq([r.settled, r.waitedMs], [true, 17_000]);
});
t("settle: a text that never appears is capped, not called settled", async () => {
  const pg = fakePage([[0, ""]]);
  const r = await V.settle(pg.read, { now: pg.now, sleep: pg.sleep, ready: (x) => x.length >= 40 });
  eq([r.settled, r.capped, r.text], [false, true, ""]);
});
t("AI engines get a 60 s gap per host, Google and Bing keep 45 s", () => {
  const now = 1_000_000, st = { last: { chatgpt: now - 50_000, google: now - 50_000, perplexity: now - 10_000 } };
  eq(V.gapRemaining(st, "chatgpt", now), 10_000, "60 s");
  eq(V.gapRemaining(st, "google", now), 0, "45 s");
  eq(V.gapRemaining(st, "perplexity", now), 50_000);
  eq(V.gapRemaining(st, "copilot", now), 0, "another host is free");
});
t("the engine is read from the host: google, bing, chatgpt, perplexity, copilot", () => {
  eq(["https://www.google.com/search?q=a", "https://www.bing.com/search?q=a", "https://chatgpt.com/?q=a", "https://www.perplexity.ai/search?q=a", "https://copilot.microsoft.com/?q=a", "https://example.com/?q=a",
    "https://www.linkedin.com/company/x", "https://www.facebook.com/x", "https://www.reddit.com/r/x", "https://www.bbb.org/us/ca/x", "https://www.trustpilot.com/review/x", "https://maps.google.com/", "https://evil-google.com.example/"].map(V.engineOf),
  ["google", "bing", "chatgpt", "perplexity", "copilot", null, "linkedin", "facebook", "reddit", "bbb", "trustpilot", "google", null]);
});
t("a sign-in wall or CAPTCHA on an AI page is a wall; an answer that mentions them is not", () => {
  eq(V.aiWallReason("https://chatgpt.com/auth/login", "", 0), "redirected to a sign-in page");
  eq(V.aiWallReason("https://chatgpt.com/", "Log in or sign up to continue", 0), "sign-in wall");
  eq(V.aiWallReason("https://www.perplexity.ai/search?q=a", "Just a moment... Verify you are human", 0), "bot wall or CAPTCHA");
  eq(V.aiWallReason("https://copilot.microsoft.com/", "Please sign in", 0), "sign-in wall");
  eq(V.aiWallReason("https://chatgpt.com/", "Log in  Sign up  What can I help with?", 0), null, "buttons alone are not a wall");
  eq(V.aiWallReason("https://chatgpt.com/", "To solve a CAPTCHA you click the boxes. Sign in to continue is a common phrase.", 200), null, "an answer is not a wall");
});

// --- start's footer proof and the status that trusts it (work order 43, the head's design: status loads no Google page) ---
const NOWP = Date.parse("2026-11-11T10:00:00Z");
const goodProof = { ok: true, at: "2026-11-11T09:00:00.000Z", session: "s1", query: "coffee", footerLocation: "Sacramento, California" };
t("footer proof: usable only when it exists, passed, is from this session and is under 12 h old", () => {
  eq(V.footerProofReason({ session: "s1", footerProof: goodProof }, NOWP), null);
  eq(/has not read/.test(V.footerProofReason({ session: "s1" }, NOWP)), true, "none yet");
  eq(/another browser session/.test(V.footerProofReason({ session: "s2", footerProof: goodProof }, NOWP)), true, "other session");
  eq(/another browser session/.test(V.footerProofReason({ footerProof: goodProof }, NOWP)), true, "no session at all");
  eq(/failed: no location/.test(V.footerProofReason({ session: "s1", footerProof: { ...goodProof, ok: false, why: "no location line found" } }, NOWP)), true, "a failed proof");
  eq(/older than 12 hours/.test(V.footerProofReason({ session: "s1", footerProof: goodProof }, NOWP + 12 * 3600_000)), true, "just over 12 h");
  eq(V.footerProofReason({ session: "s1", footerProof: { ...goodProof, at: "2026-11-11T10:00:00.000Z" } }, NOWP + 12 * 3600_000), null, "exactly 12 h still holds");
});
t("footer verdict: Sacramento or California passes; Egypt, another city or nothing fails with the text quoted", () => {
  eq(V.footerVerdict("Sacramento, California").ok, true); eq(V.footerVerdict("Sacramento, CA").ok, true);
  const eg = V.footerVerdict("Egypt"); eq([eg.ok, /"Egypt"/.test(eg.why)], [false, true]);
  eq(V.footerVerdict("Giza, Giza Governorate").ok, false); eq(V.footerVerdict(null).ok, false); eq(/no location line/.test(V.footerVerdict(null).why), true);
});
t("footer location is the place name before Google's own wording (SYNTHETIC strings: no live results page was ever read)", () => {
  eq(V.footerLocationOf("Sacramento, California From your Internet address Use precise location Learn more Help Send feedback Privacy Terms"), "Sacramento, California");
  eq(V.footerLocationOf("Sacramento, California - Using precise location - Update location"), "Sacramento, California");
  eq(V.footerLocationOf("Egypt Based on your past activity Update location Help Privacy Terms"), "Egypt");
  eq(V.footerLocationOf("Results are personalized - Try without personalization Update location Help Send feedback Privacy Terms"), null, "no place named");
  eq(V.footerLocationOf("Advertising Business How Search works Build, create, and do more with AI tools from Google Privacy Terms Settings".repeat(2)), null, "the home page footer is not a location");
  eq(V.footerLocationOf(""), null);
});
t("start --egress codespace is BLOCKED with the quoted terms and what unblocks it (exit 3); a bad --egress is exit 2", () => {
  const h = tmpHome({});
  const r = spawnSync(process.execPath, [target, "start", "--egress", "codespace"], { encoding: "utf8", env: { ...process.env, VANTAGE_HOME: h }, timeout: 60_000 });
  eq(r.status, 3); eq(/unrelated to the development or testing of the software project/.test(r.stdout), true, r.stdout); eq(/\| unblocks: a US egress we are permitted to use/.test(lastLine(r)), true, lastLine(r));
  eq(spawnSync(process.execPath, [target, "start", "--egress", "vpn"], { encoding: "utf8", env: { ...process.env, VANTAGE_HOME: h }, timeout: 60_000 }).status, 2);
});
t("other hosts keep a 60 s gap each", () => {
  const now = 1_000_000, st = { last: { linkedin: now - 50_000, reddit: now - 70_000 } };
  eq([V.gapRemaining(st, "linkedin", now), V.gapRemaining(st, "reddit", now), V.gapRemaining(st, "bbb", now)], [10_000, 0, 0]);
});
t("a wall on another host: a sign-in redirect or a CAPTCHA at the top; a page that only mentions them is fine", () => {
  eq(V.pageWallReason("https://www.linkedin.com/authwall?trk=x", "Join LinkedIn"), "redirected to a sign-in page");
  eq(V.pageWallReason("https://www.facebook.com/login/?next=x", ""), "redirected to a sign-in page");
  eq(V.pageWallReason("https://www.reddit.com/r/x", "Verify you are human to continue"), "bot wall or CAPTCHA");
  eq(V.pageWallReason("https://www.trustpilot.com/review/x", "Reviews of Paragon. ".repeat(100) + "captcha"), null, "far down the page is not a wall");
  eq(V.pageWallReason("https://www.bbb.org/us/ca/sacramento/profile/x", "BBB Business Profile"), null);
});
t("a capture's own footer location is recorded for Google and absent for other hosts", () => {
  const g = V.vantageRecord({ state: {}, footer: "Sacramento, California From your Internet address Update location", url: "https://www.google.com/search?q=a&gl=us&hl=en" });
  eq(g.footerLocation, "Sacramento, California");
  eq(V.vantageRecord({ state: {}, footer: null, url: "https://chatgpt.com/?q=a" }).footerLocation, null);
});

await Promise.all(pending);
fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
