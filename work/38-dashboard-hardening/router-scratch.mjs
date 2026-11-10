// Proof that router-wiring.patch makes a thrown error in a route show src/ErrorScreen.tsx (work order 38, step 4).
//   node work/38-dashboard-hardening/router-scratch.mjs <scratch folder>      (the folder is emptied first; keep it outside the repo)
// It copies apps/dashboard twice into the scratch folder (node_modules is a junction to the real one), adds a route /boom whose component throws an error that carries a
// marker, applies router-wiring.patch to ONE of the copies (the other is the control), builds both with dummy public values (no key, nothing is called), serves each dist
// from a small static server with the single-page fallback, and opens /boom in the installed Microsoft Edge (as playwright.config.ts does).
// Control (no patch): the page shows the router's own error text, marker included. Patched: the plan sentence in the one h1, a Reload button, no marker and no stack on
// the page, no visible text under 14 px, the h1 in Poppins 600 with the face loaded (the checks of tests/styles.spec.ts), and Reload really reloads the page.
// Exit 0 = every assertion held. Writes nothing in the repo.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const APP = path.join(REPO, "apps", "dashboard");
const PATCH = path.join(HERE, "router-wiring.patch");
const scratch = process.argv[2] && path.resolve(process.argv[2]);
if (!scratch || scratch.startsWith(REPO)) { console.error("usage: node router-scratch.mjs <scratch folder outside the repo>"); process.exit(2); }
const MARKER = "marker-7f3a-secret-error-text";
const SENTENCE = "Something went wrong. Reload the page to try again.";

fs.rmSync(scratch, { recursive: true, force: true });
const make = (name, patched) => {
  const root = path.join(scratch, name);
  const app = path.join(root, "apps", "dashboard");
  fs.mkdirSync(app, { recursive: true });
  for (const f of ["src", "scripts", "index.html", "package.json", "tsconfig.json", "vite.config.ts"]) fs.cpSync(path.join(APP, f), path.join(app, f), { recursive: true });
  fs.symlinkSync(path.join(APP, "node_modules"), path.join(app, "node_modules"), "junction");
  if (patched) {
    const r = spawnSync("git", ["-c", "core.autocrlf=false", "apply", PATCH], { cwd: root, encoding: "utf8", timeout: 30000 });
    if (r.status !== 0) { console.error("git apply failed: " + (r.stderr || r.stdout)); process.exit(1); }
  }
  // the route that throws: inserted once, in front of the index route
  const rf = path.join(app, "src", "router.tsx");
  let t = fs.readFileSync(rf, "utf8").replace(/\r\n/g, "\n");
  const anchor = "const routeTree = rootRoute.addChildren([\n  indexRoute,";
  if (t.split(anchor).length !== 2) throw new Error("router.tsx: the routeTree anchor is not there exactly once");
  t = t.replace(anchor, `const boomRoute = createRoute({ getParentRoute: () => rootRoute, path: 'boom', component: () => { throw new Error('${MARKER} at C:\\\\app\\\\src\\\\Leads.tsx:12'); } });\n${anchor.replace("indexRoute,", "boomRoute,\n  indexRoute,")}`);
  fs.writeFileSync(rf, t);
  const dist = path.join(root, "dist");
  const b = spawnSync(process.execPath, [path.join(app, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", dist, "--emptyOutDir"], {
    cwd: app, encoding: "utf8", timeout: 240000, env: { ...process.env, VITE_SUPABASE_URL: "https://dummyref.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy" },
  });
  if (b.status !== 0) { console.error(`${name}: vite build failed\n${(b.stdout || "") + (b.stderr || "")}`.slice(-1500)); process.exit(1); }
  return dist;
};
const control = make("control", false);
const patched = make("patched", true);
console.log(`built: control (no patch) and patched (router-wiring.patch applied) in ${scratch}`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const serve = (dist) => new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    let p = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(dist) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    res.end(fs.readFileSync(p));
  });
  s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }));
});

const { chromium } = createRequire(path.join(APP, "package.json"))("@playwright/test");
const browser = await chromium.launch({ channel: "msedge", headless: true });
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ": " + String(detail).slice(0, 300)}`); };
try {
  for (const [name, dist] of [["control", control], ["patched", patched]]) {
    const srv = await serve(dist);
    for (const size of [{ w: 390, h: 844 }, { w: 1536, h: 730 }]) {
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
      const page = await ctx.newPage();
      const logs = [];
      page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
      await page.goto(`${srv.url}/boom`);
      await page.waitForSelector("main, pre, h1, body *", { timeout: 15000 });
      await page.waitForTimeout(800);
      const look = await page.evaluate(async () => {
        await document.fonts.ready;
        const sizes = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const text = (n.textContent || "").replace(/\s+/g, " ").trim(), el = n.parentElement;
          if (!text || !el) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1 || !el.checkVisibility({ visibilityProperty: true })) continue;
          sizes.push({ px: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName.toLowerCase(), text: text.slice(0, 40) });
        }
        const h1s = [...document.querySelectorAll("h1")];
        return {
          body: document.body.innerText, h1: h1s.map((h) => h.textContent), h1Font: h1s.map((h) => getComputedStyle(h).fontFamily), h1Weight: h1s.map((h) => getComputedStyle(h).fontWeight),
          poppins: [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Poppins" && f.status === "loaded" && f.weight === "600"),
          buttons: [...document.querySelectorAll("button")].map((b) => b.textContent), plans: [...document.querySelectorAll("[data-plan]")].map((e) => e.getAttribute("data-plan")), sizes,
        };
      });
      const tag = `${name} ${size.w}x${size.h}`;
      if (name === "control") {
        // the router's own screen: "Something went wrong!" and a "Show Error" button that reveals the thrown error's text; no h1, no plan ids, no Reload
        check(`${tag}: without the patch the router's own screen shows (no plan sentence, no DP-1.2s-12 or DP-1.2s-13, no Reload button; the toast container DP-1.2s-08 is on every screen)`, /Something went wrong!/.test(look.body) && look.h1.length === 0 && !look.plans.includes("DP-1.2s-12") && !look.plans.includes("DP-1.2s-13") && !look.buttons.includes("Reload"), JSON.stringify({ body: look.body, h1: look.h1, plans: look.plans, buttons: look.buttons }));
        await page.click("text=Show Error");
        check(`${tag}: without the patch one click on "Show Error" puts the thrown error's text on the page (what ErrorScreen never does)`, (await page.evaluate(() => document.body.innerText)).includes(MARKER));
      } else {
        check(`${tag}: the page shows the plan sentence in exactly one h1`, look.h1.length === 1 && look.h1[0] === SENTENCE, JSON.stringify(look.h1));
        check(`${tag}: one Reload button, and the elements carry DP-1.2s-12 and DP-1.2s-13`, look.buttons.length === 1 && look.buttons[0] === "Reload" && look.plans.includes("DP-1.2s-12") && look.plans.includes("DP-1.2s-13"), JSON.stringify([look.buttons, look.plans]));
        check(`${tag}: no error text, marker, path or stack on the page (SEC-007)`, !look.body.includes(MARKER) && !/\.tsx|Leads|at C:|Error:|stack/i.test(look.body), look.body);
        const small = look.sizes.filter((s) => s.px < 14).map((s) => `${s.px}px ${s.tag} "${s.text}"`);
        check(`${tag}: no visible text under 14 px (smallest ${Math.min(...look.sizes.map((s) => s.px))} px)`, small.length === 0 && look.sizes.length >= 2, small.join("; "));
        check(`${tag}: the h1 is Poppins, weight 600, and the Poppins 600 face is loaded`, look.h1Font.every((f) => /^"?Poppins"?(,|$)/.test(f)) && look.h1Weight.every((w) => w === "600") && look.poppins, JSON.stringify([look.h1Font, look.h1Weight, look.poppins]));
        await page.evaluate(() => { window.__marker = 1; });
        await Promise.all([page.waitForEvent("load"), page.click("button")]);
        await page.waitForSelector("h1");
        check(`${tag}: Reload reloads the page (a window marker set before the click is gone after it)`, (await page.evaluate(() => window.__marker)) === undefined && (await page.textContent("h1")) === SENTENCE);
        check(`${tag}: nothing else logged an error to the console but the thrown route error itself`, logs.every((l) => /marker-7f3a|Error|error/i.test(l)), logs.join(" | "));
      }
      await ctx.close();
    }
    srv.close();
  }
} finally { await browser.close(); }
console.log(failed ? `FAILED: ${failed} check(s)` : "OK: the patched router shows the error screen, the unpatched one shows the router's own error text");
process.exit(failed ? 1 : 0);
