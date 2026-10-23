// section-shots: one screenshot per top-level section (header, each <section>, footer) of a local HTML page, at a laptop viewport
// (default 1536x730, a real browser window on a 1536x864 laptop) and a phone (390x844). Used by the design stage
// (stages/design.md steps 6, 7): a section is judged from its own picture, because a full-page capture lies about fixed bars and
// pinned heroes and hides weak sections in a long scroll.
// Motion is settled before the shot: the page is opened with #still in the URL (the convention a comp implements: no reveal waits for
// a scroll, nothing pinned) and the browser is a Playwright one (navigator.webdriver is true, which the page may use as well).
// The page is served over http from a private static server on 127.0.0.1 (free port), rooted at --root.
// Playwright comes from the render-gate install named in ~/.claude/machine.local.json (renderGate); Chromium, else Chrome, else Edge.
//
// Usage: node section-shots.mjs --root <static server root> <page relative to the root>
//             [--w 1536 --h 730] [--phone-w 390 --phone-h 844] [--out <dir>] [--hash still|none|<name>] [--sections "<css selectors>"]
//   --root      folder served as the site root (required)
//   --w --h     laptop viewport (default 1536x730; also try 1366x650)
//   --out       default <page folder>/_shots/sections; file name <page>-<nn>-<section name>-<laptop|phone>.png
//   --hash      the URL fragment that settles the page (default still; none = no fragment)
//   --sections  comma list of selectors that count as a section (default: body > header, main > section, body > section, body > footer)
// Exit: 0 every section was captured, 1 no section found / a capture failed / the 150 s limit, 2 usage, 3 BLOCKED (no browser).
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { numArg } from "./lib-polite.mjs";
import { resolvePage, serve, urlFor, launch, opt, positionals, report } from "./lib-shots.mjs";

const VALUE_FLAGS = ["--root", "--w", "--h", "--phone-w", "--phone-h", "--out", "--hash", "--sections"];
const DEFAULT_SECTIONS = "body > header, main > section, body > section, body > footer";

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node section-shots.mjs --root <static server root> <page relative to the root> [--w 1536 --h 730] [--phone-w 390 --phone-h 844] [--out <dir>] [--hash still|none|<name>] [--sections \"<css selectors>\"]\nExit: 0 all sections captured, 1 none found or a capture failed, 2 usage, 3 BLOCKED (no browser).");
    return 0;
  }
  const { root, page } = resolvePage(opt(argv, "--root"), positionals(argv, VALUE_FLAGS)[0]);
  const num = (name, def) => numArg(name, opt(argv, name) ?? undefined, { def, min: 200, int: true });
  const vps = [["laptop", num("--w", 1536), num("--h", 730)], ["phone", num("--phone-w", 390), num("--phone-h", 844)]];
  const hash = opt(argv, "--hash") || "still";
  const selector = opt(argv, "--sections") || DEFAULT_SECTIONS;
  const out = path.resolve(opt(argv, "--out") || path.join(path.dirname(page), "_shots", "sections"));

  const kill = setTimeout(() => { console.error("FAIL: did not finish in 150 s"); process.exit(1); }, 150_000);
  let server, browser, bad = 0;
  try {
    ({ server } = await serve(root));
    const url = urlFor(server.address().port, root, page) + (hash === "none" ? "" : `#${hash}`);
    browser = await launch();
    fs.mkdirSync(out, { recursive: true });
    const base = path.basename(page, path.extname(page));
    for (const [vp, w, h] of vps) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      try {
        const p = await ctx.newPage();
        await p.goto(url, { waitUntil: "load", timeout: 30_000 });
        await p.waitForTimeout(1500);
        const n = await p.evaluate((sel) => document.querySelectorAll(sel).length, selector);
        if (!n) { bad++; console.log(`FAIL ${vp} ${w}x${h}: no element matches "${selector}"`); continue; }
        for (let i = 0; i < n; i++) {
          const el = p.locator(selector).nth(i);
          const name = (await el.evaluate((e) => (e.id || e.className || e.tagName).toString().split(" ")[0])).replace(/[^a-z0-9-]/gi, "") || "s";
          const file = path.join(out, `${base}-${String(i).padStart(2, "0")}-${name}-${vp}.png`);
          try { await el.screenshot({ path: file, timeout: 30_000 }); console.log(file.replace(/\\/g, "/")); }
          catch (e) { bad++; console.log(`FAIL ${vp} section ${i} ${name}: ${String(e).slice(0, 100)}`); }
        }
      } finally { await ctx.close(); }
    }
    console.log(bad ? `SECTION-SHOTS FAIL: ${bad} problem(s)` : "SECTION-SHOTS PASS");
    return bad ? 1 : 0;
  } finally {
    clearTimeout(kill);
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { process.exitCode = report(e); });
