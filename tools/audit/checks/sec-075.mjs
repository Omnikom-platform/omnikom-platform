// SEC-075 (P1): the strength of the Content-Security-Policy SEC-010 finds, on the same pages. Script sources are script-src, else default-src.
//   (a) 'strict-dynamic' together with a nonce or hash source: host and scheme sources are ignored (CSP 3) and (b) is skipped.
//   (b) otherwise the script sources have no "*", no scheme-only source (https:, http:, data:, blob:), no host source with "*" in its registrable-domain part, and no
//       host of lib/csp-bypass-hosts.json.
//   (c) no 'unsafe-eval' unless csp.allowUnsafeEval ('wasm-unsafe-eval' is fine). (d) object-src is 'none', or absent with default-src 'none'.
//   (e) base-uri is 'self' or 'none'. form-action absent is a WARN.
// With several enforced policies a condition is met when any one policy meets it. Content-Security-Policy-Report-Only is ignored. A page with no enforced policy
// (or csp.required false) gets no SEC-075 finding: SEC-010 reports the absence.
import { mk, headLine } from "../lib/check.mjs";
import { parseCsp, scriptSources, hasNonceOrHash, BYPASS_HOSTS } from "../lib/secheaders.mjs";

export const id = "SEC-075";
export const severity = "P1";
export const source = "checklist/security.md SEC-075";
export const notCovered = ["the registrable domain is read without the Public Suffix List (a wildcard is refused when fewer than two labels follow it, or when what follows is one of a short list of two-label suffixes)", "directives other than script-src, default-src, object-src, base-uri and form-action", "the bypass-host list is exact-host only (as the spec says)"];
const f = mk(id);

const judged = (site) => site.pageList.filter((p) => p.headersKnown && !(site.mode === "static" && p.file === "404.html"));
export const subjects = (site) => judged(site).map((p) => p.path);

const TWO_LABEL_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.cn", "co.za", "com.mx"]);
const cut = (s) => (String(s).length > 160 ? String(s).slice(0, 157) + "..." : String(s));

// The first fault of a script source list under (b): { source, why } or null.
function weakSource(tokens) {
  for (const t of tokens) {
    if (t.startsWith("'")) continue; // 'self', 'none', nonces, hashes, keywords: not host or scheme sources
    if (t === "*") return { source: t, why: "allows every host" };
    if (/^[a-z][a-z0-9+.-]*:$/i.test(t)) return { source: t, why: "a scheme-only source allows every host on that scheme" };
    const host = t.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[/:?#].*$/, "").toLowerCase();
    if (host.includes("*")) {
      const rest = host.startsWith("*.") ? host.slice(2) : null;
      if (rest === null || rest.includes("*") || rest.split(".").length < 2 || TWO_LABEL_SUFFIXES.has(rest)) return { source: t, why: "the wildcard sits in the registrable-domain part, so it allows every site under that suffix" };
      continue;
    }
    const bad = BYPASS_HOSTS.find((b) => b.host === host);
    if (bad) return { source: t, why: `${bad.host} ${bad.reason}` };
  }
  return null;
}

export function run(site) {
  const out = [];
  const cfg = site.config.csp;
  if (!cfg.required) return out;
  for (const p of judged(site)) {
    const lines = p.headers["content-security-policy"] || [];
    const policies = parseCsp(lines.map((l) => l.value));
    if (!policies.length) continue;
    const at = headLine(p);
    const where = lines.map((l) => l.where).join(" and ");
    const fail = (what) => out.push(f.fail(p.path, at, `header-value: ${what} (Content-Security-Policy from ${where})`));
    // (a) and (b): the script sources
    const bScript = policies.map((pol) => {
      const src = scriptSources(pol);
      if (!src) return { ok: false, what: "there is no script-src and no default-src, so scripts are not restricted" };
      if (src.some((t) => t.toLowerCase() === "'strict-dynamic'") && hasNonceOrHash(src)) return { ok: true }; // (a): host and scheme sources are ignored
      const weak = weakSource(src);
      return weak ? { ok: false, what: `script sources ${cut(src.join(" "))}: "${weak.source}" is not allowed (${weak.why})` } : { ok: true };
    });
    if (!bScript.some((v) => v.ok)) fail(bScript[0].what);
    // (c) 'unsafe-eval'
    if (!cfg.allowUnsafeEval && !policies.some((pol) => !(scriptSources(pol) || []).some((t) => t.toLowerCase() === "'unsafe-eval'"))) fail("script sources contain 'unsafe-eval' (csp.allowUnsafeEval is not set)");
    // (d) object-src
    const objectOk = (pol) => (pol.directives.has("object-src") ? pol.directives.get("object-src").join(" ").toLowerCase() === "'none'" : (pol.directives.get("default-src") || []).join(" ").toLowerCase() === "'none'");
    if (!policies.some(objectOk)) fail(`object-src is ${policies[0].directives.has("object-src") ? cut(policies[0].directives.get("object-src").join(" ")) : "missing and default-src is not 'none'"}, it must be 'none'`);
    // (e) base-uri
    const baseOk = (pol) => pol.directives.has("base-uri") && ["'self'", "'none'"].includes(pol.directives.get("base-uri").join(" ").toLowerCase());
    if (!policies.some(baseOk)) fail(`base-uri is ${policies[0].directives.has("base-uri") ? cut(policies[0].directives.get("base-uri").join(" ")) : "missing"}, it must be 'self' or 'none'`);
    // form-action (W)
    if (!policies.some((pol) => pol.directives.has("form-action"))) out.push(f.warn(p.path, at, `header-value: form-action is missing (Content-Security-Policy from ${where})`));
  }
  return out;
}
