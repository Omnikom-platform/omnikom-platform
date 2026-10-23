// Where a run keeps its state, and the state file itself. Every stage reads its inputs from files and writes its
// outputs to files, so a run resumes after a compaction or crash and any stage can be re-run alone.
//   URL target  -> <cwd>/site-checks/<host>/.pewp/   (+ snapshots in <cwd>/site-checks/<host>/snapshots/<date>/)
//   repo target -> <repo>/.pewp/                     (research, plan, targets are committed; cache is not)
// Usage: node state.mjs <target> [--init <mode>] [--stage <name> --output <path>]... [--show] [--cwd DIR]
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const isUrl = (t) => /^https?:\/\//i.test(String(t));
export function locate(target, { cwd = process.cwd() } = {}) {
  if (isUrl(target)) {
    const host = new URL(target).hostname.replace(/^www\./, "");
    const root = path.join(cwd, "site-checks", host);
    return { kind: "url", target: new URL(target).origin + "/", host, root, pewp: path.join(root, ".pewp"), snapshots: path.join(root, "snapshots") };
  }
  const root = path.resolve(target);
  return { kind: "repo", target: root, root, pewp: path.join(root, ".pewp") };
}
const file = (loc) => path.join(loc.pewp, "state.json");
export function load(loc) { try { return JSON.parse(fs.readFileSync(file(loc), "utf8")); } catch { return null; } }
export function save(loc, st) {
  fs.mkdirSync(loc.pewp, { recursive: true });
  st.updatedAt = new Date().toISOString();
  fs.writeFileSync(file(loc), JSON.stringify(st, null, 1) + "\n");
  // A run's private files never go to git: cache always, and the whole .pewp for URL targets (client content).
  const gi = path.join(loc.pewp, ".gitignore");
  // Repo targets: research, plan, targets and approved/ are committed; run state, logs and caches never are.
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, loc.kind === "url" ? "*\n" : "cache/\ndoctor.json\nstate.json\nguard-before.json\nrefactor/\nmeasure/\n");
  return st;
}
export function init(loc, mode) {
  const prev = load(loc);
  return save(loc, { mode, target: loc.target, kind: loc.kind, startedAt: new Date().toISOString(), stages: {}, history: prev ? [...(prev.history || []), { mode: prev.mode, startedAt: prev.startedAt, stages: Object.keys(prev.stages || {}) }].slice(-20) : [] });
}
export function markStage(loc, stage, outputs = {}, extra = {}) {
  const st = load(loc) || init(loc, "unknown");
  st.stages[stage] = { doneAt: new Date().toISOString(), outputs, ...extra };
  return save(loc, st);
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  if (!a[0] || a[0].startsWith("--")) { console.error("usage: node state.mjs <target> [--init <mode>] [--stage <name> --output <path>]... [--show] [--cwd DIR]"); process.exit(2); }
  const loc = locate(a[0], { cwd: opt("--cwd") || process.cwd() });
  if (opt("--init")) init(loc, opt("--init"));
  if (opt("--stage")) markStage(loc, opt("--stage"), Object.fromEntries(a.flatMap((x, i) => (x === "--output" ? [[path.basename(a[i + 1]), a[i + 1]]] : []))));
  console.log(JSON.stringify({ location: loc, state: load(loc) }, null, 1));
}
