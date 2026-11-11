// Runs ONLY test/seo-run.mjs (the `omnikom seo` tests), not the rest of run.mjs --unit: that file has no main of its own.
//   node tools/omnikom-cli/test/seo-run-alone.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// It runs the CLI tree it sits in (OMNIKOM_CLI_DIR points it at a copy, as for run.mjs). No database, no network beyond a fake site on 127.0.0.1.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.OMNIKOM_CLI_DIR = cliDir;
const at = f => import(pathToFileURL(join(cliDir, f)).href);
const { cli, CLI_ROOT, REPO_ROOT } = await at('test/harness.mjs');
const { makeCheck } = await at('test/mutate-run.mjs');
const { seoRunTests } = await at('test/seo-run.mjs');
const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time') });
await seoRunTests({ check, cli, CLI_ROOT, REPO_ROOT, lib: f => at(join('lib', f)) });
const c = counts();
console.log(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED`);
process.exit(c.failed ? 1 : 0);
