// Runs a command with the variables of an env file loaded, by name, never printed. Also sets OMNIKOM_ENV_FILE to the file.
//   node tools/with-env.mjs "<env file>" -- <command> [args...]
// Lines are NAME=value; blank lines and # comments are skipped; existing environment wins over the file only for PATH-like
// system variables (the file's names are all upper-case platform names, so nothing of the system is overwritten by design).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const file = argv[0];
if (!file || sep < 1 || sep === argv.length - 1) { console.error('usage: node tools/with-env.mjs <env file> -- <command> [args...]'); process.exit(2); }
const env = { ...process.env, OMNIKOM_ENV_FILE: file };
for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const [cmd, ...args] = argv.slice(sep + 1);
const r = spawnSync(cmd, args, { stdio: 'inherit', env, timeout: 10 * 60 * 1000, shell: false, windowsHide: true });
if (r.error) { console.error(`could not start ${cmd}: ${r.error.message}`); process.exit(127); }
process.exit(r.status ?? 1);
