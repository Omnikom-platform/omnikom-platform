// Usage: node test-copy-steps.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of the two manifest steps client-copy (scripts/client-copy.mjs) and client-copy-pdf (scripts/client-copy-pdf.mjs) in pipeline.json, read the way the
// engine reads them, through a fake file system with INVENTED paths and times (no real file is touched, no network, no browser: neither script is run).
// What is pinned: each step's script, args, inputs, outputs, evidence, dependencies and flags; that the copy lists every file client-copy-data.mjs reads
// (the engine's own log apart) and depends on each one's writer; that a client file or a source file written after the copy makes the step run again
// (input-newer) and the engine's log does not; that the copy's evidence is its own html and numbers sheet whatever the client file names them; that a
// missing client file is a missing input the engine can name; that the PDF follows the html (a newer html makes it not done).
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs other than once is refused).
// Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "client-file-not-an-input", file: "../pipeline.json", from: '"{pewp}/client-copy.json",\n    "{pewp}/report.json",', to: '"{pewp}/report.json",', red: "case 3:" },
    { id: "capture-directories-not-a-dependency", file: "../pipeline.json", from: '"local-grid-import",\n    "capture-directories"', to: '"local-grid-import"', red: "case 2:" },
    { id: "engine-log-an-input", file: "../pipeline.json", from: '"inputs": [\n    "{pewp}/client-copy.json",', to: '"inputs": [\n    "{pewp}/seo-run.json",\n    "{pewp}/client-copy.json",', red: "case 4:" },
    { id: "copy-outputs-empty", file: "../pipeline.json", from: '"outputs": [\n    "{pewp}/client-copy/*.html",\n    "{pewp}/client-copy/numbers-*.tsv"\n   ],', to: '"outputs": [],', red: "case 1:" },
    { id: "pdf-not-heavy", file: "../pipeline.json", from: '"heavy": true,\n   "hits": "none",\n   "pace": null,\n   "timeoutMinutes": 20,', to: '"heavy": false,\n   "hits": "none",\n   "pace": null,\n   "timeoutMinutes": 20,', red: "case 1:" },
    { id: "pdf-no-dependency", file: "../pipeline.json", from: '"dependsOn": [\n    "client-copy"\n   ],', to: '"dependsOn": [],', red: "case 7:" },
    { id: "pdf-no-input", file: "../pipeline.json", from: '"inputs": [\n    "{pewp}/client-copy/*.html"\n   ],', to: '"inputs": [],', red: "case 7:" },
    { id: "client-by-slug", file: "../pipeline.json", from: '"--client-file",\n    "{pewp}/client-copy.json"', to: '"--client-file",\n    "clients/{client}/client-copy.json"', red: "case 1:" },
    { id: "out-folder-moved", file: "../pipeline.json", from: '"--out",\n    "{pewp}/client-copy"', to: '"--out",\n    "{pewp}/copy"', red: "case 1:" },
    { id: "reader-reads-one-more", file: "client-copy-data.mjs", from: 'P("ads", "research/ads.json", "CAPTURE", "generatedAt");', to: 'P("ads", "research/ads.json", "CAPTURE", "generatedAt");\n  P("zz", "research/zz.json", "RUN", "@mtime");', red: "case 2:" },
    { id: "psi-not-an-input", file: "../pipeline.json", from: '"{pewp}/psi/",\n    "{pewp}/local/*/grid.json"', to: '"{pewp}/local/*/grid.json"', red: "case 4:" },
    { id: "numbers-sheet-not-evidence", file: "../pipeline.json", from: '"evidence": [\n    "{pewp}/client-copy/*.html",\n    "{pewp}/client-copy/numbers-*.tsv"\n   ],', to: '"evidence": [\n    "{pewp}/client-copy/*.html"\n   ],', red: "case 5:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copysteps-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-copy-steps.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };

try {
  const lib = await import(pathToFileURL(path.join(dir, "lib-pipeline.mjs")).href + "?" + Math.random());
  const man = lib.loadManifest(path.join(skill, "pipeline.json")).manifest;
  const C = man.steps.find((s) => s.id === "client-copy"), P = man.steps.find((s) => s.id === "client-copy-pdf");
  const T = Date.now(), H = 3_600_000, vars = { url: "https://x.test/", pewp: "/r/p", runDir: "/r" };
  const J = JSON.stringify;
  // a fake file system: a map path -> { mtimeMs, size }; a path that is the start of a key is a folder (posix paths only)
  const mkio = (F) => {
    const keys = Object.keys(F), isDir = (p) => keys.some((k) => k.startsWith(p.replace(/\/+$/, "") + "/"));
    const gone = (p) => Object.assign(new Error("ENOENT " + p), { code: "ENOENT" });
    return {
      existsSync: (p) => p in F || isDir(p),
      statSync: (p) => { if (p in F) return { size: 9, ...F[p], isDirectory: () => false }; if (isDir(p)) return { size: 0, mtimeMs: 0, isDirectory: () => true }; throw gone(p); },
      readdirSync: (p) => { if (!isDir(p)) throw gone(p); const b = p.replace(/\/+$/, "") + "/"; return [...new Set(keys.filter((k) => k.startsWith(b)).map((k) => k.slice(b.length).split("/")[0]))]; },
    };
  };
  const DAY = "2026-11-13", HTML = `/r/p/client-copy/Alder-website-review-${DAY}-draft.html`, TSV = `/r/p/client-copy/numbers-${DAY}.tsv`, PDF = `/r/p/client-copy/Alder-website-review-${DAY}-draft.pdf`;
  // every input of the copy as one file at T-3H (a folder gets a dated file, a * a date), the client file, the engine's log at T-30 s, the copy's two files at T-H
  const world = (over = {}) => {
    const F = {};
    for (const raw of C?.inputs || []) { let p = lib.substitute(raw, vars); if (p.endsWith("/")) p += `${DAY}.json`; F[p.replace(/\*/g, DAY)] = { mtimeMs: T - 3 * H }; }
    Object.assign(F, { "/r/p/client-copy.json": { mtimeMs: T - 3 * H }, "/r/p/seo-run.json": { mtimeMs: T - 30_000 }, [HTML]: { mtimeMs: T - H }, [TSV]: { mtimeMs: T - H } }, over);
    for (const k of Object.keys(F)) if (F[k] === null) delete F[k];
    return F;
  };
  const adopt = (step, F) => lib.adoptStep(step, { vars, now: T, io: mkio(F) });
  const inputOf = (name) => `/r/p/${name}`;
  const MIN = 60_000;

  // case 1: the steps as designed
  {
    const ok = !!C && !!P;
    let valid = { ok: false };
    try { valid = lib.validateManifest(man, { skillDir: skill }); } catch (e) { valid = { ok: false, err: e.message }; }
    const noClient = ok && !J(C).includes("{client}") && !J(P).includes("{client}");
    check("case 1: the real manifest holds client-copy and client-copy-pdf as designed: script, args, inputs, outputs, evidence, dependsOn, needsBrowser, heavy, hits, kind, no {client}, and it is valid",
      ok && C.script === "scripts/client-copy.mjs" && J(C.args) === J(["{url}", "--pewp", "{pewp}", "--client-file", "{pewp}/client-copy.json", "--out", "{pewp}/client-copy"])
      && J(C.outputs) === J(["{pewp}/client-copy/*.html", "{pewp}/client-copy/numbers-*.tsv"]) && J(C.evidence) === J(C.outputs) && C.needsBrowser === "none" && C.heavy === false && C.hits === "none" && C.kind === "derived" && C.dependsOn.includes("report-live")
      && P.script === "scripts/client-copy-pdf.mjs" && J(P.args) === J(["{pewp}/client-copy"]) && J(P.outputs) === J(["{pewp}/client-copy/*.pdf"]) && J(P.evidence) === J(P.outputs)
      && P.needsBrowser === "headless" && P.heavy === true && P.hits === "none" && P.kind === "derived" && P.timeoutMinutes === 20 && noClient && valid.ok === true,
      J({ C: C && { args: C.args, outputs: C.outputs, evidence: C.evidence, heavy: C.heavy }, P: P && { args: P.args, outputs: P.outputs, heavy: P.heavy, needsBrowser: P.needsBrowser }, noClient, valid: valid.ok ? true : (valid.problems || []).slice(0, 2) || valid.err }));
  }
  // case 2: what the copy's reader reads, and the writers of it
  {
    const text = fs.readFileSync(path.join(dir, "client-copy-data.mjs"), "utf8");
    const rels = [...text.matchAll(/\bP\("([^"]+)", "([^"]+)"/g)].map((m) => m[2]).filter((r) => r !== "seo-run.json");
    const missing = rels.filter((r) => !(C?.inputs || []).includes(`{pewp}/${r}`));
    const must = ["{runDir}/snapshots/*/_site.json", "{pewp}/psi/", "{pewp}/local/*/grid.json", "{pewp}/report.json"].filter((x) => !(C?.inputs || []).includes(x));
    const drop = (id) => { const m = structuredClone(man); const c = m.steps.find((s) => s.id === "client-copy"); c.dependsOn = c.dependsOn.filter((d) => d !== id); const v = lib.validateManifest(m, { skillDir: skill }); return v.problems.some((p) => p.rule === "input-order" && p.step === "client-copy"); };
    const dropped = C ? ["capture-directories", "local-grid-import", "authority-vet"].map((id) => [id, drop(id)]) : [];
    const own = lib.validateManifest(man, { skillDir: skill }).problems.filter((p) => p.rule === "input-order").map((p) => p.step);
    check("case 2: client-copy lists every file client-copy-data.mjs reads (but the engine's own log) and depends on each one's writer",
      !!C && rels.length >= 16 && missing.length === 0 && must.length === 0 && !C.inputs.includes("{pewp}/seo-run.json") && dropped.length === 3 && dropped.every(([, bad]) => bad) && own.length === 0,
      J({ steps: !!C, files: rels.length, notInputs: missing, mustHave: must, dropGivesInputOrder: dropped, inputOrderProblemsOfTheRealManifest: own }));
  }
  // case 3: THE FAULT
  {
    const a = C ? adopt(C, world()) : null, b = C ? adopt(C, world({ "/r/p/client-copy.json": { mtimeMs: T - 10 * MIN } })) : null;
    check("case 3: THE FAULT: the client file written after the copy makes the step not done (input-newer), an older one leaves it done",
      !!a && a.ok === true && !!b && b.ok === false && b.rule === "input-newer" && String(b.input).endsWith("client-copy.json"), J([a && a.ok, b && [b.ok, b.rule, b.input]]));
  }
  // case 4: any source file, not the engine's log
  {
    const one = (p) => { const r = adopt(C, world({ [p]: { mtimeMs: T - 10 * MIN } })); return [p.split("/").slice(-2).join("/"), r.ok, r.rule]; };
    const got = C ? [inputOf(`research/bing.json`), `/r/p/local/${DAY}/grid.json`, `/r/p/psi/${DAY}.json`, inputOf("authority/vetting.json"), inputOf("captures/local/citations.json")].map(one) : [];
    const log = C ? adopt(C, world({ "/r/p/seo-run.json": { mtimeMs: T - 5 * MIN } })) : null;
    check("case 4: any source file written after the copy makes the step not done, the engine's log does not",
      got.length === 5 && got.every(([, ok, rule]) => ok === false && rule === "input-newer") && !!log && log.ok === true && !C.inputs.some((x) => /seo-run\.json$/.test(x)), J({ got, log: log && [log.ok, log.rule] }));
  }
  // case 5: the copy's evidence is its own html and numbers sheet, whatever the client file names them
  {
    const draft = C ? adopt(C, world()) : null;
    const fin = C ? adopt(C, world({ [HTML]: null, "/r/p/client-copy/Alder-website-review-2026-11-13.html": { mtimeMs: T - H } })) : null;
    const noHtml = C ? adopt(C, world({ [HTML]: null })) : null, noTsv = C ? adopt(C, world({ [TSV]: null })) : null;
    check("case 5: the copy's evidence is its own html and tsv, whatever the client file names them",
      !!draft && draft.ok === true && !!fin && fin.ok === true && !!noHtml && noHtml.ok === false && noHtml.rule === "evidence" && !!noTsv && noTsv.ok === false && noTsv.rule === "evidence",
      J([draft && draft.ok, fin && fin.ok, noHtml && [noHtml.ok, noHtml.rule], noTsv && [noTsv.ok, noTsv.rule]]));
  }
  // case 6: the client file absent is a missing input the engine can name, not a pass
  {
    const F = world({ "/r/p/client-copy.json": null }), io = mkio(F);
    const r = C ? lib.adoptStep(C, { vars, now: T, io }) : null;
    const raw = "{pewp}/client-copy.json", writers = man.steps.filter((s) => (s.outputs || []).some((o) => lib.covers(o, raw) || lib.covers(raw, o))).map((s) => s.id);
    check("case 6: the client file absent is a missing input the engine can name, not a pass",
      !!C && C.inputs.includes(raw) && writers.length === 0 && !!r && (r.missingInputs || []).includes("/r/p/client-copy.json") && lib.globPaths("/r/p/client-copy.json", { io }).length === 0,
      J({ writers, missing: r && r.missingInputs }));
  }
  // case 7: the PDF step follows the html
  {
    const base = { [PDF]: { mtimeMs: T - 30 * MIN } };
    const a = P ? adopt(P, world(base)) : null, b = P ? adopt(P, world({ ...base, [HTML]: { mtimeMs: T - 10 * MIN } })) : null, c = P ? adopt(P, world()) : null;
    check("case 7: the PDF step depends on the copy; a newer html makes it not done (input-newer), a pdf newer than the html is done, no pdf is missing (evidence)",
      !!P && J(P.dependsOn) === J(["client-copy"]) && !!a && a.ok === true && !!b && b.ok === false && b.rule === "input-newer" && String(b.input).endsWith(".html") && !!c && c.ok === false && c.rule === "evidence",
      J({ dependsOn: P && P.dependsOn, a: a && a.ok, b: b && [b.ok, b.rule, b.input], c: c && [c.ok, c.rule] }));
  }
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
