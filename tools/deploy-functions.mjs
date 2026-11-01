// Deploys Edge Functions from supabase/functions to the staging project and sets their secrets, every value read from the environment
// by name and printed nowhere (slice 4.2; tools/deploy-capture-lead.mjs generalised, that file stays as it is).
//   node tools/with-env.mjs "<env file>" -- node tools/deploy-functions.mjs --functions save,publish,lead-update,add-lead,upload-start,upload-finish
//        [--secrets GITHUB_DISPATCH_TOKEN,GITHUB_REPO] [--set GITHUB_REPO=owner/repo] [--secrets-only] [--deploy-only]
// Needs: SUPABASE_ACCESS_TOKEN (scoped: Edge Functions + Edge Function Secrets read-write, Project Settings read), STAGING_SUPABASE_REF.
// --functions a,b,c   each one is `supabase functions deploy <name> --project-ref <ref>` (verify_jwt comes from supabase/config.toml)
// --secrets A,B       secret names taken from the environment (default GITHUB_DISPATCH_TOKEN,GITHUB_REPO); a name missing in the
//                     environment is printed as `NOT SET (missing in the env): NAME` and skipped, never invented
// --set NAME=value    a NON-secret value given on the command line (only GITHUB_REPO, DASHBOARD_URL, DASHBOARD_ORIGINS, LEAD_ALERT_FROM are accepted:
//                     a secret never travels on a command line); it wins over the environment
// Secret values travel to the CLI through a temp env file that is deleted afterwards; the output is scrubbed of the token, the project
// ref and every secret value before it is printed.
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET_OK = ['GITHUB_REPO', 'DASHBOARD_URL', 'DASHBOARD_ORIGINS', 'LEAD_ALERT_FROM'];
const FN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const ref = process.env.STAGING_SUPABASE_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN (by name)'); process.exit(2); }

const functions = (opt('--functions') || '').split(',').map(s => s.trim()).filter(Boolean);
if (!argv.includes('--secrets-only') && !functions.length) { console.error('usage: --functions a,b,c [--secrets A,B] [--set NAME=value] [--secrets-only] [--deploy-only]'); process.exit(2); }
for (const f of functions) if (!FN.test(f)) { console.error(`not a function name: ${f}`); process.exit(2); }
const setValues = {};
for (let i = 0; i < argv.length; i++) if (argv[i] === '--set') {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/s.exec(argv[i + 1] || '');
  if (!m || !SET_OK.includes(m[1])) { console.error(`--set takes NAME=value for a non-secret name: ${SET_OK.join(', ')}`); process.exit(2); }
  setValues[m[1]] = m[2];
}
const secretNames = (opt('--secrets') || 'GITHUB_DISPATCH_TOKEN,GITHUB_REPO').split(',').map(s => s.trim()).filter(Boolean);
for (const n of secretNames) if (!/^[A-Z][A-Z0-9_]*$/.test(n)) { console.error(`not a secret name: ${n}`); process.exit(2); }
const valueOf = n => setValues[n] ?? process.env[n];
const wanted = [...new Set([...secretNames, ...Object.keys(setValues)])];
const secretValues = wanted.map(valueOf).filter(Boolean);

const scrub = s => { let t = String(s || '').split(token).join('<token>').split(ref).join('<project ref>'); for (const v of secretValues) if (v.length >= 6) t = t.split(v).join('<value>'); return t; };
const sb = args => { const r = spawnSync('supabase', args, { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, shell: process.platform === 'win32' }); return { status: r.status, out: scrub((r.stdout || '') + (r.stderr || '')) }; };
let failed = 0;

if (!argv.includes('--secrets-only')) {
  for (const name of functions) {
    const r = sb(['functions', 'deploy', name, '--project-ref', ref]);
    console.log(r.out.trim().split(/\r?\n/).filter(l => !/^npm notice/.test(l)).slice(-6).join('\n'));
    console.log(r.status === 0 ? `OK: ${name} deployed` : `FAIL: ${name} deploy exit ${r.status}`);
    if (r.status !== 0) failed++;
  }
}
if (!argv.includes('--deploy-only')) {
  const present = wanted.filter(n => valueOf(n));
  const missing = wanted.filter(n => !valueOf(n));
  if (missing.length) console.log(`NOT SET (missing in the env): ${missing.join(', ')}`);
  if (present.length) {
    const dir = mkdtempSync(join(tmpdir(), 'fn-secrets-')), f = join(dir, 'secrets.env');
    writeFileSync(f, present.map(n => `${n}=${valueOf(n)}`).join('\n') + '\n', 'utf8');
    try {
      const r = sb(['secrets', 'set', '--project-ref', ref, '--env-file', f]);
      console.log(r.out.trim().split(/\r?\n/).slice(-4).join('\n'));
      console.log(r.status === 0 ? `OK: secrets set by name: ${present.join(', ')}` : `FAIL: secrets exit ${r.status}`);
      if (r.status !== 0) failed++;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const l = sb(['secrets', 'list', '--project-ref', ref]);
  console.log('secrets on the project (names only):\n' + l.out.trim().split(/\r?\n/).filter(x => /^\s*[A-Z_]+\s*\|/.test(x)).map(x => '  ' + x.split('|')[0].trim()).join('\n'));
}
process.exit(failed ? 1 : 0);
