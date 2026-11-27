// The driver ledger: one JSON line per request a driver sends, or the gate does not send, in <pewp>/ledger/requests.jsonl.
// Line: at, run, client, driver, source, host, kind, path, params, signedIn, status, result, why, bytes, ms.
// It holds query parameter NAMES only: no query value, user, password or fragment.
// lib-ledger.mjs is the rule ledger, another thing.
import fs from "node:fs";
import path from "node:path";

export const KINDS = ["api", "file", "reader", "site"];
export const RESULTS = ["read", "check", "403", "429", "quota", "key", "sign-in", "error", "not sent"];
export const WHY = ["unknown-source", "terms", "stop", "limit", "robots", "refused", "address"];
const KEYS = ["run", "client", "driver", "source", "kind", "url", "result", "signedIn", "status", "why", "bytes", "ms"];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

// one form of a host name: lower case, and no dot at its end. A loop, not a RegExp: a RegExp is slow on a host of many dots.
export const hostForm = (host) => { const s = String(host).toLowerCase(); let end = s.length; while (end > 0 && s[end - 1] === ".") end--; return s.slice(0, end); };

export const ledgerFile = (pewp) => path.join(pewp, "ledger", "requests.jsonl");

// the message names the field and never its value: a refused url may carry a key
const need = (ok, field) => { if (!ok) throw new Error(`driver ledger: bad ${field}`); };
const count = (v) => v === null || (Number.isInteger(v) && v >= 0);

// the line that record would write: every check but the one on pewp; writes nothing
export function lineOf(entry, now = Date.now()) {
  for (const k of Object.keys(entry)) need(KEYS.includes(k), `key ${k}`);
  const { run, client, driver, source, kind, url, result, signedIn = false, status = null, why = null, bytes = null, ms = null } = entry;
  for (const [field, v] of Object.entries({ run, client, driver, source })) need(typeof v === "string" && NAME.test(v), field);
  // a source that is not in the table has no kind
  need(KINDS.includes(kind) || (kind === null && why === "unknown-source"), "kind");
  need(RESULTS.includes(result), "result");
  need(typeof url === "string" && URL.canParse(url), "url");
  const u = new URL(url);
  need(u.protocol === "http:" || u.protocol === "https:", "url");
  need(typeof signedIn === "boolean", "signedIn");
  need(status === null || (Number.isInteger(status) && status >= 100 && status <= 599), "status");
  need(count(bytes), "bytes");
  need(count(ms), "ms");
  if (result === "not sent") {
    need(status === null, "status");
    need(bytes === null, "bytes");
    need(ms === null, "ms");
    need(WHY.includes(why), "why");
  } else {
    need(why === null, "why");
    need(result === "error" || status !== null, "status");
  }
  return { at: new Date(now).toISOString(), run, client, driver, source, host: hostForm(u.hostname), kind, path: u.pathname, params: [...new Set(u.searchParams.keys())].sort(), signedIn, status, result, why, bytes, ms };
}

export function record(pewp, entry, now = Date.now()) {
  need(typeof pewp === "string" && pewp !== "", "pewp");
  const line = lineOf(entry, now);
  const file = ledgerFile(pewp);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(line) + "\n");
  return line;
}
