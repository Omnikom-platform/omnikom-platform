// Diagnostic (work order 38): why does owner-a's Leads list come back empty on the DEPLOYED origin (flows tests 2 and 20)? Read-only: opens /w/test-demo-a/leads as owner-a
// with the storage state that tools/audit/dashboard-csp/global-setup.ts wrote, and prints (1) whether the CSP guard's mechanism sees an event (one deliberate inline style is
// injected first: a report-only violation must fire), (2) every request to the supabase host with its status and size, no body text, (3) console errors, (4) the page's counts.
//   node tools/with-env.mjs <env file> -- node work/38-dashboard-hardening/leads-probe.mjs [origin]      (run it under heavy.mjs: it opens Edge)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..", "apps", "dashboard");
const origin = process.argv[2] || "https://omnikom-app-staging.pages.dev";
const state = path.join(APP, ".auth", "owner-a.json");
if (!fs.existsSync(state)) { console.error(`no ${state}: run the flows wrapper once so global-setup writes the logins`); process.exit(2); }
const { chromium } = createRequire(path.join(APP, "package.json"))("@playwright/test");
const browser = await chromium.launch({ channel: "msedge", headless: true, timeout: 60000 });
const ctx = await browser.newContext({ storageState: state, viewport: { width: 1536, height: 730 } });
const page = await ctx.newPage();
const csp = [], reqs = [], errors = [];
await ctx.exposeFunction("__csp", (l) => csp.push(l));
await ctx.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => window.__csp(`${e.disposition} ${e.violatedDirective}: blocked ${e.blockedURI || "(inline)"}`)));
page.on("console", (m) => { if (m.type() === "error" || /Content[- ]Security|violates/i.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 250)}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 250)}`));
page.on("response", async (r) => {
  const u = new URL(r.url());
  if (!u.hostname.endsWith(".supabase.co")) return;
  let size = "?"; try { size = String((await r.body()).length); } catch { /* streamed or gone */ }
  reqs.push(`${r.request().method()} ${r.status()} ${u.pathname}${u.search ? "?" + decodeURIComponent(u.search.slice(1)).slice(0, 400) : ""} (${size} bytes)`);
});
try {
  await page.goto(`${origin}/w/test-demo-a/leads`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("h1", { timeout: 20000 });
  await page.waitForTimeout(6000);
  // the guard's own mechanism: an inline style element is a style-src violation, reported (not blocked) under report-only
  await page.evaluate(() => { const s = document.createElement("style"); s.textContent = "body{outline:0}"; document.head.appendChild(s); });
  await page.waitForTimeout(500);
  const counts = await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].map((r) => (r.getAttribute("aria-label") || r.parentElement?.textContent || "").replace(/\s+/g, " ").trim()).join(" | "));
  const rows = await page.locator("tbody tr").count();
  console.log(`url ${page.url()}`);
  console.log(`radio labels: ${counts}`);
  console.log(`table rows: ${rows}`);
  console.log(`csp events seen by the guard's mechanism (${csp.length}): ${csp.join(" ; ") || "none"}`);
  console.log(`supabase requests (${reqs.length}):\n  ${reqs.join("\n  ")}`);
  console.log(`console errors / page errors (${errors.length}):\n  ${errors.join("\n  ") || "none"}`);
} finally { await browser.close(); }
