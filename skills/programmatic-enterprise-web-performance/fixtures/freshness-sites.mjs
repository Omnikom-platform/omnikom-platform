// Fixture generator for the rebuild-stability / fake-freshness rules (IDX-003, SE-004, AEO-012). Writes tiny sites, each its own git
// repo with a committed generator (build.mjs) and its committed output (dist/), so a rebuild rewrites tracked files:
//   clock-sitemap   sitemap <lastmod> = new Date() at build time on every URL           -> check-stability FAIL (IDX-003)
//   clock-seconds   the same, with whole seconds (two quick builds can share a second)  -> FAIL (the checker waits > 1 s)
//   clock-jsonld    JSON-LD dateModified (inside @graph) = the build clock; no lastmod    -> FAIL (AEO-012)
//   clock-meta      <meta property="article:modified_time"> = the build clock             -> FAIL
//   ledger          dates from a committed ledger.json (content dates)                    -> PASS
//   date-only       ledger dates written date-only (2026-10-01)                           -> FAIL (SE-004)
//   future          one ledger date in 2031                                               -> FAIL (SE-004 future)
//   no-tz           ledger dates without a timezone                                       -> FAIL (SE-004)
//   index           a sitemap index -> pages-sitemap.xml whose lastmod is the build clock -> FAIL (index followed on disk)
//   none            no sitemap, no date fields                                            -> PASS with a note
//   nondeterministic deterministic dates, plus a random build id in dist/build-id.txt    -> PASS with a WARN
// Usage: node fixtures/freshness-sites.mjs --out <dir> [--only name,name]    (prints one line per site: <name> <dir>)
// Import: makeFreshnessSites(outDir, names?) -> { name: dir }
import fs from "node:fs";
import { isMain } from "../scripts/lib-main.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PAGES = ["", "about/", "homes/", "sell/", "buy/", "contact/"];
const LEDGER = Object.fromEntries(PAGES.map((p, i) => [p, `2026-0${(i % 8) + 1}-1${i}T09:3${i}:00Z`]));
const head = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = (rel, s) => { const f = path.join(here, "dist", rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const PAGES = ${JSON.stringify(PAGES)};
const ORIGIN = "https://fixture.example/";
const page = (p, extraHead = "") => "<!doctype html><html lang=\\"en\\"><head><title>" + (p || "home") + "</title>" + extraHead + "</head><body><main><h1>" + (p || "home") + "</h1><p>Same words every build.</p></main></body></html>\\n";
const sitemap = (lm) => '<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n' + PAGES.map((p) => "  <url><loc>" + ORIGIN + p + "</loc>" + (lm ? "<lastmod>" + lm(p) + "</lastmod>" : "") + "</url>").join("\\n") + "\\n</urlset>\\n";
`;
const ledgerRead = `const ledger = JSON.parse(fs.readFileSync(path.join(here, "ledger.json"), "utf8"));\n`;
export const SITES = {
  "clock-sitemap": { build: `${head}const now = new Date().toISOString();\nfor (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap.xml", sitemap(() => now));\n` },
  // whole seconds only: two builds inside one second would look equal, so the checker must let the clock tick between them
  "clock-seconds": { build: `${head}const now = new Date().toISOString().replace(/\\.\\d+Z$/, "Z");\nfor (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap.xml", sitemap(() => now));\n` },
  "clock-jsonld": { build: `${head}for (const p of PAGES) out(p + "index.html", page(p, '<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "F" }, { "@type": "WebPage", name: p || "home", dateModified: new Date().toISOString() }] }) + "</script>"));\nout("sitemap.xml", sitemap(null));\n` },
  "clock-meta": { build: `${head}for (const p of PAGES) out(p + "index.html", page(p, '<meta property="article:modified_time" content="' + new Date().toISOString() + '">'));\n` },
  ledger: { ledger: LEDGER, build: `${head}${ledgerRead}for (const p of PAGES) out(p + "index.html", page(p, '<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", datePublished: ledger[p], dateModified: ledger[p] }) + "</script>"));\nout("sitemap.xml", sitemap((p) => ledger[p]));\n` },
  "date-only": { ledger: LEDGER, build: `${head}${ledgerRead}for (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap.xml", sitemap((p) => ledger[p].slice(0, 10)));\n` },
  future: { ledger: { ...LEDGER, "sell/": "2031-01-01T00:00:00Z" }, build: `${head}${ledgerRead}for (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap.xml", sitemap((p) => ledger[p]));\n` },
  "no-tz": { ledger: LEDGER, build: `${head}${ledgerRead}for (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap.xml", sitemap((p) => ledger[p].replace("Z", "")));\n` },
  index: { build: `${head}const now = new Date().toISOString();\nfor (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap_index.xml", '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>' + ORIGIN + 'maps/pages.xml</loc></sitemap></sitemapindex>\\n');\nout("maps/pages.xml", sitemap(() => now));\n` },
  none: { build: `${head}for (const p of PAGES) out(p + "index.html", page(p));\n` },
  nondeterministic: { ledger: LEDGER, build: `${head}${ledgerRead}for (const p of PAGES) out(p + "index.html", page(p));\nout("sitemap.xml", sitemap((p) => ledger[p]));\nout("build-id.txt", Math.random().toString(36).slice(2) + "\\n");\n` },
};

const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", timeout: 60_000 });
export function makeFreshnessSites(outDir, names = Object.keys(SITES)) {
  const made = {};
  for (const name of names) {
    const s = SITES[name];
    if (!s) throw new Error(`unknown freshness fixture ${name}`);
    const dir = path.join(outDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "build.mjs"), s.build);
    if (s.ledger) fs.writeFileSync(path.join(dir, "ledger.json"), JSON.stringify(s.ledger, null, 1) + "\n");
    const b = spawnSync(process.execPath, ["build.mjs"], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    if (b.status) throw new Error(`fixture ${name}: build failed ${b.stderr}`);
    git(outDir, "init", "-q", "-b", "main", dir);
    git(dir, "add", "-A");
    const c = git(dir, "-c", "user.name=fixture", "-c", "user.email=f@localhost", "commit", "-q", "-m", "fixture");
    if (c.status) throw new Error(`fixture ${name}: commit failed ${c.stderr}`);
    made[name] = dir;
  }
  return made;
}

if (isMain(import.meta.url)) { // lib-main.mjs: real paths, junction/symlink safe
  const a = process.argv.slice(2);
  const out = a.includes("--out") ? path.resolve(a[a.indexOf("--out") + 1]) : null;
  if (!out) { console.error("usage: node freshness-sites.mjs --out <dir> [--only a,b]"); process.exit(2); }
  const only = a.includes("--only") ? a[a.indexOf("--only") + 1].split(",") : undefined;
  for (const [n, d] of Object.entries(makeFreshnessSites(out, only))) console.log(`${n} ${d}`);
}
