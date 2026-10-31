// PRF-001 (P2): the speed budgets per page, from the snapshot's real-Chrome phone measurement (pages/<slug>/browser-mobile.json) or, when a
// PageSpeed Insights file is present, from its mobile numbers instead. Parts lcp, cls, tbt; a finding is budget-exceeded with the metric and value.
// An UNTRUSTED lab number (_site.json pages[].speedTrust) is not a finding: SKIP, take the PSI number. The seo part is notCovered.
// Folder mode has no measurement: no lines at all (the rule is listed as not covered, not printed as SKIP on every run).
import { mk } from "../lib/check.mjs";
import { normPath } from "../lib/site.mjs";

export const id = "PRF-001";
export const severity = "P2";
export const source = "checklist/performance.md PRF-001";
export const notCovered = ["seo part: the Lighthouse SEO category score is not in the snapshot", "folder mode: every part (a built folder has no browser measurement)"];
const f = mk(id);

export const subjects = (site) => (site.mode === "snapshot" ? site.pageList.map((p) => p.path) : []);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// cdp-measure.mjs returns { vitals: { lcpMs, cls, tbtMs, ... }, ... } and snapshot-site.mjs saves it so; a flat { lcpMs, cls, tbtMs } is read too.
const metricsOf = (m) => { const v = m && typeof m.vitals === "object" && m.vitals ? m.vitals : m || {}; return { lcpMs: num(v.lcpMs), cls: num(v.cls), tbtMs: num(v.tbtMs) }; };
const urlKey = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "").toLowerCase() + normPath(x.pathname); } catch { return null; } };
const shown = (v, unit) => `${unit ? Math.round(v) : Number(v.toFixed(3))}${unit ? " " + unit : ""}`;

function psiFor(site, p) {
  if (!site.psi) return null;
  const keys = [urlKey(p.url), urlKey(p.crawledUrl)].filter(Boolean);
  return site.psi.pages.find((e) => e && String(e.strategy).toLowerCase() === "mobile" && keys.includes(urlKey(e.url))) || null;
}

function judge(out, p, m, speed, how) {
  for (const [name, key, unit, limit] of [["LCP", "lcpMs", "ms", speed.lcpMs], ["CLS", "cls", "", speed.cls], ["TBT", "tbtMs", "ms", speed.tbtMs]]) {
    const v = m[key];
    if (v === null) out.push(f.skip(p.path, `${name} not measured${how}`));
    else if (v > limit) out.push(f.fail(p.path, 1, `budget-exceeded: ${name} ${shown(v, unit)} > ${shown(limit, unit)}${how}`));
  }
}

export function run(site) {
  if (site.mode !== "snapshot") return [];
  const out = [];
  const speed = site.config.speed;
  for (const p of site.pageList) {
    const psi = psiFor(site, p);
    if (psi) { judge(out, p, metricsOf(psi), speed, ` (source: PSI ${site.psi.date})`); continue; }
    const m = site.readJson(`pages/${p.slug}/browser-mobile.json`);
    if (!m) { out.push(f.skip(p.path, "not measured: the snapshot has no browser-mobile.json for this page")); continue; }
    const entry = ((site.meta && site.meta.pages) || []).find((e) => e && e.slug === p.slug);
    const trust = entry && typeof entry.speedTrust === "string" ? entry.speedTrust : null;
    if (trust !== "trusted") {
      const why = trust === null ? "no speedTrust recorded" : trust.replace(/^UNTRUSTED:?\s*/i, "") || "UNTRUSTED";
      out.push(f.skip(p.path, `speed UNTRUSTED (${why}); take the PageSpeed Insights number (psi.mjs, then --psi FILE or psi/<date>.json in the folder)`));
      continue;
    }
    judge(out, p, metricsOf(m), speed, "");
  }
  return out;
}
