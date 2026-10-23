// Shared by plan-site.mjs and the S5 gate checks: where the files are, how a brief is read, how a check reports.
// A gate check is a module exporting { id, title, run(ctx) } and ending with `runCli(import.meta.url, check)`; run returns
// { status: "PASS"|"FAIL"|"ERROR", summary, details[] }. Exit codes (CLI): 0 PASS, 1 FAIL, 2 cannot judge (ERROR).
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSite, normPath } from "./lib-site.mjs";
import { resolveInputs } from "./approve.mjs";
import { localeOf, RuleMissing } from "./lib-rules.mjs";
import { pageTypeOfPage } from "./lib-growth.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RULES_DIR = path.join(HERE, "..", "rules", "industries");
export class CannotJudge extends Error {}
export const cannot = (why) => { throw new CannotJudge(why); };
export const pass = (summary, details = []) => ({ status: "PASS", summary, details });
export const fail = (summary, details = []) => ({ status: "FAIL", summary, details });
export const error = (summary, details = []) => ({ status: "ERROR", summary: `cannot judge: ${summary}`, details });
const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // a UTF-8 BOM (PowerShell 5.1, Notepad) is not a JSON error
export const readJson = (f, what) => {
  if (!fs.existsSync(f)) cannot(`${what || path.basename(f)} not found (${f})`);
  try { return JSON.parse(noBom(fs.readFileSync(f, "utf8"))); } catch (e) { return cannot(`${what || path.basename(f)} is not valid JSON: ${e.message}`); }
};

export function loadIndustry(slug, dir = RULES_DIR) {
  const f = path.join(dir, `${slug}.json`);
  if (!fs.existsSync(f)) cannot(`industry rules file rules/industries/${slug}.json not found`);
  return readJson(f);
}

// A brief is markdown written by plan-site.mjs: `- Key: value` header lines, then `## Section` lists.
export function parseBrief(md) {
  const b = { fields: {}, sections: {} };
  let sec = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { sec = h[1].toLowerCase(); b.sections[sec] = []; continue; }
    const li = line.match(/^-\s+(.*)$/);
    if (!li) continue;
    if (sec === null) { const kv = li[1].match(/^([A-Za-z][A-Za-z0-9 ]*?):\s*(.*)$/); if (kv) b.fields[kv[1].toLowerCase()] = kv[2].trim(); }
    else b.sections[sec].push(li[1].trim());
  }
  const f = b.fields;
  b.path = f.page; b.cluster = f.cluster; b.primaryQuery = f["primary query"]; b.title = f.title; b.h1 = f.h1; b.metaDescription = f["meta description"];
  b.schema = (f.schema || "").split(",").map((x) => x.trim()).filter(Boolean);
  const wr = (f["word range"] || "").match(/^(\d+)\s*-\s*(\d+)/);
  b.wordRange = wr ? { min: +wr[1], max: +wr[2] } : null;
  b.outline = (b.sections["outline"] || []).map((x) => x.replace(/^H[1-6]:\s*/i, ""));
  b.requiredTerms = (b.sections["required terms"] || []).map((x) => x.trim());
  b.entities = (b.sections["entities to cover"] || []).map((x) => x.replace(/\s*\(in:.*\)\s*$/, ""));
  b.questions = b.sections["questions to answer"] || [];
  const lk = (s) => (b.sections[s] || []).map((x) => { const m = x.match(/^(\S+)\s*\|\s*anchor:\s*"(.*)"$/); return m ? { path: m[1], anchor: m[2] } : null; }).filter(Boolean);
  b.linksOut = lk("links out"); b.linksIn = lk("links in");
  return b;
}

// Everything a check may need, loaded when first asked for (a missing file is "cannot judge", not a crash).
export function loadCtx(pewp, siteDir, opts = {}) {
  pewp = path.resolve(pewp);
  const memo = {};
  const lazy = (k, fn) => { if (!(k in memo)) memo[k] = fn(); return memo[k]; };
  const ctx = {
    pewp, siteDir: siteDir ? path.resolve(siteDir) : null, strict: !!opts.strict, waive: new Set(opts.waive || []), rulesDir: opts.rulesDir || RULES_DIR,
    // GT-013: the site's build command, when known (the folder it runs in defaults to the site folder)
    build: opts.build || null, buildCwd: opts.buildCwd ? path.resolve(opts.buildCwd) : null, setup: opts.setup || null, buildTimeoutMin: opts.buildTimeoutMin || 10,
    // The approved copy (approve.mjs) when there is one, else the working files; ctx.inputs says which.
    get inputs() { return lazy("inputs", () => resolveInputs(pewp)); },
    get targets() { return lazy("targets", () => readJson(ctx.inputs.targetsFile, "targets.json")); },
    get business() { return lazy("business", () => readJson(path.join(pewp, "business.json"), "business.json")); },
    get sitemap() { return lazy("sitemap", () => readJson(path.join(ctx.inputs.planRoot, "plan", "sitemap.json"), "plan/sitemap.json (run plan-site.mjs)")); },
    get programmatic() { return lazy("programmatic", () => readJson(path.join(ctx.inputs.planRoot, "plan", "programmatic.json"), "plan/programmatic.json")); },
    get programmaticData() { return lazy("programmaticData", () => readJson(path.join(pewp, "plan", "programmatic-data.json"), "plan/programmatic-data.json") /* builder data: never part of the approved plan */); },
    get briefs() {
      return lazy("briefs", () => {
        const m = new Map();
        for (const p of ctx.sitemap.pages) {
          const f = path.join(ctx.inputs.planRoot, p.brief);
          if (!fs.existsSync(f)) cannot(`brief ${p.brief} for ${p.path} not found`);
          m.set(p.path, parseBrief(fs.readFileSync(f, "utf8")));
        }
        return m;
      });
    },
    get site() { return lazy("site", () => { if (!ctx.siteDir) cannot("no site folder given"); const s = loadSite(ctx.siteDir); const d = ctx.business?.domain; if (d && !s.hosts.includes(d)) s.hosts.push(d); return s; }); },
    get rules() { return lazy("rules", () => { const slug = ctx.business.industry; return slug ? loadIndustry(slug, ctx.rulesDir) : null; }); },
    // A planned / preview site carries noindex on every page BY DESIGN (business.json launchState): judge its pages as if indexable.
    // Mixed noindex pages (a thank-you page) keep their exemption; a live site's noindex is never excused.
    get noindexByDesign() { return lazy("nibd", () => { try { return ctx.business.launchState !== "live" && ctx.site.pages.size > 0 && [...ctx.site.pages.values()].every((p) => p.noindex); } catch { return false; } }); },
    indexable(pg) { return !pg.noindex || ctx.noindexByDesign; },
    get noindexNote() { return ctx.noindexByDesign ? [`NOTE noindex by design (launchState "${ctx.business.launchState}"): every page carries noindex, judged as if indexable; set launchState to live and remove the noindex at launch`] : []; },
    // shipgate 06 section 9 helpers shared by the growth-aligned checks (GT-003, GT-004, GT-011, GT-012): the market's locale, the page type (9.3) of a built page,
    // and targeting.priorityPages (TGT-011; --priority-pages, else business.json targeting.priorityPages, else 20).
    get locale() { return localeOf(ctx.business.market); },
    pageTypeOf(pg) { return pageTypeOfPage(pg, ""); },
    get priorityPages() { return lazy("priorityPages", () => Number(opts.priorityPages ?? ctx.business.targeting?.priorityPages ?? 20)); },
    clusterById(id) { return ctx.targets.clusters.find((c) => c.id === id); },
    pageFor(p) { return ctx.site.pages.get(normPath(p)); },
  };
  return ctx;
}

export const isIndexable = (pg) => !pg.noindex;

export function formatResult(id, r) {
  const lines = [`${r.status} ${id} ${r.summary}`];
  for (const d of r.details || []) lines.push(`  ${d}`);
  return lines.join("\n");
}
export const exitCode = (status) => (status === "PASS" ? 0 : status === "FAIL" ? 1 : 2);
export function execute(check, ctx) {
  try { return check.run(ctx); } catch (e) { return e instanceof CannotJudge || e instanceof RuleMissing ? error(e.message) : error(`check crashed: ${e.stack?.split("\n").slice(0, 2).join(" ") || e}`); }
}

// CLI shared by every gate-*.mjs: node gate-x.mjs <pewp dir> <site dir> [--strict] [--waive ID,ID]
export function runCli(metaUrl, check) {
  if (!isMain(metaUrl)) return;
  const a = process.argv.slice(2);
  const pos = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--waive");
  const usage = `usage: node ${path.basename(fileURLToPath(metaUrl))} <pewp dir> <site dir> [--strict] [--waive ID,ID]`;
  if (pos.length < 1) { console.error(usage); process.exit(2); }
  if (a.includes("--waive") && !a[a.indexOf("--waive") + 1]) { console.error(`--waive needs a list of item ids\n${usage}`); process.exit(2); }
  const waive = a.includes("--waive") ? a[a.indexOf("--waive") + 1].split(",") : [];
  const r = execute(check, loadCtx(pos[0], pos[1], { strict: a.includes("--strict"), waive }));
  console.log(formatResult(check.id, r));
  process.exit(exitCode(r.status));
}
export const moduleUrl = (f) => pathToFileURL(f).href;
