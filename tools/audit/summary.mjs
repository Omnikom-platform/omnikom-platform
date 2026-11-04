// The audit summary: summarize(r, { commit }) turns the object audit() returns into one small, versioned object a publish job can store per site.
// Node built-ins only, nothing written. The publish runner's callback refuses a gate report over 64 KiB (supabase/functions/job-callback/index.ts
// MAX_REPORT), so the JSON of a summary stays under MAX_BYTES (60 KiB) for any input.
//   import { audit } from "./index.mjs"; import { summarize } from "./summary.mjs";
//   const s = summarize(audit("path/to/built/site", { target: "preview" }), { commit: "bb60318" });
//   s = { v: 1, target, mode, pass, exit, pages, rules, counts: { PASS, FAIL, SKIP, ... }, byFamily: { MET: { PASS, FAIL, SKIP, ... } },
//         byTopic: { headings: { PASS, FAIL, SKIP, ... } }, fails: [{ rule, page, line, what, source }], truncated, commit? }
// pages and rules are counts. The family is the rule id up to the first "-" (MET-003 -> MET). counts and byFamily always carry PASS, FAIL and SKIP;
// a status that is none of them (WARN today) is counted under its own key, never dropped. PASS is the number of PASS lines (one per rule and page).
// byTopic counts the same lines by the plain topic of names.json (MET-003 -> headings): every topic of names.mjs TOPICS is present (zeros when none),
// a rule id outside the table is counted under "other".
import { TOPICS, topicOf } from "./names.mjs";
export const MAX_FAILS = 200;
export const MAX_WHAT = 300;
export const MAX_BYTES = 60 * 1024;
const MAX_KEY = 40;      // the longest rule id, family or status name kept as a key or a value
const MAX_KEYS = 40;     // the most distinct families, and the most distinct unusual statuses; more are counted under "OTHER"
const BASE = ["PASS", "FAIL", "SKIP"];

const cut = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 3) + "..." : s; };
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");
const zero = () => Object.assign(Object.create(null), { PASS: 0, FAIL: 0, SKIP: 0 });   // no prototype: a status or family named "constructor" is only a key
const bump = (map, key, limit) => {
  const k = cut(key, MAX_KEY);
  const at = k in map || Object.keys(map).length < limit ? k : "OTHER";
  map[at] = (map[at] || 0) + 1;
};

export function summarize(r, { commit } = {}) {
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const sourceOf = new Map((Array.isArray(r.rules) ? r.rules : []).map((x) => [x.id, x.source]));
  const familyOf = (id) => cut(String(id).split("-")[0], MAX_KEY);
  const counts = zero(), byFamily = Object.create(null);
  const family = (id) => { const f = familyOf(id); const at = f in byFamily || Object.keys(byFamily).length < MAX_KEYS ? f : "OTHER"; return (byFamily[at] ||= zero()); };
  const byTopic = Object.create(null);
  for (const t of TOPICS) byTopic[t.id] = zero();
  const topic = (id) => (byTopic[topicOf(id)] ||= zero());
  const add = (target, status) => { if (BASE.includes(status)) target[status]++; else bump(target, status, MAX_KEYS + BASE.length); };
  for (const x of sourceOf.keys()) family(x);
  for (const l of lines) {
    if (!String(l).startsWith("PASS ")) continue;
    counts.PASS++; family(String(l).split(" ")[1])["PASS"]++;
    topic(String(l).split(" ")[1])["PASS"]++;
  }
  const allFails = [];
  for (const f of findings) {
    const status = String(f.status);
    if (status === "PASS") continue;                       // a PASS has no finding of its own; its line is counted above
    add(counts, status); add(family(f.rule), status);
    add(topic(f.rule), status);
    if (status === "FAIL") allFails.push({ rule: cut(f.rule, MAX_KEY), page: cut(f.page, MAX_WHAT), line: Number.isFinite(f.line) ? f.line : null, what: cut(f.what, MAX_WHAT), source: cut(sourceOf.get(f.rule), MAX_WHAT) });
  }
  const out = { v: 1, target: r.target ?? null, mode: r.mode ?? null, pass: !!r.pass, exit: r.exit, pages: Array.isArray(r.pages) ? r.pages.length : 0, rules: Array.isArray(r.rules) ? r.rules.length : 0, counts, byFamily, byTopic, fails: [], truncated: 0 };
  if (commit) out.commit = cut(commit, 64);
  // keep fails in rule order up to MAX_FAILS and while the whole JSON stays under MAX_BYTES (16 spare bytes for the final truncated number)
  let size = bytes(out) + 16;
  for (const f of allFails) {
    const b = bytes(f) + 1;
    if (out.fails.length >= MAX_FAILS || size + b > MAX_BYTES) break;
    out.fails.push(f); size += b;
  }
  out.truncated = allFails.length - out.fails.length;
  return out;
}
