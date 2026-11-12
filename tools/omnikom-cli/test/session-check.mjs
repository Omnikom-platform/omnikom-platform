// Tests for the session kinds (P3.2 B2): tools/omnikom-cli/sessions/kinds.json (each kind of session and headless helper) and
// tools/omnikom-cli/sessions/headless-helper.settings.json (the one setting a headless start is given).
//   node tools/omnikom-cli/test/session-check.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// No database, no network, nothing written: the two files are read from <CLI_ROOT>/sessions only, so test/mutate.mjs can run this file against a
// broken COPY of the CLI. A missing or unreadable file is the FAIL of the case that reads it, never a crash of this file. Each expected object is
// written in the key order of the file (the comparison is JSON.stringify against JSON.stringify).
import { readFileSync, realpathSync, writeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function sessionCheckTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  void cli; void REPO_ROOT; void lib;
  const dir = join(CLI_ROOT, 'sessions');
  const readJson = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  // sc: one case in a try; fn returns [true | false, what was found]
  const sc = (name, fn) => {
    let ok = false, detail = '';
    try {
      const [good, info] = fn();
      ok = good === true;
      detail = ok ? '' : JSON.stringify(info === undefined ? null : info);
    } catch (e) { detail = `threw ${e && e.name}: ${e && e.message}`; }
    check(`session-check: ${name}`, ok, detail);
  };
  const KINDS = 'kinds.json';
  // the head and the lane are the same kind of session but for the name form
  const interactive = nameForm => ({ model: 'claude-fable-5-2', effort: 'xhigh', window: 600000, remoteControl: true, permissionMode: 'bypassPermissions', nameForm });

  sc('K1 kinds.json: its keys are head, helper, lane and note, nothing else (D3)', () => {
    const keys = Object.keys(readJson(KINDS)).sort();
    return [same(keys, ['head', 'helper', 'lane', 'note']), keys];
  });

  sc('K2 kinds.json: the head is Fable 5.2 at xhigh, window 600000, Remote Control on, bypassPermissions, its name form (D1, D3)', () => {
    const head = readJson(KINDS).head;
    return [same(head, interactive('HEAD-OF-OPERATIONS_<Model>_<date>')), head];
  });

  sc('K3 kinds.json: the lane is the head\'s kind with the lane name form (D1, D3)', () => {
    const lane = readJson(KINDS).lane;
    return [same(lane, interactive('LANE_<area>_<date>')), lane];
  });

  sc('K4 kinds.json: a headless helper has no model or effort, window 600000, Remote Control off, a permission mode, a turn limit and a time limit (D2, D3)', () => {
    const helper = readJson(KINDS).helper;
    const want = { window: 600000, remoteControl: false, permissionMode: 'bypassPermissions', maxTurns: 200, timeoutMinutes: 120, nameForm: 'JOB_<job id>_<HHMM>' };
    return [same(helper, want), helper];
  });

  sc('K5 headless-helper.settings.json: the one key remoteControlAtStartup, false (D2)', () => {
    const settings = readJson('headless-helper.settings.json');
    return [same(settings, { remoteControlAtStartup: false }), settings];
  });
}

// run alone: node tools/omnikom-cli/test/session-check.mjs [--bail] [--time]   (OMNIKOM_CLI_DIR points it at a copy of the CLI, as for run.mjs)
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.env.OMNIKOM_CLI_DIR = cliDir;
  const repoRoot = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(cliDir, '..', '..');
  const at = f => import(pathToFileURL(join(cliDir, f)).href);
  const { makeCheck } = await at('test/mutate-run.mjs');
  // every line is written synchronously: a piped stdout on Windows is async and process.exit would cut the last lines
  const say = text => { try { writeSync(1, text); } catch { process.stdout.write(text); } };
  const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time'), out: line => say(`${line}\n`) });
  await sessionCheckTests({ check, CLI_ROOT: cliDir, REPO_ROOT: repoRoot, lib: f => at(join('lib', f)) });
  const c = counts();
  say(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED\n`);
  process.exit(c.failed ? 1 : 0);
}
