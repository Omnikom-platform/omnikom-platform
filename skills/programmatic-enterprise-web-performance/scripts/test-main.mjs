// Usage: node test-main.mjs [--skill <skill dir>]
// Proof that every CLI of the skill runs when started through a junction (a linked skill folder). Started that way, argv[1] keeps the
// link path while import.meta.url is the real file; an exact compare made 15 project scripts exit 0 with NO output (a gate "passed").
// Two parts:
//   static   no file but scripts/lib-main.mjs carries its own main-module check (an inline argv[1] compare, its own isMain, a realpath
//            of argv[1]); every file that calls isMain() imports it from lib-main.mjs
//   junction every CLI (a file that calls isMain(import.meta.url) or runCli(import.meta.url, ...)) is started through a junction to the
//            skill folder with --help, from an empty folder, and must print its usage; nothing may be written to that folder
// Exit 0 = all pass, 1 = a check failed. Local only: no network, no live site.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const SKILL = path.resolve(A.includes("--skill") ? A[A.indexOf("--skill") + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const DIRS = ["scripts", "fixtures", "checks-builtin", "measure"];
const SELF = "scripts/test-main.mjs";
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 1500) });

// ---- the files ----
const files = [];
for (const d of DIRS) {
  const abs = path.join(SKILL, d);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) if (f.endsWith(".mjs")) files.push(`${d}/${f}`);
}
const text = new Map(files.map((r) => [r, fs.readFileSync(path.join(SKILL, r), "utf8")]));

// ---- static ----
const own = [], inline = [], unimported = [];
for (const [rel, src] of text) {
  if (rel === "scripts/lib-main.mjs" || rel === SELF) continue;
  if (/\b(function|const|let|var)\s+isMain\b/.test(src)) own.push(rel);
  src.split("\n").forEach((line, i) => {
    if ((/process\.argv\[1\]/.test(line) && /import\.meta/.test(line)) || /realpathSync(\.native)?\(\s*process\.argv\[1\]/.test(line)) inline.push(`${rel}:${i + 1}`);
  });
  if (/\bisMain\(/.test(src) && !/import \{[^}]*\bisMain\b[^}]*\} from "(\.\/|\.\.\/scripts\/)lib-main\.mjs"/.test(src)) unimported.push(rel);
}
check("static: no file but lib-main.mjs defines its own isMain", !own.length, own.join(", "));
check("static: no inline main-module compare (process.argv[1] against import.meta) anywhere", !inline.length, inline.join(", "));
check("static: every file that calls isMain() imports it from lib-main.mjs", !unimported.length, unimported.join(", "));

// ---- lib-main itself: false when imported (this file is main, lib-main is not) ----
check("lib-main: isMain is false for a module that was imported, true for the started script",
  isMain(pathToFileURL(path.join(SKILL, "scripts", "lib-main.mjs")).href) === false && isMain(import.meta.url) === true);

// ---- junction ----
const CLI = /\bisMain\(import\.meta\.url\)|\brunCli\(import\.meta\.url\b/;
const code = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"); // a usage example in a comment is not a CLI
// a file with its own inline guard is a CLI too, so a regression is caught twice: by the static check and by its silence here
const OWN_GUARD = /process\.argv\[1\][^\n]*import\.meta|import\.meta[^\n]*process\.argv\[1\]/;
const clis = [...text].filter(([rel, src]) => rel !== SELF && (CLI.test(code(src)) || OWN_GUARD.test(code(src)))).map(([rel]) => rel).sort();
check(`junction: the CLI list is complete (${clis.length} files that guard their main)`, clis.length >= 55, clis.join(", "));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-main-"));
const link = path.join(tmp, "skill-link"), cwd = path.join(tmp, "empty-cwd");
fs.mkdirSync(cwd);
try {
  fs.symlinkSync(SKILL, link, "junction");
  check("junction: the link really is a link (argv[1] differs from the real path)", fs.realpathSync(link).toLowerCase() !== link.toLowerCase() && fs.lstatSync(link).isSymbolicLink(), fs.realpathSync(link));
  const silent = [];
  for (const rel of clis) {
    const r = spawnSync(process.execPath, [path.join(link, ...rel.split("/")), "--help"], { cwd, encoding: "utf8", timeout: 60_000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "" } });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    if (r.error || !/usage/i.test(out)) silent.push(`${rel} (exit ${r.error ? r.error.code : r.status}, ${out.trim() ? JSON.stringify(out.trim().slice(0, 120)) : "NO OUTPUT"})`);
  }
  check(`junction: all ${clis.length} CLIs started through the junction with --help print their usage`, !silent.length, silent.join("\n     "));
  // relative argv with the junction as the working folder (p11 P11.4)
  const rel = spawnSync(process.execPath, ["state.mjs", "--help"], { cwd: path.join(link, "scripts"), encoding: "utf8", timeout: 60_000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "" } });
  check("junction: a relative start from inside the junction prints the usage too", /usage/i.test(`${rel.stdout}${rel.stderr}`), `exit ${rel.status} ${rel.stdout}${rel.stderr}`);
  const left = fs.readdirSync(cwd);
  check("junction: --help wrote nothing into the working folder", !left.length, left.join(", "));
} finally {
  try { if (fs.lstatSync(link).isSymbolicLink()) fs.rmSync(link, { recursive: true, force: true }); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
}
check("cleanup: removing the junction kept the skill folder", fs.existsSync(path.join(SKILL, "scripts", "lib-main.mjs")));

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `MAIN-MODULE TEST FAIL: ${failed} of ${results.length}` : `MAIN-MODULE TEST PASS: ${results.length} of ${results.length}`);
process.exitCode = failed ? 1 : 0;
