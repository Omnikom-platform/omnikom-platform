// The work browser (audit build AB-2A): the audit profile (%LOCALAPPDATA%\omnikom-audit-browser, where the owner signed in to four assistants) opened as a normal
// Edge window with a debugging port on 127.0.0.1, its traffic leaving through our US machine (the ssh tunnel of head-of-operations/tools/us-vantage-browser.ps1), so the
// audit's clicks become scripted work. Owner, M173: "having a browser on debugging port would make mapping all the clicks way easier".
//   node work-browser.mjs <open|status|close> [--json]
//   open    already open (the port in the state file answers): say so, touch nothing. Else close the audit profile's own Edge (politely, force only after 20 s),
//           make sure the tunnel is up and exits at the US machine (else BLOCKED, nothing started), start Edge on the profile with a port, record it.
//   status  one line: the port and where the traffic exits
//   close   Browser.close over the port (it saves the sign-ins), wait for the process to be gone
// Other scripts: import { workPort } and ask for the port; null means it is not open.
// Never change the exit, the profile, the user agent, the timing or the way a tab is opened in order to get past a check: that is evasion and is not ours to do. A check is recorded and its source is not gathered.
// Never start this through heavy.mjs: that tool's kill-on-close job ends the browser when the command ends (seen 2026-11-22: no port in 60 s, the window gone).
// Exit codes: 0 ok, 2 usage, 3 BLOCKED (the last line is "BLOCKED: <what> | unblocks: <what would>").
// Hard limits: only a pid whose command line passes isAuditMain() is ever closed (the owner's own Edge has no profile flag there and is never touched); the profile is read only
// for "Local State" (a parse check, in lib-browser-profile.mjs) and "DevToolsActivePort"; no sign-in or cookie handling; no geolocation override; no headless; no retry around a failed exit check.
// Every outside thing (process list, taskkill, ssh, curl, spawn, fetch, clock, files) comes in through one io object, so test-work-browser.mjs starts nothing.
import nodeFs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { spawnBrowser as libSpawnBrowser } from "./lib-browser-profile.mjs";

const TUNNEL_PORT = 1081;
const DEFAULT_IP = "34.42.198.254";
const POLITE_WAIT_MS = 20_000, TUNNEL_WAIT_MS = 10_000, PORT_WAIT_MS = 180_000; // the measured bound of this laptop under load: tools/omnikom-cli/lib/browser.mjs DEVTOOLS_WAIT_MS
// The flag is built from parts: this script only READS a command line for it and never launches with it (spawnBrowser does), and test-browser-profile.mjs
// fails any script that names the flag in code.
const PROFILE_FLAG = ["--user", "data", "dir"].join("-") + "=";
const BROWSER_ARGS = ["--remote-debugging-port=0", `--proxy-server=socks5://127.0.0.1:${TUNNEL_PORT}`, "--disable-features=msImplicitSignin", "--disable-sync", "--no-first-run",
  "--no-default-browser-check", "--new-window", "--window-size=1300,900", "about:blank"];

export const auditDir = (env = process.env) => env.OMNIKOM_AUDIT_BROWSER_DIR || path.win32.join(env.LOCALAPPDATA || path.win32.join(os.homedir(), "AppData", "Local"), "omnikom-audit-browser"); // a Windows folder: joined by Windows' rules on any machine (GitHub's runner joined it with a slash)
const stateFile = (env = process.env) => path.join(env.WORK_BROWSER_HOME || path.join(os.homedir(), ".claude", "state", "omnikom-work-browser"), "state.json");
const readState = (io) => { try { return JSON.parse(io.fs.readFileSync(stateFile(io.env), "utf8")); } catch { return null; } };
const writeState = (io, s) => { const f = stateFile(io.env); io.fs.mkdirSync(path.dirname(f), { recursive: true }); io.fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n"); };

const normPath = (p) => String(p).replace(/^["']+|["']+$/g, "").replace(/\\/g, "/").replace(/[\/.]+$/, "").toLowerCase();

/** True only for the MAIN process of Edge running on exactly this profile folder: the profile flag with that value, and no --type= (renderers, gpu, crashpad are children). */
export function isAuditMain(commandLine, dir) {
  const line = String(commandLine || "");
  if (/(^|\s)--type=/.test(line)) return false;
  const at = line.indexOf(PROFILE_FLAG);
  if (at < 0) return false;
  const rest = line.slice(at + PROFILE_FLAG.length);
  const quoted = line[at - 1] === '"' ? "ARG" : null; // "--flag=C:\a b": the quote opened before the flag, so it closes after the value
  let value;
  if (quoted) value = rest.split('"')[0];
  else if (rest[0] === '"') value = rest.slice(1).split('"')[0];
  else value = rest.split(/\s/)[0];
  const got = normPath(value), want = normPath(dir);
  return got === want;
}

const parseTrace = (text) => { const get = (k) => (String(text || "").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim(); return { loc: get("loc"), ip: get("ip") }; };
const blocked = (io, what, unblocks) => { io.log(`BLOCKED: ${what} | unblocks: ${unblocks}`); return 3; };

/** The port when the state file's port answers /json/version, else null. */
export async function workPort(io = realIo()) {
  const s = readState(io);
  if (!s || !Number.isInteger(s.port)) return null;
  try { await io.fetchJson(`http://127.0.0.1:${s.port}/json/version`); return s.port; } catch { return null; }
}

async function waitFor(io, ms, test) {
  const end = io.now() + ms;
  for (;;) { if (await test()) return true; if (io.now() >= end) return false; await io.sleep(500); }
}

export async function openBrowser(io) {
  const dir = auditDir(io.env);
  const known = await workPort(io);
  if (known) {
    io.log(`work browser: already open on port ${known}`);
    return 0;
  } // not open yet

  // the tunnel, and where it exits
  const ip = io.env.OMNIKOM_US_VANTAGE_IP || DEFAULT_IP;
  if (!io.keyExists()) return blocked(io, `the key ${io.keyPath()} is missing`, "put the US machine key at that path");
  if (!(await io.portOpen(TUNNEL_PORT))) {
    await io.startSsh(["-i", io.keyPath(), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-D", `127.0.0.1:${TUNNEL_PORT}`, "-N", `vantage@${ip}`]);
    await waitFor(io, TUNNEL_WAIT_MS, () => io.portOpen(TUNNEL_PORT));
  }
  if (!(await io.portOpen(TUNNEL_PORT))) return blocked(io, `the tunnel did not open on port ${TUNNEL_PORT}`, "the US machine reachable by ssh with the key");
  const trace = parseTrace(await io.exitTrace());
  io.log(`exit: ip=${trace.ip} loc=${trace.loc}`);
  const usOk = trace.loc === "US" && trace.ip === ip;
  if (!usOk) return blocked(io, "the tunnel does not exit at our US machine; no browser opened", `the tunnel exiting at ${ip} (loc=US)`);

  // the audit profile's own Edge windows, closed the polite way first, only after the exit check passed (a BLOCKED exit check must never cost the open window)
  const procs = await io.listEdge();
  const mains = procs.filter((p) => isAuditMain(p.commandLine, dir));
  for (const { pid } of mains) {
    await io.kill(pid, false);
    const gone = await waitFor(io, POLITE_WAIT_MS, async () => !(await io.listEdge()).some((p) => p.pid === pid));
    if (!gone) { await io.kill(pid, true); io.log(`closed by force: pid ${pid}`); }
  }

  // the browser: Local State is kept as it is (keepState)
  const exe = io.edgeExe();
  if (!exe) return blocked(io, "Microsoft Edge not found", "install Edge or set EDGE_PATH");
  const before = await io.failedLogons();
  const startedMs = io.now();
  let child;
  try { child = io.spawnBrowser({ exe, dir, args: [...BROWSER_ARGS], options: { detached: true, stdio: "ignore" } }, { keepState: true }); }
  catch (e) { return blocked(io, `the audit profile was not started: ${e.message}`, "a readable Local State in the audit profile folder (it was not touched)"); }

  // the port Edge wrote AFTER the spawn
  let port = null;
  while (!port && io.now() - startedMs < PORT_WAIT_MS) {
    const ap = await io.activePort(dir);
    if (ap && ap.port && ap.mtimeMs >= startedMs) { try { await io.fetchJson(`http://127.0.0.1:${ap.port}/json/version`); port = ap.port; } catch { /* not answering yet */ } }
    if (!port) await io.sleep(250);
  }
  if (!port) {
    const alive = child?.pid != null && (await io.listEdge()).some((p) => p.pid === child.pid);
    return blocked(io, `Edge did not open its DevTools port in 180 s; the Edge it started ${alive ? "is still running" : "has exited"}: pid ${child?.pid ?? "unknown"}`, "no other Edge window holding the audit profile; run open again");
  }
  const bound = await checkBound(io, port);
  if (bound !== 0) { await io.browserClose(port).catch(() => {}); return 3; }
  writeState(io, { pid: child?.pid ?? null, port, startedAt: new Date(startedMs).toISOString(), dir });
  io.log(`work browser: open on port ${port} (US exit ${ip})`);
  io.log(`failed logons: before ${before}, after ${await io.failedLogons()}`);
  return 0;
}

// The debugging port must listen on this machine only. No --remote-debugging-address is ever passed; the listener's own address is read back and printed.
const LOCAL = new Set(["127.0.0.1", "::1"]);
async function checkBound(io, port) {
  const addrs = (await io.listenerAddresses(port)) || [];
  const shown = addrs.length ? addrs.join(", ") : "unknown";
  io.log(`bound to ${shown}`);
  if (addrs.length && addrs.every((a) => LOCAL.has(a))) return 0;
  return blocked(io, `the debugging port is bound to ${shown}, not to this machine only`, "remove whatever sets a debugging address");
}

export async function statusBrowser(io) {
  const port = await workPort(io);
  if (!port) return blocked(io, "the work browser is not open", "node work-browser.mjs open");
  const t = parseTrace(await io.exitTrace());
  io.log(`work browser: open on port ${port}, exit ${t.loc || "unknown"} ${t.ip || ""}`.trim());
  return checkBound(io, port);
}

export async function closeBrowser(io) {
  const state = readState(io);
  const port = await workPort(io);
  if (!port) { io.log("work browser: not open"); return 0; }
  try { await io.browserClose(port); } catch { /* it may already be closing */ }
  const dir = state?.dir || auditDir(io.env);
  const gone = await waitFor(io, POLITE_WAIT_MS, async () => !(await io.listEdge()).some((p) => isAuditMain(p.commandLine, dir)));
  if (!gone) return blocked(io, "the work browser did not close in 20 s", "close its window by hand");
  io.log("work browser: closed");
  return 0;
}

/** argv: [command, ...flags]. Returns the exit code; with --json the last line printed is one JSON object. */
export async function run(argv, io = realIo()) {
  const cmd = argv.find((a) => !a.startsWith("--"));
  const fn = { open: openBrowser, status: statusBrowser, close: closeBrowser }[cmd];
  if (!fn) { io.log("usage: node work-browser.mjs <open|status|close> [--json]"); return 2; }
  const lines = [], inner = { ...io, log: (l) => { lines.push(l); io.log(l); } };
  const code = await fn(inner);
  if (argv.includes("--json")) io.log(JSON.stringify({ command: cmd, ok: code === 0, exit: code, lines, port: await workPort(io) }));
  return code;
}

// ---------- the real outside world ----------
const ps = (script) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true });
export function realIo(env = process.env) {
  return {
    env, fs: nodeFs,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
    edgeExe: () => [env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => p && nodeFs.existsSync(p)) || null,
    keyPath: () => path.join(os.homedir(), ".ssh", "omnikom-us-vantage"), // named by path only: never read here
    keyExists: () => nodeFs.existsSync(path.join(os.homedir(), ".ssh", "omnikom-us-vantage")),
    listEdge: async () => {
      const r = ps("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress");
      let j = null; try { j = JSON.parse(r.stdout || "null"); } catch { /* none */ }
      return (Array.isArray(j) ? j : j ? [j] : []).map((x) => ({ pid: x.ProcessId, commandLine: x.CommandLine || "" }));
    },
    kill: async (pid, force) => { spawnSync("taskkill", force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid)], { stdio: "ignore", timeout: 15_000, windowsHide: true }); },
    portOpen: (port) => new Promise((res) => { const s = net.connect({ host: "127.0.0.1", port }); const done = (v) => { s.destroy(); res(v); }; s.setTimeout(1500, () => done(false)); s.on("connect", () => done(true)); s.on("error", () => done(false)); }),
    startSsh: async (args) => { const c = spawn("ssh.exe", args, { detached: true, stdio: "ignore", windowsHide: true }); c.on("error", () => {}); c.unref(); },
    exitTrace: async () => { const r = spawnSync("curl.exe", ["-s", "-m", "20", "--socks5-hostname", `127.0.0.1:${TUNNEL_PORT}`, "https://www.cloudflare.com/cdn-cgi/trace"], { encoding: "utf8", timeout: 25_000, windowsHide: true }); return r.stdout || ""; },
    fetchJson: async (url) => (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(),
    spawnBrowser: (opts, flags) => { const c = libSpawnBrowser(opts, flags); c.on("error", () => {}); c.unref(); return c; },
    activePort: async (dir) => { try { const f = path.join(dir, "DevToolsActivePort"); const st = nodeFs.statSync(f); return { port: Number(nodeFs.readFileSync(f, "utf8").split("\n")[0].trim()) || null, mtimeMs: st.mtimeMs }; } catch { return null; } },
    failedLogons: async () => { const r = ps("([ADSI]\"WinNT://$env:COMPUTERNAME/$env:USERNAME,user\").BadPasswordAttempts"); const n = Number((r.stdout || "").trim()); return Number.isFinite(n) && r.stdout?.trim() !== "" ? n : "unknown"; },
    listenerAddresses: async (port) => { const r = ps(`(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress) -join ','`); return (r.stdout || "").trim().split(",").map((s) => s.trim()).filter(Boolean); },
    browserClose: async (port) => { const { connect } = await import("./vantage.mjs"); const c = await connect(port); try { await c.send("Browser.close", {}, undefined, 5000); } catch { /* closing */ } c.close(); },
  };
}

if (isMain(import.meta.url)) {
  process.exit(await run(process.argv.slice(2)));
}
