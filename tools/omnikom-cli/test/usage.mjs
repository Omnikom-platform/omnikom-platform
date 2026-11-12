// Tests for `omnikom usage rate` and `omnikom usage fit` (P3.2 B5): commands/usage.mjs (the weekly meter: the rate over the last 30 minutes of
// readings against the pace that leaves 2 points at the reset; the fit: points per list dollar per model, least squares).
//   node tools/omnikom-cli/test/usage.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// No database, no network, no real meter log: every log, machine file and windows file is a file of this test, in one temp folder, and every
// case sets OMNIKOM_MACHINE_FILE. The clock is a number of seconds the case hands to the CLI (deps.now). The code under test is reached only through
// `cli`, so test/mutate.mjs can run this file against a broken COPY of the CLI.
import { mkdtempSync, writeFileSync, rmSync, realpathSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function usageTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  void CLI_ROOT; void REPO_ROOT; void lib;
  const root = mkdtempSync(join(tmpdir(), 'omnikom-usage-'));
  try {
    // L: one reading of the meter log, as the log holds it ("HH:MM:SS {json}"); 1794412800 is 2026-11-11 16:00 UTC
    const L = (hhmm, p, reset = 1794412800) => `${hhmm}:00 {"updated":"2026-11-11T${hhmm}:00Z","seven_day":{"used_percentage":${p},"resets_at":${reset}}}`;
    // T: seconds since the epoch of a time on 2026-11-11 (UTC)
    const T = x => Date.parse('2026-11-11T' + x + ':00Z') / 1000;
    const RS = ['# header', L('10:00', 60), L('10:05', 62), L('10:10', 15), L('10:15', 18), L('10:20', 17), L('10:25', 21), L('10:30', 24)];
    const SL = [...RS, L('10:35', 23)];
    const IN = [L('10:00', 20), L('10:30', 21)];
    const MG = [L('10:00', 89, 1794409200), L('10:30', 90, 1794409200)];
    const NR = [L('10:00', 60), L('10:05', 62), L('10:10', 15)];

    // a machine file naming a log of these lines; -> the environment a case passes (never the real machine file)
    const put = (name, lines) => {
      const log = join(root, `${name}.log`);
      const machine = join(root, `${name}.machine.json`);
      writeFileSync(log, lines.join('\n') + '\n');
      writeFileSync(machine, JSON.stringify({ usageMeterLog: log }));
      return { OMNIKOM_MACHINE_FILE: machine };
    };
    const putFile = (name, text) => { const f = join(root, name); writeFileSync(f, text); return f; };
    const EMPTY = (() => { const machine = join(root, 'empty.machine.json'); writeFileSync(machine, '{}'); return { OMNIKOM_MACHINE_FILE: machine }; })();
    const run = (argv, env, nowSeconds) => cli(argv, env, { now: () => nowSeconds });
    const shown = r => ({ exit: r.exit, code: r.json && r.json.code, error: r.json && r.json.error, data: r.json && r.json.data, target: r.json && r.json.target });
    const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 1e-9;

    // uc: one case in a try; fn returns [true | false, what was found]
    const uc = async (name, fn) => {
      let ok = false, detail = '';
      try {
        const [good, info] = await fn();
        ok = good === true;
        detail = ok ? '' : JSON.stringify(info === undefined ? null : info);
      } catch (e) { detail = `threw ${e && e.name}: ${e && e.message}`; }
      check(`usage: ${name}`, ok, detail);
    };

    await uc('U1 rate: a reset is not the rate, the 17 after 18 is ignored; 27 points/h against a pace of 13.5 is OVER, exit 1 (M2, M3, M6)', async () => {
      const r = await run(['usage', 'rate'], put('rs', RS), T('10:31'));
      const d = r.json && r.json.data;
      return [r.exit === 1 && r.json.code === 'OVER' && d.percent === 24 && d.pointsPerHour === 27 && d.pacePointsPerHour === 13.5 && d.resetInHours === 5.48, shown(r)];
    });

    await uc('U2 rate: a stale lower reading (23 after 24) is ignored, 24% and 21.6 points/h (M3)', async () => {
      const r = await run(['usage', 'rate'], put('sl', SL), T('10:36'));
      const d = r.json && r.json.data;
      return [r.exit === 1 && d.percent === 24 && d.pointsPerHour === 21.6, shown(r)];
    });

    await uc('U3 rate: a newest reading 40 minutes old is BLOCKED, exit 3 (M5)', async () => {
      const r = await run(['usage', 'rate'], put('rs3', RS), T('11:10'));
      return [r.exit === 3 && r.json.code === 'BLOCKED' && r.json.error === 'the newest reading is 40 minutes old', shown(r)];
    });

    await uc('U4 rate: inside the pace is exit 0, code ok, 21% at 2 points/h, and it names no target (M6, X3)', async () => {
      const r = await run(['usage', 'rate'], put('in', IN), T('10:31'));
      const d = r.json && r.json.data;
      return [r.exit === 0 && r.json.code === 'ok' && d.percent === 21 && d.pointsPerHour === 2 && d.over === false && r.json.target === undefined, shown(r)];
    });

    await uc('U5 rate: the pace leaves 2 points at the reset (1.8 points/h), so 2 points/h is OVER, exit 1 (M6)', async () => {
      const r = await run(['usage', 'rate'], put('mg', MG), T('10:31'));
      const d = r.json && r.json.data;
      return [r.exit === 1 && d.pacePointsPerHour === 1.8, shown(r)];
    });

    await uc('U6 rate: one reading after the last reset gives no rate yet, BLOCKED, exit 3 (M4)', async () => {
      const r = await run(['usage', 'rate'], put('nr', NR), T('10:11'));
      return [r.exit === 3 && r.json.error === 'only 1 reading(s) after the last reset: no rate yet', shown(r)];
    });

    await uc('U7 usage: the wrong uses are exit 2 with their own texts, and a machine file with no usageMeterLog is BLOCKED, exit 3 (X1, X2, X3)', async () => {
      const a = await run(['usage'], EMPTY, T('10:31'));
      const b = await run(['usage', 'rate', 'x'], EMPTY, T('10:31'));
      const c = await run(['usage', 'rate', '--window', '5'], EMPTY, T('10:31'));
      const d = await run(['usage', 'fit'], EMPTY, T('10:31'));
      const e = await run(['usage', 'rate'], EMPTY, T('10:31'));
      const good = a.exit === 2 && a.json.error === 'usage <rate | fit --windows <file>>'
        && b.exit === 2 && b.json.error === "usage rate: unexpected argument 'x'"
        && c.exit === 2 && c.json.error === 'usage rate takes no --window'
        && d.exit === 2 && d.json.error === '--windows <file> must be a readable JSON file'
        && e.exit === 3 && typeof e.json.error === 'string' && e.json.error.includes('has no "usageMeterLog"');
      return [good, [a, b, c, d, e].map(shown)];
    });

    const W1 = { points: 1.4, usd: { 'claude-opus-5-5': 20, 'claude-sonnet-5-5': 10 } };
    const W2 = { points: 2.05, usd: { 'claude-opus-5-5': 5, 'claude-sonnet-5-5': 30, 'claude-fable-5-2': 10 } };
    const W3 = { points: 1.4, usd: { 'claude-fable-5-2': 20, 'claude-sonnet-5-5': 5 } };

    await uc('U8 fit: three windows give the points per list dollar of each model (opus 0.05, sonnet 0.04, fable 0.06) (F3)', async () => {
      const f = putFile('u8.json', JSON.stringify([W1, W2, W3]));
      const r = await run(['usage', 'fit', '--windows', f], EMPTY, T('10:31'));
      const d = r.json && r.json.data;
      const p = d && d.pointsPerDollar;
      return [r.exit === 0 && d.windows === 3 && Boolean(p) && near(p['claude-opus-5-5'], 0.05) && near(p['claude-sonnet-5-5'], 0.04) && near(p['claude-fable-5-2'], 0.06), shown(r)];
    });

    await uc('U9 fit: two windows are BLOCKED, exit 3 (F2)', async () => {
      const f = putFile('u9.json', JSON.stringify([W1, W2]));
      const r = await run(['usage', 'fit', '--windows', f], EMPTY, T('10:31'));
      return [r.exit === 3 && r.json.error === 'the fit needs at least 3 windows; it has 2', shown(r)];
    });

    await uc('U10 fit: three windows of one mix cannot tell the models apart, BLOCKED, exit 3 (F3)', async () => {
      const same = (o, s) => ({ 'claude-opus-5-5': o, 'claude-sonnet-5-5': s });
      const f = putFile('u10.json', JSON.stringify([{ points: 0.9, usd: same(10, 10) }, { points: 1.8, usd: same(20, 20) }, { points: 0.45, usd: same(5, 5) }]));
      const r = await run(['usage', 'fit', '--windows', f], EMPTY, T('10:31'));
      return [r.exit === 3 && r.json.error === 'the windows do not tell the models apart: each model needs a mix of its own', shown(r)];
    });

    await uc('U11 fit: a window with a points that is no number, and a file that is no JSON, are exit 2 with their texts (F1, X2)', async () => {
      const bad = putFile('u11a.json', '[{"points":"x","usd":{}}]');
      const junk = putFile('u11b.json', 'not json');
      const a = await run(['usage', 'fit', '--windows', bad], EMPTY, T('10:31'));
      const b = await run(['usage', 'fit', '--windows', junk], EMPTY, T('10:31'));
      const good = a.exit === 2 && a.json.error === '--windows must be a JSON array of { "points": <number>, "usd": { "<model>": <dollars> } }'
        && b.exit === 2 && b.json.error === '--windows <file> must be a readable JSON file';
      return [good, [a, b].map(shown)];
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

// run alone: node tools/omnikom-cli/test/usage.mjs [--bail] [--time]   (OMNIKOM_CLI_DIR points it at a copy of the CLI, as for run.mjs)
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.env.OMNIKOM_CLI_DIR = cliDir;
  const repoRoot = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(cliDir, '..', '..');
  const at = f => import(pathToFileURL(join(cliDir, f)).href);
  const { makeCheck } = await at('test/mutate-run.mjs');
  const { cli } = await at('test/harness.mjs');
  // every line is written synchronously: a piped stdout on Windows is async and process.exit would cut the last lines
  const say = text => { try { writeSync(1, text); } catch { process.stdout.write(text); } };
  const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time'), out: line => say(`${line}\n`) });
  await usageTests({ check, cli, CLI_ROOT: cliDir, REPO_ROOT: repoRoot, lib: f => at(join('lib', f)) });
  const c = counts();
  say(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED\n`);
  process.exit(c.failed ? 1 : 0);
}
