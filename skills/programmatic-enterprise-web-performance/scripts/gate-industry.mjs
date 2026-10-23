// GT-010 industry-rules: the checkable items of rules/industries/<business.json industry>.json against every indexable built
// page: licence number shown (pattern per state, and equal to credentials.licenseNumber), brokerage name on every page,
// forbidden wording (fair housing, deceptive claims, foreclosure copy while a default binds, unfilled {{placeholders}}), and
// required disclosure pages, required-when-present statements (a disclosure that must appear on a page that makes a claim, has a form or sits under a path;
// optionally within nearChars of the claim) and forbidden-schema JSON-LD types. Items with severity "warn" print WARN and fail only with --strict; --waive <id> skips an item a
// sign-off has lifted. Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { normPath } from "./lib-site.mjs";
import { pass, fail, error, isIndexable, runCli } from "./lib-plan.mjs";

export const id = "GT-010";
export const title = "industry-rules";
export const plain = "The legal and trust items for this kind of business are on every page";
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function run(ctx) {
  const rules = ctx.rules;
  if (!rules) return pass("no industry rules selected in business.json");
  const biz = ctx.business, pages = [...ctx.site.pages.values()].filter((p) => ctx.indexable(p));
  if (!pages.length) return biz.launchState === "live" ? fail("every page is noindex but the business is live", ["remove the noindex or set launchState to planned/preview"]) : error("the site has no pages");
  const out = [], notes = [];
  let nFail = 0, nWarn = 0, nErr = 0;
  const report = (item, level, msg) => {
    const sev = level === "FAIL" && item.severity === "warn" && !ctx.strict ? "WARN" : level;
    if (sev === "FAIL") nFail++; else if (sev === "WARN") nWarn++; else if (sev === "ERROR") nErr++;
    out.push(`${sev} ${item.id} ${msg}`);
  };
  for (const item of rules.items) {
    if (ctx.waive.has(item.id)) { notes.push(`NOTE ${item.id} waived (--waive)`); continue; }
    if (item.unlessField && get(biz, item.unlessField)) { notes.push(`NOTE ${item.id} not applicable (${item.unlessField} is set)`); continue; }
    if (item.type === "licence-on-every-page") {
      const state = get(biz, item.stateField) || "default", num = get(biz, item.numberField);
      const pat = item.licencePatterns[state] || item.licencePatterns.default;
      if (!item.licencePatterns[state]) notes.push(`NOTE ${item.id} no licence pattern for state "${state}", used the generic one`);
      const re = new RegExp(pat, "i");
      for (const pg of pages) {
        if (!re.test(pg.text)) report(item, "FAIL", `${pg.path} no licence number shown`);
        else if (num && !pg.text.includes(num)) report(item, "FAIL", `${pg.path} shows a licence number that is not ${num}`);
      }
    } else if (item.type === "business-text-on-every-page") {
      const val = get(biz, item.field);
      if (!val) { report(item, "ERROR", `business.json has no ${item.field}, cannot judge`); continue; }
      for (const pg of pages) if (!squash(pg.text).includes(squash(val))) report(item, "FAIL", `${pg.path} does not show "${val}"`);
    } else if (item.type === "forbidden-phrases") {
      const res = item.patterns.map((p) => new RegExp(p, "i"));
      for (const pg of pages) {
        const hay = [pg.title, pg.metaDescription, pg.text].join(" \n ");
        for (const re of res) { const m = hay.match(re); if (m) { report(item, "FAIL", `${pg.path} contains "${m[0].slice(0, 60)}"`); break; } }
      }
    } else if (item.type === "required-when-present") {
      // A page in scope (pathPattern; trigger found in its text, or a form on it, or every page when neither is given) must show every
      // required statement. With nearChars the statement must sit within that many characters of some trigger match (disclosure next to the claim).
      const inScope = item.pathPattern ? new RegExp(item.pathPattern, "i") : null;
      const trig = item.trigger ? new RegExp(item.trigger, "gi") : null;
      const reqs = item.require.map((r) => ({ label: r.label, re: new RegExp(r.pattern, r.caseSensitive ? "" : "i") }));
      for (const pg of pages) {
        if (inScope && !inScope.test(pg.path)) continue;
        if (item.pageHasForm && !(pg.forms > 0)) continue;
        let hits = [];
        if (trig) { hits = [...pg.text.matchAll(trig)].filter((m) => m[0].length); if (!hits.length) continue; }
        for (const r of reqs) {
          let ok;
          if (item.nearChars && hits.length) { const w = item.nearChars; ok = hits.some((m) => r.re.test(pg.text.slice(Math.max(0, m.index - w), m.index + m[0].length + w))); }
          else ok = r.re.test(pg.text);
          if (!ok) report(item, "FAIL", `${pg.path} is missing: ${r.label}${item.nearChars && hits.length ? ` (within ${item.nearChars} characters of "${hits[0][0].slice(0, 40)}")` : ""}`);
        }
      }
    } else if (item.type === "forbidden-schema") {
      // JSON-LD @type values that must not appear on a published page (exact type names, @graph walked).
      const bad = new Set(item.types.map((t) => t.toLowerCase()));
      const walk = (n, acc) => { if (Array.isArray(n)) { n.forEach((x) => walk(x, acc)); return acc; } if (!n || typeof n !== "object") return acc; for (const t of [].concat(n["@type"] || [])) acc.push(String(t)); for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, acc); return acc; };
      for (const pg of pages) {
        const found = [...new Set((pg.jsonld || []).flatMap((b) => (b.parsed ? walk(b.parsed, []) : [])))].filter((t) => bad.has(t.toLowerCase()));
        if (found.length) report(item, "FAIL", `${pg.path} has JSON-LD type ${found.join(", ")}`);
      }
    } else if (item.type === "required-pages") {
      for (const group of item.anyOf) if (!group.some((p) => ctx.site.pages.has(normPath(p)))) report(item, "FAIL", `none of ${group.join(" or ")} exists`);
    } else report(item, "ERROR", `unknown item type ${item.type}`);
  }
  const detail = [...out, ...notes, ...ctx.noindexNote];
  if (nFail) return fail(`${nFail} industry rule problem(s)${nWarn ? `, ${nWarn} warning(s)` : ""} (${rules.slug})`, detail);
  if (nErr) return error(`${nErr} industry item(s) could not be judged (${rules.slug})`, detail);
  return pass(`${rules.items.length} industry rule item(s) on ${pages.length} page(s)${nWarn ? `, ${nWarn} warning(s)` : ""} (${rules.slug})`, detail);
}
runCli(import.meta.url, { id, run });
