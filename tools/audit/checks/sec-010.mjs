// SEC-010 (P1): the security headers on every 2xx text/html response. Per page: an enforced Content-Security-Policy (script sources without 'unsafe-inline' unless
// a nonce or hash comes with it, and a frame-ancestors directive); X-Content-Type-Options: nosniff; a Referrer-Policy whose last valid token is one of four;
// a Permissions-Policy that parses as an RFC 8941 dictionary; Strict-Transport-Security with max-age of at least a year. The headers are the ones a snapshot's
// response carried, or the ones the folder's _headers file gives the page; a folder with no _headers file says nothing about its headers and is not judged.
// A finding names the page, the header, the value and where it came from. SEC-075 judges the strength of the policy this rule finds.
import { mk, headLine } from "../lib/check.mjs";
import { parseCsp, scriptSources, hasNonceOrHash, hstsMaxAge, lastValidReferrerToken, parseSfDictionary } from "../lib/secheaders.mjs";

export const id = "SEC-010";
export const severity = "P1";
export const source = "checklist/security.md SEC-010";
export const notCovered = ["the isolation part (COOP, COEP, CORP; W) and the trusted-types part (W)", "a folder with no _headers file (its host may add headers, so nothing is judged)", "a header set by a host the folder cannot see (a Pages Function, an edge rule)"];
const f = mk(id);

const REFERRER_OK = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);
const YEAR = 31536000;
const cut = (s) => (String(s).length > 160 ? String(s).slice(0, 157) + "..." : String(s));

// the pages this rule judges: every page whose response headers are known, except a built folder's root 404.html (IDX-006's business, as in ENV-001)
const judged = (site) => site.pageList.filter((p) => p.headersKnown && !(site.mode === "static" && p.file === "404.html"));
export const subjects = (site) => judged(site).map((p) => p.path);

const lines = (p, name) => p.headers[name] || [];
const shown = (ls) => ls.map((l) => `"${cut(l.value)}" (${l.where})`).join(" and ");

export function run(site) {
  const out = [];
  const cfg = site.config.csp;
  const hf = site.headersFile;
  const skipped = hf && hf.skippedAll.length ? `; the _headers pattern(s) ${hf.skippedAll.join(", ")} cannot be matched exactly and are not judged` : "";
  for (const p of judged(site)) {
    const at = headLine(p);
    const fail = (what) => out.push(f.fail(p.path, at, what));
    // Content-Security-Policy (only when csp.required)
    if (cfg.required) {
      const enforced = lines(p, "content-security-policy");
      const policies = parseCsp(enforced.map((l) => l.value));
      if (!policies.length) {
        const ro = lines(p, "content-security-policy-report-only");
        fail(`missing-element: Content-Security-Policy is not sent${ro.length ? ` (a Content-Security-Policy-Report-Only header is, ${shown(ro)}, and it does not enforce anything)` : ""}${skipped}`);
      } else {
        const meets = (pol) => {
          const src = scriptSources(pol);
          const unsafeInline = !!src && src.some((t) => t.toLowerCase() === "'unsafe-inline'") && !hasNonceOrHash(src) && !cfg.allowUnsafeInlineScripts;
          return { unsafeInline, noAncestors: !pol.directives.has("frame-ancestors"), src };
        };
        const verdicts = policies.map(meets);
        if (!verdicts.some((v) => !v.unsafeInline)) fail(`header-value: Content-Security-Policy ${scriptSources(policies[0]) && policies[0].directives.has("script-src") ? "script-src" : "default-src"} allows 'unsafe-inline' with no nonce or hash source: ${shown(enforced)}`);
        if (!verdicts.some((v) => !v.noAncestors)) fail(`missing-element: Content-Security-Policy has no frame-ancestors directive (any value is accepted): ${shown(enforced)}`);
      }
    }
    // X-Content-Type-Options
    const xcto = lines(p, "x-content-type-options");
    if (!xcto.length) fail(`missing-element: X-Content-Type-Options is not sent (it must be nosniff)${skipped}`);
    else if (!xcto.some((l) => l.value.trim().toLowerCase() === "nosniff")) fail(`header-value: X-Content-Type-Options is not nosniff: ${shown(xcto)}`);
    // Referrer-Policy: the last valid token of the header
    const rp = lines(p, "referrer-policy");
    if (!rp.length) fail(`missing-element: Referrer-Policy is not sent${skipped}`);
    else {
      const last = lastValidReferrerToken(rp.map((l) => l.value).join(", "));
      if (!last || !REFERRER_OK.has(last)) fail(`header-value: Referrer-Policy ends with ${last ? last : "no valid policy token"}, not no-referrer, same-origin, strict-origin or strict-origin-when-cross-origin: ${shown(rp)}`);
    }
    // Permissions-Policy: present and an RFC 8941 dictionary
    const pp = lines(p, "permissions-policy");
    if (!pp.length) fail(`missing-element: Permissions-Policy is not sent${skipped}`);
    else {
      const parsed = parseSfDictionary(pp.map((l) => l.value).join(", "));
      if (!parsed.ok) fail(`header-value: Permissions-Policy does not parse as an RFC 8941 dictionary (${parsed.error}): ${shown(pp)}`);
    }
    // Strict-Transport-Security: present, max-age of at least a year (the edge half of the spec's hsts part: the response of the origin itself)
    const hsts = lines(p, "strict-transport-security");
    if (!hsts.length) fail(`missing-element: Strict-Transport-Security is not sent (max-age must be at least ${YEAR})${skipped}`);
    else {
      const ages = hsts.map((l) => hstsMaxAge(l.value));
      if (!ages.some((a) => a !== null && a >= YEAR)) fail(`header-value: Strict-Transport-Security max-age is ${ages.every((a) => a === null) ? "missing" : "below " + YEAR}: ${shown(hsts)}`);
    }
  }
  return out;
}
