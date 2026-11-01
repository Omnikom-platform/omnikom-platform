// ENV-001 (P0): the build's indexing matches its target. A preview must keep every HTML page out of the index (noindex in the X-Robots-Tag header or
// in a meta robots tag); a production build must carry no X-Robots-Tag noindex header on any HTML page. The target is given, never guessed:
// audit(dir, { target: "preview" | "production" }), run.mjs --target. With no target the rule judges nothing and prints exactly ONE line, the site-wide
// `SKIP ENV-001 / no --target ...` (head of operations, 2026-11-01, final: a check that did not run is never silent). The one-line switch that makes a
// folder with no target a usage error is REQUIRE_TARGET_FOR_FOLDER in index.mjs.
import { mk, headLine } from "../lib/check.mjs";

export const id = "ENV-001";
export const severity = "P0";
export const source = "factory/lib/launch.mjs headersText and factory/README.md (robots.txt always Allow, the preview kept out by X-Robots-Tag; head, 2026-10-31); head of operations, 2026-11-01 (slice 4c)";
const f = mk(id);

// the pages this rule judges: every HTML page the audit sees, except a built folder's root 404.html (a 404 page is IDX-006's business, not this rule's)
const judged = (site) => site.pageList.filter((p) => !(site.mode === "static" && p.file === "404.html"));

// no target: no per-page subjects; the one SKIP line is site-wide and carries the subject "/" (run() below), the engine adds it after the subjects
export const subjects = (site) => (site.target ? judged(site).map((p) => p.path) : []);

export function run(site) {
  if (!site.target) return [f.skip("/", "no --target, so indexing is not judged (give --target preview|production)")];
  const out = [];
  const snap = site.mode === "snapshot";
  const hf = site.headersFile;
  const skipped = hf && hf.skipped.length ? `; the _headers pattern(s) ${hf.skipped.join(", ")} cannot be matched exactly and are not judged` : "";
  for (const p of judged(site)) {
    if (site.target === "preview") {
      if (p.metaNoindex || p.headerNoindex) continue;
      const where = snap ? "the response has no x-robots-tag noindex that applies to Google" : hf && hf.present ? `no X-Robots-Tag noindex line of _headers matches ${p.path}${skipped}` : "the folder has no _headers file";
      out.push(f.fail(p.path, headLine(p), `missing-element: target preview, but the page is not noindex (${where}, and it has no meta robots noindex), so a preview would be indexed`));
    } else if (p.headerNoindex) {
      out.push(f.fail(p.path, headLine(p), `forbidden-value: target production, but ${p.headerSource} puts noindex on the page, so a production site would be kept out of the index`));
    }
  }
  return out;
}
