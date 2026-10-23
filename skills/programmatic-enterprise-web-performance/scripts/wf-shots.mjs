// wf-shots: render check + full-page screenshots of one local HTML page (a wireframe, a comp, a built page) at several viewports.
// Reports console/page errors and horizontal overflow per viewport and writes full-page PNGs. Used by the design stage
// (stages/design.md steps 2, 4, 5): every wireframe gets ONE of these checks and at most one fix.
// The page is served over http from a private static server on 127.0.0.1 (free port), rooted at --root, so relative asset paths work.
// Playwright comes from the render-gate install named in ~/.claude/machine.local.json (renderGate); Chromium, else Chrome, else Edge.
//
// Usage: node wf-shots.mjs --root <static server root> <page relative to the root>
//             [--viewports 1440x900,768x1024,390x844] [--out <dir>] [--motion reduce|on]
//   --root       folder served as the site root (required); the page is a path inside it, e.g. design/directions/d1.html
//   --viewports  comma list of WIDTHxHEIGHT (default desktop 1440x900, tablet 768x1024, phone 390x844). For the sizing check
//                (stages/design.md step 5) use 1366x650,1536x730,390x844
//   --out        where the PNGs go (default <page folder>/_shots); file name <page>-<w>x<h>.png
//   --motion     reduce (default): the page sees prefers-reduced-motion, so it renders its settled state;
//                on: prefers-reduced-motion is "no-preference" (use this to test the motion itself)
// Exit: 0 every viewport has 0 errors and 0 overflow, 1 an error / overflow / the 120 s limit, 2 usage, 3 BLOCKED (no browser).
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { resolvePage, serve, urlFor, launch, opt, positionals, report, UsageError } from "./lib-shots.mjs";

const VALUE_FLAGS = ["--root", "--viewports", "--out", "--motion"];
const DEFAULT_VPS = "1440x900,768x1024,390x844";

function parseViewports(raw) {
  return raw.split(",").map((v) => {
    const m = /^(\d{2,5})x(\d{2,5})$/.exec(v.trim());
    if (!m) throw new UsageError(`--viewports entry "${v}" is not WIDTHxHEIGHT`);
    return [Number(m[1]), Number(m[2])];
  });
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node wf-shots.mjs --root <static server root> <page relative to the root> [--viewports 1440x900,768x1024,390x844] [--out <dir>] [--motion reduce|on]\nExit: 0 clean, 1 error or overflow, 2 usage, 3 BLOCKED (no browser).");
    return 0;
  }
  const { root, page } = resolvePage(opt(argv, "--root"), positionals(argv, VALUE_FLAGS)[0]);
  const vps = parseViewports(opt(argv, "--viewports") || DEFAULT_VPS);
  const motion = opt(argv, "--motion") || "reduce";
  if (motion !== "reduce" && motion !== "on") throw new UsageError(`--motion must be reduce or on (got "${motion}")`);
  const outDir = path.resolve(opt(argv, "--out") || path.join(path.dirname(page), "_shots"));

  const kill = setTimeout(() => { console.error("FAIL: did not finish in 120 s"); process.exit(1); }, 120_000);
  let server, browser, bad = 0;
  try {
    ({ server } = await serve(root));
    const url = urlFor(server.address().port, root, page);
    browser = await launch();
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.basename(page, path.extname(page));
    for (const [width, height] of vps) {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: motion === "on" ? "no-preference" : "reduce" });
      try {
        const p = await ctx.newPage();
        const errs = [];
        p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
        p.on("pageerror", (e) => errs.push(String(e)));
        await p.goto(url, { waitUntil: "load", timeout: 30_000 });
        await p.waitForTimeout(400);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const shot = path.join(outDir, `${base}-${width}x${height}.png`);
        await p.screenshot({ path: shot, fullPage: true, timeout: 30_000 });
        const ok = !errs.length && over <= 0;
        if (!ok) bad++;
        console.log(`${ok ? "OK  " : "FAIL"} ${width}x${height}: errors ${errs.length}${errs.length ? " (" + errs[0].slice(0, 120) + ")" : ""}, horizontal overflow ${Math.max(0, over)}px -> ${shot.replace(/\\/g, "/")}`);
      } finally { await ctx.close(); }
    }
    console.log(bad ? `WF-SHOTS FAIL: ${bad} of ${vps.length} viewports` : `WF-SHOTS PASS: ${vps.length} of ${vps.length} viewports`);
    return bad ? 1 : 0;
  } finally {
    clearTimeout(kill);
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { process.exitCode = report(e); });
