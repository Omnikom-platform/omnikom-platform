// The shared engine of the capture importers (import-index, import-trends, import-ai, import-reputation, import-social, import-ads).
// A capture is a small JSON file the MAIN SESSION writes after reading a page in the OWNER's browser (no script fetches these pages); an importer turns
// every capture of one module into ONE normalized JSON of numbers (<pewp>/research/<out>.json), so the report reads numbers and never raw captures.
// What every importer does the same way:
//   - reads <pewp>/captures/<dir>/*.json (or --dir); no file at all => BLOCKED (exit 3), last line "BLOCKED: <what> | unblocks: <what would>"
//   - every file needs capturedAt (a date) and browser (who looked); a file that breaks its module's format is REJECTED with the reason, listed in
//     `rejected`, and never guessed at; a file older than --max-age-days (default 30) is kept and marked stale
//   - every file kept is BLOCKED-aware: a capture that says blocked ("sign-in wall", "robot check") becomes a row with status "blocked", not a number
//   - every row names the file it came from and the capture date, so every number can be traced
//   - all files rejected => BLOCKED (exit 3) naming the first reason; otherwise exit 0 and the last line says how many rows, rejected, stale
// Output: research/<out>.json { step, status, generatedAt, module, dir, files, rows, summary, rejected, staleCount }.
import fs from "node:fs";
import path from "node:path";
import { Blocked, J, ageDays, context, runCli, writeStep, writeBlocked } from "./research-lib.mjs";

// "1,234" -> 1234, "1.2K" -> 1200, "3.4M" -> 3400000, 12 -> 12; anything else -> null
export function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().replace(/,/g, "").match(/^(-?\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? (/[Kk]/.test(m[2]) ? 1e3 : 1e6) : 1) * 1e6) / 1e6;
}
export const toDate = (v) => { if (typeof v !== "string" || !v.trim()) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };
export const daysSince = (d) => (d ? Math.round(((Date.now() - Date.parse(d)) / 86400000) * 10) / 10 : null);
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
export const isHttp = (u) => /^https?:\/\/\S+$/i.test(String(u || ""));
export const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
export const count = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([name, n]) => ({ name, count: n })); };
export const round = (v, n = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(n)));

// def: { module, dir, out, usageName, how (what the owner/main session does to capture), check(json, ctx) -> { errors: [], row }, summarize(rows, ctx) -> object }
export async function runImporter(ctx, def, { dir = null, maxAgeDays = 30 } = {}) {
  const d = dir || path.join(ctx.pewp, "captures", def.dir);
  const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.json$/i.test(f)).sort() : [];
  if (!files.length) { const m = `no capture files in ${d} | unblocks: ${def.how}`; writeBlocked(ctx, def.out, m); throw new Blocked(m); }
  const rows = [], rejected = [];
  for (const f of files) {
    const file = path.join(d, f), j = J(file);
    const why = [];
    if (!j || typeof j !== "object" || Array.isArray(j)) why.push("not a JSON object");
    else {
      const at = Date.parse(j.capturedAt);
      if (!j.capturedAt || Number.isNaN(at)) why.push("no capture date (capturedAt)");
      else if (at > Date.now() + 86400000) why.push("capturedAt is in the future");
      if (!nonEmpty(j.browser)) why.push("no browser (who looked: \"owner's Edge\")");
      const r = def.check(j, ctx);
      why.push(...r.errors);
      if (!why.length) {
        const age = ageDays(j.capturedAt);
        rows.push({ ...r.row, file: f, capturedAt: j.capturedAt, browser: j.browser, ageDays: Math.round(age * 10) / 10, stale: age > maxAgeDays });
      }
    }
    if (why.length) rejected.push({ file: f, reason: why.join("; ") });
  }
  if (!rows.length) { const m = `every capture file was rejected (${rejected.length}; first: ${rejected[0].file}: ${rejected[0].reason}) | unblocks: capture again in the format at the top of scripts/${def.script}`; writeBlocked(ctx, def.out, m); throw new Blocked(m); }
  return writeStep(ctx, def.out, { module: def.module, dir: d, maxAgeDays, files: files.length, rows, summary: def.summarize(rows, ctx), rejected, staleCount: rows.filter((r) => r.stale).length });
}

export function cli(metaUrl, def) {
  const usage = `node ${def.script} <url> [--dir DIR (default <pewp>/captures/${def.dir})] [--max-age-days 30] [--cwd DIR]`;
  return runCli(metaUrl, usage, [], async (a) => {
    const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
    const r = await runImporter(ctx, def, { dir: a.get("dir"), maxAgeDays: a.num("max-age-days", 30, { min: 0 }) });
    return `OK ${def.module}: ${r.rows.length} rows from ${r.files} files, ${r.rejected.length} rejected, ${r.staleCount} stale${r.rejected.map((x) => `\n  rejected ${x.file}: ${x.reason}`).join("")}\n  -> ${path.join(ctx.rdir, `${def.out}.json`)}`;
  });
}
