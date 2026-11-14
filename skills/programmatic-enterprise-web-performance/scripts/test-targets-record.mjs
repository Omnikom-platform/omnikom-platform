// Usage: node test-targets-record.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of targets-validate.mjs --record and of the pipeline step targets-validate, on INVENTED copies of fixtures/pewp. The step used to have no
// output of its own: its evidence was targets.json, a file it only reads, so the engine could never see that targets.json had been rewritten
// after the check and kept the step as already done. Now the step writes a record of the files it read (name, bytes, sha256) and that record
// is its evidence: a targets.json or business.json written after the record makes the step run again (input-newer).
// A PASS with --record writes the record; a FAIL (exit 1) or "cannot judge" (exit 2) writes none and removes an older one; --record with no
// targets file, no path, or the path of a file the run reads is a usage error (exit 2) that changes nothing. Without --record nothing is written.
// No network (netguard-import.mjs refuses any non-local request), no browser; every case works in a temporary folder and removes it.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs twice is refused).
// Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runner, J, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "record-written-on-fail", file: "targets-validate.mjs", from: "dropRecord(); // FAIL", to: "writeRecord(); // FAIL", red: "case 3:" },
    { id: "old-record-kept-on-fail", file: "targets-validate.mjs", from: "dropRecord(); // FAIL", to: "// FAIL", red: "case 3:" },
    { id: "old-record-kept-on-cannot-judge", file: "targets-validate.mjs", from: "dropRecord(); // cannot judge", to: "// cannot judge", red: "case 4:" },
    { id: "record-written-without-the-flag", file: "targets-validate.mjs", from: "? path.resolve(recArg) : null;", to: '? path.resolve(recArg) : path.join(path.dirname(path.resolve(pos[0] || ".")), "targets-validate.json");', red: "case 2:" },
    { id: "hash-of-the-wrong-file", file: "targets-validate.mjs", from: "sha256: sha(buf)", to: "sha256: sha(seen[0].buf)", red: "case 1:" },
    { id: "record-path-read-as-the-targets-file", file: "targets-validate.mjs", from: '"--measure", "--record"]', to: '"--measure"]', red: "case 1:" },
    { id: "manifest-evidence-is-the-input-again", file: "../pipeline.json", from: '"evidence": [\n    "{pewp}/targets-validate.json"', to: '"evidence": [\n    "{pewp}/targets.json"', red: "case 6:" },
    { id: "manifest-args-without-record", file: "../pipeline.json", from: '"--record",', to: '"--not-record",', red: "case 6:" },
    { id: "manifest-outputs-empty-again", file: "../pipeline.json", from: '"outputs": [\n    "{pewp}/targets-validate.json"\n   ],', to: '"outputs": [],', red: "case 6:" },
    { id: "manifest-business-not-an-input", file: "../pipeline.json", from: '"{pewp}/targets.json",\n    "{pewp}/business.json"', to: '"{pewp}/targets.json"', red: "case 7:" },
    { id: "record-may-be-a-file-it-reads", file: "targets-validate.mjs", from: "if (recFile && [f, bf0].some(same))", to: "if (false && [f, bf0].some(same))", red: "case 5:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "targetsrec-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-targets-record.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };

const tmp = mkTmp("targets-record"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const size = (p) => fs.statSync(p).size;
let n = 0;
// a new folder with COPIES of the fixture's targets.json and business.json (the fixtures themselves are never the subject of a run)
const world = () => {
  const d = path.join(tmp, `w${n++}`), t = path.join(d, "targets.json"), b = path.join(d, "business.json");
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(skill, "fixtures", "pewp", "targets.json"), t);
  fs.copyFileSync(path.join(skill, "fixtures", "pewp", "business.json"), b);
  return { d, t, b, rec: path.join(d, "targets-validate.json") };
};
const lastLine = (s) => String(s).trim().split("\n").pop();
const rows = (w) => [["targets.json", size(w.t), sha(w.t)], ["business.json", size(w.b), sha(w.b)]];

try {
  // case 1: the record of a pass
  {
    const w = world(), nClusters = J(w.t).clusters.length;
    const r1 = await run("targets-validate.mjs", ["--record", w.rec, w.t, "--business", w.b]);
    const a = fs.existsSync(w.rec) ? J(w.rec) : null;
    const first = a && r1.code === 0 && a.version === 1 && a.step === "targets-validate" && a.result === "pass" && a.clusters === nClusters && nClusters > 0
      && !Number.isNaN(Date.parse(a.checkedAt)) && JSON.stringify((a.files || []).map((f) => [f.file, f.bytes, f.sha256])) === JSON.stringify(rows(w));
    fs.rmSync(w.rec, { force: true });
    const r2 = await run("targets-validate.mjs", [w.t, "--business", w.b, "--record", w.rec]);
    const c = fs.existsSync(w.rec) ? J(w.rec) : null;
    const second = c && r2.code === 0 && c.version === 1 && c.result === "pass" && c.clusters === nClusters && JSON.stringify((c.files || []).map((f) => [f.file, f.bytes, f.sha256])) === JSON.stringify(rows(w));
    check("case 1: a pass with --record writes the record: step, result, cluster count, each file's name, bytes and sha256",
      first && second, `flag first: exit ${r1.code}/${r1.out.trim().slice(0, 120)} record ${JSON.stringify(a)} | flag last: exit ${r2.code} record ${JSON.stringify(c)}`);
  }
  // case 2: without the flag nothing is written
  {
    const w = world(), before = fs.readdirSync(w.d).sort().join(",");
    const r = await run("targets-validate.mjs", [w.t, "--business", w.b]), after = fs.readdirSync(w.d).sort().join(",");
    check("case 2: without --record nothing is written",
      r.code === 0 && /^PASS targets-valid/.test(r.so) && before === after, `exit ${r.code} | ${lastLine(r.so)} | ${before} -> ${after}`);
  }
  // case 3: a failing file
  {
    const w = world(), r0 = await run("targets-validate.mjs", [w.t, "--business", w.b, "--record", w.rec]), had = fs.existsSync(w.rec);
    const j = J(w.t); j.clusters[1].primaryQuery = j.clusters[0].primaryQuery; fs.writeFileSync(w.t, JSON.stringify(j, null, 1) + "\n");
    const r = await run("targets-validate.mjs", [w.t, "--business", w.b, "--record", w.rec]);
    check("case 3: a failing targets file with --record: exit 1, no record, and an older pass record at that path is gone",
      r0.code === 0 && had && r.code === 1 && /^FAIL/.test(r.so) && !fs.existsSync(w.rec), `first exit ${r0.code} had ${had} | exit ${r.code} | ${lastLine(r.so)} | record there: ${fs.existsSync(w.rec)}`);
  }
  // case 4: a missing file
  {
    const w = world(), nope = path.join(w.d, "nope.json");
    const r1 = await run("targets-validate.mjs", [nope, "--record", w.rec]), none1 = !fs.existsSync(w.rec);
    const r0 = await run("targets-validate.mjs", [w.t, "--business", w.b, "--record", w.rec]), had = fs.existsSync(w.rec);
    const r2 = await run("targets-validate.mjs", [nope, "--record", w.rec]);
    check("case 4: a missing targets file with --record: exit 2, no record, and an older record at that path is gone",
      r1.code === 2 && none1 && r0.code === 0 && had && r2.code === 2 && /^ERROR targets-valid/.test(r2.so) && !fs.existsSync(w.rec),
      `exit ${r1.code}/${r0.code}/${r2.code} | none first ${none1} | had ${had} | ${lastLine(r2.so)} | record there: ${fs.existsSync(w.rec)}`);
  }
  // case 5: usage errors
  {
    const w = world(), tBytes = fs.readFileSync(w.t), out = [];
    let good = true;
    for (const argv of [["--record", w.rec], [w.t, "--record"], ["--record", w.t, w.t], ["--record", w.b, w.t, "--business", w.b]]) {
      const r = await run("targets-validate.mjs", argv);
      out.push(`${r.code}:${lastLine(r.se).slice(0, 60)}`);
      if (r.code !== 2 || !/usage: node targets-validate\.mjs .*--record/.test(r.se)) good = false;
    }
    check("case 5: --record with no file, no path, or a file it reads is a usage error: exit 2, the usage line, nothing changed",
      good && !fs.existsSync(w.rec) && fs.existsSync(w.t) && fs.readFileSync(w.t).equals(tBytes) && fs.existsSync(w.b), `${out.join(" | ")} | record there: ${fs.existsSync(w.rec)}`);
  }
  // cases 6 to 8: the real manifest and the engine's own reading of it, through a fake file system (no real file time is touched)
  {
    const lib = await import(pathToFileURL(path.join(dir, "lib-pipeline.mjs")).href + "?" + Math.random());
    const man = lib.loadManifest(path.join(skill, "pipeline.json")).manifest;
    const step = man.steps.find((s) => s.id === "targets-validate");
    const T = Date.now(), H = 3_600_000, vars = { pewp: "/r/p" };
    const F = { "/r/p/targets.json": { size: 9, mtimeMs: T - 3 * H }, "/r/p/business.json": { size: 9, mtimeMs: T - 4 * H }, "/r/p/targets-validate.json": { size: 9, mtimeMs: T - H } };
    const mk = (over) => { const f = { ...F, ...over }; for (const k of Object.keys(f)) if (f[k] === null) delete f[k]; return { existsSync: (p) => p in f, statSync: (p) => ({ size: 9, ...f[p], isDirectory: () => false }), readdirSync: () => [] }; };
    const ev = step?.evidence || [], outs = step?.outputs || [], ins = step?.inputs || [];
    const i = (step?.args || []).indexOf("--record"), recArg = i >= 0 ? step.args[i + 1] : null;
    let valid = null; try { valid = lib.validateManifest(man, { skillDir: skill }); } catch (e) { valid = { ok: false, err: e.message }; }
    check("case 6: the real step's evidence is its own output, not an input; its args carry --record with that path; the manifest is valid",
      !!step && ev.length > 0 && ev.every((e) => outs.includes(e) && !ins.includes(e)) && !!recArg && ev.includes(recArg)
      && ins.includes("{pewp}/targets.json") && ins.includes("{pewp}/business.json") && valid.ok === true,
      JSON.stringify({ evidence: ev, outputs: outs, inputs: ins, args: step?.args, valid: valid && { ok: valid.ok, err: valid.err || (valid.errors || []).slice(0, 2) } }));
    const newer = (io) => lib.inputNewer(step, vars, lib.evidenceState(step, vars, { since: 0, io }).files, { io });
    const adopt = (io) => lib.adoptStep(step, { vars, now: T, io });
    const one = (name) => { const io = mk({ [`/r/p/${name}`]: { size: 9, mtimeMs: T - 600_000 } }), nw = newer(io), ad = adopt(io); return { ok: !!nw && nw.input.endsWith(name) && ad.ok === false && ad.rule === "input-newer", d: JSON.stringify([nw, ad.ok, ad.rule]) }; };
    let a = { ok: false, d: "no step" }, b = a;
    if (step) { a = one("targets.json"); b = one("business.json"); }
    check("case 7: THE FAULT: a targets.json or business.json written after the record makes the step not done (input-newer)", a.ok && b.ok, `targets: ${a.d} | business: ${b.d}`);
    let d1 = null, d2 = null, nw8 = "?";
    if (step) { d1 = adopt(mk({})); nw8 = newer(mk({})); d2 = adopt(mk({ "/r/p/targets-validate.json": null })); }
    check("case 8: a record newer than both inputs is done; with no record the step is not done (evidence)",
      !!d1 && d1.ok === true && nw8 === null && !!d2 && d2.ok === false && d2.rule === "evidence", JSON.stringify([d1 && d1.ok, nw8, d2 && d2.ok, d2 && d2.rule]));
  }
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
