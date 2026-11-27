// Usage: node test-test-kit.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// lib-test-kit.mjs runner(): a script whose own child (a grandchild of the test) holds the stdout pipe must not hang the runner.
// 2026-11-27: test-ledger.mjs hung 3 hours at no processor use; the runner killed only its direct child at the timeout and waited for
// "close", which never comes while a grandchild still holds the pipe. Each scenario runs a fixture from a temp folder and cleans up
// every process it started, also when an assertion is red.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checker, main, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = A.includes("--scripts") ? path.resolve(A[A.indexOf("--scripts") + 1]) : here;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const stopPid = (pid) => { if (!pid || !alive(pid)) return; if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true, timeout: 15000 }); else try { process.kill(pid, "SIGKILL"); } catch {} };
const within = (p, ms) => Promise.race([p.then((r) => ({ r })), sleep(ms).then(() => null)]);
const goneWithin = async (pids, ms) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) if (!pids.some(alive)) return true; return !pids.some(alive); };

// the fixture: writes {child, grand} to argv[3], starts a grandchild on the same stdout and stderr, then stays (argv[2] "stay") or exits.
// On Windows the grandchild is detached: a plain one sits in the job object libuv gives the child and dies with it, while a detached one
// (a browser, a watchdog) outlives it and keeps the pipe open. On Linux a plain one already outlives a killed parent.
const FIXTURE = [
  'import fs from "node:fs";',
  'import { spawn } from "node:child_process";',
  'const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"], detached: process.platform === "win32" });',
  'fs.writeFileSync(process.argv[3], JSON.stringify({ child: process.pid, grand: g.pid }));',
  'console.log("CHILD " + process.pid);',
  'if (process.argv[2] === "stay") setInterval(() => {}, 1000); else g.unref();',
].join("\n");

async function scenarios(dir) {
  const results = [], check = checker(results);
  const { runner } = await import(pathToFileURL(path.join(dir, "lib-test-kit.mjs")).href);
  const tmp = mkTmp("kit"), home = path.join(tmp, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(tmp, "netguard-import.mjs"), "");
  fs.writeFileSync(path.join(tmp, "tree.mjs"), FIXTURE);
  const run = runner(tmp, home, path.join(tmp, "net.log"));
  const pidsOf = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
  try {
    // K1, K2: the child outlives its timeout while a grandchild holds the pipe
    const f1 = path.join(tmp, "pids-1.json"), t0 = Date.now();
    const p1 = run("tree.mjs", ["stay", f1], { timeout: 3000 });
    const got1 = await within(p1, 3000 + 10000);
    check("K1: a child killed at its timeout while its own child holds the pipe: the runner returns within the timeout + 10 s, saying TIMED OUT",
      got1 && /TIMED OUT/.test(got1.r.se), got1 ? `returned after ${Date.now() - t0} ms; stderr: ${got1.r.se.slice(-200)}` : "no return after 13 s");
    const ids1 = pidsOf(f1);
    check("K2: after that timeout no process of the tree is left (the child and its child are stopped)",
      ids1.grand && (await goneWithin([ids1.child, ids1.grand], 5000)), `pids ${JSON.stringify(ids1)}; alive: ${[ids1.child, ids1.grand].filter((p) => p && alive(p)).join(", ") || "none"}`);
    stopPid(ids1.grand); stopPid(ids1.child);
    await within(p1, 5000);
    // K3: the child exits by itself and leaves a grandchild on the pipe
    const f2 = path.join(tmp, "pids-2.json");
    const p2 = run("tree.mjs", ["leave", f2], { timeout: 30000 });
    const got2 = await within(p2, 10000);
    check("K3: a child that exits leaving its own child on the pipe: the runner returns within 10 s with the child's exit code 0 and its output",
      got2 && got2.r.code === 0 && /^CHILD \d+/m.test(got2.r.so), got2 ? `exit ${got2.r.code}; stdout: ${got2.r.so.slice(0, 120)}` : "no return after 10 s");
    const ids2 = pidsOf(f2);
    stopPid(ids2.grand); stopPid(ids2.child);
    await within(p2, 5000);
  } finally { rmTmp(tmp); }
  return results;
}

const MUTANTS = [
  { name: "the timeout stops only the child", patches: [{ file: "lib-test-kit.mjs", from: "const stopTree = () =>", to: "const stopTree = () => c.kill(); const unused = () =>" }], expect: [/^K2:/] },
  { name: "the runner waits for close only", patches: [{ file: "lib-test-kit.mjs", from: 'c.on("exit", (code) => setTimeout(() => end(code), 1000));', to: "" }], expect: [/^K3:/] },
];

process.exit(await main({ label: "TEST KIT", scenarios, MUTANTS, scriptsDir, argv: A }));
