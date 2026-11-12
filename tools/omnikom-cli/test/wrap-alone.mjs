// Runs ONLY test/wrap.mjs and test/registry.mjs (the registry and the thin wrap, P3.3 B1), not the rest of run.mjs --unit: those files have no main of their own.
//   node tools/omnikom-cli/test/wrap-alone.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// It runs the CLI tree it sits in (OMNIKOM_CLI_DIR points it at a copy, as for run.mjs). No database, no network: a fake script in a temp folder plays the tool.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.OMNIKOM_CLI_DIR = cliDir;
const at = f => import(pathToFileURL(join(cliDir, f)).href);
const { cli, CLI_ROOT, REPO_ROOT } = await at('test/harness.mjs');
const { makeCheck } = await at('test/mutate-run.mjs');
const { wrapTests } = await at('test/wrap.mjs');
const { registryTests } = await at('test/registry.mjs');
const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time') });
await wrapTests({ check, cli, CLI_ROOT, REPO_ROOT, lib: f => at(join('lib', f)) });
await registryTests({ check, cli, CLI_ROOT, REPO_ROOT, lib: f => at(join('lib', f)) });
const c = counts();
console.log(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED`);
process.exit(c.failed ? 1 : 0);
