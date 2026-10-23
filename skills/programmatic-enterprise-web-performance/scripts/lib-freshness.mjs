// No fake freshness (IDX-003, SE-004, AEO-012): the dates a site writes into its output must be content dates, not the clock
// at build time. Found on proposals/vtv 2026-10-22: a fix worker added a sitemap whose <lastmod> was `new Date()` on every URL,
// so every rebuild claimed all 79 pages changed (search engines then learn to ignore the field).
// The test here: build the site twice from the same source and compare every date field the output carries. A date that moves
// between two builds of identical source is the build clock. Fields read (per URL or page file):
//   - every sitemap*.xml <lastmod> (sitemap indexes are followed on disk; .xml.gz is read too)
//   - JSON-LD dateModified / datePublished (anywhere in the object, @graph included)
//   - <meta property="article:modified_time"> and <meta property="og:updated_time">
//   - Last-Modified rules in a Netlify/Cloudflare `_headers` file
// Plus SE-004 on every sitemap lastmod: W3C datetime WITH seconds and a timezone (date-only fails), never more than a day ahead.
// Other output files that differ between the two builds are a WARN (a non-deterministic build), never a FAIL.
// Built-ins only. Used by check-stability.mjs (CLI), refactor.mjs (baseline + after each merge) and gate GT-013.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const SKIP_DIRS = new Set([".git", "node_modules", ".checks", ".pewp", ".cache", ".next", ".turbo"]);
const MAX_PARSE = 8 * 1024 * 1024;
const rel = (p) => p.replace(/\\/g, "/");
const sha = (b) => crypto.createHash("sha1").update(b).digest("hex");

export function walk(root, onFile, dir = root) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, onFile, p); }
    else if (e.isFile()) onFile(p, rel(path.relative(root, p)));
  }
}

const readText = (p) => {
  const b = fs.readFileSync(p);
  return /\.gz$/i.test(p) ? zlib.gunzipSync(b).toString("utf8") : b.toString("utf8");
};
export const isSitemapName = (name) => /sitemap[^/]*\.xml(\.gz)?$/i.test(name);

// <url>/<sitemap> entries of one sitemap file: [{ kind, loc, lastmod }]
export function parseSitemap(xml) {
  return [...xml.matchAll(/<(sitemap|url)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    kind: m[1].toLowerCase(),
    loc: ((m[2].match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i) || [])[1] || "").trim(),
    lastmod: (m[2].match(/<lastmod>\s*([^<]*?)\s*<\/lastmod>/i) || [])[1] ?? null,
  }));
}

// Every sitemap under root: the files named sitemap*.xml, plus whatever a sitemap index points to that is on disk.
export function findSitemaps(root) {
  const all = [];
  walk(root, (p, r) => all.push({ p, r }));
  const byRel = new Map(all.map((x) => [x.r, x.p]));
  const queue = all.filter((x) => isSitemapName(path.basename(x.r))).map((x) => x.r);
  const seen = new Set();
  const out = [];
  while (queue.length) {
    const r = queue.shift();
    if (seen.has(r)) continue;
    seen.add(r);
    const p = byRel.get(r);
    if (!p) continue;
    let entries = [];
    try { if (fs.statSync(p).size <= MAX_PARSE) entries = parseSitemap(readText(p)); } catch {}
    out.push({ file: r, path: p, mtimeMs: fs.statSync(p).mtimeMs, entries });
    for (const e of entries.filter((x) => x.kind === "sitemap" && x.loc)) {
      let pn = e.loc;
      try { pn = new URL(e.loc, "http://x/").pathname; } catch {}
      try { pn = decodeURIComponent(pn); } catch {} // a malformed %-escape stays as written
      pn = pn.replace(/^\/+/, "");
      // the child is the file whose path ends with the URL's path (a site built into dist/ serves dist/x.xml as /x.xml)
      const hit = byRel.has(pn) ? pn : [...byRel.keys()].find((k) => k.endsWith("/" + pn)) || [...byRel.keys()].find((k) => path.basename(k) === path.basename(pn));
      if (hit) queue.push(hit);
    }
  }
  return out;
}

// SE-004: YYYY-MM-DDThh:mm:ss(.fff) followed by Z or ±hh:mm
const W3C_FULL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function lastmodProblem(v, now = Date.now()) {
  const s = String(v ?? "").trim();
  if (!s) return "empty <lastmod>";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date-only (no time and timezone)";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return "no timezone";
  if (!W3C_FULL.test(s)) return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(s) ? "no seconds" : "not a W3C datetime";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "not a valid date";
  if (t > now + 86_400_000) return "in the future";
  return null;
}

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) || []).slice(2).find((x) => x != null);
const META_FIELDS = { "article:modified_time": "<meta article:modified_time>", "og:updated_time": "<meta og:updated_time>" };
function dateFieldsOfHtml(html) {
  const out = [];
  const visit = (o, at) => {
    if (Array.isArray(o)) o.forEach((x, i) => visit(x, `${at}[${i}]`));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
      if ((k === "dateModified" || k === "datePublished") && (typeof v === "string" || typeof v === "number")) out.push({ field: `JSON-LD ${k}`, at: `${at}.${k}`, value: String(v) });
      else visit(v, `${at}.${k}`);
    }
  };
  let n = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    n++;
    try { visit(JSON.parse(m[1]), `ld${n}`); } catch {}
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = (attr(m[0], "property") || attr(m[0], "name") || "").toLowerCase();
    if (META_FIELDS[prop]) out.push({ field: META_FIELDS[prop], at: prop, value: attr(m[0], "content") ?? "" });
  }
  return out;
}
function headersRules(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) { cur = line.trim(); continue; }
    const m = line.match(/^\s+Last-Modified\s*:\s*(.*)$/i);
    if (m && cur) out.push({ field: "_headers Last-Modified", at: cur, value: m[1].trim() });
  }
  return out;
}

// Everything that carries a date, plus a hash of every output file. -> { fields: Map(key -> {url, field, value}), sitemaps, files: Map(rel -> hash) }
export function collectDates(root) {
  const fields = new Map();
  const files = new Map();
  const put = (url, field, at, value, file) => fields.set(`${url}\u0000${field}\u0000${at}`, { url, field, value, file });
  walk(root, (p, r) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    files.set(r, st.size > 32 * 1024 * 1024 ? `big:${st.size}` : sha(fs.readFileSync(p)));
    if (st.size > MAX_PARSE) return;
    if (/\.html?$/i.test(r)) { for (const f of dateFieldsOfHtml(fs.readFileSync(p, "utf8"))) put(r, f.field, f.at, f.value, r); }
    else if (path.basename(r) === "_headers") { for (const f of headersRules(fs.readFileSync(p, "utf8"))) put(`${r} ${f.at}`, f.field, f.at, f.value, r); }
  });
  const sitemaps = findSitemaps(root);
  for (const sm of sitemaps) for (const e of sm.entries.filter((x) => x.lastmod != null)) put(e.loc || `(no loc) in ${sm.file}`, "sitemap <lastmod>", sm.file, e.lastmod, sm.file);
  return { root, fields, sitemaps, files };
}

// SE-004 on one collection (no second build needed).
export function lintSitemaps(snap, now = Date.now()) {
  const out = [];
  for (const sm of snap.sitemaps) for (const e of sm.entries.filter((x) => x.kind === "url" && x.lastmod != null)) {
    const why = lastmodProblem(e.lastmod, now);
    if (why) out.push({ rule: "SE-004", url: e.loc, field: "sitemap <lastmod>", value: e.lastmod, why, file: sm.file });
  }
  return out;
}

// The build-clock signature on ONE build: >= minUrls URLs of a sitemap all share one lastmod, within windowMs of the sitemap file's mtime.
export function buildClockSignature(sm, { minUrls = 5, windowMs = 10 * 60_000 } = {}) {
  const urls = sm.entries.filter((x) => x.kind === "url");
  if (urls.length < minUrls || urls.some((u) => !u.lastmod)) return null;
  // one stamp = a clock read once, or once per URL (milliseconds apart): all within one minute of each other
  const ts = urls.map((u) => Date.parse(u.lastmod));
  if (!ts.every(Number.isFinite) || Math.max(...ts) - Math.min(...ts) > 60_000) return null;
  const t = Math.max(...ts);
  if (Math.abs(t - sm.mtimeMs) > windowMs) return null;
  return { rule: "IDX-003", file: sm.file, urls: urls.length, value: urls[0].lastmod, why: `all ${urls.length} URLs share one lastmod (${urls[0].lastmod}, all within one minute)`+` within ${Math.round(windowMs / 60000)} min of the time the sitemap was written: the build clock, not content dates` };
}

// Two builds of the same source -> { status, failures[], se004[], warns[], notes[] }
export function judge(a, b, { now = Date.now() } = {}) {
  const failures = [];
  for (const k of new Set([...a.fields.keys(), ...b.fields.keys()])) {
    const x = a.fields.get(k), y = b.fields.get(k);
    if (x?.value === y?.value) continue;
    const f = x || y;
    failures.push({ rule: "IDX-003/AEO-012", url: f.url, field: f.field, file: f.file, a: x ? x.value : "(absent)", b: y ? y.value : "(absent)" });
  }
  const se004 = lintSitemaps(b, now);
  const dated = new Set(failures.map((f) => f.file));
  const warns = [];
  for (const k of new Set([...a.files.keys(), ...b.files.keys()])) {
    if (a.files.get(k) === b.files.get(k)) continue;
    if (dated.has(k)) continue;
    warns.push(k);
  }
  const notes = [];
  const urlCount = b.sitemaps.reduce((n, s) => n + s.entries.filter((e) => e.kind === "url").length, 0);
  if (!b.sitemaps.length && !b.fields.size) notes.push("no sitemap and no date fields in the output: nothing can claim freshness");
  else notes.push(`${b.sitemaps.length} sitemap file(s) with ${urlCount} URL(s); ${b.fields.size} date field(s) compared`);
  return { status: failures.length || se004.length ? "FAIL" : "PASS", failures, se004, warns, notes };
}

// Plain reason for a rejected fix: "it stamps the build time into sitemap <lastmod> on 79 pages (IDX-003/AEO-012)"
export function plainReason(list) {
  const parts = [];
  const byField = new Map();
  for (const f of list.filter((x) => x.rule !== "SE-004")) byField.set(f.field, (byField.get(f.field) || new Set()).add(f.url));
  for (const [field, urls] of byField) parts.push(`it stamps the build time into ${field} on ${urls.size} page${urls.size === 1 ? "" : "s"} (IDX-003/AEO-012)`);
  const se = list.filter((x) => x.rule === "SE-004");
  const byWhy = new Map();
  for (const f of se) byWhy.set(f.why, (byWhy.get(f.why) || 0) + 1);
  for (const [why, n] of byWhy) parts.push(`its sitemap lastmod is ${why} on ${n} URL${n === 1 ? "" : "s"} (SE-004)`);
  return parts.join("; ");
}
const keyOf = (f) => `${f.rule}\u0000${f.url}\u0000${f.field}\u0000${f.why || ""}`;
// Failures of `now` that the baseline did not already have (a pre-existing defect is not this fix's regression).
export function newFailures(base, now) {
  const had = new Set([...(base?.failures || []), ...(base?.se004 || [])].map(keyOf));
  return [...now.failures, ...now.se004].filter((f) => !had.has(keyOf(f)));
}

export function formatLines(res) {
  const L = [];
  for (const f of res.failures.slice(0, 40)) L.push(`FAIL ${f.rule} ${f.url} ${f.field}: build 1 "${f.a}" vs build 2 "${f.b}"`);
  if (res.failures.length > 40) L.push(`... and ${res.failures.length - 40} more changing date field(s)`);
  for (const f of res.se004.slice(0, 40)) L.push(`FAIL SE-004 ${f.url} sitemap <lastmod> "${f.value}": ${f.why} (${f.file})`);
  if (res.se004.length > 40) L.push(`... and ${res.se004.length - 40} more SE-004 lastmod problem(s)`);
  for (const w of res.warns.slice(0, 20)) L.push(`WARN non-deterministic build: ${w} differs between the two builds (no date field in it changed)`);
  if (res.warns.length > 20) L.push(`WARN ... and ${res.warns.length - 20} more differing file(s)`);
  for (const n of res.notes) L.push(`NOTE ${n}`);
  return L;
}

// ---------- AEO-012 across time, for a LIVE site (two snapshots of one host) ----------
// mainTextHash (AEO-012): the page's <main> text (else <body>), <time>/<script>/<style>/<noscript>/<template> removed, tags stripped,
// common entities decoded, NFKC, whitespace collapsed; sha256. snapshot-site.mjs records it in pages/<slug>/response.json.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function mainTextHash(html) {
  const s = String(html || "");
  const m = s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || s.match(/<body\b[^>]*>([\s\S]*?)(<\/body>|$)/i);
  const text = (m ? m[1] : s)
    .replace(/<(time|script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (all, e) => (ENT[e.toLowerCase()] ?? (/^#x/i.test(e) ? String.fromCodePoint(parseInt(e.slice(2), 16)) : /^#\d/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : all)))
    .normalize("NFKC").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(text).digest("hex");
}
const normUrl = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/+$/, "") || "/"; } catch { return String(u); } };
function readSnapshot(dir) {
  const J = (p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, p), "utf8")); } catch { return null; } };
  const site = J("_site.json");
  if (!site) return null;
  const lastmod = new Map();
  for (const u of J("site/sitemaps.json")?.urls || []) if (u.loc && u.lastmod != null) lastmod.set(normUrl(u.loc), u.lastmod);
  const pages = new Map();
  for (const p of site.pages || []) {
    const resp = J(`pages/${p.slug}/response.json`) || {};
    let h = resp.mainTextHash || null;
    if (!h) { try { h = mainTextHash(zlib.gunzipSync(fs.readFileSync(path.join(dir, "pages", p.slug, "raw.html.gz"))).toString("utf8")); } catch {} }
    if (h) pages.set(normUrl(p.url), { url: p.url, hash: h, recorded: !!resp.mainTextHash });
  }
  return { dir, at: site.finishedAt || site.startedAt || null, lastmod, pages };
}
// -> { status, findings: [{url, lastmodA, lastmodB}], changedText, compared, notes }. FAIL = lastmod moved, main text the same.
export function freshnessAcrossSnapshots(dirA, dirB) {
  const a = readSnapshot(dirA), b = readSnapshot(dirB);
  if (!a || !b) return { status: "ERROR", why: `no _site.json in ${!a ? dirA : dirB}`, findings: [], notes: [] };
  const findings = [], notes = [];
  let compared = 0, changedText = 0, noLastmod = 0;
  for (const [k, pb] of b.pages) {
    const pa = a.pages.get(k);
    if (!pa) continue;
    const la = a.lastmod.get(k), lb = b.lastmod.get(k);
    if (la == null || lb == null) { noLastmod++; continue; }
    compared++;
    if (pa.hash !== pb.hash) { changedText++; continue; }
    if (la !== lb) findings.push({ rule: "AEO-012", url: pb.url, lastmodA: la, lastmodB: lb });
  }
  if (!compared) return { status: "ERROR", why: `no page is in both snapshots with a sitemap lastmod in both (${noLastmod} page(s) in both lack one)`, findings, notes };
  notes.push(`${compared} page(s) in both snapshots with a sitemap lastmod in both; ${changedText} changed their main text`);
  if ([...a.pages.values(), ...b.pages.values()].some((p) => !p.recorded)) notes.push("mainTextHash computed from raw.html.gz for an older snapshot that did not record it");
  return { status: findings.length ? "FAIL" : "PASS", findings, compared, changedText, notes, at: { a: a.at, b: b.at } };
}

// ---------- child processes that cannot outlive their time limit ----------
// Measured on Windows 11 (2026-10-23): a spawnSync(cmd, { shell: true, timeout }) that times out kills cmd.exe only. Its children
// (a `node` build step, a Git Bash `sleep`) keep running, and keep writing into the folder, after the caller has moved on and even
// after the caller exits (libuv's job lets grandchildren break away; `taskkill /T` misses MSYS children). So on Windows a child is
// started by a small pwsh 7 supervisor that first puts itself into a NEW job object with KILL_ON_JOB_CLOSE: when the supervisor ends
// (its own timeout, or the caller killing it), Windows ends every process of the tree, MSYS ones included. Its own exit codes:
// 124 timed out (the tree was stopped), 127 could not start. Other platforms (or no pwsh 7): plain spawn, as before.
const JOB_CS = `using System; using System.Runtime.InteropServices;
public static class PewpJob {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IO Io; public UIntPtr p1, p2, p3, p4; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXT i, uint l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  public static IntPtr Enter() {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    if (j == IntPtr.Zero) throw new Exception("CreateJobObject failed: " + Marshal.GetLastWin32Error());
    EXT e = new EXT(); e.Basic.LimitFlags = 0x2000;
    if (!SetInformationJobObject(j, 9, ref e, (uint)Marshal.SizeOf(typeof(EXT)))) throw new Exception("SetInformationJobObject failed: " + Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(j, GetCurrentProcess())) throw new Exception("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error());
    return j;
  }
}`;
// the compiled helper is cached in the temp folder (compiling costs seconds; loading it does not)
const JOB_DLL = path.join(os.tmpdir(), `pewp-job-${sha(JOB_CS).slice(0, 10)}.dll`);
const SUPERVISOR = `$ErrorActionPreference = 'Stop'
try { $PSStyle.OutputRendering = 'PlainText' } catch {}
try {
  $dll = $env:PEWP_SUP_DLL
  if (-not (Test-Path -LiteralPath $dll)) {
    $tmp = "$dll.$PID.tmp"
    Add-Type -TypeDefinition $env:PEWP_SUP_CS -OutputAssembly $tmp
    try { Move-Item -LiteralPath $tmp -Destination $dll } catch { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  }
  Add-Type -LiteralPath $dll
  $null = [PewpJob]::Enter()
  $psi = [System.Diagnostics.ProcessStartInfo]::new($env:PEWP_SUP_EXE)
  $psi.UseShellExecute = $false
  if ($env:PEWP_SUP_RAW) { $psi.Arguments = $env:PEWP_SUP_RAW } else {
    $n = [int]$env:PEWP_SUP_ARGC
    if ($n -gt 0) {
      $parts = ([string]$env:PEWP_SUP_ARGS64).Split(',')
      if ($parts.Count -ne $n) { throw "the argument list arrived damaged ($($parts.Count) of $n parts)" }
      foreach ($b in $parts) { $psi.ArgumentList.Add([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))) }
    }
  }
  if ($env:PEWP_SUP_CWD) { $psi.WorkingDirectory = $env:PEWP_SUP_CWD }
  $p = [System.Diagnostics.Process]::Start($psi)
} catch { [Console]::Error.WriteLine("PEWP-SUPERVISOR: could not start $($env:PEWP_SUP_EXE): $($_.Exception.Message)"); exit 127 }
if (-not $p.WaitForExit([int]$env:PEWP_SUP_MS)) { [Console]::Error.WriteLine("PEWP-SUPERVISOR: timed out after $([math]::Round([int]$env:PEWP_SUP_MS / 1000)) s; the whole process tree was stopped"); exit 124 }
$p.WaitForExit()
exit $p.ExitCode
`;
// An executable on PATH (Windows: with its PATHEXT extension), or null.
export function whichExe(name, exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""]) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  for (const d of String(process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean)) {
    for (const e of [/\.[a-z0-9]+$/i.test(name) ? "" : null, ...exts].filter((x) => x != null)) { const p = path.join(d, name + e); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  }
  return null;
}
let pwshPath;
const pwsh = () => (pwshPath === undefined ? (pwshPath = process.platform === "win32" ? whichExe("pwsh.exe", [""]) : null) : pwshPath);
let warned = false;
const warnNoPwsh = () => { if (!warned && process.platform === "win32") { warned = true; console.error("WARNING: pwsh 7 not found: a child that times out is stopped, but its own children may keep running (install PowerShell 7)."); } };
// -> { command, args, env } to pass to spawn/spawnSync: `exe args` (or, with raw, `exe` + a verbatim Windows argument string)
// started inside a kill-on-close job that ends after timeoutMs. Callers keep their own timer as a backstop: killing the
// returned process (child.kill()) also ends the whole tree.
export function supervised(exe, args = [], { cwd = null, timeoutMs, raw = null, env = process.env } = {}) {
  const ps = pwsh();
  if (!ps) { warnNoPwsh(); return { command: exe, args, env, supervised: false, raw }; }
  return { command: ps, args: ["-NoProfile", "-NonInteractive", "-Command", SUPERVISOR], supervised: true,
    // args travel as base64 UTF-8, one per argument, plus a count: ConvertFrom-Json turned ISO date strings into PowerShell dates
    // ("2026-10-23T00:00:00Z" arrived as "10/23/2026 00:00:00"); base64 has no types, so every argument arrives byte-identical.
    env: { ...env, PEWP_SUP_EXE: exe, PEWP_SUP_ARGC: String(args.length), PEWP_SUP_ARGS64: args.map((a) => Buffer.from(String(a), "utf8").toString("base64")).join(","), PEWP_SUP_RAW: raw || "", PEWP_SUP_CWD: cwd ? path.resolve(cwd) : "", PEWP_SUP_MS: String(Math.max(1, Math.round(timeoutMs))), PEWP_SUP_DLL: JOB_DLL, PEWP_SUP_CS: JOB_CS } };
}
// A shell command line (a build), bounded: the whole tree ends at the time limit. -> { code (124 = timed out), tail, timedOut }
export function runShell(cmd, cwd, ms, { maxBuffer = 64 * 1024 * 1024 } = {}) {
  let r;
  if (process.platform === "win32" && pwsh()) {
    const s = supervised(process.env.ComSpec || "cmd.exe", [], { cwd, timeoutMs: ms, raw: `/d /s /c "${cmd}"` });
    r = spawnSync(s.command, s.args, { cwd, env: s.env, encoding: "utf8", timeout: ms + 60_000, maxBuffer, windowsHide: true });
  } else {
    warnNoPwsh();
    r = spawnSync(cmd, { shell: true, cwd, encoding: "utf8", timeout: ms, maxBuffer, windowsHide: true });
  }
  const timedOut = r.error?.code === "ETIMEDOUT" || r.status === 124 && /PEWP-SUPERVISOR: timed out/.test(r.stderr || "");
  const code = timedOut ? 124 : r.error ? 1 : r.status ?? 1;
  const why = r.error && !timedOut ? `${r.error.code || r.error.message}${r.error.code === "ENOBUFS" ? " (output over the buffer limit)" : ""}\n` : "";
  return { code, timedOut, tail: (why + (r.stdout || "") + (r.stderr || "")).trim().slice(-400) };
}

// ---------- the two builds ----------
const pause = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, 5000)); };
// git never prompts (no credentials, no editor); a leftover index.lock is retried once after 1.5 s, then named in the error.
export const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_EDITOR: "true" };
export function gitRun(cwd, args, { timeoutMs = 60_000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const once = () => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer, timeout: timeoutMs, env: { ...process.env, ...GIT_ENV }, windowsHide: true });
  let r = once();
  if (r.status === 128 && /index\.lock': File exists/.test(r.stderr || "")) { pause(1500); r = once(); }
  if (r.error?.code === "ETIMEDOUT") return { code: 124, raw: "", out: "", err: `git ${args[0]} took over ${Math.round(timeoutMs / 1000)} s (stopped)` };
  if (r.error) return { code: 1, raw: "", out: "", err: `git ${args[0]} could not run: ${r.error.code || r.error.message}` };
  const err = (r.stderr || "").trim();
  return { code: r.status, raw: r.stdout || "", out: (r.stdout || "").trim(), err: /index\.lock': File exists/.test(err) ? `${err}\n(another git process holds the repository's index.lock; if no git is running, delete that file)` : err };
}
const git = (cwd, ...a) => gitRun(cwd, a);
const OURS = /(^|\/)\.(checks|pewp)(\/|$)/;

// Rebuild once more in a folder that is already built and compare with what is there now (refactor: the merge loop has just built).
export function rebuildAndJudge(dir, build, { timeoutMs = 600_000, before = null, minGapMs = 1100, now } = {}) {
  const t0 = Date.now();
  const a = before || collectDates(dir);
  pause(minGapMs - (Date.now() - t0)); // a clock with one-second resolution must tick between the two builds
  const b2 = runShell(build, dir, timeoutMs);
  if (b2.code) return { status: "ERROR", why: `the second build failed (exit ${b2.code}): ${b2.tail}`, failures: [], se004: [], warns: [], notes: [] };
  return judge(a, collectDates(dir), { now });
}

// The CLI's full test: setup once, build, collect, build again, collect, compare; then restore a clean git checkout.
// A folder with uncommitted changes (or not in git) is built twice in place and NOT restored (there is no committed state to return to;
// a build only rewrites its own output), and the result says so.
export function checkStability(dir, { build, setup = null, timeoutMs = 600_000, now } = {}) {
  dir = path.resolve(dir);
  if (!build) return { status: "ERROR", why: "no build command", failures: [], se004: [], warns: [], notes: [] };
  const top = git(dir, "rev-parse", "--show-toplevel").out;
  // A git call that FAILS (a timeout, a held index.lock) is null, never "nothing changed": the restore below runs
  // `git checkout HEAD -- .` and deletes new untracked files, so a failed status read as clean would destroy uncommitted work.
  const status = () => { const r = git(dir, "status", "--porcelain=v1", "--untracked-files=all", "--", "."); return r.code === 0 ? r.out.split("\n").filter((l) => l && !OURS.test(l.slice(3))) : null; };
  const untracked = () => { const r = git(dir, "ls-files", "--others", "--exclude-standard", "--full-name", "--", "."); return r.code === 0 ? new Set(r.out.split("\n").filter((l) => l && !OURS.test(l))) : null; };
  const st0 = top ? status() : null;
  const head = top ? git(dir, "rev-parse", "--short", "HEAD").out : null;
  const untrackedBefore = top && st0 && st0.length === 0 ? untracked() : null;
  const clean = !!top && !!st0 && st0.length === 0 && !!head && !!untrackedBefore;
  const notes = [];
  if (top && !st0) notes.push("git status failed, so the folder is treated as having uncommitted changes: built twice in place and NOT restored");
  let res;
  try {
    if (setup) { const s = runShell(setup, dir, timeoutMs); if (s.code) return { status: "ERROR", why: `setup failed (exit ${s.code}): ${s.tail}`, failures: [], se004: [], warns: [], notes }; }
    const b1 = runShell(build, dir, timeoutMs);
    if (b1.code) return { status: "ERROR", why: `the build failed (exit ${b1.code}): ${b1.tail}`, failures: [], se004: [], warns: [], notes };
    res = rebuildAndJudge(dir, build, { timeoutMs, now });
  } finally {
    if (clean) {
      const co = git(dir, "checkout", "HEAD", "--", ".");
      const now = untracked();
      if (now) for (const f of now) if (!untrackedBefore.has(f)) fs.rmSync(path.join(top, f), { force: true });
      const left = status();
      notes.push(co.code !== 0 || !now || !left ? `RESTORE INCOMPLETE: git failed while restoring commit ${head} (${(co.err || "git status / ls-files failed").split("\n")[0]})` : left.length ? `RESTORE INCOMPLETE: ${left.length} path(s) still differ from commit ${head}: ${left.slice(0, 5).join(", ")}` : `built twice from commit ${head}; the working tree is restored to it`);
    } else if (!top || st0) notes.push(top ? "the folder had uncommitted changes: built twice in place and NOT restored (a build only rewrites its own output)" : "not a git checkout: built twice in place, not restored");
  }
  res.notes = [...(res.notes || []), ...notes];
  return res;
}
