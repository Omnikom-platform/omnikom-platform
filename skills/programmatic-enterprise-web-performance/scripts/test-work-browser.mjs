// Usage: node test-work-browser.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--json]
// Proof of work-browser.mjs (audit build AB-2A): the audit profile opened as a normal Edge window with a debugging port, through our US machine, its Local State untouched.
// No browser, no network, no ssh: every outside thing (process list, taskkill, ssh, curl, spawn, fetch, clock) is a fake handed in through the io object. The state file
// is written for real, into a temp folder. Mutants patch a temp copy of the scripts folder and must turn the named assertions red.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);

const DIR = "C:\\Users\\x\\AppData\\Local\\omnikom-audit-browser";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const AUDIT_LINE = '"' + EDGE + '" --user-data-dir="' + DIR + '" --proxy-server=socks5://127.0.0.1:1081 --no-first-run about:blank';
const OWNER_LINE = '"' + EDGE + '" --no-startup-window --win-session-start';
const RENDERER_LINE = '"' + EDGE + '" --type=renderer --user-data-dir="' + DIR + '" --lang=en-US';
const TRACE_US = "fl=1\nip=34.42.198.254\nloc=US\ncolo=SJC\n";
const NINE = ["--remote-debugging-port=0", "--proxy-server=socks5://127.0.0.1:1081", "--disable-features=msImplicitSignin", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--new-window", "--window-size=1300,900", "about:blank"];

// A world of fakes. o: procs [{pid, commandLine}], answering [ports], tunnel (bool), trace, politeWorks, activeAge (ms before the spawn the DevToolsActivePort was written; null = fresh)
function world(home, o = {}) {
  const w = { T: 1_000_000, ev: [], lines: [], kills: [], spawned: [], ssh: [], alive: new Set((o.procs || []).map((p) => p.pid)), answering: new Set(o.answering || []), tunnel: o.tunnel ?? true, closes: [] };
  w.procs = o.procs || [];
  w.io = {
    env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local", WORK_BROWSER_HOME: home, ...(o.env || {}) },
    fs,
    now: () => w.T,
    sleep: async (ms) => { w.T += ms; },
    log: (l) => w.lines.push(l),
    edgeExe: () => EDGE,
    keyPath: () => "C:\\Users\\x\\.ssh\\omnikom-us-vantage",
    keyExists: () => true,
    listEdge: async () => w.procs.filter((p) => w.alive.has(p.pid)),
    kill: async (pid, force) => { w.kills.push({ pid, force, at: w.T }); if (force || (o.politeWorks ?? true)) w.alive.delete(pid); },
    portOpen: async (p) => (p === 1081 ? w.tunnel : w.answering.has(p)),
    startSsh: async (args) => { w.ssh.push(args); w.tunnel = true; },
    exitTrace: async () => o.trace ?? TRACE_US,
    fetchJson: async (url) => { const m = /127\.0\.0\.1:(\d+)\/json\/version/.exec(url); if (m && w.answering.has(Number(m[1]))) return { Browser: "Edg/1" }; throw new Error("no answer"); },
    spawnBrowser: (opts, flags) => { w.spawned.push({ opts, flags, at: w.T }); w.spawnAt = w.T; if (o.startedAlive) { w.procs.push({ pid: 4242, commandLine: "x" }); w.alive.add(4242); } w.ev.push("spawn"); w.answering.add(9222); return { pid: 4242, on() {}, unref() {} }; },
    activePort: async () => (w.spawnAt === undefined ? { port: 1111, mtimeMs: w.T - 99999 } : { port: 9222, mtimeMs: o.activeAge === undefined ? w.spawnAt + 500 : w.spawnAt - o.activeAge }),
    failedLogons: async () => 0,
    listenerAddresses: async () => o.bound || ["127.0.0.1"],
    browserClose: async (p) => { w.closes.push(p); w.answering.delete(p); for (const x of w.procs) w.alive.delete(x.pid); },
  };
  return w;
}

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("workbrowser");
  const wb = await import(pathToFileURL(path.join(dir, "work-browser.mjs")).href + "?" + Math.random());
  const home = (n) => path.join(tmp, n);
  const stateOf = (n) => { try { return JSON.parse(fs.readFileSync(path.join(home(n), "state.json"), "utf8")); } catch { return null; } };
  try {
    // 1. isAuditMain
    const m = (line) => wb.isAuditMain(line, DIR);
    check("isAuditMain: the exact folder is true", m(AUDIT_LINE) === true, "");
    check("isAuditMain: quotes, forward slashes, another case and a trailing slash are the same folder",
      m('"' + EDGE + '" --user-data-dir=' + DIR) === true && m(EDGE + ' --user-data-dir="' + DIR.replace(/\\/g, "/") + '"') === true && m(EDGE + " --user-data-dir=" + DIR.toUpperCase()) === true &&
      m(EDGE + ' --user-data-dir="' + DIR + '\\"') === true && m(EDGE + ' --user-data-dir="' + DIR + '/"') === true && m('"' + EDGE + '" "--user-data-dir=' + DIR + '"') === true, "");
    check("isAuditMain: the owner's own Edge (no --user-data-dir) is false", m(OWNER_LINE) === false, "");
    check("isAuditMain: a folder that only starts the same (omnikom-audit-browser-2) is false", m(EDGE + ' --user-data-dir="' + DIR + '-2"') === false, "");
    check("isAuditMain: a folder inside it (\\Default) is false", m(EDGE + ' --user-data-dir="' + DIR + '\\Default"') === false, "");
    check("isAuditMain: a line with --type=renderer is false", m(RENDERER_LINE) === false && m(EDGE + " --type=crashpad-handler --user-data-dir=" + DIR) === false, "");
    check("isAuditMain: no line at all is false", m("") === false && m(undefined) === false, "");

    // 2. open when the port answers
    let w = world(home("a"), { procs: [{ pid: 100, commandLine: AUDIT_LINE }] });
    fs.mkdirSync(home("a"), { recursive: true });
    fs.writeFileSync(path.join(home("a"), "state.json"), JSON.stringify({ pid: 100, port: 9333, startedAt: "x", dir: DIR }));
    w.answering.add(9333);
    let code = await wb.run(["open"], w.io);
    check("open: when the port in the state file answers it says already open, exits 0, closes nothing and spawns nothing",
      code === 0 && w.lines.join("|") === "work browser: already open on port 9333" && w.kills.length === 0 && w.spawned.length === 0 && w.ssh.length === 0, JSON.stringify({ code, lines: w.lines, kills: w.kills, spawned: w.spawned.length }));

    // 3. open with one audit main, one renderer of it and the owner's Edge
    const procs3 = [{ pid: 100, commandLine: AUDIT_LINE }, { pid: 101, commandLine: RENDERER_LINE }, { pid: 200, commandLine: OWNER_LINE }];
    w = world(home("b"), { procs: procs3 });
    code = await wb.run(["open"], w.io);
    check("open: only the audit main is closed, politely, and force is not used when the polite close worked",
      code === 0 && w.kills.length === 1 && w.kills[0].pid === 100 && w.kills[0].force === false && !w.lines.some((l) => /closed by force/.test(l)), JSON.stringify({ code, kills: w.kills, lines: w.lines }));
    check("open: the owner's Edge and the renderer are never handed to any kill", !w.kills.some((k) => k.pid === 200 || k.pid === 101), JSON.stringify(w.kills));
    check("open: the browser is spawned only after the close", w.spawned.length === 1 && w.spawned[0].at >= w.kills[0].at, JSON.stringify({ k: w.kills, s: w.spawned.map((s) => s.at) }));
    w = world(home("c"), { procs: procs3, politeWorks: false });
    code = await wb.run(["open"], w.io);
    const pol = w.kills.find((k) => k.pid === 100 && !k.force), frc = w.kills.find((k) => k.pid === 100 && k.force);
    check("open: when the polite close does not end the process, force comes only after a wait of at least 20 s, once, and is reported",
      pol && frc && w.kills.indexOf(pol) < w.kills.indexOf(frc) && frc.at - pol.at >= 20_000 && w.kills.filter((k) => k.force).length === 1 && w.lines.includes("closed by force: pid 100"), JSON.stringify({ kills: w.kills, lines: w.lines }));
    check("open: even when force is needed the owner's Edge and the renderer are never killed", w.kills.every((k) => k.pid === 100), JSON.stringify(w.kills));

    // 4. the exit check
    for (const [label, trace] of [["another country", "ip=34.42.198.254\nloc=EG\n"], ["another address", "ip=1.2.3.4\nloc=US\n"], ["no answer", ""]]) {
      w = world(home("d"), { procs: [], trace });
      code = await wb.run(["open"], w.io);
      const last = w.lines[w.lines.length - 1] || "";
      check("open: an exit in " + label + " is BLOCKED, exit 3, the last line is the BLOCKED line, and nothing is spawned or closed",
        code === 3 && /^BLOCKED: .+ \| unblocks: .+/.test(last) && w.spawned.length === 0 && w.kills.length === 0, JSON.stringify({ code, last, spawned: w.spawned.length }));
    }
    w = world(home("d2"), { procs: procs3, trace: "ip=34.42.198.254\nloc=EG\n" });
    code = await wb.run(["open"], w.io);
    check("open: a BLOCKED exit check with an audit main running closes nothing (the open window is kept)", code === 3 && w.kills.length === 0 && w.spawned.length === 0 && w.alive.has(100), JSON.stringify({ code, kills: w.kills }));
    w = world(home("e"), { procs: [], tunnel: false });
    code = await wb.run(["open"], w.io);
    check("open: with port 1081 closed the tunnel is started with the key named by path, then the exit is checked", w.ssh.length === 1 && w.ssh[0].includes("-D") && w.ssh[0].includes("127.0.0.1:1081") && w.ssh[0].some((a) => /omnikom-us-vantage/.test(a)) && w.ssh[0].includes("vantage@34.42.198.254") && code === 0, JSON.stringify({ code, ssh: w.ssh }));

    // 5. the spawn and the state file
    w = world(home("f"), { procs: [] });
    code = await wb.run(["open"], w.io);
    const sp = w.spawned[0];
    check("open: the spawn gets the nine args, no --headless, keepState true, the audit folder and Edge", code === 0 && sp && JSON.stringify(sp.opts.args) === JSON.stringify(NINE) && !sp.opts.args.some((a) => /headless/.test(a)) && sp.flags?.keepState === true && sp.opts.dir === DIR && sp.opts.exe === EDGE, JSON.stringify({ code, sp }));
    const st = stateOf("f");
    check("open: the state file holds pid, port read back, startedAt and dir; the lines say port and exit, and the failed logon count",
      st && st.port === 9222 && st.pid === 4242 && st.dir === DIR && !!st.startedAt && w.lines.includes("work browser: open on port 9222 (US exit 34.42.198.254)") && w.lines.some((l) => /^failed logons: before 0, after 0$/.test(l)), JSON.stringify({ st, lines: w.lines }));
    check("open: the spawn never holds --remote-debugging-address, and the listener's address is printed (bound to 127.0.0.1)", !sp.opts.args.some((a) => /remote-debugging-address/.test(a)) && w.lines.includes("bound to 127.0.0.1"), JSON.stringify({ args: sp.opts.args, lines: w.lines }));
    w = world(home("f2"), { procs: [], bound: ["0.0.0.0"] });
    code = await wb.run(["open"], w.io);
    check("open: a listener on 0.0.0.0 closes the browser at once (Browser.close), exits 3 with the BLOCKED line, and writes no state file",
      code === 3 && w.closes.join() === "9222" && w.lines[w.lines.length - 1] === "BLOCKED: the debugging port is bound to 0.0.0.0, not to this machine only | unblocks: remove whatever sets a debugging address" && w.lines.includes("bound to 0.0.0.0") && stateOf("f2") === null, JSON.stringify({ code, closes: w.closes, lines: w.lines }));
    check("open: OMNIKOM_AUDIT_BROWSER_DIR names the profile folder when set", await (async () => { const x = world(home("g"), { procs: [], env: { OMNIKOM_AUDIT_BROWSER_DIR: "D:\\other\\audit" } }); await wb.run(["open"], x.io); return x.spawned[0]?.opts.dir === "D:\\other\\audit"; })(), "");

    // 6. a DevToolsActivePort older than the spawn
    w = world(home("h"), { procs: [], activeAge: 5000 });
    code = await wb.run(["open"], w.io);
    check("open: a DevToolsActivePort older than the spawn is not believed (BLOCKED after the wait, no state file)", code === 3 && /^BLOCKED: /.test(w.lines[w.lines.length - 1]) && stateOf("h") === null && w.T - w.spawnAt >= 179_000 && /has exited: pid 4242$/.test(w.lines[w.lines.length - 1].split(" | ")[0]), JSON.stringify({ code, lines: w.lines, st: stateOf("h") }));

    w = world(home("h2"), { procs: [], activeAge: 5000, startedAlive: true });
    code = await wb.run(["open"], w.io);
    check("open: when the wait runs out it says the Edge it started is still running (pid) when it is", code === 3 && /the Edge it started is still running: pid 4242 \| unblocks: /.test(w.lines[w.lines.length - 1]), JSON.stringify({ code, lines: w.lines }));

    // 7. status and close
    w = world(home("i"), {});
    code = await wb.run(["status"], w.io);
    check("status: nothing open is exit 3 with the BLOCKED line", code === 3 && w.lines[w.lines.length - 1] === "BLOCKED: the work browser is not open | unblocks: node work-browser.mjs open", JSON.stringify({ code, lines: w.lines }));
    code = await wb.run(["close"], w.io);
    check("close: nothing open says so and exits 0, closing nothing", code === 0 && w.closes.length === 0 && w.kills.length === 0 && w.lines.some((l) => /not open/.test(l)), JSON.stringify({ code, lines: w.lines }));
    w = world(home("j"), { procs: [{ pid: 4242, commandLine: AUDIT_LINE }], answering: [9222] });
    fs.mkdirSync(home("j"), { recursive: true });
    fs.writeFileSync(path.join(home("j"), "state.json"), JSON.stringify({ pid: 4242, port: 9222, startedAt: "x", dir: DIR }));
    code = await wb.run(["status"], w.io);
    check("status: open says port and exit", code === 0 && w.lines[0] === "work browser: open on port 9222, exit US 34.42.198.254", JSON.stringify({ code, lines: w.lines }));
    check("workPort: the port when it answers, null when it does not", (await wb.workPort(w.io)) === 9222 && (await wb.workPort(world(home("k"), {}).io)) === null, "");
    code = await wb.run(["close"], w.io);
    check("close: goes over the port (the clean way), waits for the process to be gone, kills nothing", code === 0 && w.closes.join() === "9222" && w.kills.length === 0, JSON.stringify({ code, closes: w.closes, kills: w.kills, lines: w.lines }));
    code = await wb.run(["nonsense"], w.io);
    check("usage: an unknown command is exit 2", code === 2, String(code));
  } finally { rmTmp(tmp); }
  return results;
}

const WB = "work-browser.mjs";
const MUTANTS = [
  { name: "the --type= test is removed", patches: [{ file: WB, from: 'if (/(^|\\s)--type=/.test(line)) return false;', to: "" }], expect: [/^isAuditMain: a line with --type=renderer is false/, /^open: only the audit main is closed/] },
  { name: "the folder compare is a prefix (startsWith)", patches: [{ file: WB, from: "return got === want;", to: "return got.startsWith(want);" }], expect: [/^isAuditMain: a folder that only starts the same/, /^isAuditMain: a folder inside it/] },
  { name: "force comes before the wait", patches: [{ file: WB, from: "await io.kill(pid, false);\n    const gone", to: "await io.kill(pid, false);\n    await io.kill(pid, true);\n    const gone" }], expect: [/^open: only the audit main is closed, politely/] },
  { name: "every Edge is killed, not only the audit mains", patches: [{ file: WB, from: "const mains = procs.filter((p) => isAuditMain(p.commandLine, dir));", to: "const mains = procs;" }], expect: [/^open: only the audit main is closed/, /^open: the owner's Edge and the renderer/] },
  { name: "the country check is removed", patches: [{ file: WB, from: "const usOk = trace.loc === \"US\" && trace.ip === ip;", to: "const usOk = trace.ip === ip;" }], expect: [/^open: an exit in another country/] },
  { name: "the address check is removed", patches: [{ file: WB, from: "const usOk = trace.loc === \"US\" && trace.ip === ip;", to: "const usOk = trace.loc === \"US\";" }], expect: [/^open: an exit in another address/] },
  { name: "the bound address test is removed", patches: [{ file: WB, from: "if (addrs.length && addrs.every((a) => LOCAL.has(a))) return 0;", to: "return 0;" }], expect: [/^open: a listener on 0.0.0.0/] },
  { name: "the close comes before the exit check", patches: [{ file: WB, from: "const ip = io.env.OMNIKOM_US_VANTAGE_IP || DEFAULT_IP;", to: "for (const p of await io.listEdge()) if (isAuditMain(p.commandLine, dir)) await io.kill(p.pid, false);\n  const ip = io.env.OMNIKOM_US_VANTAGE_IP || DEFAULT_IP;" }], expect: [/^open: a BLOCKED exit check with an audit main running closes nothing/] },
  { name: "keepState is dropped from the spawn", patches: [{ file: WB, from: "{ keepState: true }", to: "{}" }], expect: [/^open: the spawn gets the nine args/] },
  { name: "--headless is added", patches: [{ file: WB, from: '"--new-window",', to: '"--new-window", "--headless=new",' }], expect: [/^open: the spawn gets the nine args/] },
  { name: "an old DevToolsActivePort is believed", patches: [{ file: WB, from: "ap.mtimeMs >= startedMs", to: "true" }], expect: [/^open: a DevToolsActivePort older than the spawn/] },
  { name: "already open still closes and spawns", patches: [{ file: WB, from: "return 0;\n  } // not open yet", to: "} // not open yet" }], expect: [/^open: when the port in the state file answers/] },
  { name: "close forces the process", patches: [{ file: WB, from: "await io.browserClose(port);", to: "await io.browserClose(port); await io.kill(state.pid, true);" }], expect: [/^close: goes over the port/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-work-browser.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--json]"); process.exit(0); }
  process.exit(await main({ label: "WORK BROWSER", scenarios, MUTANTS, scriptsDir, argv: A.filter((a) => a !== "--mutants") }));
}
