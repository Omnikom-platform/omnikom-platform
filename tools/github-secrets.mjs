// Sets GitHub repository secrets from the environment, by name; no value is printed, logged or put on a command line.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/github-secrets.mjs --repo <owner/repo> --names A,B,C [--dry-run]
// For each name present in the environment: `gh secret set <NAME> -R <repo>` with the value on STDIN (never argv). A name missing from
// the environment is printed as `NOT SET (missing in the env): <NAME>` and skipped. --dry-run prints `WOULD SET: <NAME>` (names only) and
// changes nothing. PLATFORM_FUNCTIONS_BASE is DERIVED when absent: https://<STAGING_SUPABASE_REF>.supabase.co/functions/v1.
// Afterwards `gh secret list` prints the NAMES now on the repository. Exit 0 ok, 1 a set or the list failed, 2 usage.
// GH_SCRIPT (a node script standing in for gh) exists for tests only. Needs the owner's `gh auth login` (repo + secrets scope).
import { spawnSync } from 'node:child_process';

const USAGE = 'usage: node tools/with-env.mjs <env file> -- node tools/github-secrets.mjs --repo <owner/repo> --names A,B,C [--dry-run]';
const argv = process.argv.slice(2);
const opts = { dry: false };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dry-run') opts.dry = true;
  else if (argv[i] === '--repo' && argv[i + 1]) opts.repo = argv[++i];
  else if (argv[i] === '--names' && argv[i + 1]) opts.names = argv[++i];
  else { console.error(`unknown or incomplete argument ${argv[i]}\n${USAGE}`); process.exit(2); }
}
if (!opts.repo || !opts.names) { console.error(USAGE); process.exit(2); }
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opts.repo)) { console.error('--repo must be owner/name'); process.exit(2); }
const names = [...new Set(opts.names.split(',').map((n) => n.trim()).filter(Boolean))];
const badName = names.find((n) => !/^[A-Z][A-Z0-9_]*$/.test(n) || n.startsWith('GITHUB_'));
if (!names.length || badName) { console.error(`secret names are UPPER_SNAKE and may not start with GITHUB_ (${badName || 'none given'})`); process.exit(2); }

const env = { ...process.env };
if (names.includes('PLATFORM_FUNCTIONS_BASE') && !env.PLATFORM_FUNCTIONS_BASE && env.STAGING_SUPABASE_REF) {
  env.PLATFORM_FUNCTIONS_BASE = `https://${env.STAGING_SUPABASE_REF}.supabase.co/functions/v1`;
  console.log('DERIVED: PLATFORM_FUNCTIONS_BASE from STAGING_SUPABASE_REF');
}

const values = names.map((n) => env[n]).filter((v) => v && v.length >= 4).sort((a, b) => b.length - a.length);
const scrub = (s) => values.reduce((t, v) => t.split(v).join('<secret>'), String(s || ''));
const gh = (args, input) => {
  const [cmd, a] = process.env.GH_SCRIPT ? [process.execPath, [process.env.GH_SCRIPT, ...args]] : ['gh', args];
  const r = spawnSync(cmd, a, { input, encoding: 'utf8', timeout: 60000, windowsHide: true, shell: false });
  return { status: r.status, out: scrub(r.stdout), err: scrub(r.stderr), error: r.error ? scrub(r.error.message) : null };
};

let failed = 0;
for (const name of names) {
  const value = env[name];
  if (!value) { console.log(`NOT SET (missing in the env): ${name}`); continue; }
  if (opts.dry) { console.log(`WOULD SET: ${name}`); continue; }
  const r = gh(['secret', 'set', name, '-R', opts.repo], value);   // the value goes on stdin, never argv
  if (r.status === 0) console.log(`SET: ${name}`);
  else { failed++; console.log(`FAILED: ${name} (gh exit ${r.status}${r.error ? `, ${r.error}` : ''}) ${r.err.trim().split(/\r?\n/)[0] || ''}`); }
}

const l = gh(['secret', 'list', '-R', opts.repo]);
if (l.status !== 0) { failed++; console.log(`FAILED: gh secret list (exit ${l.status}) ${l.err.trim().split(/\r?\n/)[0] || l.error || ''}`); }
else {
  const listed = l.out.split(/\r?\n/).map((x) => x.split(/\s+/)[0]).filter((x) => /^[A-Z][A-Z0-9_]*$/.test(x));
  console.log(`secrets on ${opts.repo} (names only):${listed.length ? '\n' + listed.map((x) => `  ${x}`).join('\n') : ' none'}`);
}
process.exit(failed ? 1 : 0);
