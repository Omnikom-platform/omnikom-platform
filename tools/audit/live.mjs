// The live driver: judge a LIVE site with the same rules as a built folder, through the skill's polite snapshot.
//   node tools/audit/live.mjs <url> [--fresh] [--cwd DIR] [--max-age-days N] [--json] [--only MET-003,MET-001] [--psi FILE] [--target preview|production] [--prompt-coverage FILE] [-- <snapshot-site options>]
// It runs the skill's scripts/live-target.mjs as a child process with the same arguments (that script reuses a complete snapshot younger than
// 7 days, or takes a new one with snapshot-site.mjs: GET only, a gap between requests, robots.txt obeyed, one 429 allowance then stop), reads
// the line it prints (REUSE <dir> | NEW <dir> | FAILED <dir> ...), then runs audit() on that folder and prints the lines.
// It adds no crawling of its own and never fetches anything itself. Never pass --ignore-robots after `--` except for a URL the head names as ours.
// Exit: audit()'s exit (0 no FAIL, 1 at least one FAIL), 2 usage or configuration error, 3 the snapshot failed or stopped (a 429, a time cap,
// a crash): nothing is judged then and nothing is printed on stdout.
// OMNIKOM_AUDIT_LIVE_TARGET replaces the path of live-target.mjs (the tests point it at fixtures/live-target-standin.mjs, so tests make no request).
// OMNIKOM_AUDIT_LIVE_TIMEOUT_MS replaces the time limit (4 h 1 min) so a test can watch it fire.
// The whole process tree of the child is stopped, not only the child: the browser the skill's script starts is the child's child. That happens on the
// time limit, on SIGINT and SIGTERM (then exit 130 or 143), and on exit while the child is still alive. Windows: taskkill /PID <pid> /T /F. POSIX: the child
// is its own process group (detached) and the group is killed. A hard kill of this driver itself (SIGKILL, power loss) runs no code and is NOT handled here.
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "usage: node tools/audit/live.mjs <url> [--fresh] [--cwd DIR] [--max-age-days N] [--json] [--only MET-003,MET-001] [--psi FILE] [--target preview|production] [--prompt-coverage FILE] [-- <snapshot-site options>]";
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

const all = process.argv.slice(2);
const dd = all.indexOf("--");
const args = dd >= 0 ? all.slice(0, dd) : all;
const pass = dd >= 0 ? all.slice(dd + 1) : [];
let url = null, fresh = false, cwd = null, maxAge = null, json = false, only = null, psi = null, buildTarget = null, promptCoverage = null;
const value = (i, what) => { const v = args[i + 1]; if (v === undefined || v.startsWith("--")) die(`${what} needs a value\n${USAGE}`); return v; };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--fresh") fresh = true;
  else if (a === "--json") json = true;
  else if (a === "--cwd") { cwd = value(i, a); i++; }
  else if (a === "--max-age-days") { maxAge = value(i, a); i++; }
  else if (a === "--psi") { psi = value(i, a); i++; }
  else if (a === "--target") { buildTarget = value(i, a); i++; if (buildTarget !== "preview" && buildTarget !== "production") die(`--target needs preview or production (got ${JSON.stringify(buildTarget)})\n${USAGE}`); }
  else if (a === "--prompt-coverage") { promptCoverage = value(i, a); i++; }
  else if (a === "--only") { only = value(i, a).split(",").map((s) => s.trim()).filter(Boolean); i++; if (!only.length) die(`--only needs a rule id list\n${USAGE}`); }
  else if (a.startsWith("--")) die(`unknown option ${a}\n${USAGE}`);
  else if (url === null) url = a;
  else die(`more than one url given\n${USAGE}`);
}
if (!url || !/^https?:\/\//i.test(url)) die(`a http(s) url is needed\n${USAGE}`);

const target = process.env.OMNIKOM_AUDIT_LIVE_TARGET || path.resolve(HERE, "..", "..", "skills", "programmatic-enterprise-web-performance", "scripts", "live-target.mjs");
const childArgs = [target, url];
if (fresh) childArgs.push("--fresh");
if (cwd) childArgs.push("--cwd", cwd);
if (maxAge !== null) childArgs.push("--max-age-days", maxAge);
if (dd >= 0) childArgs.push("--", ...pass);

// The child's stdout is read line by line and every line but the verdict is passed on to our stderr as it comes (a crawl takes minutes), so
// that our stdout carries only the judged lines. live-target.mjs caps its own snapshot at 4 h; the limit here is one minute above that.
const TIMEOUT_MS = Number(process.env.OMNIKOM_AUDIT_LIVE_TIMEOUT_MS) > 0 ? Number(process.env.OMNIKOM_AUDIT_LIVE_TIMEOUT_MS) : 4 * 3600_000 + 60_000;
const WIN = process.platform === "win32";
let child = null;
const killTree = (c) => {
  if (!c || !c.pid || c.exitCode !== null || c.signalCode !== null) return;
  if (WIN) spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch {} } }
};
process.on("exit", () => killTree(child));
process.on("SIGINT", () => { killTree(child); process.exit(130); });
process.on("SIGTERM", () => { killTree(child); process.exit(143); });
const r = await new Promise((resolve) => {
  child = spawn(process.execPath, childArgs, { stdio: ["ignore", "pipe", "inherit"], detached: !WIN, windowsHide: true });
  const timer = setTimeout(() => { killTree(child); }, TIMEOUT_MS);
  let buf = "";
  const lines = [];
  const take = (l) => { if (/^(REUSE|NEW|FAILED) /.test(l)) lines.push(l); else if (l) console.error(l); };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => { buf += c; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(take); });
  child.on("error", (error) => { clearTimeout(timer); resolve({ error, lines, status: null }); });
  child.on("close", (status) => { clearTimeout(timer); take(buf); resolve({ lines, status }); });
});
const verdict = r.lines[r.lines.length - 1];
if (r.error) die(`FAILED: live-target.mjs could not run (${r.error.code || r.error.message}): ${target}`, 3);
if (r.status === 2 && !verdict) die(`live-target.mjs refused the arguments (exit 2); see its message above\n${USAGE}`, 2);
if (!verdict) die(`FAILED: live-target.mjs printed no REUSE, NEW or FAILED line (exit ${r.status}); nothing was judged`, 3);
if (verdict.startsWith("FAILED ")) die(`${verdict}\nnothing was judged`, 3);
const m = /^(REUSE|NEW) (.+?)(?: \(finished [^)]*\))?$/.exec(verdict);
if (!m) die(`FAILED: could not read the snapshot folder from "${verdict}"; nothing was judged`, 3);
const dir = path.resolve(m[2]);
console.error(`${m[1] === "REUSE" ? "reusing" : "new"} snapshot ${dir}`);

let engine;
try { engine = await import(new URL("./index.mjs", import.meta.url).href); }
catch (e) { die(`engine refused to load: ${e.message}`); }
try {
  const res = engine.audit(dir, { rules: only || undefined, psi: psi || undefined, target: buildTarget || undefined, promptCoverage: promptCoverage || undefined });
  if (json) console.log(JSON.stringify(res, null, 2));
  else {
    for (const l of res.lines) console.log(l);
    const n = (s) => res.findings.filter((f) => f.status === s).length;
    console.error(`${res.pass ? "OK" : "FAILED"}: ${res.pages.length} page(s), ${res.rules.length} rule(s), ${n("FAIL")} FAIL, ${n("WARN")} WARN, ${n("SKIP")} SKIP`);
  }
  process.exit(res.exit);
} catch (e) {
  if (e && e.exit === 2) die(e.message);
  throw e;
}
