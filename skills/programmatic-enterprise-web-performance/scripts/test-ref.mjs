// Usage: node test-ref.mjs [--scripts <dir>] [--only png|V|S|I|M|R] [--no-mutants] [--mutant <name part>] [--keep]
// Proof of the REF checks that start/refactor/migrate use:
//   REF-009 visual equivalence (ref-visual.mjs: PNG codec, pixelmatch-semantics diff, route groups, real Chrome screenshots, and the
//           refactor.mjs --visual wiring on a fixture git repo)            groups png, V, R
//   REF-013 old service workers retired (ref-sw.mjs)                      group S
//   REF-014 re-platforming keeps image URLs (ref-images.mjs, and migrate.mjs --images)   groups I, M
// Fixtures only: snapshots built here, sites served from 127.0.0.1, no live site. Chrome is the one the skill already uses (cdp-measure).
// Mutants: break the code each assertion guards, expect the named assertions red, restore.
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const onlyWhat = opt("--only");
const node = process.execPath;
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const rj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const imp = (sdir, f) => import(pathToFileURL(path.join(sdir, f)).href + "?v=" + Math.random().toString(36).slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- fixtures ----------------
function server(handler) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); hits.push(u.pathname + u.search);
    const r = handler(u.pathname, u) || { status: 404, body: "no" };
    res.writeHead(r.status ?? 200, { "content-type": "text/plain", ...(r.headers || {}) }); res.end(r.body ?? "");
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${srv.address().port}`, hits, close: () => new Promise((x) => { srv.closeAllConnections?.(); srv.close(() => x()); }) })));
}
const slugOf = (p) => (p.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9._-]+/g, "__") || "home");
// an old-site snapshot in snapshot-site.mjs's layout
function mkSnapshot(dir, { origin = "https://old.test", pages, sitemaps = {}, extraFiles = {} }) {
  const site = { url: origin + "/", origin, finishedAt: new Date().toISOString(), pages: pages.map((p) => ({ url: origin + p.path, slug: slugOf(p.path), status: 200 })) };
  w(path.join(dir, "_site.json"), JSON.stringify(site));
  for (const p of pages) { w(path.join(dir, "pages", slugOf(p.path), "head.html"), "<head></head>"); w(path.join(dir, "pages", slugOf(p.path), "raw.html.gz"), zlib.gzipSync(Buffer.from(p.html))); if (p.browser) w(path.join(dir, "pages", slugOf(p.path), "browser-mobile.json"), JSON.stringify(p.browser)); }
  for (const [f, x] of Object.entries(sitemaps)) w(path.join(dir, "site", f), x);
  for (const [f, x] of Object.entries(extraFiles)) w(path.join(dir, f), x);
  return dir;
}
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// ---------------- group png: codec, diff, regions ----------------
async function groupPng(sdir, R = []) {
  const ok = (name, c, d = "") => R.push({ name, ok: !!c, detail: c ? "" : String(d) });
  const V = await imp(sdir, "ref-visual.mjs");
  const mk = (wd, ht, f) => { const d = new Uint8Array(wd * ht * 4); for (let y = 0; y < ht; y++) for (let x = 0; x < wd; x++) { const c = f(x, y); d.set([c[0], c[1], c[2], c[3] ?? 255], (y * wd + x) * 4); } return { width: wd, height: ht, data: d }; };
  // codec
  const img = mk(7, 5, (x, y) => [x * 30, y * 40, (x * y) % 256, 255]);
  const back = V.decodePng(V.encodePng(img.data, 7, 5));
  ok("png: encode then decode returns the same pixels", back.width === 7 && back.height === 5 && Buffer.from(back.data).equals(Buffer.from(img.data)), "pixels differ");
  const one = V.decodePng(PNG1);
  ok("png: a PNG written by another encoder (palette-free RGBA, filter 0..4) decodes", one.width === 1 && one.height === 1 && one.data.length === 4, JSON.stringify(one));
  // a PNG with every row filter type, written by hand, must decode the same as the raw pixels
  const wd = 6, ht = 5, raw = mk(wd, ht, (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 90) % 256, (x * y * 7) % 256, 255]);
  const rows = []; let prev = Buffer.alloc(wd * 3);
  for (let y = 0; y < ht; y++) {
    const cur = Buffer.alloc(wd * 3); for (let x = 0; x < wd; x++) { cur[x * 3] = raw.data[(y * wd + x) * 4]; cur[x * 3 + 1] = raw.data[(y * wd + x) * 4 + 1]; cur[x * 3 + 2] = raw.data[(y * wd + x) * 4 + 2]; }
    const ft = y % 5; const out = Buffer.alloc(wd * 3);
    for (let i = 0; i < wd * 3; i++) { const a = i >= 3 ? cur[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0; let pred = 0; if (ft === 1) pred = a; else if (ft === 2) pred = b; else if (ft === 3) pred = (a + b) >> 1; else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } out[i] = (cur[i] - pred) & 255; }
    rows.push(Buffer.concat([Buffer.from([ft]), out])); prev = cur;
  }
  const rgbPng = (() => { const enc = V.encodePng(raw.data, wd, ht); /* take chunk framing from our encoder, swap IHDR colour type and IDAT */ const idat = zlib.deflateSync(Buffer.concat(rows)); const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); let c = 0xffffffff; const tb = b.subarray(4, 8 + d.length); for (const x of tb) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } b.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + d.length); return b; }; const ih = Buffer.alloc(13); ih.writeUInt32BE(wd, 0); ih.writeUInt32BE(ht, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([enc.subarray(0, 8), chunk("IHDR", ih), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]); })();
  const dec = V.decodePng(rgbPng);
  ok("png: an RGB image with all five row filters (none, sub, up, average, Paeth) decodes to the exact pixels", Buffer.from(dec.data).equals(Buffer.from(raw.data)), "decoded pixels differ");
  // diff
  const white = mk(20, 20, () => [255, 255, 255]);
  ok("diff: identical images differ in 0 pixels", V.pixelDiff(white, white).diffPixels === 0, "");
  const dot = mk(20, 20, (x, y) => (x === 10 && y === 10 ? [0, 0, 0] : [255, 255, 255]));
  const d1 = V.pixelDiff(white, dot);
  ok("diff: one black pixel on white is exactly one differing pixel (ratio 1/400)", d1.diffPixels === 1 && Math.abs(d1.ratio - 1 / 400) < 1e-12, JSON.stringify({ n: d1.diffPixels, r: d1.ratio }));
  const faint = mk(20, 20, (x, y) => (x === 10 && y === 10 ? [250, 250, 250] : [255, 255, 255]));
  ok("diff: a difference under the YIQ threshold (255 vs 250) is not counted", V.pixelDiff(white, faint).diffPixels === 0, "");
  // an anti-aliased edge: a vertical edge white|grey|black whose middle column changes slightly between the two images
  const edgeA = mk(7, 7, (x) => (x < 3 ? [255, 255, 255] : x === 3 ? [128, 128, 128] : [0, 0, 0]));
  const edgeB = mk(7, 7, (x) => (x < 3 ? [255, 255, 255] : x === 3 ? [100, 100, 100] : [0, 0, 0]));
  const withAA = V.pixelDiff(edgeA, edgeB, { includeAA: true }), noAA = V.pixelDiff(edgeA, edgeB);
  ok("diff: anti-aliased edge pixels are not counted (pixelmatch semantics), but counted with includeAA", withAA.diffPixels > 0 && noAA.diffPixels < withAA.diffPixels && noAA.aaPixels > 0, JSON.stringify({ withAA: withAA.diffPixels, noAA: noAA.diffPixels, aa: noAA.aaPixels }));
  // a real change of a solid block is counted in full and located
  const blockA = mk(100, 60, () => [255, 255, 255]); const blockB = mk(100, 60, (x, y) => (x >= 40 && x < 60 && y >= 20 && y < 30 ? [200, 0, 0] : [255, 255, 255]));
  const db = V.pixelDiff(blockA, blockB); const regs = V.regionsOf(db, { block: 8 });
  ok("diff: a 20x10 red block is 200 differing pixels", db.diffPixels === 200, db.diffPixels);
  ok("regions: the changed region box covers the block and carries its pixel count", regs.length === 1 && regs[0].pixels === 200 && regs[0].x <= 40 && regs[0].x + regs[0].w >= 60 && regs[0].y <= 20 && regs[0].y + regs[0].h >= 30, JSON.stringify(regs));
  const two = mk(100, 60, (x, y) => ((x >= 40 && x < 60 && y >= 20 && y < 30) || (x >= 5 && x < 9 && y >= 50 && y < 55) ? [200, 0, 0] : [255, 255, 255]));
  const reg2 = V.regionsOf(V.pixelDiff(blockA, two), { block: 8 });
  ok("regions: two separate changes are two regions, biggest first", reg2.length === 2 && reg2[0].pixels === 200 && reg2[1].pixels === 20, JSON.stringify(reg2));
  const small = mk(10, 10, () => [255, 255, 255]), tall = mk(10, 14, () => [255, 255, 255]);
  const dp = V.pixelDiff(small, tall);
  ok("diff: a size change pads the smaller image and counts every padded pixel as differing", dp.sizeChanged && dp.diffPixels === 40 && dp.width === 10 && dp.height === 14, JSON.stringify({ n: dp.diffPixels, w: dp.width, h: dp.height }));
  const pngOut = V.diffImage(db, blockA);
  const dd = V.decodePng(pngOut);
  ok("diff image: a PNG the same size, red where pixels differ", dd.width === 100 && dd.height === 60 && dd.data[(25 * 100 + 50) * 4] === 255 && dd.data[(25 * 100 + 50) * 4 + 1] === 0, "");
  ok("allow list: parseAllow reads route=ratio pairs and refactor.json visual entries", (() => { const f = path.join(tmp("pewp-allow-"), "r.json"); w(f, JSON.stringify({ allowedChanges: [{ kind: "visual", routeGroup: "/b/", maxDiffRatio: 0.2 }, { kind: "text", routeGroup: "/c/" }] })); const a = V.parseAllow(["/a/=0.05"], f); return a["/a/"] === 0.05 && a["/b/"] === 0.2 && !("/c/" in a); })(), "");
  return R;
}

// ---------------- group V: route groups and real Chrome ----------------
const PAGE = (title, body, css = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:Arial,sans-serif;margin:0;color:#222}header{background:#1d3557;color:#fff;padding:16px 20px}main{padding:20px}.card{background:#a8dadc;padding:16px;margin:12px 0;animation:pulse 1s infinite,slide 60s linear forwards}@keyframes pulse{from{opacity:.2}to{opacity:1}}@keyframes slide{from{transform:translateY(-60px)}to{transform:none}}.date{color:#900}${css}</style></head><body><header><nav><a href="/">Home</a> <a href="/about.html">About</a></nav></header><main>${body}</main><footer><p>Footer text</p></footer></body></html>`;
function mkSite(dir, { blogColor = "#a8dadc", extraPadding = 0, aboutText = "About us", dateText = "Posted 2026-01-01", extImage = true } = {}) {
  const css = `.card{background:${blogColor}}${extraPadding ? `.card{padding:${16 + extraPadding}px}` : ""}`;
  w(path.join(dir, "index.html"), PAGE("Home", `<h1>Home</h1><div class="card">Welcome</div><p>Intro paragraph for the home page, long enough to be a page.</p>${extImage ? '<img src="http://example.invalid/x.png" width="10" height="10" alt="x">' : ""}`));
  w(path.join(dir, "about.html"), PAGE("About", `<h1>${aboutText}</h1><p>The about page has its own look.</p>`));
  for (const k of ["a", "b", "c"]) w(path.join(dir, "blog", k, "index.html"), PAGE(`Post ${k}`, `<h1>Post ${k}</h1><div class="card">Card for ${k}</div><p class="date" style="font-size:44px">${dateText}</p><p>Body text of post ${k} goes on for a bit so the page has some content.</p><div style="height:1100px;background:linear-gradient(#fff,#eee)"></div>`, css));
  return dir;
}
async function groupV(sdir, R = []) {
  const ok = (name, c, d = "") => R.push({ name, ok: !!c, detail: c ? "" : String(d) });
  const V = await imp(sdir, "ref-visual.mjs");
  const root = tmp("pewp-vis-");
  const base = mkSite(path.join(root, "base"));
  const groups = V.discoverGroups(base);
  ok("V: route groups: the 3 posts of one template are ONE family (screenshot of its first page), home and about are one-offs", groups.length === 3 && groups.some((g) => g.routeGroup === "/blog/a/" && g.kind === "family" && g.members === 3) && groups.some((g) => g.routeGroup === "/" && g.kind === "page") && groups.some((g) => g.routeGroup === "/about.html" && g.kind === "page"), JSON.stringify(groups));
  const t0 = Date.now();
  // same site twice: PASS even with an animated element and an external image (blocked)
  const same = await V.compareSites({ beforeSite: base, afterSite: mkSite(path.join(root, "same")), outDir: path.join(root, "o-same") });
  if (same.status !== "ok") { ok("V: Chrome is available", false, same.reason); return R; }
  const vs = same.visual;
  ok("V: the same site captured twice at mobile and desktop passes (animations stopped, fonts loaded): 6 of 6 match", vs.status === "PASS" && vs.counts.checked === 6 && vs.counts.pass === 6, JSON.stringify(vs.counts));
  const man = rj(path.join(root, "o-same", "before", "visual-manifest.json"));
  const mob = man.shots.find((s) => s.routeGroup === "/" && s.viewport === "mobile"), desk = man.shots.find((s) => s.routeGroup === "/" && s.viewport === "desktop");
  ok("V: viewports follow 03 section 10: mobile 390 CSS px at DPR 3 (1170 px wide), desktop 1366 at DPR 1", mob.width === 1170 && mob.dpr === 3 && desk.width === 1366 && desk.dpr === 1, JSON.stringify([mob.width, mob.dpr, desk.width, desk.dpr]));
  ok("V: a request to another host (the external image) is refused, not made", mob.externalBlocked >= 1, JSON.stringify(mob));
  ok("V: the screenshot is the full page, not just the first screen (mobile is taller than 844 CSS px x 3 or equal when short; desktop height = page height)", mob.height >= 844 * 3 - 1 || mob.cssHeight > 100, JSON.stringify(mob));
  // animations and transitions are off: the page is captured in its FINAL state (a transition started by a script, a keyframe animation)
  const animDir = path.join(root, "anim");
  w(path.join(animDir, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>anim</title><style>body{margin:0;background:#fff}#a{position:absolute;left:0;top:50px;width:100px;height:100px;background:#e63946;transition:left 30s linear}#a.go{left:600px}#b{position:absolute;left:600px;top:250px;width:100px;height:100px;background:#1d3557;animation:mv 30s linear both}@keyframes mv{from{left:0}to{left:600px}}</style></head><body><div id="a"></div><div id="b"></div><script>setTimeout(function(){document.getElementById("a").classList.add("go")},50)</script></body></html>');
  const animCap = await V.captureSite({ siteDir: animDir, outDir: path.join(root, "o-anim"), viewports: ["desktop"] });
  const animPng = animCap.status === "ok" ? V.decodePng(fs.readFileSync(path.join(root, "o-anim", animCap.manifest.shots[0].file))) : null;
  const px = (x, y) => Array.from(animPng.data.subarray((y * animPng.width + x) * 4, (y * animPng.width + x) * 4 + 3));
  ok("V: animations and transitions are off: the page is captured in its final state (transition ended, keyframe animation at its base style)", animPng && JSON.stringify(px(650, 100)) === JSON.stringify([230, 57, 70]) && JSON.stringify(px(650, 300)) === JSON.stringify([29, 53, 87]) && JSON.stringify(px(50, 100)) === JSON.stringify([255, 255, 255]), animPng ? JSON.stringify([px(650, 100), px(650, 300), px(50, 100)]) : JSON.stringify(animCap));
  // a template colour change on the blog family: that group fails, the others pass; the region is reported
  const chg = await V.compareSites({ beforeSite: base, afterSite: mkSite(path.join(root, "chg"), { blogColor: "#e63946" }), outDir: path.join(root, "o-chg") });
  const vc = chg.visual;
  const failing = vc.results.filter((r) => r.verdict === "FAIL");
  ok("V: a CSS change on one template fails exactly that route group (both viewports) with finding visual-diff, other groups pass", vc.status === "FAIL" && failing.length === 2 && failing.every((r) => r.routeGroup === "/blog/a/" && r.finding === "visual-diff") && vc.results.filter((r) => r.verdict === "PASS").length === 4, JSON.stringify(vc.results.map((r) => [r.routeGroup, r.viewport, r.verdict])));
  ok("V: the failure names the ratio and the allowance, lists changed regions and writes a diff picture", failing[0].ratio > 0.001 && /% of pixels differ/.test(failing[0].detail) && failing[0].regions.length >= 1 && fs.existsSync(path.join(root, "o-chg", failing[0].diffImage)), JSON.stringify(failing[0]).slice(0, 400));
  ok("V: visual-diff.md lists the failing group and its region", /FAIL \/blog\/a\/ \(desktop\) \[visual-diff\]/.test(fs.readFileSync(path.join(root, "o-chg", "visual-diff.md"), "utf8")) && /changed region at x/.test(fs.readFileSync(path.join(root, "o-chg", "visual-diff.md"), "utf8")), "");
  // an allowance for that route group (a visual entry in refactor.json) makes it pass
  const allowed = V.compareCaptures(path.join(root, "o-chg", "before"), path.join(root, "o-chg", "after"), { allow: { "/blog/a/": 0.5 } });
  ok("V: a visual allowance (maxDiffRatio) for the route group makes the same difference pass", allowed.status === "PASS", JSON.stringify(allowed.counts));
  const tight = V.compareCaptures(path.join(root, "o-chg", "before"), path.join(root, "o-chg", "after"), { maxDiffRatio: 0.5 });
  ok("V: a larger default allowance passes it too (the threshold is a parameter, 0.001 by default)", tight.status === "PASS" && vc.maxDiffRatio === 0.001, JSON.stringify(tight.counts));
  // a size change without an allowance fails whatever the pixels; with one it is judged on padded pixels
  const sz = await V.compareSites({ beforeSite: base, afterSite: mkSite(path.join(root, "sz"), { extraPadding: 60 }), outDir: path.join(root, "o-sz") });
  const sf = sz.visual.results.filter((r) => r.verdict === "FAIL" && r.routeGroup === "/blog/a/");
  ok("V: a page that changed size fails with both sizes shown, without an allowance", sf.length >= 1 && sf.some((r) => /changed size: \d+x\d+ before, \d+x\d+ after/.test(r.detail)), JSON.stringify(sf.map((r) => r.detail)));
  const szAllowed = V.compareCaptures(path.join(root, "o-sz", "before"), path.join(root, "o-sz", "after"), { allow: { "/blog/a/": 0.02 } });
  const sr = szAllowed.results.find((r) => r.routeGroup === "/blog/a/" && r.viewport === "desktop");
  ok("V: with an allowance the size change is judged on pixels (padded pixels count as differing)", sr.sizeChanged === true && sr.diffPixels > 0 && sr.sizeBefore !== sr.sizeAfter, JSON.stringify(sr).slice(0, 300));
  // masks: a changing date is masked out by a selector
  const dd = await V.compareSites({ beforeSite: mkSite(path.join(root, "d1")), afterSite: mkSite(path.join(root, "d2"), { dateText: "Posted 2026-12-31 (edited)" }), outDir: path.join(root, "o-date") });
  const dm = await V.compareSites({ beforeSite: path.join(root, "d1"), afterSite: path.join(root, "d2"), outDir: path.join(root, "o-date-masked"), masks: [".date"] });
  ok("V: a changed date fails; masking it with a selector (visual.masks) makes the group pass", dd.visual.status === "FAIL" && dm.visual.results.filter((r) => r.routeGroup === "/blog/a/").every((r) => r.verdict === "PASS"), JSON.stringify([dd.visual.counts, dm.visual.counts]));
  // a route that disappears
  const gone = mkSite(path.join(root, "gone")); fs.rmSync(path.join(gone, "about.html"));
  const man2 = rj(path.join(root, "o-same", "before", "visual-manifest.json"));
  const aft = await V.captureSite({ siteDir: gone, outDir: path.join(root, "o-gone", "after"), groups: man2.groups });
  fs.cpSync(path.join(root, "o-same", "before"), path.join(root, "o-gone", "before"), { recursive: true });
  const vg = V.compareCaptures(path.join(root, "o-gone", "before"), path.join(root, "o-gone", "after"), {});
  ok("V: a route group whose page is gone is a status-mismatch finding (HTTP 200 before, 404 after)", vg.status === "FAIL" && vg.results.some((r) => r.routeGroup === "/about.html" && r.finding === "status-mismatch"), JSON.stringify(vg.results.filter((r) => r.verdict === "FAIL").map((r) => [r.routeGroup, r.finding, r.detail])));
  // CLI exit codes
  const cli = (...a) => spawnSync(node, [path.join(sdir, "ref-visual.mjs"), ...a], { encoding: "utf8", timeout: 180000 });
  const d0 = cli("diff", path.join(root, "o-same", "before"), path.join(root, "o-same", "after"));
  const d1 = cli("diff", path.join(root, "o-chg", "before"), path.join(root, "o-chg", "after"));
  const d2 = cli("diff", path.join(root, "o-chg", "before"), path.join(root, "o-chg", "after"), "--allow", "/blog/a/=0.5");
  ok("V: the CLI exits 0 on PASS, 1 on FAIL and 0 again with --allow", d0.status === 0 && d1.status === 1 && d2.status === 0, JSON.stringify([d0.status, d1.status, d2.status]));
  const rem = cli("capture", "--origin", "https://example.invalid", "--out", path.join(root, "x"));
  ok("V: capture refuses a remote origin without --allow-remote (exit 2, nothing fetched)", rem.status === 2 && /REFUSED/.test(rem.stderr), `${rem.status} ${rem.stderr}`);
  ok("V: (timing) the Chrome group ran", true, `${Math.round((Date.now() - t0) / 1000)} s`);
  if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return R;
}

// ---------------- group S: REF-013 ----------------
async function groupS(sdir, R = []) {
  const ok = (name, c, d = "") => R.push({ name, ok: !!c, detail: c ? "" : String(d) });
  const S = await imp(sdir, "ref-sw.mjs");
  const root = tmp("pewp-sw-");
  const snap = mkSnapshot(path.join(root, "snap"), { pages: [
    { path: "/", html: `<html><head><link rel="manifest" href="/manifest.json"></head><body><script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script></body></html>` },
    { path: "/other/", html: `<html><body><script>navigator.serviceWorker.register("https://cdn.example/sw.js")</script></body></html>` },
  ] });
  const inv = S.detectServiceWorkers(snap);
  ok("S: detect: the register('/sw.js') call is found (static reading), with the scope the browser would use", inv.source === "static" && inv.registrations.some((r) => r.scriptURL === "https://old.test/sw.js" && r.scope === "https://old.test/"), JSON.stringify(inv.registrations));
  ok("S: detect: the manifest is noted and the limit of static reading is stated", inv.notes.some((n) => /manifest/.test(n)) && inv.notes.some((n) => /static reading only/.test(n)), JSON.stringify(inv.notes));
  const site = (name, files) => { const d = path.join(root, name); for (const [f, c] of Object.entries(files)) w(path.join(d, f), c); return d; };
  const run = (newSite) => S.checkServiceWorkers(inv, { newSite });
  let r = await run(site("good", { "index.html": "<html></html>", "sw.js": "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',()=>{self.registration.unregister();});navigator;registration.unregister();" }));
  ok("S: a new build whose /sw.js contains registration.unregister( retires the old worker (PASS, via unregister-script)", r.status === "PASS" && r.results[0].via === "unregister-script", JSON.stringify(r.results));
  ok("S: the other-host worker (cdn.example) is listed and ignored", r.ignored.some((x) => /cdn\.example/.test(x.scriptURL)) && r.results.length === 1, JSON.stringify(r.ignored));
  r = await run(site("none", { "index.html": "<html></html>" }));
  ok("S: no /sw.js at all (404) leaves the old worker controlling: FAIL status-mismatch", r.status === "FAIL" && r.results[0].finding === "status-mismatch", JSON.stringify(r.results));
  r = await run(site("csd", { "index.html": "<html></html>", "about/index.html": "<html></html>", "_headers": '/*\n  Clear-Site-Data: "storage"\n' }));
  ok("S: Clear-Site-Data \"storage\" on every HTML response also retires it (PASS, via clear-site-data)", r.status === "PASS" && r.results[0].via === "clear-site-data", JSON.stringify(r.results));
  r = await run(site("csd-partial", { "index.html": "<html></html>", "about/index.html": "<html></html>", "_headers": '/about/*\n  Clear-Site-Data: "cache"\n' }));
  ok("S: Clear-Site-Data on only some HTML responses is not enough (FAIL)", r.status === "FAIL", JSON.stringify(r.results));
  r = await run(site("csd-wrong", { "index.html": "<html></html>", "_headers": '/*\n  Clear-Site-Data: "cookies"\n' }));
  ok("S: Clear-Site-Data that clears only cookies is not enough (FAIL)", r.status === "FAIL", JSON.stringify(r.results));
  r = await run(site("noun", { "index.html": "<html></html>", "sw.js": "self.addEventListener('fetch',()=>{});" }));
  ok("S: a /sw.js that does not unregister itself is a FAIL no-unregister", r.status === "FAIL" && r.results[0].finding === "no-unregister", JSON.stringify(r.results));
  r = await run(site("redir", { "index.html": "<html></html>", "new-sw.js": "registration.unregister();", "_redirects": "/sw.js /new-sw.js 301\n" }));
  ok("S: a redirect at the worker URL does not retire it (browsers refuse a redirected worker script): FAIL redirect-target", r.status === "FAIL" && r.results[0].finding === "redirect-target" && /refuse a redirected worker script/.test(r.results[0].detail), JSON.stringify(r.results));
  r = await run(site("reg-new", { "index.html": "<html><script>navigator.serviceWorker.register('/new-sw.js')</script></html>", "sw.js": "registration.unregister()" }));
  ok("S: part sw-cache: a new build that registers a worker is BLOCKED with what unblocks it (needs the logout flow), never silently passed", r.swCache.status === "BLOCKED" && /logout flow/.test(r.swCache.detail) && r.swCache.unblock, JSON.stringify(r.swCache));
  ok("S: part sw-cache is NOT-APPLICABLE when the new build registers no worker", (await run(site("plain", { "index.html": "<html></html>", "sw.js": "registration.unregister()" }))).swCache.status === "NOT-APPLICABLE", "");
  // recorded registrations win over static reading
  const snapRec = mkSnapshot(path.join(root, "snap-rec"), { pages: [{ path: "/", html: "<html></html>" }], extraFiles: { "site/serviceworkers.json": JSON.stringify({ capturedAt: "2026-10-22T00:00:00Z", origin: "https://old.test", registrations: [{ scriptURL: "https://old.test/worker2.js", scope: "https://old.test/" }] }) } });
  const invRec = S.detectServiceWorkers(snapRec);
  const rr = await S.checkServiceWorkers(invRec, { newSite: site("rec-new", { "index.html": "<html></html>", "worker2.js": "registration.unregister()" }) });
  ok("S: a recorded site/serviceworkers.json (from the browser) is used instead of static reading", invRec.source === "recorded" && rr.status === "PASS" && rr.results[0].path === "/worker2.js", JSON.stringify([invRec.source, rr.results]));
  // nothing registered
  const snapNone = mkSnapshot(path.join(root, "snap-none"), { pages: [{ path: "/", html: "<html><body>hi</body></html>" }] });
  const rn = await S.checkServiceWorkers(S.detectServiceWorkers(snapNone), { newSite: site("n1", { "index.html": "<html></html>" }) });
  ok("S: an old site with no worker is NOT-APPLICABLE (exit 0), with the caveat that static reading cannot rule out a bundled registration", rn.status === "NOT-APPLICABLE" && /static reading/.test(rn.caveat || ""), JSON.stringify(rn));
  // a script name that looks like a worker is only a warning
  const snapCand = mkSnapshot(path.join(root, "snap-cand"), { pages: [{ path: "/", html: "<html></html>", browser: { page: { scripts: { external: ["https://old.test/sw.js"] } } } }] });
  const rc = await S.checkServiceWorkers(S.detectServiceWorkers(snapCand), { newSite: site("c1", { "index.html": "<html></html>" }) });
  ok("S: a script that is only NAMED like a worker is a WARN, not a FAIL", rc.status === "NOT-APPLICABLE" && rc.results[0].verdict === "WARN", JSON.stringify(rc.results));
  // origin mode against a local server
  let mode = "404";
  const srv = await server((p) => {
    if (p === "/sw.js") { if (mode === "404") return { status: 404 }; if (mode === "js") return { headers: { "content-type": "text/javascript" }, body: "self.registration.unregister();" }; if (mode === "html") return { headers: { "content-type": "text/html" }, body: "self.registration.unregister();" }; if (mode === "nounreg") return { headers: { "content-type": "text/javascript" }, body: "self.x=1" }; if (mode === "redirect") return { status: 301, headers: { location: "/new-sw.js" } }; if (mode === "429") return { status: 429 }; }
    if (p === "/") return { headers: { "content-type": "text/html", ...(mode === "csd" ? { "clear-site-data": '"cache"' } : {}) }, body: "<html></html>" };
    if (p === "/sw.js" && mode === "csd") return { headers: { "content-type": "text/javascript" }, body: "x" };
  });
  const orun = async (m) => { mode = m; return S.checkServiceWorkers(inv, { newOrigin: srv.origin }); };
  let o = await orun("404"); ok("S: origin: 404 at the worker URL is FAIL", o.status === "FAIL" && o.results[0].finding === "status-mismatch", JSON.stringify(o.results));
  o = await orun("js"); ok("S: origin: 200 + JavaScript MIME + registration.unregister( is PASS", o.status === "PASS", JSON.stringify(o.results));
  o = await orun("html"); ok("S: origin: 200 served as text/html (not JavaScript) is FAIL", o.status === "FAIL" && /not JavaScript/.test(o.results[0].detail), JSON.stringify(o.results));
  o = await orun("nounreg"); ok("S: origin: a script without registration.unregister( is FAIL", o.status === "FAIL" && o.results[0].finding === "no-unregister", JSON.stringify(o.results));
  o = await orun("redirect"); ok("S: origin: a 301 at the worker URL is FAIL redirect-target", o.status === "FAIL" && o.results[0].finding === "redirect-target", JSON.stringify(o.results));
  o = await orun("csd"); ok("S: origin: a 404 worker but Clear-Site-Data \"cache\" on the HTML response is PASS", o.status === "PASS" && o.results[0].via === "clear-site-data", JSON.stringify(o.results));
  let threw = null; try { await orun("429"); } catch (e) { threw = e; }
  ok("S: origin: a 429 stops the check (Stop429), nothing concluded", threw && /429/.test(threw.message), String(threw));
  // real Chrome: capture the registrations of a page that registers a real worker
  const cap = await (async () => {
    const s2 = await server((p) => (p === "/sw.js" ? { headers: { "content-type": "text/javascript" }, body: "self.addEventListener('install',()=>self.skipWaiting());" } : p === "/" ? { headers: { "content-type": "text/html" }, body: "<html><body><script>navigator.serviceWorker.register('/sw.js')</script>hi</body></html>" } : null));
    try { return await S.captureRegistrations(s2.origin, { settleMs: 2500 }); } finally { await s2.close(); }
  })();
  ok("S: capture: real Chrome lists the registered worker (navigator.serviceWorker.getRegistrations)", cap.status === "ok" && cap.registrations.length === 1 && /\/sw\.js$/.test(cap.registrations[0].scriptURL), JSON.stringify(cap));
  // CLI
  const cli = (...a) => spawnSync(node, [path.join(sdir, "ref-sw.mjs"), ...a], { encoding: "utf8", timeout: 60000 });
  const c1 = cli("check", snap, "--new-site", path.join(root, "good")), c2 = cli("check", snap, "--new-site", path.join(root, "none")), c3 = cli("check", snap, "--new-origin", "https://example.invalid");
  ok("S: the CLI exits 0 on PASS, 1 on FAIL and refuses a remote --new-origin without --allow-remote (exit 2)", c1.status === 0 && c2.status === 1 && c3.status === 2, JSON.stringify([c1.status, c2.status, c3.status, c3.stderr]));
  await srv.close();
  if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return R;
}

// ---------------- group I: REF-014 ----------------
const OLD_PAGES = (extra = []) => [
  { path: "/", html: `<html><head><meta property="og:image" content="https://old.test/wp-content/og.jpg"><title>Home</title></head><body><header><img src="/logo.png"></header><main><img src="/wp-content/a.jpg" alt="a"><img src="/wp-content/b-600.jpg" srcset="/wp-content/b-300.jpg 300w, /wp-content/b-600.jpg 600w" alt="b"><picture><source srcset="/wp-content/c.webp" type="image/webp"><img src="https://cdn.other/x.jpg"></picture><img src="data:image/png;base64,AAAA"></main></body></html>` },
  { path: "/gone/", html: `<html><body><main><img src="/wp-content/gone.jpg"></main></body></html>` },
  ...extra,
];
const SITEMAP = `<?xml version="1.0"?><urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://old.test/</loc><image:image><image:loc>https://old.test/wp-content/s.jpg</image:loc></image:image></url></urlset>`;
async function groupI(sdir, R = []) {
  const ok = (name, c, d = "") => R.push({ name, ok: !!c, detail: c ? "" : String(d) });
  const I = await imp(sdir, "ref-images.mjs");
  const root = tmp("pewp-img-");
  const snap = mkSnapshot(path.join(root, "snap"), { pages: OLD_PAGES(), sitemaps: { "sitemap.xml": SITEMAP } });
  const inv = I.inventoryImages(snap);
  const mine = inv.images.filter((i) => !i.otherHost).map((i) => i.path).sort();
  ok("I: inventory: img, srcset candidates, picture sources in <main>, og:image and image-sitemap URLs are collected", JSON.stringify(mine) === JSON.stringify(["/wp-content/a.jpg", "/wp-content/b-300.jpg", "/wp-content/b-600.jpg", "/wp-content/c.webp", "/wp-content/gone.jpg", "/wp-content/og.jpg", "/wp-content/s.jpg"]), JSON.stringify(mine));
  ok("I: inventory: an image outside <main> (the header logo) and a data: URI are not collected; another host is listed as other-host", !inv.images.some((i) => /logo\.png|^data:/.test(i.url)) && inv.images.some((i) => i.otherHost && /cdn\.other/.test(i.url)), JSON.stringify(inv.images.map((i) => i.url)));
  ok("I: inventory: each image knows the old pages that used it and whether the image sitemap lists it", inv.images.find((i) => /gone\.jpg/.test(i.url)).pages.join() === "/gone/" && inv.images.find((i) => /s\.jpg/.test(i.url)).inSitemap && inv.images.find((i) => /a\.jpg/.test(i.url)).pages.join() === "/", "");
  const site = (name, files) => { const d = path.join(root, name); for (const [f, c] of Object.entries(files)) w(path.join(d, f), c); return d; };
  const IMG = "x";
  const all = { "wp-content/a.jpg": IMG, "wp-content/b-300.jpg": IMG, "wp-content/b-600.jpg": IMG, "wp-content/c.webp": IMG, "wp-content/gone.jpg": IMG, "wp-content/og.jpg": IMG, "wp-content/s.jpg": IMG };
  let r = await I.checkImages(inv, { newSite: site("all", all) });
  ok("I: folder: every old image URL present on the new build passes (7 of 7), the other-host image is ignored", r.status === "PASS" && r.summary.checked === 7 && r.summary.pass === 7 && r.summary.otherHost === 1, JSON.stringify(r.summary));
  const { "wp-content/b-600.jpg": _x, ...missingB } = all;
  r = await I.checkImages(inv, { newSite: site("missing", missingB) });
  const f = r.rows.filter((x) => x.verdict === "FAIL");
  ok("I: a 404 image is a status-mismatch finding naming the image and the old page that used it", r.status === "FAIL" && f.length === 1 && f[0].path === "/wp-content/b-600.jpg" && f[0].finding === "status-mismatch" && f[0].pages.join() === "/", JSON.stringify(f));
  const { "wp-content/og.jpg": _o, ...noOg } = all;
  r = await I.checkImages(inv, { newSite: site("onehop", { ...noOg, "media/og.jpg": IMG, "_redirects": "/wp-content/og.jpg /media/og.jpg 301\n" }) });
  ok("I: one 301 hop to an image that exists passes", r.status === "PASS" && r.rows.find((x) => /og\.jpg/.test(x.url)).hops === 1, JSON.stringify(r.rows.filter((x) => x.hops)));
  r = await I.checkImages(inv, { newSite: site("chain", { ...noOg, "media/og.jpg": IMG, "_redirects": "/wp-content/og.jpg /m1/og.jpg 301\n/m1/og.jpg /media/og.jpg 301\n" }) });
  ok("I: a chain of two redirects is a redirect-chain finding", r.status === "FAIL" && r.rows.find((x) => /og\.jpg/.test(x.url)).finding === "redirect-chain", JSON.stringify(r.rows.filter((x) => x.verdict === "FAIL")));
  r = await I.checkImages(inv, { newSite: site("nonimg", { ...noOg, "page.html": "<html></html>", "_redirects": "/wp-content/og.jpg /page.html 301\n" }) });
  ok("I: a redirect to something that is not an image is a redirect-target finding", r.status === "FAIL" && r.rows.find((x) => /og\.jpg/.test(x.url)).finding === "redirect-target", JSON.stringify(r.rows.filter((x) => x.verdict === "FAIL")));
  r = await I.checkImages(inv, { newSite: site("temp", { ...noOg, "media/og.jpg": IMG, "_redirects": "/wp-content/og.jpg /media/og.jpg 302\n" }) });
  ok("I: a temporary redirect (302) does not keep the image's standing: redirect-target", r.status === "FAIL" && /only 301\/308/.test(r.rows.find((x) => /og\.jpg/.test(x.url)).detail), JSON.stringify(r.rows.filter((x) => x.verdict === "FAIL")));
  const { "wp-content/gone.jpg": _g, ...noGone } = all;
  r = await I.checkImages(inv, { newSite: site("gone", noGone) });
  ok("I: without an exemption an image of a dropped page is a finding", r.status === "FAIL" && r.rows.some((x) => /gone\.jpg/.test(x.url) && x.verdict === "FAIL"), JSON.stringify(r.summary));
  r = await I.checkImages(inv, { newSite: site("gone2", noGone), removed: { routes: ["/gone/"] } });
  ok("I: an image used only on a page the owner dropped (410) is exempt and listed", r.status === "PASS" && r.exempt.length === 1 && /only used on dropped/.test(r.exempt[0].reason), JSON.stringify([r.summary, r.exempt]));
  r = await I.checkImages(inv, { newSite: site("gone3", noGone), removed: { images: ["/wp-content/gone.jpg"] } });
  ok("I: an image URL the owner dropped (url-remove) is exempt", r.status === "PASS" && r.exempt.length === 1, JSON.stringify(r.summary));
  // a malformed %-escape in one old image URL is that image's finding, never an error that stops the whole check
  const badInv = { ...inv, images: [...inv.images, { url: "https://old.example/wp-content/bad%E0%A4%A.jpg", path: "/wp-content/bad%E0%A4%A.jpg", pages: ["/"], via: ["img"], inSitemap: false, otherHost: false }] };
  let rb = null, rbErr = "";
  try { rb = await I.checkImages(badInv, { newSite: site("all", all) }); } catch (e) { rbErr = e.message; }
  ok("I: a malformed %-escape in an old image URL is a finding for that image (looked up as written), not a crash of the check", rb && rb.summary.checked === 8 && rb.rows.find((x) => /bad%E0/.test(x.path))?.finding === "status-mismatch", rbErr || JSON.stringify(rb?.summary));
  // origin mode
  let mode = {};
  const srv = await server((p) => {
    if (!p.startsWith("/wp-content") && !p.startsWith("/m")) return null;
    const m = mode[p]; if (m) return m;
    return { status: 200, headers: { "content-type": "image/jpeg" }, body: "x" };
  });
  mode = { "/wp-content/b-600.jpg": { status: 404 }, "/wp-content/b-300.jpg": { status: 301, headers: { location: "/m/b-300.jpg" } }, "/wp-content/c.webp": { status: 200, headers: { "content-type": "text/html" }, body: "x" }, "/wp-content/og.jpg": { status: 301, headers: { location: "/m2/og.jpg" } }, "/m2/og.jpg": { status: 301, headers: { location: "/m/og.jpg" } }, "/wp-content/s.jpg": { status: 308, headers: { location: "/m/s.jpg" } } };
  r = await I.checkImages(inv, { newOrigin: srv.origin, gapMs: 0, removed: { routes: ["/gone/"] }, exclude: ["^/wp-content/a\\.jpg"] });
  const byPath = Object.fromEntries(r.rows.map((x) => [x.path, x]));
  ok("I: origin: 404 -> status-mismatch; 301 to a 200 image passes; 308 passes; 200 as text/html fails; 301->301 is a redirect-chain", byPath["/wp-content/b-600.jpg"].finding === "status-mismatch" && byPath["/wp-content/b-300.jpg"].verdict === "PASS" && byPath["/wp-content/s.jpg"].verdict === "PASS" && byPath["/wp-content/c.webp"].finding === "status-mismatch" && byPath["/wp-content/og.jpg"].finding === "redirect-chain", JSON.stringify(r.rows.map((x) => [x.path, x.verdict, x.finding])));
  ok("I: origin: --exclude paths are never requested and are listed as not checked; the exempt image is not requested either", !srv.hits.includes("/wp-content/a.jpg") && !srv.hits.includes("/wp-content/gone.jpg") && r.notChecked.some((x) => /a\.jpg/.test(x.url)) && r.exempt.length === 1, JSON.stringify([srv.hits, r.notChecked]));
  srv.hits.length = 0; mode = { "/wp-content/b-300.jpg": { status: 429 } };
  r = await I.checkImages(inv, { newOrigin: srv.origin, gapMs: 0 });
  ok("I: origin: a 429 stops the run at once (status STOPPED, nothing concluded, the rest not requested)", r.status === "STOPPED" && /429/.test(r.stopped429) && srv.hits.length < 6, JSON.stringify([r.status, srv.hits]));
  mode = {}; srv.hits.length = 0;
  r = await I.checkImages(inv, { newOrigin: srv.origin, gapMs: 0, scope: "priority", mustKeep: ["/"] });
  ok("I: scope priority checks only images on must-keep pages or in the image sitemap; the rest are listed as not checked (default scope all is the shipgate rule)", r.summary.checked === 6 && r.notChecked.some((x) => /gone\.jpg/.test(x.url) && /scope priority/.test(x.reason)) && r.scope === "priority", JSON.stringify([r.summary, r.notChecked]));
  srv.hits.length = 0;
  const r1 = await I.checkImages(inv, { newOrigin: srv.origin, gapMs: 0, max: 3 }), hits1 = [...srv.hits]; srv.hits.length = 0;
  const r2 = await I.checkImages(inv, { newOrigin: srv.origin, gapMs: 0, max: 3 });
  ok("I: above the cap a fixed draw is checked (3 of 7), the same 3 on a re-run, the others listed as not checked", r1.summary.checked === 3 && r1.summary.sampled === true && JSON.stringify(hits1.sort()) === JSON.stringify([...srv.hits].sort()) && r1.notChecked.length === 4, JSON.stringify([r1.summary, hits1, srv.hits]));
  // CLI
  const cli = (...a) => spawnSync(node, [path.join(sdir, "ref-images.mjs"), ...a], { encoding: "utf8", timeout: 60000 });
  const c1 = cli("check", snap, "--new-site", path.join(root, "all")), c2 = cli("check", snap, "--new-site", path.join(root, "missing")), c3 = cli("check", snap, "--new-origin", "https://example.invalid");
  ok("I: the CLI exits 0 on PASS, 1 on FAIL, and refuses a remote --new-origin without --allow-remote (exit 2)", c1.status === 0 && c2.status === 1 && c3.status === 2, JSON.stringify([c1.status, c2.status, c3.status]));
  await srv.close();
  if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return R;
}

// ---------------- group M: migrate.mjs --images ----------------
async function groupM(sdir, R = []) {
  const ok = (name, c, d = "") => R.push({ name, ok: !!c, detail: c ? "" : String(d) });
  const V = await imp(sdir, "ref-visual.mjs");
  const root = tmp("pewp-mig-");
  const cwd = path.join(root, "cwd");
  const OLD = "https://old.test/";
  const pages = [
    { path: "/", html: `<html><head><title>Home</title></head><body><main><h1>Home</h1><img src="/wp-content/a.jpg"><img src="/wp-content/b.jpg"></main></body></html>` },
    { path: "/about/", html: `<html><head><title>About</title></head><body><main><h1>About</h1><img src="/wp-content/about.jpg"></main></body></html>` },
    { path: "/test-page/", html: `<html><head><title>draft</title></head><body><main><h1>draft</h1><img src="/wp-content/draft.jpg"></main></body></html>` },
  ];
  mkSnapshot(path.join(cwd, "site-checks", "old.test", "snapshots", "2026-10-20"), { pages });
  const newDir = path.join(root, "new");
  for (const p of ["index.html", "about/index.html"]) w(path.join(newDir, p), `<html><head><title>${p}</title></head><body><main><h1>${p}</h1></main></body></html>`);
  for (const f of ["a.jpg", "b.jpg", "about.jpg"]) w(path.join(newDir, "wp-content", f), "img");
  const srv = await V.serveDir(newDir);
  // serveDir serves files with a MIME by extension: .jpg is image/jpeg
  // the child must not block this process: the fixture server lives here
  const mig = (...a) => new Promise((resolve) => { const c = spawn(node, [path.join(sdir, "migrate.mjs"), OLD, newDir, "--cwd", cwd, "--today", "2026-10-23", "--gap-ms", "20", ...a], { stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (e += d)); const t = setTimeout(() => c.kill(), 120000); c.on("close", (code) => { clearTimeout(t); resolve({ status: code, stdout: o, stderr: e }); }); });
  const inv = await mig("--stage", "inventory"), map = await mig("--stage", "map");
  ok("M: the migrate inventory and map stages still run on the fixture (exit 0)", inv.status === 0 && map.status === 0, `${inv.status} ${inv.stdout} ${inv.stderr} | ${map.status} ${map.stdout} ${map.stderr}`.slice(0, 600));
  let g = await mig("--stage", "gate", "--new-origin", srv.origin, "--images");
  const gate = () => rj(path.join(cwd, "site-checks", "old.test", ".pewp", "migrate", "gate-2026-10-23.json"));
  ok("M: gate --images: every old image resolves on the new site -> exit 0, gate.images PASS, images-<date>.md written", g.status === 0 && gate().images?.status === "PASS" && gate().passed === true && fs.existsSync(path.join(cwd, "site-checks", "old.test", ".pewp", "migrate", "images-2026-10-23.md")), `${g.status} ${g.stdout.slice(-500)} ${g.stderr}`);
  ok("M: the image on the dropped draft page (a 410 candidate in the map) is exempt, not a finding", (gate().images?.exempt || []).some((x) => /draft\.jpg/.test(x.url)) && gate().images.summary.fail === 0, JSON.stringify(gate().images?.summary));
  fs.rmSync(path.join(newDir, "wp-content", "b.jpg"));
  srv.hits.length = 0;
  g = await mig("--stage", "gate", "--new-origin", srv.origin);
  ok("M: without --images the image URLs are not requested at all and the redirect gate alone decides (exit 0)", g.status === 0 && !srv.hits.some((h) => h.startsWith("/wp-content")) && gate().images === undefined, `${g.status} ${JSON.stringify(srv.hits)}`);
  g = await mig("--stage", "gate", "--new-origin", srv.origin, "--images");
  ok("M: with --images a missing image fails the gate: exit 1, passed false, the finding names the image", g.status === 1 && gate().passed === false && gate().images.status === "FAIL" && gate().images.rows.some((r) => r.verdict === "FAIL" && r.path === "/wp-content/b.jpg"), `${g.status} ${g.stdout.slice(-400)}`);
  ok("M: the gate markdown carries the image section", /Image URLs \(REF-014\): FAIL/.test(fs.readFileSync(path.join(cwd, "site-checks", "old.test", ".pewp", "migrate", "gate-2026-10-23.md"), "utf8")), "");
  // no old snapshot: the image check cannot read the old URLs; it is BLOCKED and fails the gate, never a silent pass
  const cwd2 = path.join(root, "cwd2");
  const mig2 = (...a) => new Promise((resolve) => { const c = spawn(node, [path.join(sdir, "migrate.mjs"), OLD, newDir, "--cwd", cwd2, "--today", "2026-10-23", "--gap-ms", "20", ...a], { stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (e += d)); c.on("close", (code) => resolve({ status: code, stdout: o, stderr: e })); });
  await mig2("--stage", "inventory"); await mig2("--stage", "map");
  const g2 = await mig2("--stage", "gate", "--new-origin", srv.origin, "--images");
  const gj2 = (() => { try { return rj(path.join(cwd2, "site-checks", "old.test", ".pewp", "migrate", "gate-2026-10-23.json")); } catch { return null; } })();
  ok("M: --images without an old snapshot is BLOCKED (named in gate.json), the gate does not pass, exit 1", g2.status === 1 && gj2?.images?.status === "BLOCKED" && gj2.passed === false && /no complete old snapshot/.test(gj2.images.reason), `${g2.status} ${g2.stdout.slice(-300)} ${JSON.stringify(gj2?.images)}`);
  await srv.close();
  if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return R;
}

// ---------------- group R: refactor.mjs --visual on a fixture git repo ----------------
async function groupR(sdir, R = []) {
  const ok = (name, c, d = "") => R.push({ name, ok: !!c, detail: c ? "" : String(d) });
  const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8", timeout: 60_000 });
  const mk = (root) => {
    const repo = path.join(root, "repo"); const site = repo;
    fs.mkdirSync(repo, { recursive: true });
    const html = (name, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>${name}</h1><p>Some text on the ${name} page.</p>${extra}</main></body></html>`;
    w(path.join(site, "style.css"), "body{font-family:Arial;margin:0;padding:20px}h1{color:#1d3557}\n");
    w(path.join(site, "index.html"), html("Home")); w(path.join(site, "about.html"), html("About"));
    for (const k of ["a", "b", "c"]) w(path.join(site, "blog", k, "index.html"), html(`Post ${k}`, '<div class="card">card</div>'));
    w(path.join(site, ".gitignore"), ".checks/\n.pewp/\n");
    // the checks: the cause is "the pages have no lang attribute"
    w(path.join(site, ".checks", "causes.json"), JSON.stringify([{ id: "C01", severity: "high", problem: "pages have no lang attribute", fix: "add lang=en to the html tag", fixAt: [], scripts: ["check-lang.mjs"], pages: 5, findings: [] }]));
    w(path.join(site, ".checks", "scripts", "check-lang.mjs"), `import fs from "node:fs"; import path from "node:path"; const root = process.cwd(); const bad = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(\\.checks|\\.git|\\.pewp)$/.test(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\\.html$/.test(f) && !/<html[^>]*\\blang=/.test(fs.readFileSync(f, "utf8"))) bad.push(f); } }; walk(root); if (bad.length) { console.log("FAIL " + bad.length + " page(s) have no lang"); process.exit(1); } console.log("PASS"); `);
    w(path.join(site, ".checks", "run-all.mjs"), `import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process"; const dir = path.join(process.cwd(), ".checks", "scripts"); const scripts = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort().map((f) => { const r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: process.cwd(), encoding: "utf8" }); return { script: f, status: r.status === 0 ? "pass" : "fail", line: (r.stdout || "").trim().split("\\n")[0] }; }); const pass = scripts.filter((s) => s.status === "pass").length; console.log(JSON.stringify({ summary: pass + "/" + scripts.length + " pass", causes: [], scripts }));`);
    git(repo, "init", "-q", "-b", "main"); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "init");
    return repo;
  };
  // worker stand-ins: add lang to every html file; the second one ALSO changes the template colour
  const workerSrc = (alsoStyle) => `import fs from "node:fs"; import path from "node:path"; const root = process.argv[2]; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(\\.checks|\\.git|\\.pewp)$/.test(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\\.html$/.test(f)) fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("<html>", '<html lang="en">')); } }; walk(root); ${alsoStyle ? `fs.appendFileSync(path.join(root, "style.css"), "h1{color:#e63946;font-size:40px}\\n");` : ""}`;
  const runRefactor = (repo, root, worker, extra = []) => spawnSync(node, [path.join(sdir, "refactor.mjs"), repo, "--no-build", "--worker-script", worker, "--worktrees", path.join(root, "wt"), "--date", "2026-10-23", "--parallel", "1", "--timeout-min", "2", ...extra], { encoding: "utf8", timeout: 400000 });
  for (const [label, alsoStyle, expect] of [["a fix that changes no pixel", false, "PASS"], ["a fix that restyles the headings", true, "FAIL"]]) {
    const root = tmp("pewp-ref-"); const repo = mk(root);
    const wk = path.join(root, "worker.mjs"); w(wk, workerSrc(alsoStyle));
    const r = runRefactor(repo, root, wk, ["--visual"]);
    const rep = path.join(repo, ".pewp", "refactor", "2026-10-23.json");
    let j = null; try { j = rj(rep); } catch {}
    ok(`R: ${label}: the run finishes DONE with the fix proven (1 FIXED), exit 0 whatever the visual result`, r.status === 0 && /1 FIXED/.test(r.stdout), `${r.status} ${r.stdout.slice(-600)} ${r.stderr.slice(-300)}`);
    ok(`R: ${label}: REF-009 is ${expect} in the report json and in the console`, j?.visual?.status === expect && new RegExp(`visual \\(REF-009\\): ${expect}`).test(r.stdout), `${JSON.stringify(j?.visual)} ${r.stdout.slice(-400)}`);
    const md = fs.existsSync(path.join(repo, ".pewp", "refactor", "2026-10-23.md")) ? fs.readFileSync(path.join(repo, ".pewp", "refactor", "2026-10-23.md"), "utf8") : "";
    ok(`R: ${label}: the report markdown has the Visual equivalence line${expect === "FAIL" ? " naming the route group, the ratio and where the pictures are" : ""}`, expect === "PASS" ? /Visual equivalence \(REF-009\): PASS/.test(md) : /Visual equivalence \(REF-009\): FAIL/.test(md) && /visual-diff|% of pixels differ/.test(md) && /visual\/diff|visual-diff\.md/.test(md), md.split("\n").filter((l) => /Visual/.test(l)).join("\n"));
    if (expect === "FAIL") {
      ok("R: the failing pictures and visual-diff.md are written under .pewp/refactor/<run>/visual/", fs.existsSync(path.join(repo, ".pewp", "refactor", "2026-10-23", "visual", "visual-diff.md")) && fs.readdirSync(path.join(repo, ".pewp", "refactor", "2026-10-23", "visual", "diff")).length >= 1, "");
    }
    if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
  // --visual-allow turns the FAIL into a PASS
  { const root = tmp("pewp-ref3-"); const repo = mk(root); const wk = path.join(root, "worker.mjs"); w(wk, workerSrc(true));
    const r = runRefactor(repo, root, wk, ["--visual", "--visual-max-diff", "0.9"]);
    const j = (() => { try { return rj(path.join(repo, ".pewp", "refactor", "2026-10-23.json")); } catch { return null; } })();
    ok("R: --visual-max-diff (the allowance) turns the same restyle into a PASS", j?.visual?.status === "PASS", `${r.status} ${JSON.stringify(j?.visual)} ${r.stdout.slice(-300)}`);
    if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  // without --visual nothing is captured
  { const root = tmp("pewp-ref4-"); const repo = mk(root); const wk = path.join(root, "worker.mjs"); w(wk, workerSrc(false));
    const r = runRefactor(repo, root, wk, []);
    const j = (() => { try { return rj(path.join(repo, ".pewp", "refactor", "2026-10-23.json")); } catch { return null; } })();
    ok("R: without --visual no screenshot is taken and the report says the proof was not run", r.status === 0 && !j?.visual && !fs.existsSync(path.join(repo, ".pewp", "refactor", "2026-10-23", "visual")) && /not run \(add --visual\)/.test(fs.readFileSync(path.join(repo, ".pewp", "refactor", "2026-10-23.md"), "utf8")), `${r.status} ${r.stdout.slice(-200)}`);
    const dry = spawnSync(node, [path.join(sdir, "refactor.mjs"), repo, "--no-build", "--dry", "--visual"], { encoding: "utf8", timeout: 300_000 });
    ok("R: --dry says the visual proof is ON", /visual proof \(REF-009\): ON/.test(dry.stdout), dry.stdout.slice(-300));
    if (!A.includes("--keep")) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  return R;
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "png: the Paeth row filter is wrong", file: "ref-visual.mjs", from: "v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }", to: "v += pa <= pb && pa <= pc ? b : pb <= pc ? a : c; }", sc: "png", expect: [/^png: an RGB image with all five row filters/] },
  { name: "diff: anti-aliased pixels are counted", file: "ref-visual.mjs", from: "if (!includeAA && (antialiased(da, x, y, W, H, db) || antialiased(db, x, y, W, H, da))) {", to: "if (false) {", sc: "png", expect: [/^diff: anti-aliased edge pixels are not counted/] },
  { name: "diff: the YIQ threshold is ignored (every difference counts)", file: "ref-visual.mjs", from: "if (Math.abs(delta) > maxDelta) {", to: "if (Math.abs(delta) > 0) {", sc: "png", expect: [/^diff: a difference under the YIQ threshold/] },
  { name: "diff: padded pixels of a size change are not counted", file: "ref-visual.mjs", from: "{ mask[i] = 1; diff++; continue; }", to: "{ continue; }", sc: "png", expect: [/^diff: a size change pads/] },
  { name: "regions: every change is merged into one box", file: "ref-visual.mjs", from: "for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {\n        const nx = cx + dx, ny = cy + dy;", to: "for (let dy = -30; dy <= 30; dy++) for (let dx = -30; dx <= 30; dx++) {\n        const nx = cx + dx, ny = cy + dy;", sc: "png", expect: [/^regions: two separate changes/] },
  { name: "visual: the default allowance is 1.0 (nothing can fail)", file: "ref-visual.mjs", from: "export const DEFAULT_MAX_DIFF_RATIO = 0.001;", to: "export const DEFAULT_MAX_DIFF_RATIO = 1;", sc: "V", expect: [/^V: a CSS change on one template fails exactly that route group/] },
  { name: "visual: a size change without an allowance is only judged on pixels", file: "ref-visual.mjs", from: "if ((ia.width !== ib.width || ia.height !== ib.height) && allowed == null) {", to: "if (false) {", sc: "V", expect: [/^V: a page that changed size fails with both sizes shown/] },
  { name: "visual: animations are not stopped", file: "ref-visual.mjs", from: "const NO_MOTION = `*,*::before,*::after{animation:none!important;", to: "const NO_MOTION = `.never{animation:none!important;", sc: "V", expect: [/^V: animations and transitions are off/] },
  { name: "visual: requests to other hosts are allowed", file: "ref-visual.mjs", from: "if (allowExternal || isLocal(u))", to: "if (true)", sc: "V", expect: [/^V: a request to another host/] },
  { name: "visual: masks are not applied", file: "ref-visual.mjs", from: "if (masks.length) await send(", to: "if (false) await send(", sc: "V", expect: [/^V: a changed date fails; masking it/] },
  { name: "visual: the mobile viewport is desktop-sized", file: "ref-visual.mjs", from: "mobile: { width: 390, height: 844, dpr: 3, mobile: true },", to: "mobile: { width: 1366, height: 768, dpr: 1, mobile: false },", sc: "V", expect: [/^V: viewports follow 03 section 10/] },
  { name: "visual: families are not collapsed (every page is its own group)", file: "ref-visual.mjs", from: "const groups = families.map(", to: "const groups = [].map(", sc: "V", expect: [/^V: route groups/] },
  { name: "visual: a missing page is not a finding", file: "ref-visual.mjs", from: "if (a.httpStatus !== b.httpStatus) {", to: "if (false) {", sc: "V", expect: [/^V: a route group whose page is gone/] },
  { name: "refactor: --visual is ignored", file: "refactor.mjs", from: "const visualOn = A.includes(\"--visual\");", to: "const visualOn = false;", sc: "R", expect: [/REF-009 is PASS/, /REF-009 is FAIL/] },
  { name: "refactor: the after screenshots are taken of the untouched main checkout", file: "refactor.mjs", from: "const aft = await visualMod.captureSite({ siteDir: path.join(intRoot,", to: "const aft = await visualMod.captureSite({ siteDir: path.join(siteRoot,", sc: "R", expect: [/REF-009 is FAIL/] },
  { name: "refactor: the visual allowance is ignored", file: "refactor.mjs", from: "maxDiffRatio: Number(opt(\"--visual-max-diff\", 0.001)), allow:", to: "maxDiffRatio: 0.001, allow:", sc: "R", expect: [/--visual-max-diff \(the allowance\)/] },
  { name: "sw: the unregister( substring is not required", file: "ref-sw.mjs", from: "viaScript = text.includes(\"registration.unregister(\") && mimeOk ?", to: "viaScript = mimeOk ?", sc: "S", expect: [/^S: a new build whose|^S: a \/sw\.js that does not unregister itself/] },
  { name: "sw: the MIME type is not checked on an origin", file: "ref-sw.mjs", from: "viaScript = JS_MIME.test(r.contentType) ?", to: "viaScript = true ?", sc: "S", expect: [/^S: origin: 200 served as text\/html/] },
  { name: "sw: a redirect at the worker URL counts as retired", file: "ref-sw.mjs", from: "else if (r.status >= 300 && r.status < 400) viaScript = { ok: false,", to: "else if (r.status >= 300 && r.status < 400) viaScript = { ok: true,", sc: "S", expect: [/^S: origin: a 301 at the worker URL/] },
  { name: "sw: Clear-Site-Data on one page is enough", file: "ref-sw.mjs", from: "return { ok: n > 0 && !miss.length, n, miss };", to: "return { ok: n > 0 && miss.length < n, n, miss };", sc: "S", expect: [/^S: Clear-Site-Data on only some HTML responses/] },
  { name: "sw: any Clear-Site-Data value counts", file: "ref-lib.mjs", from: "export const clearsSite = (v) => !!v && /\"(storage|cache|\\*)\"/i.test(String(v));", to: "export const clearsSite = (v) => !!v;", sc: "S", expect: [/^S: Clear-Site-Data that clears only cookies/] },
  { name: "sw: sw-cache is reported as not applicable when a worker is registered", file: "ref-sw.mjs", from: "const swCache = registersNew", to: "const swCache = false", sc: "S", expect: [/^S: part sw-cache: a new build that registers a worker is BLOCKED/] },
  { name: "sw: a worker found only by name FAILs", file: "ref-sw.mjs", from: "verdict: it.confirmed ? \"FAIL\" : \"WARN\"", to: "verdict: \"FAIL\"", sc: "S", expect: [/^S: a script that is only NAMED like a worker/] },
  { name: "sw: the worker on another host is checked", file: "ref-sw.mjs", from: "return hostOf(u.href) === oldHost || !oldHost ? u.pathname + u.search : null;", to: "return u.pathname + u.search;", sc: "S", expect: [/^S: the other-host worker/] },
  { name: "images: a malformed %-escape crashes the folder check", file: "ref-images.mjs", from: "let p = imgPath.split(\"?\")[0]; try { p = decodeURIComponent(p); } catch {}", to: "let p = decodeURIComponent(imgPath.split(\"?\")[0]);", sc: "I", expect: [/^I: a malformed %-escape in an old image URL/] },
  { name: "images: srcset candidates are not collected", file: "ref-images.mjs", from: "for (const u of srcsetUrls(attr(m[0], \"srcset\"))) add(u, \"srcset\"); }", to: "}", sc: "I", expect: [/^I: inventory: img, srcset candidates/] },
  { name: "images: the header logo (outside <main>) is collected", file: "ref-images.mjs", from: "const main = mainRegion(html);", to: "const main = html;", sc: "I", expect: [/^I: inventory: an image outside <main>/] },
  { name: "images: a chain of redirects passes", file: "ref-images.mjs", from: "if (n.status >= 300 && n.status < 400) return { verdict: \"FAIL\", finding: \"redirect-chain\"", to: "if (false) return { verdict: \"FAIL\", finding: \"redirect-chain\"", sc: "I", expect: [/^I: origin: 404 -> status-mismatch/] },
  { name: "images: 302 is accepted like 301 (a _redirects rule)", file: "ref-images.mjs", from: "if (![301, 308].includes(rd.status)) return", to: "if (false) return", sc: "I", expect: [/^I: a temporary redirect \(302\)/] },
  { name: "images: a non-image content type passes", file: "ref-images.mjs", from: "return /^image\\//i.test(r.contentType) ? { verdict: \"PASS\", hops: 0,", to: "return true ? { verdict: \"PASS\", hops: 0,", sc: "I", expect: [/^I: origin: 404 -> status-mismatch/] },
  { name: "images: a 429 is not a stop", file: "ref-lib.mjs", from: "if (res.status === 429) throw new Stop429(`429 from ${url}`);", to: "", sc: "I+S", expect: [/^I: origin: a 429 stops the run/, /^S: origin: a 429 stops the check/] },
  { name: "images: --exclude paths are requested", file: "ref-images.mjs", from: "if (exRe.some((re) => re.test(i.path))) {", to: "if (false) {", sc: "I", expect: [/^I: origin: --exclude paths are never requested/] },
  { name: "images: dropped-page images are not exempt", file: "ref-images.mjs", from: "if (i.pages.length && i.pages.every((p) => removedRoutes.has(normPathOf(p)))) {", to: "if (false) {", sc: "I", expect: [/^I: an image used only on a page the owner dropped/] },
  { name: "images: the cap draws different images each time", file: "ref-images.mjs", from: "[...todo].sort((a, b) => sha(a.url).localeCompare(sha(b.url))).slice(0, max)", to: "[...todo].sort(() => Math.random() - 0.5).slice(0, max)", sc: "I", expect: [/^I: above the cap a fixed draw/] },
  { name: "migrate: a failing image check does not fail the gate", file: "migrate.mjs", from: "if (imgs.status === \"FAIL\") gate.passed = false;", to: "", sc: "M", expect: [/^M: with --images a missing image fails the gate/] },
  { name: "migrate: the image check runs without --images", file: "migrate.mjs", from: "if (opts.images) {", to: "if (true) {", sc: "M", expect: [/^M: without --images the image URLs are not requested/] },
  { name: "migrate: images on dropped pages are not exempt", file: "migrate.mjs", from: "removed: { routes: (map?.rows || []).filter((r) => r.gone && r.approved !== \"no\").map((r) => r.from) }", to: "removed: {}", sc: "M", expect: [/^M: the image on the dropped draft page/] },
];

const GROUPS = { png: groupPng, V: groupV, S: groupS, I: groupI, M: groupM, R: groupR };
async function runGroups(sdir, which) {
  const out = [];
  for (const g of which) {
    const R = [];
    try { await GROUPS[g](sdir, R); }
    catch (e) { R.push({ name: `${g}: the group crashed`, ok: false, detail: String(e.stack || e).slice(0, 600) }); }
    out.push(...R);
  }
  return out;
}

if (isMain(import.meta.url)) { // lib-main.mjs: real paths (started through a junction this used to skip the whole suite)
  // --help: the usage path test-main.mjs runs through a junction (inside the guard, so a broken guard prints nothing and goes red)
  if (A.includes("--help")) { console.log("usage: node test-ref.mjs [--scripts <dir>] [--only png|V|S|I|M|R] [--no-mutants] [--mutant <name part>] [--keep]"); process.exit(0); }
  const which = onlyWhat ? onlyWhat.split(",") : ["png", "S", "I", "M", "V", "R"];
  const main = A.includes("--mutants-only") ? [] : await runGroups(scriptsDir, which);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `REF TEST FAIL: ${failed} of ${main.length}` : `REF TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants") && (!onlyWhat || A.includes("--mutants-only"))) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    // --slice k/n runs every n-th mutant starting at k, so several processes can share the list
    const [sk, sn] = (opt("--slice", "0/1") || "0/1").split("/").map(Number);
    for (const mu of MUTANTS.filter((m, i) => i % sn === sk).filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = tmp("pewp-mutant-"); const sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      for (const f of ["fix-worker-prompt.md"]) if (fs.existsSync(path.join(scriptsDir, "..", f))) fs.copyFileSync(path.join(scriptsDir, "..", f), path.join(mdir, f));
      const target = path.join(sdir, mu.file); const src = fs.readFileSync(target, "utf8"); const count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 30_000 });
      if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      const res = await runGroups(sdir, mu.sc.split("+"));
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  process.exit(failed ? 1 : 0);
}
