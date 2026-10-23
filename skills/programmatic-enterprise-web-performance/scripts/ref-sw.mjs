// REF-013 old service workers are retired (shipgate packs/refactor.md). A visitor who came to the old site has its service
// worker installed in the browser; if the new site simply 404s the worker's script, that old worker keeps controlling the
// page and serves stale content. For each worker the old site registered, the new site must either
//   (a) answer the worker's script URL with 200, a JavaScript MIME type and a script whose text contains `registration.unregister(`, or
//   (b) send `Clear-Site-Data` containing "storage", "cache" or "*" on every HTML response.
// A redirect at the worker's URL does NOT retire it: browsers refuse a redirected worker script, so the update check fails and
// the old worker stays. Part sw-cache (a new worker must not serve logged-in pages from cache after logout) needs the logout
// flow and CDP serviceWorkerResponseSource; this skill has no flow runner, so that part reports BLOCKED when it applies.
//
// Usage: node ref-sw.mjs detect <snapshot dir> [--out file]        which workers did the old site register
//        node ref-sw.mjs check <snapshot dir | registrations.json> (--new-site <folder> | --new-origin <url> [--allow-remote])
//             [--paths /,/a/]  [--out <dir>]                      does the new site retire them
//        node ref-sw.mjs capture <origin> --out <file> [--allow-remote]   read navigator.serviceWorker.getRegistrations() in real
//             Chrome (one page load, read-only) and save them as the snapshot's site/serviceworkers.json
//   Sources, best first: site/serviceworkers.json (recorded by capture) > serviceWorker.register('...') calls in the
//   snapshot's HTML (static reading: a call inside a bundled script is invisible) > script names that look like workers
//   (only a warning: a name proves nothing).
// Exit: 0 PASS or not applicable, 1 FAIL, 2 usage, 3 BLOCKED.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshotPages, getOnce, hostOf, isLoopback, parseRedirectRules, applyRedirect, parseHeadersFile, headersFor, clearsSite, configHeaders, walkFiles, htmlUrlPath, readJson, writeJson, Stop429 } from "./ref-lib.mjs";

const REGISTER_RE = /serviceWorker\s*\.\s*register\s*\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{[^}]*?scope\s*:\s*(['"`])([^'"`]+)\3)?/g;
const SW_NAME_RE = /(^|\/)(sw|service-?worker|serviceworker|firebase-messaging-sw|OneSignalSDK\w*Worker|ngsw-worker|workbox-[\w-]+)(\.[\w-]+)?\.js(\?|$)/i;
const JS_MIME = /(java|ecma)script/i;

export function detectServiceWorkers(snapDir) {
  const { site, pages } = readSnapshotPages(snapDir);
  const origin = site.origin || (site.url ? new URL(site.url).origin : null);
  const recorded = readJson(path.join(snapDir, "site", "serviceworkers.json"));
  const notes = [];
  if (recorded) {
    const regs = (recorded.registrations || []).map((r) => ({ scriptURL: r.scriptURL, scope: r.scope, evidence: [{ kind: "recorded", capturedAt: recorded.capturedAt }] }));
    return { origin, source: "recorded", capturedAt: recorded.capturedAt || null, registrations: regs, candidates: [], notes };
  }
  const regs = new Map(), cands = new Map(), manifests = new Set();
  for (const p of pages) {
    for (const m of p.html.matchAll(REGISTER_RE)) {
      let u; try { u = new URL(m[2], p.url).href; } catch { continue; }
      let scope; try { scope = m[4] ? new URL(m[4], p.url).href : new URL("./", u).href; } catch { scope = null; } // an unreadable scope is unknown, not a crash
      const e = regs.get(u) || { scriptURL: u, scope, evidence: [] }; e.evidence.push({ kind: "register-call", page: p.path }); regs.set(u, e);
    }
    for (const m of p.html.matchAll(/<link\b[^>]*rel=["']manifest["'][^>]*>/gi)) { const h = (m[0].match(/href=["']([^"']+)["']/i) || [])[1]; if (h) { try { manifests.add(new URL(h, p.url).href); } catch {} } }
    // the browser pass lists the scripts a page loaded; a worker-looking name is a candidate, not proof
    const bm = readJson(path.join(p.dir, "browser-mobile.json"));
    for (const u of [...(bm?.page?.scripts?.external || []), ...((bm?.requests || []).map((r) => r.url))]) if (SW_NAME_RE.test(u) && !regs.has(u)) { const e = cands.get(u) || { scriptURL: u, scope: null, evidence: [] }; e.evidence.push({ kind: "script-name", page: p.path }); cands.set(u, e); }
  }
  for (const m of manifests) notes.push(`a web app manifest is linked (${m}): sites with a manifest often have a worker; capture to be sure`);
  notes.push("static reading only: a register() call inside a bundled script is invisible here; run `ref-sw.mjs capture <origin>` for the browser's own list");
  return { origin, source: "static", registrations: [...regs.values()], candidates: [...cands.values()], manifests: [...manifests], notes };
}

// ---------- the new site ----------
const mapOnto = (scriptURL, oldHost) => { try { const u = new URL(scriptURL); return hostOf(u.href) === oldHost || !oldHost ? u.pathname + u.search : null; } catch { return null; } };

export async function checkServiceWorkers(inv, { newSite = null, newOrigin = null, oldHost = null, htmlPaths = ["/"], fetchImpl = fetch } = {}) {
  const host = oldHost || hostOf(inv.origin || "");
  const results = [], ignored = [];
  const items = [...inv.registrations.map((r) => ({ ...r, confirmed: true })), ...(inv.candidates || []).map((r) => ({ ...r, confirmed: false }))];
  let headerRules = [], redirectRules = [], files = [];
  if (newSite) { files = walkFiles(newSite); try { headerRules = parseHeadersFile(fs.readFileSync(path.join(newSite, "_headers"), "utf8")); } catch {} try { redirectRules = parseRedirectRules(fs.readFileSync(path.join(newSite, "_redirects"), "utf8")); } catch {} }
  // (b) Clear-Site-Data on every HTML response of the service
  const csd = async () => {
    const miss = []; let n = 0;
    if (newSite) {
      for (const f of files.filter((x) => /\.html?$/i.test(x))) { n++; const p = htmlUrlPath(f); const h = { ...configHeaders(newSite, p), ...headersFor(headerRules, p) }; if (!clearsSite(h["clear-site-data"])) miss.push(p); }
    } else {
      for (const p of htmlPaths) { n++; const r = await getOnce(new URL(p, newOrigin).href, { fetchImpl }); if (!clearsSite(r.headers?.["clear-site-data"])) miss.push(p); }
    }
    return { ok: n > 0 && !miss.length, n, miss };
  };
  let csdResult = null;
  for (const it of items) {
    const p = mapOnto(it.scriptURL, host);
    if (p == null) { ignored.push({ scriptURL: it.scriptURL, reason: "on another host: listed and ignored" }); continue; }
    const row = { scriptURL: it.scriptURL, path: p, scope: it.scope, confirmed: it.confirmed, evidence: it.evidence };
    let viaScript = null;
    if (newSite) {
      const f = path.join(newSite, p.split("?")[0]);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const mimeOk = /\.(m?js)$/i.test(f); const text = fs.readFileSync(f, "utf8");
        viaScript = text.includes("registration.unregister(") && mimeOk ? { ok: true } : { ok: false, why: !mimeOk ? "the file is not a .js file, so it is not served as JavaScript" : "the script does not contain registration.unregister(" };
      } else {
        const rd = applyRedirect(redirectRules, p.split("?")[0]);
        viaScript = rd ? { ok: false, redirect: true, status: rd.status, why: `the redirect plan sends it (${rd.status}) to ${rd.to}: browsers refuse a redirected worker script, so the old worker keeps running` } : { ok: false, why: "the new build has no file at that URL (404)", status: 404 };
      }
    } else {
      const r = await getOnce(new URL(p, newOrigin).href, { fetchImpl, wantText: true });
      if (r.status === 200) viaScript = JS_MIME.test(r.contentType) ? (r.text.includes("registration.unregister(") ? { ok: true } : { ok: false, why: "the script does not contain registration.unregister(", status: 200 }) : { ok: false, why: `answers 200 as ${r.contentType || "no content type"}, not JavaScript`, status: 200 };
      else if (r.status >= 300 && r.status < 400) viaScript = { ok: false, why: `redirects (${r.status}) to ${r.location}: browsers refuse a redirected worker script, so the old worker keeps running`, status: r.status, redirect: true };
      else viaScript = { ok: false, why: r.status == null ? `could not fetch: ${r.error}` : `answers ${r.status}: the old worker keeps controlling returning visitors`, status: r.status };
    }
    if (viaScript.ok) { Object.assign(row, { verdict: "PASS", via: "unregister-script", detail: "the new build answers the worker URL with a script that unregisters itself" }); }
    else {
      csdResult = csdResult || await csd();
      if (csdResult.ok) Object.assign(row, { verdict: "PASS", via: "clear-site-data", detail: `Clear-Site-Data on all ${csdResult.n} HTML response(s) checked` });
      else Object.assign(row, { verdict: it.confirmed ? "FAIL" : "WARN", finding: viaScript.redirect ? "redirect-target" : viaScript.status === 404 ? "status-mismatch" : "no-unregister", detail: `${viaScript.why}; and no Clear-Site-Data on every HTML response${csdResult.miss.length ? ` (missing on ${csdResult.miss.slice(0, 3).join(", ")}${csdResult.miss.length > 3 ? ", ..." : ""})` : ""}${it.confirmed ? "" : ". Only the script's name looked like a worker; confirm with capture"}` });
    }
    results.push(row);
  }
  // part sw-cache: only when the new build registers a worker
  let registersNew = false;
  if (newSite) { for (const f of files.filter((x) => /\.(html?|m?js)$/i.test(x)).slice(0, 400)) { try { if (/serviceWorker\s*\.\s*register\s*\(/.test(fs.readFileSync(path.join(newSite, f), "utf8"))) { registersNew = true; break; } } catch {} } }
  else { try { const r = await getOnce(new URL("/", newOrigin).href, { fetchImpl, wantText: true }); registersNew = /serviceWorker\s*\.\s*register\s*\(/.test(r.text || ""); } catch {} }
  const swCache = registersNew
    ? { status: "BLOCKED", detail: "the new build registers a service worker; the sw-cache part (after logout no cached logged-in page, 404 probe under the worker) needs the logout flow and CDP serviceWorkerResponseSource", unblock: "Run it where a flow runner and an account exist (the shipgate verify run), or read the worker's cache rules by hand and record the result." }
    : { status: "NOT-APPLICABLE", detail: "the new build registers no service worker on the pages read" };
  const fails = results.filter((r) => r.verdict === "FAIL");
  const status = fails.length ? "FAIL" : results.some((r) => r.confirmed) ? "PASS" : "NOT-APPLICABLE";
  return { rule: "REF-013", checkedAt: new Date().toISOString(), oldSource: inv.source, status, counts: { workers: results.filter((r) => r.confirmed).length, pass: results.filter((r) => r.verdict === "PASS").length, fail: fails.length, warn: results.filter((r) => r.verdict === "WARN").length }, results, ignored, swCache, notes: inv.notes || [],
    caveat: inv.source === "static" ? "static reading of the snapshot's HTML: a worker registered from inside a bundled script would not appear. Capture with the browser (ref-sw.mjs capture) to rule that out." : null };
}
export function swMarkdown(r) {
  const L = [`# Old service workers (REF-013): ${r.status}`, ""];
  if (r.status === "NOT-APPLICABLE") L.push(`The old site registered no service worker${r.caveat ? " that could be found (" + r.caveat + ")" : ""}; nothing to retire.`);
  else L.push(`${r.counts.workers} old worker(s): ${r.counts.pass} retired, ${r.counts.fail} not retired${r.counts.warn ? `, ${r.counts.warn} unconfirmed` : ""}.`);
  for (const x of r.results) L.push(`- ${x.verdict} ${x.path} (scope ${x.scope || "?"}): ${x.detail}${x.finding ? ` [${x.finding}]` : ""}`);
  for (const x of r.ignored) L.push(`- ignored ${x.scriptURL}: ${x.reason}`);
  L.push(`- sw-cache part: ${r.swCache.status}. ${r.swCache.detail}${r.swCache.unblock ? " Unblocks: " + r.swCache.unblock : ""}`);
  if (r.caveat) L.push("", `Caveat: ${r.caveat}`);
  return L.join("\n") + "\n";
}

// ---------- capture with real Chrome (one read-only page load) ----------
export async function captureRegistrations(origin, { settleMs = 3000 } = {}) {
  const { launchBrowser, CHROME_PATH } = await import("./cdp-measure.mjs");
  if (!CHROME_PATH) return { status: "BLOCKED", reason: "no Chrome or Edge found", unblock: "Install Chrome or set CHROME_PATH." };
  let b;
  try { b = await launchBrowser(); } catch (e) { return { status: "BLOCKED", reason: e.message, unblock: "Close other Chrome automation and run again." }; }
  try {
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    let loaded = false; const on = (m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") loaded = true; }; b.listeners.add(on);
    await b.send("Page.enable", {}, sessionId); await b.send("Page.navigate", { url: origin }, sessionId);
    for (let i = 0; i < 300 && !loaded; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, settleMs));
    const ev = await b.send("Runtime.evaluate", { expression: `(async () => { if (!navigator.serviceWorker) return []; const rs = await navigator.serviceWorker.getRegistrations(); return rs.map((r) => ({ scriptURL: (r.active || r.waiting || r.installing || {}).scriptURL || null, scope: r.scope })); })()`, awaitPromise: true, returnByValue: true }, sessionId, 20000);
    return { status: "ok", capturedAt: new Date().toISOString(), origin, registrations: ev.result.value || [] };
  } catch (e) { return { status: "BLOCKED", reason: e.message, unblock: "Run again; if it repeats, the page may never finish loading." }; }
  finally { try { await b.close(); } catch {} }
}

// ---------- CLI ----------
if (isMain(import.meta.url)) {
  const A = process.argv.slice(2); const cmd = A[0]; const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
  const usage = () => { console.error("usage: node ref-sw.mjs detect <snapshot dir> | check <snapshot dir|registrations.json> (--new-site <dir> | --new-origin <url>) [--paths /,/a/] [--out dir] | capture <origin> --out <file>"); process.exit(2); };
  const remoteOk = (o) => isLoopback(o) || A.includes("--allow-remote");
  try {
    if (cmd === "detect") {
      if (!A[1]) usage(); const inv = detectServiceWorkers(path.resolve(A[1]));
      if (opt("--out")) writeJson(path.resolve(opt("--out")), inv); console.log(JSON.stringify(inv, null, 1)); process.exit(0);
    } else if (cmd === "capture") {
      if (!A[1] || !opt("--out")) usage();
      if (!remoteOk(A[1])) { console.error("REFUSED: not a local address. A remote origin is only read with --allow-remote (one page load, GET only, the owner's say for a client's live site)."); process.exit(2); }
      const r = await captureRegistrations(A[1]);
      if (r.status !== "ok") { console.log(`BLOCKED: ${r.reason}. Unblocks: ${r.unblock}`); process.exit(3); }
      writeJson(path.resolve(opt("--out")), r); console.log(`recorded ${r.registrations.length} registration(s) into ${path.resolve(opt("--out"))}`); process.exit(0);
    } else if (cmd === "check") {
      if (!A[1] || (!opt("--new-site") && !opt("--new-origin"))) usage();
      if (opt("--new-origin") && !remoteOk(opt("--new-origin"))) { console.error("REFUSED: --new-origin is not local; pass --allow-remote (GET only, a handful of requests)."); process.exit(2); }
      const src = path.resolve(A[1]);
      const inv = fs.statSync(src).isDirectory() ? detectServiceWorkers(src) : { ...readJson(src), source: "recorded", candidates: [], notes: [] };
      const r = await checkServiceWorkers(inv, { newSite: opt("--new-site") ? path.resolve(opt("--new-site")) : null, newOrigin: opt("--new-origin"), htmlPaths: (opt("--paths", "/") || "/").split(",").filter(Boolean) });
      if (opt("--out")) { fs.mkdirSync(path.resolve(opt("--out")), { recursive: true }); writeJson(path.join(path.resolve(opt("--out")), "serviceworkers-check.json"), r); fs.writeFileSync(path.join(path.resolve(opt("--out")), "serviceworkers-check.md"), swMarkdown(r)); }
      // exitCode, not process.exit(): exiting while an HTTPS socket closes can crash node on Windows (libuv assertion, 0xC0000409)
      console.log(swMarkdown(r)); const code = r.status === "FAIL" ? 1 : 0; process.exitCode = code; setTimeout(() => process.exit(code), 8000).unref();
    } else usage();
  } catch (e) { if (e instanceof Stop429) { console.error("STOPPED: " + e.message); process.exit(3); } console.error(`ERROR ${e.message}`); process.exit(2); }
}
