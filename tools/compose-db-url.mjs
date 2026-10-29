// Composes the staging connection strings from the database password in the owner's accounts note, without the password ever
// reaching the model: reads the note's "DB Password:" line, percent-encodes it, fills the templates the Connect dialog shows
// (read 2026-10-29: transaction pooler aws-1-us-west-2:6543, session pooler :5432; the direct host is IPv6-only on Free) and
// banks STAGING_DB_PASSWORD, STAGING_DB_URL (transaction pooler) and STAGING_DB_URL_DIRECT (session pooler, for migrations)
// into the env file. Prints names and lengths only.
//   node tools/compose-db-url.mjs --note "<accounts note>" --env "<env file>" --ref <project ref> --pooler-host aws-1-us-west-2.pooler.supabase.com
import { readFileSync } from 'node:fs';
import { bank } from './lib/bank.mjs';

const argv = process.argv.slice(2);
const after = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const note = after('--note'), env = after('--env'), ref = after('--ref'), host = after('--pooler-host');
if (!note || !env || !ref || !host) { console.error('usage: --note <file> --env <file> --ref <project ref> --pooler-host <host>'); process.exit(2); }
if (!/^[a-z]{20}$/.test(ref)) { console.error('ref does not look like a project ref'); process.exit(2); }

const line = readFileSync(note, 'utf8').split(/\r?\n/).find(l => /^\s*DB Password\s*:/i.test(l));
if (!line) { console.error('no "DB Password:" line in the note'); process.exit(1); }
const pw = line.slice(line.indexOf(':') + 1).trim();
if (pw.length < 8) { console.error(`the password line is too short (${pw.length} chars)`); process.exit(1); }
const enc = encodeURIComponent(pw);
const results = [
  bank(env, 'STAGING_DB_PASSWORD', pw, undefined, 8),
  bank(env, 'STAGING_DB_URL', `postgresql://postgres.${ref}:${enc}@${host}:6543/postgres?sslmode=require`),
  bank(env, 'STAGING_DB_URL_DIRECT', `postgresql://postgres.${ref}:${enc}@${host}:5432/postgres?sslmode=require`),
];
for (const r of results) console.log(r.ok ? `saved ${r.name} (${r.length} chars)` : `NOT SAVED: ${r.error}`);
process.exitCode = results.every(r => r.ok) ? 0 : 1;
