// Readers for the security headers SEC-010 and SEC-075 judge (work order 38). Node built-ins only; nothing here judges, the checks do.
//   parseCsp(values)            the policies of one or more header values: [{ raw, directives: Map(name -> source tokens) }]; "," starts a new policy
//   scriptSources(policy)       the tokens of script-src, else default-src, else null (CSP 3: script-src falls back to default-src)
//   hasNonceOrHash(tokens)      a 'nonce-...' or 'sha256|384|512-...' source
//   hstsMaxAge(value)           the max-age in seconds, or null when the header has none (or a value that is not a whole number)
//   lastValidReferrerToken(v)   the last token of a Referrer-Policy value that is a policy keyword (the browser's fallback rule), or null
//   parseSfDictionary(text)     RFC 8941 section 3.2 (Structured Field dictionary), the grammar of Permissions-Policy: { ok } or { ok: false, error }
//   BYPASS_HOSTS                lib/csp-bypass-hosts.json: hosts that serve JSONP endpoints or script gadgets, so allowing one as a script source defeats the policy
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BYPASS_HOSTS = JSON.parse(fs.readFileSync(path.join(HERE, "csp-bypass-hosts.json"), "utf8"));

export function parseCsp(values) {
  const policies = [];
  for (const v of values) for (const part of String(v).split(",")) {
    const directives = new Map();
    for (const d of part.split(";")) {
      const toks = d.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      const name = toks[0].toLowerCase();
      if (!directives.has(name)) directives.set(name, toks.slice(1)); // a repeated directive is ignored after the first (CSP 3 parse)
    }
    if (directives.size) policies.push({ raw: part.trim(), directives });
  }
  return policies;
}

export const scriptSources = (policy) => policy.directives.get("script-src") ?? policy.directives.get("default-src") ?? null;
export const hasNonceOrHash = (tokens) => tokens.some((t) => /^'(nonce-[^']+|sha(256|384|512)-[^']+)'$/i.test(t));

export function hstsMaxAge(value) {
  for (const d of String(value).split(";")) {
    const m = /^\s*max-age\s*=\s*"?(\d+)"?\s*$/i.exec(d);
    if (m) return Number(m[1]);
  }
  return null;
}

const REFERRER_KEYWORDS = new Set(["no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin", "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url"]);
export function lastValidReferrerToken(value) {
  const toks = String(value).split(",").map((t) => t.trim().toLowerCase()).filter((t) => REFERRER_KEYWORDS.has(t));
  return toks.length ? toks[toks.length - 1] : null;
}

// RFC 8941 section 3.2 (read 2026-11-10). key = ( lcalpha / "*" ) *( lcalpha / DIGIT / "_" / "-" / "." / "*" ); a member is key, then optionally "=" and an
// item or an inner list ("(" items separated by spaces ")"), then ";" parameters; members are separated by "," with optional whitespace; no trailing comma.
export function parseSfDictionary(text) {
  const s = String(text);
  let i = 0;
  const err = (m) => ({ ok: false, error: `${m} at position ${i}` });
  const skip = (re) => { while (i < s.length && re.test(s[i])) i++; };
  const key = () => { const m = /^[a-z*][a-z0-9_\-.*]*/.exec(s.slice(i)); if (!m) return null; i += m[0].length; return m[0]; };
  const bareItem = () => {
    const c = s[i];
    if (c === '"') {
      i++;
      while (i < s.length) {
        const ch = s[i];
        if (ch === "\\") { if (s[i + 1] !== '"' && s[i + 1] !== "\\") return false; i += 2; continue; }
        if (ch === '"') { i++; return true; }
        const code = s.charCodeAt(i);
        if (code < 0x20 || code > 0x7e) return false;
        i++;
      }
      return false;
    }
    if (c === "-" || (c >= "0" && c <= "9")) { const m = /^-?\d{1,15}(\.\d{1,3})?/.exec(s.slice(i)); if (!m) return false; i += m[0].length; return true; }
    if (c === ":") { const m = /^:[A-Za-z0-9+/=]*:/.exec(s.slice(i)); if (!m) return false; i += m[0].length; return true; }
    if (c === "?") { if (s[i + 1] !== "0" && s[i + 1] !== "1") return false; i += 2; return true; }
    const m = /^[A-Za-z*][A-Za-z0-9!#$%&'*+\-.^_`|~:/]*/.exec(s.slice(i));
    if (!m) return false;
    i += m[0].length;
    return true;
  };
  const params = () => {
    while (s[i] === ";") { i++; skip(/ /); if (key() === null) return false; if (s[i] === "=") { i++; if (!bareItem()) return false; } }
    return true;
  };
  const item = () => bareItem() && params();
  const innerList = () => {
    i++; // "("
    for (;;) {
      skip(/ /);
      if (s[i] === ")") { i++; return params(); }
      if (i >= s.length || !item()) return false;
      if (s[i] !== " " && s[i] !== ")") return false;
    }
  };
  skip(/[ \t]/);
  while (i < s.length) {
    if (key() === null) return err("expected a key");
    if (s[i] === "=") { i++; if (!(s[i] === "(" ? innerList() : item())) return err("expected an item or an inner list"); }
    else if (!params()) return err("bad parameter");
    skip(/[ \t]/);
    if (i >= s.length) return { ok: true };
    if (s[i] !== ",") return err('expected "," between members');
    i++;
    skip(/[ \t]/);
    if (i >= s.length) return err("trailing comma");
  }
  return { ok: true };
}
