// Checks of test/mutate.mjs itself (TF-AUDIT-HARNESS). A scratch copy of the harness runs ONE mutant; its test/run.mjs
// is a stub that acts as STUB says. Alone: node tools/audit/test/harness.mjs. Check 2 is red only where a child's stdout
// pipe is asynchronous (Linux, macOS); on Windows pipes are synchronous, so it is green there with the old harness too.
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NAME = "the exit code is always 0";   // the one mutant it runs; its target text is in the hand-written stub index.mjs
// index.mjs is NOT copied: the real one may be mutated by another mutant ("exit: pass ? 0 : 1" -> "exit: 0"), which would hide it
const COPY = ["test/mutate.mjs", "test/mutants-metrics.mjs", "test/mutants-sec.mjs"];
const STUB = ["const m = process.env.STUB;", 'console.log("ok   first");',
  'if (m === "big") console.log("x".repeat(1 << 20));', 'if (m === "silent") console.log("ok   last");',
  'if (m === "caught" || m === "big") console.log("FAIL stub: the one red check");',
  'if (m === "env") console.log("FAIL stub: skip " + (process.env.OMNIKOM_AUDIT_SKIP_HARNESS === "1" ? "set" : "unset"));',
  'process.exit(m === "pass" ? 0 : 1);'].join("\n") + "\n";
const TAGGED = "[harness] an UNREAD run is not counted, so the exit stays 0";   // a mutant of mutate.mjs that carries the tag (a row of E6)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function harnessChecks({ check, AUDIT, tmp }) {
  const hz = tmp("omnikom-audit-harness-"), base = tmp("omnikom-audit-hbase-");
  mkdirSync(join(hz, "test"));
  for (const f of COPY) cpSync(join(AUDIT, f), join(hz, f));
  writeFileSync(join(hz, "index.mjs"), "export const r = { exit: pass ? 0 : 1 };\n", "utf8");
  writeFileSync(join(hz, "test", "run.mjs"), STUB, "utf8");
  const via = (mode, only = NAME) => {
    const env = { ...process.env, MUTATE_ONLY: `^${esc(only)}$`, MUTATE_JOBS: "1", OMNIKOM_AUDIT_TMP: base, STUB: mode };
    const r = spawnSync(process.execPath, ["--max-old-space-size=256", join(hz, "test", "mutate.mjs")], { encoding: "utf8", timeout: 120000, env });
    return { status: r.status, out: String(r.stdout || "").replace(/\r/g, "") };
  };
  const row = (word, rest) => new RegExp(`^${word} +${NAME} +\\(${rest}\\)$`, "m");
  const sum = (c, s, n) => new RegExp(`^1 mutants, ${c} caught, ${s} survived, ${n} not run, 0 target text missing$`, "m");
  const RED = "1 red: stub: the one red check";
  const caught = via("caught"), pass = via("pass"), silent = via("silent"), big = via("big");
  check("harness: exit 1 with no FAIL line is UNREAD, never SURVIVED; exit 0 is SURVIVED; a FAIL line is caught",
    caught.status === 0 && row("caught", RED).test(caught.out) && sum(1, 0, 0).test(caught.out)
    && pass.status === 1 && row("SURVIVED", "exit 0, 0 red").test(pass.out) && sum(0, 1, 0).test(pass.out)
    && silent.status === 1 && sum(0, 0, 1).test(silent.out) && !/SURVIVED/.test(silent.out)
    && row("UNREAD", "exit 1, no FAIL line in \\d+ characters; last: ok   last").test(silent.out),
    JSON.stringify([silent, pass, caught]));   // silent first: the check's detail is cut at 400 characters
  check("harness: the output is read in full: a FAIL line after 1 MiB of output is seen (a pipe loses it on Linux)",
    big.status === 0 && row("caught", RED).test(big.out) && sum(1, 0, 0).test(big.out), JSON.stringify(big));
  const skipRow = (name, v) => new RegExp(`^caught +${esc(name)} +\\(1 red: stub: skip ${v}\\)$`, "m");
  const ord = via("env"), tag = via("env", TAGGED);
  check("harness: a mutant gets the skip variable, a mutant with the [harness] tag does not",
    ord.status === 0 && skipRow(NAME, "set").test(ord.out) && tag.status === 0 && skipRow(TAGGED, "unset").test(tag.out),
    JSON.stringify([tag, ord]));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const ROOT = mkdtempSync(join(tmpdir(), "omnikom-audit-hz-"));
  let failed = 0, total = 0, n = 0;
  const check = (name, ok, d = "") => {
    total++; failed += ok ? 0 : 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ": " + String(d).slice(0, 400)}`);
  };
  const AUDIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try { await harnessChecks({ check, AUDIT, tmp: () => mkdtempSync(join(ROOT, `t${n++}-`)) }); }
  finally { rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
