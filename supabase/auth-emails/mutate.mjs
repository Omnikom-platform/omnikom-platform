// Mutants for supabase/auth-emails/check.mjs: each copies the emails (and the plan and settings checker) to a temp folder, makes one
// change, and expects the check to fail. Every target must occur exactly once in its file.
//   node supabase/auth-emails/mutate.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC = { plan: join(ROOT, 'docs/blueprint/16-DESIGN-PARTS.md'), settings: join(ROOT, 'supabase/check-auth-settings.mjs'), dashboard: join(ROOT, 'docs/blueprint/04-DASHBOARD.md') };

// [name, file (relative to the emails folder, or 'plan' / 'settings' / 'dashboard'), from, to]
const MUTANTS = [
  ['the link life says 1 hour', 'magic-link.html', 'The link works for 10 minutes and only once.', 'The link works for 1 hour and only once.'],
  ['a line outside any plan row', 'magic-link.html', '<p data-plan="DP-email-03" style="margin:0 0 24px">', '<p style="margin:0 0 24px">'],
  ['a made-up line', 'invite.html', '<p data-plan="DP-email-06" style="margin:0 0 32px">If you did', '<p data-plan="DP-email-06" style="margin:0 0 32px">We never share your address. If you did'],
  ['the sign-in link has the wrong type', 'magic-link.html', '&type=magiclink"', '&type=email"'],
  ['the invite link goes elsewhere', 'invite.html', 'href="{{ .SiteURL }}/auth/confirm?', 'href="https://example.com/auth/confirm?'],
  ['a data-plan id that names no row', 'invite.html', 'data-plan="DP-email-12"', 'data-plan="DP-email-99"'],
  ['a plan row nothing carries', 'invite.html', '<tr><td><p data-plan="DP-email-12" style="margin:0 0 8px">After that, ask for a sign-in link with this address at {{ .SiteURL }}/login.</p></td></tr>\n', ''],
  ['the subject is not its row', 'emails.json', '"subject": "Your sign-in link for the Omnikom dashboard"', '"subject": "Your magic link"'],
  ['the link life in emails.json differs from the settings', 'emails.json', '"link_life_seconds": 600', '"link_life_seconds": 3600'],
  ['the settings expect another link life', 'settings', "(owner 2026-10-31: 10 minutes)', 600,", "(owner 2026-10-31: 10 minutes)', 3600,"],
  ['the sender name differs from the settings', 'emails.json', '"name": "Omnikom Dashboard"', '"name": "Omnikom Platform"'],
  ['the identity block is not its row', 'magic-link.html', 'Sent by Omnikom, omnikom.io', 'Sent by Omnikom Inc., omnikom.io'],
  ['the title is not the heading', 'magic-link.html', '<title>Sign in to the Omnikom dashboard</title>', '<title>Sign in now</title>'],
  ['04-DASHBOARD gives invites another life', 'dashboard', 'an invite is a sign-in link; it lives 10 minutes;', 'an invite is a sign-in link; it lives 7 days;'],
  ['the plan row words changed', 'plan', '| "Sign in to the Omnikom dashboard" |', '| "Sign in to Omnikom" |'],
];

const run = (dir, plan, settings, dashboard) => spawnSync(process.execPath, [join(HERE, 'check.mjs'), '--dir', dir, '--plan', plan, '--settings', settings, '--dashboard', dashboard], { encoding: 'utf8', timeout: 60000 });

const tmp = mkdtempSync(join(tmpdir(), 'auth-emails-mut-'));
let survived = 0, missing = 0;
try {
  const base = run(HERE, SRC.plan, SRC.settings, SRC.dashboard);
  if (base.status !== 0) { console.log(`the real files do not pass; nothing to measure:\n${base.stdout}`); process.exit(1); }
  MUTANTS.forEach(([name, file, from, to], i) => {
    const dir = join(tmp, `m${i}`);
    cpSync(HERE, dir, { recursive: true });
    const plan = join(dir, '_plan.md'), settings = join(dir, '_settings.mjs'), dashboard = join(dir, '_dashboard.md');
    writeFileSync(dashboard, readFileSync(SRC.dashboard, 'utf8'));
    writeFileSync(plan, readFileSync(SRC.plan, 'utf8'));
    writeFileSync(settings, readFileSync(SRC.settings, 'utf8'));
    const target = file === 'plan' ? plan : file === 'settings' ? settings : file === 'dashboard' ? dashboard : join(dir, file);
    const text = readFileSync(target, 'utf8');
    const n = text.split(from).length - 1;
    if (n !== 1) { console.log(`MUTANT TARGET ${n ? 'NOT UNIQUE' : 'MISSING'}: ${name}`); missing++; return; }
    writeFileSync(target, text.split(from).join(to));
    const r = run(dir, plan, settings, dashboard);
    const why = (r.stdout.split('\n').find(l => l.startsWith('FAIL ')) || '').slice(0, 110);
    if (r.status === 1) console.log(`caught   ${name.padEnd(52)} ${why}`);
    else { survived++; console.log(`SURVIVED ${name} (exit ${r.status})`); }
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${survived || missing ? 'FAILED' : 'OK'}: ${MUTANTS.length} mutants, ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} without a target`);
process.exit(survived || missing ? 1 : 0);
