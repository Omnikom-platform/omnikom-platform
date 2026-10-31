// Stands in for `gh` in the tests of tools/github-secrets.mjs (it runs `node <this file> secret set|list ...` when GH_SCRIPT is set).
// Appends one JSON line per call to GH_RECORD: { argv, stdin }. `secret list` prints the names set so far, tab separated like gh.
// GH_FAIL_SET=<NAME> makes `secret set <NAME>` fail and echo the value to stderr (to prove the tool scrubs it).
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
let stdin = '';
if (argv[0] === 'secret' && argv[1] === 'set') { try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; } }
appendFileSync(process.env.GH_RECORD, JSON.stringify({ argv, stdin }) + '\n');
if (argv[0] === 'secret' && argv[1] === 'set') {
  if (process.env.GH_FAIL_SET === argv[2]) { console.error(`HTTP 403 for ${argv[2]}: could not encrypt ${stdin}`); process.exit(1); }
  process.exit(0);
}
if (argv[0] === 'secret' && argv[1] === 'list') {
  const seen = existsSync(process.env.GH_RECORD) ? readFileSync(process.env.GH_RECORD, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.argv[1] === 'set').map((r) => r.argv[2]) : [];
  for (const n of [...new Set(seen)]) console.log(`${n}\t2026-10-31T00:00:00Z`);
  process.exit(0);
}
process.exit(3);
