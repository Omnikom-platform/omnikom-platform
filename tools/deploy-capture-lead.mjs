// Deploys supabase/functions/capture-lead to the staging project and sets its secrets, every value read from the environment
// by name and printed nowhere (25-BUILD-SEQUENCE step 2.3).
//   node tools/with-env.mjs "<env file>" -- node tools/deploy-capture-lead.mjs [--secrets-only] [--deploy-only]
// Needs: SUPABASE_ACCESS_TOKEN (scoped: Edge Functions + Edge Function Secrets read-write, Project Settings read),
// STAGING_SUPABASE_REF; for the secrets RESEND_API_KEY and LEAD_ALERT_FROM (DASHBOARD_URL optional). A missing secret is
// reported and skipped, never invented. Secret values travel to the CLI through a temp env file that is deleted afterwards.
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.env.STAGING_SUPABASE_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN (by name)'); process.exit(2); }
const argv = process.argv.slice(2);
const scrub = s => String(s || '').split(token).join('<token>').split(ref).join('<project ref>');   // the CLI prints the ref inside its dashboard link
const sb = args => { const r = spawnSync('supabase', args, { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, shell: process.platform === 'win32' }); return { status: r.status, out: scrub(r.stdout) + scrub(r.stderr) }; };
let failed = 0;

if (!argv.includes('--secrets-only')) {
  const r = sb(['functions', 'deploy', 'capture-lead', '--project-ref', ref]);
  console.log(r.out.trim().split(/\r?\n/).filter(l => !/^npm notice/.test(l)).slice(-8).join('\n'));
  console.log(r.status === 0 ? 'OK: capture-lead deployed' : `FAIL: deploy exit ${r.status}`);
  if (r.status !== 0) failed++;
}
if (!argv.includes('--deploy-only')) {
  const names = ['RESEND_API_KEY', 'LEAD_ALERT_FROM', 'DASHBOARD_URL'].filter(n => process.env[n]);
  const missing = ['RESEND_API_KEY', 'LEAD_ALERT_FROM'].filter(n => !process.env[n]);
  if (missing.length) console.log(`NOT SET (missing in the env): ${missing.join(', ')}`);
  if (names.length) {
    const dir = mkdtempSync(join(tmpdir(), 'fn-secrets-')), f = join(dir, 'secrets.env');
    writeFileSync(f, names.map(n => `${n}=${process.env[n]}`).join('\n') + '\n', 'utf8');
    try {
      const r = sb(['secrets', 'set', '--project-ref', ref, '--env-file', f]);
      console.log(r.out.trim().split(/\r?\n/).slice(-4).join('\n'));
      console.log(r.status === 0 ? `OK: secrets set by name: ${names.join(', ')}` : `FAIL: secrets exit ${r.status}`);
      if (r.status !== 0) failed++;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const l = sb(['secrets', 'list', '--project-ref', ref]);
  console.log('secrets on the project (names only):\n' + l.out.trim().split(/\r?\n/).filter(l => /^\s*[A-Z_]+\s*\|/.test(l)).map(l => '  ' + l.split('|')[0].trim()).join('\n'));
}
process.exit(failed ? 1 : 0);
