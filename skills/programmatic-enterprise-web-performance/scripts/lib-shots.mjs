// Shared by wf-shots.mjs and section-shots.mjs (the design stage's screenshot tools, stages/design.md): a private static server on
// 127.0.0.1 and a Chromium from the Playwright install of the render gate. Local only: the server answers files under --root and
// nothing else, the pages never leave this machine.
// Playwright is not an npm dependency of the skill: it comes from the render-gate install named in ~/.claude/machine.local.json
// (the "renderGate" path, wherever it sits in that file); Chromium first, else installed Chrome, else Edge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { UsageError } from "./lib-polite.mjs";

export class Blocked extends Error {}
export { UsageError };

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
};

// --root DIR must exist; the page (a path relative to the root) must be a file inside it. -> { root, page }
export function resolvePage(rootArg, pageArg) {
  if (!rootArg) throw new UsageError("--root <static server root> is required");
  if (!pageArg) throw new UsageError("a page path (relative to --root) is required");
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`--root is not a folder: ${root}`);
  const page = path.resolve(root, pageArg);
  if (!page.startsWith(root + path.sep)) throw new UsageError(`the page must be inside --root (${page})`);
  if (!fs.existsSync(page) || !fs.statSync(page).isFile()) throw new UsageError(`no such page: ${page}`);
  return { root, page };
}

// Static server on a free 127.0.0.1 port. -> { server, port }
export async function serve(root) {
  const server = http.createServer((req, res) => {
    let f;
    try { f = path.resolve(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "")); } catch { res.writeHead(400).end(); return; }
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

export const urlFor = (port, root, page) => `http://127.0.0.1:${port}/${path.relative(root, page).split(path.sep).join("/")}`;

// Playwright from the render-gate install, then a browser. Throws Blocked with what unblocks it.
export async function launch() {
  let gate;
  try {
    const machine = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8"));
    gate = JSON.stringify(machine).match(/"renderGate"\s*:\s*"([^"]+)"/)?.[1];
  } catch (e) { throw new Blocked(`cannot read ~/.claude/machine.local.json (${e.code || e.message}). Unblocks: a machine.local.json with a renderGate path`); }
  if (!gate) throw new Blocked("renderGate path missing in ~/.claude/machine.local.json. Unblocks: add the render-gate.mjs path under renderGate");
  let chromium;
  try { ({ chromium } = createRequire(path.join(path.dirname(gate), "..", "package.json"))("playwright")); }
  catch (e) { throw new Blocked(`playwright cannot be loaded from the render-gate install next to ${gate} (${e.code || e.message}). Unblocks: npm install in that folder`); }
  for (const opt of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try { return await chromium.launch({ ...opt, timeout: 30_000 }); } catch { /* next */ }
  }
  throw new Blocked("no Chromium, Chrome or Edge could be launched. Unblocks: npx playwright install chromium (in the render-gate folder) or install Chrome");
}

// Value of `--name v` from argv (null when absent). A flag with no value is a usage error.
export function opt(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return v;
}

// Positional args = everything that is not a flag or the value of a value-flag.
export function positionals(argv, valueFlags) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (valueFlags.includes(argv[i])) { i++; continue; }
    if (argv[i].startsWith("--")) continue;
    out.push(argv[i]);
  }
  return out;
}

// Exit code from an error: usage 2, blocked 3, anything else 1.
export function report(e) {
  if (e instanceof UsageError) { console.error(`usage error: ${e.message}`); return 2; }
  if (e instanceof Blocked) { console.error(`BLOCKED: ${e.message}`); return 3; }
  console.error(`FAIL: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
  return 1;
}
