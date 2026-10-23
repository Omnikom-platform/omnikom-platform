// Re-runnable measure entry. `measure.mjs <url> --init` copies this file to <pewp>/measure/run.mjs next to config.json.
// No model is needed to run it (a model may rewrite the plain-words summary in report.md afterwards).
// Usage: node run.mjs [--plan] [--fresh] [--today YYYY-MM-DD] [--refresh-authority]
// Exit 0 = ran (BLOCKED parts are results, listed in summary.json); 2 = no or unreadable config.json next to this file, skill not found,
// or a bad --today.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let cfg;
const cfgFile = path.join(here, "config.json");
const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // a BOM (Notepad, PowerShell 5.1) is not a broken file
try { cfg = JSON.parse(noBom(fs.readFileSync(cfgFile, "utf8"))); }
catch (e) { console.error(e.code === "ENOENT" ? `No config.json next to ${fileURLToPath(import.meta.url)}. Run: node <skill>/scripts/measure.mjs <url> --init` : `${cfgFile} is not valid JSON (${e.message}): fix it or re-create it with measure.mjs <url> --init`); process.exit(2); }
const skill = process.env.PEWP_SKILL || cfg.skillDir;
const entry = path.join(String(skill || ""), "scripts", "measure.mjs");
if (!skill || !fs.existsSync(entry)) { console.error(`The skill is not at ${skill || "(skillDir not set in config.json)"}: ${entry} does not exist. Set PEWP_SKILL=<skill folder> or fix skillDir in ${cfgFile}.`); process.exit(2); }
const m = await import(pathToFileURL(entry).href);
const a = process.argv.slice(2);
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
if (opt("--today") && !/^\d{4}-\d{2}-\d{2}$/.test(opt("--today"))) { console.error(`--today must be YYYY-MM-DD (got ${opt("--today")})`); process.exit(2); }
await m.runMeasure(cfg.target, { cwd: cfg.cwd, plan: a.includes("--plan"), fresh: a.includes("--fresh"), today: opt("--today"), refreshAuthority: a.includes("--refresh-authority") });
