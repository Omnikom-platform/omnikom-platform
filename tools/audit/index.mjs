// The audit engine: audit(dir, options) judges a folder of built static HTML against the shipgate checklist rules in checks/,
// one check file per rule id, each admitted only with its rules/<ID>.md source text. Node built-ins only, no network.
//   import { audit, listRules } from "./tools/audit/index.mjs";
//   const r = audit("path/to/built/site", { rules: ["MET-003"], config: { titleLength: { hardMax: 65 } } });
//   r = { dir, mode: "static"|"snapshot", pages: [paths], rules: [{ id, severity, source }], findings: [...], lines: [...], pass, exit }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSite } from "./lib/context.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEVERITIES = new Set(["P0", "P1", "P2", "W"]);

// An error with an exit code: 2 = usage or configuration error (the runner prints the message and exits with it).
export class AuditError extends Error { constructor(message, exit = 2) { super(message); this.exit = exit; } }

// shipgate spec 8.0.0 packs/web-delivery.md line 21 (the default adapter config) plus the sitemap file limits (IDX-002).
export const DEFAULT_CONFIG = {
  titleLength: { warnMin: 30, warnMax: 60, hardMax: 70 },
  descriptionLength: { warnMin: 70, warnMax: 160, hardMax: 180 },
  sitemap: { maxUrlsPerFile: 50000, maxBytesPerFile: 52428800 },
  // shipgate spec 8.0.0 packs/performance.md defaults block (read 2026-10-30): lcpMs, cls, tbtMs (PRF-001), ttfbMs (PRF-016, warm server response).
  speed: { lcpMs: 2500, cls: 0.1, tbtMs: 200, ttfbMs: 600 },
};

async function loadChecks() {
  const dir = path.join(HERE, "checks");
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const where = `checks/${file}`;
    if (typeof mod.id !== "string" || !mod.id) throw new AuditError(`${where} refused: no exported id`);
    if (file !== mod.id.toLowerCase() + ".mjs") throw new AuditError(`${where} refused: the file name must be the lowercase rule id (${mod.id.toLowerCase()}.mjs)`);
    const rulesFile = path.join(HERE, "rules", mod.id + ".md");
    if (!fs.existsSync(rulesFile) || !fs.readFileSync(rulesFile, "utf8").includes(mod.id)) throw new AuditError(`${where} refused: rules/${mod.id}.md is missing or empty (checks admitted only with a source)`);
    if (!SEVERITIES.has(mod.severity)) throw new AuditError(`${where} refused: severity must be P0, P1, P2 or W`);
    if (typeof mod.source !== "string" || !mod.source) throw new AuditError(`${where} refused: no source string`);
    if (typeof mod.run !== "function") throw new AuditError(`${where} refused: no run(site) function`);
    out.push({ id: mod.id, severity: mod.severity, source: mod.source, subjects: mod.subjects || null, notCovered: mod.notCovered || [], run: mod.run });
  }
  return out;
}
const CHECKS = await loadChecks();

export const listRules = () => CHECKS.map((c) => ({ id: c.id, severity: c.severity, source: c.source, notCovered: c.notCovered }));

// WCF-004: warnMin < warnMax <= hardMax, whole numbers above zero.
function resolveConfig(dir, override) {
  let file = {};
  const cf = path.join(dir, "audit.config.json");
  if (fs.existsSync(cf)) { try { file = JSON.parse(fs.readFileSync(cf, "utf8")); } catch (e) { throw new AuditError(`audit.config.json is not valid JSON: ${e.message}`); } }
  const cfg = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) cfg[k] = { ...DEFAULT_CONFIG[k], ...(file[k] || {}), ...((override && override[k]) || {}) };
  for (const k of ["titleLength", "descriptionLength"]) {
    const { warnMin, warnMax, hardMax } = cfg[k];
    if (![warnMin, warnMax, hardMax].every((n) => Number.isInteger(n) && n > 0) || !(warnMin < warnMax && warnMax <= hardMax)) throw new AuditError(`WCF-004: ${k} must satisfy warnMin < warnMax <= hardMax (got ${warnMin}, ${warnMax}, ${hardMax})`);
  }
  for (const [k, v] of Object.entries(cfg.speed)) if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new AuditError(`WCF-004: speed.${k} must be a number above zero (got ${JSON.stringify(v)})`);
  for (const [k, v] of Object.entries(cfg.sitemap)) if (!Number.isInteger(v) || v < 1) throw new AuditError(`sitemap.${k} must be a whole number above zero`);
  return cfg;
}

const clean = (s) => String(s).replace(/\s+/g, " ").trim();

export function audit(dir, options = {}) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new AuditError(`site folder not found: ${dir}`);
  const config = resolveConfig(dir, options.config);
  let selected = CHECKS;
  // rules omitted (undefined or null) runs every rule; anything else must name rules that exist. An empty list, an empty string or an
  // unknown id is a usage error, never "zero rules ran, PASS" (a caller that passes rules: [''] must not fail open).
  if (options.rules !== undefined && options.rules !== null) {
    const list = Array.isArray(options.rules) ? options.rules : [options.rules];
    if (list.length === 0) throw new AuditError('no such rule: (an empty rules list runs nothing; omit rules to run all of them)');
    const want = list.map((r) => String(r).trim().toUpperCase());
    const unknown = want.filter((r) => !CHECKS.some((c) => c.id === r));
    if (unknown.length) throw new AuditError(`no such rule: ${unknown.map((u) => JSON.stringify(u)).join(", ")} (unknown rule id; node tools/audit/run.mjs --list shows them)`);
    selected = CHECKS.filter((c) => want.includes(c.id));
  }
  const site = buildSite(dir, config, { psi: options.psi });
  const findings = [];
  const lines = [];
  for (const c of selected) {
    const mine = c.run(site).map((f) => ({ rule: c.id, page: f.page, line: f.line, what: clean(f.what), status: f.status }));
    findings.push(...mine);
    const subjects = c.subjects ? c.subjects(site) : site.pageList.map((p) => p.path);
    const order = [...subjects, ...mine.map((f) => f.page).filter((p) => !subjects.includes(p))];
    for (const subject of [...new Set(order)]) {
      const here = mine.filter((f) => f.page === subject).sort((a, b) => a.line - b.line);
      if (!here.length) { lines.push(`PASS ${c.id} ${subject}`); continue; }
      for (const f of here) {
        if (f.status === "SKIP") lines.push(`SKIP ${c.id} ${subject} ${f.what}`);
        else lines.push(`${f.status} ${c.id} ${subject}:${f.line} ${f.what} (source: ${c.source})`);
      }
    }
  }
  const pass = !findings.some((f) => f.status === "FAIL");
  return { dir: site.dir, mode: site.mode, pages: site.pageList.map((p) => p.path), rules: selected.map((c) => ({ id: c.id, severity: c.severity, source: c.source })), findings, lines, pass, exit: pass ? 0 : 1 };
}
