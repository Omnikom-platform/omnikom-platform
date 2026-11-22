// The head's sign-off, written by rule (the owner's ruling of 2026-11-21, item 22; job 7 "one command": the audit runs as one job).
// Usage: node sign-by-rule.mjs <url or profile:slug> <business|seeds|competitors|research-cost> [--cwd DIR]
// The rule is ONE file, scripts/sign-off-rule.json: who ruled and when, who signs, the kinds that may be signed, and the ceiling in requests to free sources
// ("cost" is a number of requests; money is always 0). This script never decides more than that file says, and it signs only by calling approve.mjs as a child
// process, so every check approve.mjs makes still runs. There is no option that raises the ceiling or skips a check, and no kind outside the rule file.
//   business       every owner-only field whose provenance is not "owner" and not already a valid delegation, WITH a value, is stamped "delegated" in the working
//                  business.json (delegations[field] = { by, delegatedBy: "owner", at, from }); a field with NO value is never invented: the run stops (NEEDS-INPUT)
//                  naming every such field. A field the owner answered himself is never touched.
//   seeds, competitors   approve.mjs decides.
//   research-cost  the plan's total in research/research-cost.json: above the ceiling it stops for the owner's own signature, at or under it approve.mjs decides.
// After a signature the lock entry of that kind gets byRule: { ruledBy, ruledOn, signer }. A kind a person already signed, unchanged, is left as it is.
// Exit 0 signed, or already signed and unchanged (last line SIGNED BY RULE: ... or ALREADY SIGNED ...)
//      2 usage (also a kind outside the rule file)
//      3 a person is needed (last line NEEDS-INPUT ..., read by omnikom seo run and start.mjs as WAITING) or a file is missing (last line BLOCKED: <what> | unblocks: <what>)
//      1 approve.mjs said it signed but the lock does not show it (a broken tree)
// No network, no model. Writes only business.json (business, put back byte for byte when approve.mjs refuses) and approved/ through approve.mjs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { delegationOf } from "./lib-provenance.mjs";
import { FILE_KINDS, OWNER_ONLY, approvedDir, approvedMatches, readLock, verifyLock } from "./approve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "usage: node sign-by-rule.mjs <url or profile:slug> <business|seeds|competitors|research-cost> [--cwd DIR]";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const say = (s) => console.log(s);
// an exit is a thrown Done, so everything printed is flushed before the process ends (process.exit can cut a pipe short on Windows)
class Done extends Error { constructor(code) { super("exit " + code); this.code = code; } }

function usage(why) { console.error(why ? "ERROR sign-by-rule: " + why : USAGE); if (why) console.error(USAGE); throw new Done(2); }

function readRule() {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(here, "sign-off-rule.json"), "utf8").replace(/^﻿/, "")); } catch (e) { usage("the rule file scripts/sign-off-rule.json cannot be read: " + e.message); }
  const text = (x) => typeof x === "string" && x.trim().length > 0;
  const ok = isObj(r) && r.ruledBy === "owner" && text(r.ruledOn) && text(r.signer) && Array.isArray(r.kinds) && r.kinds.length && r.kinds.every((k) => text(k) && FILE_KINDS[k]) && Number.isFinite(r.costCeiling) && r.costCeiling >= 0;
  if (!ok) usage("the rule file scripts/sign-off-rule.json is not complete (ruledBy owner, ruledOn, signer, kinds, costCeiling)");
  return r;
}

// a value is something: not null, not empty text, not an empty list, not an empty object
const hasValue = (v) => !(v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length));
const valueOf = (b, field) => field.split(".").reduce((o, k) => (isObj(o) ? o[k] : undefined), b);
const readJson = (file) => { try { return { doc: JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) }; } catch (e) { return { error: e.message }; } };

const GONE = {
  business: ["no business.json", "the intake step writing it (node intake.mjs <target>)"],
  seeds: ["no research/seeds.json", "the seeds step writing it (node research-seeds.mjs <target>)"],
  competitors: ["no research/competitors-proposed.json", "node competitors-discover.mjs <target> writing it from what the discovery agents found"],
  "research-cost": ["no research/research-cost.json (the cost plan)", "the research-plan step writing it (node research.mjs <target> --dry)"],
};

function run(a) {
  if (a.includes("--help")) { say(USAGE); throw new Done(0); }
  const pos = []; let cwd = process.cwd();
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cwd") { if (!a[i + 1]) usage("--cwd needs a folder"); cwd = a[++i]; } else if (a[i].startsWith("--")) usage("no such option: " + a[i]); else pos.push(a[i]);
  }
  if (pos.length !== 2) usage();
  const [target, kind] = pos, rule = readRule();
  if (!rule.kinds.includes(kind)) usage("the rule signs only " + rule.kinds.join(", "));
  const cwdAbs = path.resolve(cwd);
  let loc; try { loc = locate(target, { cwd: cwdAbs }); } catch (e) { usage(e.message); }
  const pewp = loc.pewp, spec = FILE_KINDS[kind], workFile = path.join(pewp, ...spec.src.split("/"));
  const by = rule.signer + ", by the owner's rule of " + rule.ruledOn;
  const stopFor = (line) => { say(line); throw new Done(3); };
  const blocked = (what, unblocks) => stopFor("BLOCKED: " + what + " | unblocks: " + unblocks.replace("<target>", target));

  if (!fs.existsSync(workFile)) blocked(GONE[kind][0], GONE[kind][1]);

  // already signed and unchanged: nothing is signed again. A kind a person signed stays his; the approved copy gets a fresh time so a run reads it as written by this step.
  const entry = readLock(pewp)?.[kind];
  if (entry && approvedMatches(pewp, kind).ok && verifyLock(pewp).ok) {
    try { const t = new Date(); fs.utimesSync(path.join(approvedDir(pewp), spec.dst), t, t); } catch {}
    if (entry.byRule) { say("ALREADY SIGNED BY RULE: " + kind + " (" + entry.byRule.signer + ", owner's rule of " + entry.byRule.ruledOn + ")"); throw new Done(0); }
    say("ALREADY SIGNED: " + kind + " (by " + entry.approvedBy + " at " + entry.approvedAt + "), not by the rule: left as it is"); throw new Done(0);
  }

  let original = null;
  if (kind === "business") {
    const j = readJson(workFile);
    if (j.error) blocked("business.json is not JSON (" + j.error + ")", "the intake step run again");
    const b = j.doc, prov = isObj(b?.provenance) ? b.provenance : {}, stamp = [], empty = [];
    for (const f of OWNER_ONLY) {
      const p = prov[f] || "unstated";
      if (p === "owner") continue;
      if (p === "delegated" && delegationOf(b.delegations?.[f])) continue;
      if (!hasValue(valueOf(b, f))) { empty.push(f); continue; }
      stamp.push([f, p]);
    }
    if (empty.length) stopFor("NEEDS-INPUT business: " + empty.join(", ") + (empty.length > 1 ? " have" : " has") + " no value, so nothing is signed for the business: ask the owner, write the answer as {\"value\":..., \"answeredBy\":\"owner\"} in intake-answers.json, run intake again");
    if (stamp.length) {
      const now = new Date().toISOString(), nb = { ...b, provenance: { ...prov }, delegations: { ...(isObj(b.delegations) ? b.delegations : {}) } };
      for (const [f, p] of stamp) { nb.provenance[f] = "delegated"; nb.delegations[f] = { by: rule.signer, delegatedBy: "owner", at: now, from: p }; }
      original = fs.readFileSync(workFile);
      fs.writeFileSync(workFile, JSON.stringify(nb, null, 1) + "\n");
    }
  }
  if (kind === "research-cost") {
    const j = readJson(workFile);
    if (j.error) blocked("research/research-cost.json is not JSON (" + j.error + ")", "the research-plan step run again (node research.mjs <target> --dry)");
    const total = j.doc?.total;
    if (typeof total === "number" && total > rule.costCeiling) stopFor("NEEDS-INPUT research-cost: the research plan is " + total + " requests to free sources (money is always 0), above the " + rule.costCeiling + " the owner's rule lets the head sign, so nothing is signed: the owner signs it himself with node approve.mjs " + target + " research-cost --by \"<name>\" --cwd " + (/\s/.test(cwdAbs) ? JSON.stringify(cwdAbs) : cwdAbs));
  }

  const res = spawnSync(process.execPath, [path.join(here, "approve.mjs"), target, kind, "--by", by, "--cwd", cwdAbs], { encoding: "utf8", timeout: 120000, windowsHide: true });
  const lines = ((res.stdout || "") + (res.stderr || "")).split(/\r?\n/).filter((l) => l.trim());
  for (const l of lines) say("  approve: " + l.trim());
  if (res.status !== 0) {
    if (original) fs.writeFileSync(workFile, original);
    stopFor("NEEDS-INPUT " + kind + ": approve.mjs did not sign (exit " + res.status + "), the rule signs nothing it refuses: " + (lines[0] || res.error?.message || "no output").trim() + (lines[1] ? " - " + lines[1].trim() : ""));
  }
  const lock = readLock(pewp);
  if (!lock?.[kind]) { console.error("ERROR sign-by-rule: approve.mjs exited 0 but approved/lock.json has no " + kind + " entry"); throw new Done(1); }
  lock[kind].byRule = { ruledBy: rule.ruledBy, ruledOn: rule.ruledOn, signer: rule.signer };
  fs.writeFileSync(path.join(approvedDir(pewp), "lock.json"), JSON.stringify(lock, null, 1) + "\n");
  say("SIGNED BY RULE: " + kind + " (" + rule.signer + ", owner's rule of " + rule.ruledOn + ")");
  throw new Done(0);
}

if (isMain(import.meta.url)) {
  try { run(process.argv.slice(2)); } catch (e) { if (e instanceof Done) process.exitCode = e.code; else throw e; }
}
