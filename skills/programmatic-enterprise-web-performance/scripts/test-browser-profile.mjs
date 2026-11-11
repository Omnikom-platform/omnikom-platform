// Usage: node test-browser-profile.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of lib-browser-profile.mjs (machine-health fix 2026-11-11): the first start of Chrome or Edge on a brand-new profile folder tries to log on to the Windows account with
// an EMPTY password (one failed logon each; ten close together lock the account). A profile whose "Local State" already says the password is not blank is not probed, so every
// launcher seeds that file BEFORE it spawns the browser. Proved here: the file is written before the spawn (a fake spawn records the order) and holds both keys; an existing
// Local State keeps everything else; and a GUARD over every script: no script names --user-data-dir or spawns a browser except through the helper. No browser is started here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const NOW = 1_700_000_000_000; // (NOW + 11644473600000) * 1000
const STAMP = "13344473600000000";

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("bprofile");
  const lib = await import(pathToFileURL(path.join(dir, "lib-browser-profile.mjs")).href + "?" + Math.random());
  try {
    // ---- the helper: order and content ----
    const events = [];
    const rfs = { ...fs, writeFileSync: (...a) => { events.push(`write ${path.basename(a[0])}`); return fs.writeFileSync(...a); }, mkdirSync: (...a) => { events.push("mkdir"); return fs.mkdirSync(...a); } };
    const p1 = path.join(tmp, "fresh");
    let seenAtSpawn = null, spawnArgs = null;
    const fakeSpawn = (exe, args, options) => { events.push("spawn"); seenAtSpawn = fs.existsSync(path.join(p1, "Local State")) ? fs.readFileSync(path.join(p1, "Local State"), "utf8") : null; spawnArgs = { exe, args, options }; return { pid: 1 }; };
    const child = lib.spawnBrowser({ exe: "C:/fake/chrome.exe", dir: p1, args: ["--headless=new", "about:blank"], options: { stdio: "ignore" } }, { fs: rfs, spawn: fakeSpawn, now: () => NOW });
    check("profile: the profile's Local State is written BEFORE the browser is spawned (a fake spawn sees the file, and the recorded order is mkdir, write Local State, spawn)", events.join() === "mkdir,write Local State,spawn" && seenAtSpawn !== null, `${events.join()} | at spawn: ${seenAtSpawn}`);
    const written = (() => { try { return JSON.parse(fs.readFileSync(path.join(p1, "Local State"), "utf8")); } catch { return null; } })();
    check("profile: the file is JSON with password_manager.os_password_blank false and os_password_last_changed the Chrome time of now ((ms + 11644473600000) * 1000, as a string)", written?.password_manager?.os_password_blank === false && written.password_manager.os_password_last_changed === STAMP && typeof written.password_manager.os_password_last_changed === "string", JSON.stringify(written));
    check("profile: the spawn gets the exe, --user-data-dir=<the profile> first, then the caller's args and options, and returns the child", spawnArgs?.exe === "C:/fake/chrome.exe" && spawnArgs.args[0] === `--user-data-dir=${p1}` && spawnArgs.args.slice(1).join() === "--headless=new,about:blank" && spawnArgs.options?.stdio === "ignore" && child.pid === 1, JSON.stringify(spawnArgs));
    check("profile: chromeTime is microseconds since 1601 (now 1700000000000 ms gives 13344473600000000)", lib.chromeTime(NOW) === STAMP && lib.chromeTime(0) === "11644473600000000", `${lib.chromeTime(NOW)} ${lib.chromeTime(0)}`);

    // ---- an existing Local State is merged into, never replaced ----
    const p2 = path.join(tmp, "used");
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, "Local State"), JSON.stringify({ browser: { enabled_labs_experiments: ["x"] }, password_manager: { other_key: 5, os_password_blank: true, os_password_last_changed: "1" }, profile: { last_used: "Default" } }));
    lib.seedProfile(p2, { now: () => NOW });
    const m = JSON.parse(fs.readFileSync(path.join(p2, "Local State"), "utf8"));
    check("profile: an existing Local State keeps everything else (browser, profile, the other password_manager keys) and only the two password_manager keys are set", m.browser?.enabled_labs_experiments?.[0] === "x" && m.profile?.last_used === "Default" && m.password_manager.other_key === 5 && m.password_manager.os_password_blank === false && m.password_manager.os_password_last_changed === STAMP, JSON.stringify(m));
    const p3 = path.join(tmp, "corrupt");
    fs.mkdirSync(p3, { recursive: true });
    fs.writeFileSync(path.join(p3, "Local State"), "{ not json");
    let threw = null; try { lib.seedProfile(p3, { now: () => NOW }); } catch (e) { threw = e.message; }
    const c = (() => { try { return JSON.parse(fs.readFileSync(path.join(p3, "Local State"), "utf8")); } catch { return null; } })();
    check("profile: a Local State that is not JSON (or is a list) is replaced by a valid seed, never an error", !threw && c?.password_manager?.os_password_blank === false, `${threw} ${JSON.stringify(c)}`);
    const p4 = path.join(tmp, "deep", "er", "dir");
    lib.seedProfile(p4, { now: () => NOW });
    check("profile: the profile folder is made when it does not exist (nested too)", fs.existsSync(path.join(p4, "Local State")));

    // ---- the guard over every script ----
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    const text = (f) => fs.readFileSync(path.join(dir, f), "utf8");
    const code = (f) => text(f).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"); // comment lines do not launch anything
    const isTest = (f) => /^(test-|mutants-)/.test(f) || f === "lib-browser-profile.mjs";
    const named = files.filter((f) => !isTest(f) && /user-data-dir/.test(code(f)));
    check("guard: no script names --user-data-dir except through lib-browser-profile.mjs (a launcher that builds the flag itself would skip the seed)", named.length === 0, named.join(", "));
    const raw = files.filter((f) => !isTest(f) && /\bspawn(?:Sync)?\(\s*(?:CHROME|EDGE|CHROME_PATH|EDGE_PATH|chromePath|edgePath)\b/.test(code(f)));
    check("guard: no script spawns Chrome or Edge on its own (spawn(CHROME ...) / spawn(EDGE ...)); spawnBrowser() is the way", raw.length === 0, raw.join(", "));
    const launchers = ["cdp-measure.mjs", "vantage.mjs"];
    const bad = launchers.filter((f) => !files.includes(f) || !/from "\.\/lib-browser-profile\.mjs"/.test(text(f)) || !/\bspawnBrowser\(/.test(code(f)));
    check("guard: the known launchers (cdp-measure.mjs, vantage.mjs) import lib-browser-profile.mjs and call spawnBrowser()", bad.length === 0, bad.join(", "));
    const pw = files.filter((f) => !isTest(f) && /\b(chromium|firefox|webkit)\.(launch|launchPersistentContext)\(/.test(code(f)));
    check("guard: a Playwright launch exists only in lib-shots.mjs, the one known exemption (Playwright makes its own profile and refuses --user-data-dir; it is NOT seeded, see the header of lib-shots.mjs); a new one fails here until someone decides", pw.join() === "lib-shots.mjs" && /NOT SEEDED/.test(text("lib-shots.mjs")), `${pw.join()} / marker: ${/NOT SEEDED/.test(text("lib-shots.mjs"))}`);
  } finally { rmTmp(tmp); }
  return results;
}

const LB = "lib-browser-profile.mjs", CM = "cdp-measure.mjs", VA = "vantage.mjs";
const MUTANTS = [
  { name: "the Local State is not written", patches: [{ file: LB, from: "fs.writeFileSync(file, JSON.stringify(state));", to: "" }], expect: [/^profile: the profile's Local State is written BEFORE/, /^profile: the file is JSON/, /^profile: an existing Local State keeps/] },
  { name: "the browser is spawned before the seed", patches: [{ file: LB, from: "seedProfile(dir, io);\n  return (io.spawn || nodeSpawn)(exe, [`--user-data-dir=${dir}`, ...args], options);", to: "const c = (io.spawn || nodeSpawn)(exe, [`--user-data-dir=${dir}`, ...args], options);\n  seedProfile(dir, io);\n  return c;" }], expect: [/^profile: the profile's Local State is written BEFORE/] },
  { name: "os_password_blank is not false", patches: [{ file: LB, from: "os_password_blank: false,", to: "os_password_blank: true," }], expect: [/^profile: the file is JSON/, /^profile: an existing Local State keeps/] },
  { name: "the last-changed stamp is left out", patches: [{ file: LB, from: ", os_password_last_changed: chromeTime(now()) }", to: " }" }], expect: [/^profile: the file is JSON/] },
  { name: "the stamp is in milliseconds, not Chrome time", patches: [{ file: LB, from: "String((BigInt(ms) + 11644473600000n) * 1000n)", to: "String(BigInt(ms))" }], expect: [/^profile: chromeTime is microseconds/, /^profile: the file is JSON/] },
  { name: "an existing Local State is overwritten, not merged", patches: [{ file: LB, from: "state = { ...state, password_manager: { ...pm,", to: "state = { password_manager: { ...pm," }], expect: [/^profile: an existing Local State keeps/] },
  { name: "the other password_manager keys are dropped", patches: [{ file: LB, from: "password_manager: { ...pm, os_password_blank", to: "password_manager: { os_password_blank" }], expect: [/^profile: an existing Local State keeps/] },
  { name: "a corrupt Local State is an error", patches: [{ file: LB, from: "} catch { /* no file yet, or not JSON: start clean */ }", to: "} catch (e) { if (e instanceof SyntaxError) throw e; }" }], expect: [/^profile: a Local State that is not JSON/] },
  { name: "the profile folder is not made", patches: [{ file: LB, from: "fs.mkdirSync(dir, { recursive: true });\n  const file", to: "const file" }], expect: [/^profile: the profile folder is made/, /^profile: the profile's Local State is written BEFORE/] },
  { name: "cdp-measure.mjs spawns Chrome itself again", patches: [{ file: CM, from: "const proc = spawnBrowser({ exe: CHROME, dir, args: [", to: "const proc = spawn(CHROME, [`--user-data-dir=${dir}`, " }], expect: [/^guard: no script names --user-data-dir/, /^guard: no script spawns Chrome or Edge on its own/, /^guard: the known launchers/] },
  { name: "vantage.mjs spawns Edge itself again", patches: [{ file: VA, from: "const child = spawnBrowser({ exe: EDGE, dir: prof, args, options: { detached: true, stdio: \"ignore\" } });", to: "const child = spawn(EDGE, [`--user-data-dir=${prof}`, ...args], { detached: true, stdio: \"ignore\" });" }], expect: [/^guard: no script names --user-data-dir/, /^guard: no script spawns Chrome or Edge on its own/, /^guard: the known launchers/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-browser-profile.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "BROWSER PROFILE", scenarios, MUTANTS, scriptsDir, argv: A }));
}
