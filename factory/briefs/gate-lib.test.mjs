// Runs the head's land-script gate test (factory/briefs/gate-lib.test.sh) so run-all-gates.mjs can name it: exit with its code.
//   node factory/briefs/gate-lib.test.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const r = spawnSync('bash', [join(dirname(fileURLToPath(import.meta.url)), 'gate-lib.test.sh')], { stdio: 'inherit', timeout: 120000, windowsHide: true });
if (r.error) console.error(`gate-lib.test.sh could not run: ${r.error.code || r.error.message}`);
process.exit(r.status === null ? 1 : r.status);
