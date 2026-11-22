// Usage: node judge.mjs <url or profile:slug> [--cwd DIR] [--model sonnet] [--effort high] [--timeout-min 15]
// The judge (AB-6, parts AU.S-4 and AU.D-47): ONE headless model reads the client's profile and writes the report's analysis as JSON in the fixed shape of analysis-shape.mjs;
// the shape is checked, then analysis-check.mjs checks every number and name.
//   {pewp}/analysis.json            the model's answer (the shape of analysis-shape.mjs)
//   {pewp}/analysis.checked.json    what the real analysis-check.mjs made of it (every pointer replaced by its value)
//   {pewp}/analysis.sheet.json      where each value came from (written by the check)
//   {pewp}/judge/run.json           model, effort, times, attempts, outcome and one row per ask (seconds, exit code, sizes, usage, cost). Never the prompt's or the answer's text.
//   {pewp}/judge/refused.txt        only after two refusals: the refusal lines of both answers
// The prompt is judge-brief.md with {{PEWP}}, {{FILES}} (the .json files of the GATHERED steps of {pewp}/profile.json, never a file of a not gathered step), {{TOPICS}} (the gathered
// stations that are topics, with what each holds), {{FIXES}} (client-copy/fixes.json, as "id: fix") and {{MINMAX}} (the section count bounds) filled.
// The floor: fewer gathered stations among TOPICS than MIN_SECTIONS: exit 4 "SKIPPED: ..." with NO model call; nothing is written but {pewp}/judge/run.json (outcome "skipped").
// The model may only read: tools Read, Grep, Glob; its folder and its one added folder are {pewp}; no permission mode that accepts edits. The answer is taken from the CLI's
// JSON ("result"), never from a file the model wrote.
// An answer the judge refuses itself (not JSON, not an object, or any line of checkShape) or the check refuses (exit 1) gets ONE more ask: the same
// prompt plus its last answer and the refusal lines (at most 40), with the order to change only what was refused. A second refusal: exit 3 BLOCKED, refused.txt written, no checked file. Never a third ask.
// The floor of pages (AB-8c): the sections must fill 2 analysis pages at least half full (checkShape gives one line for it). A second answer refused for that line and nothing else is exit 4
// "SKIPPED: too little for a client's report: ...": the answer stays in analysis.json, no checked file, no refused.txt, run.json outcome "skipped". The floor line alone as the FIRST refusal and any
// refusal of the second answer is also exit 4 SKIPPED (the line says the first analysis filled n pages and the second was refused), refused.txt holding both asks. Any other second refusal is BLOCKED as above. A model that cannot start, ends with a
// non-zero code, runs past the limit or prints what is not the CLI's JSON: exit 3 BLOCKED, no retry.
// Exit 0: last line "JUDGE OK: the analysis was written and checked (<n> values, <a> ask(s))". Exit 2: usage. Exit 3: "BLOCKED: <what> | unblocks: <what>". Exit 4: SKIPPED (the floor).
// Every outside thing (the model, the brief, the clock, the output) comes in through one io object, so test-judge.mjs starts no model. The check runs for real, as a child process.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { supervised, whichExe } from "./lib-freshness.mjs";
import { locate } from "./state.mjs";
import { TOPICS, MIN_SECTIONS, MAX_SECTIONS, MIN_PAGES, checkShape, fullPages, isFloorLine } from "./analysis-shape.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, "..");
export const TOOLS = ["Read", "Grep", "Glob"];
const MAX_ASKS = 2;
const MAX_REFUSAL_LINES = 40;
const MAX_ANSWER_CHARS = 20000; // the last answer goes back to the model with its refusal (the first real run rewrote everything and made new faults)
const OUTPUTS = ["analysis.checked.json", "analysis.sheet.json"];
const USAGE = "usage: node judge.mjs <url or profile:slug> [--cwd DIR] [--model sonnet] [--effort high] [--timeout-min 15]";
const floorOnly = (lines) => lines.length === 1 && isFloorLine(lines[0]);
const norm = (p) => String(p).replace(/\\/g, "/");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The judge's own look at an answer text (the shape is checked by the caller): { object } or { lines }. */
function ownLook(answer) {
  let t = String(answer).trim();
  const fence = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();
  let ans;
  try { ans = JSON.parse(t); } catch { return { lines: ["the answer is not JSON (it must be the JSON object and nothing else)"] }; }
  if (!isObj(ans)) return { lines: ["the answer is not a JSON object"] };
  return { object: ans };
}

/** The gathered stations of the profile: [{ id, what }] (a station with at least one step in bucket gathered). */
function stationsGathered(profile) {
  return (Array.isArray(profile?.stations) ? profile.stations : []).filter((st) => (Array.isArray(st?.steps) ? st.steps : []).some((sp) => sp.bucket === "gathered")).map((st) => ({ id: String(st.id), what: String(st.what || "") }));
}

/** The .json files (jsonFiles: every one under the outputs, not the 5 of files) of the gathered steps of the profile, relative to pewp: "- <file> (step <id>)". */
function filesOf(profile) {
  const seen = new Set(), out = [];
  for (const st of Array.isArray(profile?.stations) ? profile.stations : []) for (const sp of Array.isArray(st?.steps) ? st.steps : []) {
    if (sp.bucket === "gathered") for (const f of Array.isArray(sp.jsonFiles) ? sp.jsonFiles : []) if (typeof f === "string" && /\.json$/i.test(f) && !seen.has(f)) { seen.add(f); out.push("- " + f + " (step " + sp.id + ")"); }
  }
  return out;
}

const fill = (brief, pewp, files, topics, fixes) => brief.split("{{PEWP}}").join(norm(pewp)).split("{{FILES}}").join(files.length ? files.join("\n") : "(none: no gathered step left a .json file)")
  .split("{{TOPICS}}").join(topics.map((s) => "- " + s.id + ": " + s.what).join("\n")).split("{{FIXES}}").join(fixes.map((f) => "- " + f.id + ": " + f.fix).join("\n"))
  .split("{{MINMAX}}").join(MIN_SECTIONS + " to " + MAX_SECTIONS);

export async function judge(io, argv) {
  const out = (l) => io.log(l);
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const key = argv[0];
  const usage = (why) => { out((why ? why + "\n" : "") + USAGE); return 2; };
  if (!key || key.startsWith("--")) return usage("no run was named");
  const cwd = path.resolve(opt("--cwd", process.cwd()));
  const model = opt("--model", "sonnet"), effort = opt("--effort", "high"), minutes = Number(opt("--timeout-min", 15));
  if (!model || String(model).startsWith("--") || !effort || String(effort).startsWith("--") || !(minutes > 0)) return usage("an option has no usable value");
  let loc; try { loc = locate(key, { cwd }); } catch (e) { return usage(e.message); }
  const pewp = loc.pewp, profileFile = path.join(pewp, "profile.json");
  const blocked = (what, unblocks) => { out("BLOCKED: " + what + " | unblocks: " + unblocks); return 3; };
  let profile = null; try { profile = JSON.parse(fs.readFileSync(profileFile, "utf8").replace(/^﻿/, "")); } catch { /* none */ }
  if (!isObj(profile)) return blocked("there is no profile (" + norm(profileFile) + ")", "run client-profile first");

  const clearOutputs = () => { for (const f of OUTPUTS) fs.rmSync(path.join(pewp, f), { force: true }); };
  const startedAt = new Date(io.now()).toISOString();
  const topicStations = stationsGathered(profile).filter((s) => TOPICS.includes(s.id));
  const gatheredStations = topicStations.map((s) => s.id);
  if (topicStations.length < MIN_SECTIONS) {   // the floor: too little gathered for a client report; no model is asked and nothing is written but run.json
    fs.mkdirSync(path.join(pewp, "judge"), { recursive: true });
    fs.writeFileSync(path.join(pewp, "judge", "run.json"), JSON.stringify({ model, effort, startedAt, endedAt: new Date(io.now()).toISOString(), attempts: 0, outcome: "skipped", values: null, asks: [] }, null, 1) + "\n");
    out("SKIPPED: too little was gathered for a client report (" + topicStations.length + " of the " + TOPICS.length + " kinds of source); the run stays an internal draft");
    return 4;
  }
  const older = (Array.isArray(profile.stations) ? profile.stations : []).some((st) => (Array.isArray(st?.steps) ? st.steps : []).some((sp) => sp.bucket === "gathered" && !Array.isArray(sp.jsonFiles)));
  if (older) return blocked("the profile is older than the judge (it names no jsonFiles)", "run client-profile again");
  clearOutputs();
  const fixIds = io.fixes().map((f) => f.id);
  const prompt = fill(io.brief(), pewp, filesOf(profile), topicStations, io.fixes());
  const opts = { model, effort, tools: TOOLS, cwd: pewp, addDirs: [pewp], timeoutMs: Math.round(minutes * 60_000) };
  const asks = [], refusals = [];
  let outcome = "failed", values = null, lastAnswer = "", code = 3, last = null, lastObject = null, firstObject = null;
  const finish = () => {
    const record = { model, effort, startedAt, endedAt: new Date(io.now()).toISOString(), attempts: asks.length, outcome, values, asks };
    fs.mkdirSync(path.join(pewp, "judge"), { recursive: true });
    fs.writeFileSync(path.join(pewp, "judge", "run.json"), JSON.stringify(record, null, 1) + "\n");
  };
  const failed = (reason) => { outcome = "failed"; finish(); return blocked("the model did not answer (" + reason + ")", 'run it again; if it repeats, run "claude --version" in a terminal'); };

  for (let ask = 1; ask <= MAX_ASKS; ask++) {
    const text = ask === 1 ? prompt : prompt + "\n\nYour last answer:\n" + lastAnswer.slice(0, MAX_ANSWER_CHARS) + "\n\nYour answer was refused:\n" + refusals[ask - 2].slice(0, MAX_REFUSAL_LINES).join("\n") + "\nGive the whole answer again and change only what these lines refuse.\n";
    const t0 = io.now();
    let r = null, thrown = null;
    try { r = await io.model(text, opts); } catch (e) { thrown = e; }
    const row = { seconds: Math.round((io.now() - t0) / 1000), exitCode: r && typeof r.code === "number" ? r.code : null, promptChars: text.length, answerChars: 0, usage: null, costUsd: null };
    asks.push(row);
    if (thrown) return failed("it could not be run: " + String(thrown.message || thrown).slice(0, 160));
    if (r.timedOut) return failed("it ran past " + minutes + " minutes");
    if (r.code !== 0) return failed("it ended with code " + r.code);
    let cli = null; try { cli = JSON.parse(r.stdout); } catch { /* not JSON */ }
    if (!isObj(cli)) return failed("it printed what is not the CLI's JSON");
    row.usage = cli.usage ?? null; row.costUsd = typeof cli.total_cost_usd === "number" ? cli.total_cost_usd : null;
    if (cli.is_error === true) return failed("the CLI reported an error");
    if (typeof cli.result !== "string") return failed("the CLI's JSON has no result text");
    lastAnswer = cli.result; row.answerChars = lastAnswer.length;

    let lines = [];
    const look = ownLook(lastAnswer);
    lastObject = look.object || null;
    if (ask === 1) firstObject = lastObject;
    if (look.lines) lines = look.lines;
    else if ((lines = checkShape(look.object, { gatheredStations, fixIds })).length) { /* the shape is refused: the lines are the refusal */ }
    else {
      fs.writeFileSync(path.join(pewp, "analysis.json"), JSON.stringify(look.object, null, 1) + "\n");
      const c = spawnSync(process.execPath, [path.join(here, "analysis-check.mjs"), key, "--cwd", cwd], { encoding: "utf8", timeout: 120_000, windowsHide: true });
      const cl = ((c.stdout || "") + (c.stderr || "")).split(/\r?\n/).filter((l) => l.trim() !== "");
      if (c.status === 0) { outcome = "checked"; values = Number((/^ANALYSIS OK: (\d+) values/.exec(cl[cl.length - 1] || "") || [])[1]); if (!Number.isFinite(values)) values = null; code = 0; last = cl[cl.length - 1]; break; }
      if (c.status !== 1) { clearOutputs(); return failed("the check could not run, it ended with code " + c.status); }
      lines = cl;
    }
    refusals.push(lines);
  }

  // the second answer is refused for the floor of pages and for nothing else: not a fault of the answer but too little in the files: the answer stays, the run stays an internal draft
  if (code !== 0 && refusals.length === MAX_ASKS && floorOnly(refusals[MAX_ASKS - 1]) && lastObject) {
    clearOutputs(); outcome = "skipped"; finish();
    fs.writeFileSync(path.join(pewp, "analysis.json"), JSON.stringify(lastObject, null, 1) + "\n");
    out("SKIPPED: too little for a client's report: the analysis fills " + fullPages(lastObject.sections) + " analysis page(s) at least half full (it needs " + MIN_PAGES + "); the run stays an internal draft");
    return 4;
  }
  // the floor came first (the first answer's only refusal) and the second answer was refused for any reason: the cause is the floor's, not the second answer's faults; both asks go to refused.txt
  if (code !== 0 && refusals.length === MAX_ASKS && floorOnly(refusals[0]) && firstObject) {
    clearOutputs(); outcome = "skipped"; finish();
    fs.writeFileSync(path.join(pewp, "judge", "refused.txt"), refusals.map((l, i) => "ask " + (i + 1) + ":\n" + l.join("\n")).join("\n\n") + "\n");
    out("SKIPPED: too little for a client's report: the first analysis filled " + fullPages(firstObject.sections) + " analysis page(s) at least half full (it needs " + MIN_PAGES + ") and the second was refused; the run stays an internal draft");
    return 4;
  }
  if (code !== 0) {
    clearOutputs(); outcome = "refused"; finish();
    fs.writeFileSync(path.join(pewp, "judge", "refused.txt"), refusals.map((l, i) => "ask " + (i + 1) + ":\n" + l.join("\n")).join("\n\n") + "\n");
    return blocked("the model's analysis was refused twice (" + refusals[0][0] + ")", "read " + norm(path.join(pewp, "judge", "refused.txt")) + ", then correct judge-brief.md or write " + norm(path.join(pewp, "analysis.json")) + " by hand and run analysis-check.mjs");
  }
  finish();
  out("JUDGE OK: the analysis was written and checked (" + values + " values, " + asks.length + (asks.length === 1 ? " ask)" : " asks)"));
  return 0;
}

// ---------- the real outside world ----------
function killTree(child, isSupervised) {
  try {
    if (process.platform === "win32" && !isSupervised) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 10_000 });
    else child.kill("SIGKILL");
  } catch { /* gone */ }
}
export function realIo() {
  return {
    log: (l) => console.log(l),
    now: () => Date.now(),
    brief: () => fs.readFileSync(path.join(skillDir, "judge-brief.md"), "utf8"),
    fixes: () => JSON.parse(fs.readFileSync(path.join(skillDir, "client-copy", "fixes.json"), "utf8")),
    // one headless model: the prompt on STDIN, the CLI's JSON on STDOUT; -> { code, stdout, stderr, timedOut }
    model: (prompt, o) => new Promise((resolve) => {
      const args = ["-p", "--model", o.model, "--effort", o.effort, "--output-format", "json", "--no-session-persistence", "--tools", o.tools.join(","), "--allowedTools", o.tools.join(","), "--strict-mcp-config", "--add-dir", ...o.addDirs];
      const sup = supervised(whichExe("claude") || "claude", args, { cwd: o.cwd, env: { ...process.env, CLAUDE_SYNC_SKIP: "1", CLAUDE_LEARN_SKIP: "1" }, timeoutMs: o.timeoutMs + 30_000 });
      const child = spawn(sup.command, sup.args, { cwd: o.cwd, env: sup.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let so = "", se = "", timedOut = false, done = false;
      const end = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout: so, stderr: se.slice(-2000), timedOut }); };
      child.stdout.on("data", (d) => (so += d));
      child.stderr.on("data", (d) => (se += d));
      child.on("error", (e) => { se += "could not start the model: " + e.message + "\n"; end(null); });
      child.stdin.on("error", () => {});
      const timer = setTimeout(() => { timedOut = true; killTree(child, sup.supervised); }, o.timeoutMs);
      child.on("close", (code) => end(code));
      child.stdin.end(prompt);
    }),
  };
}

if (isMain(import.meta.url)) {
  if (process.argv.includes("--help")) { console.log(USAGE); process.exit(0); }
  process.exit(await judge(realIo(), process.argv.slice(2)));
}
