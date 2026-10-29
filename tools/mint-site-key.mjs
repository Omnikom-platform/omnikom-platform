// Mint a site's lead signing key: 32 random bytes as hex. The value goes to exactly two places and is printed nowhere:
//   1. the project's Vault (vault.create_secret) under the name site-<slug>-key-<n>, and the api_keys registry row
//      (kind site-signing, the sha256 of the key, the Vault name, the site id) so capture-lead can verify it;
//   2. the owner's master .env (the file named by OMNIKOM_ENV_FILE), appended as SITE_SIGNING_KEY_<SLUG>=..., so the owner can
//      set it on the site's Pages project with `wrangler pages secret put SITE_SIGNING_KEY --project-name <name>`.
//   STAGING_DB_URL=... OMNIKOM_ENV_FILE=... node tools/mint-site-key.mjs --site <sites.id uuid> --slug elev8 [--n 1] [--dry-run]
// A second active key for the same site is allowed on purpose (rotation: both verify until the old one is revoked by staff).
// Status: UNPROVEN on a real project (no project yet, W0.3). Needs vault.create_secret, which exists on Supabase projects.
import { randomBytes, createHash } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const after = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const site = after('--site'), slug = after('--slug'), n = after('--n') || '1', dry = argv.includes('--dry-run');
const url = process.env.STAGING_DB_URL, envFile = process.env.OMNIKOM_ENV_FILE;
if (!site || !/^[0-9a-f-]{36}$/i.test(site) || !slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { console.error('usage: --site <uuid> --slug <slug> [--n 1] [--dry-run]'); process.exit(2); }
if (!url) { console.error('set STAGING_DB_URL (read by name, never printed)'); process.exit(2); }
if (!envFile || !existsSync(envFile)) { console.error('set OMNIKOM_ENV_FILE to the owner\'s master .env (it must exist; the key is appended there and nowhere else)'); process.exit(2); }

const key = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(key).digest('hex');
const name = `site-${slug}-key-${n}`;
const varName = `SITE_SIGNING_KEY_${slug.toUpperCase().replace(/-/g, '_')}`;
if (dry) { console.log(`DRY RUN: would create Vault secret ${name}, api_keys row (site-signing, hash ${hash.slice(0, 12)}...), and append ${varName} to the .env`); process.exit(0); }

// one transaction: the Vault secret and the registry row, or neither. The key value travels only as a psql variable.
const sqlText = `begin;
select vault.create_secret(:'k', :'name', 'lead signing key, site ' || :'site');
insert into public.api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref, scope)
  select s.id, s.workspace_id, 'site-signing', :'label', :'hash', :'name', jsonb_build_object('site', s.id) from public.sites s where s.id = :'site'::uuid;
update public.sites set signing_key_ref = :'name' where id = :'site'::uuid;
commit;
select count(*) from public.api_keys where vault_ref = :'name';`;
const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-v', `k=${key}`, '-v', `name=${name}`, '-v', `site=${site}`, '-v', `hash=${hash}`, '-v', `label=${slug} lead key ${n}`, '-f', '-'], { encoding: 'utf8', input: sqlText, timeout: 60000 });
if (r.status !== 0 || r.stdout.trim() !== '1') { console.error('FAILED: nothing was stored (check the site id exists and vault.create_secret is available)'); console.error((r.stderr || '').replace(key, '<key>').replace(url, '<db url>').slice(0, 400)); process.exit(1); }
appendFileSync(envFile, `\n# ${name}: lead signing key for site ${site} (minted ${new Date().toISOString().slice(0, 10)}; set it on the Pages project as SITE_SIGNING_KEY)\n${varName}=${key}\n`);
console.log(`OK: Vault secret ${name} created, api_keys row written, sites.signing_key_ref set; ${varName} appended to the .env (value not shown)`);
