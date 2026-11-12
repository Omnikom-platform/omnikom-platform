// Usage: node test-pipeline.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of pipeline.json (skill root), the one step list of a full client audit, read by `start.mjs audit-live` and by `omnikom seo run`:
//   V  the validity rules (lib-pipeline.mjs): the real manifest is valid; one broken copy per rule is refused for the named reason
//   O  the run order: every step after the steps it depends on, file order kept where nothing forces a move, a cycle refused
//   E  placeholders and evidence (exists, not empty, written after the step started; a pattern is satisfied by its newest match)
//   S  SAMENESS: `start.mjs audit-live` (the real start.mjs, plan mode) records exactly the manifest's ids, order and dependsOn
//   U  every script step's args are accepted by its script: per step it says whether that was RUN against a fixture pewp (no network:
//      netguard-import.mjs refuses every non-local request) or only CHECKED against the script's usage text (a flag must be in the usage
//      lines; a flag the script reads but its usage text omits is reported as "source only")
// No network, no browser. Mutants (watched-fail, same pattern as test-psi.mjs): break the code each assertion guards in a copy of the scripts
// folder, expect the named assertions red. Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const skillDir = path.resolve(here, "..");
const PIPE = path.join(skillDir, "pipeline.json");
const URL1 = "https://fixture.test/";

// steps that are safe to RUN here: with no key and no network they stop early (BLOCKED, exit 3) or finish (exit 0); what is proven is that
// the script ACCEPTS the manifest's command line (exit 2 = usage = the args do not fit). Everything else is checked against the usage text.
const RUN_STEPS = ["psi", "demand-bing", "search-console", "research-plan", "seeds", "autocomplete-import", "targets-validate", "local-grid-plan", "local-grid-import", "local", "authority-classify", "report-live", "crux", "index-import", "trends-import", "ai-import", "reputation-import", "social-import", "ads-import", "authority-anchors"];

function usageText(file) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const head = lines.slice(0, 60).filter((l) => /^\s*\/\//.test(l));
  const mention = lines.filter((l) => /usage|node [\w-]+\.mjs/i.test(l));
  return { text: [...head, ...mention].join("\n"), src };
}
const flagRe = (f) => new RegExp(`(^|[^\\w-])${f.replace(/[-]/g, "\\-")}($|[^\\w-])`);

async function scenarios(sdir) {
  const results = [];
  const check = (name, ok, detail = "", note = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900), note });
  const lib = await import(pathToFileURL(path.join(sdir, "lib-pipeline.mjs")).href + "?" + Math.random());
  const manifest = JSON.parse(fs.readFileSync(PIPE, "utf8"));
  const clone = () => structuredClone(manifest);
  const val = (m) => lib.validateManifest(m, { skillDir }).problems.map(lib.describe);
  const step = (m, id) => m.steps.find((s) => s.id === id);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pipeline-"));
  try {
    // ---------------- V: the validity rules ----------------
    const real = val(manifest);
    check("V: the real pipeline.json is valid (the rules below are red only for their own broken copy)", real.length === 0, real.join(" | "));
    const RULES = [
      ["an unknown top-level key", (m) => { m.extra = 1; }, /unknown top-level key "extra"/],
      ["a version other than 1", (m) => { m.version = 2; }, /version must be 1/],
      ["an empty step list", (m) => { m.steps = []; }, /steps must be a non-empty list/],
      ["a duplicate id", (m) => { m.steps.push(structuredClone(m.steps[0])); }, /duplicate id "doctor"/],
      ["an unknown step key", (m) => { step(m, "psi").surprise = 1; }, /step psi: unknown key "surprise"/],
      ["a missing required key", (m) => { delete step(m, "psi").hits; }, /step psi: missing key\(s\) hits/],
      ["needsBrowser outside none, headless, owner", (m) => { step(m, "psi").needsBrowser = "both"; }, /needsBrowser must be one of/],
      ["a timeout below 0", (m) => { step(m, "psi").timeoutMinutes = -1; }, /timeoutMinutes must be a number of 0 or more/],
      ["a key name that is not in capitals", (m) => { step(m, "psi").needsKeys = ["psi_key"]; }, /needsKeys names a variable in capitals/],
      ["hits that is not none, client or third-party:<name>", (m) => { step(m, "psi").hits = "somewhere"; }, /hits must be none, client or third-party/],
      ["an unknown placeholder in args", (m) => { step(m, "psi").args.push("{nope}"); }, /unknown placeholder \{nope\} in args/],
      ["an unknown placeholder in evidence", (m) => { step(m, "psi").evidence.push("{nope}/x.json"); }, /unknown placeholder \{nope\} in evidence/],
      ["an unknown placeholder in a brief", (m) => { step(m, "checker").brief += " {nope}"; }, /unknown placeholder \{nope\} in brief/],
      ["a dependsOn id that is not a step", (m) => { step(m, "psi").dependsOn.push("ghost"); }, /dependsOn "ghost" is not a step id/],
      ["a step that depends on itself", (m) => { step(m, "psi").dependsOn.push("psi"); }, /depends on itself/],
      ["a cycle", (m) => { step(m, "doctor").dependsOn = ["snapshot"]; }, /^cycle among/],
      ["a script that does not exist", (m) => { step(m, "psi").script = "scripts/no-such-step.mjs"; }, /does not exist in the skill folder/],
      ["script null on a step that is not WAITING", (m) => { step(m, "checker").needsAi = false; }, /script is null, so it must be WAITING/],
      ["a WAITING step without a brief", (m) => { delete step(m, "checker").brief; }, /a WAITING step carries a brief/],
      ["a WAITING step with args", (m) => { step(m, "checker").args = ["x"]; }, /a WAITING step has no args/],
      ["a script step that needs a person", (m) => { step(m, "psi").needsPerson = true; }, /never needs the owner's browser, an agent or a person/],
      ["an engines name that lib-stops does not know", (m) => { step(m, "capture-google").engines = ["nope"]; }, /engines: "nope" is not a known engine/],
      ["engines that is not a list of names", (m) => { step(m, "capture-google").engines = "google"; }, /engines must be a list of engine names/],
      ["an exit override that is not a digit 0 to 4", (m) => { step(m, "psi").exit = { 7: "x" }; }, /exit key "7"/],
      ["evidence that is neither under an output nor an input", (m) => { step(m, "psi").evidence = ["{pewp}/elsewhere.json"]; }, /evidence .*elsewhere\.json is neither under an output nor an input/],
      ["an input written by a step it does not depend on", (m) => { step(m, "doctor").inputs.push("{pewp}/business.json"); }, /input .*business\.json is written by step intake, which it does not depend on/],
    ];
    for (const [name, mutate, re] of RULES) {
      const m = clone(); mutate(m);
      let bad; try { bad = val(m); } catch (e) { bad = [`threw: ${e.message}`]; }
      check(`V: ${name} is refused`, bad.some((b) => re.test(b)), `wanted ${re}; got ${bad.join(" | ") || "no problem at all"}`);
    }

    // ---------------- O: the run order ----------------
    const ordered = lib.runOrder(manifest.steps).ids;
    const pos = new Map(ordered.map((id, i) => [id, i]));
    const late = manifest.steps.filter((s) => s.dependsOn.some((d) => pos.get(d) > pos.get(s.id)));
    check("O: every step comes after every step it depends on, and no step is lost or added", late.length === 0 && ordered.length === manifest.steps.length && new Set(ordered).size === ordered.length && manifest.steps.every((s) => pos.has(s.id)), `${late.map((s) => s.id).join(", ")} ${ordered.length}/${manifest.steps.length}`);
    const ref = []; { const left = [...manifest.steps]; while (left.length) { const i = left.findIndex((s) => s.dependsOn.every((d) => ref.includes(d))); ref.push(left.splice(i, 1)[0].id); } }
    check("O: the order is the documented rule: the first step in file order whose dependencies are all placed goes next", ordered.join() === ref.join(), `${ordered.join(" ")} vs ${ref.join(" ")}`);
    const back = [...manifest.steps].reverse(), backIds = lib.runOrder(back).ids, backPos = new Map(backIds.map((id, i) => [id, i]));
    check("O: a manifest listed backwards (every step before the steps it depends on) is still ordered after its dependencies, with no step lost", back.every((x) => x.dependsOn.every((d) => backPos.get(d) < backPos.get(x.id))) && backIds.length === back.length && new Set(backIds).size === back.length, backIds.slice(0, 6).join(" "));
    const cyc = clone(); step(cyc, "doctor").dependsOn = ["snapshot"];
    const thrown = lib.runOrder(cyc.steps).problems[0]?.detail || "";
    check("O: a cycle cannot be ordered (the error names the steps)", /^cycle among: .*doctor/.test(thrown), thrown);

    // ---------------- E: placeholders and evidence ----------------
    const vars = { url: URL1, client: null, host: "fixture.test", skill: "/s", runDir: "/s/site-checks/fixture.test", pewp: "/s/site-checks/fixture.test/.pewp", work: "/s/site-checks/fixture.test/work" };
    check("E: substitute fills every placeholder (one text or a list)", lib.substitute("{pewp}/a/{host}/{work}", vars) === "/s/site-checks/fixture.test/.pewp/a/fixture.test//s/site-checks/fixture.test/work" && lib.substitute(["{host}", "{url}"], vars).join() === "fixture.test," + URL1, lib.substitute("{pewp}/a/{host}/{work}", vars));
    let e1 = null; try { lib.substitute("{nope}", vars); } catch (e) { e1 = e; }
    let e2 = null; try { lib.substitute("x/{client}", vars); } catch (e) { e2 = e; }
    check("E: an unknown placeholder, and one with no value (the client), are typed errors (PlaceholderError: .placeholder, .reason) that say so, never an empty string", e1 instanceof lib.PlaceholderError && e1.reason === "unknown" && e1.placeholder === "nope" && /unknown placeholder \{nope\}/.test(e1.message) && e2 instanceof lib.PlaceholderError && e2.reason === "missing" && /\{client\}.*--client <slug>/.test(e2.message), `${e1?.message} | ${e2?.message}`);
    const ev = path.join(tmp, "ev"); fs.mkdirSync(path.join(ev, "snap", "a"), { recursive: true }); fs.mkdirSync(path.join(ev, "snap", "b"), { recursive: true });
    const f = (p, body, ageMs = 0) => { const full = path.join(ev, p); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, body); const t = new Date(Date.now() - ageMs); fs.utimesSync(full, t, t); return full; };
    const since = Date.now() - 60_000;
    f("ok.json", "{}"); f("empty.json", ""); f("old.json", "{}", 3_600_000);
    const st = (evidence, inputs = []) => ({ evidence, inputs });
    const es = (p, opts = {}, inputs = []) => lib.evidenceState(st([p], inputs), {}, { since, ...opts });
    const c1 = es(path.join(ev, "ok.json"));
    const c2 = es(path.join(ev, "nope.json"));
    const c3 = es(path.join(ev, "empty.json"));
    const c4 = es(path.join(ev, "old.json"));
    const c5 = es(path.join(ev, "old.json"), {}, [path.join(ev, "old.json")]);
    check("E: evidence that exists, is not empty and is newer than the step's start is done", c1.state === "done" && !c1.problems.length, JSON.stringify(c1));
    check("E: evidence that is missing is missing (the problem says 'missing')", c2.state === "missing" && /^missing: /.test(c2.problems[0]), JSON.stringify(c2));
    check("E: evidence that is empty is missing (the problem says 'empty')", c3.state === "missing" && /^empty: /.test(c3.problems[0]), JSON.stringify(c3));
    check("E: evidence older than the step's start is stale (the problem says 'older than the step')", c4.state === "stale" && /^older than the step: /.test(c4.problems[0]), JSON.stringify(c4));
    check("E: a path the step only reads (also an input) needs to exist and be non-empty, not to be new", c5.state === "done", JSON.stringify(c5));
    f("snap/a/_site.json", "{}", 3_600_000); f("snap/b/_site.json", "{}");
    const c6 = es(path.join(ev, "snap", "*", "_site.json"));
    f("snap/b/_site.json", "{}", 3_600_000);
    const c7 = es(path.join(ev, "snap", "*", "_site.json"));
    f("snap/b/_site.json", "", 0);
    const c8 = es(path.join(ev, "snap", "*", "_site.json"));
    check("E: a pattern with several matches (dated snapshot folders) is satisfied by its newest match, an older one beside it does not fail it", c6.state === "done" && c7.state === "stale" && /older than the step/.test(c7.problems[0]), JSON.stringify([c6, c7]));
    check("E: a pattern's match that is empty still counts as empty", c8.state === "missing" && c8.problems.some((p) => /^empty: /.test(p)), JSON.stringify(c8));
    // the same through an injected file system: no real files (the CLI tests with fakes)
    const NOW = Date.now(), files = { "/r/a.json": { size: 5, mtimeMs: NOW }, "/r/old.json": { size: 5, mtimeMs: NOW - 9e6 }, "/r/zero.json": { size: 0, mtimeMs: NOW } };
    const fake = { existsSync: (p) => p in files, statSync: (p) => ({ ...files[p], isDirectory: () => false }), readdirSync: () => [] };
    const fe = (p) => lib.evidenceState(st([p]), {}, { since: NOW - 1000, io: fake }).state;
    check("E: evidenceState reads the files through an injected io (done / stale / missing / empty = missing)", fe("/r/a.json") === "done" && fe("/r/old.json") === "stale" && fe("/r/none.json") === "missing" && fe("/r/zero.json") === "missing", [fe("/r/a.json"), fe("/r/old.json"), fe("/r/none.json"), fe("/r/zero.json")].join());
    // ---------------- D2: adoptStep(step, { vars, now, io }) (a run takes over a step's valid existing outputs instead of running it again) ----------------
    {
      const H = 3_600_000, T = Date.now();
      const F = { "/r/in.json": { size: 5, mtimeMs: T - 3 * H }, "/r/newin.json": { size: 5, mtimeMs: T - 600_000 }, "/r/same.json": { size: 5, mtimeMs: T - H }, "/r/out.json": { size: 9, mtimeMs: T - H }, "/r/out2.json": { size: 9, mtimeMs: T - 5 * H }, "/r/zero.json": { size: 0, mtimeMs: T - H } };
      const aio = { existsSync: (p) => p in F, statSync: (p) => ({ ...F[p], isDirectory: () => false }), readdirSync: () => [] };
      const mk = (over) => ({ id: "x", module: "m", what: "w", script: "scripts/x.mjs", args: [], inputs: [], outputs: [], dependsOn: [], needsBrowser: "none", needsAi: false, needsPerson: false, needsKeys: [], heavy: false, hits: "none", pace: null, timeoutMinutes: 1, evidence: ["/r/out.json"], ...over });
      const ad = (step, vars = {}) => { try { return lib.adoptStep(step, { vars, now: T, io: aio }); } catch (e) { return { ok: null, threw: e.message }; } };
      const a1 = ad(mk({ inputs: ["/r/in.json"] }));
      check("D2: a step whose evidence exists, is not empty and is newer than every input is adopted: ok, outcome 'adopted', exit 0", a1.ok === true && a1.outcome === "adopted" && a1.exit === 0 && a1.id === "x", JSON.stringify(a1));
      check("D2: the adopted step's date is the EVIDENCE's own mtime, not now (at = evidence mtime, adoptedAt = now)", a1.at === new Date(T - H).toISOString() && a1.adoptedAt === new Date(T).toISOString() && a1.at !== a1.adoptedAt, JSON.stringify([a1.at, a1.adoptedAt]));
      const a2 = ad(mk({ inputs: ["/r/in.json", "/r/newin.json"] }));
      check("D2: an input newer than the evidence refuses the adoption and NAMES the input (rule input-newer, with both dates)", a2.ok === false && a2.rule === "input-newer" && /\/r\/newin\.json/.test(a2.reason) && a2.input === "/r/newin.json" && !!a2.inputMtime && !!a2.evidenceMtime, JSON.stringify(a2));
      const a3 = ad(mk({ evidence: ["/r/zero.json"] })), a4 = ad(mk({ evidence: ["/r/none.json"] }));
      check("D2: empty evidence refuses (rule evidence, says empty and names the file); missing evidence refuses too", a3.ok === false && a3.rule === "evidence" && /empty/.test(a3.reason) && /zero\.json/.test(a3.reason) && a4.ok === false && a4.rule === "evidence" && /missing/.test(a4.reason), JSON.stringify([a3, a4]));
      const a5 = ad(mk({ evidence: [] }));
      check("D2: a step that names no evidence cannot be adopted (nothing to look at): rule no-evidence", a5.ok === false && a5.rule === "no-evidence", JSON.stringify(a5));
      const a6 = ad(mk({ evidence: ["/r/out.json", "/r/out2.json"], inputs: ["/r/in.json"] })), a7 = ad(mk({ evidence: ["/r/out.json", "/r/out2.json"], inputs: ["/r/out2.json"].slice(1) }));
      const a7b = ad(mk({ evidence: ["/r/out.json", "/r/out2.json"], inputs: ["/r/none.json"] }));
      check("D2: with several evidence files the input must be older than the OLDEST (in.json is 3 h old, out2.json 5 h: refused), and the date of an adopted step is the NEWEST evidence", a6.ok === false && a6.rule === "input-newer" && a7b.ok === true && a7b.at === new Date(T - H).toISOString(), JSON.stringify([a6, a7b]));
      const a8 = ad(mk({ inputs: ["/r/out.json"] })), a9 = ad(mk({ inputs: ["/r/same.json"] }));
      check("D2: a path that is both an input and the evidence is not compared with itself; an input exactly as old as the evidence is not newer, so it is adopted", a8.ok === true && a9.ok === true, JSON.stringify([a8, a9]));
      const a10 = ad(mk({ script: null, needsBrowser: "owner", brief: "Capture it.", inputs: ["/r/in.json"] }));
      check("D2: a waiting step (script null: an owner capture, an approval) is adopted the same way when its evidence exists", a10.ok === true && a10.outcome === "adopted", JSON.stringify(a10));
      const a11 = ad(mk({ inputs: ["/r/none.json", "/r/in.json"] }));
      check("D2: an input that does not exist cannot be newer: it is listed under missingInputs, not a refusal", a11.ok === true && JSON.stringify(a11.missingInputs) === JSON.stringify(["/r/none.json"]), JSON.stringify(a11));
      const a12 = ad(mk({ evidence: ["{client}/x.json"] }), { client: null });
      check("D2: a placeholder with no value (a path needing --client) is a refusal with the reason, never a throw", a12.ok === false && a12.rule === "placeholder" && !a12.threw, JSON.stringify(a12));
    }

    // ---------------- A: the API the CLI imports ----------------
    check("A: the lib exports the API names (loadManifest, validateManifest, runOrder, substitute, evidenceState, stepOutcome, stepKind, describe) and prints nothing, never exits", ["loadManifest", "validateManifest", "runOrder", "substitute", "evidenceState", "stepOutcome", "stepKind", "stepStop", "describe", "PlaceholderError"].every((k) => typeof lib[k] === "function") && !/console\.|process\.exit/.test(fs.readFileSync(path.join(sdir, "lib-pipeline.mjs"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")), "missing export, or console / process.exit in the code");
    const sf = (...a) => { try { return lib.loadManifest(...a); } catch (e) { return { ok: null, problems: [{ rule: "threw", detail: e.message }], manifest: { steps: [] } }; } }; // a throw is a red assertion, not a crash
    const lm = sf(PIPE), lmBad = sf(path.join(tmp, "no-such.json")), lmJson = sf("x", { io: { readFileSync: () => "{ nope" } }), lmFake = sf("x", { io: { readFileSync: () => '\uFEFF{"version":1}' } });
    check("A: loadManifest returns { ok, manifest, problems } (the real file ok; a missing file and bad JSON are problems with rule 'load', not exceptions; an injected io and a BOM work)", lm.ok && lm.manifest.steps.length === manifest.steps.length && !lmBad.ok && lmBad.problems[0].rule === "load" && !lmJson.ok && /not valid JSON/.test(lmJson.problems[0].detail) && lmFake.ok && lmFake.manifest.version === 1, JSON.stringify([lmBad, lmJson]));
    const vm = lib.validateManifest((() => { const m = clone(); step(m, "psi").surprise = 1; return m; })(), { skillDir });
    check("A: validateManifest returns { ok: false, problems: [{ rule, step, detail }] } (rule 'step-key', step 'psi'); the real manifest is { ok: true, problems: [] }", !vm.ok && vm.problems.length === 1 && vm.problems[0].rule === "step-key" && vm.problems[0].step === "psi" && /unknown key "surprise"/.test(vm.problems[0].detail) && lib.validateManifest(manifest, { skillDir }).ok === true, JSON.stringify(vm));
    const ro = lib.runOrder(cyc);
    check("A: runOrder returns { ok, steps, ids, problems } and a cycle is a problem value (rule 'cycle'), never a throw", !ro.ok && ro.problems[0].rule === "cycle" && lib.runOrder(manifest).ok && lib.runOrder(manifest).steps.length === manifest.steps.length, JSON.stringify(ro.problems));
    check("A: stepKind says script, person, browser or agent", lib.stepKind(step(manifest, "psi")) === "script" && lib.stepKind(step(manifest, "approve-business")) === "person" && lib.stepKind(step(manifest, "capture-google")) === "browser" && lib.stepKind(step(manifest, "checker")) === "agent", "");
    const S0 = { exit: {} }, SP = { exit: { 4: "partial: what was read is kept" } }, okEv = { state: "done", problems: [] }, badEv = { state: "missing", problems: ["missing: /x"] };
    const so = (step2, o) => lib.stepOutcome(step2, o);
    const OUT = [
      ["exit 0 with its evidence is done", so(S0, { code: 0, lastLine: "wrote it", evidence: okEv }), "done", /wrote it/],
      ["exit 0 whose evidence is missing is a failure that lists the problem", so(S0, { code: 0, lastLine: "wrote it", evidence: badEv }), "fail", /evidence is not there: missing: \/x/],
      ["exit 3 with a 'BLOCKED: <what> | unblocks: <what would>' last line is blocked, the line quoted without its prefix", so(S0, { code: 3, lastLine: "BLOCKED: no key | unblocks: set it" }), "blocked", /^no key \| unblocks: set it$/],
      ["exit 3 without the BLOCKED line is a failure (a broken contract), not a block", so(S0, { code: 3, lastLine: "something odd" }), "fail", /not "BLOCKED:/],
      ["exit 3 with a NEEDS-INPUT line in the output is needs-input", so(S0, { code: 3, lastLine: "BLOCKED: intake needs the owner's answers | unblocks: answer", output: "NEEDS-INPUT stage=intake: 2 questions\nBLOCKED: intake needs the owner's answers" }), "needs-input", /./],
      ["exit 4 with 'SKIPPED: <reason>' is skipped, the reason quoted", so(S0, { code: 4, lastLine: "SKIPPED: not applicable" }), "skipped", /^not applicable$/],
      ["exit 4 without the SKIPPED line is a failure", so(S0, { code: 4, lastLine: "done something" }), "fail", /not "SKIPPED:/],
      ["exit 4 on a step whose manifest says '4: partial' is partial", so(SP, { code: 4, lastLine: "read 10 of 25" }), "partial", /read 10 of 25/],
      ["exit 2 is a failure that names the usage error", so(S0, { code: 2, lastLine: "usage: node x" }), "fail", /usage error \(exit 2\)/],
      ["any other exit (1) is a failure", so(S0, { code: 1, lastLine: "crashed" }), "fail", /exit 1: crashed/],
    ];
    for (const [name, got, want, re] of OUT) check(`A: stepOutcome: ${name}`, got.outcome === want && re.test(got.message), JSON.stringify(got));

    // ---------------- G: stops (lib-stops.mjs) for the steps that carry engines ----------------
    try {
    const UNTIL = "2026-11-12T02:29:12.000Z";
    const seen = [];
    const fakeStopped = (stopped, lifted = false) => (e, now, dir2, mode) => { seen.push(mode); return stopped.includes(e) && !(mode === "desktop" && lifted) ? { engine: e, until: UNTIL, reason: "robot check" } : null; };
    const none = lib.stepStop({ id: "x" }, { isStopped: fakeStopped(["google"]) });
    const hit = lib.stepStop({ engines: ["google", "bing"] }, { isStopped: fakeStopped(["bing"]) });
    const free = lib.stepStop({ engines: ["google"] }, { isStopped: fakeStopped([]) });
    check("G: stepStop is null for a step with no engines and for engines that are not stopped", none === null && free === null, JSON.stringify([none, free]));
    check("G: stepStop returns the stop of the first stopped engine with its until, reason and a message that quotes both and says how it unblocks", hit?.engine === "bing" && hit.until === UNTIL && hit.reason === "robot check" && new RegExp("^bing is stopped until " + UNTIL.replace(/\./g, "\\.") + " \\(robot check\\) \\| unblocks: wait until then").test(hit.message), JSON.stringify(hit));
    seen.length = 0;
    const sc = lib.stepStop({ engines: ["google"] }, { isStopped: fakeStopped(["google"], true) }), dk = lib.stepStop({ engines: ["google"] }, { mode: "desktop", isStopped: fakeStopped(["google"], true) });
    check("G: the mode reaches isStopped: a desktop lift frees a person-paced capture (desktop: null) and never a script (script: still stopped, the message says a stop is never lifted for a script)", sc && /never lifted for a script/.test(sc.message) && dk === null && seen.join() === "script,desktop", JSON.stringify([sc, dk, seen]));
    const stopsLib = await import(pathToFileURL(path.join(sdir, "lib-stops.mjs")).href + "?" + Math.random());
    const sdirStops = path.join(tmp, "stops"); fs.mkdirSync(sdirStops);
    stopsLib.writeStop({ engine: "google", until: Date.now() + 3600_000, reason: "robot check", setBy: "test", dir: sdirStops });
    const real1 = lib.stepStop({ engines: ["google"] }, { dir: sdirStops }), real2 = lib.stepStop({ engines: ["bing"] }, { dir: sdirStops });
    stopsLib.liftStop({ engine: "google", by: "test", note: "a person paces it", dir: sdirStops });
    const real3 = lib.stepStop({ engines: ["google"] }, { dir: sdirStops }), real4 = lib.stepStop({ engines: ["google"] }, { dir: sdirStops, mode: "desktop" });
    check("G: with the real lib-stops: a stop file holds the step (google), not another engine (bing); after a desktop lift the script stays stopped and a desktop capture is free", real1?.engine === "google" && real2 === null && real3?.engine === "google" && real4 === null, JSON.stringify([real1, real2, real3, real4]));
    const past = path.join(tmp, "stops-past"); fs.mkdirSync(past);
    stopsLib.writeStop({ engine: "google", until: Date.now() - 1000, reason: "old", setBy: "test", dir: past });
    check("G: an expired stop does not hold the step", lib.stepStop({ engines: ["google"] }, { dir: past }) === null, "");
    } catch (e) { check("G: stepStop and the stops run without an error (" + e.message + ")", false, String(e.stack)); }

    // ---------------- F: the file is already in run order (nobody is misled reading it top to bottom) ----------------
    const fileIds = manifest.steps.map((s) => s.id), at2 = new Map(fileIds.map((id, i) => [id, i]));
    const forward = manifest.steps.filter((s) => s.dependsOn.some((d) => at2.get(d) > at2.get(s.id)));
    check("F: pipeline.json lists its steps in run order: no step comes before a step it depends on, and runOrder leaves the file order unchanged", forward.length === 0 && lib.runOrder(manifest).ids.join() === fileIds.join(), `steps before their dependencies: ${forward.map((s) => `${s.id} (needs ${s.dependsOn.filter((d) => at2.get(d) > at2.get(s.id)).join("/")})`).join(", ")}`);

    // ---------------- M: what the work order 41 rulings put in the manifest (each fact is also shown RED on a manifest broken that way) ----------------
    const FACTS = [
      ["doctor needs no keys (it only reports which are missing); each key sits on the step that uses it: PSI_API_KEY on psi, BING_WEBMASTER_KEY on demand-bing and research, CRUX_API_KEY on crux", (m) => step(m, "doctor").needsKeys.length === 0 && step(m, "psi").needsKeys.includes("PSI_API_KEY") && step(m, "demand-bing").needsKeys.includes("BING_WEBMASTER_KEY") && step(m, "research").needsKeys.includes("BING_WEBMASTER_KEY") && step(m, "crux").needsKeys.includes("CRUX_API_KEY"), (m) => { step(m, "doctor").needsKeys.push("PSI_API_KEY"); }],
      ["no step of the manifest but vantage itself lists vantage in dependsOn (a vantage that is SKIPPED holds no capture back), and vantage depends on doctor only", (m) => !m.steps.some((s) => s.id !== "vantage" && s.dependsOn.includes("vantage")) && step(m, "vantage").dependsOn.join() === "doctor", (m) => { step(m, "capture-google").dependsOn.push("vantage"); }],
      ["the vantage step is as the head ruled (status no longer loads Google): script vantage.mjs status --json --pewp, needsBrowser headless, heavy, hits third-party:ip-geo, pace null, 2 minutes, evidence vantage.json", (m) => { const v = step(m, "vantage"); return v.script === "scripts/vantage.mjs" && v.args.join(" ") === "status --json --pewp {pewp}" && v.needsBrowser === "headless" && v.heavy === true && v.hits === "third-party:ip-geo" && v.pace === null && v.timeoutMinutes === 2 && v.evidence.join() === "{pewp}/vantage.json"; }, (m) => { step(m, "vantage").hits = "third-party:google.com"; }],
      ["engines are set where the head ruled: google on capture-google, capture-index, capture-maps, capture-trends; google and bing on capture-autocomplete; bing on capture-bing; commoncrawl on authority and authority-anchors; NOT on psi, crux or any other step", (m) => { const e = (id) => (step(m, id).engines || []).join(); const want = { "capture-google": "google", "capture-index": "google", "capture-maps": "google", "capture-trends": "google", "capture-autocomplete": "google,bing", "capture-bing": "bing", authority: "commoncrawl", "authority-anchors": "commoncrawl" }; return m.steps.every((s) => (s.engines || []).join() === (want[s.id] || "")); }, (m) => { delete step(m, "capture-bing").engines; }],
      ["the snapshot step's evidence is snapshots/latest.json, the file live-target.mjs writes on every successful run (a reuse too)", (m) => step(m, "snapshot").evidence.join() === "{runDir}/snapshots/latest.json" && /latest\.json/.test(fs.readFileSync(path.join(sdir, "live-target.mjs"), "utf8")), (m) => { step(m, "snapshot").evidence = ["{runDir}/snapshots/*/_site.json"]; }],
      ["each importer depends on its capture step and writes research/<module>.json", (m) => [["index-import", "capture-index", "index"], ["trends-import", "capture-trends", "trends"], ["ai-import", "capture-ai", "ai-answers"], ["reputation-import", "capture-reputation", "reputation"], ["social-import", "capture-social", "social"], ["ads-import", "capture-ads", "ads"]].every(([id, cap, out]) => step(m, id).dependsOn.join() === cap && step(m, id).outputs.join() === `{pewp}/research/${out}.json` && step(m, id).script === `scripts/import-${id.replace("-import", "")}.mjs`), (m) => { step(m, "ads-import").dependsOn = []; }],
      ["report-live waits for the speed steps and every importer (psi, crux, index, trends, ai, reputation, social, ads)", (m) => ["psi", "crux", "index-import", "trends-import", "ai-import", "reputation-import", "social-import", "ads-import"].every((d) => step(m, "report-live").dependsOn.includes(d)), (m) => { step(m, "report-live").dependsOn = step(m, "report-live").dependsOn.filter((d) => d !== "crux"); }],
      ["city-centres writes captures/local/grid/cities.json and local-grid-plan waits for it", (m) => step(m, "city-centres").outputs.join() === "{pewp}/captures/local/grid/cities.json" && step(m, "local-grid-plan").dependsOn.includes("city-centres") && step(m, "city-centres").dependsOn.join() === "approve-business", (m) => { step(m, "local-grid-plan").dependsOn = step(m, "local-grid-plan").dependsOn.filter((d) => d !== "city-centres"); }],
      ["psi asks for three runs per page and strategy, and demand-bing asks for the client's own site stats (BLOCKED until the client adds us)", (m) => step(m, "psi").args.join(" ").includes("--runs 3") && step(m, "demand-bing").args.includes("--site-stats"), (m) => { step(m, "psi").args = step(m, "psi").args.filter((a, i, arr) => a !== "--runs" && arr[i - 1] !== "--runs"); }],
      ["authority-anchors comes from WO 42 with the head of operations' limits: it depends on authority only, 600 requests 3 s apart (data host only), 60 minutes, and keeps its exit 3 and exit 4 meanings", (m) => { const s = step(m, "authority-anchors"); return s.dependsOn.join() === "authority" && s.args.join(" ") === "{pewp} --max-requests 600 --gap-ms 3000" && s.timeoutMinutes === 60 && /^BLOCKED/.test(s.exit?.[3] || "") && /^partial: /.test(s.exit?.[4] || ""); }, (m) => { delete step(m, "authority-anchors").exit; }],
    ];
    for (const [name, pred, brk] of FACTS) {
      const broken = clone(); brk(broken);
      let ok = false, red = false;
      try { ok = !!pred(manifest); } catch (e) { ok = false; }
      try { red = !pred(broken); } catch (e) { red = true; }
      check(`M: ${name}`, ok, "the manifest does not say this");
      check(`M: (watched red) the same check fails on a manifest broken that way: ${name.slice(0, 60)}`, red, "the check stays green on a broken manifest: it measures nothing");
    }

    // ---------------- S: SAMENESS with start.mjs audit-live (the real start.mjs; the manifest passed by path so mutant copies find it) ----------------
    const cwd = path.join(tmp, "cwd"); fs.mkdirSync(cwd);
    const runStart = (args) => spawnSync(process.execPath, [path.join(sdir, "start.mjs"), "audit-live", URL1, "--cwd", cwd, ...args], { encoding: "utf8", timeout: 120_000 });
    const r = runStart(["--pipeline", PIPE]);
    const stFile = path.join(cwd, "site-checks", "fixture.test", ".pewp", "state.json");
    const seq = fs.existsSync(stFile) ? JSON.parse(fs.readFileSync(stFile, "utf8")).start?.sequence || [] : [];
    const want = lib.runOrder(manifest.steps).steps;
    check("S: start.mjs audit-live in plan mode exits 0 on the real manifest", r.status === 0 && /Plan only/.test(r.stdout || ""), `exit ${r.status} ${(r.stdout || "").slice(-300)}${r.stderr || ""}`);
    check("S: same: the step ids and their order in start.mjs's audit-live sequence are the manifest's", seq.map((s) => s.name).join() === want.map((s) => s.id).join(), `start: ${seq.map((s) => s.name).join(" ")}\nmanifest: ${want.map((s) => s.id).join(" ")}`);
    const backFile = path.join(tmp, "backwards.json"), backM = { ...manifest, steps: [...manifest.steps].reverse() };
    fs.writeFileSync(backFile, JSON.stringify(backM));
    const cwdB = path.join(tmp, "cwd-back"); fs.mkdirSync(cwdB);
    const rb = spawnSync(process.execPath, [path.join(sdir, "start.mjs"), "audit-live", URL1, "--cwd", cwdB, "--pipeline", backFile], { encoding: "utf8", timeout: 120_000 });
    const stB = path.join(cwdB, "site-checks", "fixture.test", ".pewp", "state.json");
    const seqB = fs.existsSync(stB) ? JSON.parse(fs.readFileSync(stB, "utf8")).start?.sequence || [] : [];
    const wantB = lib.runOrder(backM.steps).ids;
    check("S: a manifest listed backwards: start.mjs's audit-live sequence is the RUN order (every step after its dependencies), not the file order", rb.status === 0 && seqB.map((x) => x.name).join() === wantB.join() && seqB.length === backM.steps.length, `exit ${rb.status} start: ${seqB.map((x) => x.name).slice(0, 6).join(" ")} want: ${wantB.slice(0, 6).join(" ")} ${(rb.stderr || "").slice(0, 200)}`);
    const depDiff = want.filter((s) => JSON.stringify(seq.find((x) => x.name === s.id)?.dependsOn ?? null) !== JSON.stringify(s.dependsOn));
    check("S: same: every step's dependsOn in start.mjs's sequence is the manifest's", seq.length === want.length && depDiff.length === 0, `differ: ${depDiff.map((s) => s.id).join(", ") || "(lengths differ)"}`);
    if (sdir === scriptsDir) {
      const r2 = spawnSync(process.execPath, [path.join(sdir, "start.mjs"), "audit-live", URL1, "--cwd", path.join(tmp, "cwd2")], { encoding: "utf8", timeout: 120_000 });
      check("S: without --pipeline start.mjs reads the skill's own pipeline.json", r2.status === 0 && /PLAN audit-live/.test(r2.stdout || "") && want.every((s) => (r2.stdout || "").includes(` ${s.id} `)), `exit ${r2.status} ${(r2.stdout || "").slice(0, 200)}${r2.stderr || ""}`);
    }

    // ---------------- U: every script step's args are accepted by its script ----------------
    const guard = path.join(sdir, "netguard-import.mjs");
    const netLog = path.join(tmp, "net.log");
    const runIt = (file, args, env) => new Promise((resolve) => {
      const c = spawn(process.execPath, ["--import", pathToFileURL(guard).href, file, ...args], { cwd: tmp, env: { ...process.env, PEWP_NETGUARD_LOG: netLog, USERPROFILE: tmp, HOME: tmp, NODE_OPTIONS: "", PSI_API_KEY: "", BING_WEBMASTER_KEY: "", REDDIT_TOKEN: "", CRUX_API_KEY: "", ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
      const timer = setTimeout(() => { out += "TIMED OUT"; c.kill(); }, 60_000);
      c.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
    const runCwd = path.join(tmp, "run"); fs.mkdirSync(runCwd);
    const pewpDir = path.join(runCwd, "site-checks", "fixture.test", ".pewp");
    fs.mkdirSync(path.dirname(pewpDir), { recursive: true }); fs.cpSync(path.join(skillDir, "fixtures", "pewp"), pewpDir, { recursive: true });
    fs.mkdirSync(path.join(pewpDir, "approved"), { recursive: true }); fs.writeFileSync(path.join(pewpDir, "approved", "seeds.json"), JSON.stringify({ queries: [{ query: "historic homes for sale" }] }));
    const V = { url: URL1, client: "fixture-client", host: "fixture.test", skill: skillDir, runDir: path.join(runCwd, "site-checks", "fixture.test"), pewp: pewpDir, work: path.join(runCwd, "site-checks", "fixture.test", "work") };
    // the mutants of S, V, O and E do not touch the scripts' arguments: U runs once, on the real tree
    for (const s of sdir === scriptsDir ? manifest.steps.filter((x) => x.script) : []) {
      const file = path.join(sdir, path.basename(s.script));
      if (!fs.existsSync(file)) { check(`U: ${s.id}: ${s.script} exists`, false, `${file} missing`); continue; }
      const { text, src } = usageText(file);
      const flags = s.args.filter((a) => /^--[a-z]/.test(a));
      const words = s.args.filter((a) => /^[a-z]+$/.test(a));
      const missing = flags.filter((f2) => !flagRe(f2).test(text));
      const sourceOnly = missing.filter((f2) => src.includes(`"${f2.slice(2)}"`) || src.includes(`"${f2}"`) || src.includes(`'${f2.slice(2)}'`));
      const unknown = missing.filter((f2) => !sourceOnly.includes(f2));
      const lostWords = words.filter((w2) => !src.includes(`"${w2}"`) && !new RegExp(`\\b${w2}\\b`).test(text));
      check(`U: ${s.id}: every flag and word of its args is known to ${path.basename(s.script)}`, !unknown.length && !lostWords.length, `not in the usage text or the source: ${[...unknown, ...lostWords].join(" ")}`,
        sourceOnly.length ? `CHECKED against usage text; source only (missing from its usage line): ${sourceOnly.join(" ")}` : "CHECKED against usage text");
      if (RUN_STEPS.includes(s.id)) {
        const args = s.args.map((a) => lib.substitute(a, V)).map((a, i, arr) => (arr[i - 1] === "--cwd" ? runCwd : a));
        fs.rmSync(netLog, { force: true }); // one step that wrongly reaches out must not fail the steps after it
        const res = await runIt(file, args, {});
        const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
        check(`U: ${s.id}: RUN with its manifest args on a fixture pewp, the script accepts them (not exit 2) and makes no non-local request`, res.code !== 2 && !/TIMED OUT/.test(res.out) && !net, `exit ${res.code}; net: ${net}; ${res.out.slice(-400)}`, `RUN against fixtures/pewp, exit ${res.code}${/^BLOCKED:/m.test(res.out) ? " (BLOCKED: " + (res.out.match(/^BLOCKED: (.{0,60})/m)?.[1] || "") + ")" : ""}`);
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); }
  return results;
}

// ---------------- mutants ----------------
const LP = "lib-pipeline.mjs";
const MUTANTS = [
  { name: "start.mjs keeps its own audit-live sequence instead of the manifest's", patches: [{ file: "start.mjs", from: "S.push(...pipelineSequence());", to: "S.push(doctorStage(loc, T1), snapshotStage(loc));" }], expect: [/^S: same: the step ids and their order/, /^S: same: every step's dependsOn/] },
  { name: "start.mjs runs the manifest in file order, not the run order", patches: [{ file: "start.mjs", from: "return runOrder(lm.manifest).steps.map(manifestStage);", to: "return lm.manifest.steps.map(manifestStage);" }], expect: [/^S: a manifest listed backwards/] },
  { name: "start.mjs drops a step of the manifest", patches: [{ file: "start.mjs", from: "return runOrder(lm.manifest).steps.map(manifestStage);", to: "return runOrder(lm.manifest).steps.slice(1).map(manifestStage);" }], expect: [/^S: same: the step ids and their order/] },
  { name: "start.mjs does not record dependsOn", patches: [{ file: "start.mjs", from: "...(s.dependsOn ? { dependsOn: s.dependsOn } : {})", to: "...{}" }], expect: [/^S: same: every step's dependsOn/] },
  { name: "no cycle check (runOrder gives up quietly)", patches: [{ file: LP, from: "if (i < 0) return { ok: false, steps: out, ids: out.map((s) => s.id), problems: [problem(\"cycle\", null, `cycle among: ${left.map((s) => s.id).join(\", \")}`)] };", to: "if (i < 0) { out.push(...left); break; }" }], expect: [/^V: a cycle is refused/, /^O: a cycle cannot be ordered/, /^A: runOrder returns/] },
  { name: "runOrder ignores dependencies", patches: [{ file: LP, from: "const i = left.findIndex((s) => (s.dependsOn || []).every((d) => placed.has(d) || !ids.has(d)));", to: "const i = 0;" }], expect: [/^O: a manifest listed backwards/] },
  { name: "an unknown engine name is accepted", patches: [{ file: LP, from: "if (!Object.hasOwn(KNOWN_ENGINES, e)) bad(", to: "if (false) bad(" }], expect: [/^V: an engines name that lib-stops does not know/] },
  { name: "engines may be a string", patches: [{ file: LP, from: "if (!Array.isArray(s.engines) || !s.engines.length) bad(", to: "if (false) bad(" }], expect: [/^V: engines that is not a list of names/] },
  { name: "stepStop never finds a stop", patches: [{ file: LP, from: "if (stop) return { engine,", to: "if (false) return { engine," }], expect: [/^G: stepStop returns the stop of the first stopped engine/, /^G: with the real lib-stops/] },
  { name: "stepStop ignores the mode", patches: [{ file: LP, from: "const stop = isStopped(engine, now, dir, mode);", to: "const stop = isStopped(engine, now, dir, \"script\");" }], expect: [/^G: the mode reaches isStopped/, /^G: with the real lib-stops/] },
  { name: "the lib prints something", patches: [{ file: LP, from: "export const describe = ", to: "console.log('hi'); export const describe = " }], expect: [/^A: the lib exports the API names/] },
  { name: "the lib can exit the process", patches: [{ file: LP, from: "export class PipelineError extends Error {}", to: "export class PipelineError extends Error {}\nexport const boom = () => process.exit(9);" }], expect: [/^A: the lib exports the API names/] },
  { name: "stepOutcome believes exit 0 without its evidence", patches: [{ file: LP, from: "if (evidence && evidence.state !== \"done\") return", to: "if (false) return" }], expect: [/^A: stepOutcome: exit 0 whose evidence is missing/] },
  { name: "stepOutcome believes exit 3 without the BLOCKED line", patches: [{ file: LP, from: "return /^BLOCKED:/.test(ll) ? { outcome: \"blocked\"", to: "return true ? { outcome: \"blocked\"" }], expect: [/^A: stepOutcome: exit 3 without the BLOCKED line/] },
  { name: "stepOutcome does not honour 4 = partial", patches: [{ file: LP, from: "if (code === 4 && partial) return { outcome: \"partial\", message: ll };", to: "" }], expect: [/^A: stepOutcome: exit 4 on a step whose manifest says/] },
  { name: "stepOutcome loses the NEEDS-INPUT line", patches: [{ file: LP, from: "if (code === 3 && /^NEEDS-INPUT/m.test(output)) return { outcome: \"needs-input\", message: ll };", to: "" }], expect: [/^A: stepOutcome: exit 3 with a NEEDS-INPUT line/] },
  { name: "stepOutcome counts exit 2 as ok", patches: [{ file: LP, from: "if (code === 2) return { outcome: \"fail\"", to: "if (code === 2) return { outcome: \"done\"" }], expect: [/^A: stepOutcome: exit 2 is a failure/] },
  { name: "a missing placeholder value is not a typed error", patches: [{ file: LP, from: "if (vars?.[k] == null || vars[k] === \"\") throw new PlaceholderError(k, \"missing\");", to: "if (vars?.[k] == null || vars[k] === \"\") return \"\";" }], expect: [/^E: an unknown placeholder, and one with no value/] },
  { name: "evidenceState ignores an injected io", patches: [{ file: LP, from: "const ioOf = (io) => ({ ...IO, ...(io || {}) });", to: "const ioOf = (io) => ({ ...IO });" }], expect: [/^E: evidenceState reads the files through an injected io/, /^A: loadManifest returns/] },
  { name: "loadManifest throws instead of returning problems", patches: [{ file: LP, from: "try { text = ioOf(io).readFileSync(file, \"utf8\"); } catch (e) { return", to: "try { text = ioOf(io).readFileSync(file, \"utf8\"); } catch (e) { throw e; return" }], expect: [/^A: loadManifest returns/] },
  { name: "unknown dependsOn not reported", patches: [{ file: LP, from: "else if (!ids.has(d)) bad(\"dependsOn\", at,", to: "else if (false) bad(\"dependsOn\", at," }], expect: [/^V: a dependsOn id that is not a step is refused/] },
  { name: "a step may depend on itself", patches: [{ file: LP, from: "if (d === s.id) bad(\"self-dependency\"", to: "if (false) bad(\"self-dependency\"" }], expect: [/^V: a step that depends on itself/] },
  { name: "duplicate ids allowed", patches: [{ file: LP, from: "if (ids.has(s.id)) bad(\"duplicate-id\"", to: "if (false) bad(\"duplicate-id\"" }], expect: [/^V: a duplicate id is refused/] },
  { name: "unknown placeholder in args allowed", patches: [{ file: LP, from: "if (!PLACEHOLDERS.includes(p)) bad(\"placeholder\", at, `unknown placeholder {${p}} in ${k}`)", to: "if (false) bad(\"placeholder\", at, `unknown placeholder {${p}} in ${k}`)" }], expect: [/^V: an unknown placeholder in args/, /^V: an unknown placeholder in evidence/] },
  { name: "unknown placeholder in a brief allowed", patches: [{ file: LP, from: "if (!PLACEHOLDERS.includes(p)) bad(\"placeholder\", at, `unknown placeholder {${p}} in brief`)", to: "if (false) bad(\"placeholder\", at, `unknown placeholder {${p}} in brief`)" }], expect: [/^V: an unknown placeholder in a brief/] },
  { name: "a missing script is not noticed", patches: [{ file: LP, from: "(scriptExists ? !scriptExists(s.script) : skillDir && !fs.existsSync(path.join(skillDir, s.script)))", to: "false" }], expect: [/^V: a script that does not exist is refused/] },
  { name: "an unknown step key is allowed", patches: [{ file: LP, from: "if (![...REQUIRED, ...OPTIONAL].includes(k)) bad(\"step-key\"", to: "if (false) bad(\"step-key\"" }], expect: [/^V: an unknown step key is refused/] },
  { name: "an unknown top-level key is allowed", patches: [{ file: LP, from: "if (!TOP_KEYS.includes(k)) bad(\"top-level\"", to: "if (false) bad(\"top-level\"" }], expect: [/^V: an unknown top-level key is refused/] },
  { name: "a WAITING step needs no brief", patches: [{ file: LP, from: "if (!isStr(s.brief)) bad(\"waiting\"", to: "if (false) bad(\"waiting\"" }], expect: [/^V: a WAITING step without a brief/] },
  { name: "evidence may be anywhere", patches: [{ file: LP, from: "if (!s.outputs.some((o) => under(e, o)) && !s.inputs.some((i) => under(e, i))) bad(\"evidence\"", to: "if (false) bad(\"evidence\"" }], expect: [/^V: evidence that is neither under an output nor an input/] },
  { name: "an input written by a step that comes later is allowed", patches: [{ file: LP, from: "if (makers.length && !makers.some((w) => anc.has(w.id))) bad(\"input-order\"", to: "if (false) bad(\"input-order\"" }], expect: [/^V: an input written by a step it does not depend on/] },
  { name: "evidence older than the step counts", patches: [{ file: LP, from: "if (!readOnly.has(norm(p)) && newest.mtime < since) {", to: "if (false) {" }], expect: [/^E: evidence older than the step's start/, /^E: a pattern with several matches/] },
  { name: "empty evidence counts", patches: [{ file: LP, from: "if (!f || f.size === 0) { empty = true;", to: "if (!f) { empty = true;" }], expect: [/^E: evidence that is empty/, /^E: a pattern's match that is empty/] },
  { name: "a pattern needs ALL its matches to be new", patches: [{ file: LP, from: "else if (!newest || f.mtime > newest.mtime) newest = { mtime: f.mtime, path: h };", to: "else if (!newest || f.mtime < newest.mtime) newest = { mtime: f.mtime, path: h };" }], expect: [/^E: a pattern with several matches/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-pipeline.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  const t0 = Date.now();
  const main = await scenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n     [${r.note}]` : ""}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = main.filter((r) => !r.ok).length; const mainFailed = failed; let caught = 0, ran = 0;
  console.log(failed ? `PIPELINE TEST FAIL: ${failed} of ${main.length}` : `PIPELINE TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pipeline-mutant-"));
      const sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      let applied = true;
      for (const p of mu.patches) {
        const target = path.join(sdir, p.file), src = fs.readFileSync(target, "utf8"), count = src.split(p.from).length - 1;
        if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${p.file} (the patch did not apply)`); failed++; applied = false; break; }
        fs.writeFileSync(target, src.replace(p.from, () => p.to));
      }
      if (!applied) { fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 }); continue; }
      let res;
      try { res = await scenarios(sdir); } catch (e) { res = [{ name: `crashed: ${e.message}`, ok: false }]; }
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  if (A.includes("--json")) console.log(JSON.stringify({ suite: "pipeline", ok: !failed, assertions: { total: main.length, failed: mainFailed }, mutants: ran ? { ran, caught, failed: ran - caught } : null, wallMs: Date.now() - t0 }));
  process.exit(failed ? 1 : 0);
}
