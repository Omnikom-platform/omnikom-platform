// Usage: node test-browser-leftovers.mjs [path to cdp-measure.mjs]   (default: the cdp-measure.mjs beside this file)
//        run it through the machine heavy-job lock: node ~/.claude/scripts/heavy.mjs -- node scripts/test-browser-leftovers.mjs
// Proof that launchBrowser() (cdp-measure.mjs) leaves nothing behind: no browser process and no pewp-chrome-* profile folder.
// History: on 2026-11-01 orphaned headless browsers and 149 leftover pewp-chrome-* folders in %TEMP% overloaded the laptop.
// Each case runs a small child Node script that imports cdp-measure.mjs (path given as an argument, so the test can be pointed at
// another copy, e.g. the old file for a watched-fail) and calls launchBrowser() under a PRIVATE temp root (TEMP/TMP/TMPDIR of the
// child), so the only pewp-chrome-* folder in it is the case's own. The child records the profile folder and the browser PID
// (DevTools SystemInfo.getProcessInfo) in a file, then:
//   a  close      await b.close() and end normally
//   b  exit       open a page (Target.createTarget about:blank) and call process.exit(0) without close: the exit guard must act
//   c  uncaught   throw an uncaught error after launch, without close
// A case passes only if, within 10 s of the child's end, (1) no process whose command line contains that profile folder exists
// and (2) the profile folder is gone. A FAIL names every survivor PID and the folder. The test then cleans up what it found:
// taskkill /T /F on those PIDs only (POSIX: SIGKILL), and removes that case's folder only.
// NOT tested: a hard kill of the child (TerminateProcess, SIGKILL) runs no handler by definition; the machine reaper
// ~/.claude/hooks/reap-orphans.mjs covers it. A signal (Ctrl-C) cannot be sent portably on Windows either, so SIGINT/SIGTERM are
// not tested here.
// Process listing: Windows  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object ... CommandLine contains
// the folder (passed in an environment variable, so the lister's own command line never holds it)"; POSIX  ps -eo pid,args.
// No Chrome or Edge on the machine: prints a BLOCKED line naming what is missing and exits 1 (never passes silently).
// Local only: about:blank, no network. Output: ok/FAIL lines, then `OK: N of N` or `FAILED: N of N`. Exit 0 or 1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === "win32";
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const CHILD = String.raw`import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [, , cdp, mode, info] = process.argv;
const m = await import(pathToFileURL(cdp).href);
const b = await m.launchBrowser();
let pid = null;
try { const r = await b.send("SystemInfo.getProcessInfo", {}, undefined, 8000); pid = (r.processInfo.find((p) => p.type === "browser") || {}).id ?? null; } catch {}
const dirs = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("pewp-chrome-")).map((n) => path.join(os.tmpdir(), n));
fs.writeFileSync(info, JSON.stringify({ dir: dirs[0] || null, dirs, pid }));
if (mode === "close") { await b.close(); }
else if (mode === "exit") { await b.send("Target.createTarget", { url: "about:blank" }); process.exit(0); }
else if (mode === "uncaught") { throw new Error("browser-leftovers test: uncaught error after launch, no close()"); }
`;

// Process ids (not this lister) whose command line contains <dir>.
function listByDir(dir) {
  if (WIN) {
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID -and $_.CommandLine.Contains($env:PEWP_LEFTOVER_DIR) } | Select -Expand ProcessId";
    const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 60000, windowsHide: true, env: { ...process.env, PEWP_LEFTOVER_DIR: dir } });
    if (r.error || r.status !== 0) throw new Error(`process listing failed: ${r.error ? r.error.message : `exit ${r.status} ${(r.stderr || "").slice(0, 200)}`}`);
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number);
  }
  const r = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8", timeout: 30000 });
  if (r.error || r.status !== 0) throw new Error(`process listing failed: ${r.error ? r.error.message : `exit ${r.status}`}`);
  return r.stdout.split("\n").map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((x) => x && x[2].includes(dir) && Number(x[1]) !== process.pid && !/^ps -eo/.test(x[2])).map((x) => Number(x[1]));
}
function killPids(pids) {
  if (!pids.length) return;
  if (WIN) spawnSync("taskkill", ["/T", "/F", ...pids.flatMap((p) => ["/PID", String(p)])], { stdio: "ignore", timeout: 30000, windowsHide: true });
  else for (const p of pids) { try { process.kill(p, "SIGKILL"); } catch {} }
}

function runCase(label, mode, target, work) {
  const root = fs.mkdtempSync(path.join(work, `case-${mode}-`)); // the child's private temp root
  const info = path.join(work, `info-${mode}.json`);
  const childFile = path.join(work, "child.mjs");
  const r = spawnSync(process.execPath, [childFile, target, mode, info], {
    encoding: "utf8", timeout: 90000, windowsHide: true,
    env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root, NODE_OPTIONS: "" },
  });
  const timedOut = !!(r.error && r.error.code === "ETIMEDOUT");
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(info, "utf8")); } catch {}
  const finish = (ok, detail) => ({ name: `${label}: ${mode}`, ok, detail });
  let result;
  const dirsNow = () => { try { return fs.readdirSync(root).filter((n) => n.startsWith("pewp-chrome-")).map((n) => path.join(root, n)); } catch { return []; } };
  if (!rec || !rec.dir) {
    const left = dirsNow();
    result = finish(false, `child did not launch a browser (exit ${r.status}${timedOut ? ", TIMED OUT after 90 s" : ""}); stderr: ${(r.stderr || "").trim().slice(0, 400)}${left.length ? `; folder(s) left: ${left.join(", ")}` : ""}`);
    for (const d of left) { try { killPids(listByDir(d)); } catch {} }
  } else {
    const dir = rec.dir;
    const deadline = Date.now() + 10000;
    let survivors = [], folder = true;
    for (;;) {
      survivors = listByDir(dir);
      folder = fs.existsSync(dir);
      if ((!survivors.length && !folder) || Date.now() >= deadline) break;
      sleepSync(500);
    }
    const problems = [];
    if (timedOut) problems.push("child did not end within 90 s");
    if (survivors.length) problems.push(`${survivors.length} process(es) still hold the profile folder, PID ${survivors.join(", ")}${rec.pid ? ` (browser PID was ${rec.pid})` : ""}`);
    if (folder) problems.push("profile folder still exists");
    result = finish(!problems.length, `${problems.join("; ")}; folder ${dir}; child exit ${r.status}`);
    // clean up: only what this case found
    if (survivors.length) { killPids(survivors); sleepSync(1500); }
    if (fs.existsSync(dir)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {} }
  }
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
  return result;
}

// Control: the process lister must see a live process whose command line holds a folder name, and stop seeing it once it is killed.
// Without this, "no survivors" could just mean the lister is blind.
function controlCase(work) {
  const dir = path.join(work, "pewp-chrome-control");
  const sleeper = path.join(work, "sleeper.mjs");
  fs.writeFileSync(sleeper, "setTimeout(() => {}, 60000);\n");
  const p = spawn(process.execPath, [sleeper, dir], { stdio: "ignore", windowsHide: true });
  let seen = [], gone = [];
  try {
    for (let i = 0; i < 20 && !seen.length; i++) { sleepSync(500); seen = listByDir(dir); }
    killPids(seen);
    for (let i = 0; i < 20; i++) { sleepSync(500); gone = listByDir(dir); if (!gone.length) break; }
  } finally { try { p.kill(); } catch {} }
  const ok = seen.includes(p.pid) && !gone.length;
  return { name: "control: the process lister sees a live process holding the folder name and loses it when killed", ok, detail: `saw PID(s) ${seen.join(", ") || "none"} (started PID ${p.pid}); after kill still listed: ${gone.join(", ") || "none"}` };
}

async function main() {
  const A = process.argv.slice(2);
  if (A.includes("--help") || A.includes("-h")) {
    console.log("Usage: node test-browser-leftovers.mjs [path to cdp-measure.mjs]  (exit 0 = no browser process or profile folder left in any case)");
    return 0;
  }
  const target = path.resolve(A[0] || path.join(here, "cdp-measure.mjs"));
  if (!fs.existsSync(target)) { console.log(`BLOCKED: ${target} does not exist (needs the cdp-measure.mjs to test)`); return 1; }
  const mod = await import(pathToFileURL(target).href);
  if (!mod.CHROME_PATH) { console.log("BLOCKED: no Chrome or Edge found on this machine (set CHROME_PATH, or install Chrome or Edge); the browser-leftovers cases cannot run"); return 1; }
  console.log(`target: ${target}\nbrowser: ${mod.CHROME_PATH}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-leftover-test-"));
  fs.writeFileSync(path.join(work, "child.mjs"), CHILD);
  const results = [];
  try {
    try { results.push(controlCase(work)); } catch (e) { results.push({ name: "control: process lister", ok: false, detail: `test error: ${e.message}` }); }
    for (const [label, mode] of [["a", "close"], ["b", "exit"], ["c", "uncaught"]]) {
      try { results.push(runCase(label, mode, target, work)); }
      catch (e) { results.push({ name: `${label}: ${mode}`, ok: false, detail: `test error: ${e.message}` }); }
    }
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
  }
  for (const r of results) console.log(`${r.ok ? "ok" : "FAIL"} ${r.name}${r.ok ? "" : `  ${r.detail}`}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `FAILED: ${bad} of ${results.length}` : `OK: ${results.length} of ${results.length}`);
  return bad ? 1 : 0;
}

if (isMain(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.log(`FAILED: test crashed: ${e.stack || e.message}`); process.exit(1); });
