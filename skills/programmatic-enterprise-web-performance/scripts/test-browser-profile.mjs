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
    let child = null, e1 = ""; try { child = lib.spawnBrowser({ exe: "C:/fake/chrome.exe", dir: p1, args: ["--headless=new", "about:blank"], options: { stdio: "ignore" } }, { fs: rfs, spawn: fakeSpawn, now: () => NOW }); } catch (e) { e1 = e.message; }
    check("profile: the profile's Local State is written BEFORE the browser is spawned (a fake spawn sees the file, and the recorded order is mkdir, write Local State, spawn)", events.join() === "mkdir,write Local State,spawn" && seenAtSpawn !== null, `${events.join()} | at spawn: ${seenAtSpawn} | ${e1}`);
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
    let e4 = ""; try { lib.seedProfile(p4, { now: () => NOW }); } catch (e) { e4 = e.message; }
    check("profile: the profile folder is made when it does not exist (nested too)", fs.existsSync(path.join(p4, "Local State")), e4);

    // ---- keepState: a profile that already has sign-ins keeps its Local State byte for byte (audit build AB-2A) ----
    const keep = (name, content) => {
      const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true });
      if (content !== null) fs.writeFileSync(path.join(d, "Local State"), content);
      const spawned = []; let err = "";
      try { lib.spawnBrowser({ exe: "C:/fake/edge.exe", dir: d, args: ["about:blank"] }, { keepState: true, spawn: (exe, args) => { spawned.push(args); return { pid: 2 }; }, now: () => NOW }); } catch (e) { err = e.message; }
      return { d, spawned, err, after: fs.existsSync(path.join(d, "Local State")) ? fs.readFileSync(path.join(d, "Local State")) : null };
    };
    const good = '{\n  "os_crypt": { "encrypted_key": "ZZ" },\n  "password_manager": { "os_password_blank": false, "os_password_last_changed": "1" }\n}\n';
    const k1 = keep("keep-good", good);
    check("keepState: a good Local State (os_password_blank false) is byte for byte the same after spawnBrowser, and the browser was spawned", k1.after && k1.after.equals(Buffer.from(good)) && k1.spawned.length === 1 && !k1.err, `${k1.err} ${k1.after}`);
    const k2 = keep("keep-broken", "{ not json");
    check("keepState: a Local State that cannot be parsed throws, nothing is spawned, the file is unchanged", /cannot be parsed/.test(k2.err) && k2.spawned.length === 0 && k2.after.toString() === "{ not json", `${k2.err} ${k2.spawned.length} ${k2.after}`);
    const k2b = keep("keep-list", "[1,2]");
    check("keepState: a Local State that is a list throws too, nothing is spawned", /cannot be parsed/.test(k2b.err) && k2b.spawned.length === 0 && k2b.after.toString() === "[1,2]", `${k2b.err} ${k2b.spawned.length}`);
    const k3 = keep("keep-missing", null);
    const k3j = (() => { try { return JSON.parse(k3.after); } catch { return null; } })();
    check("keepState: a missing Local State is seeded as today, before the spawn", k3j?.password_manager?.os_password_blank === false && k3j.password_manager.os_password_last_changed === STAMP && k3.spawned.length === 1, `${k3.err} ${k3.after}`);
    const k4 = keep("keep-blank", JSON.stringify({ keepme: 1, password_manager: { os_password_blank: true } }));
    const k4j = JSON.parse(k4.after.toString());
    check("keepState: a Local State that parses but does not say false is seeded as today (merged), then spawned", k4j.keepme === 1 && k4j.password_manager.os_password_blank === false && k4.spawned.length === 1, k4.after.toString());
    const k5 = (() => { const d = path.join(tmp, "plain-good"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "Local State"), good); lib.spawnBrowser({ exe: "x", dir: d }, { spawn: () => ({ pid: 3 }), now: () => NOW }); return fs.readFileSync(path.join(d, "Local State"), "utf8"); })();
    check("keepState: without keepState nothing changes (a good Local State is rewritten with the new stamp, as before)", JSON.parse(k5).password_manager.os_password_last_changed === STAMP && k5 !== good, k5);

    // ---- the guard over every script ----
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    const text = (f) => fs.readFileSync(path.join(dir, f), "utf8");
    const code = (f) => text(f).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"); // comment lines do not launch anything
    const isTest = (f) => /^(test-|mutants-)/.test(f) || f === "lib-browser-profile.mjs";
    const named = files.filter((f) => !isTest(f) && /user-data-dir/.test(code(f)));
    check("guard: no script names --user-data-dir except through lib-browser-profile.mjs (a launcher that builds the flag itself would skip the seed)", named.length === 0, named.join(", "));
    const raw = files.filter((f) => !isTest(f) && /\bspawn(?:Sync)?\(\s*(?:CHROME|EDGE|CHROME_PATH|EDGE_PATH|chromePath|edgePath)\b/.test(code(f)));
    check("guard: no script spawns Chrome or Edge on its own (spawn(CHROME ...) / spawn(EDGE ...)); spawnBrowser() is the way", raw.length === 0, raw.join(", "));
    const launchers = ["cdp-measure.mjs", "vantage.mjs", "client-copy-pdf.mjs"];
    const bad = launchers.filter((f) => !files.includes(f) || !/from "\.\/lib-browser-profile\.mjs"/.test(text(f)) || !/\bspawnBrowser\(/.test(code(f)));
    check("guard: the known launchers (cdp-measure.mjs, vantage.mjs, client-copy-pdf.mjs) import lib-browser-profile.mjs and call spawnBrowser()", bad.length === 0, bad.join(", "));
    const pw = files.filter((f) => !isTest(f) && /\b(chromium|firefox|webkit)\.(launch|launchPersistentContext)\(/.test(code(f)));
    check("guard: a Playwright launch exists only in lib-shots.mjs, the one known exemption (Playwright makes its own profile and refuses --user-data-dir; it is NOT seeded, see the header of lib-shots.mjs); a new one fails here until someone decides", pw.join() === "lib-shots.mjs" && /NOT SEEDED/.test(text("lib-shots.mjs")), `${pw.join()} / marker: ${/NOT SEEDED/.test(text("lib-shots.mjs"))}`);
  } finally { rmTmp(tmp); }
  return results;
}

const LB = "lib-browser-profile.mjs", CM = "cdp-measure.mjs", VA = "vantage.mjs", CP = "client-copy-pdf.mjs";
const KS = "if (io.keepState) keepLocalState(dir, io);\n  else seedProfile(dir, io);";
const MUTANTS = [
  { name: "keepState is ignored (always seeds)", patches: [{ file: LB, from: KS, to: "seedProfile(dir, io);" }], expect: [/^keepState: a good Local State/] },
  { name: "keepState: a good Local State is still rewritten", patches: [{ file: LB, from: "if (parsed.password_manager?.os_password_blank === false) return parsed;", to: "" }], expect: [/^keepState: a good Local State/] },
  { name: "keepState: a broken Local State is seeded over instead of an error", patches: [{ file: LB, from: "catch { throw new Error(`Local State cannot be parsed, left as it is: ${file}`); }\n  if (!parsed", to: "catch { return seedProfile(dir, io); }\n  if (!parsed" }], expect: [/^keepState: a Local State that cannot be parsed throws/] },
  { name: "keepState: a list is accepted as a state", patches: [{ file: LB, from: "if (!parsed || typeof parsed !== \"object\" || Array.isArray(parsed)) throw", to: "if (false) throw" }], expect: [/^keepState: a Local State that is a list throws/] },
  { name: "keepState: a missing Local State is not seeded", patches: [{ file: LB, from: "if (e && e.code === \"ENOENT\") return seedProfile(dir, io);", to: "if (e && e.code === \"ENOENT\") return null;" }], expect: [/^keepState: a missing Local State is seeded/] },
  { name: "keepState: a state that does not say false is left alone", patches: [{ file: LB, from: "return seedProfile(dir, io); // parses, but does not say false", to: "return parsed;" }], expect: [/^keepState: a Local State that parses but does not say false/] },
  { name: "keepState is on for every spawn", patches: [{ file: LB, from: "if (io.keepState) keepLocalState", to: "if (true) keepLocalState" }], expect: [/^keepState: without keepState nothing changes/] },
  { name: "the Local State is not written", patches: [{ file: LB, from: "fs.writeFileSync(file, JSON.stringify(state));", to: "" }], expect: [/^profile: the profile's Local State is written BEFORE/, /^profile: the file is JSON/, /^profile: an existing Local State keeps/] },
  { name: "the browser is spawned before the seed", patches: [{ file: LB, from: KS + "\n  return (io.spawn || nodeSpawn)(exe, [`--user-data-dir=${dir}`, ...args], options);", to: "const c = (io.spawn || nodeSpawn)(exe, [`--user-data-dir=${dir}`, ...args], options);\n  " + KS + "\n  return c;" }], expect: [/^profile: the profile's Local State is written BEFORE/] },
  { name: "os_password_blank is not false", patches: [{ file: LB, from: "os_password_blank: false,", to: "os_password_blank: true," }], expect: [/^profile: the file is JSON/, /^profile: an existing Local State keeps/] },
  { name: "the last-changed stamp is left out", patches: [{ file: LB, from: ", os_password_last_changed: chromeTime(now()) }", to: " }" }], expect: [/^profile: the file is JSON/] },
  { name: "the stamp is in milliseconds, not Chrome time", patches: [{ file: LB, from: "String((BigInt(ms) + 11644473600000n) * 1000n)", to: "String(BigInt(ms))" }], expect: [/^profile: chromeTime is microseconds/, /^profile: the file is JSON/] },
  { name: "an existing Local State is overwritten, not merged", patches: [{ file: LB, from: "state = { ...state, password_manager: { ...pm,", to: "state = { password_manager: { ...pm," }], expect: [/^profile: an existing Local State keeps/] },
  { name: "the other password_manager keys are dropped", patches: [{ file: LB, from: "password_manager: { ...pm, os_password_blank", to: "password_manager: { os_password_blank" }], expect: [/^profile: an existing Local State keeps/] },
  { name: "a corrupt Local State is an error", patches: [{ file: LB, from: "} catch { /* no file yet, or not JSON: start clean */ }", to: "} catch (e) { if (e instanceof SyntaxError) throw e; }" }], expect: [/^profile: a Local State that is not JSON/] },
  { name: "the profile folder is not made", patches: [{ file: LB, from: "fs.mkdirSync(dir, { recursive: true });\n  const file", to: "const file" }], expect: [/^profile: the profile folder is made/, /^profile: the profile's Local State is written BEFORE/] },
  { name: "cdp-measure.mjs spawns Chrome itself again", patches: [{ file: CM, from: "const proc = spawnBrowser({ exe: CHROME, dir, args: [", to: "const proc = spawn(CHROME, [`--user-data-dir=${dir}`, " }], expect: [/^guard: no script names --user-data-dir/, /^guard: no script spawns Chrome or Edge on its own/, /^guard: the known launchers/] },
  { name: "vantage.mjs spawns Edge itself again", patches: [{ file: VA, from: "const child = spawnBrowser({ exe: EDGE, dir: prof, args, options: { detached: true, stdio: \"ignore\" } });", to: "const child = spawn(EDGE, [`--user-data-dir=${prof}`, ...args], { detached: true, stdio: \"ignore\" });" }], expect: [/^guard: no script names --user-data-dir/, /^guard: no script spawns Chrome or Edge on its own/, /^guard: the known launchers/] },
  { name: "client-copy-pdf.mjs spawns Chrome itself again", patches: [{ file: CP, from: "child = spawnBrowser({ exe, dir: profileDir, args, options: { stdio: \"ignore\", windowsHide: true } }, io);", to: "child = spawn(CHROME, [`--user-data-dir=${profileDir}`, ...args], { stdio: \"ignore\", windowsHide: true });" }], expect: [/^guard: no script names --user-data-dir/, /^guard: no script spawns Chrome or Edge on its own/, /^guard: the known launchers/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-browser-profile.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "BROWSER PROFILE", scenarios, MUTANTS, scriptsDir, argv: A }));
}
