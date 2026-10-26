// build mode driver: intake -> research -> plan -> builder handoff -> (builder session) -> gate -> measure.
// It runs the stage scripts in order from <target>/.pewp/state.json, stops at each missing input with the exact
// question list for the MAIN session (which asks the owner as pickable options), writes the builder's spec, and
// resumes where it stopped. It builds no stage itself; the stage scripts are owned by other builders.
// Usage: node build-site.mjs <target dir> [--brief <file>] [--go] [--builder-done] [--site <built site dir>] [--strict] [--pewp <state dir>]
//          [--research-args "<extra research.mjs args>"] [--plan-args "<extra plan-site.mjs args>"] [--live-url <url>]
//          [--force <stage>] [--stage-scripts <dir>] [--stage-timeout-min 60]
//   no --go          print the plan (stages, status, cost) and stop: the main session shows it and asks first
//   --go             run every stage that is pending or stale, in order
//   --builder-done   the builder session finished: run the gate (then measure) against --site (default <target>/site)
// The stage scripts are called with THEIR OWN command lines (as delivered by their owners):
//   intake.mjs <target>                 reads <pewp>/intake-answers.json itself; exit 3 = questions open (written to
//                                       <pewp>/intake-facts.json "questions", shaped for AskUserQuestion)
//   research.mjs <target> [--research-args "..."]   exit 3 = BLOCKED (no intake / no query universe / owner confirmation)
//   plan-site.mjs <pewp dir> [--plan-args "..."]    exit 0 written, 1 invalid input, 2 a file is missing
//   gate.mjs <pewp dir> <site dir> [--strict] [--build "<cmd>" --build-cwd <dir>]   exit 0 all PASS, 1 any FAIL, 2 could not judge
//     the site build command (GT-013 builds twice and compares the dates): --site-build "<cmd>" [--site-build-cwd <dir>], else
//     the first line of <pewp>/builder/build-command.txt (the handoff asks the builder to write it); none = GT-013 reads one build only
//   measure.mjs <live url>              only with --live-url (a site that is not live cannot be measured)
// <target> is a folder; its state lives in <target>/.pewp. --brief <file> is stored as .pewp/brief.txt: the main session
// turns it into intake answers it is sure of and asks the owner only the rest.
// Exit: 0 ran to a natural pause or the end; 1 a stage failed / the gate failed; 3 needs input; 4 blocked; 2 usage.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locate, load, save, init, markStage } from "./state.mjs";

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--brief", "--site", "--force", "--stage-scripts", "--stage-timeout-min", "--research-args", "--plan-args", "--live-url", "--site-build", "--site-build-cwd", "--pewp"]);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const positional = A.filter((x, i) => !x.startsWith("--") && !VALUE_FLAGS.has(A[i - 1]));
if (!positional[0]) { console.error("usage: node build-site.mjs <target dir> [--brief file] [--go] [--builder-done] [--site dir] [--force stage] [--stage-scripts dir]"); process.exit(2); }

const target = path.resolve(positional[0]);
fs.mkdirSync(target, { recursive: true });
// --pewp DIR: the run state lives elsewhere (overhaul: with the live site under site-checks/<host>/.pewp while the code is this repo)
const loc = opt("--pewp") ? { kind: "repo", target, root: target, pewp: path.resolve(opt("--pewp")) } : locate(target);
const pewp = loc.pewp;
const stageDir = path.resolve(opt("--stage-scripts") || here());
function here() { return path.dirname(fileURLToPath(import.meta.url)); }
const go = A.includes("--go");
const brief = opt("--brief") ? path.resolve(opt("--brief")) : null;
const siteDir = path.resolve(opt("--site") || path.join(target, "site"));
const forceStage = opt("--force");
const stageTimeoutMs = Number(opt("--stage-timeout-min", 60)) * 60_000;
if (!(stageTimeoutMs > 0)) { console.error(`usage: --stage-timeout-min needs a number of minutes > 0 (got "${opt("--stage-timeout-min")}")`); process.exit(2); } // NaN would make every spawnSync throw
if (brief && !fs.existsSync(brief)) { console.error(`usage: --brief ${brief}: file not found`); process.exit(2); } // was silently ignored
// A stage child that was killed (time limit, output too big) has status null: say so, never "exit null".
const killedWhy = (r) => (r.error ? (r.error.code === "ETIMEDOUT" ? `killed: did not finish in ${stageTimeoutMs / 60_000} min (--stage-timeout-min)` : `could not run or was killed (${r.error.code || r.error.message})`) : r.status === null ? `killed by signal ${r.signal}` : null);
const P = (...x) => path.join(pewp, ...x);

let st = load(loc) || init(loc, "build");
if (st.mode !== "build") { st.mode = "build"; st.stages = st.stages || {}; }
st.build = st.build || {};
if (brief && fs.existsSync(brief)) fs.copyFileSync(brief, path.join(pewp, "brief.txt")); // for the record; the main session turns it into intake answers
const setBuild = (status, stage, message = "") => { st = load(loc) || st; st.build = st.build || {}; st.build = { ...st.build, status, stage, message, updatedAt: new Date().toISOString() }; save(loc, st); };

// stage table: name, script (null = internal), outputs, inputs (staleness is checked against these)
const STAGES = [
  { name: "intake", script: "intake.mjs", outputs: ["business.json"], inputs: [], what: "business.json: who, what, where, goals, constraints (asks the owner only what it cannot find)" },
  { name: "research", script: "research.mjs", outputs: ["targets.json"], inputs: ["business.json"], what: "targets.json + research/report.md from free sources (cached under .pewp/cache)" },
  { name: "plan", script: "plan-site.mjs", outputs: ["plan/sitemap.json"], inputs: ["business.json", "targets.json"], what: "plan/sitemap.json + plan/briefs/<page>.md" },
  { name: "handoff", script: null, outputs: ["builder/HANDOFF.md", "builder/builder-prompt.md"], inputs: ["plan/sitemap.json", "business.json"], what: "the builder session's spec" },
  { name: "builder", script: null, outputs: [], inputs: [], what: "a builder session builds the site from the briefs (not run by this script)" },
  { name: "gate", script: "gate.mjs", outputs: [], inputs: ["plan/sitemap.json", "targets.json"], what: "deterministic checks of the built site against targets.json and plan/" },
  { name: "measure", script: "measure.mjs", outputs: [], inputs: [], what: "post-launch measurement (Search Console, rankings, AI citations)" },
];
const mtime = (rel) => { try { return fs.statSync(P(rel)).mtimeMs; } catch { return 0; } };
const stageInputs = (s) => s.inputs.flatMap((i) => (i === "plan/sitemap.json" ? [i, ...briefFiles().map((b) => `plan/briefs/${b}`)] : [i]));
const stale = (s) => {
  const done = st.stages?.[s.name]?.doneAt;
  return !!done && stageInputs(s).some((i) => mtime(i) > Date.parse(done));
};
const outputsMissing = (s) => s.outputs.some((o) => !fs.existsSync(P(o)));
function briefFiles() { try { return fs.readdirSync(P("plan", "briefs")).filter((f) => f.endsWith(".md")).sort(); } catch { return []; } }
const statusOf = (s) => (!st.stages?.[s.name] ? "pending" : outputsMissing(s) ? "pending (outputs missing)" : stale(s) ? "stale (an input changed after it ran)" : "done");

if (A.includes("--builder-done")) { st.build.builderDoneAt = new Date().toISOString(); st.build.site = siteDir; save(loc, st); }
const builderDone = () => !!st.build?.builderDoneAt && Date.parse(st.build.builderDoneAt) >= Date.parse(st.stages?.handoff?.doneAt || 0);

// ---------- the plan (always printed; --go runs it) ----------
const planLines = [`PLAN build ${rel(target)}  (state: ${rel(P("state.json"))})`];
for (const s of STAGES) {
  const script = s.script ? (fs.existsSync(path.join(stageDir, s.script)) ? `scripts/${s.script}` : `scripts/${s.script} (NOT BUILT yet: the run will stop BLOCKED here)`) : s.name === "builder" ? "a separate builder session" : "this script";
  planLines.push(`  ${s.name.padEnd(8)} ${s.name === "builder" ? (builderDone() ? "done" : "waits for you") : statusOf(s).padEnd(10)} ${script}: ${s.what}`);
}
planLines.push("  cost: free sources only, no paid API; stages write files (resumable); the model cost is the builder session. Research may take many minutes of fetching at polite rates.");
console.log(planLines.join("\n"));
if (!go) {
  if (!A.includes("--builder-done")) { console.log("Plan only. Show it to the owner, then run again with --go."); process.exit(0); }
}

// ---------- run ----------
function rel(p) { return p.replace(/\\/g, "/"); }
// Intake's open questions are in intake-facts.json (AskUserQuestion shape: header, question, options[{label, description, value}],
// recommended index, multiSelect). Any other stage that exits 3 gives a message, not a question list.
function questionText(stage, res) {
  let qs = [];
  if (stage === "intake") { try { qs = JSON.parse(fs.readFileSync(P("intake-facts.json"), "utf8")).questions || []; } catch {} }
  if (!qs.length) {
    return [`NEEDS-INPUT stage=${stage}: the stage cannot go on without something from the owner or the operator. Its message:`, ...(res.out || "(no message)").split("\n").slice(-12).map((l) => `  ${l}`),
      `The main session turns this into pickable options (recommended first), supplies the answer (for research: --research-args "<args>" or --yes via --research-args), and runs the same command again.`].join("\n");
  }
  const lines = [`NEEDS-INPUT stage=${stage}: ${qs.length} question(s). Ask ALL of them in one batch as pickable options (the first option is the recommended one), then write the chosen values to ${rel(P("intake-answers.json"))} as {"<field>": <value>} (a typed "Other" answer is the value; multi-select = an array) and run the same command again.`];
  qs.forEach((q, i) => {
    lines.push(`${i + 1}. [${q.id}] (${q.field}) ${q.question}`);
    (q.options || []).forEach((o, j) => lines.push(`   - ${typeof o === "string" ? o : o.label}${o.description ? ` (${o.description})` : ""}${j === (q.recommended ?? 0) ? " [recommended]" : ""}`));
  });
  lines.push(`QUESTIONS-JSON ${rel(P("intake-facts.json"))}`);
  return lines.join("\n");
}
// "--service \"we buy houses\" --query 'sell my house'" -> 4 args: double and single quotes group words (a plain whitespace split cut every
// multi-word service into separate args). No shell is involved: the args go to spawnSync as an array.
const splitArgs = (s) => { const out = []; for (const m of String(s || "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]); return out; };
function runStage(s) {
  const script = path.join(stageDir, s.script);
  if (!fs.existsSync(script)) return { code: 4, blocked: `scripts/${s.script} is not built yet. Unblocks: the stage owner delivers it (see PHASES.md).` };
  const args = [script, s.name === "plan" ? pewp : target];
  if (s.name === "research") args.push(...splitArgs(opt("--research-args")));
  if (s.name === "plan") args.push(...splitArgs(opt("--plan-args")));
  const r = spawnSync(process.execPath, args, { cwd: target, encoding: "utf8", timeout: stageTimeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const killed = killedWhy(r);
  const out = [((r.stdout || "") + (r.stderr || "")).trim(), killed ? `${s.script} ${killed}` : ""].filter(Boolean).join("\n");
  return { code: killed ? 1 : r.status ?? 1, out, blocked: out.split("\n").filter(Boolean).pop() || "" };
}
function writeHandoff() {
  const biz = (() => { try { return JSON.parse(fs.readFileSync(P("business.json"), "utf8")); } catch { return {}; } })();
  const sm = (() => { try { return JSON.parse(fs.readFileSync(P("plan", "sitemap.json"), "utf8")); } catch { return {}; } })();
  const pages = Array.isArray(sm) ? sm : sm.pages || sm.nodes || [];
  const pageLines = pages.map((p) => `| ${p.path || p.slug || p.url || "?"} | ${p.primaryQuery || p.query || "(support page)"} | ${p.title || "?"} | ${p.h1 || "?"} | ${[].concat(p.schema || p.schemaType || []).join(", ") || "?"} | ${p.brief || p.briefFile || "?"} |`);
  const briefs = briefFiles().map((f) => {
    const first = fs.readFileSync(P("plan", "briefs", f), "utf8").split(/\r?\n/).find((l) => l.trim()) || "";
    return `- plan/briefs/${f}: ${first.replace(/^#+\s*/, "")}`;
  });
  const industry = biz.industry && fs.existsSync(path.join(skill, "rules", "industries", `${biz.industry}.json`)) ? `\`${rel(path.join(skill, "rules", "industries", `${biz.industry}.json`))}\`` : biz.industry ? `${biz.industry} (no rules file yet: ask the Lead for regulated-industry claim rules before writing claims)` : "none selected";
  // The builder runs the gate with its own output folder, so it never writes outside site/ and .pewp/builder/.
  const gateCmd = `node "${rel(path.join(skill, "scripts", "gate.mjs"))}" "${rel(pewp)}" "${rel(siteDir)}" --out "${rel(path.join(pewp, "builder", "gate"))}"`;
  const doneCmd = `node "${rel(path.join(skill, "scripts", "build-site.mjs"))}" "${rel(target)}" --go --builder-done --site "${rel(siteDir)}"`;
  const md = [
    `# Builder handoff: ${biz.name || "(unnamed business)"}`,
    "",
    `You are the builder. This file and the files it names are your whole spec. Build the site into \`${rel(siteDir)}\` and nowhere else. Generated: ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "## The business (from .pewp/business.json)",
    `- Name / domain: ${biz.name || "?"} / ${biz.domain || "?"}`,
    `- Offer: ${biz.offer || "?"}; audience: ${biz.audience || "?"}`,
    `- Market: ${biz.market ? `${biz.market.country}, ${biz.market.language}` : "?"}; goals: ${(biz.goals || []).join(", ") || "?"}`,
    `- Launch state: ${biz.launchState || "?"}${biz.launchState && biz.launchState !== "live" ? " (a preview or planned site is NOT indexable by design: every page carries noindex until the owner launches it)" : ""}`,
    `- Brand constraints: ${(biz.brand?.constraints || []).join("; ") || "none recorded"}`,
    `- Industry rules file: ${industry}`,
    "",
    "## Pages to build (one cluster = one page; do not add, merge or drop pages)",
    "",
    "| page path | primary query | title | H1 | schema type(s) | brief |",
    "|---|---|---|---|---|---|",
    ...(pageLines.length ? pageLines : ["| (sitemap.json lists no pages: stop and report) | | | | | |"]),
    "",
    "## Briefs (read each completely before building its page)",
    ...(briefs.length ? briefs : ["- (no briefs found: stop and report)"]),
    "",
    "## Rules",
    "- Each page: the title, H1, meta description, outline, entities, questions, schema type, internal links (with their anchors) and CTA from its brief. The gate checks the output of exactly these.",
    "- Never invent facts: no statistics, reviews, testimonials, licence numbers, prices or addresses that are not in business.json or the briefs. A missing fact is written down in `builder/QUESTIONS.md` and the page uses an obvious placeholder the gate will flag.",
    "- No forms that post to a real endpoint, no tracking IDs, no deploy, no push. This is a front-end build for review.",
    "- Every page reachable from the home page in a few clicks, no orphan pages, no two pages for one query.",
    `- If the site is generated, write its build command (one line, run from \`${rel(siteDir)}\`) into \`${rel(P("builder", "build-command.txt"))}\`: the gate builds twice and fails any date that moves (GT-013). Dates in the output (sitemap lastmod, JSON-LD dateModified/datePublished, article:modified_time) are content dates: a committed ledger seeded from each source's change time, or a post's own date; never the clock at build time. Sitemap lastmod is YYYY-MM-DDThh:mm:ssZ (seconds and timezone).`,
    "",
    "## Definition of done",
    `1. The gate passes: \`${gateCmd}\` prints PASS (it checks one page per cluster, query in title/H1/first paragraph, brief sections on the page, planned links and anchors, schema type, no orphans).`,
    `2. Then tell the main session, which runs: \`${doneCmd}\``,
    "3. Report in one message: pages built, gate output pasted, anything you could not do and why.",
    "",
  ].join("\n");
  fs.mkdirSync(P("builder"), { recursive: true });
  fs.writeFileSync(P("builder", "HANDOFF.md"), md);
  fs.writeFileSync(P("builder", "builder-prompt.md"), `Read ${rel(P("builder", "HANDOFF.md"))} completely, then every brief it lists under ${rel(P("plan", "briefs"))}. Build the site into ${rel(siteDir)} exactly as specified, run the gate command from the handoff until it prints PASS, and report. Do not touch anything outside ${rel(siteDir)} and ${rel(P("builder"))}.\n`);
}

const order = STAGES.filter((s) => s.name !== "measure");
for (const s of order) {
  if (s.name === "builder") {
    if (!builderDone()) {
      setBuild("waiting-for-builder", "builder", "briefs handed off");
      console.log(`WAITING-FOR-BUILDER: start a builder session with the prompt in ${rel(P("builder", "builder-prompt.md"))} (spec: ${rel(P("builder", "HANDOFF.md"))}); when it reports the gate passes, run: node build-site.mjs "${rel(target)}" --go --builder-done --site "${rel(siteDir)}"`);
      process.exit(0);
    }
    continue;
  }
  if (s.name === "gate") {
    const needGate = A.includes("--builder-done") || forceStage === "gate" || statusOf(s) !== "done" || stale(s);
    if (!needGate) { console.log("gate: PASS (already done, inputs unchanged)"); continue; }
    const gs = path.join(stageDir, "gate.mjs");
    if (!fs.existsSync(gs)) { setBuild("blocked", "gate", "gate.mjs not built"); console.log(`BLOCKED stage=gate: scripts/gate.mjs is not built yet. Unblocks: the stage owner delivers it.`); process.exit(4); }
    const siteBuild = opt("--site-build") || (() => { try { return fs.readFileSync(P("builder", "build-command.txt"), "utf8").split(/\r?\n/)[0].trim() || null; } catch { return null; } })();
    const buildArgs = siteBuild ? ["--build", siteBuild, "--build-cwd", path.resolve(opt("--site-build-cwd") || siteDir)] : [];
    const g = spawnSync(process.execPath, [gs, pewp, siteDir, ...(A.includes("--strict") ? ["--strict"] : []), ...buildArgs], { cwd: target, encoding: "utf8", timeout: stageTimeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const gKilled = killedWhy(g);
    const gout = [((g.stdout || "") + (g.stderr || "")).trim(), gKilled ? `gate.mjs ${gKilled}` : ""].filter(Boolean).join("\n");
    const gfile = P("gate", `${new Date().toISOString().slice(0, 10)}.txt`);
    fs.mkdirSync(path.dirname(gfile), { recursive: true });
    fs.writeFileSync(gfile, `exit ${gKilled ? `none (${gKilled})` : g.status}\n${gout}\n`);
    if (gKilled) g.status = 1; // a killed gate is a failed gate (its status null used to print "exit null")
    if (g.status !== 0) {
      setBuild("gate-failed", "gate", gKilled ? `gate.mjs ${gKilled}` : gout.split("\n")[0] || "");
      console.log(`GATE-FAILED (${gKilled ? `gate.mjs ${gKilled}` : `exit ${g.status}: 1 = a check failed, 2 = a check could not judge`}); output saved to ${rel(gfile)}:\n${gout.split("\n").slice(0, 20).join("\n")}\nFix the site (or the plan if the gate is right about the plan), then run again with --builder-done.`);
      process.exit(1);
    }
    st = markStage(loc, "gate", { result: rel(path.relative(target, gfile)) });
    console.log(`gate: PASS (${rel(gfile)})`);
    continue;
  }
  const status = statusOf(s);
  const needs = forceStage === s.name || status !== "done";
  if (!needs) { console.log(`${s.name}: done`); continue; }
  if (status.startsWith("stale")) console.log(`${s.name}: stale, an input changed after it ran: re-running`);
  if (s.name === "handoff") {
    writeHandoff();
    st = markStage(loc, "handoff", { handoff: "builder/HANDOFF.md", prompt: "builder/builder-prompt.md" });
    console.log(`handoff: wrote ${rel(P("builder", "HANDOFF.md"))}`);
    continue;
  }
  console.log(`${s.name}: running scripts/${s.script}`);
  const res = runStage(s);
  if (res.code === 3) {
    setBuild("needs-input", s.name, s.name === "intake" ? `questions in ${rel(P("intake-facts.json"))}` : (res.blocked || "").slice(0, 200));
    console.log(questionText(s.name, res));
    process.exit(3);
  }
  if (res.code === 4) {
    setBuild("blocked", s.name, res.blocked);
    console.log(`BLOCKED stage=${s.name}: ${res.blocked}`);
    process.exit(4);
  }
  if (res.code !== 0 || outputsMissing(s)) {
    setBuild("failed", s.name, res.out?.slice(-200) || "");
    console.log(`FAILED stage=${s.name} (exit ${res.code}${res.code === 0 ? "; the expected outputs were not written: " + s.outputs.filter((o) => !fs.existsSync(P(o))).join(", ") : ""}):\n${(res.out || "").split("\n").slice(-15).join("\n")}`);
    process.exit(1);
  }
  st = markStage(loc, s.name, Object.fromEntries(s.outputs.map((o) => [path.basename(o), o])));
  console.log(`${s.name}: done`);
}

// ---------- measure ----------
// measure.mjs works on a LIVE url; a site that is only built has nothing to measure yet.
const liveUrl = opt("--live-url");
const ms = path.join(stageDir, "measure.mjs");
if (liveUrl && fs.existsSync(ms)) {
  const m = spawnSync(process.execPath, [ms, liveUrl], { cwd: target, encoding: "utf8", timeout: stageTimeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const mKilled = killedWhy(m);
  setBuild(!mKilled && m.status === 0 ? "measured" : "measure-failed", "measure", mKilled ? `measure.mjs ${mKilled}` : (m.stdout || "").trim().split("\n").pop() || "");
  console.log(`measure: ${mKilled ? `measure.mjs ${mKilled}` : `exit ${m.status}`}\n${(m.stdout || "").trim().split("\n").slice(-10).join("\n")}`);
  process.exit(m.status === 0 ? 0 : 1);
}
setBuild("built-awaiting-measure", "measure", "waits for launch");
console.log(`measure: BLOCKED. Measuring needs the LIVE site and the owner's Search Console access (free, OAuth; Bing Webmaster key optional). After launch run: node "${rel(path.join(skill, "scripts", "measure.mjs"))}" <live url> --init --property sc-domain:<domain>, then the same command without --init, or re-run this driver with --live-url <url>. The site is built and gated; this is the correct state before launch.`);
console.log("STATUS: BUILT-AWAITING-MEASURE");
process.exit(0);
