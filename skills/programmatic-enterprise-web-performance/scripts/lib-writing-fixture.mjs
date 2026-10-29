// A small site that obeys all 7 rules of the writing gate (writing-gate.mjs), written to a folder, and a static server for it that
// applies the Cloudflare `_headers` file. Used only by test-writing-gate.mjs. Every file is invented (Fixture Realty).
// Usage: import { writeGoodSite, serveSite, patchFile } from "./lib-writing-fixture.mjs";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

// a valid 1x1 PNG: the image files only need to decode; the layout comes from the CSS
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const CRITICAL = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1a1a1a}.top{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#f4f1ea}.menu{font:inherit;padding:6px 12px}.nav{display:none}.nav.open{display:block}.nav a{margin-right:12px}@media(min-width:1000px){.nav{display:block}.menu{display:none}}.hero{padding:16px}.hero h1{margin:0 0 12px;font-size:28px}.hero-img{display:block;width:100%;max-width:520px;height:auto}`;
const REST = `.card{padding:16px}.card h2{font-size:22px;margin:0 0 8px}.card-img{display:block;width:300px;height:auto}.f{display:flex;flex-wrap:wrap;gap:8px;padding:16px}.f label{width:100%;font-weight:600}.f input{flex:1 1 200px;padding:8px;border:1px solid #888}.f button{padding:8px 16px;font:inherit}.foot{padding:16px;background:#f4f1ea;font-size:14px}`;
const SITE_JS = `(function () {
  var btn = document.querySelector("button.menu"), nav = document.getElementById("nav");
  btn.addEventListener("click", function () {
    var open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("open", !open);
  });
})();
`;

export const PAGES = {
  "/": ["Homes in Testville | Fixture Realty", "Homes in Testville"],
  "/about/": ["About Fixture Realty", "About Fixture Realty"],
  "/blog/post-1/": ["Selling in Testville: post one", "Selling in Testville, part one"],
  "/blog/post-2/": ["Selling in Testville: post two", "Selling in Testville, part two"],
};

export const pageHtml = (p, title, h1, base = "https://fixture-realty.test") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="canonical" href="${base}${p}">
<style>${CRITICAL}</style>
<link rel="stylesheet" href="/assets/rest.css" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="/assets/rest.css"></noscript>
</head><body>
<header class="top"><button class="menu" type="button" aria-expanded="false" aria-controls="nav">Menu</button><nav id="nav" class="nav" aria-label="Main"><a href="/">Home</a><a href="/about/">About</a><a href="/blog/post-1/">Blog</a></nav></header>
<main><section class="hero"><h1>${h1}</h1>
<img class="hero-img" src="/assets/img/hero-960.png" srcset="/assets/img/hero-480.png 480w, /assets/img/hero-960.png 960w, /assets/img/hero-1800.png 1800w" sizes="(min-width: 1000px) 520px, 100vw" width="1800" height="1200" alt="A house with a porch"></section>
<section class="card"><h2>Our team</h2><img class="card-img" src="/assets/img/card-300.png" srcset="/assets/img/card-300.png 300w, /assets/img/card-600.png 600w" sizes="300px" width="300" height="300" alt="The Fixture Realty team"></section>
<div role="tabpanel" id="p1"><form class="f" action="/connect" method="get"><label for="q">Where do you want to live?</label><input id="q" name="q" type="text"><button type="submit">Find homes</button></form></div>
</main><footer class="foot">Fixture Realty, an invented business for tests.</footer>
<script src="/assets/site.js" defer></script></body></html>
`;

export const LLMS = `# Fixture Realty

> Facts about Fixture Realty, an invented real estate team, for AI assistants.

## Pages
- [Home](/): what the team does
- [About](/about/): who the team is
- [Selling in Testville](/blog/post-1/): a guide for sellers
`;
export const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
`;

const w = (dir, rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
export function writeGoodSite(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [p, [title, h1]] of Object.entries(PAGES)) w(dir, p.replace(/^\//, "") + "index.html", pageHtml(p, title, h1));
  w(dir, "assets/rest.css", REST);
  w(dir, "assets/site.js", SITE_JS);
  for (const n of ["hero-480", "hero-960", "hero-1800", "card-300", "card-600"]) w(dir, `assets/img/${n}.png`, PNG);
  w(dir, "llms.txt", LLMS);
  w(dir, "_headers", HEADERS);
  return dir;
}
// edit one file of a copy; the patch must apply exactly `times` times (a patch that finds nothing would leave a mutant green by accident)
export function patchFile(dir, rel, from, to, times = 1) {
  const f = path.join(dir, rel), src = fs.readFileSync(f, "utf8"), n = src.split(from).length - 1;
  if (n !== times) throw new Error(`patch target found ${n} time(s), wanted ${times}, in ${rel}: ${String(from).slice(0, 70)}`);
  fs.writeFileSync(f, src.split(from).join(to));
}
// every page of the fixture: the same patch on each
export function patchPages(dir, from, to) {
  for (const p of Object.keys(PAGES)) patchFile(dir, p.replace(/^\//, "") + "index.html", from, to);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
// -> { server, base }: serves dir on 127.0.0.1 with the `/*` headers of its _headers file; `drop` names headers to leave out (a live
// response that differs from the file)
export async function serveSite(dir, { drop = [] } = {}) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const hdr = {};
    const hf = path.join(dir, "_headers");
    if (fs.existsSync(hf)) for (const line of fs.readFileSync(hf, "utf8").split(/\r?\n/)) { const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/); if (m && !drop.map((d) => d.toLowerCase()).includes(m[1].toLowerCase())) hdr[m[1]] = m[2]; }
    const file = path.resolve(dir, "." + (p.endsWith("/") ? p + "index.html" : p));
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", ...hdr });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
