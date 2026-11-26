// R3 runner: runs an advisor through the head's harness (unchanged grader and cases) and compares it with the cp11 baseline.
// Usage: node --import ./factory/advisor/r3/ts-hook.mjs factory/advisor/r3/run-cp11.mjs <advisor-module.mjs> <outDir> [--harness <dir>] [--baseline <cp.jsonl>]
//   <advisor-module.mjs> exports loadAdvisor() -> { engine, initialState, flow: { faq, enquiry, scripted, site, enquiryScript, route }, label }
// What it does: copies the head's harness files READ-ONLY into <outDir>/harness/, replaces only card-sim.mjs's loader (the card's
// router, newCard, startInquiry and cardSend are copied verbatim from the head's file), runs harness.mjs, then grades row by row
// against the baseline: PASS > PARTIAL > FAIL. Exit 0 only when no row is graded worse. Prints the rows that turned FAIL -> PASS.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [mod, outDir] = argv;
const HEAD = 'E:/Omnikom Platform/head-of-operations/domains/omnikom-io-advisor/test-2026-11-25';
const harnessDir = opt('--harness', HEAD + '/harness-current');
const baseline = opt('--baseline', HEAD + '/checkpoints/cp11-results.jsonl');
if (!mod || !outDir) { console.error('usage: run-cp11.mjs <advisor-module.mjs> <outDir> [--harness dir] [--baseline file]'); process.exit(2); }
const H = join(resolve(outDir), 'harness');
mkdirSync(H, { recursive: true });
for (const f of ['harness.mjs', 'cases-paraphrase.mjs', 'cases-battery.mjs', 'claims.mjs']) cpSync(join(harnessDir, f), join(H, f));
const sim = readFileSync(join(harnessDir, 'card-sim.mjs'), 'utf8');
const at = sim.indexOf("const IE = { interest: 'production-team' };");
if (at < 0) { console.error('FAIL: the head\'s card-sim.mjs changed shape (no IE line); the runner must be updated'); process.exit(3); }
writeFileSync(join(H, 'card-sim.mjs'), `// Written by factory/advisor/r3/run-cp11.mjs: the loader is replaced; everything from IE down is the head's card-sim.mjs verbatim.
import { pathToFileURL } from 'node:url';
export async function loadAdvisor() {
  const a = await (await import(${JSON.stringify(pathToFileURL(resolve(mod)).href)})).loadAdvisor();
  const flow = { ...a.flow };
  Object.assign(flow, { TE: flow.scripted, ME: flow.enquiryScript, jE: flow.site, _E: flow.faq, AE: flow.enquiry });
  return { engine: a.engine, initialState: a.initialState, flow, label: a.label };
}

` + sim.slice(at));
const run = spawnSync(process.execPath, [...process.execArgv, join(H, 'harness.mjs'), 'unused-bundle-dir', resolve(outDir)], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 540000 });
writeFileSync(join(outDir, 'harness-output.txt'), (run.stdout || '') + (run.stderr || ''));
if (run.status !== 0) { console.error('FAIL: harness exited ' + run.status + '\n' + (run.stderr || '').slice(-2000)); process.exit(1); }
const load = (f) => new Map(readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.id, o]; }));
const A = load(baseline), B = load(join(outDir, 'results.jsonl'));
const rank = (v) => (v === 'PASS' ? 2 : v === 'PARTIAL' ? 1 : 0);
const worse = [], better = [], failToPass = [], inputDiff = [], textDiff = [];
for (const [id, o] of A) {
  const n = B.get(id);
  if (!n) { worse.push(`  #${id} MISSING in new results`); continue; }
  if (n.input !== o.input) inputDiff.push(id);
  if (n.output !== o.output) textDiff.push(id);
  if (rank(n.verdict) < rank(o.verdict)) worse.push(`  #${id} ${o.verdict}->${n.verdict} ${JSON.stringify(n.input).slice(0, 80)} :: ${String(n.reason).slice(0, 160)}`);
  if (rank(n.verdict) > rank(o.verdict)) better.push(id);
  if (o.verdict === 'FAIL' && n.verdict === 'PASS') failToPass.push(`  #${id} ${JSON.stringify(n.input).slice(0, 90)}`);
}
const tally = (M) => { const t = { PASS: 0, PARTIAL: 0, FAIL: 0 }; for (const o of M.values()) t[o.verdict]++; return t; };
console.log('advisor:', (await (await import(pathToFileURL(resolve(mod)).href)).loadAdvisor()).label);
console.log('baseline', JSON.stringify(tally(A)), 'rows', A.size, '| new', JSON.stringify(tally(B)), 'rows', B.size);
console.log(`graded better=${better.length} worse=${worse.length} | rows whose input differs=${inputDiff.length} | rows whose reply text differs=${textDiff.length}`);
for (const w of worse) console.log(w);
console.log(`FAIL -> PASS (${failToPass.length}):`);
for (const f of failToPass) console.log(f);
console.log(worse.length ? `CP11 RUN FAIL: ${worse.length} row(s) graded worse` : 'CP11 RUN PASS: zero graded drops');
process.exit(worse.length ? 1 : 0);
