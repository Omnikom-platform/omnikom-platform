// inbox-state: what staging holds for one address, read only: is there a login, is it confirmed, how many memberships it has, and is each
// test site's lead alert list exactly that address. The run sheet of slice S1 reads it before and after a mail goes to the test inbox.
//   node tools/with-env.mjs "<env file>" -- node supabase/ops/inbox-state.mjs --email <address>
// The database is STAGING_DB_URL and must name STAGING_SUPABASE_REF (stagingDbUrl, supabase/tests/e2e-cleanup.mjs: anything else, production
// included, is refused); one read-only transaction (psqlReadOnly, promote-check.mjs). It prints no address, no id, no key and no URL.
// Exit 0 read; 2 wrong use, refused or unreadable; 3 BLOCKED (STAGING_SUPABASE_REF or STAGING_DB_URL not set).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { psqlReadOnly } from './promote-check.mjs';
import { stagingDbUrl } from '../tests/e2e-cleanup.mjs';
import { lit } from '../../tools/omnikom-cli/lib/sql.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUGS = ['test-demo-a', 'test-demo-b'];   // the two test sites (tools/omnikom-cli/commands/seed.mjs)

export const SQL = email => `with me as (select u.id, u.email_confirmed_at from auth.users u where lower(u.email) = lower(${lit(email)}))
select json_build_object('login', exists (select 1 from me), 'confirmed', (select bool_or(me.email_confirmed_at is not null) from me),
  'memberships', (select count(*) from public.members m where m.user_id in (select id from me)),
  'alerts', (select coalesce(json_object_agg(w.slug, coalesce(array_length(s.lead_alert_to, 1) = 1 and lower(s.lead_alert_to[1]) = lower(${lit(email)}), false)), '{}'::json)
    from public.sites s join public.workspaces w on w.id = s.workspace_id where w.slug in ('test-demo-a', 'test-demo-b')));`;

export function main(argv, env = process.env, log = console.log, err = console.error, exec = psqlReadOnly) {
  const email = argv.length === 2 && argv[0] === '--email' ? String(argv[1]).trim() : '';
  if (!EMAIL.test(email)) { err('usage: inbox-state.mjs --email <address> (one address; it is never printed)'); return 2; }
  let url;
  try { url = stagingDbUrl(env); } catch (e) {
    if (String(e.message).startsWith('BLOCKED')) { err('BLOCKED: set STAGING_SUPABASE_REF and STAGING_DB_URL (read by name)'); return 3; }
    err(String(e.message)); return 2;
  }
  let r;
  try { r = JSON.parse(exec(url, SQL(email))); } catch (e) { err(`cannot read STAGING_DB_URL: ${String(e.message).split(email).join('<the address>').slice(0, 300)}`); return 2; }
  const yn = b => (b ? 'yes' : 'no');
  log(`login: ${yn(r.login)}`);
  log(`confirmed: ${r.login ? yn(r.confirmed) : '-'}`);
  log(`memberships: ${Number(r.memberships)}`);
  for (const s of SLUGS) log(`alerts ${s}: ${s in r.alerts ? yn(r.alerts[s]) : 'no site'}`);
  log('OK: one address read on STAGING_DB_URL (read only)');
  return 0;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
