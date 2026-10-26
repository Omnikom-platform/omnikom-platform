// The one place the skill reads a project's .env file (contract C4; gap G1: keys lived in a project .env, the scripts read only
// process.env, so doctor said NEEDS while the keys existed).
//   import { loadEnv, envFileArg } from "./lib-env.mjs";
//   const { file, loaded, skipped, source } = loadEnv({ envFile: envFileArg(process.argv.slice(2)), pewp, cwd });
// Which file (first that applies): the explicit `envFile` (the --env-file option) > `envFile` in <pewp>/state.json > `envFile` in
// ~/.claude/machine.local.json. A relative path is resolved against `cwd` (default: the current folder) for the option, against the
// folder that holds the .pewp folder for state.json, against ~/.claude for machine.local.json. No file at all = { file: null, source: "none" }.
// A file named EXPLICITLY that is missing is a usage error: loadEnv throws an EnvFileError (exitCode 2) whose message carries the path;
// a missing file named only by a default (state.json, machine.local.json) is skipped silently and the next default is tried.
// Parsing: KEY=VALUE and `export KEY=VALUE`, one per line; blank lines and `#` lines skipped; a value in "double" or 'single' quotes
// keeps what is inside (double quotes also read \n \r \t \" \\; whatever follows the closing quote is ignored); an unquoted value ends
// at an inline ` #` comment and is trimmed; a byte-order mark and CRLF line ends are fine. NOT supported: a quoted value that runs over
// several lines (its first line is read as written).
// A name that is already set (non-empty) in process.env is NEVER overridden (it is returned in `skipped`); the others are set on
// process.env, so every child process inherits them. A value is never returned, printed or logged: callers get names only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class EnvFileError extends Error {
  constructor(message) { super(message); this.name = "EnvFileError"; this.exitCode = 2; }
}

const isSet = (name) => typeof process.env[name] === "string" && process.env[name].trim() !== "";
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// `--env-file <path>` or `--env-file=<path>` from an argv array (without node and the script); null when absent.
// `--dotenv <path>` is the same option under another name: Node 24 itself scans the WHOLE command line for --env-file / --env-file=
// (measured, v24.22.1: `node script.mjs --env-file nope` exits 9 with "nope: not found" before the script starts), so a missing file
// named that way can never reach the usage error (exit 2) below; named --dotenv it does.
export function envFileArg(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--env-file" || t === "--dotenv") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new EnvFileError("--env-file needs a path (usage: --env-file <path to a .env file>)");
      return v;
    }
    if (t.startsWith("--env-file=")) {
      const v = t.slice("--env-file=".length);
      if (!v) throw new EnvFileError("--env-file needs a path (usage: --env-file <path to a .env file>)");
      return v;
    }
  }
  return null;
}

// Text of an env file -> Map(name -> value). Pure; exported for tests.
export function parseEnv(text) {
  const out = new Map();
  for (let line of String(text).replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let v = line.slice(eq + 1).trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.length > 1) {
      let end = -1;
      for (let i = 1; i < v.length; i++) {
        if (q === '"' && v[i] === "\\") { i++; continue; }
        if (v[i] === q) { end = i; break; }
      }
      if (end > 0) {
        v = v.slice(1, end);
        if (q === '"') v = v.replace(/\\([nrt"\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[c]);
        out.set(name, v);
        continue;
      }
    }
    out.set(name, v.replace(/\s+#.*$/, "").trim());
  }
  return out;
}

function configured(file, key) {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return typeof j[key] === "string" && j[key].trim() ? j[key].trim() : null; } catch { return null; }
}

export function loadEnv({ envFile = null, pewp = null, cwd = process.cwd(), home = os.homedir() } = {}) {
  let file = null, source = "none";
  if (envFile) {
    const p = path.resolve(cwd, envFile);
    if (!isFile(p)) throw new EnvFileError(`--env-file / --dotenv: no such file: ${p}`);
    file = p; source = "--env-file";
  } else {
    const fromState = pewp ? configured(path.join(pewp, "state.json"), "envFile") : null;
    if (fromState && isFile(path.resolve(path.dirname(pewp), fromState))) { file = path.resolve(path.dirname(pewp), fromState); source = "state.json envFile"; }
    else {
      const fromMachine = configured(path.join(home, ".claude", "machine.local.json"), "envFile");
      if (fromMachine && isFile(path.resolve(path.join(home, ".claude"), fromMachine))) { file = path.resolve(path.join(home, ".claude"), fromMachine); source = "machine.local.json envFile"; }
    }
  }
  const loaded = [], skipped = [];
  if (file) {
    let parsed;
    try { parsed = parseEnv(fs.readFileSync(file, "utf8")); } catch (e) { throw new EnvFileError(`cannot read env file ${file} (${e.code || e.message})`); }
    for (const [name, value] of parsed) {
      if (isSet(name)) skipped.push(name);
      else { process.env[name] = value; loaded.push(name); }
    }
  }
  return { file, loaded, skipped, source };
}

// For a CLI: loadEnv, but a usage error ends the process with exit 2 and the message on stderr (scripts never prompt).
export function loadEnvOrExit(opts) {
  try { return loadEnv(opts); } catch (e) { if (e instanceof EnvFileError) { console.error(`usage error: ${e.message}`); process.exit(2); } throw e; }
}
