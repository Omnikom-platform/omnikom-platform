// Local receiver for browser captures (G5). The results page (scripts/serp-capture.js, run through the claude-in-chrome javascript_tool)
// POSTs one capture JSON to this server; the server checks it with the importer's own rules and writes it where the importer reads it.
// It never fetches anything: Google/Bing pages are only ever read by the browser the owner is watching (stages/research.md).
// Usage: node capture-server.mjs <url | repo> --cwd DIR [--port 47321] [--hours 3]   (run it in the background; --port 0 picks a free port)
//   POST /save?file=<id>.<google|bing>.json   body = one SERP capture      -> <pewp>/captures/serp/<file>
//   POST /save-ai?file=<id>.json              body = one AI-answer capture -> <pewp>/captures/ai/<file>
//   GET  /                                    one-line status (saved so far, uptime, time left)
// Answers: 200 {saved, ...} | 400 {error, problems[]} | 403 foreign Host/Origin | 404 | 413 body over 2 MB | 429 same name again within 45 s.
// Listens on 127.0.0.1 ONLY (never 0.0.0.0), accepts only the Hosts 127.0.0.1/localhost and, when a browser sends an Origin, only the search
// and AI engine sites (another web page cannot write files here), answers Chrome's private-network preflight, exits after --hours.
// Chrome asks the owner once to allow the page to reach devices on the local network: the owner clicks Allow (see stages/research.md).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { validateCapture } from "./research-serp-import.mjs";
import { parseArgs, Usage, J } from "./research-lib.mjs";

export const MAX_BODY = 2 * 1024 * 1024;
export const PACE_MS = 45_000;
export const PACE_TEXT = "pace: at least 45 s between captures";
const SERP_NAME = /^[a-z0-9-]+\.(google|bing)\.json$/;
const AI_NAME = /^[a-z0-9-]+\.json$/;
const HOST_OK = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
// the sites a capture page may POST from; a request with any other Origin is refused
const ORIGIN_OK = /^https:\/\/([a-z0-9-]+\.)*(google\.[a-z]{2,3}(\.[a-z]{2})?|bing\.com|microsoft\.com|chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|duckduckgo\.com)$/i;

// AI-answer capture (stages/research.md step 6): research's `sources` form or measure's `citedDomains` form.
export function validateAiCapture(j) {
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, problems: ["the capture is not a JSON object"] };
  const p = [];
  if (!j.engine) p.push("no engine");
  if (!j.question) p.push("no question");
  if (!j.capturedAt || Number.isNaN(Date.parse(j.capturedAt))) p.push("no capture date");
  if (!(typeof j.answer === "string" && j.answer.trim())) p.push("no answer text");
  const src = Array.isArray(j.citedDomains) ? j.citedDomains : j.sources;
  if (!Array.isArray(src)) p.push("no sources list (write [] when the assistant named none)");
  return { ok: !p.length, problems: p };
}

const send = (res, code, body, headers = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "cache-control": "no-store", ...headers });
  res.end(text);
};

export function startServer({ pewp, port = 47321, hours = 3, defaultLanguage = null, log = console.log }) {
  const dirs = { serp: path.join(pewp, "captures", "serp"), ai: path.join(pewp, "captures", "ai") };
  const startedAt = Date.now(), lastSaved = new Map(), saved = { serp: 0, ai: 0 };
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const cors = origin && ORIGIN_OK.test(origin)
      ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-allow-private-network": "true" }
      : {};
    if (!HOST_OK.test(req.headers.host || "")) return send(res, 403, "forbidden: this receiver answers 127.0.0.1 only", cors);
    if (origin && !cors["access-control-allow-origin"]) return send(res, 403, "forbidden: that page may not write captures", cors);
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      const left = Math.max(0, Math.round((startedAt + hours * 3600_000 - Date.now()) / 60_000));
      return send(res, 200, `pewp capture receiver: ${saved.serp + saved.ai} saved (${saved.serp} results pages, ${saved.ai} AI answers), up ${Math.round((Date.now() - startedAt) / 1000)} s, stops in ${left} min`, cors);
    }
    const kind = url.pathname === "/save" ? "serp" : url.pathname === "/save-ai" ? "ai" : null;
    if (req.method !== "POST" || !kind) return send(res, 404, "not found: POST /save?file=<id>.<google|bing>.json or POST /save-ai?file=<id>.json, GET /", cors);
    const name = url.searchParams.get("file") ?? "";
    if (!(kind === "serp" ? SERP_NAME : AI_NAME).test(name)) {
      req.resume();
      return send(res, 400, { error: "bad file name", problems: [kind === "serp" ? "file must look like <id>.<google|bing>.json (lower-case letters, digits, hyphens)" : "file must look like <id>.json (lower-case letters, digits, hyphens)"] }, cors);
    }
    const chunks = []; let size = 0, over = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; if (size > 50 * MAX_BODY) req.destroy(); } // drain, do not keep
      else if (!over) chunks.push(c);
    });
    req.on("error", () => {});
    req.on("end", () => {
      if (over) return send(res, 413, { error: "body over 2 MB", problems: [`the capture is ${size} bytes; the limit is ${MAX_BODY}`] }, { ...cors, connection: "close" });
      let j;
      try { j = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "")); }
      catch (e) { return send(res, 400, { error: "not valid JSON", problems: [`not valid JSON: ${e.message}`] }, cors); }
      const v = kind === "serp" ? validateCapture(j, { defaultLanguage }) : validateAiCapture(j);
      const problems = [...v.problems];
      if (kind === "serp" && v.ok && String(j.engine).toLowerCase() !== name.split(".").at(-2)) problems.push(`the file name says ${name.split(".").at(-2)} but the capture says ${j.engine}`);
      if (problems.length) return send(res, 400, { error: `capture refused: ${problems.join("; ")}`, problems }, cors);
      const key = `${kind}/${name}`, last = lastSaved.get(key);
      if (last && Date.now() - last < PACE_MS) return send(res, 429, PACE_TEXT, { ...cors, "retry-after": String(Math.ceil((PACE_MS - (Date.now() - last)) / 1000)) });
      const file = path.join(dirs[kind], name);
      fs.mkdirSync(dirs[kind], { recursive: true });
      fs.writeFileSync(file, JSON.stringify(j, null, 1) + "\n");
      lastSaved.set(key, Date.now()); saved[kind]++;
      const info = kind === "serp"
        ? { organic: (j.organic || []).length, aiOverview: j.aiOverview?.present === true ? ((j.aiOverview.sources || []).length ? "present, sources" : "present, NO sources (expand it and capture again)") : "no", robotCheck: !!j.robotCheck, device: j.device }
        : { sources: (j.citedDomains || j.sources || []).length };
      log(kind === "serp" ? `saved ${name}: ${info.organic} results, AI Overview ${info.aiOverview}, ${info.device}${info.robotCheck ? ", ROBOT CHECK: stop the run" : ""}` : `saved ai/${name}: ${info.sources} sources`);
      send(res, 200, { saved: file, name, kind, ...info, count: saved.serp + saved.ai }, cors);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const timer = setTimeout(() => { log("capture server: time is up, stopping"); server.close(); server.closeAllConnections?.(); }, hours * 3600_000);
      timer.unref();
      server.on("close", () => clearTimeout(timer));
      resolve({ server, port: server.address().port, dirs, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) });
    });
  });
}

if (isMain(import.meta.url)) {
  const usage = "node capture-server.mjs <url | repo> --cwd DIR [--port 47321] [--hours 3]   (see the top of the file; --port 0 picks a free port)";
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { console.log(`usage: ${usage}`); process.exit(0); }
  try {
    const a = parseArgs(argv);
    if (!a._[0]) throw new Usage(usage);
    const port = a.num("port", 47321, { min: 0, int: true }), hours = a.num("hours", 3, { min: 0.001 });
    const loc = locate(a._[0], { cwd: a.get("cwd") || process.cwd() });
    const lang = J(path.join(loc.pewp, "business.json"))?.market?.language || null;
    const s = await startServer({ pewp: loc.pewp, port, hours, defaultLanguage: lang });
    console.log(`capture server on ${s.server.address().address}:${s.port} -> ${s.dirs.serp} (AI answers -> ${s.dirs.ai}); stops after ${hours} h`);
    s.server.on("close", () => process.exit(0));
  } catch (e) {
    if (e instanceof Usage) { console.error(`usage: ${e.message}`); process.exit(2); }
    console.error(e.code === "EADDRINUSE" ? `port is already in use: is a capture server already running? (pass --port N)` : e.stack || String(e));
    process.exit(1);
  }
}
